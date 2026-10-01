/**
 * Basis points, as a percentage a person reads (D149).
 *
 * WHY MONEY RATES ARE BASIS POINTS AND NOT FLOATS. `territory_licences` stores
 * `revenue_share_bps` and `token_split_bps` as integers (migration 187), and
 * `subsidiary_statements` copies the bps onto every statement row it draws,
 * because a revenue share of 35% is exactly 3500 and is not exactly 0.35. This
 * module is the ONE place that fraction is computed, which is the point: a
 * second copy is a second rounding rule.
 *
 * WHY IT EXISTS AT ALL — it was already written **six** times, and three of the
 * six had drifted into a different format:
 *
 *   `pages/admin/AdminLicences.jsx`      as `pct`,     absent → null
 *   `pages/subsidiary/MyLicencePage.jsx` as `fmtBps`,  absent → 'Not recorded'
 *   `pages/NeedsBoardPage.jsx`           inline, on a tax rate
 *   `pages/CompanySettingsPage.jsx`      inline, on a carry — **no trim**, so
 *                                        150 bps read "1.50%"
 *   `pages/IntroductionsPanel.jsx`       as `feePct` — `toFixed(bps % 100 ? 2
 *                                        : 0)`, a second trim rule, so 3550
 *                                        read "35.50%" where the others read
 *                                        "35.5%"
 *   `pages/NetworkEffectsPage.jsx`       inline, on a compounding multiplier —
 *                                        `toFixed(0)`, which ROUNDS a rate:
 *                                        150 bps would read "2%". Latent only:
 *                                        `COMPOUNDING_BPS` is [10000, 5000,
 *                                        2500], all whole percents, so nothing
 *                                        is misreported today
 *
 * THE FILED COUNT WAS THREE AND THE MEASURED COUNT IS SIX, because the first
 * count grepped the one body the first three shared. The other three divide by
 * the same 100 and format it differently, which is exactly how a helper comes
 * to exist six times: nobody is looking for a function they would have to name
 * to find.
 *
 * `lib/README.md` states the rule this follows: *"If a helper appears in two
 * places, put it here once rather than a third time."* D127 one `GROUP BY
 * role`, D128 one LIKE escaper, D130 one definition of open, D131 one count,
 * D138 one definition of what freezes, D140 one zone formatter, D142 one freeze
 * list, D144 one notification row, and this is the ninth.
 *
 * IT RETURNS `null` FOR AN ABSENT VALUE AND NEVER A SENTENCE, which is the
 * split D117 made for the same reason one layer down. The call sites disagree
 * about what absence should read as — `null` so a caller can render
 * `<Unrecorded/>`, or the literal `'Not recorded'` — and folding either into
 * this function would flatten copy somebody chose. **A fallback is a
 * human-written sentence; this does the arithmetic.**
 *
 * THE TRAILING-ZERO TRIM IS PART OF THE FORMAT, not a nicety: 3500 reads "35%"
 * rather than "35.00%", and 3550 reads "35.5%". WHAT THAT COSTS, SAID RATHER
 * THAN GLOSSED: the first three call sites already trimmed, so for them this is
 * a move that changes no rendered string. The other three did not, so on a
 * FRACTIONAL rate two strings change — a carry of 150 bps reads "1.5%" where
 * the toast said "1.50%", and a referral fee of 3550 reads "35.5%" where the
 * panel said "35.50%". Whole percents are unchanged everywhere, which is every
 * value `COMPOUNDING_BPS` holds. Six surfaces now round a rate one way.
 */

const format = (n) => `${(n / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

/**
 * @param {number|null|undefined} bps basis points, e.g. 3500
 * @returns {string|null} e.g. "35%", or null when there is no value to format
 */
export function bpsPercent(bps) {
  // ONLY A NUMBER OR A NUMERIC STRING FORMATS, AND THE TYPE TEST IS THE GUARD —
  // not a list of values to reject. `Number` coerces far more than it looks
  // like it does: `Number('')`, `Number('  ')` and `Number([])` are all **0**,
  // and all three are finite, so a bare `Number.isFinite` check turns a value
  // nobody recorded into **"0%"** — which on a revenue share is the statement
  // that a branch owes nothing, and on a fee that none is due. That is the one
  // wrong number this function can produce, and it is the trap D141 hit on a
  // cycle's year. **None of the six call sites this replaces guarded it**, so
  // this is a correction and not only a move. The first draft of it guarded the
  // empty string by name and `[]` walked straight through — which is why the
  // rule is now the type and not the value.
  if (typeof bps === 'number') return Number.isFinite(bps) ? format(bps) : null;
  if (typeof bps !== 'string' || bps.trim() === '') return null;
  const n = Number(bps);
  return Number.isFinite(n) ? format(n) : null;
}
