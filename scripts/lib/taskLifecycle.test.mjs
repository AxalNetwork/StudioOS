// #6326: tests for the slot protocol's decisions (lib/taskLifecycle.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normSlot, isSlotLabel, readyQueue, renderStatus, labelPlan, isStatusComment, isBlockedStatus, looksLikeAgentNote, ownerAnswers, claimAction,
  parseArgs, OWNER,
} from './taskLifecycle.mjs';

const issue = (number, created, labels, extra = {}) => ({ number, created_at: created, labels: labels.map(name => ({ name })), state: 'open', ...extra });

test('normSlot: the standard slots and assigned later ones such as s39 (D5617)', () => {
  assert.equal(normSlot('s5'), 'S05');
  assert.equal(normSlot('S37'), 'S37');
  assert.equal(normSlot('s38'), 'S38');
  assert.equal(normSlot('s39'), 'S39');
  assert.equal(normSlot('S00'), null);
  assert.equal(normSlot('S100'), null);
  assert.equal(normSlot('slot:S05'), null);
  assert.ok(isSlotLabel('slot:s39', 'S39'));
  assert.ok(isSlotLabel('slot:S05', 's5'));
  assert.ok(!isSlotLabel('slot:S06', 'S05'));
  assert.ok(!isSlotLabel('state:ready', 'S05'));
});

test('readyQueue: the slot and state:ready, oldest first, never a PR', () => {
  const rows = [
    issue(30, '2026-11-03T00:00:00Z', ['slot:S05', 'state:ready']),
    issue(10, '2026-11-01T00:00:00Z', ['slot:S05', 'state:ready'], { pull_request: {} }),
    issue(20, '2026-11-02T00:00:00Z', ['slot:S05', 'state:ready']),
    issue(40, '2026-11-01T00:00:00Z', ['slot:S06', 'state:ready']),
    issue(50, '2026-11-01T00:00:00Z', ['slot:S05', 'state:blocked']),
  ];
  assert.deepEqual(readyQueue(rows, 'S05').map(i => i.number), [20, 30]);
  assert.throws(() => readyQueue(rows, 'S100'));
});

test('readyQueue: a lower-case later slot label matches', () => {
  assert.deepEqual(readyQueue([issue(5, '2026-11-01T00:00:00Z', ['slot:s39', 'state:ready'])], 'S39').map(i => i.number), [5]);
});

test('readyQueue: equal creation times fall back to the lower number', () => {
  const at = '2026-11-01T00:00:00Z';
  assert.deepEqual(readyQueue([issue(9, at, ['slot:S05', 'state:ready']), issue(8, at, ['slot:S05', 'state:ready'])], 'S05').map(i => i.number), [8, 9]);
});

test('renderStatus writes the AGENTS.md block inside a text fence', () => {
  const text = renderStatus({ issue: 6064, slot: 's7', agent: 'Claude Code', branch: 'agent/claude/6064-x', state: 'IN_PROGRESS',
    blockers: 'Claimed by label: claim.mjs exit 4' });
  assert.equal(text, [
    '```text', 'STATUS', 'task: #6064   slot: S07   agent: Claude Code', 'branch: agent/claude/6064-x', 'state: IN_PROGRESS',
    'files: none yet', 'blockers: Claimed by label: claim.mjs exit 4', 'questions: none', 'tests: none run', 'pr: none yet', '```',
  ].join('\n'));
  assert.ok(isStatusComment(text));
});

test('renderStatus refuses a bad state, slot, missing branch or a fence in a field', () => {
  const ok = { issue: 1, slot: 'S05', agent: 'a', branch: 'b', state: 'DONE' };
  assert.doesNotThrow(() => renderStatus(ok));
  assert.throws(() => renderStatus({ ...ok, state: 'READY' }));
  assert.throws(() => renderStatus({ ...ok, slot: 'S100' }));
  assert.throws(() => renderStatus({ ...ok, branch: ' ' }));
  assert.throws(() => renderStatus({ ...ok, issue: '0' }));
  assert.throws(() => renderStatus({ ...ok, tests: 'see ```' }));
});

