/**
 * One escaper for every `LIKE` search in the worker (D128).
 *
 * WHY THIS EXISTS, and it is not the new caller's fault. The same four lines
 * were already written THREE TIMES, byte for byte:
 *
 *   · `rpc/branchOps.ts`        — a branch searching its own accounts
 *   · `routes/admin_partners.ts` — the partner directory console
 *   · `routes/public.ts`         — the public partner directory
 *
 * `/api/admin/users` gaining a search would have made it a fourth copy, which
 * is exactly what `frontend/src/lib/README.md` states the rule against — "if a
 * helper appears in two places, put it here once rather than a third time" —
 * and what D117 enforced on the other side of the tree.
 *
 * AND ONE IMPLEMENTATION IS WHAT MAKES IT TESTABLE. D108's finding on this
 * repo was that the escaping assertion could not fail: it was written against
 * one site, and the other two were free to differ without anything noticing.
 * A caller cannot get the escaping wrong if it does not do the escaping.
 *
 * WHAT `ESCAPE '\'` IS FOR. `%` and `_` are SQLite's wildcards, so a member
 * searching for the literal string `a_b` would otherwise match `aXb` — and a
 * search for `%` would match every row in the table. The escape character has
 * to be declared on the predicate, so every caller writes
 * `col LIKE ? ESCAPE '\'` beside its bind. The backslash is escaped too
 * (D9167): without it a search for `a\` bound `%a\%`, which reads as "a, then
 * a literal percent".
 *
 * AND EVERY PATTERN FITS IN 50 BYTES (D9167, #9167). D1 refuses a `LIKE`
 * pattern longer than 50 bytes with `LIKE or GLOB pattern too complex` (the
 * engine's SQLITE_LIMIT_LIKE_PATTERN_LENGTH; a local D1 answers 50 bytes and
 * refuses 51), and it does so only once a row is compared, so the search
 * answered 500 on a busy table and 200 on an empty one. That is 48 ASCII
 * characters inside `%…%`, about 16 CJK characters, 12 emoji. The helper
 * trims the term at a whole character (a code point, never half a UTF-8
 * sequence or a surrogate pair, never between an escape and the character
 * it escapes) so the WHOLE pattern, wildcards and escape characters
 * included, is at most `LIKE_PATTERN_MAX_BYTES`. A trimmed search still
 * answers: it matches every row the full term would, and possibly more.
 *
 * Every user-typed search under `routes/` and `services/` builds its pattern
 * here. `scripts/check-like-patterns.mjs` fails on a raw `%${…}%` bind, a
 * `'%' || ? || '%'` built in SQL, and a local copy of the escaper.
 */

/** D1's limit on a LIKE pattern, in UTF-8 bytes. */
export const LIKE_PATTERN_MAX_BYTES = 50;

/** The UTF-8 length of one code point; a lone surrogate travels as U+FFFD, 3 bytes. */
const utf8Bytes = (cp: number) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

/**
 * `needle` escaped for `ESCAPE '\'` and cut at a whole character so it takes
 * at most `budget` bytes. An escaped character and its backslash are one piece.
 */
export function likeEscapeCapped(needle: string, budget: number): string {
  let out = '';
  let used = 0;
  for (const ch of needle) {
    const escaped = ch === '\\' || ch === '%' || ch === '_';
    const bytes = (escaped ? 1 : 0) + utf8Bytes(ch.codePointAt(0)!);
    if (used + bytes > budget) break;
    out += escaped ? `\\${ch}` : ch;
    used += bytes;
  }
  return out;
}

function pattern(raw: unknown, minLength: number, lower: boolean, lead: '%' | ''): string | null {
  let needle = String(raw ?? '').trim();
  if (lower) needle = needle.toLowerCase();
  if (needle.length < minLength) return null;
  return `${lead}${likeEscapeCapped(needle, LIKE_PATTERN_MAX_BYTES - lead.length - 1)}%`;
}

/**
 * The bound value for a `LIKE ? ESCAPE '\'` predicate, or `null` when the
 * needle is too short to search on.
 *
 * `null` RATHER THAN AN EMPTY PATTERN, deliberately. `%%` matches every row,
 * so a one-character query that fell through would return the whole table
 * dressed as a result set — the caller must branch on the refusal rather than
 * pass it along. Returning a value that means "everything" for an input that
 * means "not enough to go on" is how a search silently becomes a list.
 */
export function likeNeedle(raw: unknown, minLength = 2): string | null {
  return pattern(raw, minLength, false, '%');
}

/** The same, lower-cased before it is measured, for searches that compare `lower(col)`. */
export function likeNeedleLower(raw: unknown, minLength = 2): string | null {
  return pattern(raw, minLength, true, '%');
}

/** A "starts with" pattern, `term%`, escaped and capped the same way. */
export function likePrefix(raw: unknown, minLength = 1): string | null {
  return pattern(raw, minLength, false, '');
}

/** The same, lower-cased before it is measured. */
export function likePrefixLower(raw: unknown, minLength = 1): string | null {
  return pattern(raw, minLength, true, '');
}

/**
 * A lower-cased "contains" pattern for a value that identifies someone (an
 * email matched against a stored field), or `null` when the whole value does
 * not fit in 50 bytes. Trimming is right for a search, which may broaden; it
 * is wrong here, where the broader match can be another person's row.
 */
export function likeNeedleWhole(raw: unknown, minLength = 1): string | null {
  const like = likeNeedleLower(raw, minLength);
  if (like === null) return null;
  const whole = `%${likeEscapeCapped(String(raw ?? '').trim().toLowerCase(), Infinity)}%`;
  return like === whole ? like : null;
}
