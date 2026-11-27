/**
 * D5603: pure daily CI metrics over Actions jobs and PR queue timelines. D5973:
 * one row per merge-group head SHA (request, first runner start, last required
 * check's wait and runtime, queue entry and removal, recorded reason)
 * classified as `deadline-expired`, `failed-check`, `cancelled-or-superseded`,
 * `merged` or `missing-evidence`, and the scorecard's request budget. D9027:
 * the queue rows by the agent slot the PR's commit trailers name.
 */
import * as ci from './ciClassify.mjs';
import { REQUIRED } from './requiredChecks.mjs';
import { count, dispatchable, KINDS, LABELS } from '../landing-bot/rules.mjs';
import { DEFAULT_ORDER as PROVIDERS } from '../landing-bot/model/loop.mjs';

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

// D5973 part 2 (#5973, with D6678): the request plan and the job sample, one
// object. In order: the all-workflow run listing (runPages), one merge_group
// listing per queue workflow (queuePages each), main's rules, job samples until
// jobsUntil, the PR list (prPages), PR timelines (timelinePages each) and one
// head-SHA run listing per merged PR until timelinesUntil, then the tracker
// comment (commentPages and one write). The sample is wholeShas head SHAs with
// every queue workflow's run, more ci.yml queue runs up to queueCiRuns, and
// perEvent runs each of pull_request, push and other. `requestPlan` gives the
// worst case; `ci-scorecard.mjs` reads these and states no other number.
export const BUDGET = Object.freeze({ cap: 385, runPages: 10, queuePages: 5, rules: 1,
  wholeShas: 32, queueCiRuns: 74, perEvent: 12, jobsUntil: 210,
  prPages: 2, timelinePages: 3, timelinesUntil: 370, commentPages: 10, writes: 1 });

// The workflows whose merge_group jobs report a required check.
export const QUEUE_WORKFLOWS = Object.freeze([...new Set(Object.values(REQUIRED))].sort().map(f => `.github/workflows/${f}`));
/**
 * The request plan's arithmetic for `budget` (BUDGET by default), over
 * `workflows` queue workflows: requests before the job sample, the job
 * requests the full sample needs (prior attempts take what is left before
 * jobsUntil), and the worst case. A phase starts a step only below its line,
 * so the last timeline step may run its pages and head listing past it.
 */
export function requestPlan(budget = BUDGET, workflows = QUEUE_WORKFLOWS.length) {
  const b = budget;
  const listings = b.runPages + workflows * b.queuePages + b.rules;
  const sample = workflows * b.wholeShas + (b.queueCiRuns - b.wholeShas) + 3 * b.perEvent;
  const worst = b.timelinesUntil - 1 + b.timelinePages + 1 + b.commentPages + b.writes;
  return { listings, sample, jobRoom: b.jobsUntil - listings, timelineRoom: b.timelinesUntil - b.jobsUntil - b.prPages, worst };
}

export function evenlySpaced(rows, size) {
  if (rows.length <= size) return rows;
  if (size < 2) return rows.slice(0, Math.max(0, size));
  return Array.from({ length: size }, (_, i) => rows[Math.round(i * (rows.length - 1) / (size - 1))]);
}

/*
 * D5973 part 2: the job sample, in the order the collector reads it until
 * BUDGET.jobsUntil. `queueRuns` holds every queue workflow's merge_group runs,
 * one object per id; `runs` is the capped all-workflow listing.
 * 1. Up to wholeShas head SHAs, every queue workflow's run of each together,
 *    so a candidate's required checks are sampled whole: SHAs whose ci.yml
 *    queue run the all-workflow listing holds come first ("Queue stalled"
 *    needs those jobs, D6678), then SHAs evenly spaced over the rest.
 * 2. More ci.yml queue runs, listed ones first, then evenly spaced, until
 *    queueCiRuns ci.yml runs are in (D6678's candidate start wait). Their
 *    candidates read as missing evidence unless a run of theirs shows more.
 * 3. perEvent runs each of pull_request, push and other events.
 */
