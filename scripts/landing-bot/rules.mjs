/**
 * #6467 (plan key C1, under #5600): the landing bot's shared rules, written once.
 *
 * Six automations are planned: the branch keeper, the conflict resolver, the ejection handler, main repair, the
 * after-green refresh and red-PR repair (#5622). Each of them calls these functions and restates none of their
 * limits, so the six cannot loop through each other. Nothing here reaches GitHub, runs a command or calls a model:
 * the caller reads the data and passes it in, and every function only answers.
 *
 * DEFAULTS ARE CLOSED. With no variable set, every function answers "do nothing": `mode()` is `off`, every budget
 * is 0, the queue breaker is open, and data that is missing or unreadable refuses rather than allows.
 *
 * Shared with `merge-control/src/lib/repairPolicy.ts` (#5622): MAX_ATTEMPTS, QUIET_MINUTES and BREAKER_ALERTS
 * hold the same values there, and `frontend/test/landing_bot_core_6467.test.mjs` fails if either side drifts.
 */
import { classify as classifyCi, infraFingerprint, VERDICTS } from '../lib/ciClassify.mjs';
import { classify as classifyPaths } from '../merge-policy.mjs';

/** The six automations. `push` writes a commit, `model` calls a model, `requeue` re-adds to the queue. */
export const KINDS = Object.freeze({
  feeder: Object.freeze({ push: false, model: false, requeue: false, bulk: false }),
  keeper: Object.freeze({ push: true, model: false, requeue: false, bulk: false }),
  conflict: Object.freeze({ push: true, model: true, requeue: false, bulk: false }),
  ejection: Object.freeze({ push: false, model: false, requeue: true, bulk: false }),
  'main-repair': Object.freeze({ push: true, model: true, requeue: false, bulk: false }),
  refresh: Object.freeze({ push: true, model: false, requeue: false, bulk: true }),
  'red-pr': Object.freeze({ push: true, model: true, requeue: false, bulk: false }),
});
const kindOf = (kind) => (Object.hasOwn(KINDS, kind) ? KINDS[kind] : null);

/** Equal to repairPolicy.ts. */
export const MAX_ATTEMPTS = 2;
export const QUIET_MINUTES = 30;
export const BREAKER_ALERTS = Object.freeze([
  '[alert] main is red',
  '[alert] the Actions queue is backed up',
  '[alert] merge queue stalled',
]);
/** Across kinds, per PR, in any 24 hours. */
export const MAX_BOT_COMMITS_PER_DAY = 4;
export const MAX_MODEL_RUNS_PER_DAY = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

export const LABELS = Object.freeze({
  off: 'bot:off',
  conflict: 'conflict',
  ejected: 'ejected',
  needsSession: 'needs-session',
  mainRepair: 'main-repair',
  resolved: 'bot:resolved',
  // #6476 owner addition: the keeper's own hand-back. `conflict` is only the PR-list indicator now (D6476-p5).
  keeperTried: 'bot:keeper-tried',
});
export const REPAIR_BRANCH_PREFIX = 'repair/';
export const STICKY_MARKER = '<!-- landing-bot -->';

/** The only bot workflow files that may ever be dispatched, one per kind. None exists yet; later issues add them. */
export const dispatchable = Object.freeze(Object.keys(KINDS).map((k) =>
  k === 'feeder' ? '.github/workflows/landing-feeder.yml' : `.github/workflows/landing-bot-${k}.yml`));

