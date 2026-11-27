/*
 * Which fit rules a signal chip shows — ONE answer for every surface on
 * Offers · Audience fit (#4696).
 *
 * THE CHIP NARROWED THE EDITABLE LIST AND THE EXPORT AND LEFT THE PRINCIPAL
 * PROFILE TABLE ALONE, so `Weak` showed one profile in the list below and the
 * whole library in the table above, and the exported file matched neither.
 *
 * A SIGNAL SELECTS OVER PROFILES. Only a `best_fit` rule carries a signal (the
 * worker refuses one on an exclusion), so a chip that returned a declined
 * sector under `Weak` would answer a different question from the one it asks.
 * Under a signal, the table, the editable list and the export are therefore the
 * same rows. Under `all` the table is the profile slice of the library and the
 * list and the export are the whole library, which the page says in words.
 *
 * Whole-library figures (the strip's tiles, the "who we are not for" card) are
 * computed from `items` by the page and are labelled as such; they never read
 * this function's output.
 */
export const FIT_SIGNALS = ['best_fit', 'qualified', 'weak_intent'];

export function fitView(items, view) {
  const all = Array.isArray(items) ? items : [];
  const profiles = all.filter((r) => r.kind === 'best_fit');
  const narrowed = FIT_SIGNALS.includes(view);
  const shown = narrowed ? profiles.filter((r) => r.signal === view) : null;
  return {
    narrowed,
    // The principal profile table.
    profileRows: shown ?? profiles,
    // The editable list.
    ruleRows: shown ?? all,
    // The export file.
    exportRows: shown ?? all,
    profiles,
    total: all.length,
  };
}
