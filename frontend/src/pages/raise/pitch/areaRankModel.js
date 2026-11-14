/**
 * D1525 (#3783, pd15) — the "Ranked n of m" line under each variant of an
 * area, and which areas can be ranked. Pure, so a test reads it without a
 * screen.
 *
 *   rankGroups   the areas with two or three variants, by their proposal:
 *                how many variants (`of`) and the key of the last, where the
 *                one Rank control sits.
 *   rankedOf     a variant's line: "Ranked 1 of 3" once the judge ranked it,
 *                "Not ranked of 3" when it sent no probability for it, and a
 *                greyed "Ranked — of 3" until then. Never a guessed rank.
 */

/** The areas a judge can rank: two or three variants of one proposal with something to place (a failed one is not ranked). */
export function rankGroups(results) {
  const out = {};
  for (const r of results || []) {
    if (!r?.proposalUid || !Number.isInteger(r.variant) || r.status !== 'proposed') continue;
    const g = out[r.proposalUid] || (out[r.proposalUid] = { of: 0, lastKey: null });
    g.of += 1;
    g.lastKey = r.key;
  }
  for (const [uid, g] of Object.entries(out)) if (g.of < 2 || g.of > 3) delete out[uid];
  return out;
}

/** One variant's line from its area's ranking state. */
export function rankedOf(rank, n, of) {
  const value = rank?.step === 'ranked' ? rank.value : null;
  if (!value || !Array.isArray(value.ranking)) return { ranked: false, text: `Ranked — of ${of}` };
  const row = value.ranking.find((x) => x.n === n);
  if (!row) return { ranked: false, text: `Not ranked of ${value.of ?? of}` };
  return { ranked: row.rank != null, text: row.line || (row.rank != null ? `Ranked ${row.rank} of ${value.of}` : `Not ranked of ${value.of}`) };
}
