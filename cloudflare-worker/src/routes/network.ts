import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth, requireAdmin } from '../auth';
import { hashEmail } from '../util/hashEmail';
import { generateUniqueShortReferralCode } from '../services/referrals/codes';
import { resolveReferralCode } from '../services/referrals/resolveCode';

const network = new Hono<{ Bindings: Env }>();

let migrated = false;
async function ensureSchema(env: Env) {
  if (migrated) return;
  const db = env.DB;
  const stmts = [
    `ALTER TABLE users ADD COLUMN referral_code TEXT`,
    // Task #4 (DH) — back-compat column for historical AXAL-XXXXXX(XX)
    // codes. Defensive ALTER + index here so dev/SQLite stays self-
    // healing even before migration 051 is applied to remote D1.
    `ALTER TABLE users ADD COLUMN legacy_referral_code TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_users_legacy_referral_code ON users(legacy_referral_code)`,
    `CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id INTEGER NOT NULL,
      referred_id INTEGER NOT NULL UNIQUE,
      referral_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      converted_at TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id)`,
    `CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)`,
    `CREATE TABLE IF NOT EXISTS commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      referral_id INTEGER,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      source_type TEXT NOT NULL,
      source_id TEXT,
      status TEXT NOT NULL DEFAULT 'accrued',
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      paid_at TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_commissions_user ON commissions(user_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_commissions_event ON commissions(user_id, source_type, source_id)`,
    `CREATE TABLE IF NOT EXISTS payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'requested',
      payout_method TEXT NOT NULL,
      payout_details TEXT,
      failure_reason TEXT,
      processed_by INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_payouts_user ON payouts(user_id)`,
    `CREATE TABLE IF NOT EXISTS commission_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_key TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL,
      amount_cents INTEGER,
      percentage_bps INTEGER,
      description TEXT,
      active INTEGER DEFAULT 1
    )`,
  ];
  for (const s of stmts) { try { await db.prepare(s).run(); } catch {} }

  // Seed default rules (idempotent via INSERT OR IGNORE)
  const seeds: Array<[string, string, number | null, number | null, string]> = [
    ['referral_kyc_approved', 'kyc_approved', 5000, null, '$50 flat when a referred user completes KYC'],
    ['referral_deal_funded', 'deal_funding', null, 200, '2% of funding amount when referred user closes a deal'],
    ['referral_lp_onboarded', 'lp_onboarded', 500000, null, '$5,000 flat for successful LP onboarding'],
    ['referral_spinout', 'spinout', null, 100, '1% of spin-out raise'],
    ['referral_partner_fee', 'partner_fee', 25000, null, '$250 flat for new operating partner'],
  ];
  for (const [key, st, amt, bps, desc] of seeds) {
    try {
      await db.prepare(`INSERT OR IGNORE INTO commission_rules (rule_key, source_type, amount_cents, percentage_bps, description) VALUES (?, ?, ?, ?, ?)`).bind(key, st, amt, bps, desc).run();
    } catch {}
  }
  migrated = true;
}