export function jobSample({ runs, queueRuns, budget = BUDGET }) {
  const CI = '.github/workflows/ci.yml';
  const uniq = xs => [...new Set(xs)];
  const listed = new Set(runs.map(r => r.id));
  const ci = queueRuns.filter(r => r.path === CI);
  const first = uniq(ci.filter(r => listed.has(r.id)).map(r => r.head_sha)).slice(0, budget.wholeShas);
  const rest = uniq(ci.map(r => r.head_sha)).filter(sha => !first.includes(sha));
  const shas = [...first, ...evenlySpaced(rest, budget.wholeShas - first.length)];
  const whole = shas.flatMap(sha => queueRuns.filter(r => r.head_sha === sha).sort((a, b) => String(a.path).localeCompare(String(b.path))));
  const more = ci.filter(r => !shas.includes(r.head_sha));
  const room = Math.max(0, budget.queueCiRuns - whole.filter(r => r.path === CI).length);
  const listedMore = more.filter(r => listed.has(r.id)).slice(0, room);
  return [
    ...whole,
    ...listedMore, ...evenlySpaced(more.filter(r => !listed.has(r.id)), room - listedMore.length),
    ...['pull_request', 'push', 'other'].flatMap(event => evenlySpaced(runs.filter(r => event === 'other'
      ? !['pull_request', 'push'].includes(r.event) && !queueRun(r) : r.event === event), budget.perEvent)),
  ];
}

/** Runs from several listings, one per id: the first row of an id that carries jobs, else the first. Prior attempts are left out. */
export function unionRuns(...lists) {
  const byId = new Map();
  for (const run of lists.flat()) {
    if (!run || run.priorAttempt) continue;
    const key = run.id ?? run;
    if (!byId.has(key) || (!Array.isArray(byId.get(key).jobs) && Array.isArray(run.jobs))) byId.set(key, run);
  }
  return [...byId.values()];
}
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

/*
 * D9027 (#9027): the queue rows by agent slot. The slot is the one
 * agent-provenance.mjs's classifyPr reads from the `Agent-Slot` trailers of
 * the commits on the PR, taken from the `committed` events of the timeline
 * the collector already reads. It is never guessed from the branch name. A PR
 * none of whose commits names an identity trailer is `human`. Every other PR
 * whose commits name no one slot goes to `untrailed`: no trailer, two slots,
 * or only the legacy `Claude-Session` trailer, which stands in for
 * `Agent-Session` before the cutover and carries no slot.
 *
 * This file does not import agent-provenance.mjs: the landing bot workflows
 * load it (through queueDeadline.mjs and prRisk.mjs) from a sparse checkout
 * without scripts/ci (workflow_sparse_imports_8314). The collector passes
 * classifyPr in; the test holds SLOT and LEGACY_SESSION to that file's.
 */
export const HUMAN_ROW = 'human';
export const UNTRAILED_ROW = 'untrailed';
export const SMALL_SAMPLE = 3;
/** agent-provenance.mjs's `Agent-Slot` shape and legacy session trailer. */
export const SLOT = /^S(?:0[1-9]|[1-9][0-9])$/;
export const LEGACY_SESSION = 'Claude-Session';

/** The provenance of one PR from its raw timeline events: `classify` (classifyPr)'s status and slot, nothing else. */
export function prProvenance(events, classify) {
  const commits = (events || []).filter(e => e?.event === 'committed').map(e => ({
    sha: String(e.sha ?? ''), parents: (e.parents || []).map(p => p?.sha).filter(Boolean),
    committedAt: e.committer?.date ?? null, message: String(e.message ?? ''),
  }));
  const { status, slot } = classify({ number: null, commits });
  return { status, slot };
}

/** The row a PR goes in: its slot, `human`, or `untrailed`. */
export function slotRowOf(pr) {
  const provenance = pr?.provenance;
  if (provenance?.status === 'human') return HUMAN_ROW;
  return typeof provenance?.slot === 'string' && SLOT.test(provenance.slot) ? provenance.slot : UNTRAILED_ROW;
}

/**
 * Merged PRs grouped by slotRowOf, slots first in order, then `human`, then
 * `untrailed`. Each row: merged PRs, p50 queue to merge from the first entry,
 * mean entries per queued merged PR, entries a removal ended, and the
 * merge-group candidates of those PRs whose outcome is `failed-check`
 * (`rows` from candidateRows). `small` marks fewer than SMALL_SAMPLE PRs.
 */
