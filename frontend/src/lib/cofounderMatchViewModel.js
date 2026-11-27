// Spin-Out Lab — Co-founder Match view-model (pure module, no JSX).
//
// Design source: spin-out-lab-pipeline/project/Co-founder Match.dc.html.
// This was the last Spin-Out Lab design with no Lab-native page: the
// workspace's 'cofounder-match' card linked straight out to /cofounder (the
// generic browse surface), so the design's founder match brief, skills-gap
// search criteria, fit breakdown and decision console existed nowhere.
//
// Everything here derives from real stores:
//   - Archetype: /assessment/results/me + shared ARCHETYPES display copy
//     (strengths/blindSpots/complements are static per-archetype metadata,
//     same convention as the Profiling page).
//   - Capabilities: GET /radar/me — the 8 canonical skill axes, score 0–100.
//     "Missing" uses the SAME <60 threshold the radar service itself uses
//     for gap_axes, so this page and the team radar never disagree.
//   - Values: GET /values/me (score −2..+2 or 0..N with stored confidence).
//   - Candidates: GET /cofounder/browse — the real vector-augmented matcher
//     (match_score, match_reasons, watch_outs, breakdown).
//
// The design's fabricated content is NOT reproduced: "Visionary · Builder",
// "Product / GTM co-founder", named candidates, "92% fit", the "3 of 6
// modules" count. Where the design implies a computation the app can do, we
// do it from real data; where it cannot (e.g. a secondary-archetype blend),
// the element is omitted and the page says why.
//
// HONESTY — Week 3: the "validate path" deliverable is defined by the
// milestone catalog as ANY OF advisor_meeting_booked / cofounder_request_sent.
// Recording a decision in this console does NOT invent a third key: an
// "advance" outcome rides on the real interest-request milestone; a "solo"
// outcome is a first-class decision record that points at the real
// alternative for Week 3 (an advisor meeting). The Co-founder Agreement page
// READS this record on its solo path (D352); there is no solo-declaration
// document to execute, and nothing here says there is. buildDecisionModel
// exposes exactly which real milestones are done so the UI never overclaims.
//
// D352 — the canvas's five outcomes, finalists and sort chips. All of it lives
// in the same `cofounder_decision_meta` blob (migration 162; the Worker only
// requires a JSON object under 8000 characters), so no migration:
//   * outcomes: advance · trial · references · searching · solo. "Run a trial
//     project" and "Request references" record the DECISION; no trial tracker
//     or reference-check store exists for a co-founder candidate
//     (reference_checks is keyed to deals), so the page says so.
//   * finalists: up to FINALIST_LIMIT candidate uids, compared side by side
//     from the live /browse cards.
//   * sort: total fit, complementarity (the matcher's two "gaps" parts) and
//     values alignment — the three the /browse breakdown can order by. The
//     canvas's "Evidence" sort has no per-candidate evidence figure behind it.

// Radar-service gap rule (services/radar.ts: normCoverage < 60 → gap_axes).
export const CAPABILITY_GAP_THRESHOLD = 60;

// The matcher's real breakdown components and their real maxima, straight
// from cloudflare-worker/src/routes/cofounder.ts::scoreMatch. The design's
// six invented dimensions (Archetype fit, Sector relevance, …) have no
// computation behind them; these do.
export const FIT_PARTS = [
  { key: 'skill_complementarity', label: 'Skill complementarity', max: 25, group: 'gaps' },
  { key: 'profile_skills', label: 'Complementary profile skills', max: 25, group: 'gaps' },
  { key: 'values_alignment', label: 'Values alignment', max: 30, group: 'style' },
  { key: 'profile_commitment', label: 'Commitment match', max: 20, group: 'style' },
  { key: 'profile_sectors', label: 'Sector overlap', max: 30, group: 'context' },
  { key: 'profile_location', label: 'Location', max: 15, group: 'context' },
  { key: 'profile_remote', label: 'Remote compatibility', max: 5, group: 'context' },
  { key: 'profile_equity', label: 'Equity expectations', max: 10, group: 'context' },
];

export function fitRows(breakdown) {
  if (!breakdown || typeof breakdown !== 'object') return [];
  return FIT_PARTS.map((p) => {
    const raw = Number(breakdown[p.key]);
    const v = Number.isFinite(raw) ? Math.max(0, Math.min(p.max, raw)) : null;
    return v == null ? null : { ...p, value: v, pct: Math.round((v / p.max) * 100) };
  }).filter(Boolean);
}

// Radar axis slug → plain search terms that appear in real co-founder
// profile skill lists (the browse ?skill= filter matches profile free text,
// not axis slugs). Inverse direction of the advisors matcher's
// EXPERTISE_AXIS map — kept small and literal on purpose.
export const AXIS_SEARCH_TERMS = {
  product: ['product'],
  engineering: ['engineering'],
  design: ['design'],
  gtm_sales: ['sales', 'gtm'],
  marketing_brand: ['marketing'],
  finance_ops: ['finance', 'operations'],
  legal_compliance: ['legal'],
  capital_network: ['fundraising'],
};

