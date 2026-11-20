/**
 * GitHub health alerts for a Slack channel: the pure half. The CLI that does
 * the effects (GitHub API, Slack webhook) is `../github-alerts.mjs`.
 *
 * Three conditions, each found on 2026-11-09:
 *   - `main-red`      CI on a push to main failed (D5052 and D5039 broke every
 *                     PR at once, and three sessions opened duplicate fixes);
 *   - `review-blocked` the advisory reviewer called no model (budget_refused or
 *                     configuration_error), while its check still read green;
 *   - `queue`         the Actions queue backed up (dozens of PRs x 22 jobs).
 * Plus `future-clock`: the nightly run of the suites with the clock moved
 * ahead, which catches a date-bound test before its date arrives.
 *
 * STATE IS ONE ISSUE PER CONDITION, titled `[alert] <kind>`. The channel hears
 * only transitions: an alert opens the issue and posts once; repeats post
 * nothing; recovery closes it and posts once. So a red main for six hours is
 * two messages, and everyone has one place to look instead of opening fixes.
 */

import { INFRA_STEPS, SUMMARY_JOBS, infraFingerprint } from './ciClassify.mjs';
import { SCAN_ALERT_TITLE } from './scanScope.mjs';

export const ALERT_KINDS = Object.freeze({
  'main-red': { title: '[alert] main is red', label: 'main CI' },
  'review-blocked': { title: '[alert] the PR reviewer is not reviewing', label: 'PR reviewer' },
  queue: { title: '[alert] the Actions queue is backed up', label: 'Actions queue' },
  'queue-stalled': { title: '[alert] merge queue stalled', label: 'Merge queue' },
  'file-backup': { title: '[alert] file recovery backup unhealthy', label: 'File recovery backup' },
  scan: { title: SCAN_ALERT_TITLE, label: 'Main scan' },
  // D5398: the nightly future-clock run is stateful too. It used to post on every failing night and keep no issue,
  // so a date-bound test was announced again each night and nothing said when it was fixed.
  'future-clock': { title: '[alert] future-clock tests failing', label: 'Future-clock tests' },
});

/**
 * Newest completed run first. Only a green run clears an existing stall.
 *
 * Two rules open the alert. D5604: the two newest failed runs, on different heads, failed at the same setup step.
 * D7125: one failure identity (a test, a guard, or a job and step; `stallIdentities`) failed in queue runs of at
 * least two different chains (`queueChains`) and on at least three different heads, all created after the newest
 * green queue run. One chain alone is never a stall: its candidates are cumulative, so one bad PR fails every
 * candidate behind it until GitHub ejects it. The same failure again after an ejection and rebuild is the signal.
 */
export function queueStallState(runs) {
  const [latest, previous] = (runs || []).filter(r => r.event === 'merge_group' && r.status === 'completed')
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (latest?.conclusion === 'success') return { active: false, fingerprint: null };
  const fingerprint = latest?.conclusion === 'failure' ? infraFingerprint(latest.jobs) : null;
  if (fingerprint && previous?.conclusion === 'failure' && latest.head_sha && previous.head_sha
      && latest.head_sha !== previous.head_sha && fingerprint === infraFingerprint(previous.jobs)) {
    return { active: true, fingerprint };
  }
  const identities = stallEvidence(runs).identities.filter(i => i.active);
  if (identities.length) return { active: true, fingerprint: null, identities };
  return { active: null, fingerprint: null };
}

/** D7125: the title of the annotation `scripts/test-drift-parts.mjs` writes under merge_group for each failure. */
export const FAILURE_ID_TITLE = 'ci-failure-id';
/** D7125: how many failed queue runs the stall check reads annotations for. */
export const STALL_READ_MAX = 15;
/** D7125: a failed step that is not a failure of the candidate: GitHub ejected it and deleted its ref. */
const EJECTED_STEP = /^Check merge queue ref still exists$/;
const QUEUE_BRANCH = /^gh-readonly-queue\/main\/pr-([1-9]\d*)-([0-9a-f]{40})$/;
const at = r => Date.parse(r?.created_at || '');
const JOB_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/[1-9]\d*\/job\/[1-9]\d*$/;

/** D7125: `gh-readonly-queue/main/pr-<N>-<parent sha>` as { pr, parent }, or null for anything else. */
export function queueEntry(headBranch) {
  const m = QUEUE_BRANCH.exec(String(headBranch || ''));
  return m ? { pr: Number(m[1]), parent: m[2] } : null;
}