export function bySlot(prs, rows = []) {
  const groups = new Map();
  for (const p of prs.filter(p => p.mergedAt)) {
    const key = slotRowOf(p);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const rank = key => (key === HUMAN_ROW ? 1 : key === UNTRAILED_ROW ? 2 : 0);
  return [...groups].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)).map(([row, group]) => {
    const numbers = new Set(group.map(p => p.number));
    return {
      row, merged: group.length, small: group.length < SMALL_SAMPLE,
      queueToMerge: queueToMergeFirst(group).p50,
      entries: mean(mergedQueued(group).map(p => everyEntry(p).length)),
      removed: group.reduce((sum, p) => sum + everyEntry(p).filter(e => e.endEvent === 'removed_from_merge_queue').length, 0),
      failed: rows.filter(r => r.outcome === 'failed-check' && numbers.has(r.pr)).length,
    };
  });
}

const figure = value => (value === null ? '-' : value.toFixed(1));

/** The by-slot section's Markdown lines. */
export function slotSection(prs, rows = []) {
  const slots = bySlot(prs, rows);
  const lines = ['', '### Queue by agent slot', '',
    `The slot is the \`Agent-Slot\` trailer on the PR's commits, never the branch name. \`${HUMAN_ROW}\`: no identity trailer on any commit. `
    + `\`${UNTRAILED_ROW}\`: no single slot, or only the legacy \`${LEGACY_SESSION}\` trailer. A row of fewer than ${SMALL_SAMPLE} merged PRs is a small sample.`, ''];
  if (!slots.length) return [...lines, 'No merged PRs in the window.'];
  lines.push('| Slot | Merged PRs | Queue to merge, from the first entry, median (min) | Entries per merged PR (mean) | Removed entries | Failed-check candidates |',
    '| --- | --- | --- | --- | --- | --- |');
  for (const s of slots) {
    lines.push(`| ${s.row}${s.small ? ' (small sample)' : ''} | ${s.merged} | ${figure(s.queueToMerge.value)} | ${figure(s.entries.value)} | ${s.removed} | ${s.failed} |`);
  }
  return lines;
}

const show = ({ value, n }, scale = 1) => value === null ? `n/a (n=${n})` : `${(value * scale).toFixed(1)} (n=${n})`;
const pair = result => `p50 ${show(result.p50)}, p90 ${show(result.p90)}`;

export function report({ runs, queueRuns = [], prs, start, now, requests, queueListingComplete = true,
  rows = candidateRows({ runs: unionRuns(runs, queueRuns), prs, deadline: null }), deadline = null }) {
  const outcomes = outcomeCounts(rows);
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
    `| Merge-group candidates by outcome | ${outcomes.n ? Object.entries(outcomes.counts).map(([k, v]) => `${k} ${v}`).join(', ') : 'n/a'} (n=${outcomes.n}); deadline ${deadline ? `${deadline} min` : 'unread'}; one row per head SHA in the candidates artifact |`,
    ...slotSection(prs, rows),
  ].join('\n');
}

/*
 * D6479 (#6479): the landing section. Does a green PR reach main without the
 * owner touching it again? Every row is a pure function of data the collector
 * read through REST; a row with nothing to count prints "no data", never 0.
 * What REST does not show (a bypass of the ruleset, a breaker refusal, which
 * lives only in a bot run's job summary) is printed as not visible.
 *
 * The landing reads have their own plan, LANDING_BUDGET, beside BUDGET: BUDGET
 * keeps its arithmetic (the comment always fits under its cap) and the landing
 * reads stop at their own cap. The tracker comment is still the only write.
 * In order: ci.yml's push listing on main (pushPages); for each main push with
 * no green queue run whose PR timeline is not already read, its PR
 * (commits/{sha}/pulls) and that PR's timeline, until pushReads requests; the
 * open PR list (openPages) and up to mergeableReads single-PR reads, evenly
 * spaced; the workflow list (1) and each landing bot workflow's runs
 * (botRunPages each); the jobs of up to botJobs runs of a model kind and the
 * log of the last edit job of up to modelLogs of them (the provider); and
 * ci.yml's pull_request listing (prCiPages) with up to prCiJobs job reads.
 */
export const LANDING_BUDGET = Object.freeze({ cap: 230, pushPages: 2, pushReads: 40, openPages: 2, mergeableReads: 100,
  workflows: 1, botRunPages: 2, botJobs: 20, modelLogs: 12, prCiPages: 2, prCiJobs: 24 });

