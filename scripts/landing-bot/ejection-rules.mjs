// #6476: the ejection handler's pure rules: consent, the class of an ejection, and what to do about it.
import { count, LABELS } from './rules.mjs';
import { KEEPER_MAX_ATTEMPTS } from './keeper-plan.mjs';

export const KIND = 'ejection';
/** Owner, 2026-11-16: the bot may restore an entry only after these four classes. */
export const REQUEUE_CLASSES = Object.freeze(['conflict', 'cascade', 'flake', 'infrastructure']);
export const CLASSES = Object.freeze(['conflict', 'cascade', 'flake', 'infrastructure', 'timeout', 'own-failure', 'incompatible', 'manual', 'unknown']);
export const MAX_REQUEUES_PER_DAY = 2;
export const STALLED_ALERT = '[alert] merge queue stalled';
/**
 * #6476 S1 (2026-11-21): how long a removal stays open to another look while only a retryable condition holds
 * (checks pending on the repaired head, evidence unreadable, a breaker or budget that resets). Past it the entry is
 * handed back to the owner with \`ejected\`.
 */
export const RECOVERY_WINDOW_HOURS = 24;
/** The keeper is asked only in the first two sweeps after a conflict ejection; after that its own schedule runs. */
export const KEEPER_DISPATCH_MINUTES = 20;
/** Bot \`ejected\` labels written before this handler could wait (the stranded case) get one bounded second look. */
export const RETRY_CUTOVER = '2026-11-21T00:00:00Z';
export const STRANDED_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
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
 * The current head's check evidence as one of four states. Only \`green\` admits; \`failed\` hands back; \`pending\`
 * and \`unknown\` wait. A thrown or partial read is unknown, never success.
 * @param ev the feeder reader's readHeadEvidence result { ok, headSha, required: { missing, pending, failing } | null }
 */
export function evidenceState(ev, expectedSha) {
  if (!ev || typeof ev !== 'object') return 'unknown';
  if (expectedSha && ev.headSha && ev.headSha !== expectedSha) return 'changed';
  if (ev.ok === true && ev.headSha && (!expectedSha || ev.headSha === expectedSha)) return 'green';
  const req = ev.required;
  if (!req || typeof req !== 'object') return 'unknown';
  if (Array.isArray(req.failing) && req.failing.length) return 'failed';
  if ((Array.isArray(req.pending) && req.pending.length) || (Array.isArray(req.missing) && req.missing.length)) return 'pending';
  return 'unknown';
}

/** Whether the App's no-model keeper merge landed on the branch after this removal. */
export function keeperMergedSince(commits, removedAt, botLogin) {
  const at = time(removedAt);
  if (at === null || !botLogin) return false;
  return (commits || []).some((c) => keepsConsent(c, botLogin) && /^Landing-Bot-Kind:\s*keeper\s*$/m.test(String(c?.commit?.message ?? ''))
    && (time(c?.commit?.committer?.date) ?? -Infinity) > at);
}

/**
 * eligible()'s reasons that clear on their own (a read that failed, a breaker, the mode). Every other reason is the
 * owner's: bot:off, a repair/ branch, a fork, a closed PR, a .gitattributes change.
 */
export const RETRYABLE_ELIGIBILITY = Object.freeze([/could not be read/, /a breaker is open/, /does not allow this trigger/]);
const retryableEligibility = (r) => RETRYABLE_ELIGIBILITY.some((re) => re.test(String(r)));

const label = (reasons) => ({ action: 'label', label: LABELS.ejected, reasons });
/** A retryable condition waits, unlabelled, until RECOVERY_WINDOW_HOURS after the removal; then it is handed back. */
function waitOrHandBack(retry, removedAtValue, now) {
  const removedAt = time(removedAtValue);
  const deadline = removedAt === null ? null : removedAt + RECOVERY_WINDOW_HOURS * HOUR;
  if (deadline === null) return label([...retry, 'the removal time could not be read, so it is not retried']);
  if (now >= deadline) return label([...retry, `still not restorable ${RECOVERY_WINDOW_HOURS} hours after the ejection: the owner re-queues it`]);
  return { action: 'wait', reasons: retry, retryUntil: new Date(deadline).toISOString() };
}

/**
 * What to do. Re-queue only when everything holds. A condition that clears on its own (\`retry\`) waits, unlabelled,
 * for the next sweep inside RECOVERY_WINDOW_HOURS; one that needs the owner (\`owner\`) labels \`ejected\` at once.
 * A \`requeue\` here is not yet permission: the sweep then reads the landing policy for that head and passes both
 * through gateRequeue() (D6476-p7), and only its \`requeue\` reaches enqueuePullRequest.
 * @param c { klass, mergeable: GitHub's fresh true | false | null (unknown), keeperMerged, keeperAttempts: number | null (D6476-p6), removedAt, consent, checks: 'green'|'pending'|'failed'|'unknown'|'changed'
 *            (or the older checksGreenOnHead boolean), headUnchangedSinceChecks, eligible: { ok, reasons }, breakers: { open, reasons },
 *            openAlertTitles, requeues: [{ pr, at }] (bot re-queues), pr, now, env, queueRuns: [{ conclusion }] (last 20) }
 * @returns { action: 'requeue'|'keeper'|'repair'|'label'|'wait', label?, reasons, retryUntil? }
 */
export function decide(c) {
  const owner = [];
  const retry = [];
  const removedAt = time(c.removedAt);
  const waitOrHandBackNow = () => waitOrHandBack(retry, c.removedAt, c.now);
  // Owner addition (#6476, 2026-11-21): only a positive \`true\` admits. An explicit \`false\` is a conflict whatever the
  // ejection's class (main can move under a cascade or infrastructure ejection too); \`null\` or unread waits.
  const neverRequeued = !REQUEUE_CLASSES.includes(c.klass);
  if (!neverRequeued && (c.mergeable === false || (c.klass === 'conflict' && c.mergeable !== true))) {
    if (c.mergeable !== false) {
      retry.push('GitHub has not yet said whether the head merges cleanly');
      return waitOrHandBackNow();
    }
    // A class that GitHub did not call a conflict, now conflicting, without consent: nothing to restore, so no keeper.
    if (c.klass !== 'conflict' && !c.consent?.valid) return label([c.consent?.reason ?? 'no consent', 'it now conflicts with main']);
    // D6476-p6 (#8077): the keeper has used all its attempts. That is the owner's, never a wait for another keeper run.
    if (Number.isSafeInteger(c.keeperAttempts) && c.keeperAttempts >= KEEPER_MAX_ATTEMPTS) {
      return label([`the branch keeper used all ${KEEPER_MAX_ATTEMPTS} of its attempts on this pull request: a person resolves the conflict`]);
    }
    // The keeper's no-model merge did not clear it: a person resolves it. Never re-dispatched, never re-queued.
    if (c.keeperMerged) return label(['the branch keeper merged main and GitHub still reports a conflict: a person resolves it']);
    if (removedAt !== null && c.now - removedAt < KEEPER_DISPATCH_MINUTES * 60_000) {
      return { action: 'keeper', reasons: ['GitHub reported a conflict: the branch keeper merges main, then this handler looks again'] };
    }
    retry.push('still conflicting: waiting for the branch keeper\'s scheduled merge of main');
    return waitOrHandBackNow();
  }
  if (c.klass === 'own-failure') return { action: 'repair', label: LABELS.ejected, reasons: ['its own failure: never re-queued; red-PR repair (#5622) is asked'] };
  if (c.klass === 'incompatible') return label(['red only in its merge group: compare it with the entry ahead before it re-enters']);
  if (neverRequeued) return label([`class ${c.klass} is never re-queued`]);
  if (c.mergeable !== true) retry.push('GitHub has not yet said whether the head merges cleanly');

  if (!c.consent?.valid) owner.push(c.consent?.reason ?? 'no consent');
  const checks = c.checks ?? (c.checksGreenOnHead === true ? 'green' : 'unknown');
  const detail = c.checksDetail ? ` (${c.checksDetail})` : '';
  if (checks === 'failed') owner.push(`a required check failed on the current head${detail}`);
  else if (checks === 'pending') retry.push(`required checks are still running on the current head${detail}`);
  else if (checks === 'changed') retry.push('the head moved while its checks were read: the new head is read on the next sweep');
  else if (checks !== 'green') retry.push(`the current head's check evidence could not be confirmed${detail}`);
  if (checks === 'green' && !c.headUnchangedSinceChecks) retry.push('the head changed since the checks went green');
  for (const r of (c.eligible?.ok ? [] : (c.eligible?.reasons ?? ['not eligible']))) (retryableEligibility(r) ? retry : owner).push(r);
  if (!c.breakers || c.breakers.open) retry.push(...(c.breakers?.reasons ?? ['breakers could not be read']));
  if (!Array.isArray(c.openAlertTitles)) retry.push('open alerts could not be read');
  else if (c.openAlertTitles.includes(STALLED_ALERT)) retry.push(`${STALLED_ALERT} is open`);
  const since = c.now - DAY;
  const all = Array.isArray(c.requeues) ? c.requeues : null;
  if (!all) retry.push('today\'s re-queues could not be read');
  else {
    const mine = all.filter((r) => r.pr === c.pr && (time(r.at) ?? c.now) >= since).length;
    if (mine >= MAX_REQUEUES_PER_DAY) retry.push(`${mine} re-queues of this PR in 24 hours, the most is ${MAX_REQUEUES_PER_DAY}`);
    const day = new Date(c.now);
    const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    const repoToday = all.filter((r) => (time(r.at) ?? c.now) >= midnight).length;
    const cap = count(c.env?.LANDING_BOT_DAILY_REQUEUES);
    if (repoToday >= cap) retry.push(`LANDING_BOT_DAILY_REQUEUES: ${repoToday} of ${cap} used today`);
  }
  const share = Number(c.env?.LANDING_BOT_QUEUE_FAIL_BREAKER);
  const runs = Array.isArray(c.queueRuns) ? c.queueRuns.slice(0, 20) : null;
  if (!Number.isFinite(share) || share <= 0 || share > 1) retry.push('LANDING_BOT_QUEUE_FAIL_BREAKER is not set to a share between 0 and 1');
  else if (!runs || runs.length < 20) retry.push('the last 20 queue runs could not be read');
  else {
    const failed = runs.filter((r) => r.conclusion !== 'success').length / runs.length;
    if (failed >= share) retry.push(`${Math.round(failed * 100)}% of the last 20 queue runs failed, at or above the ${share} breaker`);
  }
  if (owner.length) return label([...owner, ...retry]);
  if (retry.length) return waitOrHandBackNow();
  return { action: 'requeue', reasons: [] };
}