/**
 * D7125: which completed failed queue runs to read annotations for: those created after the newest green queue
 * run, newest first, at most `max`.
 */
export function stallRunsToRead(runs, max = STALL_READ_MAX) {
  const queue = (runs || []).filter(r => r?.event === 'merge_group' && r.status === 'completed' && queueEntry(r.head_branch));
  const green = Math.max(-Infinity, ...queue.filter(r => r.conclusion === 'success').map(at).filter(Number.isFinite));
  return queue.filter(r => r.conclusion === 'failure' && at(r) > green).sort((a, b) => at(b) - at(a)).slice(0, max);
}

/**
 * D7125: each queue run's chain. A candidate's parent sha is the head of the candidate ahead of it, or main's head
 * for the root, so following parents through the runs given (of any status or conclusion) reaches the root. Two
 * chains are different when their roots differ in PR number or base sha. Returns Map(run id -> { key, rootPr,
 * base, depth }).
 */
export function queueChains(runs) {
  const queue = (runs || []).filter(r => r?.event === 'merge_group' && queueEntry(r.head_branch) && r.head_sha);
  const byHead = new Map(queue.map(r => [r.head_sha, r]));
  const out = new Map();
  for (const run of queue) {
    let node = run;
    let depth = 0;
    const seen = new Set([node]);
    for (let next = byHead.get(queueEntry(node.head_branch).parent); next && !seen.has(next); next = byHead.get(queueEntry(node.head_branch).parent)) {
      seen.add(next);
      node = next;
      depth++;
    }
    const root = queueEntry(node.head_branch);
    out.set(run.id, { key: `pr-${root.pr}@${root.parent}`, rootPr: root.pr, base: root.parent, depth });
  }
  return out;
}

/**
 * D7125: a failed run's failure identities, or null when they cannot be known (a failed job's annotations were not
 * read). Each failed job outside the summaries gives its `ci-failure-id` annotations; one with none gives
 * `<job without its N-of-M shard> › <failed step>`, unless that step is setup (D5604's rule) or the ejected-ref
 * check (the candidate was removed, nothing failed).
 */
export function stallIdentities(run) {
  if (!Array.isArray(run?.jobs)) return null;
  const ids = [];
  for (const job of run.jobs) {
    const own = jobIdentities(job);
    if (!own) return null;
    ids.push(...own);
  }
  return [...new Set(ids)];
}

/** D7125: one job's identities (see `stallIdentities`): [] when it did not fail, null when it failed unread. */
function jobIdentities(job) {
  if (!['failure', 'timed_out'].includes(job?.conclusion) || SUMMARY_JOBS.has(job.name)) return [];
  if (!Array.isArray(job.annotations)) return null;
  const annotated = job.annotations.filter(a => typeof a === 'string' && a.trim()).map(a => a.trim());
  if (annotated.length) return annotated;
  const step = String(job.steps?.find(s => s?.conclusion === 'failure')?.name || '');
  if (!step || EJECTED_STEP.test(step) || INFRA_STEPS.some(p => p.test(step))) return [];
  return [`${String(job.name || '').replace(/ \((?:frontend|worker)-\d+-of-\d+\)$/, '')} › ${step}`];
}

/**
 * D7125: where a shared identity starts.
 *   - `base`: it fails on the root candidate of two chains whose root PRs differ, so main itself fails it;
 *   - `pr`: one PR #N is the earliest candidate failing it in one chain, sits at or ahead of the earliest failing
 *     candidate in every other chain, and some candidate ahead of #N completed without it;
 *   - `undetermined`: neither, with the PRs whose candidates failed it.
 * A candidate between #N and the earliest failure of another chain may have failed first on a different identity:
 * the queue stops a candidate at its first failed job (D5601), so it never reached this one.
 */
