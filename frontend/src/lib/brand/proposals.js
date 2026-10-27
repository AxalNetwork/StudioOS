/**
 * D1324 (#3485): what Eadwyn's "Auto-fill with AI" proposed on the founder's
 * brand page, and which of it the founder kept, so the Save can record
 * provenance (`ai_proposals`, read by `PUT /api/brand/landing/by-project/:pid`
 * through `recordCompositionFills`).
 *
 * Only the page's own columns are tracked: the template's sections live in one
 * `content_json` column, which a per-field provenance row cannot name.
 *
 * A field the founder changed is theirs: it is sent with no proposal, so the
 * Save records no Eadwyn row for it and the page does not call it Eadwyn's.
 */

export const PROPOSED_FIELDS = Object.freeze(['name', 'headline', 'subheadline', 'tagline', 'cta_text']);

/**
 * The autofill's answer, as `{ field: proposed text }` for the fields it filled.
 * A heuristic answer (`ai_generated` not true) is not something Eadwyn wrote,
 * so it proposes nothing.
 */
export function proposalsFrom(answer) {
  const out = {};
  if (answer?.ai_generated !== true) return out;
  for (const f of PROPOSED_FIELDS) {
    const v = answer?.[f];
    if (typeof v === 'string' && v.trim()) out[f] = v.trim();
  }
  return out;
}

/** The proposals the draft still holds word for word: the ones the Save records. */
export function keptProposals(draft, proposed) {
  const out = {};
  for (const [f, v] of Object.entries(proposed || {})) {
    if (!PROPOSED_FIELDS.includes(f)) continue;
    if (String(draft?.[f] ?? '').trim() === String(v).trim() && String(v).trim()) out[f] = v;
  }
  return out;
}
