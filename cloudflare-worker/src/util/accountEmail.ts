// D9043 (#9043) — the one form an email address takes on `users.email`: trimmed and lowercased.
// Every write of `users.email` (an account created, an address changed) stores this form, and every
// lookup of an account by address matches it as `LOWER(email) = ${normalizeEmail(x)}` ordered by id, so
// one mailbox maps to one account. `cloudflare-worker/test/account_email_9043.test.ts` fails on an
// `INSERT INTO users` or `UPDATE users SET email` that does not pass its address through this helper.

/** Normalize an email for matching/storage: trim + lowercase. */
export function normalizeEmail(email: string | null | undefined): string {
  return String(email || '').trim().toLowerCase();
}
