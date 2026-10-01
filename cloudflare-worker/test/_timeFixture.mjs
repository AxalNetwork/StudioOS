/**
 * Fixtures for the timestamp-comparison tests (D124, D125).
 *
 * WHY THIS FILE EXISTS. `_baseline.mjs` already covers reading a table's DDL
 * out of the baseline, and its own header says it was written because three
 * files carried a byte-identical regex. `expiry_gate_datetime_d124.test.ts`
 * then made it a fourth by rolling its own slicer — so the two helpers BELOW
 * get one home before D125 makes it a fifth. Same rule, one layer along:
 * `frontend/src/lib/README.md` — "if a helper appears in two places, put it
 * here once rather than a third time."
 */
import assert from 'node:assert/strict';

/**
 * The template literal containing `anchor`, taken out of a source file, so a
 * test runs the REAL SQL rather than a retyped copy of it. A copy only ever
 * proves the copy is right.
 *
 * THE ANCHOR MUST BE UNIQUE, and that is enforced rather than assumed. D124's
 * first draft anchored the NDA sweep on `UPDATE pairwise_ndas`, which appears
 * TWICE in `trust.ts`, and the obligation sweep on `UPDATE legal_obligations`,
 * which appears NINE times. `indexOf` returned the first — a different
 * statement in both cases — so the tests ran against SQL they were not about.
 * One failed for the wrong reason; the near miss is that it could as easily
 * have PASSED. Both misses, absent and ambiguous, are hard failures here.
 */
export function sqlAround(source, anchor, label = 'source') {
  const s = String(source);
  const hits = s.split(anchor).length - 1;
  assert.ok(hits > 0, `${label}: "${anchor}" not found — this test is aimed at code that moved`);
  assert.equal(hits, 1, `${label}: "${anchor}" matches ${hits} places — pick an anchor that names one statement`);
  const at = s.indexOf(anchor);

  // THE ANCHOR MUST OPEN THE STRING, and that is a contract rather than a
  // convenience. Two drafts tried to infer the delimiter from a mid-statement
  // anchor and both produced garbage instead of refusing:
  //   - assuming a backtick ran to unrelated backticks far above and below,
  //     because `routes/assistant.ts` keeps its SQL in a DOUBLE-quoted string;
  //   - taking the nearest quote of any kind then landed on the `'` inside
  //     `datetime('now')` when that appeared BEFORE the anchor, which even
  //     survived an "and the slice contains the anchor" check.
  // Naming a statement by its first words removes the guess: the quote
  // immediately before them is the one that opened it, full stop.
  const quote = s[at - 1];
  assert.ok(
    quote === '`' || quote === "'" || quote === '"',
    `${label}: "${anchor}" must be the FIRST thing inside its quoted string — anchor on the statement's opening words`,
  );
  const close = s.indexOf(quote, at);
  assert.ok(close > at, `${label}: the string holding "${anchor}" is not terminated`);
  return s.slice(at, close);
}

/**
 * A timestamp in the past, written the ISO way every broken writer writes it,
 * and pinned to TODAY'S UTC DATE.
 *
 * THE DATE HALF IS THE WHOLE POINT. The defect is that `'T'` (0x54) sorts
 * above `' '` (0x20) at position 10, which only decides the comparison while
 * the date halves MATCH. A relative fixture — "a minute ago" — run at 00:00:30
 * UTC lands on yesterday's date, where the broken predicate is accidentally
 * right, so the test would pass against unfixed code for one minute a day.
 * Midnight-today is always in the past and always on today's date.
 */
export function expiredIso(db) {
  const row = db.prepare("SELECT date('now') AS day").get();
  return `${row.day}T00:00:00.000Z`;
}

/** Unambiguously in the future under any comparison, in the same ISO shape. */
export const LIVE_ISO = '2099-01-01T00:00:00.000Z';