/** The landing plan's worst case: every listing at its page limit, every capped read used, every bot workflow on main. */
export function landingPlan(budget = LANDING_BUDGET, bots = dispatchable.length) {
  const b = budget;
  return { worst: b.pushPages + b.pushReads + b.openPages + b.mergeableReads + b.workflows + bots * b.botRunPages
    + b.botJobs + b.modelLogs + b.prCiPages + b.prCiJobs };
}

const human = actor => actor?.type === 'User';
const safeLogin = login => typeof login === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/.test(login) ? login : null;
/** A `Key: value` trailer line's value (letters, digits, `_` and `-` only), read line by line rather than with a built pattern. */
const trailer = (message, key) => {
  for (const line of String(message ?? '').split('\n')) {
    if (!line.startsWith(`${key}:`)) continue;
    const value = line.slice(key.length + 1).trim();
    if (/^[\w-]+$/.test(value)) return value;
  }
  return null;
};
const KEPT = ['added_to_merge_queue', 'removed_from_merge_queue', 'merged', 'closed', 'labeled', 'unlabeled',
  'ready_for_review', 'convert_to_draft', 'committed'];

/**
 * The timeline events the landing rows read, one small object each, oldest
 * first: event, time, actor (login and type) and the label name. A `committed`
 * event (no actor on REST) keeps its `Landing-Bot-Kind` and
 * `Landing-Bot-Provider` trailers only when its git author or committer is a
 * `[bot]` account, and the kind only when it is one of rules.mjs's KINDS.
 */
export function slimEvents(events) {
  return (events || []).filter(e => KEPT.includes(e?.event)).map(e => {
    const at = e.created_at ?? e.committer?.date ?? null;
    const out = { event: e.event, at, actor: e.actor ? { login: safeLogin(e.actor.login), type: e.actor.type === 'Bot' || e.actor.type === 'User' ? e.actor.type : null } : null };
    if (e.event === 'labeled' || e.event === 'unlabeled') out.label = typeof e.label?.name === 'string' ? e.label.name : null;
    if (e.event === 'committed') {
      const bot = [e.author?.name, e.committer?.name].some(name => /\[bot\]$/.test(String(name ?? '')));
      const kind = bot ? trailer(e.message, 'Landing-Bot-Kind') : null;
      const provider = bot ? trailer(e.message, 'Landing-Bot-Provider') : null;
      out.kind = kind && Object.hasOwn(KINDS, kind) ? kind : null;
      out.provider = provider && PROVIDERS.includes(provider) ? provider : null;
    }
    return out;
  }).filter(e => Number.isFinite(stamp(e.at))).sort((a, b) => stamp(a.at) - stamp(b.at));
}

const eventsOf = p => (Array.isArray(p.events) ? p.events : null);

/**
 * Owner touches per merged PR, from its timeline up to the merge: queue
 * additions by a User account (re-additions are those after the PR's first
 * entry, whoever made it) and removals by a User account (manual removals).
 * A session acting through the owner's account reads as the owner; REST
 * cannot tell the two apart.
 */
export function ownerTouches(prs) {
  const rows = prs.filter(p => p.mergedAt && eventsOf(p)).map(p => {
    const before = p.events.filter(e => stamp(e.at) <= stamp(p.mergedAt));
    const firstEntry = before.find(e => e.event === 'added_to_merge_queue')?.at;
    const additions = before.filter(e => e.event === 'added_to_merge_queue' && human(e.actor));
    const reAdditions = additions.filter(e => stamp(e.at) > stamp(firstEntry)).length;
    const removals = before.filter(e => e.event === 'removed_from_merge_queue' && human(e.actor)).length;
    return { additions: additions.length, reAdditions, removals, total: additions.length + removals };
  });
  const sum = key => rows.reduce((a, r) => a + r[key], 0);
  const totals = rows.map(r => r.total);
  return { n: rows.length, p50: percentile(totals, 50), mean: mean(totals), untouched: mean(totals.map(t => Number(t === 0))),
    additions: sum('additions'), reAdditions: sum('reAdditions'), removals: sum('removals') };
}

/**
 * Conflicted to mergeable: REST shows no conflict event, so the clock is the
 * `conflict` label (rules.mjs LABELS.conflict, set by the branch keeper on a
 * real conflict) from `labeled` to the next `unlabeled` or the merge. A span
 * still open is counted, never timed.
 */
