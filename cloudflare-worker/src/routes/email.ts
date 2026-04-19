import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { sendReferralInviteEmail } from '../services/email';

const email = new Hono<{ Bindings: Env }>();

const MAX_PER_REQUEST = 100;
const DAILY_LIMIT = 100;
const DEDUPE_WINDOW_HOURS = 24 * 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

let migrated = false;
async function ensureSchema(env: Env) {
  if (migrated) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS referral_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_user_id INTEGER NOT NULL,
      recipient_email TEXT NOT NULL,
      recipient_name TEXT,
      referral_code TEXT NOT NULL,
      personal_message TEXT,
      status TEXT NOT NULL DEFAULT 'sent',
      failure_reason TEXT,
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      opened_at TIMESTAMP,
      signed_up_user_id INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS idx_invites_sender_email ON referral_invites(sender_user_id, recipient_email)`,
    `CREATE INDEX IF NOT EXISTS idx_invites_recipient ON referral_invites(recipient_email)`,
    `CREATE INDEX IF NOT EXISTS idx_invites_sent_at ON referral_invites(sent_at)`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); } catch {}
  }
  migrated = true;
}

function normalizeEmail(s: string): string {
  return (s || '').trim().toLowerCase();
}

async function getSenderInfo(env: Env, userId: number): Promise<{ name: string; email: string; referral_code: string } | null> {
  const row: any = await env.DB.prepare(
    `SELECT name, email, referral_code FROM users WHERE id = ?`
  ).bind(userId).first();
  if (!row || !row.referral_code) return null;
  return { name: row.name, email: row.email, referral_code: row.referral_code };
}

email.post('/send-referral-invites', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  const contacts: Array<{ email?: string; name?: string }> = Array.isArray(body?.contacts) ? body.contacts : [];
  const customMessage: string = typeof body?.custom_message === 'string' ? body.custom_message.slice(0, 2000) : '';

  if (contacts.length === 0) return c.json({ error: 'No contacts provided' }, 400);
  if (contacts.length > MAX_PER_REQUEST) {
    return c.json({ error: `Too many contacts in one request (max ${MAX_PER_REQUEST})` }, 400);
  }

  const sender = await getSenderInfo(c.env, user.id);
  if (!sender) return c.json({ error: 'Referral code not found for this user. Visit Refer & Earn to generate one.' }, 400);

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rateKey = `invites:daily:${user.id}:${today}`;
  const now = new Date();
  const endOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
  const dayTtl = Math.max(60, Math.floor((endOfDay - now.getTime()) / 1000) + 60);
  const usedRaw = await c.env.RATE_LIMITS.get(rateKey);
  const usedToday = usedRaw ? parseInt(usedRaw, 10) || 0 : 0;
  const remainingToday = DAILY_LIMIT - usedToday;
  if (remainingToday <= 0) {
    return c.json({ error: `Daily invite limit reached (${DAILY_LIMIT}/day). Try again tomorrow.` }, 429);
  }

  const sent: string[] = [];
  const failed: Array<{ email: string; reason: string }> = [];
  const seenInRequest = new Set<string>();

  const cleaned: Array<{ email: string; name: string }> = [];
  for (const raw of contacts) {
    const e = normalizeEmail(raw?.email || '');
    if (!e) { failed.push({ email: raw?.email || '', reason: 'Empty email' }); continue; }
    if (!EMAIL_RE.test(e)) { failed.push({ email: e, reason: 'Invalid email format' }); continue; }
    if (seenInRequest.has(e)) { failed.push({ email: e, reason: 'Duplicate within this request' }); continue; }
    if (e === normalizeEmail(sender.email)) { failed.push({ email: e, reason: "Can't invite yourself" }); continue; }
    seenInRequest.add(e);
    cleaned.push({ email: e, name: (raw?.name || '').trim().slice(0, 200) });
  }

  if (cleaned.length === 0) {
    return c.json({ sent: 0, failed, daily_remaining: remainingToday });
  }

  // Dedupe vs registered users
  const placeholders = cleaned.map(() => '?').join(',');
  const existingUsers: any = await c.env.DB.prepare(
    `SELECT LOWER(email) AS email FROM users WHERE LOWER(email) IN (${placeholders})`
  ).bind(...cleaned.map(c => c.email)).all();
  const existingSet = new Set<string>((existingUsers?.results || []).map((r: any) => r.email));

  // Dedupe vs recent invites from this sender
  const recentCutoff = new Date(Date.now() - DEDUPE_WINDOW_HOURS * 3600 * 1000).toISOString();
  const recentInvites: any = await c.env.DB.prepare(
    `SELECT LOWER(recipient_email) AS email FROM referral_invites
     WHERE sender_user_id = ? AND sent_at > ? AND LOWER(recipient_email) IN (${placeholders})`
  ).bind(user.id, recentCutoff, ...cleaned.map(c => c.email)).all();
  const recentSet = new Set<string>((recentInvites?.results || []).map((r: any) => r.email));

  const toSend: Array<{ email: string; name: string }> = [];
  for (const c of cleaned) {
    if (existingSet.has(c.email)) { failed.push({ email: c.email, reason: 'Already a member' }); continue; }
    if (recentSet.has(c.email))   { failed.push({ email: c.email, reason: 'Already invited recently' }); continue; }
    toSend.push(c);
  }

  // Apply daily quota cap
  if (toSend.length > remainingToday) {
    for (const overflow of toSend.slice(remainingToday)) {
      failed.push({ email: overflow.email, reason: `Daily limit (${DAILY_LIMIT}) — try again tomorrow` });
    }
    toSend.length = remainingToday;
  }

  // Reserve quota up-front to shrink the race window vs. parallel requests.
  // Refund the unused portion (and any send failures) at the end.
  const reserved = toSend.length;
  if (reserved > 0) {
    try {
      await c.env.RATE_LIMITS.put(rateKey, String(usedToday + reserved), { expirationTtl: dayTtl });
    } catch {}
  }

  // Send emails sequentially to avoid hammering Gmail; record outcome.
  const baseLink = `${c.env.APP_URL || 'https://axal.vc'}/register?ref=${encodeURIComponent(sender.referral_code)}`;
  let sentCount = 0;
  for (const contact of toSend) {
    const personalizedLink = `${baseLink}&invitee=${encodeURIComponent(contact.email)}`;
    let ok = false;
    let reason = '';
    try {
      ok = await sendReferralInviteEmail(c.env, contact.email, contact.name, sender.name, personalizedLink, sender.referral_code, customMessage);
      if (!ok) reason = 'Email provider rejected the message';
    } catch (e: any) {
      reason = e?.message || 'Unknown error';
    }
    try {
      await c.env.DB.prepare(
        `INSERT INTO referral_invites (sender_user_id, recipient_email, recipient_name, referral_code, personal_message, status, failure_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(user.id, contact.email, contact.name || null, sender.referral_code, customMessage || null, ok ? 'sent' : 'failed', ok ? null : reason).run();
    } catch { /* tracking write failure should not fail the whole batch */ }

    if (ok) { sent.push(contact.email); sentCount++; }
    else    { failed.push({ email: contact.email, reason: reason || 'Send failed' }); }
  }

  // Refund unused reservations (failures + nothing-sent rows that we'd already
  // counted against the daily quota).
  if (reserved > sentCount) {
    try {
      await c.env.RATE_LIMITS.put(rateKey, String(usedToday + sentCount), { expirationTtl: dayTtl });
    } catch {}
  }

  return c.json({
    sent: sentCount,
    failed,
    daily_remaining: Math.max(0, remainingToday - sentCount),
  });
});

email.get('/invites', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const r: any = await c.env.DB.prepare(
    `SELECT id, recipient_email, recipient_name, status, failure_reason, sent_at, opened_at, signed_up_user_id
     FROM referral_invites WHERE sender_user_id = ? ORDER BY sent_at DESC LIMIT 200`
  ).bind(user.id).all();
  return c.json({ invites: r?.results || [] });
});

export default email;