const isInt = (v) => Number.isSafeInteger(v);
const time = (v) => {
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
/** A whole number from a variable, or 0: an unset, empty, negative or malformed variable allows nothing. */
export function count(v) {
  const s = String(v ?? '').trim();
  return /^\d+$/.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : 0;
}

/**
 * `LANDING_BOT_ENABLED`: `true` acts on all triggers, `dispatch` acts only in a workflow_dispatch run on one named
 * PR, and anything else (unset included) is `off`.
 */
export function mode(env = {}) {
  const v = env?.LANDING_BOT_ENABLED;
  if (v === 'true') return 'all';
  if (v === 'dispatch') return 'dispatch';
  return 'off';
}

/** Whether this trigger may act at all under the mode. A dispatch run names exactly one PR. */
export function triggerAllowed(env, { event, dispatchPr, prNumber } = {}) {
  const m = mode(env);
  if (m === 'all') return true;
  if (m === 'dispatch') return event === 'workflow_dispatch' && isInt(dispatchPr) && dispatchPr > 0 && dispatchPr === prNumber;
  return false;
}

/**
 * The breakers for one kind. Open means no bot of that kind acts anywhere.
 *  - main is red: the newest COMPLETED push run of CI on main failed. The run is read, not the alert issue; a missing
 *    or unreadable run list is open.
 *  - an open BREAKER_ALERTS issue (as repairPolicy.ts), and the list of open titles could not be read.
 *  - bulk kinds (refresh): fresh queued CI runs above LANDING_BOT_MAX_QUEUED_RUNS (unset is 0, so open), ignoring
 *    runs created before QUEUE_ALERT_IGNORE_BEFORE.
 *
 * @param ctx { env, mainRuns: [{ event, head_branch, status, conclusion, created_at }] | null,
 *              openAlertTitles: string[] | null, queuedRuns: [{ created_at }] | null }
 */
export function breakers(kind, ctx = {}) {
  const k = kindOf(kind);
  const reasons = [];
  if (!k) return { open: true, reasons: [`unknown kind: ${String(kind)}`] };
  const { env = {}, mainRuns = null, openAlertTitles = null, queuedRuns = null } = ctx;

  if (!Array.isArray(mainRuns)) reasons.push('main CI could not be read');
  else {
    const newest = mainRuns
      .filter((r) => r && r.event === 'push' && (r.head_branch ?? 'main') === 'main' && r.status === 'completed' && time(r.created_at) !== null)
      .sort((a, b) => time(b.created_at) - time(a.created_at))[0];
    if (!newest) reasons.push('no completed push run of CI on main');
    else if (newest.conclusion !== 'success') reasons.push(`main is red: its newest completed CI run is ${newest.conclusion}`);
  }

  if (!Array.isArray(openAlertTitles)) reasons.push('open alerts could not be read');
  else {
    for (const t of openAlertTitles) {
      if (typeof t !== 'string') { reasons.push('an alert title could not be read'); continue; }
      if (BREAKER_ALERTS.includes(t)) reasons.push(`${t} is open`);
    }
  }

  if (k.bulk) {
    const max = count(env.LANDING_BOT_MAX_QUEUED_RUNS);
    if (!Array.isArray(queuedRuns)) reasons.push('queued runs could not be read');
    else {
      const since = time(env.QUEUE_ALERT_IGNORE_BEFORE);
      const fresh = queuedRuns.filter((r) => {
        const t = time(r?.created_at);
        return t === null || since === null || t >= since;
      }).length;
      if (fresh > max) reasons.push(`${fresh} queued CI runs, above LANDING_BOT_MAX_QUEUED_RUNS (${max})`);
    }
  }
  return { open: reasons.length > 0, reasons };
}

/**
 * Whether a bot may act on this PR at all.
 * @param pr  { number, state, draft, labels: [{name}|string], head: { ref, repo: { full_name } }, base: { repo: { full_name } } }
 * @param ctx { env, event, dispatchPr, repo, files: [{ path, previousPath? }] | null, breakers: { open } , kind,
 *              lastPushAt (red-pr), now }
 */
export function eligible(pr, ctx = {}) {
  const reasons = [];
  const { env = {}, repo, files = null, kind, now } = ctx;
  if (!triggerAllowed(env, { event: ctx.event, dispatchPr: ctx.dispatchPr, prNumber: pr?.number })) reasons.push(`mode ${mode(env)} does not allow this trigger`);
  if (!pr || !isInt(pr.number)) return { ok: false, reasons: [...reasons, 'no pull request'] };
  if (pr.state !== 'open') reasons.push('pull request is not open');
  const headRepo = pr.head?.repo?.full_name;
  if (typeof repo !== 'string' || !repo || headRepo !== repo || pr.base?.repo?.full_name !== repo) reasons.push('head branch is not in this repository');
  const labels = (pr.labels || []).map((l) => (typeof l === 'string' ? l : l?.name));
  if (labels.includes(LABELS.off)) reasons.push(`labelled ${LABELS.off}`);
  if (typeof pr.head?.ref !== 'string' || pr.head.ref.startsWith(REPAIR_BRANCH_PREFIX)) reasons.push('a repair/ branch');
  if (!Array.isArray(files)) reasons.push('the diff could not be read');
  else if (files.some((f) => [f?.path, f?.previousPath].some((p) => typeof p === 'string' && /(?:^|\/)\.gitattributes$/.test(p)))) reasons.push('the diff touches a .gitattributes file');
  if (!kindOf(kind)) reasons.push(`unknown kind: ${String(kind)}`);
  if (!ctx.breakers || ctx.breakers.open !== false) reasons.push('a breaker is open');
  if (kind === 'red-pr') {
    const last = time(ctx.lastPushAt);
    if (last === null || !isInt(now) || now - last < QUIET_MINUTES * 60_000) reasons.push(`the last push is under ${QUIET_MINUTES} minutes old`);
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * The CI verdict for a run: infra_failure when every failed leaf died in runner setup, else ciClassify's verdict.
 * @param run { jobs: [{ name, conclusion, steps }], main: { conclusion, jobs } | null }
 */
export function verdictFor(run = {}) {
  if (infraFingerprint(run.jobs)) return 'infra_failure';
  const v = classifyCi({ pr: run.jobs || [], main: run.main ?? null }).verdict;
  return VERDICTS.includes(v) ? v : 'main_health_unknown';
}

const login = (who) => (typeof who === 'string' ? who : who?.login);
/** A commit carries the bot's identity if either its author or its committer is the App. */
const isBotCommit = (c, botLogin) => !!botLogin && [login(c?.author), login(c?.committer)].includes(botLogin);
/** A bot commit's kind, from its `Landing-Bot-Kind:` trailer. */
const trailerKind = (c) => /^Landing-Bot-Kind:\s*([\w-]+)\s*$/m.exec(String(c?.commit?.message ?? c?.message ?? ''))?.[1] ?? null;
const commitTime = (c) => time(c?.commit?.committer?.date ?? c?.committedAt ?? c?.date);

/**
 * How many attempts a kind has had on this PR, and whether one more is allowed.
 *
 * Counted from what a session cannot rewrite: the bot App's commits on the branch and completed runs of the bot
 * workflows. The limit is for the PR's whole life (owner, 2026-11-15, #6467 B): no commit restarts the count, the
 * session's own included, so a PR the bot has tried twice for a kind waits for a person. Comments are never read,
 * so deleting or forging the sticky comment changes nothing. Main repair is counted per failure fingerprint (job
 * plus test) across every commit, not per PR.
 *
 * @param pr   { number }
 * @param data { botLogin, now, commits: [{ sha, author, committer, commit: { message, committer: { date } } }] (oldest
 *               first), runs: [{ kind, pr, head_sha, status, created_at, fingerprint, modelCalls }], fingerprint }
 */
export function attempts(pr, kind, data = {}) {
  const reasons = [];
  const { botLogin, now, commits, runs, fingerprint } = data;
  if (!kindOf(kind)) return { allowed: false, used: null, limit: MAX_ATTEMPTS, reasons: [`unknown kind: ${String(kind)}`] };
  if (!botLogin || !isInt(now) || !Array.isArray(runs) || (kind !== 'main-repair' && !Array.isArray(commits))) {
    return { allowed: false, used: null, limit: MAX_ATTEMPTS, reasons: ['the attempt record could not be read'] };
  }
  const completed = runs.filter((r) => r && r.status === 'completed');

  if (kind === 'main-repair') {
    if (typeof fingerprint !== 'string' || !fingerprint.trim()) return { allowed: false, used: null, limit: MAX_ATTEMPTS, reasons: ['no failure fingerprint'] };
    const used = completed.filter((r) => r.kind === 'main-repair' && r.fingerprint === fingerprint).length;
    if (used >= MAX_ATTEMPTS) reasons.push(`${used} attempts on ${fingerprint}, the most is ${MAX_ATTEMPTS}`);
    return { allowed: reasons.length === 0, used, limit: MAX_ATTEMPTS, reasons };
  }

  if (!pr || !isInt(pr.number)) return { allowed: false, used: null, limit: MAX_ATTEMPTS, reasons: ['no pull request'] };
  // Every completed run of this kind on this PR, whatever its head, and every bot commit of this kind on the branch.
  const mine = completed.filter((r) => r.pr === pr.number);
  const runsOnPr = mine.filter((r) => r.kind === kind).length;
  const botCommitsOfKind = commits.filter((c) => isBotCommit(c, botLogin) && trailerKind(c) === kind).length;
  const used = Math.max(runsOnPr, botCommitsOfKind);
  if (used >= MAX_ATTEMPTS) reasons.push(`${used} ${kind} attempts on this pull request, the most is ${MAX_ATTEMPTS}`);

  const dayAgo = now - DAY_MS;
  const botCommitsToday = commits.filter((c) => isBotCommit(c, botLogin) && (commitTime(c) ?? now) >= dayAgo).length;
  if (KINDS[kind].push && botCommitsToday >= MAX_BOT_COMMITS_PER_DAY) reasons.push(`${botCommitsToday} bot commits in 24 hours, the most is ${MAX_BOT_COMMITS_PER_DAY}`);
  // A run of a model kind whose artifact gave no call count is counted as a model run.
  const calledModel = (r) => Number(r.modelCalls) > 0 || (r.modelCalls == null && !!KINDS[r.kind]?.model);
  const modelRunsToday = mine.filter((r) => calledModel(r) && (time(r.created_at) ?? now) >= dayAgo).length;
  if (KINDS[kind].model && modelRunsToday >= MAX_MODEL_RUNS_PER_DAY) reasons.push(`${modelRunsToday} model runs in 24 hours, the most is ${MAX_MODEL_RUNS_PER_DAY}`);
  return { allowed: reasons.length === 0, used, limit: MAX_ATTEMPTS, reasons };
}

/**
 * The repository's daily caps, since 00:00 UTC.
 * LANDING_BOT_DAILY_MODEL_RUNS counts model RUNS (owner, 2026-11-17): one unit per run, however many rounds or
 * account fallbacks (primary Claude, Claude 2, Claude 3, Codex) it used. The runner's per-run caps (turns, minutes,
 * rounds in task.mjs's HARD) bound what one run can spend. `modelRuns` holds one entry per run; `modelCalls` is the
 * old name for the same list.
 * @param usage { now, modelRuns: [{ at }] | null, pushes: [{ at }] | null, requeues: [{ at }] | null }
 */
export function budget(kind, env = {}, usage = {}) {
  const k = kindOf(kind);
  if (!k) return { allowed: false, reasons: [`unknown kind: ${String(kind)}`] };
  const { now } = usage;
  if (!isInt(now)) return { allowed: false, reasons: ['the time could not be read'] };
  const day = new Date(now);
  const since = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const reasons = [];
  const check = (need, list, variable) => {
    if (!need) return;
    const cap = count(env[variable]);
    if (!Array.isArray(list)) { reasons.push(`${variable}: today's use could not be read`); return; }
    const used = list.filter((e) => (time(e?.at) ?? now) >= since).length;
    if (used >= cap) reasons.push(`${variable}: ${used} of ${cap} used today`);
  };
  check(k.model, usage.modelRuns ?? usage.modelCalls, 'LANDING_BOT_DAILY_MODEL_RUNS');
  check(k.push, usage.pushes, 'LANDING_BOT_DAILY_PUSHES');
  check(k.requeue, usage.requeues, 'LANDING_BOT_DAILY_REQUEUES');
  return { allowed: reasons.length === 0, reasons };
}

/** Paths no bot writes, on top of everything merge-policy.mjs rates T2. */
export const PROTECTED = Object.freeze([
  /^\.github\//,
  /^cloudflare-worker\/sql\//,
  /^scripts\/ci\//,
  /^merge-control\//,
  /(?:^|\/)package\.json$/,
  /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|[^/]*\.lock)$/,
  /(?:^|\/)wrangler[^/]*\.toml$/,
  /(?:^|\/)\.gitattributes$/,
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
  /(?:^|\/)CODEOWNERS$/,
]);

/**
 * Which of a bot's intended writes are refused. Every path (and a rename's old path) must clear PROTECTED and must
 * not be T2 under merge-policy.mjs. It is called without a diff, and an existing test with no diff to read is T2
 * there (D6679), so a bot never edits an existing test. No files at all is refused.
 * @param files [{ path, previousPath?, status? }] status as git's letter; default M (an edit)
 */
export function pathGuard(files) {
  if (!Array.isArray(files) || files.length === 0) return { ok: false, refused: [{ path: null, reason: 'no files' }] };
  const refused = [];
  for (const f of files) {
    for (const p of [f?.path, ...(f?.previousPath != null ? [f.previousPath] : [])]) {
      if (typeof p !== 'string' || !p) { refused.push({ path: String(p), reason: 'unreadable path' }); continue; }
      const hit = PROTECTED.find((re) => re.test(p));
      if (hit) { refused.push({ path: p, reason: 'protected path' }); continue; }
      const { tier, reasons } = classifyPaths([{ path: p, status: String(f.status || 'M') }]);
      if (tier === 'T2') refused.push({ path: p, reason: `T2 under merge-policy.mjs: ${reasons.join('; ')}` });
    }
  }
  return { ok: refused.length === 0, refused };
}

/** The issue a PR body names first (Closes, Fixes, Resolves or Part of), or null. */
export function prIssue(body) {
  const m = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|part of)\s+#(\d+)\b/i.exec(String(body ?? ''));
  return m ? Number(m[1]) : null;
}
/** The owning slot: the PR body's issue, then that issue's `slot:*` label. */
export function owningSlot(prBody, issue) {
  const n = prIssue(prBody);
  if (!n || !issue || issue.number !== n) return null;
  const slot = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l?.name)).find((l) => /^slot:S\d+$/.test(String(l)));
  return slot ? slot.slice(5) : null;
}