export function conflictToMergeable(prs) {
  const values = [];
  let open = 0;
  for (const p of prs) {
    const events = eventsOf(p) || [];
    events.forEach((e, i) => {
      if (e.event !== 'labeled' || e.label !== LABELS.conflict) return;
      const end = events.slice(i + 1).find(x => (x.event === 'unlabeled' && x.label === LABELS.conflict) || x.event === 'merged');
      if (end) values.push(minutes(e.at, end.at));
      else open++;
    });
  }
  return { ...timings(values.filter(v => v !== null)), open };
}

const ACTION_LABELS = [LABELS.ejected, LABELS.needsSession, LABELS.conflict];

/**
 * Ejection to re-queue or label: from each `removed_from_merge_queue` to the
 * PR's next `added_to_merge_queue` (re-queue) or `labeled` ejected,
 * needs-session or conflict (label), whichever comes first. Every removal
 * counts: REST does not say whether the queue or a person removed it.
 */
export function ejectionToAction(prs) {
  const requeue = [], label = [];
  let waiting = 0;
  for (const p of prs) {
    const events = eventsOf(p) || [];
    events.forEach((e, i) => {
      if (e.event !== 'removed_from_merge_queue') return;
      const next = events.slice(i + 1).find(x => x.event === 'added_to_merge_queue' || (x.event === 'labeled' && ACTION_LABELS.includes(x.label)));
      if (!next) { waiting++; return; }
      (next.event === 'added_to_merge_queue' ? requeue : label).push(minutes(e.at, next.at));
    });
  }
  const all = [...requeue, ...label].filter(v => v !== null);
  return { ...timings(all), requeued: requeue.length, labelled: label.length, waiting };
}

/** Main push SHAs (ci.yml push runs on main) that have no green ci.yml merge-group run on the same commit. */
export function pushesMissingQueueRun(pushRuns, queueRuns) {
  const green = new Set(queueRuns.filter(r => !r.priorAttempt && queueCi(r) && complete(r) && r.conclusion === 'success').map(r => r.head_sha));
  return [...new Set(pushRuns.filter(r => !r.priorAttempt && mainCi(r) && isSha(r.head_sha)).map(r => r.head_sha))].filter(sha => !green.has(sha));
}

/**
 * Pushes to main with a green merge-queue run on the same commit, and for the
 * rest who merged and how. The PR is the one whose `merged` event names the
 * SHA (a timeline already read), else `pullsBySha`: { number: null } when the
 * commit has no PR (a direct push), { number, events } when its PR was read.
 * How: `queue` when the PR's last queue entry ended in its merge, `outside
 * the queue` when no entry did; `unread` when the cap stopped the read. A
 * bypass of the ruleset is not visible to the token's API.
 */
export function pushLanding({ pushRuns, queueRuns, prs, pullsBySha = new Map() }) {
  const shas = [...new Set(pushRuns.filter(r => !r.priorAttempt && mainCi(r) && isSha(r.head_sha)).map(r => r.head_sha))];
  const missing = pushesMissingQueueRun(pushRuns, queueRuns);
  const how = { queue: 0, 'outside the queue': 0, 'direct push': 0, unread: 0 };
  const who = {};
  for (const sha of missing) {
    const pr = prs.find(p => p.mergeCommit === sha && eventsOf(p)) || pullsBySha.get(sha) || null;
    if (pr && pr.number === null) { how['direct push']++; continue; }
    const events = pr && eventsOf(pr);
    if (!events) { how.unread++; continue; }
    const entries = queueEntries(events.map(e => ({ event: e.event, created_at: e.at })));
    how[entries.some(e => e.endEvent === 'merged') ? 'queue' : 'outside the queue']++;
    const by = events.findLast(e => e.event === 'merged')?.actor?.login || 'unknown';
    who[by] = (who[by] || 0) + 1;
  }
  return { n: shas.length, green: mean(shas.map(sha => Number(!missing.includes(sha)))), without: missing.length, how, who };
}