/**
 * Founder match brief + skills-gap search criteria, from real evidence.
 * Any missing source degrades to nulls/[] — the page renders explicit
 * unavailable states, never invented content.
 *
 * radar:   { axes: [{slug, label, score}] } | null
 * results: assessment results array | null   (latest first not guaranteed)
 * values:  { vector } | null — vector as {slug: {score, confidence}} or array
 * archetypeMetaFn: slug -> ARCHETYPES entry | null (injected to keep this
 *                  module dependency-free of lucide icons)
 */
export function buildMatchBrief({ radar, results, values, archetypeMetaFn } = {}) {
  const axes = Array.isArray(radar?.axes) ? radar.axes : [];
  const scored = axes
    .map((a) => ({ slug: a.slug, label: a.label || a.slug, score: Number(a.score) }))
    .filter((a) => a.slug && Number.isFinite(a.score));
  const strongest = [...scored].sort((a, b) => b.score - a.score).slice(0, 3)
    .filter((a) => a.score >= CAPABILITY_GAP_THRESHOLD);
  const missing = [...scored].sort((a, b) => a.score - b.score)
    .filter((a) => a.score < CAPABILITY_GAP_THRESHOLD).slice(0, 3);

  // Latest archetype result that actually carries a slug.
  const rs = (Array.isArray(results) ? results : [])
    .filter((r) => r && (r.archetype_slug || r.archetype_label))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const latest = rs[0] || null;
  const meta = latest?.archetype_slug && archetypeMetaFn ? archetypeMetaFn(latest.archetype_slug) : null;
  const archetype = latest
    ? {
        label: meta?.label || latest.archetype_label || null,
        confidence: latest.confidence != null ? Math.round(Number(latest.confidence) * 100) : null,
        // Static per-archetype display copy — descriptive metadata, not user data.
        blindSpots: meta?.blindSpots || [],
        complements: meta?.complements || [],
      }
    : null;

  // Recommended co-founder role: DERIVED as the founder's weakest capability
  // axes, stated as such. The design's "Product / GTM co-founder" is demo
  // copy; this is the same idea computed from the real radar.
  const role = missing.length
    ? `${missing.slice(0, 2).map((m) => m.label).join(' + ')} co-founder`
    : null;

  // Must-have values: highest-|score| dimensions from the real vector.
  let vv = [];
  const rawVec = values?.vector;
  if (Array.isArray(rawVec)) {
    vv = rawVec.map((v) => ({ slug: v.slug || v.dimension || '', score: Number(v.score), confidence: Number(v.confidence) }));
  } else if (rawVec && typeof rawVec === 'object') {
    vv = Object.entries(rawVec).map(([slug, v]) => ({
      slug,
      score: Number(typeof v === 'object' ? v?.score : v),
      confidence: Number(typeof v === 'object' ? v?.confidence : NaN),
    }));
  }
  const mustHaveValues = vv
    .filter((v) => v.slug && Number.isFinite(v.score))
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 3);

  // Search criteria: each missing axis becomes a browse filter chip. Weight
  // is the real gap depth (how far under the threshold), normalised so the
  // deepest gap is 100 — a ranking aid, not a fabricated score.
  const deepest = missing.length ? Math.max(...missing.map((m) => CAPABILITY_GAP_THRESHOLD - m.score)) : 0;
  const searchCriteria = missing.map((m) => ({
    slug: m.slug,
    label: m.label,
    term: (AXIS_SEARCH_TERMS[m.slug] || [m.label.toLowerCase()])[0],
    weight: deepest > 0 ? Math.round(((CAPABILITY_GAP_THRESHOLD - m.score) / deepest) * 100) : 100,
  }));

  return { archetype, role, strongest, missing, mustHaveValues, searchCriteria };
}

/**
 * Evidence modules — the design's "3 of 6 modules" strip, made real: which
 * evidence sources this decision can actually draw on right now.
 */
export function buildEvidenceModules({ brief, hasProfile, candidateCount, scoringDone } = {}) {
  const mods = [
    { key: 'archetype', label: 'Founder archetype', done: Boolean(brief?.archetype?.label) },
    { key: 'skills', label: 'Skills radar', done: Boolean(brief?.strongest?.length || brief?.missing?.length) },
    { key: 'values', label: 'Values survey', done: Boolean(brief?.mustHaveValues?.length) },
    { key: 'scoring', label: 'Scoring run', done: Boolean(scoringDone) },
    { key: 'profile', label: 'Co-founder profile', done: Boolean(hasProfile) },
    { key: 'candidates', label: 'Candidates reviewed', done: Number(candidateCount) > 0 },
  ];
  return { mods, done: mods.filter((m) => m.done).length, total: mods.length };
}

