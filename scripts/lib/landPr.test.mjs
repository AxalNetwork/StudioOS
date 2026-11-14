import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POLICY_WORKFLOW, QUEUE_STALLED, agentsMayQueue, beforePush, decide, landingReport, mainRules,
  parseClassifierOutput, parseLandingLog, parseLandingSummary, requiredChecks,
} from './landPr.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const OTHER = 'c'.repeat(40);
const REQUIRED = ['test:drift (full suite)', 'scan'];
const rules = [
  { type: 'required_status_checks', parameters: { required_status_checks: REQUIRED.map((context) => ({ context })) } },
  { type: 'merge_queue', parameters: { merge_method: 'SQUASH' } },
];
const green = REQUIRED.map((name) => ({ name, head_sha: HEAD, status: 'completed', conclusion: 'success' }));
const policyRun = { name: 'landing policy', head_sha: HEAD, status: 'completed', conclusion: 'success' };

function facts(over = {}) {
  return {
    repo: { allow_auto_merge: true, allow_update_branch: true },
    rules,
    admissionIssue: { state: 'closed', state_reason: 'completed' },
    pr: { number: 7, state: 'open', merged: false, draft: true, base_ref: 'main', head_sha: HEAD, auto_merge: null },
    files: [{ filename: 'documentation/x.md' }],
    checkRuns: [...green, policyRun],
    landing: { checkRun: policyRun, report: { baseSha: BASE, headSha: HEAD, landingAuto: true, tier: 'T1', reasons: [] } },
    alerts: [],
    ...over,
  };
}
const gate = (r, name) => r.gates.find((g) => g.name === name);

test('parseLandingLog reads the env block and the head fetch from a real-shaped log', () => {
  const log = [
    '2026-11-14T10:41:59.5048940Z env:',
    `2026-11-14T10:41:59.5049200Z   BASE_SHA: ${BASE}`,
    `2026-11-14T10:41:59.5049545Z   HEAD_SHA: ${HEAD}`,
    '2026-11-14T10:41:59.5049829Z   PR_NUMBER: 6307',
    '2026-11-14T10:41:59.5050030Z   LANDING_AUTO: false',
    '2026-11-14T10:41:59.5050259Z   CHECKOUT_OUTCOME: success',
    '2026-11-14T10:41:59.8118077Z  * branch                  refs/pull/6307/head -> FETCH_HEAD',
    "2026-11-14T10:41:59.5011332Z \u001b[36;1m  printf 'LANDING_AUTO: `%s`\\n\\n' \"$LANDING_AUTO\"\u001b[0m",
  ].join('\n');
  assert.deepEqual(parseLandingLog(log), {
    baseSha: BASE, headSha: HEAD, prNumber: 6307, landingAuto: false, checkout: 'success', fetchedHead: true,
  });
  assert.equal(parseLandingLog('').landingAuto, null);
  assert.equal(parseLandingLog('  LANDING_AUTO: maybe').landingAuto, null);
});

test('parseLandingSummary and parseClassifierOutput read the summary text', () => {
  const summary = `## Landing policy (advisory)\n\nBase SHA: \`${BASE}\`\n\nHead SHA: \`${HEAD}\`\n\nLANDING_AUTO: \`true\`\n\n    {"tier":"T0","reasons":["T0: documentation or leaf UI: documentation/a.md"]}\n`;
  assert.deepEqual(parseLandingSummary(summary), {
    baseSha: BASE, headSha: HEAD, landingAuto: true, tier: 'T0', reasons: ['T0: documentation or leaf UI: documentation/a.md'],
  });
  assert.equal(parseClassifierOutput('noise\n{"tier":"T9","reasons":[]}'), null);
  assert.equal(parseClassifierOutput('{not json'), null);
  assert.equal(parseLandingSummary('nothing').tier, null);
});

test('parseLandingSummary reads text copied from the rendered run page, without backticks', () => {
  const rendered = `Landing policy (advisory)\nBase SHA: ${BASE}\nHead SHA: ${HEAD}\nLANDING_AUTO: true\n{"tier":"T1","reasons":[]}\n`;
  assert.deepEqual(parseLandingSummary(rendered), { baseSha: BASE, headSha: HEAD, landingAuto: true, tier: 'T1', reasons: [] });
  assert.equal(parseLandingSummary(`Head SHA: \nLANDING_AUTO: false`).headSha, null);
  assert.equal(parseLandingSummary(`Head SHA: \nLANDING_AUTO: false`).landingAuto, false);
});

