import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { sendReferralInviteEmail } from '../services/email';

const email = new Hono<{ Bindings: Env }>();

const MAX_PER_REQUEST = 100;
const DAILY_LIMIT = 100;
// Task #4 — daily reminder cap per sender (separate bucket from initial sends).
const DAILY_REMINDER_LIMIT = 20;
// Task #4 — minimum gap between reminders for the same invite. The 30-day
// "any prior invite" dedupe window is now permanent; if a sender wants to
// re-engage they must use the explicit Reminder action instead.
const REMINDER_COOLDOWN_HOURS = 24 * 7;
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
      signed_up_user_id INTEGER,
      reminder_count INTEGER NOT NULL DEFAULT 0,
      last_reminded_at TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_invites_sender_email ON referral_invites(sender_user_id, recipient_email)`,
    `CREATE INDEX IF NOT EXISTS idx_invites_recipient ON referral_invites(recipient_email)`,
    `CREATE INDEX IF NOT EXISTS idx_invites_sent_at ON referral_invites(sent_at)`,
    `CREATE INDEX IF NOT EXISTS idx_invites_signed_up_user ON referral_invites(signed_up_user_id)`,
    // Lazy ALTERs for envs that already have the older table shape (pre-046).
    // Each runs in its own try/catch — duplicate-column errors are expected
    // and harmless once the column exists.
    `ALTER TABLE referral_invites ADD COLUMN reminder_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE referral_invites ADD COLUMN last_reminded_at TIMESTAMP`,
    // Task #10 — per-invite "joined" notification idempotency stamp.
    // Mirrors sql/migrations/047_invite_joined_notified.sql so dev/preview
    // envs that haven't run wrangler d1 execute still work.
    `ALTER TABLE referral_invites ADD COLUMN joined_notified_at TIMESTAMP`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); } catch {}
  }
  migrated = true;
}

// Task #4 — Backfill `signed_up_user_id` for any sent-but-unjoined invite
// whose recipient_email now matches a real users row. Runs once per call
// to GET /invites so the panel always reflects ground-truth even if the
// register-time hook missed (e.g. user joined before the column existed,
// or registered via a different code). Idempotent and bounded by the
// caller's invite count (LIMIT comes from the read query that follows).
async function backfillJoinedStatus(env: Env, senderUserId: number): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE referral_invites
          SET signed_up_user_id = (
                SELECT u.id FROM users u
                 WHERE LOWER(u.email) = LOWER(referral_invites.recipient_email)
                 LIMIT 1
              ),
              status = 'joined'
        WHERE sender_user_id = ?
          AND signed_up_user_id IS NULL
          AND EXISTS (
                SELECT 1 FROM users u
                 WHERE LOWER(u.email) = LOWER(referral_invites.recipient_email)
              )`
    ).bind(senderUserId).run();
  } catch (e: any) {
    console.error('[invites] backfillJoinedStatus failed:', e?.message);
  }
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

  // Task #4 — permanent dedupe: any prior SUCCESSFUL invite from this
  // sender to this recipient is treated as a duplicate, regardless of how
  // long ago. The 30-day window let users silently re-invite the same
  // people on every CSV upload; now they must use the explicit Reminder
  // action instead. We deliberately EXCLUDE status='failed' rows so a
  // bounced/provider-rejected initial send can be retried via the same
  // bulk-upload flow — otherwise failed invites would be a dead-end
  // (remind endpoint also refuses failed rows).
  const priorInvites: any = await c.env.DB.prepare(
    `SELECT LOWER(recipient_email) AS email FROM referral_invites
     WHERE sender_user_id = ?
       AND status != 'failed'
       AND LOWER(recipient_email) IN (${placeholders})`
  ).bind(user.id, ...cleaned.map(c => c.email)).all();
  const priorSet = new Set<string>((priorInvites?.results || []).map((r: any) => r.email));

  // Surface the dedupe-hit emails as their own arrays so the import preview
  // can render the right badge ("Already invited" vs "Joined") instead of
  // the catch-all `failed` list.
  const alreadyInvited: string[] = [];
  const alreadyMember: string[] = [];

  const toSend: Array<{ email: string; name: string }> = [];
  for (const c of cleaned) {
    if (existingSet.has(c.email)) {
      alreadyMember.push(c.email);
      failed.push({ email: c.email, reason: 'Already a member' });
      continue;
    }
    if (priorSet.has(c.email)) {
      alreadyInvited.push(c.email);
      failed.push({ email: c.email, reason: 'Already invited — use the Reminder button to nudge them' });
      continue;
    }
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
  const baseLink = `${c.env.APP_URL || 'https://app.axal.vc'}/register?ref=${encodeURIComponent(sender.referral_code)}`;
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
    already_invited: alreadyInvited,
    already_member: alreadyMember,
    daily_remaining: Math.max(0, remainingToday - sentCount),
  });
});

// GET /api/email/invites — list every invite this sender has ever sent,
// enriched with the joined-user's display name + a derived `joined_at`
// timestamp (`users.created_at` of the referenced user). Runs a one-shot
// lazy backfill so any sent-but-unjoined invite whose recipient now exists
// in `users` is upgraded to status='joined' before the read query.
email.get('/invites', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  await backfillJoinedStatus(c.env, user.id);
  const r: any = await c.env.DB.prepare(
    `SELECT i.id, i.recipient_email, i.recipient_name, i.status,
            i.failure_reason, i.sent_at, i.opened_at, i.signed_up_user_id,
            i.reminder_count, i.last_reminded_at,
            u.name AS joined_user_name,
            u.created_at AS joined_at
       FROM referral_invites i
       LEFT JOIN users u ON u.id = i.signed_up_user_id
      WHERE i.sender_user_id = ?
      ORDER BY datetime(i.sent_at) DESC
      LIMIT 200`
  ).bind(user.id).all();
  return c.json({ invites: r?.results || [] });
});

