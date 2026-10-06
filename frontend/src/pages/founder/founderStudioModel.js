/**
 * D564 (#1168) — the founder's /studio, built to `Founder Studio.dc.html`.
 *
 * Pure: every zone is a function of the reads the page made, so each state
 * (loading, unreadable, not recorded, empty, ready) is tested without a
 * browser. A read is `undefined` while it is in flight, `{ failed: reason }`
 * when it failed, and its payload otherwise.
 *
 * WHAT HAS NO STORE IS SAID, NEVER DRAWN. The canvas's "Holding progress"
 * blockers, "What this adds up to", the per-module percent, each activity's
 * "feeds" line and each action's "unlocks" order have nothing recorded behind
 * them (#1168's step-1 table). Those zones say so with the reason; none is
 * drawn as zero or as nothing.
 */
import { WEEK_DEFS, TOOL_INFO, milestoneKeySet } from '../SpinoutLabWorkspace';

export const LOADING = 'loading';
export const UNREADABLE = 'unreadable';
export const NOT_RECORDED = 'not_recorded';
export const EMPTY = 'empty';
export const READY = 'ready';

/** The Lab's sprint length, `SPRINT_DAYS` in routes/spinout_lab.ts. */
export const SPRINT_DAYS = 28;

export const failedRead = (reason) => ({ failed: String(reason || 'Source unavailable') });
const isFailed = (r) => !!r && typeof r === 'object' && typeof r.failed === 'string';

/** The state of one read: loading, unreadable, or ready. */
export function readState(r) {
  if (r === undefined) return LOADING;
  if (isFailed(r)) return UNREADABLE;
  return READY;
}

/** The first read of `reads` that is not ready decides; all ready is ready. */
function joint(...reads) {
  for (const r of reads) if (readState(r) === UNREADABLE) return { state: UNREADABLE, reason: r.failed };
  for (const r of reads) if (readState(r) === LOADING) return { state: LOADING };
  return { state: READY };
}

/** A finite number, or null: an absent figure stays absent, never 0. */
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

const inCohort = (lab) => !!lab && !isFailed(lab) && lab.active === true;

/** The Lab day, 1 to 28, from `days_remaining`. */
export function labDay(lab) {
  const left = Number(lab?.days_remaining);
  if (!Number.isFinite(left)) return null;
  return Math.max(1, Math.min(SPRINT_DAYS, SPRINT_DAYS - left + 1));
}

// ---- header ------------------------------------------------------------------

export function headerOf({ user, project, lab }) {
  const name = user?.name || user?.email?.split('@')[0] || 'Founder';
  const labRead = readState(lab);
  let phase = null;
  if (labRead === READY) {
    phase = inCohort(lab)
      ? `Week ${Number(lab.week) || 1} · Day ${labDay(lab) ?? '—'}`
      : 'Independent · not in a cohort';
  }
  const where = labRead !== READY ? null
    : inCohort(lab) ? (lab.cohort ? `Cohort ${lab.cohort}` : 'Spin-Out Lab')
    : 'Studio access';
  return {
    phase,
    phaseState: labRead,
    company: readState(project) === READY ? (project?.name || null) : null,
    companyState: readState(project),
    founderLine: where ? `${name} · ${where}` : name,
    // The Lab's company page admits Lab members only; everyone else edits the record in Build.
    profileHref: inCohort(lab) ? '/spinout-lab/startup' : (readState(project) === READY && project?.id ? `/build?project_id=${project.id}` : '/build'),
  };
}

// ---- the Lab's weeks ---------------------------------------------------------

function weekRows(lab) {
  const done = milestoneKeySet(lab?.milestones);
  const rowDone = (d) => d.keys.every((k) => done.has(k));
  return WEEK_DEFS.map((w) => ({
    num: w.num,
    name: w.name,
    rows: w.deliverables.map((d) => ({ label: d.label, optional: !!d.optional, done: rowDone(d) })),
  }));
}

/** Deliverables done of those that count (optional rows never count), across all four weeks. */
export function companyProgress(lab) {
  let done = 0;
  let total = 0;
  for (const w of weekRows(lab)) {
    for (const r of w.rows) {
      if (r.optional) continue;
      total += 1;
      if (r.done) done += 1;
    }
  }
  return { done, total, percent: total ? Math.round((100 * done) / total) : null };
}