test('agentsMayQueue needs rows 3 and 6 and #5500, each named when missing', () => {
  assert.equal(agentsMayQueue({ repo: { allow_auto_merge: true, allow_update_branch: true }, admissionIssue: { state: 'closed', state_reason: 'completed' }, landingAuto: true }).ok, true);
  const today = agentsMayQueue({ repo: { allow_auto_merge: false, allow_update_branch: false }, admissionIssue: { state: 'open' }, landingAuto: false });
  assert.equal(today.ok, false);
  assert.match(today.detail, /row 3/);
  assert.match(today.detail, /row 6/);
  assert.match(today.detail, /#5500 not done: open/);
  assert.match(agentsMayQueue({ repo: { allow_auto_merge: true, allow_update_branch: true }, admissionIssue: { state: 'closed', state_reason: 'not_planned' }, landingAuto: true }).detail, /not_planned/);
  assert.equal(agentsMayQueue({}).ok, false);
});

test('mainRules finds the merge queue and the required contexts', () => {
  assert.deepEqual(mainRules(rules), { mergeQueue: true, required: REQUIRED });
  assert.deepEqual(mainRules(null), { mergeQueue: false, required: [] });
});

test('requiredChecks: missing, pending, skipped and another head are not green', () => {
  assert.equal(requiredChecks(REQUIRED, green, HEAD).ok, true);
  assert.deepEqual(requiredChecks(REQUIRED, green.slice(1), HEAD).missing, ['test:drift (full suite)']);
  assert.deepEqual(requiredChecks(REQUIRED, [green[0], { ...green[1], status: 'in_progress', conclusion: null }], HEAD).pending, ['scan']);
  assert.equal(requiredChecks(REQUIRED, [green[0], { ...green[1], conclusion: 'skipped' }], HEAD).ok, false);
  assert.equal(requiredChecks(REQUIRED, green.map((c) => ({ ...c, head_sha: OTHER })), HEAD).missing.length, 2);
  assert.equal(requiredChecks(REQUIRED, [...green, { ...green[0], conclusion: 'failure' }], HEAD).ok, false);
  assert.equal(requiredChecks([], green, HEAD).ok, false);
});

test('landingReport: exact head, LANDING_AUTO true and T0 or T1', () => {
  const report = { headSha: HEAD, landingAuto: true, tier: 'T0' };
  assert.equal(landingReport({ checkRun: policyRun, report, headSha: HEAD }).ok, true);
  assert.match(landingReport({ checkRun: policyRun, report: { ...report, tier: 'T2' }, headSha: HEAD }).detail, /owner lands T2/);
  assert.match(landingReport({ checkRun: policyRun, report: { ...report, headSha: OTHER }, headSha: HEAD }).detail, /report is for head/);
  assert.match(landingReport({ checkRun: policyRun, report: { ...report, landingAuto: false }, headSha: HEAD }).detail, /LANDING_AUTO is false/);
  assert.match(landingReport({ checkRun: { ...policyRun, head_sha: OTHER }, report, headSha: HEAD }).detail, /another head/);
  assert.equal(landingReport({ checkRun: null, report: null, headSha: HEAD }).ok, false);
});

test('decide: every gate holding gives ready, then merge with the exact head', () => {
  const r = decide(facts());
  assert.equal(r.mayQueue, true, JSON.stringify(r.gates));
  assert.deepEqual(r.commands, ['gh pr ready 7', `gh pr merge 7 --auto --squash --match-head-commit ${HEAD}`]);
  const notDraft = decide(facts({ pr: { ...facts().pr, draft: false } }));
  assert.deepEqual(notDraft.commands, [`gh pr merge 7 --auto --squash --match-head-commit ${HEAD}`]);
  assert.ok(r.commands.every((c) => !c.includes('--admin')));
});

test('decide: today\'s settings stop at the first gate and the owner lands', () => {
  const r = decide(facts({ repo: { allow_auto_merge: false, allow_update_branch: false }, admissionIssue: { state: 'open', state_reason: null } }));
  assert.equal(r.mayQueue, false);
  assert.equal(gate(r, 'agents may queue').ok, false);
  assert.match(r.verdict, /agents may not queue/);
  assert.deepEqual(r.commands, []);
});

test('decide: each later gate alone blocks queueing', () => {
  const cases = {
    'PR open on main': { pr: { ...facts().pr, base_ref: 'release' } },
    'main requires the merge queue': { rules: rules.slice(0, 1) },
    'landing-policy.yml untouched': { files: [{ filename: 'docs.md' }, { filename: 'x.yml', previous_filename: POLICY_WORKFLOW }] },
    'required checks green': { checkRuns: [green[0], policyRun] },
    'landing policy T0/T1 for this head': { landing: { checkRun: policyRun, report: { headSha: HEAD, landingAuto: true, tier: 'T2' } } },
    'merge queue not stalled': { alerts: [{ number: 6000, title: QUEUE_STALLED, state: 'open' }] },
  };
  for (const [name, over] of Object.entries(cases)) {
    const r = decide(facts(over));
    assert.equal(r.mayQueue, false, name);
    assert.equal(gate(r, name).ok, false, name);
    assert.equal(gate(r, 'agents may queue').ok, true, name);
    assert.match(r.verdict, /a gate failed/);
    assert.deepEqual(r.commands, [], name);
  }
});

test('decide: unread facts fail closed', () => {
  const r = decide(facts({ files: null, alerts: null, rules: null }));
  assert.equal(r.mayQueue, false);
  assert.match(gate(r, 'landing-policy.yml untouched').detail, /unread/);
  assert.match(gate(r, 'merge queue not stalled').detail, /unread/);
  assert.equal(decide({}).mayQueue, false);
});

test('decide: auto-merge already on runs nothing; beforePush disables it', () => {
  const pr = { ...facts().pr, auto_merge: { merge_method: 'squash' } };
  const r = decide(facts({ pr }));
  assert.equal(r.commands.some((c) => c.startsWith('gh ')), false);
  assert.deepEqual(beforePush(pr), ['gh pr merge 7 --disable-auto']);
  assert.deepEqual(beforePush(facts().pr), []);
});