/**
 * Handing a PR back. One label and one comment: the cause, the files or test, the command that reproduces it,
 * and the owning slot.
 * @param detail { files?: string[], test?: string, reproduce?: string, issue?: { number, labels } }
 */
export function giveUp(pr, cause, detail = {}) {
  const slot = owningSlot(pr?.body, detail.issue);
  const issueNo = prIssue(pr?.body);
  const what = detail.test ? `Test: \`${detail.test}\`` : (detail.files?.length ? `Files: ${detail.files.map((f) => `\`${f}\``).join(', ')}` : 'Files: Not recorded');
  const body = [
    `The landing bot stopped on this pull request and hands it back to its session.`,
    '',
    `Cause: ${String(cause || 'Not recorded')}`,
    what,
    `Reproduce: ${detail.reproduce ? `\`${detail.reproduce}\`` : 'Not recorded'}`,
    `Owning slot: ${slot ?? 'Not recorded'}${issueNo ? ` (from #${issueNo})` : ''}`,
    '',
    `The bot does nothing more here until the session pushes. Add \`${LABELS.off}\` to keep it away for good.`,
  ].join('\n');
  return { label: LABELS.needsSession, body, slot };
}

/** The work order: PRs the owner queued first, then ready, then draft; oldest number first within each. */
export function order(prs) {
  const rank = (p) => (p?.ownerQueued ? 0 : p?.draft ? 2 : 1);
  return [...(prs || [])].filter(Boolean).sort((a, b) => rank(a) - rank(b) || (a.number ?? 0) - (b.number ?? 0));
}

/**
 * The sticky comment is display only. It is trusted only when the App wrote it; nothing is ever counted from it.
 */
export function stickyComment(comments, botLogin) {
  if (!botLogin || !Array.isArray(comments)) return null;
  return comments.find((c) => login(c?.user) === botLogin && c?.user?.type === 'Bot' && String(c?.body ?? '').startsWith(STICKY_MARKER)) ?? null;
}
export function renderSticky(lines) {
  return [STICKY_MARKER, ...(lines || []).map(String)].join('\n');
}