export function progressOf(lab) {
  const s = joint(lab);
  if (s.state !== READY) return s;
  const cohort = inCohort(lab);
  const week = Number(lab.week) || 1;
  const weeks = weekRows(lab);
  const ladder = weeks.map((w) => ({
    name: cohort ? `Week ${w.num} · ${w.name}` : w.name,
    state: !cohort ? 'Not started' : w.num < week ? 'Complete' : w.num === week ? 'In progress' : 'Locked',
  }));
  const upTo = weeks.filter((w) => w.num <= (cohort ? week : 0));
  const shipped = upTo.flatMap((w) => w.rows.filter((r) => r.done).map((r) => r.label));
  const current = weeks.find((w) => w.num === week);
  const stillOpen = cohort && current ? current.rows.filter((r) => !r.done && !r.optional).map((r) => r.label) : [];
  let gate;
  if (!cohort) gate = 'No gates outside a cohort: you choose the order.';
  else if (!stillOpen.length) gate = week >= 4 ? 'Every Week 4 deliverable is in. Graduation review is next.' : `Every Week ${week} deliverable is in. Week ${week + 1} opens at the gate.`;
  else gate = `${week >= 4 ? 'Graduation review' : `Week ${week + 1}`} opens when ${listOf(stillOpen)} ${stillOpen.length === 1 ? 'is' : 'are'} complete.`;
  return {
    state: READY,
    cohort,
    stageNote: cohort ? `Day ${labDay(lab) ?? '—'} of ${SPRINT_DAYS}` : 'Self-paced: no cohort clock',
    ladder,
    shipped,
    stillOpen,
    gate,
  };
}

function listOf(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// ---- the summary strip -------------------------------------------------------

const tile = (k, state, extra = {}) => ({ k, state, v: null, sub: null, reason: null, ...extra });

export function summaryOf({ lab, advisor, lifecycle, scores, project }) {
  const out = [];

  // Company progress: the Lab's deliverables in a cohort, the lifecycle checklist outside one.
  {
    const s = joint(lab);
    if (s.state !== READY) out.push(tile('Company progress', s.state, { reason: s.reason }));
    else if (inCohort(lab)) {
      const p = companyProgress(lab);
      out.push(tile('Company progress', READY, { v: `${p.percent}%`, sub: `Week ${Number(lab.week) || 1} of 4` }));
    } else {
      const l = joint(lifecycle);
      const items = Array.isArray(lifecycle?.checklist) ? lifecycle.checklist : null;
      if (l.state !== READY) out.push(tile('Venture progress', l.state, { reason: l.reason }));
      else if (!items || !items.length) out.push(tile('Venture progress', NOT_RECORDED, { reason: readState(project) === READY && !project ? 'No company record yet.' : 'No checklist is recorded for this company.' }));
      else {
        const d = items.filter((i) => i.done).length;
        out.push(tile('Venture progress', READY, { v: `${Math.round((100 * d) / items.length)}%`, sub: 'Self-directed' }));
      }
    }
  }

  // Profile complete and questions answered: the advisor's own progress read.
  {
    const s = joint(advisor);
    const prof = advisor?.profiling;
    if (s.state !== READY) out.push(tile('Profile complete', s.state, { reason: s.reason }));
    else if (!prof || prof.applicable === false) out.push(tile('Profile complete', NOT_RECORDED, { reason: 'No profiling questions apply to this account yet.' }));
    else if (num(prof.percent) === null) out.push(tile('Profile complete', NOT_RECORDED, { reason: 'The profiling read sent no completion figure.' }));
    else {
      const gaps = (prof.sections || []).filter((x) => !x.confident).length;
      out.push(tile('Profile complete', READY, { v: `${num(prof.percent)}%`, sub: prof.complete ? 'Complete' : `${gaps} ${gaps === 1 ? 'gap' : 'gaps'}` }));
    }
    if (s.state !== READY) out.push(tile('Questions answered', s.state, { reason: s.reason }));
    else if (num(advisor.answered) === null || num(advisor.total) === null) out.push(tile('Questions answered', NOT_RECORDED, { reason: 'Eadwyn’s progress read sent no question counts.' }));
    else {
      out.push(tile('Questions answered', READY, { v: String(num(advisor.answered)), sub: `${Math.max(0, num(advisor.total) - num(advisor.answered))} waiting` }));
    }
  }

  // Modules active and tasks done: the Lab's unlocked features and milestones.
  {
    const s = joint(lab);
    if (s.state !== READY) {
      out.push(tile('Modules active', s.state, { reason: s.reason }));
      out.push(tile('Tasks done', s.state, { reason: s.reason }));
    } else if (!inCohort(lab)) {
      out.push(tile('Modules active', NOT_RECORDED, { reason: 'Modules open week by week inside a Lab cohort, and you are not in one.' }));
      out.push(tile('Tasks done', NOT_RECORDED, { reason: 'Tasks are the Lab’s milestones, recorded inside a cohort.' }));
    } else {
      const all = allFeatures();
      const open = new Set(lab.unlocked_features || []);
      out.push(tile('Modules active', READY, { v: String(all.filter((f) => open.has(f)).length), sub: `of ${all.length}` }));
      out.push(tile('Tasks done', READY, { v: String((lab.milestones || []).length), sub: 'cumulative' }));
    }
  }

  // Readiness: the latest score the Scoring Engine recorded for this company.
  {
    const s = joint(scores);
    const rows = Array.isArray(scores) ? scores : Array.isArray(scores?.scores) ? scores.scores : null;
    if (readState(project) === READY && !project) out.push(tile('Readiness', NOT_RECORDED, { reason: 'No company record yet, so nothing has been scored.' }));
    else if (s.state !== READY) out.push(tile('Readiness', s.state, { reason: s.reason }));
    else if (!rows || !rows.length) out.push(tile('Readiness', NOT_RECORDED, { reason: 'No score has been run for this company.' }));
    else out.push(tile('Readiness', READY, { v: String(Math.round(Number(rows[0].total_score))), sub: rows[0].tier ? String(rows[0].tier) : null }));
  }
  return out;
}

function allFeatures() {
  return WEEK_DEFS.flatMap((w) => w.features);
}

// ---- do these next -----------------------------------------------------------

export function actionsOf({ lifecycle, project }) {
  if (readState(project) === READY && !project) {
    return { state: READY, items: [{ n: '01', title: 'Create your startup record', href: '/build' }] };
  }
  const s = joint(lifecycle);
  if (s.state !== READY) return s;
  const items = (Array.isArray(lifecycle?.checklist) ? lifecycle.checklist : []).filter((i) => !i.done).slice(0, 4);
  if (!items.length) return { state: EMPTY };
  return { state: READY, items: items.map((i, n) => ({ n: `0${n + 1}`, title: String(i.label || ''), href: i.href || null })) };
}

// ---- advisor questions --------------------------------------------------------

export function questionsOf({ advisor, queue }) {
  const s = joint(advisor, queue);
  if (s.state !== READY) return s;
  const total = num(advisor.total);
  const answered = num(advisor.answered);
  const open = (Array.isArray(queue?.queue) ? queue.queue : []).slice(0, 4)
    .map((q) => ({ id: q.id || q.question_id || null, q: String(q.prompt || '').trim(), high: q.importance === 'high' || q.importance === 'critical', to: q.page_target || null }))
    .filter((q) => q.q);
  return { state: READY, answered, open: total === null || answered === null ? null : Math.max(0, total - answered), items: open };
}

// ---- activity -----------------------------------------------------------------

export const ACTIVITY_DAYS = 7;

export function activityOf({ activity, now = Date.now() }) {
  const s = joint(activity);
  if (s.state !== READY) return s;
  const rows = Array.isArray(activity?.items) ? activity.items : Array.isArray(activity?.logs) ? activity.logs : [];
  const since = now - ACTIVITY_DAYS * 86_400_000;
  const items = rows
    .map((r) => ({ at: Date.parse(String(r.created_at || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(r.created_at || '')) ? '' : 'Z')), r }))
    .filter((x) => Number.isFinite(x.at) && x.at >= since && x.at <= now + 60_000)
    .slice(0, 8)
    .map(({ at, r }) => ({ when: whenOf(at, now), what: humanise(r.action), detail: typeof r.details === 'string' && r.details && !r.details.startsWith('{') ? r.details : null }));
  if (!items.length) return { state: EMPTY };
  return { state: READY, items };
}