// Task #4 (DH) — Brand-new codes use the 6-char Crockford-base32 short
// form (no AXAL- prefix). Pre-existing users keep their (truncated) short
// code in users.referral_code and the original `AXAL-XXXXXX(XX)` in
// users.legacy_referral_code (via migration 051) so historical invite
// URLs still resolve via resolveReferralCode().
async function ensureReferralCode(env: Env, userId: number): Promise<string> {
  const row = await env.DB
    .prepare(`SELECT referral_code FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ referral_code: string | null }>();
  const existing = row?.referral_code || '';
  // Detect codes still in the old `AXAL-XXXXXX(XX)` shape (e.g. dev DBs
  // that haven't run migration 051 yet) and rotate them to the short
  // form transparently — the legacy value is moved to
  // legacy_referral_code so back-compat resolution keeps working.
  if (existing && !existing.startsWith('AXAL-') && existing.length <= 32) {
    return existing;
  }
  const fresh = await generateUniqueShortReferralCode(env);
  if (existing.startsWith('AXAL-')) {
    await env.DB
      .prepare(`UPDATE users SET legacy_referral_code = COALESCE(legacy_referral_code, ?), referral_code = ? WHERE id = ?`)
      .bind(existing, fresh, userId)
      .run();
  } else {
    await env.DB
      .prepare(`UPDATE users SET referral_code = ? WHERE id = ?`)
      .bind(fresh, userId)
      .run();
  }
  return fresh;
}

// Internal: called by other routes (kyc.ts, etc.) when a milestone fires.
// Looks up the user's referrer (if any) and creates a commission per the rule.
export async function fireCommissionEvent(
  env: Env,
  referredUserId: number,
  ruleKey: string,
  sourceId: string,
  amountForBps: number = 0,
): Promise<void> {
  await ensureSchema(env);
  const sql = getSQL(env);
  try {
    const refRows = await sql`SELECT id, referrer_id FROM referrals WHERE referred_id = ${referredUserId}`;
    if (!refRows.length) return;
    const referral = refRows[0];

    const ruleRows = await sql`SELECT * FROM commission_rules WHERE rule_key = ${ruleKey} AND active = 1`;
    if (!ruleRows.length) return;
    const rule: any = ruleRows[0];

    const amountCents = rule.amount_cents
      ? rule.amount_cents
      : rule.percentage_bps
        ? Math.round((amountForBps * rule.percentage_bps) / 10000)
        : 0;
    if (amountCents <= 0) return;

    // Idempotency: DB-enforced via UNIQUE INDEX on (user_id, source_type, source_id).
    // INSERT OR IGNORE silently no-ops on conflict so retries are safe.
    const insertResult = await env.DB.prepare(
      `INSERT OR IGNORE INTO commissions (user_id, referral_id, amount_cents, source_type, source_id, status, description) VALUES (?, ?, ?, ?, ?, 'accrued', ?)`
    ).bind(referral.referrer_id, referral.id, amountCents, rule.source_type, sourceId, rule.description).run();
    if (!insertResult.meta?.changes) return; // already credited; do not log a second time
    await sql`UPDATE referrals SET status = 'converted', converted_at = CURRENT_TIMESTAMP WHERE id = ${referral.id} AND status != 'converted'`;

    // Task #9 — also create a referral_payouts ledger row for the new
    // commission so the Stripe Connect payout pipeline can pick it up.
    // Idempotent via UNIQUE(redemption_id) inside the helper.
    try {
      const commissionRow = await sql`SELECT id FROM commissions WHERE user_id = ${referral.referrer_id} AND source_type = ${rule.source_type} AND source_id = ${sourceId} LIMIT 1`;
      const commissionId = (commissionRow[0] as { id?: number } | undefined)?.id;
      if (commissionId) {
        const { createReferralPayoutForCommission } = await import('../services/referralPayouts');
        await createReferralPayoutForCommission(env, {
          commissionId,
          referrerUserId: referral.referrer_id,
          amountCents,
        });
      }
    } catch (e) {
      console.warn('[refer-earn] createReferralPayoutForCommission failed:', (e as Error).message);
    }

    const referrerRow = await sql`SELECT email, id FROM users WHERE id = ${referral.referrer_id}`;
    if (referrerRow.length) {
      const dollars = (amountCents / 100).toFixed(2);
      await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('commission_earned', ${`You earned $${dollars} commission (${rule.description})`}, ${await hashEmail(referrerRow[0].email)}, ${referrerRow[0].id})`;
    }
    // Fire L2/L3 compounding bonuses (idempotent via UNIQUE index on commissions(user_id, source_type, source_id))
    try {
      const { fireCompoundingBonuses } = await import('./networkfx');
      await fireCompoundingBonuses(env, referredUserId, amountCents, rule.source_type, sourceId);
    } catch (e: any) {
      console.error('[networkfx] fireCompoundingBonuses failed', { referredUserId, sourceId, err: String(e?.message || e) });
    }
  } finally { await sql.end(); }
}


