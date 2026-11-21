// #6312: the coordinator's label, slot, staleness, marker, delta and digest rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planLabels, slotOf, isStandardSlotLabel, slotPicker, slotLoad, classifyProposal, proposalLabels,
  marker, parseMarkers, alreadyDone, staleReasons, renderNote, planFromFindings, deltaSelect,
  landedName, parseDigests, compareDigests, boardsOf,
} from './coordinator.mjs';

test('planLabels swaps the state, keeps one slot, and reports what changed', () => {
  const r = planLabels(['task', 'slot:S01', 'state:ready'], { state: 'state:blocked', add: ['needs-decision'], slot: 'S07' });
  assert.deepEqual(r.labels.sort(), ['needs-decision', 'slot:S07', 'state:blocked', 'task']);
  assert.deepEqual(r.added.sort(), ['needs-decision', 'slot:S07', 'state:blocked']);
  assert.deepEqual(r.removed.sort(), ['slot:S01', 'state:ready']);
});

test('planLabels folds a lower-case slot label into the standard one', () => {
  assert.deepEqual(planLabels(['slot:s39', 'state:ready'], { slot: 'S12' }).labels.sort(), ['slot:S12', 'state:ready']);
});

test('planLabels refuses what AGENTS.md does not allow', () => {
  assert.throws(() => planLabels(['state:blocked'], { state: 'state:ready', add: ['needs-decision'] }), /needs-decision needs state:blocked/);
  assert.throws(() => planLabels(['state:blocked', 'needs-design'], { remove: ['state:blocked'] }), /no state label/);
  assert.throws(() => planLabels(['needs-decision'], {}), /needs-decision needs state:blocked, not no state label/);
  assert.throws(() => planLabels([], { slot: 'S39' }), /non-standard slot/);
  assert.throws(() => planLabels([], { state: 'state:in-review' }), /unknown state/);
  assert.throws(() => planLabels(['state:ready', 'state:review'], {}), /two state labels/);
});

test('moving to a state other than blocked drops the needs-* flags', () => {
  const r = planLabels(['state:blocked', 'needs-design', 'needs-decision'], { state: 'state:ready' });
  assert.deepEqual(r.labels, ['state:ready']);
  assert.deepEqual(r.removed.sort(), ['needs-decision', 'needs-design', 'state:blocked']);
});

test('slot moves: never into S18 or S32, S01 only for coordinator work, never an active claim', () => {
  assert.throws(() => planLabels(['slot:S05'], { slot: 'S18' }), /S18 takes no moved work/);
  assert.throws(() => planLabels(['slot:S05'], { slot: 'slot:s32' }), /S32/);
  assert.throws(() => planLabels(['slot:S05'], { slot: 'S01' }, { kind: 'task' }), /only trackers/);
  assert.deepEqual(planLabels(['slot:S05'], { slot: 'S01' }, { kind: 'tracker' }).labels, ['slot:S01']);
  assert.throws(() => planLabels(['slot:S05', 'state:in-progress'], { slot: 'S07' }, { activeClaim: true }), /active claim/);
  assert.equal(planLabels(['slot:S18'], { slot: 'S18' }).changed, false);
});

test('planLabels with no change reports none', () => {
  assert.equal(planLabels(['task', 'state:ready'], {}).changed, false);
  assert.equal(planLabels(['task', 'state:ready'], { state: 'state:ready' }).changed, false);
});

test('slot labels: only S01 to S37 in upper case are standard', () => {
  assert.equal(slotOf('slot:s38'), 'S38');
  assert.equal(slotOf('state:ready'), null);
  assert.equal(isStandardSlotLabel('slot:S37'), true);
  assert.equal(isStandardSlotLabel('slot:S38'), false);
  assert.equal(isStandardSlotLabel('slot:s05'), false);
});

test('slotPicker never picks S01, S18 or S32 and spreads a batch over the least loaded', () => {
  const load = {};
  for (let n = 1; n <= 37; n++) load[`S${String(n).padStart(2, '0')}`] = 5;
  load.S04 = 1; load.S09 = 2;
  const pick = slotPicker(load);
  const got = Array.from({ length: 6 }, pick);
  assert.deepEqual(got.slice(0, 5), ['S04', 'S04', 'S09', 'S04', 'S09']);
  for (const s of Array.from({ length: 200 }, pick)) assert.ok(!['S01', 'S18', 'S32'].includes(s));
});