/** Open PRs by GitHub's mergeable_state (dirty read as conflicted), for those read; non-draft PRs created over 24 hours ago. */
export function openPrStates(open, details, now) {
  const states = {};
  let read = 0;
  for (const p of open) {
    const d = details.get(p.number);
    if (!d) continue;
    read++;
    const raw = d.mergeable === false && !d.mergeable_state ? 'dirty' : (/^[a-z_]+$/.test(d.mergeable_state || '') ? d.mergeable_state : 'unknown');
    const state = raw === 'dirty' ? 'conflicted' : raw;
    states[state] = (states[state] || 0) + 1;
  }
  const ready = open.filter(p => !p.draft);
  return { n: open.length, read, states, old: { n: ready.length, value: ready.filter(p => now - stamp(p.created_at) > 86_400_000).length } };
}

/** The landing bot kind a workflow path belongs to, from rules.mjs's dispatchable list. */
export const botKind = path => {
  const i = dispatchable.indexOf(path);
  return i < 0 ? null : Object.keys(KINDS)[i];
};
const editJob = /(?:^|\/ )Edit \(round \d\)$/;

/**
 * One landing bot run's outcome from what REST shows: its conclusion and,
 * for a run of a model kind whose jobs were read, whether a model edit job
 * ran (`model run`), the conflict resolver's apply job ran without one
 * (`handed back before the model`), or neither (`stopped before acting`: the
 * PR's bot:off label, a breaker or a budget, which only the job summary says).
 */
export function botRunOutcome(run) {
  if (run.status !== 'completed') return 'in progress';
  if (run.conclusion === 'skipped') return 'off';
  if (['failure', 'timed_out', 'startup_failure'].includes(run.conclusion)) return 'failed';
  if (run.conclusion === 'cancelled') return 'cancelled';
  const kind = botKind(run.path);
  if (!kind || !KINDS[kind].model || !Array.isArray(run.jobs)) return 'completed';
  const ran = test => run.jobs.some(j => test(j.name) && j.conclusion && j.conclusion !== 'skipped');
  if (ran(name => editJob.test(String(name)))) return 'model run';
  if (ran(name => name === 'Check the resolution and push it')) return 'handed back before the model';
  return 'stopped before acting';
}

export function botRuns(runs) {
  const byKind = {};
  for (const run of runs.filter(r => !r.priorAttempt && botKind(r.path))) {
    const kind = botKind(run.path);
    const outcome = botRunOutcome(run);
    byKind[kind] ??= { n: 0, outcomes: {} };
    byKind[kind].n++;
    byKind[kind].outcomes[outcome] = (byKind[kind].outcomes[outcome] || 0) + 1;
  }
  return byKind;
}

/**
 * What the bot did on the PRs whose timelines were read, inside the window:
 * pushes by kind (bot commits with a Landing-Bot-Kind trailer), give-ups
 * (`needs-session` labelled by a Bot account) and queue entries a Bot account
 * made.
 */
export function botActions(prs, start, now) {
  const inWindow = e => stamp(e.at) >= start && stamp(e.at) <= now;
  const pushed = {};
  let gaveUp = 0, queued = 0, prsRead = 0;
  for (const p of prs) {
    const events = eventsOf(p);
    if (!events) continue;
    prsRead++;
    for (const e of events.filter(inWindow)) {
      if (e.event === 'committed' && e.kind) pushed[e.kind] = (pushed[e.kind] || 0) + 1;
      if (e.event === 'labeled' && e.label === LABELS.needsSession && e.actor?.type === 'Bot') gaveUp++;
      if (e.event === 'added_to_merge_queue' && e.actor?.type === 'Bot') queued++;
    }
  }
  return { prsRead, pushed, gaveUp, queued };
}

/** The provider the last model round names in an edit job's log (model/edit.mjs's summary line), or null. */
export function providerFromLog(text) {
  const matches = [...String(text ?? '').matchAll(/landing-bot model: round \d+ [a-z_]+ \(.*?\); provider ([\w-]+), \d+ turns/g)];
  const name = matches.at(-1)?.[1];
  return name === 'none' || PROVIDERS.includes(name) ? name : null;
}

/**
 * Model runs per UTC day by provider against LANDING_BOT_DAILY_MODEL_RUNS
 * (read with rules.mjs's count(): unset is 0). A model run is a run of a
 * model kind whose edit job ran; its provider is `run.provider` (from the
 * edit job's log), else `unread`. Runs of a model kind whose jobs were not
 * read are counted apart, never as model runs.
 */