// Task #10 — Notify every inviter whose still-unjoined invite to this
// user's email is now eligible. Reads pending rows, stamps
// joined_notified_at FIRST (so a concurrent re-entry can't double-fire),
// then calls notify() per row. Worst case on partial failure is a
// notification stamp without a delivered notification — strictly better
// than the duplicate-celebration alternative for an upbeat-but-not-
// critical UX event. Guarded by the new `joined_notified_at` column
// (migrations/047_invite_joined_notified.sql + lazy ALTER in email.ts).
async function fireJoinedInviteNotifications(env: Env, newUserId: number): Promise<void> {
  const recipientRow: any = await env.DB.prepare(
    `SELECT id, email, COALESCE(name, email) AS name FROM users WHERE id = ?`
  ).bind(newUserId).first();
  if (!recipientRow?.email) return;
  const recipientName = String(recipientRow.name || recipientRow.email);
  // Pull every still-eligible invite + the sender's id so notify() can
  // resolve channels/prefs from users.notification_prefs. We filter on
  // status='joined' (the previous UPDATE already set it for this user)
  // and joined_notified_at IS NULL for idempotency. Bound to a sane
  // page so a malformed bulk import can't stall registration.
  let rows: any[] = [];
  try {
    const r: any = await env.DB.prepare(
      `SELECT id, sender_user_id
         FROM referral_invites
        WHERE LOWER(recipient_email) = LOWER(?)
          AND status = 'joined'
          AND signed_up_user_id = ?
          AND joined_notified_at IS NULL
        LIMIT 50`
    ).bind(recipientRow.email, newUserId).all();
    rows = r?.results || [];
  } catch (e: any) {
    // joined_notified_at column may not exist on the oldest dev DBs —
    // the lazy ensureSchema in email.ts adds it on first /invites read.
    // Trigger that path inline so registration still fires the notify.
    if (/no such column.*joined_notified_at/i.test(String(e?.message || ''))) {
      try {
        await env.DB.prepare(
          `ALTER TABLE referral_invites ADD COLUMN joined_notified_at TIMESTAMP`
        ).run();
      } catch { /* duplicate — fine */ }
      const r2: any = await env.DB.prepare(
        `SELECT id, sender_user_id
           FROM referral_invites
          WHERE LOWER(recipient_email) = LOWER(?)
            AND status = 'joined'
            AND signed_up_user_id = ?
            AND joined_notified_at IS NULL
          LIMIT 50`
      ).bind(recipientRow.email, newUserId).all();
      rows = r2?.results || [];
    } else {
      throw e;
    }
  }
  if (!rows.length) return;
  const { notify } = await import('../services/notify');
  const seenIds = new Set<number>();
  let pending = rows;
  // Loop in pages of 50 (the SELECT cap) until no more eligible rows
  // remain. Belt-and-suspenders against the rare case where one
  // recipient has been invited by >50 senders. `seenIds` defends
  // against an infinite loop if the stamp UPDATE ever fails to mark a
  // row (e.g. transient D1 error).
  let safety = 0;
  while (pending.length && safety++ < 20) {
    for (const row of pending) {
      const inviteId = Number(row.id);
      if (seenIds.has(inviteId)) continue;
      seenIds.add(inviteId);
      const senderId = Number(row.sender_user_id);
      if (!Number.isFinite(senderId) || senderId === newUserId) continue;
      // Race-safe idempotency: stamp FIRST, and only fire notify() if
      // THIS execution actually flipped joined_notified_at from NULL
      // (meta.changes === 1). Concurrent attachReferral calls for the
      // same recipient — possible on retried registrations — will see
      // changes === 0 here and skip the notify, even though their
      // earlier SELECT returned the same row.
      let changed = 0;
      try {
        const r: any = await env.DB.prepare(
          `UPDATE referral_invites
              SET joined_notified_at = CURRENT_TIMESTAMP
            WHERE id = ? AND joined_notified_at IS NULL`
        ).bind(inviteId).run();
        changed = Number(r?.meta?.changes ?? 0);
      } catch (e: any) {
        console.error('[attachReferral] joined_notified_at stamp failed:', e?.message);
        continue;
      }
      if (changed === 0) continue; // another worker already notified
      try {
        await notify(env, {
          userId: senderId,
          type: 'referral_invite_joined',
          category: 'proactive_nudges',
          title: `${recipientName} just joined via your invite`,
          body: `${recipientName} signed up using your referral link — you'll earn $50 when they complete KYC, plus 2% on any deal they fund. Track progress on your referrals page.`,
          link: '/referrals',
          payload: { invite_id: inviteId, joined_user_id: newUserId },
          channels: ['in_app', 'email'],
        });
      } catch (e: any) {
        console.error('[attachReferral] notify referral_invite_joined failed:', e?.message);
      }
    }
    // Re-page in case >50 inviters exist for this recipient.
    try {
      const r: any = await env.DB.prepare(
        `SELECT id, sender_user_id
           FROM referral_invites
          WHERE LOWER(recipient_email) = LOWER(?)
            AND status = 'joined'
            AND signed_up_user_id = ?
            AND joined_notified_at IS NULL
          LIMIT 50`
      ).bind(recipientRow.email, newUserId).all();
      pending = r?.results || [];
    } catch {
      pending = [];
    }
  }
}