function stallStart(id, failing, chains, known) {
  const byChain = new Map();
  for (const run of failing) {
    const c = chains.get(run.id);
    byChain.set(c.key, [...(byChain.get(c.key) || []), run]);
  }
  const rootFails = failing.filter(r => chains.get(r.id).depth === 0);
  if (new Set(rootFails.map(r => chains.get(r.id).rootPr)).size >= 2) {
    const newest = rootFails.sort((a, b) => at(b) - at(a))[0];
    return { kind: 'base', sha: chains.get(newest.id).base };
  }
  const earliest = new Map([...byChain].map(([key, list]) => [key, Math.min(...list.map(r => chains.get(r.id).depth))]));
  const firstPrs = [...new Set(failing.filter(r => chains.get(r.id).depth === earliest.get(chains.get(r.id).key)).map(r => queueEntry(r.head_branch).pr))];
  const position = (pr, key) => known.filter(k => chains.get(k.run.id).key === key && queueEntry(k.run.head_branch).pr === pr)
    .map(k => chains.get(k.run.id).depth);
  const starts = firstPrs.filter(pr => [...earliest].every(([key, first]) => position(pr, key).some(d => d <= first))
    && [...earliest.keys()].some(key => {
      const depth = Math.min(...position(pr, key));
      return known.some(k => chains.get(k.run.id).key === key && chains.get(k.run.id).depth < depth && !k.ids.includes(id));
    }));
  return starts.length === 1 ? { kind: 'pr', pr: starts[0] }
    : { kind: 'undetermined', prs: [...new Set(failing.map(r => queueEntry(r.head_branch).pr))].sort((a, b) => a - b) };
}

/**
 * D7125: the evidence the stall check read. `chains` are the chain keys of the failed runs read (those given with
 * their `jobs`); `unknown` counts the failed runs whose identities could not be known (they are left out, never
 * counted either way); `identities` are every identity seen, most candidates first, `active` when it is in two
 * chains and on three heads.
 */
export function stallEvidence(runs) {
  const all = (runs || []).filter(r => r?.event === 'merge_group' && queueEntry(r.head_branch));
  const chains = queueChains(all);
  // A run whose jobs were never read (past the read cap) only links its chain; one read with an unread annotation is unknown.
  const read = stallRunsToRead(all, Infinity).filter(r => Array.isArray(r.jobs));
  const green = all.filter(r => r.status === 'completed' && r.conclusion === 'success').map(r => ({ run: r, ids: [] }));
  const known = [...green];
  let unknown = 0;
  const groups = new Map();
  for (const run of read) {
    const ids = stallIdentities(run);
    if (!ids) { unknown++; continue; }
    known.push({ run, ids });
    for (const id of ids) groups.set(id, [...(groups.get(id) || []), run]);
  }
  const identities = [...groups].map(([id, failing]) => {
    const chainKeys = new Set(failing.map(r => chains.get(r.id).key));
    const heads = new Set(failing.map(r => r.head_sha));
    const job = failing.flatMap(r => r.jobs).find(j => jobIdentities(j)?.includes(id))?.html_url;
    const active = chainKeys.size >= 2 && heads.size >= 3;
    return {
      id, active, candidates: failing.length, chains: chainKeys.size, heads: heads.size,
      ...(active ? { start: stallStart(id, failing, chains, known) } : {}),
      ...(JOB_URL.test(job || '') ? { jobUrl: job } : {}),
    };
  }).sort((a, b) => b.candidates - a.candidates || a.id.localeCompare(b.id));
  return { chains: [...new Set(read.map(r => chains.get(r.id).key))], unknown, identities };
}

/** Reviewer outcomes that mean no model was called because of setup, not because of the PR. */
export const REVIEW_BLOCKED_OUTCOMES = Object.freeze(['budget_refused', 'configuration_error']);
/** Reviewer outcomes that prove the reviewer works: a model answered, or this exact diff was already reviewed. */
export const REVIEW_OK_OUTCOMES = Object.freeze(['reviewed', 'duplicate']);

export const QUEUE_DEFAULTS = Object.freeze({ queued: 40, oldestMinutes: 45 });
/**
 * D5398: hysteresis. An open queue alert clears only once both figures are below this share of their thresholds, so
 * a queue hovering at the line does not open and close the alert (and post to the channel) every hour.
 */
export const QUEUE_CLEAR_RATIO = 0.5;

/**
 * What to do given whether the condition holds now and whether its issue is
 * open: `open` (post the alert), `close` (post recovery), or `none`.
 * `active === null` means "unknown" (e.g. a run that was cancelled): never a transition.
 */
export function transition(active, issueOpen) {
  if (active === null || active === undefined) return 'none';
  if (active && !issueOpen) return 'open';
  if (!active && issueOpen) return 'close';
  return 'none';
}

/** Whether a CI run on main is red, green, or says nothing (cancelled, skipped). */
export function mainState(conclusion) {
  if (conclusion === 'failure' || conclusion === 'timed_out') return true;
  if (conclusion === 'success') return false;
  return null;
}