export function modelRunsPerDay(runs, capValue) {
  const days = {};
  let unclassified = 0;
  for (const run of runs.filter(r => !r.priorAttempt && KINDS[botKind(r.path)]?.model)) {
    const outcome = botRunOutcome(run);
    if (outcome === 'completed') { unclassified++; continue; }
    if (outcome !== 'model run') continue;
    const day = String(run.created_at).slice(0, 10);
    days[day] ??= { n: 0, providers: {} };
    days[day].n++;
    const provider = run.provider || 'unread';
    days[day].providers[provider] = (days[day].providers[provider] || 0) + 1;
  }
  const set = String(capValue ?? '').trim() !== '';
  return { days, unclassified, cap: count(capValue), capSet: set };
}

const tierOf = run => {
  const names = (run.jobs || []).map(j => j.name);
  if (names.includes('test:drift (draft fast tier)')) return 'draft';
  if (names.includes('test:drift (full suite)')) return 'ready';
  return null;
};

/** Jobs that got a runner per ci.yml pull_request run (one per PR push), split by the tier its test:drift job names. */
export function jobsPerPrPush(ciPrRuns) {
  const sampled = ciPrRuns.filter(r => !r.priorAttempt && r.event === 'pull_request' && r.path === '.github/workflows/ci.yml' && Array.isArray(r.jobs));
  const counts = { draft: [], ready: [] };
  let unknown = 0;
  for (const run of sampled) {
    const tier = tierOf(run);
    if (!tier) { unknown++; continue; }
    counts[tier].push(run.jobs.filter(j => j.conclusion !== 'skipped' && hasRunner(j)).length);
  }
  return { draft: { ...timings(counts.draft), mean: mean(counts.draft) }, ready: { ...timings(counts.ready), mean: mean(counts.ready) }, unknown };
}

/**
 * Full-suite failures on PRs: ci.yml pull_request runs whose `test:drift
 * (full suite)` job failed, split by whether the PR had been a draft before
 * the run (a `ready_for_review` at or before it on the timeline): those were
 * first seen after ready, behind a draft fast tier. A PR whose timeline was
 * not read is `unread`.
 */
export function fullSuiteFailures(ciPrRuns, prs) {
  const out = { n: 0, afterReady: 0, neverDraft: 0, unread: 0 };
  for (const run of ciPrRuns.filter(r => !r.priorAttempt && r.event === 'pull_request' && r.path === '.github/workflows/ci.yml')) {
    if (!(run.jobs || []).some(j => j.name === 'test:drift (full suite)' && failed(j))) continue;
    out.n++;
    const events = eventsOf(prs.find(p => p.number === run.pull_requests?.[0]?.number) || {});
    if (!events) out.unread++;
    else if (events.some(e => e.event === 'ready_for_review' && stamp(e.at) <= stamp(run.created_at))) out.afterReady++;
    else out.neverDraft++;
  }
  return out;
}

/** Runner wait over every sampled job, all names together (runnerWait's rule: queued to started, skipped left out). */
export function runnerWaitAll(runs) {
  return timings(runs.flatMap(run => (run.jobs || []).filter(j => j.conclusion !== 'skipped' && ci.safeJobName(j.name))
    .map(j => minutes(j.created_at, j.started_at))).filter(v => v !== null));
}

const noData = 'no data';
const num = (value, scale = 1) => (value * scale).toFixed(1);
const stat = ({ value, n }, scale = 1) => (n && value !== null ? `${num(value, scale)} (n=${n})` : noData);
const tail = ({ p50, p90 }) => (p50.n ? `p50 ${num(p50.value)}, p90 ${num(p90.value)} (n=${p50.n})` : noData);
const tally = obj => Object.entries(obj).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ');

/**
 * The landing section's Markdown. `pushRuns`, `open`, `openDetails`,
 * `botWorkflowRuns`, `ciPrRuns` and `pullsBySha` come from the landing reads;
 * `runs`, `queueRuns` and `prs` are the scorecard's own. `notes` names each
 * cap the reads hit.
 */
