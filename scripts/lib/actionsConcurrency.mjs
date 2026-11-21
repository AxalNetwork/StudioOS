// #6462: per-minute executing and queued job levels from job timestamps (a job
// executes only once a runner took it), effective ceiling (the level held while
// jobs queue), slot shares, PR draft state at run time and the plan-cap match;
// `actionsConcurrency.test.mjs` holds the fixture jobs.
//
// #6462: rebuild Actions job concurrency per minute from job timestamps; saturation ceiling, queue depth, slot shares, plan-cap match.
const minute = 60_000;
const stamp = value => (typeof value === 'string' && value ? Date.parse(value) : NaN);

export const PLAN_CAPS = Object.freeze([20, 40, 60, 500]);
export const HOLD_MINUTES = 10;

/**
 * A job held a runner slot only if a runner picked it up. GitHub fills
 * `started_at` on queued and queue-cancelled jobs too (it equals `created_at`),
 * so the runner fields, not `started_at`, decide.
 */
export function heldSlot(job) {
  if (!job || job.conclusion === 'skipped') return false;
  if (job.status !== 'in_progress' && job.status !== 'completed') return false;
  return (Number.isSafeInteger(job.runner_id) && job.runner_id > 0) || (typeof job.runner_name === 'string' && job.runner_name !== '');
}

/**
 * Executing spans [started_at, completed_at|now) for jobs that held a slot;
 * queued spans [created_at, start-or-end|now) for every job that was not skipped.
 * A job that never got a runner is queued for its whole life, never executing.
 */
export function spans(runs, now) {
  const executing = [];
  const queued = [];
  for (const run of runs) for (const job of run.jobs || []) {
    if (job.conclusion === 'skipped') continue;
    const created = stamp(job.created_at);
    const end = job.status === 'completed' ? stamp(job.completed_at) : now;
    if (heldSlot(job)) {
      const started = stamp(job.started_at);
      if (Number.isFinite(started) && Number.isFinite(end) && started < end) executing.push({ start: started, end, run, job });
      if (Number.isFinite(created) && Number.isFinite(started) && created < started) queued.push({ start: created, end: started, run, job });
    } else if (Number.isFinite(created) && Number.isFinite(end) && created < end) {
      queued.push({ start: created, end, run, job });
    }
  }
  return { executing, queued };
}

/** Change points of the step function "spans open at t", clipped to [from, to). */
function steps(list, from, to) {
  const deltas = new Map();
  for (const { start, end } of list) {
    const a = Math.max(start, from);
    const b = Math.min(end, to);
    if (a >= b) continue;
    deltas.set(a, (deltas.get(a) || 0) + 1);
    deltas.set(b, (deltas.get(b) || 0) - 1);
  }
  const points = [];
  let level = 0;
  for (const [at, delta] of [...deltas].sort(([x], [y]) => x - y)) {
    level += delta;
    if (delta) points.push([at, level]);
  }
  return points;
}

/** Per minute of [from, to): the level at the minute's start, its minimum and maximum inside the minute. */
export function perMinute(list, from, to) {
  const points = steps(list, from, to);
  const out = [];
  let i = 0;
  let level = 0;
  for (let m = from; m < to; m += minute) {
    const close = Math.min(m + minute, to);
    while (i < points.length && points[i][0] <= m) level = points[i++][1];
    const at = level;
    let low = level;
    let high = level;
    while (i < points.length && points[i][0] < close) {
      level = points[i++][1];
      low = Math.min(low, level);
      high = Math.max(high, level);
    }
    out.push({ at: m, start: at, min: low, max: high });
  }
  return out;
}

/** Highest level the count stayed at or above for `hold` consecutive whole minutes. */
export function effectiveCeiling(minutes, hold = HOLD_MINUTES) {
  let best = 0;
  for (let i = 0; i + hold <= minutes.length; i++) {
    let low = Infinity;
    for (let j = i; j < i + hold; j++) low = Math.min(low, minutes[j].min);
    best = Math.max(best, low);
  }
  return best;
}