/** Whether the reviewer's outcome means blocked, working, or says nothing (skipped, empty diff). */
export function reviewState(outcome) {
  const o = String(outcome || '').trim();
  if (REVIEW_BLOCKED_OUTCOMES.includes(o)) return true;
  if (REVIEW_OK_OUTCOMES.includes(o)) return false;
  return null;
}

/**
 * #6463: `QUEUE_ALERT_IGNORE_BEFORE`, an ISO date. Unset (or blank) is `null`: nothing is ignored, today's behaviour.
 * Anything that is not a real ISO date throws `queue_cutoff_invalid`; the CLI reports that loudly and ignores nothing.
 */
export function parseQueueCutoff(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const ms = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/.test(value) ? Date.parse(value) : NaN;
  // Date.parse rolls 2026-11-31 over to 1 December; the calendar date written must be the one read back.
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  if (!Number.isFinite(ms) || day.getUTCFullYear() !== y || day.getUTCMonth() !== m - 1 || day.getUTCDate() !== d) throw new Error('queue_cutoff_invalid');
  return { iso: new Date(ms).toISOString(), ms };
}

/**
 * #6463: leave out of the queue the runs created before the cutoff (2026-11-11's ~207 runs that GitHub will neither
 * start nor cancel, #5719), from both the count and the oldest age. `runs` are the queued runs actually read;
 * `total` is the API's count. A run is ignored only when it was SEEN and its `created_at` is before the cutoff, so a
 * run created at or after the cutoff, a run with an unreadable date, and a run the reader never reached all count.
 * Unread runs are older than every run read (the API lists newest first), so while any remain unread the oldest
 * age is the oldest run read, whatever its date: never younger than the truth.
 */
export function queueAfterCutoff({ total, runs = [], cutoff = null }) {
  const count = Math.max(0, Number(total) || 0);
  const seen = Array.isArray(runs) ? runs : [];
  const at = r => Date.parse(r?.created_at || '');
  const oldestOf = list => list.reduce((o, r) => (Number.isFinite(at(r)) && (o === null || at(r) < at(o)) ? r : o), null)?.created_at || null;
  if (!cutoff) return { queued: count, oldestCreatedAt: oldestOf(seen), ignored: 0, cutoff: null };
  const ignoredRuns = seen.filter(r => Number.isFinite(at(r)) && at(r) < cutoff.ms);
  const fresh = seen.filter(r => !ignoredRuns.includes(r));
  const ignored = Math.min(ignoredRuns.length, count);
  const unread = count > seen.length;
  return { queued: count - ignored, oldestCreatedAt: unread ? oldestOf(seen) : oldestOf(fresh), ignored, cutoff: cutoff.iso };
}

/** #6463: the one line an alert issue carries while the cutoff is set, so the exclusion is visible on GitHub. */
export function queueCutoffLine({ ignored, cutoff }) {
  return cutoff ? `Ignored: ${ignored} queued run(s) created before ${cutoff} (\`QUEUE_ALERT_IGNORE_BEFORE\`, #6463).` : '';
}

/** #6463: the issue body with that line written (replacing an earlier one), before the health marker. */
export function withQueueCutoffLine(body, facts) {
  const text = String(body || '');
  const kept = text.split('\n').filter(l => !/^Ignored: \d+ queued run\(s\) created before /.test(l)).join('\n');
  const line = queueCutoffLine(facts);
  if (!line) return kept;
  const at = kept.indexOf('<!-- studioos-health:v1');
  return at < 0 ? `${kept.trimEnd()}\n\n${line}` : `${kept.slice(0, at).trimEnd()}\n\n${line}\n\n${kept.slice(at)}`;
}

/**
 * The queue from the Actions API's queued runs: how many, and how long the
 * oldest has waited. Backed up when either is over its threshold.
 */
export function queueState({ queued, oldestCreatedAt, now = Date.now(), thresholds = QUEUE_DEFAULTS, issueOpen = false }) {
  const t = Date.parse(oldestCreatedAt || '');
  const waitedMin = Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 60_000)) : 0;
  const count = Number(queued) || 0;
  // D5398: open at the thresholds; once open, stay open until both are under QUEUE_CLEAR_RATIO of them.
  const k = issueOpen ? QUEUE_CLEAR_RATIO : 1;
  return {
    active: count >= thresholds.queued * k || waitedMin >= thresholds.oldestMinutes * k,
    queued: count,
    waitedMin,
  };
}