/**
 * D6476-p7: the gates of \`landPr.decide()\` (scripts/lib/landPr.mjs) whose failure is the owner's at once. Every other
 * gate (agents may queue, main requires the merge queue, required checks green, the landing policy report, the
 * stalled alert) can clear by itself or with a setting, so it waits inside RECOVERY_WINDOW_HOURS and is then handed
 * back. A test pins this split against every gate name landPr.decide() emits.
 */
export const OWNER_POLICY_GATES = Object.freeze(['PR open on main', 'landing-policy.yml untouched']);
export const RETRY_POLICY_GATES = Object.freeze(['agents may queue', 'main requires the merge queue', 'required checks green',
  'landing policy T0/T1 for this head', 'merge queue not stalled']);
const COMMIT = /^[0-9a-f]{40}$/;
const flat = (v) => String(v ?? 'unread').replace(/[\r\n]+/g, ' ').slice(0, 300);

/**
 * D6476-p7: the landing policy for this exact head, read fresh just before a re-queue. A re-queue lands a PR just as
 * the feeder's first entry does, so it needs what the feeder needs (feeder-plan.mjs): \`mayQueue\` from every gate of
 * \`landPr.decide()\` (#5605 rows 3 and 6, #5500 done, main still requires the merge queue, landing-policy.yml
 * untouched, required checks green, a T0/T1 \`landing policy\` report with LANDING_AUTO true for this head SHA, no
 * open \`[alert] merge queue stalled\`), the repository variable LANDING_AUTO still \`true\` now, and a decision read
 * for this PR on the head the enqueue will name. Anything unread or for another head waits; it never passes.
 * @param p { landing: the feeder reader's readLandingDecision() result ({ pr, report, mayQueue, gates }) | null,
 *            error: why it is null, number, headSha: the head the enqueue names (expectedHeadOid), env }
 * @returns { ok, owner: string[], retry: string[] }
 */
