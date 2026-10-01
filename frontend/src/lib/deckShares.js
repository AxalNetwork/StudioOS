/**
 * What state a deck share link is in — one rule, read by both pages that show one.
 *
 * WHY THIS IS NOT INLINE IN THE PANEL. Two surfaces render share links: the deck
 * builder's Engagement panel, which can now withdraw one (Task #196), and founder
 * Raise · Pitch, which is deliberately read-only and says so on the page. Both
 * have to agree on what "active" means, and the reason they must is the withdraw
 * control: withdrawing sets `expires_at` as well as `revoked_at`, so a page still
 * computing state the old way — `exhausted ? 'gone' : 'active'` — would call a
 * link the founder had just ended "active". One page fixed and one not is worse
 * than neither, because the founder would have two answers and no way to tell
 * which is current. The lib README's own rule: if a helper appears in two places,
 * it lives here once.
 *
 * THE SERVER IS THE AUTHORITY AND THIS MIRRORS IT, deliberately narrowly. The
 * claim query in `routes/decks.ts` refuses a link on exactly three predicates —
 * `view_count < view_limit`, `expires_at > datetime('now')`, `revoked_at IS NULL`
 * — and the three dead states below are those three, one each. Nothing here
 * decides whether a link works; it decides what to tell the founder about a
 * decision the server already made.
 */

/**
 * A D1 timestamp as a strict ISO-8601 instant, or `''`.
 *
 * TWO SEPARATE THINGS GO WRONG WITHOUT THIS, and they are why the normalisation
 * is a named function rather than an expression inside the parse below.
 *
 * The ZONE. `expires_at` is stored as `datetime('now')` gives it —
 * `'YYYY-MM-DD HH:MM:SS'`, no zone — and `Date.parse` on that reads it as LOCAL.
 * A founder in UTC+2 would see a link with two hours left reported as expired;
 * one in UTC-5 would see an expired link as live for five more hours. The second
 * is the dangerous direction: it tells them a dead link is live, which is the
 * state they opened the panel to check.
 *
 * The SEPARATOR. `Date.parse` is only specified for the ISO-8601 grammar, which
 * requires the `T`; anything else is implementation-defined. V8 happens to accept
 * `'2026-09-13 12:00:00Z'` through its legacy fallback parser and read it as UTC,
 * so in Node and Chrome the swap looks optional — and no `Date.parse` assertion
 * run under Node can show otherwise, because Node has only V8. Safari's fallback
 * is not V8's. So the swap is asserted on the STRING THIS RETURNS, which is a
 * claim about the value rather than about one engine's tolerance of it.
 */
export function toIsoUtc(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const dated = raw.includes('T') ? raw : raw.replace(' ', 'T');
  return dated.endsWith('Z') ? dated : `${dated}Z`;
}

/** That instant in epoch milliseconds, or NaN. */
export function parseSqlUtc(value) {
  const iso = toIsoUtc(value);
  return iso ? Date.parse(iso) : NaN;
}

/**
 * The state of one `shares[]` row from `GET /api/decks/:id/engagement`.
 *
 * ORDER IS THE POINT. A link can be revoked AND exhausted AND expired at once,
 * and what the founder needs is WHO ended it — so `revoked` wins over both ways
 * it could have run out on its own. `live` is last because it is the only state
 * that is an absence of reasons rather than a reason.
 *
 * `now` is injectable so a test can assert the expiry boundary without waiting
 * for one.
 */
export function deckShareState(share, now = Date.now()) {
  if (share?.revoked_at) {
    return { key: 'revoked', label: 'withdrawn', live: false };
  }
  if (share?.exhausted) {
    return { key: 'exhausted', label: 'gone', live: false };
  }
  const at = parseSqlUtc(share?.expires_at);
  if (Number.isFinite(at) && at <= now) {
    return { key: 'expired', label: 'expired', live: false };
  }
  return { key: 'live', label: 'active', live: true };
}