/** The failing test names in TAP output (`not ok N - name`), de-duplicated, at most `max`. */
export function failingTests(tap, max = 15) {
  const out = [];
  for (const line of String(tap || '').split('\n')) {
    const m = /^\s*not ok \d+ - (.+?)\s*(?:#.*)?$/.exec(line);
    if (m && !/^[\w./-]+\.test\.(m?js|ts)$/.test(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return { names: out.slice(0, max), more: Math.max(0, out.length - max) };
}

/** D7125: at most this many identities ride on the alert; `identityCount` says how many there were. */
export const STALL_LIST_MAX = 5;

/** D7125: the test file an identity names (`<file> › <test>`), or null for a guard or a job and step. */
export function stallTestFile(id) {
  const file = String(id || '').split(' › ')[0];
  return /^[\w./-]+\.test\.(?:mjs|ts)$/.test(file) && !file.split('/').includes('..') ? file : null;
}

/**
 * D7125, best effort at open: the open PRs that change an identity's test file and whose required checks are green
 * are listed on the alert as possible repairs. `prs` are [{ number, files, checks: [{ name, status, conclusion }] }];
 * `required` the required check names on main. With no required checks known, nothing is called green.
 */
export function possibleRepairs(identities, prs, required) {
  const ok = c => c?.status === 'completed' && ['success', 'neutral', 'skipped'].includes(c.conclusion);
  const green = pr => required.length > 0 && required.every(name => (pr.checks || []).some(c => c?.name === name && ok(c)));
  return identities.map(i => {
    const file = stallTestFile(i.id);
    const repairs = file ? prs.filter(pr => (pr.files || []).includes(file) && green(pr)).map(pr => pr.number).slice(0, 5) : [];
    return repairs.length ? { ...i, repairs } : i;
  });
}

/**
 * D7125: the identities as an alert may carry them (issue body, stored episode, Slack). Test names come from code a
 * PR can change, so the text keeps no backtick, angle bracket, ampersand, backslash, control character or mention.
 */
export function safeStallIdentities(list) {
  if (!Array.isArray(list)) return [];
  const n = v => Number.isSafeInteger(v) && v >= 0;
  const prs = v => (Array.isArray(v) ? v : []).filter(p => n(p) && p > 0);
  return list.slice(0, STALL_LIST_MAX).flatMap(i => {
    const id = String(i?.id ?? '').replace(/[\u0000-\u001f\u007f`<>&\\]/g, ' ').replaceAll('@', ' at ').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!id || !n(i.candidates) || !n(i.chains)) return [];
    const s = i.start || {};
    const start = s.kind === 'base' && /^[0-9a-f]{40}$/.test(s.sha || '') ? { kind: 'base', sha: s.sha }
      : s.kind === 'pr' && n(s.pr) && s.pr > 0 ? { kind: 'pr', pr: s.pr }
      : { kind: 'undetermined', prs: prs(s.prs).slice(0, 10) };
    const repairs = prs(i.repairs).slice(0, 5);
    return [{ id, candidates: i.candidates, chains: i.chains, start, ...(repairs.length ? { repairs } : {}), ...(JOB_URL.test(i.jobUrl || '') ? { jobUrl: i.jobUrl } : {}) }];
  });
}

/** D7125: one identity's line on the alert: the failure, its spread, where it starts, and one job. */
function stallLine(i) {
  const file = stallTestFile(i.id);
  const guard = /^guard › (.+)$/.exec(i.id)?.[1];
  const repro = file ? `\`node --test ${file}\`` : guard ? `\`${guard}\`` : 'the failed step';
  const start = i.start.kind === 'base'
    ? `Fails on the base: main at \`${i.start.sha.slice(0, 12)}\`. Reproduce with ${repro} on that sha. One repair, linked here (D5398).`
    : i.start.kind === 'pr'
      ? `Starts at #${i.start.pr}: remove #${i.start.pr} from the queue and do not re-queue it.`
      : `Candidates: ${i.start.prs.map(p => `#${p}`).join(', ') || 'none read'}; the start is not determined.`;
  const repairs = i.repairs ? ` Possible repairs (open, required checks green): ${i.repairs.map(p => `#${p}`).join(', ')}.` : '';
  return `• \`${i.id}\`: failed ${i.candidates} candidate(s) in ${i.chains} queue chains. ${start}${repairs}${i.jobUrl ? ` <${i.jobUrl}|job>` : ''}`;
}

/** Slack text for a transition. Plain mrkdwn; links are passed in, never built from user text. */
export function message(kind, action, facts = {}) {
  const k = ALERT_KINDS[kind];
  const issue = facts.issueUrl ? ` <${facts.issueUrl}|issue>` : '';
  const run = facts.runUrl ? ` <${facts.runUrl}|run>` : '';
  if (action === 'close') return `:white_check_mark: *${k.label} recovered.*${run}${issue} Closing the alert.`;
  if (kind === 'main-red') {
    return `:red_circle: *main is red.* CI failed on \`${String(facts.sha || '').slice(0, 8)}\`${facts.title ? ` (${facts.title})` : ''}.${run}${issue}\nEvery PR inherits it until main is fixed. One repair PR, linked on the issue. Don't port it, merge main into open PRs or re-run for it (AGENTS.md, D5398).`;
  }
  if (kind === 'review-blocked') {
    return `:warning: *The PR reviewer called no model* (\`${facts.outcome}\`)${facts.pr ? ` on #${facts.pr}` : ''}.${run}${issue}\nIts check still passes, so PRs are going unreviewed. The step summary says why (often the monthly budget: \`CLAUDE_REVIEW_MONTHLY_BUDGET_USD\`).`;
  }
  if (kind === 'queue') {
    const cut = facts.cutoff ? ` (${facts.ignored ?? 0} queued before ${facts.cutoff} ignored)` : '';
    return `:hourglass: *The Actions queue is backed up:* ${facts.queued} runs queued, the oldest waiting ${facts.waitedMin} min${cut}.${issue}\nCI results will be slow. Until it drains: no branch updates, no bulk re-runs, no ports of a main fix (AGENTS.md, D5398).`;
  }
  if (kind === 'queue-stalled') {
    const ids = safeStallIdentities(facts.identities);
    if (ids.length) {
      const more = Number.isSafeInteger(facts.identityCount) && facts.identityCount > ids.length ? `\n…and ${facts.identityCount - ids.length} more failure(s).` : '';
      return `:warning: *Merge queue stalled.* The same failure is in more than one queue chain, so ejecting one PR will not clear it.${run}${issue}\n${ids.map(stallLine).join('\n')}${more}\nUntil a queue CI run passes: add no queue entries and do not re-queue an ejected PR. The one repair linked on the alert is the exception; the owner moves it to the front (D5604, D7125).`;
    }
    return `:warning: *Merge queue stalled.* Two different queue commits failed during ${facts.fingerprint}.${run}${issue}\nPause new queue entries until a queue CI run passes (D5604).`;
  }
  if (kind === 'file-backup') return `:warning: *File recovery backup unhealthy* (${facts.backupReason || 'unavailable'}).${run}${issue} Check the private heartbeat and both copies; no live object content is included in this alert.`;
  if (kind === 'scan') return `New unsuppressed scan fingerprints on main.${run}`;
  if (kind === 'future-clock') {
    // D7124: a break date and where the names are; the names themselves stay in the run summary (D5663).
    const due = /^\d{4}-\d{2}-\d{2}$/.test(facts.breakDate || '') ? ` They break main by ${facts.breakDate} unless fixed first; a main repair is due before then.` : '';
    const named = facts.runUrl ? ' The failing test names and the reproduce command are in the run summary.' : '';
    const text = Number.isSafeInteger(facts.failedCount) ? `:alarm_clock: *${facts.failedCount} verified test failures with the clock ${facts.days} days ahead.*${run}${due}${named}` : facts.failures?.names?.length ? futureClockMessage(facts) : `:alarm_clock: *Tests fail with the clock moved ahead.*${run}`;
    return `${text}${issue}`;
  }
  return '';
}

/** Slack text for the nightly future-clock run: what fails once the clock is `days` ahead. */
export function futureClockMessage({ days, failures, runUrl }) {
  if (!failures.names.length) return '';
  const list = failures.names.map((n) => `• ${n}`).join('\n');
  const more = failures.more ? `\n…and ${failures.more} more` : '';
  return `:alarm_clock: *${failures.names.length + failures.more} test(s) fail with the clock ${days} days ahead* — they will break every PR when that date comes.${runUrl ? ` <${runUrl}|run>` : ''}\n${list}${more}\nFreeze the clock in the test (\`t.mock.timers.enable({ apis: ['Date'], now })\`) or pass \`nowMs\` into the component.`;
}
