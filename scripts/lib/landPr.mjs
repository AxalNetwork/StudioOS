/**
 * #6326: the `land-pr` skill's rules, the pure half of `../land-pr.mjs`.
 *
 * It decides whether an agent may put a pull request in the merge queue
 * itself, following AGENTS.md § Task protocol step 5 ("Finish"), D5605 and
 * D5607. Every gate must hold; any gate that fails, or that could not be read,
 * means the owner lands the PR:
 *
 *   1. agents may queue at all: #5605 row 3 (auto-merge and update-branch on),
 *      row 6 (`LANDING_AUTO` true) and #5500 (queue admission proven, the
 *      issue closed as completed) are in effect;
 *   2. the PR is open, targets `main` and is not merged;
 *   3. `main` still requires the merge queue;
 *   4. the PR does not edit `.github/workflows/landing-policy.yml`;
 *   5. every required check is `success` on the exact current head SHA;
 *   6. the `landing policy` report is for that head SHA, says T0 or T1 and
 *      `LANDING_AUTO: true`;
 *   7. `[alert] merge queue stalled` is not open (D5604).
 *
 * It also parses the `landing policy` job log and the summary text. It never
 * reaches GitHub and never runs a command: it only says which ones are allowed.
 */

export const POLICY_WORKFLOW = '.github/workflows/landing-policy.yml';
export const POLICY_CHECK = 'landing policy';
export const QUEUE_STALLED = '[alert] merge queue stalled';
export const ADMISSION_ISSUE = 5500;
export const ROWS_ISSUE = 5605;
const SHA = /^[0-9a-f]{40}$/;
const isSha = (v) => typeof v === 'string' && SHA.test(v);
const bool = (v) => (v === 'true' ? true : v === 'false' ? false : null);

/**
 * The env block of the `landing policy` job log: the base and head SHAs the
 * report is for, the PR number, `LANDING_AUTO`, whether the trusted base was
 * checked out, and whether the PR head was fetched. The tier itself goes only
 * to the step summary, which the REST API does not return.
 */
export function parseLandingLog(text) {
  const out = { baseSha: null, headSha: null, prNumber: null, landingAuto: null, checkout: null, fetchedHead: false };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z\s/, '').replace(/\r$/, '');
    const m = /^\s+(BASE_SHA|HEAD_SHA|PR_NUMBER|LANDING_AUTO|CHECKOUT_OUTCOME):\s*(\S*)\s*$/.exec(line);
    if (m) {
      const [, key, value] = m;
      if (key === 'BASE_SHA' && isSha(value)) out.baseSha = value;
      if (key === 'HEAD_SHA' && isSha(value)) out.headSha = value;
      if (key === 'PR_NUMBER' && /^\d+$/.test(value)) out.prNumber = Number(value);
      if (key === 'LANDING_AUTO') out.landingAuto = bool(value);
      if (key === 'CHECKOUT_OUTCOME') out.checkout = value || null;
    }
    if (/\brefs\/pull\/\d+\/head\s+->\s+FETCH_HEAD\b/.test(line)) out.fetchedHead = true;
  }
  return out;
}

/** The classifier's one line of JSON, `{"tier":"T1","reasons":[...]}`, or null. */
export function parseClassifierOutput(text) {
  for (const line of String(text || '').split('\n').reverse()) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try {
      const v = JSON.parse(s);
      if (/^T[012]$/.test(v?.tier) && Array.isArray(v.reasons)) return { tier: v.tier, reasons: v.reasons.map(String) };
    } catch { /* not this line */ }
  }
  return null;
}

/**
 * The step summary, either its raw markdown ("Base SHA: `…`") or the text
 * copied from the rendered run page, where the code spans lose their
 * backticks ("Base SHA: …"): "Base SHA", "Head SHA", "LANDING_AUTO" and the
 * JSON line.
 */
