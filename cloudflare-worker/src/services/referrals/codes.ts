import type { Env } from '../../types';

// Crockford base32 alphabet (excludes I, L, O, U to avoid visual / homophone
// ambiguity). 32^6 = ~1.07B values, plenty for collision resistance at our
// scale.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateShortReferralCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

// Generates a referral code that is unique against both the new
// `users.referral_code` column and the legacy `users.legacy_referral_code`
// column (if present). Retries on collision; throws after `maxAttempts`.
export async function generateUniqueShortReferralCode(env: Env, maxAttempts = 8): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const code = generateShortReferralCode();
    let conflict: { id: number } | null = null;
    try {
      conflict = await env.DB
        .prepare(
          `SELECT id FROM users
            WHERE referral_code = ?
               OR legacy_referral_code = ?
            LIMIT 1`,
        )
        .bind(code, code)
        .first<{ id: number }>();
    } catch {
      // legacy_referral_code may not exist yet on the oldest dev DBs;
      // fall back to the new column only.
      conflict = await env.DB
        .prepare(`SELECT id FROM users WHERE referral_code = ? LIMIT 1`)
        .bind(code)
        .first<{ id: number }>();
    }
    if (!conflict) return code;
  }
  throw new Error('Unable to generate unique short referral code');
}