test('renderStatus folds multi-line fields onto their line', () => {
  const text = renderStatus({ issue: 1, slot: 'S05', agent: 'a', branch: 'b', state: 'BLOCKED', questions: 'A) one\nB) two' });
  assert.match(text, /^questions: A\) one B\) two$/m);
});

test('labelPlan swaps state labels the way the STATUS table says', () => {
  assert.deepEqual(labelPlan(['slot:S05', 'state:ready'], 'IN_PROGRESS'), { add: ['state:in-progress'], remove: ['state:ready'] });
  assert.deepEqual(labelPlan(['state:in-progress'], 'READY_FOR_REVIEW'), { add: ['state:review'], remove: ['state:in-progress'] });
  assert.deepEqual(labelPlan(['state:in-progress'], 'BLOCKED', { needsDecision: true }), { add: ['state:blocked', 'needs-decision'], remove: ['state:in-progress'] });
  assert.deepEqual(labelPlan(['state:in-progress'], 'BLOCKED'), { add: ['state:blocked'], remove: ['state:in-progress'] });
  assert.deepEqual(labelPlan(['state:review'], 'DONE'), { add: [], remove: [] });
});

test('labelPlan: an owner answer takes needs-decision off; it never goes on outside BLOCKED', () => {
  assert.deepEqual(labelPlan(['state:blocked', 'needs-decision', 'needs-design'], 'IN_PROGRESS'),
    { add: ['state:in-progress'], remove: ['state:blocked', 'needs-decision'] });
  assert.deepEqual(labelPlan(['state:blocked', 'needs-decision'], 'BLOCKED'), { add: [], remove: [] });
  assert.throws(() => labelPlan([], 'IN_PROGRESS', { needsDecision: true }));
  assert.throws(() => labelPlan([], 'WAITING'));
});

const comment = (at, body, login = OWNER) => ({ created_at: at, body, user: { login }, html_url: `u#${at}` });
const STATUS = '```text\nSTATUS\ntask: #1   slot: S05   agent: a\nstate: BLOCKED\n```';

test('isStatusComment: fenced or bare block, not a mention', () => {
  assert.ok(isStatusComment(STATUS));
  assert.ok(isStatusComment('STATUS\ntask: #1'));
  assert.ok(!isStatusComment('The STATUS above says blocked.'));
  assert.ok(!isStatusComment('STATUS'));
});

test('isBlockedStatus and looksLikeAgentNote', () => {
  assert.ok(isBlockedStatus(STATUS));
  assert.ok(!isBlockedStatus(STATUS.replace('BLOCKED', 'IN_PROGRESS')));
  assert.ok(looksLikeAgentNote('STATUS S31: Draft #6350 is open'));
  assert.ok(looksLikeAgentNote('Local verification on fbeece44a: all passed.'));
  assert.ok(looksLikeAgentNote('note\n_Generated by [Claude Code](https://claude.ai/code)_'));
  assert.ok(!looksLikeAgentNote('A'));
  assert.ok(!looksLikeAgentNote('B, but keep the old route for a week'));
});

test('ownerAnswers: owner comments after the last STATUS, S1 relays apart', () => {
  const r = ownerAnswers([
    comment('2026-11-02T00:00:00Z', 'B'),
    comment('2026-11-03T00:00:00Z', STATUS),
    comment('2026-11-04T00:00:00Z', 'A'),
    comment('2026-11-05T00:00:00Z', 'S1: the owner chose A.'),
    comment('2026-11-06T00:00:00Z', 'C please', 'someone-else'),
    comment('2026-11-07T00:00:00Z', 'A note\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_'),
    comment('2026-11-08T00:00:00Z', '<!-- coordinator-audit:v1 run=2026-11-14a kind=note key=1 -->\nAudit note'),
  ]);
  assert.deepEqual([r.anchorAt, r.anchorKind], ['2026-11-03T00:00:00Z', 'BLOCKED']);
  assert.deepEqual(r.answers.map(c => [c.body.slice(0, 6), c.maybeAgent]), [['A', false], ['A note', true]]);
  assert.deepEqual(r.relays.map(c => c.body), ['S1: the owner chose A.']);
});

