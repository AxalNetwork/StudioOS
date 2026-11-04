/**
 * ensureRoleProfile — backfill founder_id / partner_id on the users
 * row for each licence (D4472 adds investor/advisor profile creation).
 * to their persona-specific profile table.
 *
 * Why this exists:
 *   role is set on the users row at signup (or via the advisor's
 *   role-detector), but the matching `founders` / `partners` row
 *   used to only get created when the user actively wrote to a
 *   persona-specific surface (Projects, the advisor write-router,
 *   etc.). Users who logged in but never opened those pages ended
 *   up with role='founder' AND founder_id=NULL — the state shown in
 *   the Admin Users panel screenshot. That broke any downstream
 *   join keyed on founder_id (project ownership, founder risk
 *   badge, founder-only sharing, …).
 *
 * Behaviour:
 *   - role='founder' & founder_id IS NULL  →  insert into founders
 *     (or pick up an existing row matching email), then UPDATE
 *     users.founder_id.
 *   - role='partner' & partner_id IS NULL  →  same for partners,
 *     with a generated AXAL-XXXXXX(XX) referral_code (matches the
 *     pattern in routes/partners.ts).
 *   - Any other role: no-op.
 *
 * Idempotent: an email-collision on the UNIQUE index falls through
 * to a SELECT that picks up the existing row, so re-running on the
 * same user (e.g. on every /me hit) is safe and cheap.
 *
 * Failure mode: never throws. Returns the original IDs on error so
 * /me / login flows degrade gracefully — the next call self-heals.
 */
import type { Env, User } from '../types';

export interface RoleProfileIds {
  founder_id: number | null;
  partner_id: number | null;
  investor_id?: number | null;
  advisor_id?: number | null;
}

export async function ensureRoleProfile(env: Env, user: User): Promise<RoleProfileIds> {
  const current: RoleProfileIds = {
    founder_id: user.founder_id ?? null,
    partner_id: (user as unknown as { partner_id?: number | null }).partner_id ?? null,
  };

  if (!user.email) return current;

  if (user.role === 'founder' && !current.founder_id) {
    const fid = await ensureFounder(env, user);
    if (fid) current.founder_id = fid;
  } else if (user.role === 'partner' && !current.partner_id) {
    const pid = await ensurePartner(env, user);
    if (pid) current.partner_id = pid;
  }

  if (user.role === 'investor') {
    current.investor_id = await ensureInvestor(env, user);
  } else if (user.role === 'advisor') {
    current.advisor_id = await ensureAdvisor(env, user);
  }
  return current;
}

async function ensureFounder(env: Env, user: User): Promise<number | null> {
  try {
    // Try insert first; if email already exists in `founders` we
    // catch the UNIQUE violation below and fall through to SELECT.
    const ins = await env.DB.prepare(
      `INSERT INTO founders (name, email) VALUES (?, ?) RETURNING id`,
    ).bind(user.name || user.email.split('@')[0] || 'Unknown', user.email).first<{ id: number }>();
    if (ins?.id) {
      await env.DB.prepare(`UPDATE users SET founder_id = ? WHERE id = ?`)
        .bind(ins.id, user.id).run();
      // Task #1 (DB) — assign public AXF-id alongside the FK so legal
      // contracts and the admin profile pane see it immediately.
      try {
        const { assignFounderPublicId } = await import('./publicIds');
        await assignFounderPublicId(env, user.id);
      } catch {}
      return Number(ins.id);
    }
  } catch (_e) {
    // UNIQUE collision — a founders row already exists for this email
    // (e.g. created by a project-creation path before the users row
    // was linked). Fall through to the lookup branch.
  }
  try {
    const existing = await env.DB.prepare(
      `SELECT id FROM founders WHERE email = ? LIMIT 1`,
    ).bind(user.email).first<{ id: number }>();
    if (existing?.id) {
      await env.DB.prepare(`UPDATE users SET founder_id = ? WHERE id = ?`)
        .bind(existing.id, user.id).run();
      try {
        const { assignFounderPublicId } = await import('./publicIds');
        await assignFounderPublicId(env, user.id);
      } catch {}
      return Number(existing.id);
    }
  } catch (e) {
    console.error('[ensureRoleProfile] founder lookup failed:', (e as Error).message);
  }
  return null;
}