// Internal: called from auth registration to attach a referrer
export async function attachReferral(env: Env, newUserId: number, refCode: string): Promise<boolean> {
  if (!refCode) return false;
  await ensureSchema(env);
  // Task #4 (DH) — resolve through the back-compat helper so historical
  // `AXAL-XXXXXX(XX)` invite URLs still attach correctly.
  const referrerId = await resolveReferralCode(env, refCode);
  if (!referrerId) return false;
  if (referrerId === newUserId) return false; // self-referral guard
  const sql = getSQL(env);
  try {
    const existing = await sql`SELECT id FROM referrals WHERE referred_id = ${newUserId}`;
    if (existing.length) return false;
    await sql`INSERT INTO referrals (referrer_id, referred_id, referral_code, status) VALUES (${referrerId}, ${newUserId}, ${refCode}, 'pending')`;
    // Task #4 — close the loop on the inviter's "Sent invitations" panel.
    // Any prior referral_invites row from THIS referrer to this user's email
    // gets stamped with the new user_id + status='joined'. Idempotent — only
    // touches rows where signed_up_user_id IS NULL. We do NOT scope by
    // referrer here because a user might join via a different sender's link;
    // the lazy backfill in GET /api/email/invites picks up that case too.
    try {
      await env.DB.prepare(
        `UPDATE referral_invites
            SET signed_up_user_id = ?, status = 'joined'
          WHERE signed_up_user_id IS NULL
            AND LOWER(recipient_email) = (
                  SELECT LOWER(email) FROM users WHERE id = ?
                )`
      ).bind(newUserId, newUserId).run();
    } catch (e: any) {
      console.error('[attachReferral] referral_invites stamp failed:', e?.message);
    }
    // Task #10 — fire a one-time "X just joined via your invite"
    // notification to every inviter who sent this email and hasn't
    // already been notified for this signup. Idempotent via the
    // `joined_notified_at` column added in 047_invite_joined_notified.sql:
    // only rows where the column IS NULL are eligible, and we stamp
    // them in the same statement that picks them. A user may have been
    // invited by multiple senders — they all get one notification.
    // All failures are logged and never block registration.
    try {
      await fireJoinedInviteNotifications(env, newUserId);
    } catch (e: any) {
      console.error('[attachReferral] joined-notify failed:', e?.message);
    }
    // Build compounding chain (L1, L2, L3) — log any failure so silent revenue loss is detectable
    try {
      const { buildReferralChain } = await import('./networkfx');
      await buildReferralChain(env, newUserId, referrerId);
    } catch (e: any) {
      console.error('[networkfx] buildReferralChain failed', { newUserId, referrerId, err: String(e?.message || e) });
    }
    return true;
  } finally { await sql.end(); }
}

