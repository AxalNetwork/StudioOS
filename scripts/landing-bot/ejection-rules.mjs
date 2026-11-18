// #6476: the ejection handler's pure rules: consent, the class of an ejection, and what to do about it.
import { count, LABELS } from './rules.mjs';

export const KIND = 'ejection';
/** Owner, 2026-11-16: the bot may restore an entry only after these four classes. */
export const REQUEUE_CLASSES = Object.freeze(['conflict', 'cascade', 'flake', 'infrastructure']);
export const CLASSES = Object.freeze(['conflict', 'cascade', 'flake', 'infrastructure', 'timeout', 'own-failure', 'incompatible', 'manual', 'unknown']);
export const MAX_REQUEUES_PER_DAY = 2;
export const STALLED_ALERT = '[alert] merge queue stalled';
const DAY = 24 * 60 * 60 * 1000;
const time = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
const login = (a) => (typeof a === 'string' ? a : a?.login) ?? null;

/** A no-model merge of main by the bot or by update-branch: the only commits that keep consent. */
export function keepsConsent(c, botLogin) {
  const msg = String(c?.commit?.message ?? c?.message ?? '');
  const parents = Array.isArray(c?.parents) ? c.parents.length : 0;
  const by = [login(c?.author), login(c?.committer)];
  if (parents !== 2) return false;
  if (botLogin && by.includes(botLogin) && /^Landing-Bot-Kind:\s*keeper\s*$/m.test(msg)) return true;
  // GitHub's update-branch: committed by web-flow, "Merge branch 'main' into <branch>".
  return login(c?.committer) === 'web-flow' && /^Merge branch 'main' into /.test(msg);
}

/**
 * Whether a person queued this PR and nothing but a no-model main merge changed it since.
 * @param pr { added: [{ at, actor: { login, type } }], removed: [{ at, actor, reason }], commits: [{ sha, parents, author, committer, commit: { message, committer: { date } } }] (oldest first), autoMerge: { enabledAt, enabledBy } | null }
 */
export function consent(pr, { botLogin } = {}) {
  const human = (a) => a && a.type !== 'Bot' && !/\[bot\]$/.test(login(a) ?? '') && login(a) !== botLogin;
  // Owner, 2026-11-17: an entry the landing App made (the feeder's first admission, after its T0/T1 gates) is consent
  // too. Only the App's own login counts: any other bot's entry is not. Model-edited PRs never reach the feeder.
  const app = (a) => Boolean(botLogin) && login(a) === botLogin;
  const signals = [
    ...(pr?.added || []).filter((e) => human(e.actor) || app(e.actor)).map((e) => ({ at: time(e.at), source: app(e.actor) ? 'app-queued' : 'queued' })),
    ...(pr?.autoMerge && human(pr.autoMerge.enabledBy) ? [{ at: time(pr.autoMerge.enabledAt), source: 'auto-merge' }] : []),
  ].filter((s) => s.at !== null).sort((a, b) => b.at - a.at);
  const last = signals[0];
  if (!last) return { valid: false, reason: 'neither a person nor the landing App queued this PR (another bot\'s entry is not consent)' };
  const manual = (pr?.removed || []).find((e) => time(e.at) > last.at && (/manual|dequeue/i.test(String(e.reason)) || human(e.actor)));
  if (manual) return { valid: false, reason: 'a person removed it from the queue after queueing it' };
  const later = (pr?.commits || []).filter((c) => (time(c?.commit?.committer?.date) ?? Infinity) > last.at);
  const voiding = later.find((c) => !keepsConsent(c, botLogin));
  if (voiding) return { valid: false, reason: `commit ${String(voiding.sha).slice(0, 10)} after it was queued is not a no-model merge of main` };
  return { valid: true, source: last.source, at: new Date(last.at).toISOString() };
}