test('slotLoad counts lower-case labels under their standard slot', () => {
  assert.deepEqual(slotLoad([{ labels: [{ name: 'slot:s39' }] }, { labels: ['slot:S39', 'task'] }]), { S39: 2 });
});

test('a proposal is a build task, a brief or a decision, and is labelled to match', () => {
  assert.equal(classifyProposal({ type: 'design-brief', title: 'x' }), 'brief');
  assert.equal(classifyProposal({ type: 'frontend', title: 'Claude Design brief: Grow Markets' }), 'brief');
  assert.equal(classifyProposal({ type: 'frontend', title: 'Owner decision: watermark' }), 'decision');
  assert.deepEqual(proposalLabels({ type: 'design-brief', title: 'b' }, {}).labels, ['task', 'slot:S01', 'state:blocked', 'needs-design']);
  assert.deepEqual(proposalLabels({ type: 'full-stack', title: 'b' }, { slot: 'S07', ready: true }).labels, ['task', 'frontend', 'worker', 'slot:S07', 'state:ready']);
  assert.deepEqual(proposalLabels({ type: 'worker', title: 'b' }, { slot: 'S07', ready: false }).labels, ['task', 'worker', 'slot:S07', 'state:blocked']);
  assert.throws(() => proposalLabels({ type: 'worker', title: 'b' }, { slot: 'S38' }), /standard slot/);
});

test('markers round-trip, and alreadyDone finds this run only', () => {
  const m = marker('2026-11-14a', 'file', 'sec:founder-grow-a:3');
  assert.deepEqual(parseMarkers(`text\n${m}`), [{ version: 'v1', run: '2026-11-14a', kind: 'file', key: 'sec:founder-grow-a:3' }]);
  assert.equal(alreadyDone([`x ${m}`], '2026-11-14a', 'file', 'sec:founder-grow-a:3'), true);
  assert.equal(alreadyDone([`x ${m}`], '2026-11-21a', 'file', 'sec:founder-grow-a:3'), false);
  assert.throws(() => marker('bad run id!', 'note'), /run id/);
});

test('staleReasons ignores this run\'s own comments and nothing else', () => {
  const snap = { state: 'open', title: 'T', body: 'b', labels: ['a', 'b'] };
  const own = { body: `note ${marker('r1', 'note')}` };
  assert.deepEqual(staleReasons(snap, { ...snap, labels: ['b', 'a'] }, [own], 'r1'), []);
  assert.deepEqual(staleReasons(snap, { ...snap, state: 'closed', body: 'c', labels: ['a'] }, [own, { body: 'a slot STATUS' }], 'r1'),
    ['closed since the snapshot', 'body edited', 'labels changed', '1 new comment(s)']);
});

test('the status note starts with S1: and ends with the marker', () => {
  const body = renderNote({ verdict: 'release_to_ready', evidence: 'E', remaining_work: 'R' }, { runId: 'r1', mainSha: 'abcdef1234567', date: '2026-11-14', labelText: 'added `state:ready`.' });
  assert.match(body, /^S1: coordinator audit, 2026-11-14\. Checked against main `abcdef1234`/);
  assert.match(body, /\*\*Labels changed:\*\* added `state:ready`\./);
  assert.ok(body.endsWith(marker('r1', 'note')));
  const sup = renderNote({ verdict: 'close_superseded' }, { runId: 'r1', mainSha: 'a', date: 'd', closing: 'not_planned' });
  assert.match(sup, /Closing as not planned \(superseded\)/);
  assert.doesNotMatch(sup, /Closing as completed/);
  assert.throws(() => marker(undefined, 'note'), /run id/);
  assert.throws(() => marker('--go', 'note'), /run id/);
});

