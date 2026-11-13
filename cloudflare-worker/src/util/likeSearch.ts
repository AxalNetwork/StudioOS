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
 * `col LIKE ? ESCAPE '\'` beside its bind.
 */

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
  const needle = String(raw ?? '').trim();
  if (needle.length < minLength) return null;
  return `%${needle.replace(/[%_]/g, (m) => `\\${m}`)}%`;
}

/** The same, lower-cased, for the two directory searches that compare `lower(col)`. */
export function likeNeedleLower(raw: unknown, minLength = 2): string | null {
  const like = likeNeedle(raw, minLength);
  return like === null ? null : like.toLowerCase();
}
