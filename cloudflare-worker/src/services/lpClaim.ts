/**
 * Claim an LP row for the account that just proved it owns the address.
 *
 * `lpMembershipScope` lets a caller reach a `limited_partners` row by verified
 * account email when `user_id` is NULL — the legacy-LP case funds.ts documents
 * ("migrated from lp_investors"). That arm exists so a real LP is not locked
 * out of their own fiduciary records, but leaving it as the permanent basis of
 * access would be wrong: the grant would stay live forever, so an address that
 * is ever reassigned would carry the LP's commitments and capital calls to
 * whoever holds it next.
 *
 * Claiming closes that. The first time a row is reached by email, its
 * `user_id` is written, and every later access is an account link — auditable,
 * and unaffected by what happens to the mailbox afterwards.
 *
 * Two properties matter more than the write itself:
 *
 *   - It NEVER overwrites a `user_id` that is already set. The UPDATE says
 *     `WHERE user_id IS NULL`, so a race, a shared address, or a stale row
 *     cannot move an LP record from one account to another. Re-pointing an LP
 *     is an administrative act, not a side effect of a GET.
 *   - It is best-effort. A claim that fails must not fail the read the caller
 *     actually asked for; they are entitled to the row either way, and the
 *     next request tries again.
 */
import type { Env } from '../types';

export interface LpClaimResult {
  /** Rows whose user_id this call wrote. 0 is the normal steady state. */
  claimed: number;
}

/**
 * Link every unclaimed LP row matching `email` to `userId`.
 *
 * Scoped to one fund when `fundId` is given — the caller reached a specific
 * fund's row, so claiming only that one keeps the write as narrow as the read
 * that justified it. Omitted for the list surfaces, where the caller is
 * legitimately looking at every LP row they own.
 */
export async function claimLpRowsByEmail(
  env: Env,
  userId: number,
  email: string | null | undefined,
  fundId?: number | null,
): Promise<LpClaimResult> {
  const addr = typeof email === 'string' ? email.trim() : '';
  // No address, no claim. An empty string would match every row with an empty
  // email — the same hole lpMembershipScope drops the email arm to avoid.
  if (!addr || !Number.isInteger(userId) || userId <= 0) return { claimed: 0 };
  try {
    const sql = fundId
      ? `UPDATE limited_partners
            SET user_id = ?
          WHERE user_id IS NULL AND LOWER(email) = LOWER(?) AND fund_id = ?`
      : `UPDATE limited_partners
            SET user_id = ?
          WHERE user_id IS NULL AND LOWER(email) = LOWER(?)`;
    const binds: Array<string | number> = fundId ? [userId, addr, fundId] : [userId, addr];
    const res = await env.DB.prepare(sql).bind(...binds).run();
    const claimed = Number((res as any)?.meta?.changes ?? 0) || 0;
    if (claimed > 0) {
      // Worth a log line: this is the moment an LP record stops being
      // reachable by anyone who later holds the address.
      console.info(`[lpClaim] linked ${claimed} LP row(s) to user ${userId}`);
    }
    return { claimed };
  } catch (e) {
    console.warn('[lpClaim] claim failed', e);
    return { claimed: 0 };
  }
}

/**
 * D5318 H8 — the one claim every sign-in runs.
 *
 * `GET /api/funds` used to claim on every list, so a read wrote. The claim now
 * happens at the moments an address is proven: each route that mints a
 * session for the account's own holder (password + TOTP, the email
 * verification hand-off, magic link, Google, passkey, SMS, account recovery)
 * and the confirmation of an email change. Impersonation and support
 * sessions do NOT call it: the actor there is an operator, and a link written
 * on their session would put the wrong person in the audit trail.
 *
 * It is `claimLpRowsByEmail` with the account's own address, nothing more, so
 * the rules above (never re-point an owned row, never fail the caller) are
 * the same at every door.
 */
export async function claimLpRowsAtSignIn(
  env: Env,
  user: { id: unknown; email?: unknown } | null | undefined,
): Promise<LpClaimResult> {
  if (!user) return { claimed: 0 };
  return claimLpRowsByEmail(env, Number(user.id), typeof user.email === 'string' ? user.email : null);
}

/**
 * D5318 H8 — claim a newly written LP row for the account that already holds
 * its address.
 *
 * The other half of moving the claim off the list: an account signed in on a
 * long session when the GP records it as an LP would otherwise wait for its
 * next sign-in for the link. The row is still reachable by email until then
 * (`lpMembershipScope`'s unclaimed arm), so nobody loses access either way;
 * this just makes the link immediate.
 *
 * Only an account whose address is verified and that is active is linked,
 * and only when exactly one account holds the address, so an operator typo
 * that matches nobody — or an address two rows differ on only by case —
 * links nothing. Best-effort, like every claim.
 */
export async function claimLpRowsForAddress(
  env: Env,
  email: string | null | undefined,
  fundId?: number | null,
): Promise<LpClaimResult> {
  const addr = typeof email === 'string' ? email.trim() : '';
  if (!addr) return { claimed: 0 };
  try {
    const found = await env.DB.prepare(
      `SELECT id, email FROM users
        WHERE LOWER(email) = LOWER(?) AND email_verified = 1 AND is_active = 1
        LIMIT 2`,
    ).bind(addr).all<{ id: number; email: string }>();
    const rows = found?.results || [];
    if (rows.length !== 1) return { claimed: 0 };
    return claimLpRowsByEmail(env, Number(rows[0].id), rows[0].email, fundId);
  } catch (e) {
    console.warn('[lpClaim] claim for address failed', e);
    return { claimed: 0 };
  }
}
