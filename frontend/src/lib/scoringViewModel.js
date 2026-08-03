// Spin-Out Lab — Scoring Engine view model adapter.
//
// Single pure transformation from the real scoring API payloads into
// everything `/spinout-lab/scoring` renders: composite readiness, run
// provenance, the 6-axis dimension radar, weakest-first dimension rows,
// weak-point analysis, tier benchmarks, and the score trajectory.
//
// Design reference: spin-out-lab-pipeline/project/Scoring Engine.dc.html
// (renderVals() — radar geometry L461–474, trajectory scaling L497–501,
// count-up L338–347, dimension/weak-point/benchmark lists L374–544).
// The design ships a hardcoded fictional venture on 8 fabricated axes;
// everything here is derived from the real engine, and design features with
// no data source (traction / competition / IP / legal axes, per-dimension
// "confidence", cohort median + percentile, weak-point effort estimates,
// per-evidence source attribution) are omitted rather than synthesised.
//
// Pure module: no React, no JSX, no DOM, no network. Lucide components for
// the dimension tiles live in components/scoring/dimIcons.js and are resolved
// from `iconKey`.

// ---- Real engine constants (mirror cloudflare-worker/src/services/scoring.ts
// and backend/app/services/scoring.py) ----
export const TIER_THRESHOLDS = [
  { key: 'TIER_2', score: 70, label: 'Tier 2 — Conditional / Refine in Week 1' },
  { key: 'TIER_1', score: 85, label: 'Tier 1 — Immediate Spinout' },
];

export const TIER_LABELS = {
  TIER_1: 'Tier 1 — Immediate Spinout',
  TIER_2: 'Tier 2 — Conditional / Refine in Week 1',
  REJECT: 'Reject — Incubate Later',
};

// 4-week Spin-Out Lab window (spinoutLabCatalog MILESTONES top out at week 4)
// — the trajectory ETA is only claimed when the Tier-2 crossing lands inside.
export const PROGRAM_DAYS = 28;

// The six real dimensions. Sub-factor maxima mirror the engine's scoring
// functions exactly; the maxima sum to 100, so a dimension's max IS its
// weight%. `iconKey` resolves through components/scoring/dimIcons.js so this
// module stays free of React imports.
// `tintClass` mirrors the design's per-key icon tint map (L371) in Tailwind,
// dark-mode paired. Pure presentation — no data meaning.
export const DIMENSIONS = [
  {
    key: 'market', label: 'Market', max: 25, iconKey: 'compass',
    tintClass: 'bg-cyan-50 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400',
    subs: [
      { col: 'market_size', label: 'Market size', max: 10 },
      { col: 'market_urgency', label: 'Urgency', max: 10 },
      { col: 'market_trend', label: 'Trend', max: 5 },
    ],
    fix: { to: '/spinout-lab/market', label: 'Open Market Intel', feature: 'market-intelligence' },
  },
  {
    key: 'team', label: 'Team', max: 20, iconKey: 'fingerprint',
    tintClass: 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
    subs: [
      { col: 'team_expertise', label: 'Expertise', max: 8 },
      { col: 'team_execution', label: 'Execution', max: 8 },
      { col: 'team_network', label: 'Network', max: 4 },
    ],
    fix: { to: '/spinout-lab/profiling', label: 'Open Profiling', feature: 'profiling' },
  },
  {
    // CAREFUL — the engine stores the INVERSE of the two risk inputs:
    // services/scoring.ts scoreProduct() writes `product_complexity = 5 −
    // complexity` and `product_dependency = 3 − dependencies`. So a HIGH
    // stored number means LOW risk. The labels below therefore run in the
    // same direction as the stored points ("Build simplicity 5/5" = minimum
    // complexity), exactly like `capital_burn_traction` → "Burn discipline".
    key: 'product', label: 'Product', max: 15, iconKey: 'map',
    tintClass: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
    subs: [
      { col: 'product_mvp_time', label: 'MVP speed', max: 7 },
      { col: 'product_complexity', label: 'Build simplicity', max: 5 },
      { col: 'product_dependency', label: 'Dependency headroom', max: 3 },
    ],
    fix: { to: '/spinout-lab/roadmap', label: 'Open Roadmap', feature: 'roadmap' },
  },
  {
    // Capital *efficiency* (cost to MVP / time to revenue / burn discipline)
    // — never labelled "Financials": there is no runway model or fundraise
    // ask in this dimension. /spinout-lab/capital is a real Week-4 route and
    // `capital` is a real unlocked_features key, so the row links there and
    // degrades to "Open Capital locked" before Week 4.
    key: 'capital', label: 'Capital', max: 15, iconKey: 'gauge',
    tintClass: 'bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400',
    subs: [
      { col: 'capital_cost_mvp', label: 'Cost to MVP', max: 7 },
      { col: 'capital_time_revenue', label: 'Time to revenue', max: 5 },
      { col: 'capital_burn_traction', label: 'Burn discipline', max: 3 },
    ],
    fix: { to: '/spinout-lab/capital', label: 'Open Capital', feature: 'capital' },
  },
  {
    key: 'fit', label: 'Axal Fit', max: 15, iconKey: 'building',
    tintClass: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-500',
    subs: [
      { col: 'fit_alignment', label: 'Strategic alignment', max: 10 },
      { col: 'fit_synergy', label: 'Partner synergy', max: 5 },
    ],
    fix: { to: '/spinout-lab/startup', label: 'Open Startups', feature: 'projects' },
  },
  {
    key: 'distribution', label: 'Distribution', max: 10, iconKey: 'messages',
    tintClass: 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400',
    subs: [
      { col: 'distribution_channels', label: 'Channels', max: 5 },
      { col: 'distribution_virality', label: 'Virality', max: 5 },
    ],
    fix: { to: '/spinout-lab/discovery', label: 'Open Customer Discovery', feature: 'customer-discovery' },
  },
];