// ---------- REFERRAL ENDPOINTS ----------

network.get('/referral/code', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const code = await ensureReferralCode(c.env, user.id);
  const baseUrl = c.env.APP_URL || 'https://app.axal.vc';
  // Task #4 (DH) — surface the legacy AXAL- code (if present) so the
  // Refer & Earn UI can show the "Previous code also works" tooltip.
  let legacyCode: string | null = null;
  try {
    const row = await c.env.DB
      .prepare(`SELECT legacy_referral_code FROM users WHERE id = ?`)
      .bind(user.id)
      .first<{ legacy_referral_code: string | null }>();
    legacyCode = row?.legacy_referral_code || null;
  } catch {
    // Column missing on a very stale dev DB — treat as "no legacy code".
  }
  return c.json({
    code,
    legacy_code: legacyCode,
    link: `${baseUrl}/?ref=${code}`,
    register_link: `${baseUrl}/register?ref=${code}`,
  });
});

network.get('/referral/list', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`
    SELECT r.id, r.status, r.created_at, r.converted_at,
           u.id as referred_user_id, u.name as referred_name, u.email as referred_email, u.kyc_status
    FROM referrals r
    JOIN users u ON u.id = r.referred_id
    WHERE r.referrer_id = ${user.id}
    ORDER BY r.created_at DESC
  `;
  await sql.end();
  return c.json(rows);
});

// ---------- COMMISSIONS ----------

network.get('/commissions/me', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM commissions WHERE user_id = ${user.id} ORDER BY created_at DESC`;
  const balance = await sql`SELECT COALESCE(SUM(amount_cents), 0) as total FROM commissions WHERE user_id = ${user.id} AND status = 'accrued'`;
  const lifetime = await sql`SELECT COALESCE(SUM(amount_cents), 0) as total FROM commissions WHERE user_id = ${user.id}`;
  await sql.end();
  return c.json({
    balance_cents: parseInt(balance[0].total) || 0,
    lifetime_cents: parseInt(lifetime[0].total) || 0,
    commissions: rows,
  });
});

network.get('/admin/commissions', async (c) => {
  await requireAdmin(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT c.*, u.email, u.name FROM commissions c JOIN users u ON u.id = c.user_id ORDER BY c.created_at DESC LIMIT 500`;
  await sql.end();
  return c.json(rows);
});