export function requeuePolicy({ landing = null, error = null, number, headSha, env } = {}) {
  const owner = [];
  const retry = [];
  if (env?.LANDING_AUTO !== 'true') retry.push(`LANDING_AUTO is ${env?.LANDING_AUTO ? `"${flat(env.LANDING_AUTO)}"` : 'unset'}, not true: agents do not land`);
  if (!landing || typeof landing !== 'object' || !Array.isArray(landing.gates) || !landing.gates.length) {
    retry.push(`the landing decision for this head could not be read${error ? ` (${flat(error)})` : ''}`);
    return { ok: false, owner, retry };
  }
  if (!COMMIT.test(String(headSha ?? '')) || landing.pr?.number !== number || landing.pr?.head_sha !== headSha) {
    retry.push('the landing decision was read for another head: the new head is read on the next sweep');
    return { ok: false, owner, retry };
  }
  if (landing.pr.draft === true) owner.push('the pull request is a draft');
  if (landing.report?.tier === 'T2') owner.push('the landing policy says T2: the owner lands it');
  for (const g of landing.gates) {
    if (g?.ok === true) continue;
    (OWNER_POLICY_GATES.includes(g?.name) ? owner : retry).push(`landing gate "${flat(g?.name)}" fails: ${flat(g?.detail)}`);
  }
  if (landing.mayQueue !== true && !owner.length && !retry.length) retry.push('the landing decision does not allow queueing');
  return { ok: landing.mayQueue === true && !owner.length && !retry.length, owner, retry };
}

/**
 * D6476-p7: the last word before an enqueue. A \`requeue\` the fresh landing policy does not allow becomes a hand-back
 * with \`ejected\` (an owner's gate) or a bounded wait (anything else). Every other decision passes through unchanged.
 */
export function gateRequeue(d, policy, { removedAt, now } = {}) {
  if (d?.action !== 'requeue' || policy?.ok === true) return d;
  const owner = Array.isArray(policy?.owner) ? policy.owner : [];
  const retry = Array.isArray(policy?.retry) && policy.retry.length ? policy.retry : ['the landing policy was not confirmed'];
  if (owner.length) return label([...owner, ...retry]);
  return waitOrHandBack(retry, removedAt, now);
}
