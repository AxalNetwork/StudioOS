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
import { ARCHETYPES, SKILL_AXES, SKILL_AXES_SHORT, humanize } from './assessmentMeta.js';

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

// ── D619 (#1006) — the three sections, drawn from the owner's canvas ─────────
// `Studio · Archetype card` A24–A30 and the component they import,
// `Archetype Full Sections`. Geometry and copy only; the page wires the reads.

/** The radar's frame, in its 260-unit viewBox: rings out to `r`, labels at `labelAt`. */
export const RADAR = { size: 260, cx: 130, cy: 130, r: 86, labelAt: 96, chipAt: 0.55 };

const round1 = (v) => Math.round(v * 10) / 10;
const angleOf = (i, n) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
function radarPoint(i, n, radius) {
  const a = angleOf(i, n);
  return [round1(RADAR.cx + radius * Math.cos(a)), round1(RADAR.cy + radius * Math.sin(a))];
}
const pctOf = (v) => `${round1((v / RADAR.size) * 100)}%`;

/** The five rings (levels 1 to 5) as polygon `points`, product at the top. */
export function radarRings(n = 8) {
  return [1, 2, 3, 4, 5].map((k) => Array.from({ length: n }, (_, i) => radarPoint(i, n, (RADAR.r * k) / 5).join(',')).join(' '));
}

/** One spoke per axis, from the centre to the outer ring. */
export function radarSpokes(n = 8) {
  return Array.from({ length: n }, (_, i) => {
    const [x2, y2] = radarPoint(i, n, RADAR.r);
    return { x2, y2 };
  });
}

/** §5.2's five axis states, as the legend and the table name them. */
export const SKILL_STATE_COPY = {
  not_recorded: 'Not recorded',
  self_rated_only: 'Self-rated only',
  some_evidence: 'Some evidence',
  corroborated: 'Corroborated',
  evidence_only: 'Evidence only',
};
export const SKILL_STATE_LEGEND = [
  { state: 'not_recorded', text: 'No rating and no activity yet. The axis says so, never 0.' },
  { state: 'self_rated_only', text: 'Your rating, with no activity on the platform yet.' },
  { state: 'some_evidence', text: 'Your rating, with some activity behind it.' },
  { state: 'corroborated', text: 'Your rating, with enough activity to back it.' },
  { state: 'evidence_only', text: 'Activity, but no rating. The axis shows how many, not a level.' },
];

export function activityCount(n) {
  const k = Number(n) || 0;
  return `${k} ${k === 1 ? 'activity' : 'activities'}`;
}

/**
 * The radar and its table, from `radarLayers(report)`.
 * - **Self** is the filled shape, and it joins consecutive rated axes only. An
 *   axis with no rating is a gap in it, never a point at 0. A rated axis with
 *   no rated neighbour has nothing to join, so it is a mark.
 * - **Evidence** is a dot on each axis with a rating and activity, out along the
 *   axis by its weight. The outer ring is `corroboratedAt` (the reply's
 *   `corroborated_at`), so a corroborated axis's dot sits on it. Evidence only
 *   shows a count and no dot, so it never reads as a level.
 * - **Not recorded** is a chip on the axis. When every axis is Not recorded,
 *   there is one chip in the middle and no shape.
 */