function whenOf(at, now) {
  const days = Math.floor((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days`;
}
function startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
const humanise = (s) => { const t = String(s || '').replace(/[_.:-]+/g, ' ').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Activity'; };

// ---- module map ---------------------------------------------------------------

export function modulesOf({ lab }) {
  const s = joint(lab);
  if (s.state !== READY) return s;
  const open = new Set(lab.unlocked_features || []);
  const cohort = inCohort(lab);
  const items = WEEK_DEFS.flatMap((w) => w.features.map((f) => ({
    key: f,
    name: TOOL_INFO[f]?.label || humanise(f),
    state: cohort && open.has(f) ? 'Active' : 'Locked',
    note: cohort && open.has(f) ? null : cohort ? `Week ${w.num}` : 'Cohort only',
  })));
  return { state: READY, items };
}

// ---- the founder profile ----------------------------------------------------

/**
 * The profile zone's figures: profiling completion and each section's
 * confidence, from the advisor's progress read. The archetype is the shared
 * `ProfileFitSection compact` card (D594's lock included), mounted by the home.
 */
export function profileOf({ advisor }) {
  const a = joint(advisor);
  if (a.state !== READY) return { completion: a, dimensions: a };
  const prof = advisor?.profiling;
  if (!prof || prof.applicable === false) {
    const none = { state: NOT_RECORDED, reason: 'No profiling questions apply to this account yet.' };
    return { completion: none, dimensions: none };
  }
  const items = (prof.sections || []).map((x) => {
    const raw = num(x.percent);
    const pct = raw === null ? null : Math.max(0, Math.min(100, raw));
    return { name: String(x.label || x.key || ''), pct, label: x.confident ? 'High' : pct === null ? 'Not recorded' : pct >= 50 ? 'Moderate' : 'Low' };
  });
  return {
    completion: num(prof.percent) === null ? { state: NOT_RECORDED, reason: 'The profiling read sent no completion figure.' } : { state: READY, pct: num(prof.percent) },
    dimensions: items.length ? { state: READY, items } : { state: NOT_RECORDED, reason: 'No dimension has questions yet.' },
  };
}

// ---- the zones with no store -------------------------------------------------

export const NO_STORE = {
  blockers: 'Nothing records a blocker or its severity yet, so what is holding progress is not shown rather than guessed.',
  implications: 'No read across your completed work is recorded yet, so this summary is not shown rather than invented.',
};
