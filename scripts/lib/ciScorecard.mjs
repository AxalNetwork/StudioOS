import * as ci from './ciClassify.mjs';
import { REQUIRED } from './requiredChecks.mjs';

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

export function queueToMerge(prs) {
  return timings(prs.filter(p => p.mergedAt && p.entries?.length)
    .map(p => minutes(p.entries.at(-1).start, p.mergedAt)));
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

export function runsPerQueuedPr(runs, prs) {
  return mean(prs.filter(p => p.entries.length).map(p => runs.filter(r => !r.priorAttempt && queueCi(r) && queuePr(r) === p.number && inEntries(r, p)).length));
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

// D5973 (#5973): the request plan. Each phase stops when the running count
// reaches its line, so the comment (up to ten pages and one write) always fits
// under the cap. `ci-scorecard.mjs` reads these and states no other number.
export const BUDGET = Object.freeze({ cap: 200, runPages: 10, rules: 1, jobsUntil: 145, prPages: 2, timelinesUntil: 185, commentPages: 10, writes: 1 });

// The workflows whose merge_group jobs report a required check.
export const QUEUE_WORKFLOWS = Object.freeze([...new Set(Object.values(REQUIRED))].sort().map(f => `.github/workflows/${f}`));
export const OUTCOMES = Object.freeze(['deadline-expired', 'failed-check', 'cancelled-or-superseded', 'merged', 'missing-evidence']);
// GitHub removes an expired entry at about its deadline; a removal later than
// this after it is not read as the deadline's.
export const DEADLINE_SLACK_MIN = 15;
const queueRun = run => run.event === 'merge_group' && QUEUE_WORKFLOWS.includes(run.path);
const isSha = sha => /^[0-9a-f]{40}$/.test(sha || '');

/** Queue entries from one PR timeline: start, end, the event that ended it and the reason GitHub recorded (REST gives none today). */
export function queueEntries(events) {
  const entries = [];
  let current = null;
  for (const event of [...events].sort((a, b) => stamp(a.created_at) - stamp(b.created_at))) {
    if (event.event === 'added_to_merge_queue' && !current) {
      current = { start: event.created_at, end: null, endEvent: null, reason: null };
      entries.push(current);
    } else if (['removed_from_merge_queue', 'merged', 'closed'].includes(event.event) && current) {
      Object.assign(current, { end: event.created_at, endEvent: event.event,
        reason: typeof event.reason === 'string' && event.reason.trim() ? event.reason.trim().slice(0, 200) : null });
      current = null;
    }
  }
  return entries;
}

/** The commit a PR's `merged` timeline event names, or null. */
export const mergeCommit = events => {
  const sha = events.findLast(e => e.event === 'merged')?.commit_id;
  return isSha(sha) ? sha : null;
};

/** The merge queue's response deadline in minutes from `GET rules/branches/main`, or null when unread. */
export function queueDeadline(rules) {
  const value = Array.isArray(rules) ? rules.find(r => r?.type === 'merge_queue')?.parameters?.check_response_timeout_minutes : null;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function outcome({ runsAt, required, sampled, removal, removedAt, elapsed, mergedHere, mergedElsewhere, deadline }) {
  const by = at => !removedAt || stamp(at) <= stamp(removedAt);
  if (mergedHere) return ['merged', 'the PR timeline merged this commit'];
  const failedJob = required.find(j => failed(j) && by(j.completed_at));
  if (failedJob) return ['failed-check', `${failedJob.name} concluded ${failedJob.conclusion}`];
  const failedRun = runsAt.find(r => complete(r) && ['failure', 'timed_out'].includes(r.conclusion) && by(r.updated_at));
  if (failedRun) return ['failed-check', `${failedRun.path.split('/').pop()} concluded ${failedRun.conclusion}`];
  if (removal?.reason && /time[ds]?[ -]?out|deadline/i.test(removal.reason)) return ['deadline-expired', 'GitHub recorded a timeout reason'];
  const pending = sampled && removedAt ? required.filter(j => !j.completed_at || stamp(j.completed_at) > stamp(removedAt)).map(j => j.name) : [];
  if (deadline && pending.length && elapsed !== null && elapsed >= deadline && elapsed <= deadline + DEADLINE_SLACK_MIN) {
    return ['deadline-expired', `removed ${elapsed.toFixed(1)} min after the request, past the ${deadline} min deadline, with ${pending.join(', ')} pending`];
  }
  if (runsAt.some(r => r.conclusion === 'cancelled')) return ['cancelled-or-superseded', 'a queue run was cancelled'];
  if (sampled && removedAt && mergedElsewhere) return ['cancelled-or-superseded', 'removed, and the PR merged as another commit'];
  if (sampled && removedAt && deadline && elapsed !== null && elapsed < deadline) {
    return ['cancelled-or-superseded', `removed ${elapsed.toFixed(1)} min after the request, before the ${deadline} min deadline, with no failed required check`];
  }
  return ['missing-evidence', [!sampled && 'required jobs not sampled', !removedAt && 'no queue removal or merge recorded',
    !deadline && 'deadline unread'].filter(Boolean).join('; ') || 'no rule matched'];
}

/**
 * One row per merge_group head SHA: request time (first queue run created),
 * first runner start, wait and runtime of the last required check to finish,
 * queue entry and removal from the PR timeline, the recorded reason, and one
 * outcome from OUTCOMES. `deadline-expired` needs a recorded timeout reason,
 * or every required job sampled with one still pending at a removal that came
 * at the deadline; anything short of that is `missing-evidence`.
 */
export function candidateRows({ runs, prs, deadline }) {
  const names = Object.keys(REQUIRED);
  const shas = [...new Set(runs.filter(r => !r.priorAttempt && queueRun(r) && isSha(r.head_sha)).map(r => r.head_sha))];
  return shas.map(sha => {
    const runsAt = runs.filter(r => !r.priorAttempt && queueRun(r) && r.head_sha === sha);
    const requestedAt = runsAt.map(r => r.created_at).sort((a, b) => stamp(a) - stamp(b))[0];
    const number = runsAt.map(queuePr).find(Number.isSafeInteger) ?? null;
    const jobs = runsAt.flatMap(r => r.jobs || []);
    const required = names.map(name => jobs.find(j => j.name === name)).filter(Boolean);
    const sampled = QUEUE_WORKFLOWS.every(path => runsAt.some(r => r.path === path && Array.isArray(r.jobs))) && required.length === names.length;
    const starts = jobs.filter(j => j.conclusion !== 'skipped' && j.started_at).map(j => j.started_at).sort((a, b) => stamp(a) - stamp(b));
    const last = sampled && required.every(j => j.completed_at)
      ? [...required].sort((a, b) => stamp(b.completed_at) - stamp(a.completed_at))[0] : null;
    const pr = prs.find(p => p.number === number);
    const entry = pr?.entries.find(e => stamp(e.start) <= stamp(requestedAt) && (!e.end || stamp(requestedAt) <= stamp(e.end))) || null;
    const removedAt = entry?.end || null;
    const elapsed = removedAt ? minutes(requestedAt, removedAt) : null;
    const [kind, evidence] = outcome({ runsAt, required, sampled, removal: entry, removedAt, elapsed, deadline,
      mergedHere: pr?.mergeCommit === sha, mergedElsewhere: Boolean(pr?.mergeCommit) && pr.mergeCommit !== sha });
    return {
      headSha: sha, pr: number, requestedAt, firstRunnerStartedAt: starts[0] || null,
      lastRequired: last ? { name: last.name, completedAt: last.completed_at,
        waitMinutes: minutes(last.created_at, last.started_at), runtimeMinutes: minutes(last.started_at, last.completed_at) } : null,
      queueEnteredAt: entry?.start || null, queueRemovedAt: removedAt, removalEvent: entry?.endEvent || null,
      removalReason: entry?.reason || null, outcome: kind, evidence,
    };
  }).sort((a, b) => stamp(a.requestedAt) - stamp(b.requestedAt) || a.headSha.localeCompare(b.headSha));
}

export function outcomeCounts(rows) {
  return { n: rows.length, counts: Object.fromEntries(OUTCOMES.map(k => [k, rows.filter(r => r.outcome === k).length])) };
}

const show = ({ value, n }, scale = 1) => value === null ? `n/a (n=${n})` : `${(value * scale).toFixed(1)} (n=${n})`;
const pair = result => `p50 ${show(result.p50)}, p90 ${show(result.p90)}`;

export function report({ runs, prs, start, now, requests, rows = candidateRows({ runs, prs, deadline: null }), deadline = null }) {
  const outcomes = outcomeCounts(rows);
  const waits = runnerWait(runs);
  const failures = failureClasses(runs);
  const cost = runnerMinPerMergedPr(runs, prs);
  const stalls = queueStalledMinutes(runs, prs, start, now);
  return [
    '## Daily CI scorecard', '',
    `Window: ${new Date(start).toISOString()} to ${new Date(now).toISOString()}`,
    `Coverage: ${runs.length} workflow runs, ${runs.filter(r => Array.isArray(r.jobs)).length} with jobs, ${prs.length} PR timelines, ${requests} GET requests. Sampled job counts and runner minutes may understate total usage.`, '',
    '| Metric | Sample |', '| --- | --- |',
    `| PR feedback (min) | ${pair(prFeedback(runs))} |`,
    `| Runner wait (min) | ${Object.keys(waits).length ? Object.entries(waits).map(([name, v]) => `${name}: ${pair(v)}`).join('<br>') : 'n/a (n=0)'} |`,
    `| Queue to merge (min) | ${pair(queueToMerge(prs))} |`,
    `| Failed jobs by class | ${failures.n ? Object.entries(failures.counts).map(([k, v]) => `${k} ${v}`).join(', ') : 'n/a'} (n=${failures.n}) |`,
    `| Runs per queued PR | ${show(runsPerQueuedPr(runs, prs))} |`,
    `| Runner minutes per merged PR | ${show(cost)} (${cost.jobs} jobs)${Object.entries(cost.breakdown).map(([name, value]) => `<br>${name}: ${value === null ? 'n/a' : value.toFixed(1)}`).join('')} |`,
    `| Queue stalled (min) | ${show(stalls)} (${stalls.jobs} queue job spans) |`,
    `| Peak observed concurrent jobs | ${show(peakConcurrentJobs(runs, start, now))} |`,
    `| Main push SHAs without a green queue run | ${show(pushesWithoutQueueRun(runs))} |`,
    `| Cancelled run share (%) | ${show(cancelledShare(runs), 100)} |`,
    `| Merge-group candidates by outcome | ${outcomes.n ? Object.entries(outcomes.counts).map(([k, v]) => `${k} ${v}`).join(', ') : 'n/a'} (n=${outcomes.n}); deadline ${deadline ? `${deadline} min` : 'unread'}; one row per head SHA in the candidates artifact |`,
  ].join('\n');
}
