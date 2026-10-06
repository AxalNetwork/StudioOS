/**
 * D602 (#1006) — the archetype card page v2, the data half. Pure functions
 * over what the Worker sends; no fetch, no React. The page's new sections
 * (the two-layer skills radar, the evolution timeline and the
 * published-member matches) wait on a design canvas (#1006, needs-design),
 * so these shapes are what that build will draw.
 *
 * THE ASSESSMENT FALLBACK IS RETIRED (PROFILING_V2.md decision a). The card
 * reads Eadwyn's conversational archetype only; a person with no
 * conversational signal sees the empty state, never a gamified-assessment
 * result standing in for it.
 */
import { ARCHETYPES } from './assessmentMeta.js';

/** The archetype the card shows, from `GET /best-fit/me` only, or null. */
export function cardArchetype(fit) {
  const a = fit?.archetype;
  if (!a || typeof a.slug !== 'string' || !a.slug) return null;
  return { slug: a.slug, label: a.label ?? null, confidence: a.confidence ?? null };
}

/**
 * The slugs of the archetypes `slug` matches with: its copy's "Who you match
 * with" labels, each turned back into the slug that carries that label. A
 * label no archetype carries is dropped, never guessed.
 */
export function matchSlugs(slug) {
  const meta = ARCHETYPES[slug];
  if (!meta) return [];
  const byLabel = new Map(Object.entries(ARCHETYPES).map(([s, m]) => [m.label, s]));
  const labels = (meta.matching || []).map((m) => m.label);
  return [...new Set(labels.map((l) => byLabel.get(l)).filter(Boolean))];
}

/**
 * The published members grouped under the match they answer, in the copy's
 * order. A match nobody has published reads `members: []`, which the page
 * draws as the archetype type alone (decision c: types always, members only
 * when published).
 */
export function matchGroups(slug, reply) {
  const meta = ARCHETYPES[slug];
  if (!meta) return [];
  const members = Array.isArray(reply?.items) ? reply.items : [];
  const byLabel = new Map(Object.entries(ARCHETYPES).map(([s, m]) => [m.label, s]));
  return (meta.matching || []).map((m) => {
    const s = byLabel.get(m.label) ?? null;
    return { label: m.label, why: m.why, slug: s, members: s ? members.filter((x) => x.slug === s) : [] };
  });
}

/**
 * The two layers of each radar axis, from `GET /skills/me/evidence`. Self is
 * the self-rating (0–5) or null; evidence is the weight or null. A state of
 * `not_recorded` is drawn as Not recorded, never as 0, and `evidence_only`
 * shows a count, not a level (§5.2).
 */
export function radarLayers(report) {
  const axes = Array.isArray(report?.axes) ? report.axes : [];
  return axes.map((a) => ({
    axis: a.axis,
    label: a.label,
    state: a.state,
    self: a.self_level == null ? null : Number(a.self_level),
    evidence: a.evidence_weight == null ? null : Number(a.evidence_weight),
    evidence_count: Number(a.lifetime_count) || 0,
  }));
}

/**
 * The evolution timeline, from `GET /profile/history`: one point per change
 * of the DISPLAYED archetype, oldest first, starting with the first
 * classification. Snapshots that changed only traits, skills or values are not
 * points: the timeline is the archetype's story (§7.7).
 */
export function archetypeTimeline(items, persona = null) {
  const rows = (Array.isArray(items) ? items : [])
    .filter((x) => x && (!persona || x.persona === persona) && x.displayed_slug)
    .sort((a, b) => String(a.computed_at).localeCompare(String(b.computed_at)) || Number(a.id) - Number(b.id));
  const out = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.slug === r.displayed_slug && last.persona === r.persona) continue;
    out.push({
      slug: r.displayed_slug,
      label: ARCHETYPES[r.displayed_slug]?.label ?? r.displayed_slug,
      persona: r.persona,
      at: r.computed_at,
      trigger: r.trigger ?? r.trigger_kind ?? null,
      first: !last,
    });
  }
  return out;
}

/**
 * D605 — a match's `values_fit` (from `GET /profile/published-members`) as the
 * card's one line. A null band is "not enough recorded", never aligned. A
 * missing `values_fit` (the caller has not published) draws no line: the
 * reply's `values_fit_reason` says why, once, above the list.
 */
export const VALUES_FIT_COPY = {
  aligned: 'Values: aligned',
  mixed: 'Values: some differences',
  far_apart: 'Values: far apart',
  none: 'Values: not enough recorded',
};
export function valuesFitLine(fit) {
  if (!fit || typeof fit !== 'object') return null;
  return VALUES_FIT_COPY[fit.band] ?? VALUES_FIT_COPY.none;
}
