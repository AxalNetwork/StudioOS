import * as ci from './ciClassify.mjs';

const minute = 60_000;
const stamp = Date.parse;
const failed = job => ['failure', 'timed_out'].includes(job.conclusion);
const complete = run => run.status === 'completed';
const queueCi = run => run.event === 'merge_group' && run.path === '.github/workflows/ci.yml';
const mainCi = run => run.event === 'push' && run.head_branch === 'main' && run.path === '.github/workflows/ci.yml';
const minutes = (start, end) => {
  const value = (stamp(end) - stamp(start)) / minute;
  return Number.isFinite(value) && value >= 0 ? value : null;
};
const mean = xs => ({ n: xs.length, value: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null });
const timings = xs => ({ p50: percentile(xs, 50), p90: percentile(xs, 90) });
const leafFailures = run => (run.jobs || []).filter(job => failed(job) && job.name !== 'test:drift (full suite)');

export function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return { n: sorted.length, value: sorted.length ? sorted[Math.max(0, Math.ceil(p / 100 * sorted.length) - 1)] : null };
}

export function prFeedback(runs) {
  return timings(runs.filter(r => !r.priorAttempt && r.event === 'pull_request' && r.path === '.github/workflows/ci.yml'
    && complete(r) && r.conclusion !== 'cancelled' && r.conclusion !== 'skipped')
    .map(r => minutes(r.created_at, r.updated_at)));
}

export function runnerWait(runs) {
  const groups = new Map();
  for (const run of runs) for (const job of run.jobs || []) {
    const name = ci.safeJobName(job.name);
    const wait = minutes(job.created_at, job.started_at);
    if (!name || wait === null || job.conclusion === 'skipped') continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(wait);
  }
  return Object.fromEntries([...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, xs]) => [name, timings(xs)]));
}

/** Last entry to merged: the time a PR spent in the queue on the entry that landed it. */
export function queueToMerge(prs) {
  return timings(prs.filter(p => p.mergedAt && p.entries?.length)
    .map(p => minutes(p.entries.at(-1).start, p.mergedAt)));
}

/*
 * D6678: the queue clock from the first entry. `allEntries` holds every entry
 * the PR's timeline shows, before the window filter, so an ejection and
 * re-entry keeps the time spent before it.
 */
const everyEntry = p => p.allEntries || p.entries || [];
const mergedQueued = prs => prs.filter(p => p.mergedAt && everyEntry(p).length);

export function queueToMergeFirst(prs) {
  return timings(mergedQueued(prs).map(p => minutes(everyEntry(p)[0].start, p.mergedAt)));
}

export function entriesPerMergedPr(prs) {
  const counts = mergedQueued(prs).map(p => everyEntry(p).length);
  return { ...timings(counts), firstEntry: mean(counts.map(n => Number(n === 1))) };
}

/** Workflows whose pull_request runs carry main's required checks (D6678). */
export const REQUIRED_WORKFLOWS = ['.github/workflows/ci.yml', '.github/workflows/gitleaks.yml', '.github/workflows/migration-immutability.yml'];

/**
 * When the merged head went green: the latest pull_request run of each
 * required workflow on that SHA must have completed with success; the time is
 * the last of their completions. Anything else is null (not measurable).
 */
export function greenAt(headRuns, sha) {
  const latest = new Map();
  for (const run of headRuns || []) {
    if (run.event !== 'pull_request' || run.head_sha !== sha || !REQUIRED_WORKFLOWS.includes(run.path)) continue;
    const prev = latest.get(run.path);
    if (!prev || stamp(run.created_at) > stamp(prev.created_at)) latest.set(run.path, run);
  }
  if (REQUIRED_WORKFLOWS.some(path => !latest.has(path))) return null;
  const runs = [...latest.values()];
  if (runs.some(run => !complete(run) || run.conclusion !== 'success')) return null;
  return runs.map(run => run.updated_at).sort((a, b) => stamp(a) - stamp(b)).at(-1);
}

/**
 * When the PR was last made ready before it merged: its last
 * `ready_for_review`, or its creation when it was never a draft. Null when
 * that cannot be told.
 */