// ---- primitives ----
export const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const safeInt = (v, fb = 0) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : fb);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// SQLite datetimes arrive as "YYYY-MM-DD HH:MM:SS" (no zone) — normalise to
// UTC the same way the worker's daysSince() does.
export const parseUtc = (s) => (s ? Date.parse(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z')) : NaN);

export const fmtDate = (d) => {
  const t = new Date(parseUtc(d));
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// Level bands align Low/Medium/High with the engine's Tier-2 composite
// threshold (70) — Medium starts at 50 to split the sub-Tier-2 range. The
// design's own ramp cuts at 40; ours is deliberately different because
// LEVEL_RGB in scoringReportPdf.js and the Advisors page mirror these values.
export function levelFor(pct) {
  if (pct >= 70) return 'High';
  if (pct >= 50) return 'Medium';
  return 'Low';
}

export const LEVEL_TEXT = { Low: 'text-rose-600 dark:text-rose-400', Medium: 'text-amber-600 dark:text-amber-500', High: 'text-emerald-600 dark:text-emerald-400' };
export const LEVEL_BG = { Low: 'bg-rose-50 dark:bg-rose-900/30', Medium: 'bg-amber-50 dark:bg-amber-900/30', High: 'bg-emerald-50 dark:bg-emerald-900/30' };
export const LEVEL_BAR = { Low: 'bg-rose-500', Medium: 'bg-amber-500', High: 'bg-emerald-500' };

// ---- legacy contract (consumed by SpinoutLabAdvisorsPage + scoringReportPdf) ----

/** Per-dimension rows from a real snapshot, weakest first.
 *  Frozen shape: key/label/max/total/pct/level/pointsAvailable/subs/weakestSub
 *  — SpinoutLabAdvisorsPage.jsx and lib/scoringReportPdf.js both read them. */
export function buildDimensions(snapshot) {
  if (!snapshot) return [];
  return DIMENSIONS.map((d) => {
    const total = num(snapshot[`${d.key}_total`]);
    const pct = clamp(Math.round((total / d.max) * 100), 0, 100);
    const subs = d.subs.map((s) => ({ ...s, points: num(snapshot[s.col]) }));
    return {
      ...d,
      total,
      pct,
      level: levelFor(pct),
      pointsAvailable: Math.max(0, Math.round((d.max - total) * 10) / 10),
      subs,
      // The weakest sub-factor drives the weak-point copy — real data, not
      // the design's invented narratives.
      weakestSub: [...subs].sort((a, b) => a.points / a.max - b.points / b.max)[0] || null,
    };
  }).sort((a, b) => a.pct - b.pct);
}

/** Chronological real history for the trajectory chart.
 *  The API returns rows `ORDER BY created_at DESC` and SQLite `created_at` is
 *  second-resolution, so ties are possible. Array.prototype.sort is stable —
 *  without a tiebreak, tied rows would keep their newest-first input order and
 *  invert the delta sign. `_i` is the source index; ties break on `b._i - a._i`
 *  so the newest-first input becomes oldest-first output. */
export function buildTrajectory(snapshots) {
  return (Array.isArray(snapshots) ? snapshots : [])
    .filter((s) => s && Number.isFinite(Number(s.total_score)) && s.created_at)
    .map((s, i) => ({
      score: clamp(Number(s.total_score), 0, 100),
      date: s.created_at,
      sandbox: !!s.is_sandbox,
      _i: i,
    }))
    .sort((a, b) => (parseUtc(a.date) - parseUtc(b.date)) || (b._i - a._i));
}

/** Drawer "What's missing" prose — composed from the same real strings the
 *  weak-point card uses (points on the table, weakest sub-factor, fix
 *  destination); no invented narrative. */
export function missingProse(d) {
  if (!d) return '';
  if (d.pointsAvailable <= 0) return `${d.label} is at its full ${d.max}-point weight — nothing left on the table.`;
  const parts = [`${d.pointsAvailable} of ${d.max} weighted points are still on the table.`];
  if (d.weakestSub) parts.push(`Weakest input: ${d.weakestSub.label.toLowerCase()} at ${d.weakestSub.points}/${d.weakestSub.max}.`);
  if (d.fix) parts.push(`Improve it in ${d.fix.label.replace(/^Open /, '')}.`);
  else if (d.fixNote) parts.push(`${d.fixNote}.`);
  return parts.join(' ');
}

// ---- geometry ----

/** Radar geometry, ported from the design's math (L461–474) with n = 6 real
 *  axes instead of the design's 8 fabricated ones, and the dashed overlay
 *  drawn at 70% of every axis. NOTE: 70 is the engine's *composite* Tier-2
 *  threshold (classifyTier in services/scoring.ts tests total_score only) —
 *  there is no per-dimension minimum anywhere in the engine, so the ring is
 *  labelled as the evenly-distributed profile that reaches Tier 2, never as a
 *  per-axis requirement.
 *  Labels sit at R+16 with the design's own text-anchor rule; the viewBox is
 *  widened past the 320×320 plot so the longest axis labels stay INSIDE it and
 *  default SVG clipping never has to be disabled. */
export function radarGeometry(dims, { benchScore = TIER_THRESHOLDS[0].score } = {}) {
  const cx = 160; const cy = 160; const R = 120;
  const list = Array.isArray(dims) ? dims : [];
  // A missing dimension keeps its axis + label (the empty-radar chrome is
  // valid) but contributes no vertex, so no polygon is drawn at all.
  const ordered = DIMENSIONS.map((def) => list.find((x) => x && x.key === def.key) || { key: def.key, label: def.label });
  const n = Math.max(1, ordered.length);
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i, r) => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
  const f1 = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`;

  const axes = [];
  const labels = [];
  const dots = [];
  const you = [];
  const bench = [];
  ordered.forEach((d, i) => {
    const [ex, ey] = pt(i, R);
    axes.push({ key: d.key, x: ex.toFixed(1), y: ey.toFixed(1) });

    const [lx, ly] = pt(i, R + 16);
    labels.push({
      key: d.key,
      name: d.label || d.key,
      x: lx.toFixed(1),
      y: (ly + 3).toFixed(1),
      anchor: lx < cx - 5 ? 'end' : (lx > cx + 5 ? 'start' : 'middle'),
    });

    const [bx, by] = pt(i, (R * clamp(safeInt(benchScore), 0, 100)) / 100);
    bench.push(f1([bx, by]));

    if (d.pct != null && Number.isFinite(Number(d.pct))) {
      const p = pt(i, (R * clamp(safeInt(d.pct), 0, 100)) / 100);
      you.push(f1(p));
      dots.push({ key: d.key, x: p[0].toFixed(1), y: p[1].toFixed(1) });
    }
  });

  return {
    // x −34…354, y −6…326 — 34 units of horizontal slack past the 320 plot so
    // the widest `text-anchor:end` label ("Distribution") stays inside.
    viewBox: '-34 -6 388 332',
    cx,
    cy,
    R,
    rings: [30, 60, 90, 120],
    axes,
    youPoints: you.length === ordered.length ? you.join(' ') : '',
    benchPoints: bench.join(' '),
    benchScore: clamp(safeInt(benchScore), 0, 100),
    benchLabel: `Even ${clamp(safeInt(benchScore), 0, 100)}% profile`,
    benchNote: `Tier 2 is a threshold on the COMPOSITE (≥${TIER_THRESHOLDS[0].score}), not on any single axis — the dashed ring is the evenly-distributed profile that reaches it.`,
    dots,
    labels,
  };
}

/** Trajectory geometry, ported from the design's scaling (L497–501) over the
 *  real snapshot history. `startedAtMs` (lab state.started_at) gives a real
 *  program-day domain; without it the axis shows dates instead of program days
 *  — but the x positions are ALWAYS spaced by real elapsed time (relative to
 *  the first run), never by list index, so the horizontal geometry can't imply
 *  a cadence that did not happen. */
export function trajectoryGeometry(points, { startedAtMs, eta = null, programDays = PROGRAM_DAYS } = {}) {
  const W = 320; const H = 110; const pad = 8;
  const list = (Array.isArray(points) ? points : []).filter(Boolean);
  const dayBased = Number.isFinite(startedAtMs);
  // Day-1 origin: the program start when we know it, else the first run.
  const originMs = dayBased ? startedAtMs : (list.length ? parseUtc(list[0].date) : NaN);
  const rawDay = (p) => {
    const ms = parseUtc(p.date);
    if (!Number.isFinite(ms) || !Number.isFinite(originMs)) return 1;
    return safeInt(clamp(Math.round((ms - originMs) / 86_400_000) + 1, 1, 9999), 1);
  };
  const days = list.map(rawDay);
  const etaDay = eta && Number.isFinite(Number(eta.day)) ? safeInt(eta.day) : null;
  // With a known program start the domain is the whole 4-week window; without
  // one there is no window to draw, so the domain is just the real run span.
  const domainFloor = dayBased ? programDays : Math.max(2, ...days);
  const maxD = Math.max(1, safeInt(Math.max(domainFloor, ...days, etaDay || 0), domainFloor));

  const sY = (s) => H - pad - (clamp(safeInt(s), 0, 100) / 100) * (H - pad * 2);
  const sX = (d) => pad + (clamp(safeInt(d, 1), 0, maxD) / maxD) * (W - pad * 2);

  const pts = list.map((p, i) => {
    const day = days[i] ?? 1;
    const score = clamp(safeInt(p.score), 0, 100);
    return {
      day,
      score,
      date: p.date || '',
      dateLabel: fmtDate(p.date),
      x: sX(day).toFixed(1),
      y: sY(score).toFixed(1),
      sandbox: !!p.sandbox,
    };
  });

  const readyScore = TIER_THRESHOLDS[0].score;
  const last = pts.length ? pts[pts.length - 1] : null;
  // The projection is only ever claimed off OFFICIAL runs (see computeEta), so
  // it must anchor on the last official point — not on a practice run that
  // happens to be more recent.
  const lastOfficial = [...pts].reverse().find((p) => !p.sandbox) || null;

  return {
    W,
    H,
    viewBox: `0 0 ${W} ${H}`,
    dayBased,
    maxD,
    points: pts,
    hasPractice: pts.some((p) => p.sandbox),
    polyline: pts.length > 1 ? pts.map((p) => `${p.x},${p.y}`).join(' ') : '',
    projPoints: (etaDay != null && lastOfficial)
      ? `${lastOfficial.x},${lastOfficial.y} ${sX(etaDay).toFixed(1)},${sY(readyScore).toFixed(1)}`
      : '',
    dots: pts.map((p) => ({
      x: p.x,
      y: p.y,
      sandbox: p.sandbox,
      title: `${p.score} · ${dayBased ? `Day ${p.day}${p.dateLabel ? ` (${p.dateLabel})` : ''}` : (p.dateLabel || 'undated')}${p.sandbox ? ' · practice' : ' · official'}`,
    })),
    readyScore,
    readyY: sY(readyScore).toFixed(1),
    readyLabelY: (sY(readyScore) - 4).toFixed(1),
    // The engine calls 70 "Tier 2 — Conditional / Refine in Week 1"; calling
    // it "investor-ready" would promote a conditional tier.
    readyLabel: `Tier 2 · ${readyScore}`,
    axis: dayBased
      ? {
        left: 'Day 1',
        now: last ? `Day ${last.day} (now)` : '',
        right: `Day ${maxD}`,
      }
      : {
        left: pts.length ? pts[0].dateLabel : '',
        now: last ? last.dateLabel : '',
        right: '',
      },
  };
}

// ---- export modal copy ----
// Describes what the generated PDF actually contains (lib/scoringReportPdf.js)
// — the design's verbatim list claimed an 8-axis radar, a founder-profile
// section and evidence citations that the PDF has never produced.
export const EXPORT_CONTENTS = [
  'Composite score with the 6-dimension radar',
  'Per-dimension breakdown with sub-factor points',
  // "destinations", not "links": the PDF prints the remediation tool name as
  // violet text (scoringReportPdf.js) — there is no link annotation.
  'Weak-point summary with remediation destinations',
  "Benchmark vs. the engine's Tier 1 / Tier 2 thresholds",
  'Run provenance — practice vs. official, run date',
];

// Mirrors the generated PDF's own footer.
export const EXPORT_NOT_INCLUDED = 'Not included yet (needs backend data): founder-profile detail, per-evidence citations, cohort positioning.';

// Run-level substitute for the design's per-evidence "from Market Intel"
// attribution — no attribution table exists and inputs_json is stripped for
// non-admins (routes/scoring.ts L476).
export const EVIDENCE_CAPTION = 'Per-input points from your latest scoring run, against the engine maxima.';

// Run INTEGRITY, not evidence verification. The HMAC only proves the stored
// row was not altered after insert — official-run inputs are still supplied by
// a human (founder or partner), so "Signed" never claims the numbers were
// checked. `scored_by` is a real column and names who supplied them.
const CONF_STYLE = {
  Signed: `${LEVEL_BG.High} ${LEVEL_TEXT.High}`,
  Practice: `${LEVEL_BG.Medium} ${LEVEL_TEXT.Medium}`,
  Flagged: `${LEVEL_BG.Low} ${LEVEL_TEXT.Low}`,
};

const SCORED_BY_LABEL = {
  founder: 'self-reported by the founder',
  exploring: 'self-reported by the founder',
  admin: 'entered by an admin',
  partner: 'entered by a partner',
  lp: 'entered by an LP',
  system: 'entered by the system',
};

/** Defensive parse of the snapshot's anomaly_flags column (array | JSON
 *  string | null). */
function anomalyCountOf(snapshot) {
  const raw = snapshot ? snapshot.anomaly_flags : null;
  if (Array.isArray(raw)) return raw.length;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

// A pace claimed off two runs a day apart is noise, not a trend. Require a
// real span before extrapolating a per-week rate.
const MIN_ETA_SPAN_DAYS = 3;

/** Honest ETA from the real snapshot slope: the last two OFFICIAL runs set the
 *  pace. Practice (sandbox) runs are excluded by the caller — they are
 *  self-entered slider values that were never verified against anything, so a
 *  projected readiness date must never rest on them.
 *  Returns null unless every guard passes — two official runs, a span of at
 *  least MIN_ETA_SPAN_DAYS, a positive slope, a sub-threshold latest run, a
 *  crossing still in the future, a known program start, and a crossing inside
 *  the 4-week window. */
function computeEta(traj, startedAtMs, now = Date.now()) {
  if (traj.length < 2) return null;
  const prev = traj[traj.length - 2];
  const last = traj[traj.length - 1];
  const target = TIER_THRESHOLDS[0].score;
  if (last.score >= target) return null;
  const lastMs = parseUtc(last.date);
  const prevMs = parseUtc(prev.date);
  if (!Number.isFinite(lastMs) || !Number.isFinite(prevMs)) return null;
  const spanDays = (lastMs - prevMs) / 86_400_000;
  if (!(spanDays >= MIN_ETA_SPAN_DAYS)) return null;
  const perDay = (last.score - prev.score) / spanDays;
  if (!(perDay > 0)) return null;
  if (!Number.isFinite(startedAtMs)) return null;
  const crossMs = lastMs + ((target - last.score) / perDay) * 86_400_000;
  if (!Number.isFinite(crossMs) || crossMs < now) return null;
  const day = Math.ceil((crossMs - startedAtMs) / 86_400_000);
  if (!Number.isFinite(day) || day < 1 || day > PROGRAM_DAYS) return null;
  return { day, perWeek: Math.round(perDay * 7 * 10) / 10, crossMs, target };
}

/**
 * Full page view model. Total function: never throws, never emits NaN /
 * undefined / null in a field the JSX interpolates.
 *
 * @param {object}      input
 * @param {Array|null}  input.snapshots  raw GET /scoring/scores/:id (newest first)
 * @param {object|null} input.state      spinoutLab.state()
 * @param {object|null} input.project    pickLabProject() result
 * @param {string}      input.viewerRole api.getMe().role — admins reach every
 *                                       fix-it route regardless of lab week
 *                                       (App.jsx guards them with
 *                                       labRoles(['admin'])), so the lock
 *                                       state must mirror the page's own gate.
 */
export function buildScoringEngineViewModel({ snapshots, state, project, viewerRole } = {}) {
  const list = (Array.isArray(snapshots) ? snapshots : []).filter(Boolean);
  const st = state && typeof state === 'object' ? state : {};
  const proj = project && typeof project === 'object' ? project : {};
  const unlockedFeatures = Array.isArray(st.unlocked_features) ? st.unlocked_features : [];
  const isAdmin = viewerRole === 'admin';

  const latest = list.length ? list[0] : null;
  const hasData = !!latest;
  const composite = hasData ? clamp(safeInt(latest.total_score), 0, 100) : 0;

  // ---- dimensions (weakest first) — legacy shape plus design-named aliases.
  const base = buildDimensions(latest);
  const dimensions = base.map((d) => {
    const level = d.level || 'Low';
    const fix = d.fix || null;
    return {
      ...d,
      // design aliases
      name: d.label || '',
      weight: d.max,
      weightLabel: `${d.max}%`,
      score: d.pct,
      scorePct: `${d.pct}%`,
      scoreColor: level.toLowerCase(),
      scoreTextClass: LEVEL_TEXT[level] || LEVEL_TEXT.Low,
      scoreBarClass: LEVEL_BAR[level] || LEVEL_BAR.Low,
      scoreBgClass: LEVEL_BG[level] || LEVEL_BG.Low,
      // NOT a confidence measure: the engine stores no per-dimension
      // confidence anywhere, so this is an honest restatement of the score
      // band and every piece of UI copy says "band".
      confidence: `${level} band`,
      confStyle: `${LEVEL_BG[level] || LEVEL_BG.Low} ${LEVEL_TEXT[level] || LEVEL_TEXT.Low}`,
      weakLine: d.subs.map((s) => `${s.label} ${s.points}/${s.max}`).join(' · '),
      evidence: d.subs.map((s) => ({
        id: s.col,
        text: s.label,
        points: s.points,
        max: s.max,
        good: s.points >= s.max / 2,
        source: null, // no attribution table exists — see EVIDENCE_CAPTION
      })),
      evidenceCaption: EVIDENCE_CAPTION,
      missing: missingProse(d),
      fixLabel: (fix && fix.label) || d.fixNote || '',
      fixTo: (fix && fix.to) || null,
      fixFeature: (fix && fix.feature) || null,
      fixUnlocked: !!fix && (isAdmin || !fix.feature || unlockedFeatures.includes(fix.feature)),
      isTeam: d.key === 'team',
      tintClass: d.tintClass || 'bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400',
    };
  });

  // ---- trajectory + delta
  // The delta is drawn from whatever the last two runs actually were, but it
  // NEVER presents practice progress as measured progress: when either
  // endpoint is a sandbox run the label says so. The ETA and the dashed
  // projection are stricter still — official runs only (see computeEta).
  const traj = buildTrajectory(list);
  const official = traj.filter((p) => !p.sandbox);
  const startedAtMs = parseUtc(st.started_at);
  const eta = computeEta(official, startedAtMs);
  const geo = trajectoryGeometry(traj, { startedAtMs, eta });

  const dPrev = traj.length > 1 ? traj[traj.length - 2] : null;
  const dLast = traj.length > 1 ? traj[traj.length - 1] : null;
  const delta = dLast && dPrev ? safeInt(dLast.score - dPrev.score) : null;
  const deltaIsPractice = !!(dLast && dPrev && (dLast.sandbox || dPrev.sandbox));
  const deltaSuffix = deltaIsPractice ? 'since previous run (practice)' : 'since previous run';

  const mode = traj.length > 1 ? 'chart' : (traj.length === 1 ? 'single' : 'none');
  const firstPoint = geo.points[0] || null;
  // `hasData` keys off the newest raw row; buildTrajectory drops rows with a
  // missing created_at or a non-numeric total_score, so the two can disagree.
  // 'none' must not borrow the single-run copy and assert a run that has no
  // plottable date behind it.
  const singleText = mode === 'none'
    ? 'No plottable run history yet — the latest run is missing a valid date or score.'
    : (firstPoint && firstPoint.dateLabel
      ? `One run so far (${firstPoint.score} on ${firstPoint.dateLabel}). Run again after improvements to see a trajectory.`
      : 'One run so far.');

  // ---- run provenance → RUN INTEGRITY (real: is_sandbox / integrity_valid /
  // anomaly_flags / admin_review_status / scored_by are all snapshot columns
  // the API returns). Never called "evidence confidence": the HMAC proves the
  // row wasn't altered, not that the inputs are true.
  const lastRunLabel = hasData ? fmtDate(latest.created_at) : '';
  const anomalyCount = anomalyCountOf(latest);
  const reviewStatus = hasData ? String(latest.admin_review_status || '') : '';
  const scoredByNote = hasData ? (SCORED_BY_LABEL[String(latest.scored_by || '')] || '') : '';
  let confLevel = 'Practice';
  let evidenceNote = '';
  if (hasData) {
    if (latest.integrity_valid === false || anomalyCount > 0) {
      confLevel = 'Flagged';
      const plural = anomalyCount === 1 ? '' : 's';
      if (anomalyCount > 0) {
        // The worker only sets admin_review_status='flagged' for OFFICIAL runs
        // with flags; sandbox rows are written 'auto_approved'
        // (routes/scoring.ts). Claiming "under review" for those would assert
        // a review process that nobody is running.
        evidenceNote = reviewStatus === 'flagged'
          ? `${anomalyCount} anomaly flag${plural} · under admin review`
          : `${anomalyCount} anomaly flag${plural} on this ${latest.is_sandbox ? 'practice' : 'official'} run · not queued for review`;
      } else {
        evidenceNote = 'Integrity hash mismatch';
      }
    } else if (latest.is_sandbox) {
      confLevel = 'Practice';
      evidenceNote = `Practice run · your own inputs${lastRunLabel ? ` · ${lastRunLabel}` : ''}`;
    } else {
      confLevel = 'Signed';
      evidenceNote = `Official run · ${scoredByNote || 'inputs supplied by a human'} · hash verified${lastRunLabel ? ` · ${lastRunLabel}` : ''}`;
    }
  }

  // ---- weak points. The badge ramp is ORDINAL (worst first), matching the
  // design's wpBg/wpColor arrays — colouring it by score band would render
  // four identical badges whenever all four land in the same band.
  const RANK_STYLE = [
    'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
    'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
    'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
    'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
  ];
  const weakAll = dimensions.filter((d) => d.pct < 70);
  const weakPoints = weakAll.slice(0, 4).map((d, i) => ({
    key: d.key,
    rank: i + 1,
    rankStyle: RANK_STYLE[i] || RANK_STYLE[RANK_STYLE.length - 1],
    dim: d.label || '',
    gap: d.weakestSub
      ? `Weakest input: ${d.weakestSub.label.toLowerCase()} at ${d.weakestSub.points}/${d.weakestSub.max}.`
      : 'All inputs below their maxima.',
    impact: `+${d.pointsAvailable} pts available`,
    actionLabel: d.fixLabel,
    actionTo: d.fixTo,
    actionLocked: !d.fixUnlocked,
    lockLabel: d.fix ? `${d.fix.label} locked` : (d.fixNote || ''),
  }));

  // ---- benchmarks: the engine's own tier thresholds. There is deliberately
  // no cohort-median row — no aggregate query over score_snapshots exists.
  const gapSentence = composite >= TIER_THRESHOLDS[1].score
    ? 'At Tier 1 — immediate spinout territory.'
    : composite >= TIER_THRESHOLDS[0].score
      ? `${TIER_THRESHOLDS[1].score - composite} points from Tier 1.`
      : `${TIER_THRESHOLDS[0].score - composite} points from the Tier 2 threshold.`;

  const tierKey = hasData ? (latest.tier || '') : '';
  const tierLabel = hasData ? (TIER_LABELS[tierKey] || tierKey || 'Untiered') : '—';
  const isSandbox = hasData ? !!latest.is_sandbox : false;

  // ---- AI adjustment. runFullScore() clamps `dimension totals + ai_adjustment`
  // into the composite (services/scoring.ts), and the partner ScoringPage
  // exposes it as a real form control. Without this line the six visible
  // dimension totals silently fail to sum to the big number.
  const aiAdjustment = hasData ? Math.round(num(latest.ai_adjustment) * 10) / 10 : 0;
  const dimensionsTotal = Math.round(dimensions.reduce((sum, d) => sum + num(d.total), 0) * 10) / 10;
  const adjustmentLine = aiAdjustment
    ? `Dimensions ${dimensionsTotal} · AI adjustment ${aiAdjustment > 0 ? '+' : ''}${aiAdjustment} · Composite ${composite}`
    : '';

  return {
    hasData,
    latest,
    composite,
    compositeText: String(composite),
    delta,
    deltaLabel: delta == null ? '' : `${delta === 0 ? 'no change' : `${delta > 0 ? '+' : ''}${delta}`} ${deltaSuffix}`,
    deltaDir: delta == null ? 'none' : (delta > 0 ? 'up' : (delta < 0 ? 'down' : 'flat')),
    deltaIsPractice,
    aiAdjustment,
    dimensionsTotal,
    adjustmentLine,
    tierKey,
    tierLabel,
    runType: hasData
      ? (isSandbox
        ? { isSandbox: true, label: 'Practice — not investor-visible', tone: 'amber' }
        : { isSandbox: false, label: 'Official — signed & audited', tone: 'emerald' })
      : { isSandbox: false, label: '—', tone: 'emerald' },
    lastRunLabel,
    dimensionCount: dimensions.length,

    runIntegrity: { level: confLevel, label: confLevel, style: CONF_STYLE[confLevel] || CONF_STYLE.Practice },
    evidenceNote,

    radar: radarGeometry(dimensions),
    dimensions,
    weakPoints,
    weakPointTotal: weakAll.length,
    weakPointOverflow: weakAll.length > weakPoints.length
      ? `Showing ${weakPoints.length} of ${weakAll.length} dimensions below the Tier-2 pace.`
      : '',
    weakPointsClear: hasData && weakAll.length === 0,

    benchmarks: [
      { id: 'you', label: 'Your composite', value: composite, pct: `${composite}%`, barClass: 'bg-violet-600', isYou: true },
      { id: 'tier2', label: TIER_THRESHOLDS[0].label, value: TIER_THRESHOLDS[0].score, pct: `${TIER_THRESHOLDS[0].score}%`, barClass: 'bg-emerald-500', isYou: false },
      { id: 'tier1', label: TIER_THRESHOLDS[1].label, value: TIER_THRESHOLDS[1].score, pct: `${TIER_THRESHOLDS[1].score}%`, barClass: 'bg-gray-400 dark:bg-gray-500', isYou: false },
    ],
    markerPct: `${clamp(composite, 0, 100)}%`,
    benchmarkCaption: "Against the engine's real tier thresholds — cohort medians aren't tracked yet. Marker = your composite.",
    gapSentence,

    trajectory: {
      ...geo,
      mode,
      // "Tier 2", not "investor-ready": the engine labels 70 as
      // "Tier 2 — Conditional / Refine in Week 1".
      summary: eta
        ? { headline: `Tier 2 by Day ${eta.day}`, pace: `at your official-run pace (+${eta.perWeek}/wk)` }
        : null,
      caption: [
        'Line = your real run history.',
        geo.hasPractice ? 'Hollow dots are practice runs.' : '',
        eta
          ? 'Dashed = projection from your official runs only.'
          : 'No projected pace — that needs two official runs at least 3 days apart.',
      ].filter(Boolean).join(' '),
      singleText,
    },

    exportMeta: {
      projectName: proj.name || 'project',
      isSandbox,
      lastRunLabel,
      composite,
      delta,
      deltaIsPractice,
      aiAdjustment,
      dimensionsTotal,
      tierLabel,
      dims: dimensions,
      radarKeys: DIMENSIONS.map((d) => d.key),
      tiers: TIER_THRESHOLDS,
      contents: EXPORT_CONTENTS,
    },
  };
}

export default buildScoringEngineViewModel;
