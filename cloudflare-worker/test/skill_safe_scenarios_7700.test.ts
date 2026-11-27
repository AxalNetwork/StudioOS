/** D7700 (#7700): SAFE qualification remains bound to complete selected-document passages, never typed instrument terms.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): D7700: selected-document SAFE case
 * shape, revised identity and complete maturity evidence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkCase, judge } from '../src/services/agents/skillLifecycle.ts';
const asset = (path: string) => JSON.parse(readFileSync(new URL('../src/services/agents/skills/' + path, import.meta.url), 'utf8'));
const pack = asset('scenarios/safe-convertible-instrument-review.json');
const golden = asset('cases/safe-convertible-instrument-review.json');

test('every rewritten SAFE case and golden input uses the selected reader shape and revised identity', () => {
  assert.ok(pack.pack_revision >= 2 && golden.version >= 2);
  for (const c of [...pack.scenarios, golden]) {
    if (c.revision !== undefined) assert.ok(c.revision >= 2);
    const records = c.input.records, r = records['data_room.index'], d = r?.document;
    assert.equal(records['raise.records']?.instruments, undefined, 'instrument terms must not return to a typed raise record');
    assert.equal(r.document_status, 'read');
    assert.equal(r.source, 'data_room_passages');
    assert.match(d.file_uid, /^[a-f0-9]{32}$/);
    assert.equal(d.ref, `data_room_file:${d.file_uid}`);
    assert.match(d.version_digest, /^sha256:[a-f0-9]{64}$/);
    assert.ok(Number.isInteger(d.version) && d.version > 0);
    assert.deepEqual(d.coverage, { returned: d.passages.length, total: d.passages.length, omitted: 0, complete: true, first: 0 });
    assert.deepEqual(d.page, { after: null, next: null });
    for (const p of d.passages) {
      assert.equal(p.ref, `data_room_passage:${d.file_uid}:${p.seq}`);
      assert.ok(p.text.length > 0);
    }
    assert.ok(c.expect.evidence.cite.some((ref: string) => d.passages.some((p: any) => p.ref === ref)));
  }
});

test('no maturity stated is explicit complete passage evidence, with a cited Not recorded answer', () => {
  const c = pack.scenarios.find((s: any) => s.case_id.endsWith('-complete'));
  const passage = c.input.records['data_room.index'].document.passages.find((p: any) => p.text.includes('No maturity date is stated'));
  assert.ok(passage, 'absence is expressed by complete text, not a typed null or truncated excerpt');
  assert.match(c.outputs.correct, /Maturity: Not recorded/);
  assert.ok(c.expect.evidence.cite.includes(passage.ref) && c.outputs.correct.includes(`[${passage.ref}]`));
});


test('the revised golden case qualifies against its selected-document missing-discount answer', () => {
  const c = checkCase({ name: 'SAFE golden', input: golden.input, expect: golden.expect });
  assert.ok(c.ok);
  if (!c.ok) return;
  const answer = pack.scenarios.find((s: any) => s.case_id.endsWith('-missing-discount')).outputs.correct;
  assert.equal(judge(c.expect, answer, c.input).result, 'pass');
  assert.equal(judge(c.expect, answer + '\nThis is guaranteed.', c.input).result, 'fail', 'retain the original golden anti-guarantee assertion');
});
