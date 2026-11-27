// D9027 (#9027): the scorecard's queue rows by agent slot, from the Agent-Slot trailer that
// agent-provenance.mjs's classifyPr reads off the commits on each PR's timeline.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as m from '../../scripts/lib/ciScorecard.mjs';

const at = (h, min = 0) => `2026-11-26T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`;
const start = Date.parse(at(0));
const now = Date.parse('2026-11-27T00:00:00Z');
const SESSION = 'https://claude.ai/code/session_x';
let shaSeed = 0;
const sha = () => (++shaSeed).toString(16).padStart(40, '0');

const chain = (slot, task) => `Agent-Slot: ${slot}\nAgent-Task: ${task}\nAgent-Run: manual\nAgent-Session: ${SESSION}`;
const commit = (message, date = at(1), parents = 1) => ({
  event: 'committed', sha: sha(), message, author: { name: 'someone', date }, committer: { name: 'someone', date },
  parents: Array.from({ length: parents }, () => ({ sha: sha() })),
});
const added = h => ({ event: 'added_to_merge_queue', created_at: at(h), actor: { login: 'x', type: 'User' } });
const removed = h => ({ event: 'removed_from_merge_queue', created_at: at(h), actor: { login: 'x', type: 'User' } });
const merged = h => ({ event: 'merged', created_at: at(h), commit_id: sha(), actor: { login: 'x', type: 'User' } });

/** A PR as the collector builds it, from raw timeline events. */
const pr = (number, events, mergedAt) => {
  const allEntries = m.queueEntries(events);
  return { number, mergedAt, allEntries, entries: allEntries, events: m.slimEvents(events), provenance: m.prProvenance(events) };
};

// S03: four PRs. 7 waited 60 min; 8 was ejected once (02:00-03:00) and merged at 05:00 (180 min from the first entry);
// 9 waited 30 min; 10 waited 120 min. S03 has a merge commit of main with no trailers: its slot still reads.
const s03 = [
  pr(7, [commit(`Build it\n\n${chain('S03', '#7')}`), added(2), merged(3)], at(3)),
  pr(8, [commit(`Build it\n\n${chain('S03', '#8')}`), commit("Merge branch 'main'", at(1, 30), 2),
    added(2), removed(3), added(4), merged(5)], at(5)),
  pr(9, [commit(`Build it\n\n${chain('S03', '#9')}`), added(6), merged(6, 30)], at(6, 30)),
  pr(10, [commit(`Build it\n\n${chain('S03', '#10')}`), added(7), merged(9)], at(9)),
];
// S12: two PRs, a small sample. 20 waited 40 min; 21 was ejected twice and waited 300 min.
const s12 = [
  pr(20, [commit(`Do it\n\n${chain('S12', '#20')}`), added(10), merged(10, 40)], at(10, 40)),
  pr(21, [commit(`Do it\n\n${chain('S12', '#21')}`), added(10), removed(11), added(12), removed(13), added(14), merged(15)], at(15)),
];
// A person's PR: no identity trailer on any commit, though its branch would read as agent/**.
const human = pr(30, [commit('Fix a typo\n\nSigned-off-by: A Person <a@example.invalid>'), added(16), merged(16, 10)], at(16, 10));
// Untrailed: only the legacy session trailer before the cutover, which carries no slot. Ejected once: 50 min from
// the first entry, 20 from the last.
const legacy = pr(40, [commit(`Old style\n\nClaude-Session: ${SESSION}`), added(17), removed(17, 10), added(17, 30), merged(17, 50)], at(17, 50));

const prs = [...s03, ...s12, human, legacy, pr(99, [commit(`Open\n\n${chain('S03', '#99')}`), added(18)], null)];

test('prProvenance takes the slot classifyPr reads from the commit trailers', () => {
  assert.deepEqual(s03[0].provenance, { status: 'pass', slot: 'S03' });
  // The untrailed merge of main fails the chain but leaves the one slot the other commits name.
  assert.deepEqual(s03[1].provenance, { status: 'fail', slot: 'S03' });
  assert.deepEqual(human.provenance, { status: 'human', slot: null });
  assert.deepEqual(legacy.provenance, { status: 'fail', slot: null });
  assert.deepEqual(m.prProvenance([]), { status: 'unavailable', slot: null });
});

