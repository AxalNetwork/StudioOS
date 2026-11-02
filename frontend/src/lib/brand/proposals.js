/**
 * D1324 (#3485): what Eadwyn's Ask (once "Auto-fill with AI", #4046 B3) proposed on the founder's
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

/**
 * #4046 B3: the standard Ask's rule on the brand page. Ask places a value only
 * where the field is open: blank, still the page's own default, or still what
 * Ask placed there last time. A founder's own words are never overwritten.
 */
export const OPEN_DEFAULTS = Object.freeze({ cta_text: 'Join the waitlist' });

export function placeAsk(draft, answer, previous = {}) {
  const out = {};
  for (const f of PROPOSED_FIELDS) {
    const v = answer?.[f];
    if (typeof v !== 'string' || !v.trim()) continue;
    const cur = String(draft?.[f] ?? '').trim();
    const last = previous?.[f] != null ? String(previous[f]).trim() : null;
    if (!cur || cur === OPEN_DEFAULTS[f] || (last && cur === last)) out[f] = v.trim();
  }
  return out;
}

/**
 * #4046 B3: a template's sections under the same rule. A section the founder
 * changed from the template's default keeps their words; a blank one, or one
 * still at its default, takes what Ask wrote.
 */
export function placeAskContent(existing = {}, defaults = {}, written = {}) {
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const blank = (v) => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
  const out = { ...defaults, ...existing };
  for (const [k, v] of Object.entries(written || {})) {
    if (blank(existing?.[k]) || same(existing?.[k], defaults?.[k])) out[k] = v;
  }
  return out;
}