export function parseLandingSummary(text) {
  const s = String(text || '');
  const pick = (label) => new RegExp(`${label}:[ \\t]*\`?([^\`\\s]+)\`?`).exec(s)?.[1] ?? null;
  const base = pick('Base SHA');
  const head = pick('Head SHA');
  const result = parseClassifierOutput(s);
  return {
    baseSha: isSha(base) ? base : null,
    headSha: isSha(head) ? head : null,
    landingAuto: bool(pick('LANDING_AUTO')),
    tier: result?.tier ?? null,
    reasons: result?.reasons ?? [],
  };
}

/** Gate 1: may any agent queue at all today? */
export function agentsMayQueue({ repo, admissionIssue, landingAuto } = {}) {
  const missing = [];
  if (repo?.allow_auto_merge !== true || repo?.allow_update_branch !== true) {
    missing.push(`#${ROWS_ISSUE} row 3 not applied: allow_auto_merge=${repo?.allow_auto_merge ?? 'unread'}, allow_update_branch=${repo?.allow_update_branch ?? 'unread'}`);
  }
  if (landingAuto !== true) {
    missing.push(`#${ROWS_ISSUE} row 6 not switched on: LANDING_AUTO=${landingAuto ?? 'unread'}`);
  }
  if (!(admissionIssue?.state === 'closed' && admissionIssue?.state_reason === 'completed')) {
    missing.push(`#${ADMISSION_ISSUE} not done: ${admissionIssue ? `${admissionIssue.state}${admissionIssue.state_reason ? ` (${admissionIssue.state_reason})` : ''}` : 'unread'}`);
  }
  return { ok: missing.length === 0, detail: missing.length ? missing.join('; ') : `#${ROWS_ISSUE} rows 3 and 6 and #${ADMISSION_ISSUE} in effect` };
}

/** The required contexts in `main`'s branch rules, and whether the merge queue is one of the rules. */
export function mainRules(rules) {
  const list = Array.isArray(rules) ? rules : [];
  const required = list.filter((r) => r?.type === 'required_status_checks')
    .flatMap((r) => r.parameters?.required_status_checks || []).map((c) => c.context).filter(Boolean);
  return { mergeQueue: list.some((r) => r?.type === 'merge_queue'), required: [...new Set(required)] };
}

/**
 * Gate 5. Each required context needs at least one check run on `headSha`, and
 * every run of that name there must be completed with `success`. Skipped and
 * neutral do not count as green here.
 */
export function requiredChecks(required, checkRuns, headSha) {
  const missing = [];
  const pending = [];
  const failing = [];
  for (const name of required || []) {
    const runs = (checkRuns || []).filter((c) => c?.name === name && c.head_sha === headSha);
    if (!runs.length) missing.push(name);
    else if (runs.some((c) => c.status !== 'completed')) pending.push(name);
    else if (runs.some((c) => c.conclusion !== 'success')) failing.push(`${name} (${runs.map((c) => c.conclusion).join(', ')})`);
  }
  const ok = Boolean(required?.length) && !missing.length && !pending.length && !failing.length;
  const parts = [];
  if (!required?.length) parts.push('no required checks read from the main rules');
  if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
  if (pending.length) parts.push(`pending: ${pending.join(', ')}`);
  if (failing.length) parts.push(`not success: ${failing.join(', ')}`);
  return { ok, missing, pending, failing, detail: ok ? `${required.length} required checks success on ${headSha.slice(0, 10)}` : parts.join('; ') };
}