export function readyAt(events, { createdAt, mergedAt }) {
  const before = (events || []).filter(e => !mergedAt || stamp(e.created_at) <= stamp(mergedAt));
  const ready = before.filter(e => e.event === 'ready_for_review').map(e => e.created_at).sort((a, b) => stamp(a) - stamp(b)).at(-1);
  if (ready) return ready;
  if (before.some(e => e.event === 'convert_to_draft')) return null;
  return createdAt || null;
}

/** Ready and green to merged; a PR with no ready or green time is counted, never dropped. */
export function readyGreenToMerged(prs) {
  const merged = prs.filter(p => p.mergedAt);
  const values = merged.map(p => p.readyAt && p.greenAt
    ? minutes(stamp(p.readyAt) > stamp(p.greenAt) ? p.readyAt : p.greenAt, p.mergedAt) : null);
  const measured = values.filter(v => v !== null);
  return { ...timings(measured), notMeasurable: merged.length - measured.length };
}

/** A job got a runner only when GitHub names one: a queued or skipped job carries a start time but runner id 0 or null. */
const hasRunner = job => Number(job.runner_id) > 0 && Boolean(job.started_at);

/** Merge-queue CI runs: run creation to the first job that got a runner. */
export function candidateStartWait(queueRuns) {
  const sampled = queueRuns.filter(r => !r.priorAttempt && queueCi(r) && Array.isArray(r.jobs));
  const waits = [];
  let noRunner = 0;
  for (const run of sampled) {
    const first = run.jobs.filter(hasRunner).map(j => j.started_at).sort((a, b) => stamp(a) - stamp(b))[0];
    const wait = first ? minutes(run.created_at, first) : null;
    if (wait === null) noRunner++;
    else waits.push(wait);
  }
  return { ...timings(waits), noRunner, sampled: sampled.length };
}

/** Merges in each whole UTC hour of the window: the peak hour and the median hour, empty hours included. */
export function mergesPerHour(prs, start, now) {
  const hour = 3_600_000;
  const slots = Math.floor((now - start) / hour);
  if (slots < 1) return { n: 0, peak: null, median: null, hours: 0 };
  const counts = Array(slots).fill(0);
  let n = 0;
  for (const p of prs) {
    const i = Math.floor((stamp(p.mergedAt) - start) / hour);
    if (p.mergedAt && i >= 0 && i < slots) { counts[i]++; n++; }
  }
  const sorted = [...counts].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return { n, hours: slots, peak: sorted.at(-1), median: sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2 };
}

function earlyInfra(job) {
  const step = ci.safeJobName(job.steps?.find(s => s.conclusion === 'failure')?.name);
  return /^(?:Set up job|Run actions\/(?:checkout|setup-node)@[\w.-]+|(?:Run )?npm ci|Install [\w .-]+)$/.test(step);
}

export function failureClasses(runs) {
  const counts = { pr: 0, inherited: 0, unknown: 0, infra: 0, flaky: 0 };
  for (const run of runs) {
    if (!complete(run)) continue;
    const base = runs.filter(r => !r.priorAttempt && r.event === 'push' && r.head_branch === 'main' && r.path === run.path
      && complete(r) && stamp(r.updated_at) <= stamp(run.created_at)).sort((a, b) => stamp(b.updated_at) - stamp(a.updated_at))[0];
    const main = base?.jobs ? { conclusion: base.conclusion, jobs: base.jobs } : null;
    const failedJobs = leafFailures(run);
    for (const job of failedJobs) {
      const laterPassed = (run.laterJobs || []).some(x => x.name === job.name && x.conclusion === 'success');
      if (laterPassed) { counts.flaky++; continue; }
      if (ci.infraFingerprint?.([job]) || (!ci.infraFingerprint && earlyInfra(job))) { counts.infra++; continue; }
      const verdict = run.event === 'pull_request' ? ci.classify({ pr: [job], main }).verdict : 'main_health_unknown';
      counts[({ pr_failure: 'pr', inherited_main_failure: 'inherited', main_health_unknown: 'unknown' })[verdict]]++;
    }
  }
  return { n: Object.values(counts).reduce((a, b) => a + b, 0), counts };
}

