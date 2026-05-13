/**
 * ensureRoleProfile — backfill founder_id / partner_id on the users
 * row whenever a user with role=founder|partner is missing the FK
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
 *     with a generated AXAL-XXXXXXXX referral_code (matches the
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
  // AXAL-XXXXXXXX rows in the partners table continue to resolve via
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