async function ensurePartner(env: Env, user: User): Promise<number | null> {
  // Task #4 (DH) — Short-form Crockford base32 referral code. Legacy
  // AXAL-XXXXXX(XX) rows in the partners table continue to resolve via
  // services/referrals/resolveCode.ts.
  const { generateShortReferralCode } = await import('./referrals/codes');
  const refCode = generateShortReferralCode();
  try {
    const ins = await env.DB.prepare(
      `INSERT INTO partners (name, email, referral_code) VALUES (?, ?, ?) RETURNING id`,
    ).bind(user.name || user.email.split('@')[0] || 'Unknown', user.email, refCode).first<{ id: number }>();
    if (ins?.id) {
      await env.DB.prepare(`UPDATE users SET partner_id = ? WHERE id = ?`)
        .bind(ins.id, user.id).run();
      try {
        const { assignPartnerPublicId } = await import('./publicIds');
        await assignPartnerPublicId(env, user.id);
      } catch {}
      return Number(ins.id);
    }
  } catch (_e) {
    // UNIQUE collision on partners.email — fall through to lookup.
  }
  try {
    const existing = await env.DB.prepare(
      `SELECT id FROM partners WHERE email = ? LIMIT 1`,
    ).bind(user.email).first<{ id: number }>();
    if (existing?.id) {
      await env.DB.prepare(`UPDATE users SET partner_id = ? WHERE id = ?`)
        .bind(existing.id, user.id).run();
      try {
        const { assignPartnerPublicId } = await import('./publicIds');
        await assignPartnerPublicId(env, user.id);
      } catch {}
      return Number(existing.id);
    }
  } catch (e) {
    console.error('[ensureRoleProfile] partner lookup failed:', (e as Error).message);
  }
  return null;
}

/** D4472: create both investor stores, linked by user_id, without resetting a saved profile. */
async function ensureInvestor(env: Env, user: User): Promise<number | null> {
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO investors (uid, user_id)
        SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM investors WHERE user_id = ?)`)
        .bind(crypto.randomUUID(), user.id, user.id),
      env.DB.prepare('INSERT OR IGNORE INTO investor_profiles (user_id) VALUES (?)').bind(user.id),
    ]);
    const row = await env.DB.prepare('SELECT id FROM investors WHERE user_id = ? ORDER BY id LIMIT 1')
      .bind(user.id).first<{ id: number }>();
    if (row) await env.DB.prepare('UPDATE users SET investor_id = ? WHERE id = ?').bind(row.id, user.id).run();
    return row?.id ?? null;
  } catch (error) { console.error('[ensureRoleProfile] investor profile failed', error); return user.investor_id ?? null; }
}

/** D4472: Advisors are keyed by user_id; a retry preserves their recorded profile. */
async function ensureAdvisor(env: Env, user: User): Promise<number | null> {
  try {
    await env.DB.prepare(`INSERT INTO advisors (uid, user_id, display_name, email)
      VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING`)
      .bind(crypto.randomUUID(), user.id, user.name || user.email.split('@')[0], user.email).run();
    const row = await env.DB.prepare('SELECT id FROM advisors WHERE user_id = ?').bind(user.id).first<{ id: number }>();
    if (row) await env.DB.prepare('UPDATE users SET advisor_id = ? WHERE id = ?').bind(row.id, user.id).run();
    return row?.id ?? null;
  } catch (error) { console.error('[ensureRoleProfile] advisor profile failed', error); return user.advisor_id ?? null; }
}
