/** D7700 (#7700): selected-document passage citations, without accepting arbitrary strings or another file's text. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCase, judge } from '../src/services/agents/skillLifecycle.ts';
import { checkEvidence, citations, resolves, JUDGE_VERSION } from '../src/services/agents/skillAssertions.ts';

const UID = 'a'.repeat(28) + '7700', OTHER = 'b'.repeat(28) + '7700';
const REF = `data_room_passage:${UID}:1`;
const records = () => ({
  'data_room.index': { document_status: 'read', source: 'data_room_passages', document: {
    ref: `data_room_file:${UID}`, file_uid: UID, name: 'Synthetic SAFE.pdf', content_type: 'application/pdf', version: 2,
    updated_at: '2026-04-03T12:00:00Z', text_indexed_at: '2026-04-03T12:01:00Z', version_digest: 'sha256:' + 'c'.repeat(64),
    passages: [{ ref: REF, seq: 1, text: 'Post-money SAFE, v2. Valuation cap: 10,000,000 USD. No maturity date is stated in this instrument.' }],
    coverage: { returned: 1, total: 1, omitted: 0, complete: true, first: 0 }, page: { after: null, next: null },
  } },
  'cap_table.read': { fully_diluted_shares: 10_000_000 },
});

test('a selected passage is a valid case citation and its correct SAFE output qualifies without a typed maturity null', () => {
  const input = { records: records() };
  const c = checkCase({ name: 'Synthetic SAFE passage', input, expect: {
    output: 'brief', must_include: ['v2'], must_say_not_recorded: ['maturity'], must_not_include: [],
    numbers: [{ metric: 'Valuation cap', value: 10_000_000, unit: 'USD', tolerance: 0 }], evidence: { cite: [REF] },
  } });
  assert.ok(c.ok, c.ok ? '' : c.message);
  if (!c.ok) return;
  const output = `Instrument v2 [${REF}]\nValuation cap: 10,000,000 USD [${REF}]\nMaturity: Not recorded in the complete selected instrument [${REF}].`;
  assert.equal(judge(c.expect, output, c.input).result, 'pass');
  assert.match(judge(c.expect, output.replaceAll(`[${REF}]`, ''), c.input).detail ?? '', /did not cite/);
  assert.match(judge(c.expect, output + `\nInstrument [data_room_passage:${OTHER}:1]`, c.input).detail ?? '', /records do not hold/);
  assert.equal(JUDGE_VERSION, 5, 'changed citation semantics invalidate earlier evaluator evidence');
});

test('passage syntax works alongside dotted records, with exact selected-file identity and sequence', () => {
  const r = records();
  assert.equal(resolves(REF, r), true);
  assert.equal(resolves('cap_table.read', r), true);
  assert.deepEqual(citations(`[${REF}] [cap_table.read]`), [REF, 'cap_table.read']);
  assert.equal(checkEvidence({ cite: [REF, 'cap_table.read'] }, r).ok, true);
});

test('the citation cap applies to distinct passages that all exist', () => {
  const many = records();
  many['data_room.index'].document.passages = Array.from({ length: 21 }, (_, i) => ({
    ref: `data_room_passage:${UID}:${i + 1}`, seq: i + 1, text: 'Synthetic instrument clause.',
  }));
  many['data_room.index'].document.coverage = { returned: 21, total: 21, omitted: 0, complete: true, first: 0 };
  assert.equal(checkEvidence({ cite: many['data_room.index'].document.passages.map(p => p.ref) }, many).ok, false);
});

const changes: Array<[string, (b: any) => void]> = [
  ['unrecorded document text', b => { b.document_status = 'not_read'; }],
  ['another file UID', b => { b.document.file_uid = OTHER; }],
  ['another file reference', b => { b.document.ref = `data_room_file:${OTHER}`; }],
  ['a different passage sequence', b => { b.document.passages[0].seq = 2; }],
  ['a different passage reference', b => { b.document.passages[0].ref = `data_room_passage:${OTHER}:1`; }],
  ['an empty passage', b => { b.document.passages[0].text = ''; }],
  ['a reference merely mentioned in an unrelated field', b => { b.document.passages = null; b.untrusted_note = REF; }],
];
for (const [name, edit] of changes) test(`passage evidence refuses ${name}`, () => {
  const r = records(); edit(r['data_room.index']);
  assert.equal(resolves(REF, r), false);
});
test('a case without the selected reader document holds no passage evidence', () => {
  assert.equal(resolves(REF, {}), false);
});
test('duplicate case-insensitive passage references are refused', () => {
  assert.equal(checkEvidence({ cite: [REF, REF.toUpperCase()] }, records()).ok, false);
});
test('a sequence not held by the selected document is refused', () => {
  assert.equal(checkEvidence({ cite: [`data_room_passage:${UID}:9999`] }, records()).ok, false);
});
test('a malformed passage reference is refused', () => {
  assert.equal(checkEvidence({ cite: ['data_room_passage:invalid:1'] }, records()).ok, false);
});