const QUEUE_BRANCH = /^gh-readonly-queue\/main\/pr-(\d+)-([0-9a-f]{40})$/;
/**
 * Audit 2026-11-17 (P0): the merge-group run for this ejection, matched exactly. Its queue branch names this PR's
 * number (parsed, not a substring), and it started after the PR's last entry and before this removal. More than one
 * such run, or none, is no evidence.
 * @param runs [{ head_branch, event, created_at, status }]; @param pr { number, added: [{ at }] }; @param removal { at }
 */
export function groupRunFor(runs, pr, removal) {
  const removedAt = time(removal?.at);
  const entered = (pr?.added || []).map((a) => time(a.at)).filter((t) => t !== null && removedAt !== null && t <= removedAt).sort((a, b) => b - a)[0];
  if (removedAt === null || entered === undefined) return null;
  const hits = (runs || []).filter((r) => {
    const m = QUEUE_BRANCH.exec(String(r?.head_branch ?? ''));
    const at = time(r?.created_at);
    return r?.event === 'merge_group' && m && Number(m[1]) === pr.number && at !== null && at >= entered && at <= removedAt;
  });
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The class of one ejection.
 * @param e { reason: GitHub's removal reason, actor, queueRun: { conclusion, jobs } | null (this PR's merge_group run),
 *            headRun: { conclusion, jobs } | null (this PR's own head run), main: { conclusion, jobs } | null,
 *            failedTests: [{ file, test }], flaky: [{ file, test }], infra: boolean, mainRed: boolean, record: { class } | null }
 */
export function classify(e) {
  if (e?.record && CLASSES.includes(e.record.class)) return { class: e.record.class, why: 'the queue record (#5973) says so' };
  const reason = String(e?.reason ?? '');
  if (/conflict/i.test(reason)) return { class: 'conflict', why: 'GitHub reported a merge conflict' };
  if (/timeout|timed_out/i.test(reason)) return { class: 'timeout', why: 'the queue timed out waiting for checks' };
  if (/manual|dequeue/i.test(reason)) return { class: 'manual', why: 'a person removed it' };
  if (/clear/i.test(reason)) return { class: 'infrastructure', why: 'the queue was cleared' };
  if (e?.mainRed) return { class: 'infrastructure', why: 'main is red' };
  if (e?.infra) return { class: 'infrastructure', why: 'every failed part died in runner setup' };
  const run = e?.queueRun;
  if (run && ['success', 'cancelled', 'skipped'].includes(run.conclusion)) return { class: 'cascade', why: 'its own queue run did not fail: an entry ahead did' };
  // Positive evidence only: at least one failed job, and every failed job is the queue-ref check (an empty list is not).
  const failedJobs = Array.isArray(run?.jobs) ? run.jobs.filter((j) => j.conclusion === 'failure') : [];
  if (failedJobs.length && failedJobs.every((j) => /queue.?ref|merge.?group.?ref/i.test(j.name ?? ''))) {
    return { class: 'cascade', why: 'its queue run failed only at the queue-ref check' };
  }
  // A flake needs positive evidence: every failing test named, and every one on the flaky list.
  const flakyHit = (e?.failedTests || []).length > 0 && e.failedTests.every((t) => (e.flaky || []).some((f) => f.file === t.file && f.test === t.test));
  if (flakyHit) return { class: 'flake', why: 'every failing test is on the flaky list' };
  const mainGreen = e?.main?.conclusion === 'success';
  // Audit 2026-11-17 (P0): green alone and green on main, yet red together, is not a flake. It is the signature of
  // two changes that break each other, so it is surfaced for diagnosis and never re-queued.
  if (e?.headRun?.conclusion === 'success' && mainGreen && run?.conclusion === 'failure') {
    return { class: 'incompatible', why: 'its queue run failed while its own head and main each passed: it may break with an entry ahead of it' };
  }
  if (run?.conclusion === 'failure' && mainGreen) return { class: 'own-failure', why: 'its queue run failed and main is green' };
  return { class: 'unknown', why: 'not enough evidence to say' };
}

/**
 * What to do. Re-queue only when everything holds; otherwise label (and for some classes dispatch).
 * @param c { klass, stillConflicting, consent, checksGreenOnHead, headUnchangedSinceChecks, eligible: { ok, reasons }, breakers: { open, reasons },
 *            openAlertTitles, requeues: [{ pr, at }] (bot re-queues), pr, now, env, queueRuns: [{ conclusion }] (last 20) }
 */
export function decide(c) {
  const reasons = [];
  const label = () => ({ action: 'label', label: LABELS.ejected, reasons });
  // A conflict goes to the branch keeper first; once its merge has cleared it, the entry may be restored.
  if (c.klass === 'conflict' && c.stillConflicting !== false) return { action: 'keeper', reasons: ['GitHub reported a conflict: the branch keeper merges main, then this handler looks again'] };
  if (c.klass === 'own-failure') return { action: 'repair', label: LABELS.ejected, reasons: ['its own failure: never re-queued; red-PR repair (#5622) is asked when it exists'] };
  if (c.klass === 'incompatible') return { action: 'label', label: LABELS.ejected, reasons: ['red only in its merge group: compare it with the entry ahead before it re-enters'] };
  if (!REQUEUE_CLASSES.includes(c.klass)) { reasons.push(`class ${c.klass} is never re-queued`); return label(); }
  if (!c.consent?.valid) reasons.push(c.consent?.reason ?? 'no consent');
  if (!c.checksGreenOnHead) reasons.push(`not every required check is green on the current head${c.checksDetail ? ` (${c.checksDetail})` : ''}`);
  if (!c.headUnchangedSinceChecks) reasons.push('the head changed since the checks went green');
  if (!c.eligible?.ok) reasons.push(...(c.eligible?.reasons ?? ['not eligible']));
  if (!c.breakers || c.breakers.open) reasons.push(...(c.breakers?.reasons ?? ['breakers could not be read']));
  if (!Array.isArray(c.openAlertTitles)) reasons.push('open alerts could not be read');
  else if (c.openAlertTitles.includes(STALLED_ALERT)) reasons.push(`${STALLED_ALERT} is open`);
  const since = c.now - DAY;
  const all = Array.isArray(c.requeues) ? c.requeues : null;
  if (!all) reasons.push('today\'s re-queues could not be read');
  else {
    const mine = all.filter((r) => r.pr === c.pr && (time(r.at) ?? c.now) >= since).length;
    if (mine >= MAX_REQUEUES_PER_DAY) reasons.push(`${mine} re-queues of this PR in 24 hours, the most is ${MAX_REQUEUES_PER_DAY}`);
    const day = new Date(c.now);
    const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    const repoToday = all.filter((r) => (time(r.at) ?? c.now) >= midnight).length;
    const cap = count(c.env?.LANDING_BOT_DAILY_REQUEUES);
    if (repoToday >= cap) reasons.push(`LANDING_BOT_DAILY_REQUEUES: ${repoToday} of ${cap} used today`);
  }
  const share = Number(c.env?.LANDING_BOT_QUEUE_FAIL_BREAKER);
  const runs = Array.isArray(c.queueRuns) ? c.queueRuns.slice(0, 20) : null;
  if (!Number.isFinite(share) || share <= 0 || share > 1) reasons.push('LANDING_BOT_QUEUE_FAIL_BREAKER is not set to a share between 0 and 1');
  else if (!runs || runs.length < 20) reasons.push('the last 20 queue runs could not be read');
  else {
    const failed = runs.filter((r) => r.conclusion !== 'success').length / runs.length;
    if (failed >= share) reasons.push(`${Math.round(failed * 100)}% of the last 20 queue runs failed, at or above the ${share} breaker`);
  }
  if (reasons.length) return label();
  return { action: 'requeue', reasons: [] };
}
