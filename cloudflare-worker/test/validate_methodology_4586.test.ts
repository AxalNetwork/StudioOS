/**
 * D4586 (#4586) — Validate methodology v2, proposed. These pin the outcomes the
 * decision record tabulates, side by side with what v1 (`verdictFor`, the
 * shipped rule) gives today, so a reviewer reads each deliberate change as a
 * test rather than as prose. v2 is not wired into the product by this PR.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/validate_methodology_4586.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { claimStatusV2, decisionEvidenceV2, sourceKey, METHODOLOGY_VERSION, type EvidenceRow } from '../src/services/validateMethodology.ts';
import { verdictFor } from '../src/routes/_founder_validate_helpers.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const V1_NAME: Record<string, string> = { validated: 'supported', invalidated: 'contradicted', unproven: 'insufficient' };
const v1 = (s: number, c: number, u = 0) => { const v = verdictFor({ supporting: s, contradicting: c, fitUnrecorded: u }); return v === null ? 'unknown' : V1_NAME[v]; };
const v2 = (s: number, c: number, u = 0) => claimStatusV2({ supporting: s, contradicting: c, fitUnrecorded: u });

// The table in D4586.md, row for row: [supporting, contradicting, unrecorded fit, v1, v2].
const TABLE: [number, number, number, string, string][] = [
  [0, 0, 0, 'insufficient', 'insufficient'],
  [4, 0, 0, 'insufficient', 'insufficient'],
  [5, 0, 0, 'supported', 'supported'],
  [5, 2, 0, 'supported', 'supported'],
  [5, 3, 0, 'supported', 'contested'],
  [5, 5, 0, 'supported', 'contested'],
  [5, 6, 0, 'supported', 'contradicted'],
  [5, 50, 0, 'supported', 'contradicted'],
  [0, 1, 0, 'insufficient', 'insufficient'],
  [0, 2, 0, 'contradicted', 'contradicted'],
  [3, 4, 0, 'contradicted', 'contradicted'],
  [4, 0, 1, 'unknown', 'unknown'],
  [5, 0, 3, 'supported', 'supported'],
  [5, 3, 2, 'supported', 'unknown'],
  [0, 3, 1, 'unknown', 'contradicted'],
  [2, 0, 1, 'unknown', 'insufficient'],
];

test('claim status: every row of the D4586 table, v1 as shipped and v2 as proposed', () => {
  // Mutations checked: contradiction read after the bar; the contested rule removed; unknown whenever any fit is missing.
  for (const [s, c, u, want1, want2] of TABLE) {
    assert.equal(v1(s, c, u), want1, `v1 ${s}/${c} unknown ${u}`);
    assert.equal(v2(s, c, u), want2, `v2 ${s}/${c} unknown ${u}`);
  }
});

test('the table in D4586.md is the table this test pins', () => {
  const doc = readFileSync(join(ROOT, 'documentation/architecture/decisions/D4586.md'), 'utf8');
  for (const [s, c, u, want1, want2] of TABLE) {
    assert.match(doc, new RegExp(`\\| ${s} \\| ${c} \\| ${u} \\| ${want1} \\| ${want2} \\|`), `row ${s}/${c}/${u} missing from D4586.md`);
  }
});

test('one contradiction is never material, whatever the bar', () => {
  // Mutations checked: the two-contradiction floor removed from materialContradiction.
  assert.equal(claimStatusV2({ supporting: 2, contradicting: 1, fitUnrecorded: 0 }, 2), 'supported');
  assert.equal(claimStatusV2({ supporting: 2, contradicting: 2, fitUnrecorded: 0 }, 2), 'contested');
});

test('an interview that touches both directions stays in both counts', () => {
  // One ICP interview naming a supporting and a contradicting theme: one supporter and one contradiction, as in v1.
  assert.equal(v2(1, 1), 'insufficient');
  assert.equal(v2(5, 5), 'contested', 'five interviews each touching both sides');
});

const row = (id: string, kind: EvidenceRow['kind'], ref: string, h: number, direction: EvidenceRow['direction'] = 'supports', observed?: boolean): EvidenceRow =>
  ({ id, kind, ref_id: ref, hypothesis_id: h, direction, ...(observed === undefined ? {} : { observed }) });

test('five links to one interview are five relationships and one source, and do not meet the bar', () => {
  // Mutations checked: counting links instead of sources; sourceKey ignoring the kind.
  const rows = [1, 2, 3, 4, 5].map((n) => row(`pain-${n}-12`, 'interview', '12', 1));
  const e = decisionEvidenceV2(rows, 1);
  assert.deepEqual([e.links, e.sources, e.counted, e.interviews, e.state], [5, 1, 1, 1, 'withheld']);
  assert.equal(e.excluded.filter((x) => x.reason === 'duplicate_source').length, 4);
  assert.equal(METHODOLOGY_VERSION, 2);
  assert.notEqual(sourceKey({ kind: 'interview', ref_id: '7' }), sourceKey({ kind: 'experiment', ref_id: '7' }));
});

test('genuinely distinct sources meet the bar; contradicting sources count toward it', () => {
  const rows = [
    row('pain-1-1', 'interview', '1', 1), row('pain-1-2', 'interview', '2', 1), row('evidence-3', 'signal', 'signal-4', 1),
    row('evidence-4', 'metric', 'mrr', 1), row('pain-2-5', 'interview', '5', 1, 'contradicts'),
  ];
  const people = new Map([['1', { name: 'A', company: 'X' }], ['2', { name: 'B', company: 'X' }], ['5', { name: 'C', company: 'Y' }]]);
  const e = decisionEvidenceV2(rows, 1, people);
  assert.deepEqual([e.counted, e.counted_supporting, e.counted_contradicting, e.state], [5, 4, 1, 'given']);
  assert.deepEqual([e.interviews, e.interviewees, e.organizations], [3, 3, 2], 'three interviews with three people from two organizations');
  // An interviewee without a recorded company makes the organization breadth unknown, not smaller.
  people.set('5', { name: 'C', company: null });
  assert.equal(decisionEvidenceV2(rows, 1, people).organizations, null);
});

test('a hypothesis-level decision counts only that hypothesis\'s evidence; a venture decision counts every claim', () => {
  // Mutations checked: the hypothesis match removed.
  const rows = [1, 2, 3, 4, 5].map((n) => row(`pain-${n}-${n}`, 'interview', String(n), n <= 3 ? 1 : 2));
  const h1 = decisionEvidenceV2(rows, 1);
  assert.deepEqual([h1.counted, h1.state], [3, 'withheld']);
  assert.deepEqual(h1.excluded, [{ id: 'pain-4-4', reason: 'other_hypothesis' }, { id: 'pain-5-5', reason: 'other_hypothesis' }]);
  assert.deepEqual([decisionEvidenceV2(rows, 'venture').counted, decisionEvidenceV2(rows, 'venture').state], [5, 'given']);
});

test('an experiment counts only with an observed result; planned, running or done without a result is kept but not counted', () => {
  // Mutations checked: an experiment counted whatever its result.
  const rows = [
    row('evidence-1', 'experiment', '1', 1, 'supports', false), row('evidence-2', 'experiment', '2', 1, 'supports', true),
    row('evidence-3', 'experiment', '3', 1),
  ];
  const e = decisionEvidenceV2(rows, 1);
  assert.equal(e.counted, 1);
  assert.deepEqual(e.excluded.map((x) => x.reason), ['no_observed_result', 'no_observed_result']);
});

test('a source linked in both directions counts once and appears on both sides', () => {
  const rows = [row('pain-1-9', 'interview', '9', 1, 'supports'), row('pain-2-9', 'interview', '9', 1, 'contradicts')];
  const e = decisionEvidenceV2(rows, 1);
  assert.deepEqual([e.counted, e.counted_supporting, e.counted_contradicting], [1, 1, 1]);
  // Whichever direction is linked first.
  const r = decisionEvidenceV2([rows[1], rows[0]], 1);
  assert.deepEqual([r.counted, r.counted_supporting, r.counted_contradicting], [1, 1, 1]);
});

test('v2 is not wired: the shipped claim status and decision bar still use v1', () => {
  // This PR proposes; it changes no calculation. A follow-up wires v2 after review.
  for (const f of ['cloudflare-worker/src/services/cycleValidate.ts', 'cloudflare-worker/src/routes/founder_validate.ts', 'cloudflare-worker/src/services/verdict.ts']) {
    assert.doesNotMatch(readFileSync(join(ROOT, f), 'utf8'), /validateMethodology/, `${f} imports the proposed methodology`);
  }
});