export function landingReport({ runs = [], queueRuns = [], prs = [], pushRuns = [], pullsBySha = new Map(), open = [], openDetails = new Map(),
  botWorkflowRuns = [], ciPrRuns = [], start, now, modelCap, requests = 0, notes = [] }) {
  const entries = entriesPerMergedPr(prs);
  const pushes = pushLanding({ pushRuns, queueRuns, prs, pullsBySha });
  const states = openPrStates(open, openDetails, now);
  const touches = ownerTouches(prs);
  const conflict = conflictToMergeable(prs);
  const ejection = ejectionToAction(prs);
  const bots = botRuns(botWorkflowRuns);
  const actions = botActions(prs, start, now);
  const model = modelRunsPerDay(botWorkflowRuns, modelCap);
  const pushJobs = jobsPerPrPush(ciPrRuns);
  const suite = fullSuiteFailures(ciPrRuns, prs);
  const wait = runnerWaitAll(runs);
  const days = Object.entries(model.days).sort(([a], [b]) => a.localeCompare(b));
  const capText = model.capSet ? `cap ${model.cap}` : 'cap unset (0)';
  return [
    '### Landing', '',
    `Landing reads: ${requests} GET requests of a ${LANDING_BUDGET.cap} cap. "no data" means nothing in the window to count.`, '',
    '| Metric | Sample |', '| --- | --- |',
    `| Queue entries per merged PR | ${entries.p50.n ? `median ${entries.p50.value} (n=${entries.p50.n}); merged on the first entry (%) ${stat(entries.firstEntry, 100)}` : noData} |`,
    `| Pushes to main with a green merge-queue run on the same commit (%) | ${stat(pushes.green, 100)} |`,
    `| Pushes to main without one: how, and who merged | ${pushes.n ? (pushes.without ? `${tally(pushes.how)}; merged by ${tally(pushes.who) || 'unread'}; bypass: not visible to the API` : 'none') : noData} |`,
    `| Open PRs by mergeable state | ${states.n ? `${tally(states.states) || 'none read'} (${states.read} of ${states.n} read)` : noData} |`,
    `| Non-draft PRs open over 24 hours | ${states.old.n ? `${states.old.value} of ${states.old.n}` : noData} |`,
    `| Owner touches per merged PR | ${touches.n ? `median ${touches.p50.value}, mean ${num(touches.mean.value)} (n=${touches.n}); untouched ${num(touches.untouched.value, 100)}%; queue additions ${touches.additions} (re-additions ${touches.reAdditions}), manual removals ${touches.removals}` : noData} |`,
    `| Conflicted to mergeable (min, \`${LABELS.conflict}\` label) | ${conflict.p50.n || conflict.open ? `${tail(conflict)}; still labelled ${conflict.open}` : noData} |`,
    `| Ejection to re-queue or label (min) | ${ejection.p50.n || ejection.waiting ? `${tail(ejection)}; re-queued ${ejection.requeued}, labelled ${ejection.labelled}, no action yet ${ejection.waiting}` : noData} |`,
    `| Landing bot runs by kind and outcome | ${Object.keys(bots).length ? Object.entries(bots).map(([k, v]) => `${k} ${v.n} (${tally(v.outcomes)})`).join('<br>') : noData} |`,
    `| Landing bot actions on read PR timelines | ${actions.prsRead ? `pushed ${tally(actions.pushed) || 'none'}; gave up ${actions.gaveUp}; queued by the bot ${actions.queued} (${actions.prsRead} timelines); refused by a breaker: not visible to the API` : noData} |`,
    `| Model runs per UTC day by provider (${capText}) | ${days.length ? days.map(([d, v]) => `${d}: ${v.n} of ${model.cap} (${tally(v.providers)})`).join('<br>') : noData}${model.unclassified ? `; jobs unread for ${model.unclassified} model-kind runs` : ''} |`,
    `| ci.yml jobs started per PR push, draft | ${pushJobs.draft.p50.n ? `median ${pushJobs.draft.p50.value}, mean ${num(pushJobs.draft.mean.value)} (n=${pushJobs.draft.p50.n})` : noData} |`,
    `| ci.yml jobs started per PR push, ready | ${pushJobs.ready.p50.n ? `median ${pushJobs.ready.p50.value}, mean ${num(pushJobs.ready.mean.value)} (n=${pushJobs.ready.p50.n})` : noData} |`,
    `| Full-suite failures first seen after ready | ${suite.n ? `${suite.afterReady} of ${suite.n} (never a draft ${suite.neverDraft}, timeline unread ${suite.unread})` : noData} |`,
    `| Runner wait per job, all jobs (min) | ${tail(wait)} |`,
    ...(notes.length ? ['', ...notes] : []),
  ].join('\n');
}
