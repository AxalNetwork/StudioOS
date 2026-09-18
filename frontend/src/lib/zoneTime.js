/**
 * An instant rendered in the zone it is ENFORCED in, with that zone named.
 *
 * WHY THIS IS IN `lib/` AND NOT ON A PAGE. It was written in `BranchHome.jsx`
 * for S1's week deadline (D131) and S4's cohort calendar is its second caller.
 * Importing one page's export from another page is worse than lifting it, and
 * `lib/README.md` already states the rule: *"If a helper appears in two places,
 * put it here once rather than a third time."* D127 one `GROUP BY role`, D128
 * one LIKE escaper, D130 one definition of open, D131 one count, D138 one
 * definition of what freezes, D140 one zone formatter.
 *
 * THE ZONE IS A REQUIRED ARGUMENT RATHER THAN A DEFAULT, and that is the whole
 * point of the helper. The Spin-Out Lab programme runs on America/New_York
 * wall-clock time for every territory, and a branch admin reads the screen
 * somewhere else — so a formatter that silently fell back to the reader's zone
 * would produce exactly the wrong hour it exists to prevent. "Closes 23 Sep
 * 00:00" with no zone is six hours out for a French admin deciding whether
 * their founders still have tonight.
 *
 * It is deliberately NOT merged with `lib/spinoutLab.js`'s date helpers, which
 * bake `COHORT_TZ` in: those format a programme date for a founder who is ON
 * the programme clock, this one formats an instant for a reader who is not and
 * must be told which clock it is. Two behaviours, and D117's `money` lesson is
 * that two behaviours under one name is the trap, not the saving.
 */

/**
 * @param {string|null|undefined} iso  an ISO instant
 * @param {string|null|undefined} zone an IANA zone — REQUIRED; no default
 * @returns {string|null} `"23 Sep, 00:00"` in that zone, or null when either
 *   argument is missing or the instant cannot be parsed. Null is what lets a
 *   caller print its own reason rather than a plausible wrong time.
 */
export function inZone(iso, zone) {
  if (!iso || !zone) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(ms));
  } catch {
    return null;
  }
}

/**
 * The same instant as a DATE alone, in the zone it is enforced in.
 *
 * A cycle's `start_at`/`end_at` are month boundaries — printing "00:00" beside
 * them says a precision the value does not carry and invites the reader to
 * wonder whose midnight it is. A deadline is an instant and keeps its time.
 */
export function dateInZone(iso, zone) {
  if (!iso || !zone) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, day: 'numeric', month: 'short', year: 'numeric',
    }).format(new Date(ms));
  } catch {
    return null;
  }
}