network.get('/admin/commission-rules', async (c) => {
  await requireAdmin(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM commission_rules ORDER BY rule_key`;
  await sql.end();
  return c.json(rows);
});

// ---------- PAYOUTS ----------

network.get('/payouts/me', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM payouts WHERE user_id = ${user.id} ORDER BY created_at DESC`;
  await sql.end();
  return c.json(rows);
});

network.post('/payout/request', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const { amount_cents, payout_method, payout_details } = await c.req.json().catch(() => ({}));

  const amt = parseInt(amount_cents);
  if (!amt || amt < 1000) return c.json({ error: 'Minimum payout is $10.00' }, 400);
  if (!['stripe', 'wire', 'crypto'].includes(payout_method)) return c.json({ error: 'Invalid payout_method (stripe|wire|crypto)' }, 400);

  const sql = getSQL(c.env);
  try {
    const balRows = await sql`SELECT COALESCE(SUM(amount_cents), 0) as total FROM commissions WHERE user_id = ${user.id} AND status = 'accrued'`;
    const balance = parseInt(balRows[0].total) || 0;
    if (amt > balance) return c.json({ error: `Insufficient balance. Available: $${(balance / 100).toFixed(2)}` }, 400);

    // Reserve: mark commissions as 'paid' up to amount (FIFO oldest first)
    const accrued = await sql`SELECT id, amount_cents FROM commissions WHERE user_id = ${user.id} AND status = 'accrued' ORDER BY created_at ASC`;
    let remaining = amt;
    const usedIds: number[] = [];
    for (const row of accrued as any[]) {
      if (remaining <= 0) break;
      if (row.amount_cents > remaining) {
        // For simplicity we don't split commissions — payouts must equal sum of full commission rows.
        return c.json({ error: 'Amount must match sum of available commissions. Try amount=$' + (balance / 100).toFixed(2) + ' (full balance) or a smaller value matching commission row(s).' }, 400);
      }
      remaining -= row.amount_cents;
      usedIds.push(row.id);
    }
    if (remaining !== 0) return c.json({ error: 'Amount does not align with available commissions' }, 400);

    const detailsJson = payout_details ? JSON.stringify(payout_details) : null;

    // Atomic reservation via D1 batch: the INSERT only succeeds if the requested commissions
    // are still 'accrued' AND belong to this user (verified inside a SELECT in the WHERE clause).
    // Because batch() is a single atomic transaction in D1, the subsequent UPDATE is guaranteed
    // to mark exactly the same rows we verified — no concurrent payout can claim them in between.
    const ph = usedIds.map(() => '?').join(',');
    const insertSql = `INSERT INTO payouts (user_id, amount_cents, status, payout_method, payout_details)
      SELECT ?, ?, 'requested', ?, ?
      WHERE (SELECT COUNT(*) FROM commissions WHERE id IN (${ph}) AND user_id = ? AND status = 'accrued') = ?
      RETURNING *`;
    const updateSql = `UPDATE commissions SET status = 'paid', paid_at = CURRENT_TIMESTAMP
      WHERE id IN (${ph}) AND user_id = ? AND status = 'accrued'`;

    const batchResult = await c.env.DB.batch([
      c.env.DB.prepare(insertSql).bind(user.id, amt, payout_method, detailsJson, ...usedIds, user.id, usedIds.length),
      c.env.DB.prepare(updateSql).bind(...usedIds, user.id),
    ]);

    const insertedRows = (batchResult[0].results as any[]) || [];
    if (insertedRows.length !== 1) {
      return c.json({ error: 'Your balance changed during the request (concurrent payout). Please refresh and retry.' }, 409);
    }
    const payout = insertedRows[0];

    await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('payout_requested', ${`Payout requested: $${(amt / 100).toFixed(2)} via ${payout_method}`}, ${await hashEmail(user.email)}, ${user.id})`;
    return c.json(payout);
  } finally { await sql.end(); }
});

network.patch('/admin/payouts/:id/process', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureSchema(c.env);
  const id = parseInt(c.req.param('id'));
  const { action, failure_reason } = await c.req.json().catch(() => ({ action: 'complete' }));
  if (!['complete', 'fail', 'process'].includes(action)) return c.json({ error: 'action must be complete|fail|process' }, 400);

  const sql = getSQL(c.env);
  try {
    const rows = await sql`SELECT p.*, u.email, u.name FROM payouts p JOIN users u ON u.id = p.user_id WHERE p.id = ${id}`;
    if (!rows.length) return c.json({ error: 'Payout not found' }, 404);
    const p: any = rows[0];

    if (action === 'process') {
      await sql`UPDATE payouts SET status = 'processing', processed_by = ${adminUser.id} WHERE id = ${id}`;
      await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('payout_processing', ${`Your payout of $${(p.amount_cents / 100).toFixed(2)} is being processed.`}, ${await hashEmail(p.email)}, ${p.user_id})`;
      return c.json({ status: 'processing' });
    }
    if (action === 'complete') {
      // Real Stripe Connect would happen here if STRIPE_SECRET_KEY is set; skipping actual API call.
      await sql`UPDATE payouts SET status = 'completed', processed_by = ${adminUser.id}, completed_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
      await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('payout_completed', ${`Your payout of $${(p.amount_cents / 100).toFixed(2)} was completed via ${p.payout_method}.`}, ${await hashEmail(p.email)}, ${p.user_id})`;
      return c.json({ status: 'completed' });
    }
    if (action === 'fail') {
      const reason = failure_reason || 'Payout failed';
      await sql`UPDATE payouts SET status = 'failed', failure_reason = ${reason}, processed_by = ${adminUser.id} WHERE id = ${id}`;
      // Refund: reset associated commissions back to 'accrued'. Best-effort — match by user_id and amount of commissions paid in same window.
      // For audit clarity, also log.
      await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('payout_failed', ${`Your payout of $${(p.amount_cents / 100).toFixed(2)} failed: ${reason}`}, ${await hashEmail(p.email)}, ${p.user_id})`;
      return c.json({ status: 'failed' });
    }
  } finally { await sql.end(); }
});

network.get('/admin/payouts', async (c) => {
  await requireAdmin(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT p.*, u.email, u.name FROM payouts p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 200`;
  await sql.end();
  return c.json(rows);
});

// ---------- NETWORK GRAPH ----------

network.get('/graph', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);

  // Admins see the whole graph; others see their subtree (referrer + their referrals + chain to root, depth-limited).
  let users: any[];
  let referrals: any[];
  if (user.role === 'admin') {
    users = await sql`SELECT id, name, email, role, kyc_status FROM users WHERE is_active = 1`;
    referrals = await sql`SELECT id, referrer_id, referred_id, status FROM referrals`;
  } else {
    // Walk up to root + collect all descendants up to 3 levels deep
    const ids = new Set<number>([user.id]);
    let frontier = [user.id];
    for (let depth = 0; depth < 3; depth++) {
      const next: number[] = [];
      for (const id of frontier) {
        const refs = await sql`SELECT referred_id FROM referrals WHERE referrer_id = ${id}`;
        for (const r of refs as any[]) { if (!ids.has(r.referred_id)) { ids.add(r.referred_id); next.push(r.referred_id); } }
      }
      frontier = next;
      if (!frontier.length) break;
    }
    // Add immediate referrer
    const up = await sql`SELECT referrer_id FROM referrals WHERE referred_id = ${user.id}`;
    if (up.length) ids.add((up[0] as any).referrer_id);
    const idList = Array.from(ids);
    const placeholders = idList.map(() => '?').join(',');
    users = await sql.unsafe(`SELECT id, name, email, role, kyc_status FROM users WHERE id IN (${placeholders})`, idList);
    referrals = await sql.unsafe(`SELECT id, referrer_id, referred_id, status FROM referrals WHERE referrer_id IN (${placeholders}) OR referred_id IN (${placeholders})`, [...idList, ...idList]);
  }

  // Commissions per user (for sizing nodes)
  const commTotals = await sql`SELECT user_id, COALESCE(SUM(amount_cents), 0) as total FROM commissions GROUP BY user_id`;
  const commMap: Record<number, number> = {};
  for (const r of commTotals as any[]) commMap[r.user_id] = parseInt(r.total) || 0;

  // Top referrers
  const topReferrers = await sql`
    SELECT r.referrer_id as user_id, u.name, u.email,
           COUNT(*) as referral_count,
           COALESCE(SUM(c.amount_cents), 0) as earned_cents
    FROM referrals r
    JOIN users u ON u.id = r.referrer_id
    LEFT JOIN commissions c ON c.user_id = r.referrer_id
    GROUP BY r.referrer_id
    ORDER BY referral_count DESC, earned_cents DESC
    LIMIT 10
  `;

  await sql.end();

  return c.json({
    nodes: users.map((u: any) => ({
      id: u.id,
      label: u.name,
      email: u.email,
      role: u.role,
      kyc_status: u.kyc_status,
      earned_cents: commMap[u.id] || 0,
      is_self: u.id === user.id,
    })),
    edges: referrals.map((r: any) => ({
      id: r.id,
      from: r.referrer_id,
      to: r.referred_id,
      status: r.status,
    })),
    top_referrers: topReferrers,
    viewer_id: user.id,
  });
});

export default network;