test('ownerAnswers: a later STATUS from another slot does not hide the answer to the BLOCKED one', () => {
  const r = ownerAnswers([
    comment('2026-11-03T00:00:00Z', STATUS),
    comment('2026-11-04T00:00:00Z', 'A'),
    comment('2026-11-05T00:00:00Z', STATUS.replace('BLOCKED', 'IN_PROGRESS').replace('S05', 'S06')),
    comment('2026-11-06T00:00:00Z', 'STATUS S31: Draft #6350 is open'),
  ]);
  assert.equal(r.anchorKind, 'BLOCKED');
  assert.deepEqual(r.answers.map(c => [c.body, c.maybeAgent]), [['A', false], ['STATUS S31: Draft #6350 is open', true]]);
});

test('ownerAnswers: nothing after the last STATUS is no answer', () => {
  const r = ownerAnswers([comment('2026-11-04T00:00:00Z', 'A'), comment('2026-11-05T00:00:00Z', STATUS)]);
  assert.deepEqual([r.answers.length, r.relays.length], [0, 0]);
});

const claim = (at, extra = {}) => ({ version: 1, issue: 7, slot: 'S05', agent: 'Claude Code', session: 'session_a', at, ttlHours: 24, ...extra });
const me = { slot: 'S05', agent: 'Claude Code', session: 'session_a' };
const NOW = Date.parse('2026-11-14T12:00:00Z');

test('claimAction: ok, renew, expired, release', () => {
  assert.equal(claimAction(claim('2026-11-14T10:00:00Z'), { ...me, now: NOW, issueState: 'open' }).action, 'ok');
  const renew = claimAction(claim('2026-11-13T14:00:00Z'), { ...me, now: NOW, issueState: 'open' });
  assert.deepEqual([renew.action, renew.hoursLeft, renew.mine], ['renew', 2, true]);
  assert.equal(claimAction(claim('2026-11-13T12:00:00Z'), { ...me, now: NOW, issueState: 'open' }).action, 'expired');
  assert.equal(claimAction(claim('2026-11-14T10:00:00Z'), { ...me, now: NOW, issueState: 'closed' }).action, 'release');
});

test('claimAction: another session or slot is left alone, even expired or closed', () => {
  const other = claimAction(claim('2026-11-10T00:00:00Z', { session: 'session_b' }), { ...me, now: NOW, issueState: 'closed' });
  assert.deepEqual([other.action, other.mine], ['leave', false]);
  assert.equal(claimAction(claim('2026-11-10T00:00:00Z', { slot: 'S06' }), { ...me, now: NOW, issueState: 'closed' }).action, 'leave');
  assert.equal(claimAction(null, me).action, 'unreadable');
});

test('claimAction: without agent and session nothing is mine, so nothing is actionable', () => {
  const r = claimAction(claim('2026-11-13T12:00:00Z'), { slot: 'S05', now: NOW, issueState: 'open' });
  assert.deepEqual([r.state, r.action, r.mine], ['expired', 'leave', false]);
  assert.equal(claimAction(claim('2026-11-13T12:00:00Z'), { slot: 'S05', agent: 'Claude Code', now: NOW }).action, 'leave');
});

test('claimAction: a slot stored lower-case (claim.mjs keeps it as typed) still matches', () => {
  const r = claimAction(claim('2026-11-14T10:00:00Z', { slot: 's39' }), { ...me, slot: 'S39', now: NOW, issueState: 'open' });
  assert.deepEqual([r.action, r.mine], ['ok', true]);
});

test('parseArgs: pairs and flags; a missing value fails', () => {
  assert.deepEqual(parseArgs(['--slot', 'S05', '--needs-decision', '--agent', 'Claude Code'], { flags: ['needs-decision'] }),
    { slot: 'S05', 'needs-decision': true, agent: 'Claude Code' });
  assert.throws(() => parseArgs(['--slot']));
  assert.throws(() => parseArgs(['--slot', '--agent', 'x']));
  assert.throws(() => parseArgs(['S05']));
});
