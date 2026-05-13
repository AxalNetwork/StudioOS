import type { Env } from '../../types';

// Normalises a user-supplied referral code into the canonical short form
// used for storage + lookup:
//   - upper-cases
//   - trims whitespace
//   - strips a single leading "AXAL-" / "AXAL_" / "AXAL" prefix
// The result is whatever's left (1-32 chars). Callers should treat an
// empty string as "no code provided".
export function normaliseReferralCode(input: string | null | undefined): string {
  if (!input) return '';
  let v = String(input).trim().toUpperCase();
  // Tolerate older URLs that may have used "AXAL_" or just "AXAL" as
  // the prefix (we've never shipped those, but being permissive here
  // costs nothing and protects us if a marketer hand-types one).
  v = v.replace(/^AXAL[-_]?/, '');
  return v.replace(/[^A-Z0-9]/g, '');
}

// Returns the user_id of the referrer who owns `rawCode`, checking:
//   1. The new short form column (`users.referral_code`).
//   2. The legacy form column (`users.legacy_referral_code`) — populated
//      by migration 051 with the original `AXAL-XXXXXXXX` strings.
//   3. As a final defence, the original AXAL-prefixed string against
//      `users.referral_code` (in case a stale environment hasn't been
//      migrated yet — keeps existing in-flight invites working).
// Returns null when no match is found OR when both columns are missing
// from a very stale dev DB (the caller should treat this as "unknown
// referrer", not as an error).
export async function resolveReferralCode(env: Env, rawCode: string | null | undefined): Promise<number | null> {
  const short = normaliseReferralCode(rawCode);
  if (!short) return null;
  const original = String(rawCode || '').trim().toUpperCase();
  // Combined lookup — single round-trip. The OR-against-legacy_referral_code
  // branch is wrapped in a try/catch so a missing column (pre-migration
  // 051 dev DB) falls back to the short-only path rather than 500-ing.
  try {
    const row = await env.DB
      .prepare(
        `SELECT id FROM users
          WHERE referral_code = ?
             OR referral_code = ?
             OR legacy_referral_code = ?
          LIMIT 1`,
      )
      .bind(short, original, original)
      .first<{ id: number }>();
    if (row?.id) return Number(row.id);
    return null;
  } catch {
    // Fallback: legacy_referral_code column not present yet.
    const row = await env.DB
      .prepare(`SELECT id FROM users WHERE referral_code = ? OR referral_code = ? LIMIT 1`)
      .bind(short, original)
      .first<{ id: number }>();
    return row?.id ? Number(row.id) : null;
  }
}