const queuePr = run => Number(/^gh-readonly-queue\/main\/pr-(\d+)(?:-|$)/.exec(run.head_branch || '')?.[1]);
const inEntries = (run, pr) => pr.entries.some(entry => stamp(entry.start) <= stamp(run.created_at)
  && (!entry.end || stamp(run.created_at) <= stamp(entry.end)));

/*
 * D6678: queue CI runs per PR, from the full merge_group listing of ci.yml
 * (`queueRuns`), over PRs whose every entry started inside the window, so no
 * entry's runs fall before the listing. The all-workflow listing stops at 1000
 * runs, about the last three hours of a busy day, which is why this row read
 * 0.0 when it was counted from it.
 */
export function runsPerQueuedPr(queueRuns, prs, start) {
  return mean(prs.filter(p => everyEntry(p).length && everyEntry(p).every(e => stamp(e.start) >= start))
    .map(p => queueRuns.filter(r => !r.priorAttempt && queueCi(r) && queuePr(r) === p.number && inEntries(r, { entries: everyEntry(p) })).length));
}

export function runnerMinPerMergedPr(runs, prs) {
  const merged = prs.filter(p => p.mergedAt);
  const jobs = runs.flatMap(run => (run.jobs || []).filter(j => j.conclusion !== 'skipped')
    .map(j => ({ key: `${ci.safeJobName(run.name) || '(unshown workflow)'} / ${ci.safeJobName(run.event) || '(unshown event)'}`, duration: minutes(j.started_at, j.completed_at) }))
    .filter(j => j.duration !== null));
  const n = merged.length;
  const total = jobs.reduce((sum, j) => sum + j.duration, 0);
  const by = new Map();
  for (const j of jobs) by.set(j.key, (by.get(j.key) || 0) + j.duration);
  return { n, jobs: jobs.length, value: n && jobs.length ? total / n : null,
    breakdown: Object.fromEntries([...by].sort().map(([name, value]) => [name, n ? value / n : null])) };
}

const span = (a, b, start, end) => {
  const low = Math.max(stamp(a), start);
  const high = Math.min(stamp(b), end);
  return low < high ? [low, high] : null;
};
const jobSpans = (runs, start, end, now) => runs.flatMap(run => (run.jobs || [])
  .filter(j => j.conclusion !== 'skipped' && (j.completed_at || j.status === 'in_progress'))
  .map(j => span(j.started_at, j.completed_at || new Date(now).toISOString(), start, end)).filter(Boolean));
function sweep(queued, busy) {
  const points = new Map();
  for (const [spans, index] of [[queued, 0], [busy, 1]]) for (const [start, end] of spans) {
    for (const [at, delta] of [[start, 1], [end, -1]]) {
      const pair = points.get(at) || [0, 0];
      pair[index] += delta;
      points.set(at, pair);
    }
  }
  let previous = null, q = 0, b = 0, peak = 0, idle = 0;
  for (const [at, [dq, db]] of [...points].sort(([a], [b]) => a - b)) {
    if (previous !== null && q && !b) idle += at - previous;
    q += dq;
    b += db;
    peak = Math.max(peak, b);
    previous = at;
  }
  return { peak, idle };
}

export function queueStalledMinutes(runs, prs, start, now) {
  const queued = prs.flatMap(p => p.entries.map(e => span(e.start, e.end || new Date(now).toISOString(), start, now))).filter(Boolean);
  const queueRuns = runs.filter(queueCi);
  const busy = jobSpans(queueRuns, start, now, now);
  return { n: queued.length, jobs: busy.length, value: queued.length && queueRuns.every(r => Array.isArray(r.jobs))
    ? sweep(queued, busy).idle / minute : null };
}

export function peakConcurrentJobs(runs, start, now) {
  const busy = jobSpans(runs, start, now, now);
  return { n: busy.length, value: busy.length ? sweep([], busy).peak : null };
}