/** Share of [from, to) during which at least `level` spans were open (exact, not per minute). */
export function shareAtOrAbove(list, level, from, to) {
  if (to <= from) return null;
  const points = steps(list, from, to);
  let held = 0;
  let current = 0;
  let previous = from;
  for (const [at, next] of points) {
    if (current >= level) held += at - previous;
    current = next;
    previous = at;
  }
  if (current >= level) held += to - previous;
  return held / (to - from);
}

export function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(p / 100 * sorted.length) - 1)] : null;
}

/** Slot-minutes inside [from, to) per key; shares are fractions of the total and sum to 1. */
export function slotShares(executing, key, from, to) {
  const totals = new Map();
  for (const span of executing) {
    const used = Math.min(span.end, to) - Math.max(span.start, from);
    if (used <= 0) continue;
    const name = key(span);
    totals.set(name, (totals.get(name) || 0) + used);
  }
  const all = [...totals.values()].reduce((a, b) => a + b, 0);
  return [...totals].map(([name, ms]) => ({ name, minutes: ms / minute, share: all ? ms / all : 0 }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
}

/**
 * Draft state of a PR at time t, rebuilt from its current `draft` flag and the
 * timeline's `ready_for_review` / `convert_to_draft` events. Returns null when unknown.
 */
export function draftAt(pr, t) {
  if (!pr || typeof pr.draft !== 'boolean' || !Array.isArray(pr.events)) return null;
  const flips = pr.events.filter(e => e.event === 'ready_for_review' || e.event === 'convert_to_draft')
    .map(e => ({ at: stamp(e.created_at), draft: e.event === 'convert_to_draft' }))
    .filter(e => Number.isFinite(e.at)).sort((a, b) => a.at - b.at);
  const before = flips.filter(e => e.at <= t).at(-1);
  if (before) return before.draft;
  const after = flips.find(e => e.at > t);
  return after ? !after.draft : pr.draft;
}

/** The event bucket a run's slots count under; pull_request splits by draft state at run creation. */
export function eventClass(run, prs = new Map()) {
  if (run.event !== 'pull_request') return run.event || '(unknown event)';
  const number = run.pull_requests?.[0]?.number ?? prs.get(`head:${run.head_branch}`);
  const draft = draftAt(prs.get(number), stamp(run.created_at));
  return draft === null ? 'pull_request (draft state unknown)' : draft ? 'pull_request draft' : 'pull_request ready';
}

/**
 * The level executing sits at while jobs wait for a runner: the most common
 * per-minute maximum over the minutes with a job queued (a tie goes to the
 * higher level). A binding cap shows here as one level held for hours; a
 * momentary burst does not move it. Null when no job ever queued.
 */
export function saturationLevel(exec, queue) {
  const counts = new Map();
  exec.forEach((m, i) => { if (queue[i]?.start > 0) counts.set(m.max, (counts.get(m.max) || 0) + 1); });
  const waiting = [...counts.values()].reduce((x, y) => x + y, 0);
  const [level, minutes] = [...counts].sort(([l1, n1], [l2, n2]) => n2 - n1 || l2 - l1)[0] || [null, 0];
  return { level, minutes, waiting };
}

/**
 * Which plan cap the saturation level matches: within ±5% (at least 1) of the
 * cap, for second-level timestamp overlap at runner handover. Otherwise none,
 * with the smallest cap the level does not exceed.
 */
export function planCapMatch(level, caps = PLAN_CAPS) {
  if (level === null) return { cap: null, smallestConsistent: null };
  for (const cap of caps) {
    const tolerance = Math.max(1, Math.round(cap * 0.05));
    if (Math.abs(level - cap) <= tolerance) return { cap, tolerance };
  }
  return { cap: null, smallestConsistent: caps.find(cap => cap >= level) ?? null };
}

/** Phantom runs held a slot only if one of their jobs ever got a runner. */
export function phantomVerdict(phantoms) {
  const checked = phantoms.filter(r => Array.isArray(r.jobs));
  const jobs = checked.flatMap(r => r.jobs);
  const held = jobs.filter(heldSlot);
  return { runs: phantoms.length, checked: checked.length, jobs: jobs.length, held: held.length,
    heldSlot: checked.length ? held.length > 0 : null };
}

/** The CI workflow whose merge-group runs are merge candidates (#6676). */
export const CI_PATH = '.github/workflows/ci.yml';
export const LANDING_GATE = 'landing gate';

/**
 * #6676 — HOW LONG A MERGE CANDIDATE WAITS. For every `merge_group` run of
 * `ci.yml` created in [from, to): minutes from the run's creation to the
 * first of its jobs that got a runner (any attempt), and to the first
 * `landing gate` job that finished with a result. A run whose jobs never got
 * a runner, or whose gate never finished, is counted as `noRunner` /
 * `noGate` rather than given a made-up wait. Grouped by the UTC hour the run
 * was created, plus an all-hours row; p50 and p90 by `percentile`.
 */
export function mergeStartWait(runs, from, to) {
  const rows = [];
  for (const run of runs || []) {
    if (run.event !== 'merge_group' || run.path !== CI_PATH) continue;
    const created = stamp(run.created_at);
    if (!Number.isFinite(created) || created < from || created >= to) continue;
    const jobs = run.jobs || [];
    const starts = jobs.filter(heldSlot).map(j => stamp(j.started_at)).filter(t => Number.isFinite(t) && t >= created);
    const gates = jobs.filter(j => j.name === LANDING_GATE && j.status === 'completed' && j.conclusion && j.conclusion !== 'skipped')
      .map(j => stamp(j.completed_at)).filter(t => Number.isFinite(t) && t >= created);
    rows.push({
      hour: new Date(created).getUTCHours(),
      start: starts.length ? (Math.min(...starts) - created) / minute : null,
      gate: gates.length ? (Math.min(...gates) - created) / minute : null,
    });
  }
  const summarise = list => ({
    runs: list.length,
    startP50: percentile(list.map(r => r.start).filter(v => v !== null), 50),
    startP90: percentile(list.map(r => r.start).filter(v => v !== null), 90),
    gateP50: percentile(list.map(r => r.gate).filter(v => v !== null), 50),
    gateP90: percentile(list.map(r => r.gate).filter(v => v !== null), 90),
    noRunner: list.filter(r => r.start === null).length,
    noGate: list.filter(r => r.gate === null).length,
  });
  const hours = [...new Set(rows.map(r => r.hour))].sort((a, b) => a - b)
    .map(hour => ({ hour, ...summarise(rows.filter(r => r.hour === hour)) }));
  return { all: summarise(rows), hours };
}

export function analyse({ runs, prs = new Map(), from, to, now, hold = HOLD_MINUTES }) {
  const { executing, queued } = spans(runs, now);
  const exec = perMinute(executing, from, to);
  const queue = perMinute(queued, from, to);
  const peak = exec.reduce((a, m) => Math.max(a, m.max), 0);
  const saturation = saturationLevel(exec, queue);
  const ceiling = saturation.level;
  const cap = planCapMatch(ceiling);
  const over = ceiling === null ? 0 : ceiling + (cap.tolerance || 0);
  const queuedStarts = queue.map(m => m.start);
  const above = ceiling === null ? [] : exec.filter(m => m.min > over);
  // The longest unbroken stretch of minutes above the ceiling.
  let burst = null;
  for (let i = 0, run = null; i < exec.length; i++) {
    if (ceiling === null || exec[i].min <= over) { run = null; continue; }
    run = run ? { ...run, last: exec[i].at, minutes: run.minutes + 1 } : { first: exec[i].at, last: exec[i].at, minutes: 1 };
    if (!burst || run.minutes > burst.minutes) burst = run;
  }
  return {
    minutes: exec.length, jobs: executing.length, peak, held: effectiveCeiling(exec, hold), ceiling, saturation,
    shareAtCeiling: ceiling ? shareAtOrAbove(executing, ceiling, from, to) : null,
    minutesAboveCeiling: above.length, longestAbove: burst,
    meanExecuting: exec.length ? exec.reduce((a, m) => a + m.start, 0) / exec.length : null,
    queued: { p50: percentile(queuedStarts, 50), p90: percentile(queuedStarts, 90), max: queue.reduce((a, m) => Math.max(a, m.max), 0),
      minutesWithQueue: queuedStarts.filter(Boolean).length,
      minutesQueuedBelowCeiling: ceiling === null ? null : queue.filter((m, i) => m.start > 0 && exec[i].max < ceiling).length,
      neverStarted: queued.filter(s => !heldSlot(s.job)).length },
    workflows: slotShares(executing, s => s.run.name || s.run.path || '(unnamed workflow)', from, to),
    events: slotShares(executing, s => eventClass(s.run, prs), from, to),
    labels: slotShares(executing, s => (s.job.labels || []).join(',') || '(no labels)', from, to),
    mergeWait: mergeStartWait(runs, from, to),
    cap,
  };
}

const pct = x => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
const iso = t => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
const mins = x => (x === null ? 'n/a' : x.toFixed(1));

/** #6676: the merge-candidate wait table, per UTC hour of creation, with an all-hours row. */
function mergeWaitSection(wait) {
  if (!wait) return [];
  const line = (label, x) => `| ${label} | ${x.runs} | ${mins(x.startP50)} | ${mins(x.startP90)} | ${mins(x.gateP50)} | ${mins(x.gateP90)} | ${x.noRunner} | ${x.noGate} |`;
  return [
    '### Merge candidates: wait for a runner and for the landing gate (#6676)', '',
    `\`merge_group\` runs of \`${CI_PATH}\`, by UTC hour the run was created. Minutes from run creation to the first job with a runner, and to the first finished \`${LANDING_GATE}\` job.`, '',
    '| Hour (UTC) | Runs | Start wait p50 | Start wait p90 | Gate p50 | Gate p90 | No runner | No gate result |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...wait.hours.map(h => line(`${String(h.hour).padStart(2, '0')}:00`, h)),
    line('**All hours**', wait.all), '',
  ];
}

export function report({ result, coverage, phantom }) {
  const r = result;
  const capLine = r.ceiling === null
    ? 'No job queued in the window, so no cap was reached and the measurement matches none of the plan caps.'
    : r.cap.cap
      ? `The effective ceiling of **${r.ceiling}** matches the **${r.cap.cap}-job** plan cap (within ±${r.cap.tolerance}).`
        + (r.minutesAboveCeiling ? ` Executing stayed above ${r.cap.cap + r.cap.tolerance} for ${r.minutesAboveCeiling} whole minutes, the longest stretch ${r.longestAbove.minutes} minutes from ${iso(r.longestAbove.first)} (peak ${r.peak}), which a fixed ${r.cap.cap}-job cap does not explain.` : '')
      : `The effective ceiling of **${r.ceiling}** matches **none** of the plan caps (${PLAN_CAPS.join(', ')})`
        + (r.cap.smallestConsistent ? `; the smallest cap it does not exceed is ${r.cap.smallestConsistent}.` : '; it exceeds every listed cap.');
  const phantomLine = phantom.heldSlot === null
    ? `Phantom runs: ${phantom.runs} found, none of their job lists could be read — unknown.`
    : `Phantom runs: ${phantom.runs} runs still queued and created before ${iso(coverage.phantomBefore ?? coverage.listedFrom)}; ${phantom.checked} job lists read, ${phantom.jobs} jobs, ${phantom.held} with a runner. `
      + (phantom.heldSlot ? '**They did hold slots.**' : '**They never held a slot**' + (phantom.jobs ? ' (their jobs never got a runner).' : ' (they have no jobs at all).'))
      + (phantom.checked < phantom.runs ? ` ${phantom.runs - phantom.checked} were not read (request cap).` : '');
  const rows = list => list.map(x => `| ${x.name.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} | ${x.minutes.toFixed(0)} | ${pct(x.share)} |`);
  return [
    '## Effective Actions concurrency (#6462)', '',
    `Window measured: ${iso(coverage.from)} to ${iso(coverage.to)} (${(r.minutes / 60).toFixed(1)} h of the ${coverage.requestedHours} h asked; ${pct(coverage.fraction)}). `
      + `Runs listed from ${iso(coverage.listedFrom)} (${coverage.leadMinutes} min lead-in for jobs that started inside the window): ${coverage.runs} runs, ${coverage.runsWithJobs} job lists read, ${r.jobs} executing job spans.`,
    `API: ${coverage.requests} GET requests (${coverage.pages.runs} run-list pages, ${coverage.pages.jobs} job pages, ${coverage.pages.prs} PR pages, ${coverage.pages.phantom} phantom job pages) of a ${coverage.cap}-request cap.`, '',
    '| Measure | Value |', '| --- | --- |',
    `| Effective ceiling (level executing sat at while jobs queued) | **${r.ceiling ?? 'not reached'}** (${r.saturation.minutes} of ${r.saturation.waiting} queued minutes) |`,
    `| Peak jobs executing at once | ${r.peak} |`,
    `| Highest level held ≥ ${HOLD_MINUTES} min | ${r.held} |`,
    `| Share of time at or above the ceiling | ${pct(r.shareAtCeiling)} |`,
    `| Whole minutes above the ceiling's tolerance | ${r.minutesAboveCeiling} |`,
    `| Mean jobs executing (per-minute sample) | ${r.meanExecuting === null ? 'n/a' : r.meanExecuting.toFixed(1)} |`,
    `| Queued jobs per minute | p50 ${r.queued.p50 ?? 'n/a'}, p90 ${r.queued.p90 ?? 'n/a'}, max ${r.queued.max} |`,
    `| Minutes with any job queued | ${r.queued.minutesWithQueue} of ${r.minutes} (${r.queued.minutesQueuedBelowCeiling ?? 'n/a'} of them with executing below the ceiling all minute) |`,
    `| Jobs that queued and never got a runner | ${r.queued.neverStarted} |`, '',
    capLine, '', phantomLine, '',
    '### Top five workflows by slot use', '', '| Workflow | Slot-minutes | Share |', '| --- | --- | --- |', ...rows(r.workflows.slice(0, 5)),
    `| (all ${r.workflows.length} workflows) | ${r.workflows.reduce((a, x) => a + x.minutes, 0).toFixed(0)} | 100% |`, '',
    '### Slot use by event', '', '| Event | Slot-minutes | Share |', '| --- | --- | --- |', ...rows(r.events), '',
    ...mergeWaitSection(r.mergeWait),
    `Runner labels: ${r.labels.map(x => `${x.name} ${pct(x.share)}`).join(', ') || 'none'}.`, '',
    'Method: the effective ceiling is the most common per-minute maximum of jobs executing over the minutes in which at least one job was queued, so a cap that binds shows as one level held for hours and a short burst does not move it. A job counts as executing from `started_at` to `completed_at` only when a runner picked it up (`runner_id`/`runner_name` set); '
      + 'GitHub fills `started_at` on queued jobs too, so a job with no runner counts as queued from `created_at` until it ends. Skipped jobs count as neither. '
      + 'Draft vs ready is the PR\'s state when the run was created, rebuilt from its current `draft` flag and its timeline\'s `ready_for_review`/`convert_to_draft` events. '
      + 'Re-runs of runs created before the lead-in are not listed and are missed.',
  ].join('\n');
}