// POST /api/email/invites/:id/remind — re-send the original invite email
// to the same recipient. Rejects when:
//   • the invite already converted (signed_up_user_id IS NOT NULL),
//   • the original send failed (use the bulk endpoint to retry instead),
//   • the cooldown window has not elapsed (REMINDER_COOLDOWN_HOURS),
//   • the per-day reminder cap (DAILY_REMINDER_LIMIT) has been hit.
// On success bumps `reminder_count` + writes `last_reminded_at` and
// records an activity_log row for support traceability.
email.post('/invites/:id/remind', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);

  const inviteId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(inviteId) || inviteId <= 0) {
    return c.json({ error: 'Invalid invite id' }, 400);
  }

  const invite: any = await c.env.DB.prepare(
    `SELECT id, sender_user_id, recipient_email, recipient_name, referral_code,
            personal_message, status, signed_up_user_id, reminder_count, last_reminded_at
       FROM referral_invites WHERE id = ?`
  ).bind(inviteId).first();
  if (!invite) return c.json({ error: 'Invite not found' }, 404);
  if (invite.sender_user_id !== user.id) return c.json({ error: 'Forbidden' }, 403);
  if (invite.signed_up_user_id) {
    return c.json({ error: 'Recipient already joined — no reminder needed' }, 400);
  }
  if (invite.status === 'failed') {
    return c.json({ error: 'Original send failed; use the bulk send flow to retry instead of reminding' }, 400);
  }
  if (invite.last_reminded_at) {
    const lastMs = Date.parse(invite.last_reminded_at + 'Z');
    if (Number.isFinite(lastMs) && Date.now() - lastMs < REMINDER_COOLDOWN_HOURS * 3600 * 1000) {
      const nextAt = new Date(lastMs + REMINDER_COOLDOWN_HOURS * 3600 * 1000).toISOString();
      return c.json({ error: `Reminder cooldown — try again after ${nextAt}`, retry_after: nextAt }, 429);
    }
  }

  // Daily reminder budget — separate KV bucket from the initial-send quota
  // so a user with 100 sends still has their 20 reminders.
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rateKey = `invite_reminders:daily:${user.id}:${today}`;
  const now = new Date();
  const endOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
  const dayTtl = Math.max(60, Math.floor((endOfDay - now.getTime()) / 1000) + 60);
  const usedRaw = await c.env.RATE_LIMITS.get(rateKey);
  const usedToday = usedRaw ? parseInt(usedRaw, 10) || 0 : 0;
  if (usedToday >= DAILY_REMINDER_LIMIT) {
    return c.json({ error: `Daily reminder limit reached (${DAILY_REMINDER_LIMIT}/day). Try again tomorrow.` }, 429);
  }

  const sender: any = await c.env.DB.prepare(
    `SELECT name, email, referral_code FROM users WHERE id = ?`
  ).bind(user.id).first();
  if (!sender || !sender.referral_code) {
    return c.json({ error: 'Referral code missing on sender — visit Refer & Earn to generate one.' }, 400);
  }

  // Reserve quota up-front to shrink the race window vs. parallel reminds.
  try {
    await c.env.RATE_LIMITS.put(rateKey, String(usedToday + 1), { expirationTtl: dayTtl });
  } catch {}

  const baseLink = `${c.env.APP_URL || 'https://app.axal.vc'}/register?ref=${encodeURIComponent(sender.referral_code)}`;
  const personalizedLink = `${baseLink}&invitee=${encodeURIComponent(invite.recipient_email)}`;
  let ok = false;
  let reason = '';
  try {
    ok = await sendReferralInviteEmail(
      c.env,
      invite.recipient_email,
      invite.recipient_name || '',
      sender.name,
      personalizedLink,
      sender.referral_code,
      invite.personal_message || '',
    );
    if (!ok) reason = 'Email provider rejected the message';
  } catch (e: any) {
    reason = e?.message || 'Unknown error';
  }

  if (!ok) {
    // Refund the reservation; do NOT bump reminder_count on failure.
    try { await c.env.RATE_LIMITS.put(rateKey, String(usedToday), { expirationTtl: dayTtl }); } catch {}
    return c.json({ error: reason || 'Reminder send failed' }, 502);
  }

  try {
    await c.env.DB.prepare(
      `UPDATE referral_invites
          SET reminder_count = COALESCE(reminder_count, 0) + 1,
              last_reminded_at = CURRENT_TIMESTAMP,
              status = CASE WHEN status = 'failed' THEN status ELSE 'sent' END
        WHERE id = ?`
    ).bind(inviteId).run();
  } catch (e: any) {
    console.error('[invites] reminder bookkeeping write failed:', e?.message);
  }

  // Audit trail. We do NOT log plaintext recipient emails here either —
  // hash the sender's address only, mirroring the rest of activity_logs.
  try {
    const { hashEmail } = await import('../util/hashEmail');
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`
    ).bind(
      'invite_reminder_sent',
      JSON.stringify({ invite_id: inviteId, reminder_count: (invite.reminder_count || 0) + 1 }),
      await hashEmail(sender.email),
      user.id,
    ).run();
  } catch {}

  return c.json({
    ok: true,
    invite_id: inviteId,
    reminder_count: (invite.reminder_count || 0) + 1,
    last_reminded_at: new Date().toISOString(),
    daily_remaining: Math.max(0, DAILY_REMINDER_LIMIT - usedToday - 1),
  });
});

export default email;