export function pushesWithoutQueueRun(runs) {
  const pushes = new Set(runs.filter(r => !r.priorAttempt && mainCi(r) && r.head_sha).map(r => r.head_sha));
  const green = new Set(runs.filter(r => !r.priorAttempt && queueCi(r) && complete(r) && r.conclusion === 'success').map(r => r.head_sha));
  return { n: pushes.size, value: pushes.size ? [...pushes].filter(sha => !green.has(sha)).length : null };
}

export function cancelledShare(runs) {
  const completed = runs.filter(r => !r.priorAttempt && complete(r));
  return mean(completed.map(r => Number(r.conclusion === 'cancelled')));
}

const show = ({ value, n }, scale = 1) => value === null ? `n/a (n=${n})` : `${(value * scale).toFixed(1)} (n=${n})`;
const pair = result => `p50 ${show(result.p50)}, p90 ${show(result.p90)}`;

export function report({ runs, queueRuns = [], prs, start, now, requests, queueListingComplete = true }) {
  const waits = runnerWait(runs);
  const entries = entriesPerMergedPr(prs);
  const ready = readyGreenToMerged(prs);
  const candidate = candidateStartWait(queueRuns);
  const hourly = mergesPerHour(prs, start, now);
  const failures = failureClasses(runs);
  const cost = runnerMinPerMergedPr(runs, prs);
  const stalls = queueStalledMinutes(runs, prs, start, now);
  return [
    '## Daily CI scorecard', '',
    `Window: ${new Date(start).toISOString()} to ${new Date(now).toISOString()}`,
    `Coverage: ${runs.length} workflow runs, ${queueRuns.length} merge-queue CI runs, ${new Set([...runs, ...queueRuns].filter(r => Array.isArray(r.jobs)).map(r => r.id ?? r)).size} with jobs, ${prs.length} PR timelines, ${requests} GET requests. Sampled job counts and runner minutes may understate total usage.`, '',
    '| Metric | Sample |', '| --- | --- |',
    `| PR feedback (min) | ${pair(prFeedback(runs))} |`,
    `| Runner wait (min) | ${Object.keys(waits).length ? Object.entries(waits).map(([name, v]) => `${name}: ${pair(v)}`).join('<br>') : 'n/a (n=0)'} |`,
    `| Queue to merge, from the first entry (min) | ${pair(queueToMergeFirst(prs))} |`,
    `| Queue to merge, from the last entry (min) | ${pair(queueToMerge(prs))} |`,
    `| Entries per merged PR | ${pair(entries)}; merged on the first entry (%) ${show(entries.firstEntry, 100)} |`,
    `| Ready and green to merged (min) | ${pair(ready)}; not measurable ${ready.notMeasurable} |`,
    `| Candidate start wait (min) | ${pair(candidate)}; no runner yet ${candidate.noRunner} of ${candidate.sampled} sampled queue runs |`,
    `| Merges per hour | ${hourly.n ? `peak ${hourly.peak}, median ${hourly.median}` : 'n/a'} (n=${hourly.n} merges, ${hourly.hours} hours) |`,
    `| Failed jobs by class | ${failures.n ? Object.entries(failures.counts).map(([k, v]) => `${k} ${v}`).join(', ') : 'n/a'} (n=${failures.n}) |`,
    `| Queue CI runs per PR (entries inside the window) | ${show(runsPerQueuedPr(queueRuns, prs, start))}${queueListingComplete ? '' : ', queue listing incomplete'} |`,
    `| Runner minutes per merged PR | ${show(cost)} (${cost.jobs} jobs)${Object.entries(cost.breakdown).map(([name, value]) => `<br>${name}: ${value === null ? 'n/a' : value.toFixed(1)}`).join('')} |`,
    `| Queue stalled (min) | ${show(stalls)} (${stalls.jobs} queue job spans) |`,
    `| Peak observed concurrent jobs | ${show(peakConcurrentJobs(runs, start, now))} |`,
    `| Main push SHAs without a green queue run | ${show(pushesWithoutQueueRun(runs))} |`,
    `| Cancelled run share (%) | ${show(cancelledShare(runs), 100)} |`,
  ].join('\n');
}