test('two slots, a human PR and an untrailed PR yield four rows with the right medians and counts', () => {
  const rows = [{ pr: 8, outcome: 'failed-check' }, { pr: 8, outcome: 'merged' }, { pr: 21, outcome: 'failed-check' },
    { pr: 21, outcome: 'cancelled-or-superseded' }, { pr: 99, outcome: 'failed-check' }];
  assert.deepEqual(m.bySlot(prs, rows), [
    { row: 'S03', merged: 4, small: false, queueToMerge: { value: 60, n: 4 }, entries: { value: 1.25, n: 4 }, removed: 1, failed: 1 },
    { row: 'S12', merged: 2, small: true, queueToMerge: { value: 40, n: 2 }, entries: { value: 2, n: 2 }, removed: 2, failed: 1 },
    { row: 'human', merged: 1, small: true, queueToMerge: { value: 10, n: 1 }, entries: { value: 1, n: 1 }, removed: 0, failed: 0 },
    { row: 'untrailed', merged: 1, small: true, queueToMerge: { value: 50, n: 1 }, entries: { value: 2, n: 1 }, removed: 1, failed: 0 },
  ]);
});

test('the median is p50 over the row: three PRs of 30, 60 and 180 min read 60', () => {
  assert.deepEqual(m.bySlot(s03.slice(0, 3))[0].queueToMerge, { value: 60, n: 3 });
  assert.equal(m.bySlot(s03.slice(0, 3))[0].small, false);
});

test('no slot is taken from the branch name; two slots, no trailer or no provenance go to untrailed', () => {
  const branchOnly = { number: 50, mergedAt: at(20), head: { ref: 'agent/claude/50-x' }, branch: 'agent/claude/50-x', allEntries: [],
    provenance: m.prProvenance([commit('Plain message on an agent branch')]) };
  assert.deepEqual(branchOnly.provenance, { status: 'human', slot: null });
  const twoSlots = pr(51, [commit(`A\n\n${chain('S03', '#51')}`), commit(`B\n\n${chain('S04', '#51')}`), added(20), merged(21)], at(21));
  const brokenSlot = pr(52, [commit('A\n\nAgent-Slot: S3\nAgent-Task: #52\nAgent-Run: manual'), added(20), merged(21)], at(21));
  assert.deepEqual([twoSlots, brokenSlot, { number: 53, mergedAt: at(21), allEntries: [] }].map(m.slotRowOf), ['untrailed', 'untrailed', 'untrailed']);
  assert.equal(m.slotRowOf({ provenance: { status: 'pass', slot: 'S03 | x' } }), 'untrailed');
  assert.equal(m.slotRowOf({ provenance: { status: 'human', slot: 'S03' } }), 'human');
});

test('the report renders the by-slot table and marks a small sample', () => {
  const output = m.report({ runs: [], queueRuns: [], prs, start, now, requests: 0, rows: [{ pr: 8, outcome: 'failed-check' }] });
  assert.ok(output.includes('### Queue by agent slot'));
  for (const line of ['| S03 | 4 | 60.0 | 1.3 | 1 | 1 |', '| S12 (small sample) | 2 | 40.0 | 2.0 | 2 | 0 |',
    '| human (small sample) | 1 | 10.0 | 1.0 | 0 | 0 |', '| untrailed (small sample) | 1 | 50.0 | 2.0 | 1 | 0 |']) {
    assert.ok(output.includes(line), line);
  }
  const empty = m.report({ runs: [], prs: [], start, now, requests: 0 });
  assert.ok(empty.includes('No merged PRs in the window.'));
  assert.doesNotMatch(empty.slice(empty.indexOf('### Queue by agent slot')), /n\/a/);
});

test('the collector reads the slot from the timeline it already fetches, with no new request', () => {
  const cli = readFileSync(new URL('../../scripts/ci-scorecard.mjs', import.meta.url), 'utf8');
  assert.match(cli, /events: slimEvents\(events\), provenance: prProvenance\(events\),/);
  assert.doesNotMatch(cli, /commits\?|\/commits`|git log/);
});