export const DECISION_OUTCOMES = [
  {
    value: 'advance',
    label: 'Proceed with a candidate',
    desc: 'Express interest — the real request marks the Week-3 milestone; the agreement itself is Week 4.',
    needsCandidate: true,
  },
  {
    value: 'trial',
    label: 'Run a trial project',
    desc: 'Records that you will scope a trial with this candidate. Axal has no trial tracker — the plan lives in your follow-ups.',
    needsCandidate: true,
  },
  {
    value: 'references',
    label: 'Request references',
    desc: 'Records that you will check references for this candidate. Axal stores no co-founder reference checks — track them in your follow-ups.',
    needsCandidate: true,
  },
  {
    value: 'searching',
    label: 'Keep searching',
    desc: 'Record what is still missing and keep the shortlist warm.',
  },
  {
    value: 'solo',
    label: 'Document a solo path',
    desc: 'A first-class outcome — not a failure state. The Co-founder Agreement page reads this record on its solo path.',
  },
];

/** How many finalists the compare card holds (the canvas draws two). */
export const FINALIST_LIMIT = 3;

/** The sort chips /browse's breakdown can honestly order by. */
export const SORT_KEYS = [
  { key: 'total', label: 'Total fit' },
  { key: 'complementarity', label: 'Complementarity' },
  { key: 'values', label: 'Values alignment' },
];

const part = (card, key) => {
  const v = Number(card?.breakdown?.[key]);
  return Number.isFinite(v) ? v : null;
};

/** A card's figure for one sort key, or null when the matcher gave none. */
export function sortFigure(card, key) {
  if (key === 'complementarity') {
    const a = part(card, 'skill_complementarity');
    const b = part(card, 'profile_skills');
    return a == null && b == null ? null : (a ?? 0) + (b ?? 0);
  }
  if (key === 'values') return part(card, 'values_alignment');
  const t = Number(card?.match_score);
  return card?.match_score == null || !Number.isFinite(t) ? null : t;
}

/**
 * Cards ordered by one key, highest first. A card with no figure for the key
 * sorts LAST rather than as a zero — "the matcher had nothing to say" is not
 * "the candidate scored nothing". Ties keep the matcher's own order.
 */
export function sortCards(cards, key) {
  const list = (Array.isArray(cards) ? cards : []).map((c, i) => ({ c, i, v: sortFigure(c, key) }));
  list.sort((a, b) => {
    if (a.v == null && b.v == null) return a.i - b.i;
    if (a.v == null) return 1;
    if (b.v == null) return -1;
    return b.v - a.v || a.i - b.i;
  });
  return list.map((x) => x.c);
}

/**
 * Decision console state from the stored blob + REAL milestone facts. The
 * console never claims a milestone this record did not earn: week-3
 * satisfaction is read from the actual lab state, not from the decision.
 */
export function buildDecisionModel({ meta, milestoneKeys } = {}) {
  let stored = null;
  if (meta) {
    try { stored = typeof meta === 'string' ? JSON.parse(meta) : meta; } catch { stored = null; }
  }
  if (stored && (typeof stored !== 'object' || Array.isArray(stored))) stored = null;
  const keys = milestoneKeys instanceof Set ? milestoneKeys : new Set(Array.isArray(milestoneKeys) ? milestoneKeys : []);
  const requestSent = keys.has('cofounder_request_sent');
  const advisorBooked = keys.has('advisor_meeting_booked');
  return {
    outcome: DECISION_OUTCOMES.some((o) => o.value === stored?.outcome) ? stored.outcome : null,
    candidateUid: typeof stored?.candidate_uid === 'string' ? stored.candidate_uid : null,
    finalists: Array.isArray(stored?.finalists)
      ? [...new Set(stored.finalists.filter((f) => typeof f === 'string' && f))].slice(0, FINALIST_LIMIT)
      : [],
    note: typeof stored?.note === 'string' ? stored.note : '',
    followups: Array.isArray(stored?.followups) ? stored.followups.filter((f) => typeof f === 'string') : [],
    decidedAt: typeof stored?.decided_at === 'string' ? stored.decided_at : null,
    // Real week-3 facts, shown as-is.
    requestSent,
    advisorBooked,
    week3Satisfied: requestSent || advisorBooked,
  };
}

/** Serialize the console back into the stored blob. */
export function serializeDecision({ outcome, candidateUid, note, followups, decidedAt, finalists }) {
  const needsCandidate = DECISION_OUTCOMES.some((o) => o.value === outcome && o.needsCandidate);
  return {
    outcome: outcome || null,
    // A candidate is only part of an outcome that is ABOUT one.
    candidate_uid: needsCandidate ? (candidateUid || null) : null,
    finalists: [...new Set((finalists || []).filter((f) => typeof f === 'string' && f))].slice(0, FINALIST_LIMIT),
    note: (note || '').slice(0, 2000),
    followups: (followups || []).filter(Boolean).map((f) => String(f).slice(0, 300)).slice(0, 10),
    decided_at: decidedAt || null,
  };
}