/** Gate 6. `report` is the summary (or the log plus the recomputed tier); `checkRun` is the `landing policy` run. */
export function landingReport({ checkRun, report, headSha } = {}) {
  const why = [];
  if (!checkRun) why.push('no landing policy check run on this head');
  else if (checkRun.head_sha !== headSha) why.push('landing policy ran on another head');
  else if (checkRun.status !== 'completed' || checkRun.conclusion !== 'success') why.push(`landing policy ${checkRun.status}/${checkRun.conclusion ?? 'none'}`);
  if (!report) why.push('report unread');
  else {
    if (report.headSha !== headSha) why.push(`report is for head ${report.headSha ? report.headSha.slice(0, 10) : 'unknown'}, not ${headSha.slice(0, 10)}`);
    if (report.landingAuto !== true) why.push(`LANDING_AUTO is ${report.landingAuto ?? 'unread'}`);
    if (report.tier !== 'T0' && report.tier !== 'T1') why.push(`tier ${report.tier ?? 'unread'}${report.tier === 'T2' ? ': the owner lands T2' : ''}`);
  }
  return { ok: why.length === 0, detail: why.length ? why.join('; ') : `${report.tier}, LANDING_AUTO true, head ${headSha.slice(0, 10)}${report.source ? ` (${report.source})` : ''}` };
}

/** Every gate, in order, and the verdict. `facts` is what `../land-pr.mjs` read. */
export function decide(facts = {}) {
  const { repo, rules, admissionIssue, pr, files, checkRuns, landing, alerts } = facts;
  const head = pr?.head_sha;
  const { mergeQueue, required } = mainRules(rules);
  const gates = [];
  const add = (name, ok, detail) => gates.push({ name, ok: Boolean(ok), detail });

  const may = agentsMayQueue({ repo, admissionIssue, landingAuto: landing?.report?.landingAuto ?? landing?.landingAuto ?? null });
  add('agents may queue', may.ok, may.detail);
  add('PR open on main', pr && pr.state === 'open' && !pr.merged && pr.base_ref === 'main' && isSha(head),
    pr ? `state=${pr.state}${pr.merged ? ' merged' : ''}, base=${pr.base_ref}, head=${head ?? 'unread'}` : 'PR unread');
  add('main requires the merge queue', mergeQueue, mergeQueue ? 'merge_queue rule present' : 'no merge_queue rule on main (or rules unread)');
  const edits = Array.isArray(files)
    ? files.filter((f) => f?.filename === POLICY_WORKFLOW || f?.previous_filename === POLICY_WORKFLOW) : null;
  add('landing-policy.yml untouched', edits && !edits.length, edits ? (edits.length ? `the PR edits ${POLICY_WORKFLOW}` : 'not in the PR\'s files') : 'files unread');
  const checks = isSha(head) ? requiredChecks(required, checkRuns, head) : { ok: false, detail: 'no head SHA' };
  add('required checks green', checks.ok, checks.detail);
  const report = isSha(head) ? landingReport({ checkRun: landing?.checkRun, report: landing?.report, headSha: head }) : { ok: false, detail: 'no head SHA' };
  add('landing policy T0/T1 for this head', report.ok, report.detail);
  const stalled = Array.isArray(alerts) ? alerts.filter((a) => a?.title === QUEUE_STALLED && a.state !== 'closed') : null;
  add('merge queue not stalled', stalled && !stalled.length, stalled ? (stalled.length ? `#${stalled[0].number} ${QUEUE_STALLED} is open (D5604)` : 'no stall alert open') : 'alerts unread');

  const mayQueue = gates.every((g) => g.ok);
  const commands = [];
  if (mayQueue && pr.auto_merge) {
    commands.push(`# auto-merge is already on for #${pr.number}; nothing to run`);
  } else if (mayQueue) {
    if (pr.draft) commands.push(`gh pr ready ${pr.number}`);
    commands.push(`gh pr merge ${pr.number} --auto --squash --match-head-commit ${head}`);
  }
  const verdict = mayQueue ? 'queue' : (may.ok ? 'owner lands this PR (a gate failed)' : 'owner lands: agents may not queue yet');
  return { mayQueue, verdict, gates, commands };
}

/** What to run before pushing to a PR that has auto-merge on or sits in the queue. */
export function beforePush(pr) {
  return pr?.auto_merge ? [`gh pr merge ${pr.number} --disable-auto`] : [];
}