export function radarModel(layers, corroboratedAt = 3) {
  const list = Array.isArray(layers) ? layers : [];
  const n = list.length;
  const full = Number(corroboratedAt) > 0 ? Number(corroboratedAt) : 3;
  const rated = list.map((l) => l.self != null && Number.isFinite(Number(l.self)));
  const vertex = (i) => radarPoint(i, n, (RADAR.r * Math.max(0, Math.min(5, Number(list[i].self)))) / 5);
  let selfPath = '';
  const selfMarks = [];
  if (n && rated.every(Boolean)) {
    selfPath = `${list.map((_, i) => `${i ? 'L' : 'M'}${vertex(i).join(' ')}`).join(' ')} Z`;
  } else if (rated.some(Boolean)) {
    // Walk once round from the first unrated axis, so a run that wraps past
    // the top stays one run.
    const start = rated.indexOf(false);
    const runs = [];
    let run = [];
    for (let k = 1; k <= n; k += 1) {
      const i = (start + k) % n;
      if (rated[i]) run.push(i);
      else if (run.length) { runs.push(run); run = []; }
    }
    for (const r of runs) {
      if (r.length === 1) {
        const [cx, cy] = vertex(r[0]);
        selfMarks.push({ axis: list[r[0]].axis, cx, cy });
      } else {
        selfPath += `${selfPath ? ' ' : ''}M${RADAR.cx} ${RADAR.cy} ${r.map((i) => `L${vertex(i).join(' ')}`).join(' ')} Z`;
      }
    }
  }
  const dots = list.flatMap((l, i) => {
    if (l.state !== 'some_evidence' && l.state !== 'corroborated') return [];
    const w = Number(l.evidence);
    if (!(w > 0)) return [];
    const [cx, cy] = radarPoint(i, n, RADAR.r * Math.min(1, w / full));
    return [{ axis: l.axis, cx, cy }];
  });
  const allNotRecorded = n > 0 && list.every((l) => l.state === 'not_recorded');
  const chipAt = (i) => {
    const [x, y] = radarPoint(i, n, RADAR.r * RADAR.chipAt);
    return { left: pctOf(x), top: pctOf(y) };
  };
  const gaps = allNotRecorded ? [] : list.flatMap((l, i) => (l.state === 'not_recorded' ? [{ axis: l.axis, ...chipAt(i) }] : []));
  const evidenceOnly = list.flatMap((l, i) => (
    l.state === 'evidence_only' ? [{ axis: l.axis, text: activityCount(l.evidence_count), ...chipAt(i) }] : []
  ));
  const labels = list.map((l, i) => {
    const [x, y] = radarPoint(i, n, RADAR.labelAt);
    const c = Math.cos(angleOf(i, n));
    return {
      axis: l.axis,
      text: SKILL_AXES_SHORT[l.axis] || l.label || l.axis,
      left: pctOf(x),
      top: pctOf(y),
      align: c > 0.3 ? 'start' : c < -0.3 ? 'end' : 'middle',
    };
  });
  const rows = list.map((l) => ({
    axis: l.axis,
    label: l.label || SKILL_AXES[l.axis] || l.axis,
    state: l.state,
    stateText: SKILL_STATE_COPY[l.state] || (l.state ? humanize(l.state) : SKILL_STATE_COPY.not_recorded),
    self: l.self == null ? null : `${l.self} / 5`,
    evidence: Number(l.evidence) > 0 ? activityCount(l.evidence_count) : null,
  }));
  return { selfPath, selfMarks, dots, gaps, evidenceOnly, labels, rows, allNotRecorded };
}

/** §7.8's four triggers, as the timeline names them. */
export const TRIGGER_COPY = {
  answer: 'An answer',
  evidence: 'Platform activity',
  scheduled: 'A scheduled review',
  engine_bump: 'An engine update',
};
/** `GET /profile/history` returns at most this many snapshots, newest first (D357). */
export const HISTORY_CAP = 200;

/** "12 Mar 2026", read in UTC; null when the time does not parse. */
export function dayLabel(at) {
  if (!at) return null;
  const s = String(at);
  const iso = /^\d{4}-\d{2}-\d{2} \d/.test(s) ? `${s.replace(' ', 'T')}${/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? '' : 'Z'}` : s;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The timeline as the section draws it, from `GET /profile/history`'s items.
 * - The last point is marked current only when it is the archetype the card
 *   shows. The card reads `GET /best-fit/me` (D602) and the history reads the
 *   profile snapshots, which change their displayed archetype only after
 *   hysteresis, so the two can differ for a while.
 * - When the reply holds the route's full 200, older snapshots were cut, so the
 *   oldest point shown is not called the first.
 */
export function timelineView(items, persona = null, cardSlug = null) {
  const list = Array.isArray(items) ? items : [];
  const capped = list.length >= HISTORY_CAP;
  const pts = archetypeTimeline(list, persona);
  const last = pts[pts.length - 1] || null;
  const agrees = !!last && !!cardSlug && last.slug === cardSlug;
  return {
    capped,
    agrees,
    points: pts.map((p, i) => ({
      ...p,
      date: dayLabel(p.at) || 'Date not recorded',
      triggerText: TRIGGER_COPY[p.trigger] || 'Trigger not recorded',
      first: p.first && !capped,
      current: agrees && i === pts.length - 1,
    })),
  };
}

/** Members drawn under each match type before "and N more". */
export const MATCH_MEMBERS_SHOWN = 3;

/** One member row: who, and the values line (D605) when there is a comparison. */
export function memberRow(m) {
  const name = typeof m?.name === 'string' && m.name.trim() ? m.name.trim() : null;
  const initials = name
    ? name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
    : '?';
  return {
    key: `${m?.user_id ?? ''}-${m?.persona ?? ''}`,
    name: name || 'Name not recorded',
    initials,
    role: m?.role ? humanize(m.role) : null,
    archetype: m?.label || ARCHETYPES[m?.slug]?.label || null,
    values: valuesFitLine(m?.values_fit),
  };
}