test('planFromFindings closes only what the verifier allowed and drops unsupported notes', () => {
  const steps = planFromFindings([
    { number: 1, verdict: 'close_done', verification: { safe_to_close: true } },
    { number: 2, verdict: 'close_done', verification: { safe_to_close: false, unfinished: 'U', label_change_ok: true }, label_change: { state: 'state:ready' } },
    { number: 7, verdict: 'close_done', verification: { safe_to_close: true, note_supported: false } },
    { number: 8, verdict: 'needs_status_fix', label_change: { state: 'state:ready' }, verification: {} },
    { number: 3, verdict: 'needs_status_fix', label_change: { state: 'state:blocked' }, verification: { note_supported: false, label_change_ok: false } },
    { number: 4, verdict: 'keep_as_is', verification: {} },
    { number: 5, verdict: 'split_or_rescope', remaining_work: 'old', verification: { corrected: { remaining_work: 'new' } } },
    { number: 6, verdict: 'close_superseded', verification: { safe_to_close: true } },
  ]);
  const st = n => steps.find(x => x.number === n);
  assert.equal(st(1).close, 'completed');
  assert.equal(st(2).close, null); assert.equal(st(2).note.unfinished, 'U'); assert.deepEqual(st(2).labelChange, { state: 'state:ready' });
  assert.equal(st(3).note, null); assert.equal(st(3).labelChange, null);
  assert.equal(st(4).note, null);
  assert.equal(st(5).note.remaining_work, 'new');
  assert.equal(st(6).close, 'not_planned');
  assert.equal(st(7).close, null, 'no close without its note');
  assert.equal(st(8).labelChange, null, 'a label change nobody verified is dropped');
  assert.throws(() => planFromFindings([{ number: 1, verdict: 'keep_as_is' }, { number: 1, verdict: 'keep_as_is' }]), /two findings/);
});

test('deltaSelect re-reads new issues, issues named by merged PRs, and issues with activity after their last note', () => {
  const since = '2026-11-14T00:00:00Z';
  const issues = [
    { number: 1, created_at: '2026-11-15T00:00:00Z', updated_at: '2026-11-15T00:00:00Z' },
    { number: 2, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' },
    { number: 3, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-11-16T00:00:00Z' },
    { number: 4, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-11-14T02:05:00Z' },
    { number: 5, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' },
  ];
  const got = deltaSelect({ issues, since, lastNoteAt: { 3: '2026-11-14T02:00:00Z', 4: '2026-11-14T02:00:00Z' }, mergedPrBodies: ['Closes #5'] });
  assert.deepEqual([...got.keys()].sort(), [1, 3, 5]);
});

test('landedName gives boards files the repo name and leaves pages alone', () => {
  assert.equal(landedName('Build v2.dc.html'), 'Build v2 · Boards.dc.html');
  assert.equal(landedName('Build v2 Page.dc.html'), 'Build v2 Page.dc.html');
  assert.equal(landedName('Build v2 · Boards.dc.html'), 'Build v2 · Boards.dc.html');
  assert.throws(() => landedName('notes.md'), /not a canvas/);
});

test('parseDigests pairs each file with its own digest and trusts only owner, member or collaborator text', () => {
  const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64);
  assert.deepEqual(parseDigests([`| \`X Page.dc.html\` | \`${a}\` | \`X.dc.html\` | \`${b}\` |`]), { 'X Page.dc.html': a, 'X.dc.html': b });
  assert.deepEqual(parseDigests([`\`Build v2.dc.html\`: was ${a}, now ${c}`]), { 'Build v2.dc.html': c });
  assert.deepEqual(parseDigests([`SHA-256 of \`Build v2.dc.html\` is ${a.toUpperCase()}`]), { 'Build v2.dc.html': a });
  assert.deepEqual(parseDigests([{ body: `\`X.dc.html\` ${a}`, trusted: true }, { body: `\`X.dc.html\` ${b}`, trusted: false }]), { 'X.dc.html': a });
  assert.deepEqual(parseDigests([`\`X.dc.html\` ${a}`, `\`X.dc.html\` ${b}`]), { 'X.dc.html': 'conflict' });
});

test('compareDigests accepts a digest recorded under the landed name, and reports every outcome', () => {
  const a = 'a'.repeat(64), b = 'b'.repeat(64);
  const rows = compareDigests({ 'Build v2 Page.dc.html': a, 'Build v2.dc.html': b, 'X.dc.html': a, 'Y.dc.html': a, 'Z.dc.html': a },
    { 'Build v2 Page.dc.html': a, 'Build v2 · Boards.dc.html': b, 'X.dc.html': b, 'Y.dc.html': 'conflict' });
  assert.deepEqual(rows.map(r => r.result), ['match', 'match', 'mismatch', 'conflict', 'unrecorded']);
});

test('boardsOf reads the board list a boards file renders', () => {
  const html = "const boards = [\n['BD-0', 'Audit, journey', 'cap', []],\n['BD14m', 'Phone parity', 'cap', []],\n['GR-01', 'Grow Overview · sparse', 'c', []]";
  assert.deepEqual(boardsOf(html).map(b => b.id), ['BD-0', 'BD14m', 'GR-01']);
});
