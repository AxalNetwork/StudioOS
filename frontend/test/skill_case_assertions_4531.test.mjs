// #4531 (slice 2): every golden-case assertion beyond the phrase lists survives
// the HQ case editor unchanged. The editor does not edit them; a save keeps
// them, in the Worker's order, so an unchanged case keeps its uid (and so its
// results), and a case with only an assertion is still a case.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ASSERTION_KEYS, caseToForm, formToCase } from '../src/pages/hq/aiAgents/skillLifecycleModel.js';

const EXPECT = {
  output: 'record_change', must_include: ['MRR'], must_say_not_recorded: [], must_not_include: [],
  numbers: [{ metric: 'MRR', value: 41200, unit: '', tolerance: 0 }],
  output_schema: { format: 'json', schema: { type: 'object', required: ['changes'] } },
  structure: { sections: ['Summary', 'Risks'], ordered: true },
  evidence: { cite: ['stripe.read'] },
  refusal: { mode: 'ask_for_input', subject: 'burn' },
  claims: { required: [{ subject: 'growth', object: 'steady' }], forbidden: [] },
};
const saved = { uid: 'd'.repeat(32), name: 'Structured', input: { records: { 'stripe.read': { mrr_usd: 41200 } } }, expect: EXPECT };

test('the editor keeps the same keys as the Worker, in its order', () => {
  const src = readFileSync(new URL('../../cloudflare-worker/src/services/agents/skillAssertions.ts', import.meta.url), 'utf8');
  const worker = /export const ASSERTION_KEYS = \[([^\]]*)\]/.exec(src)[1].match(/'([a-z_]+)'/g).map((k) => k.slice(1, -1));
  assert.deepEqual([...ASSERTION_KEYS], worker);
});

test('an unchanged case keeps its uid and every assertion, byte for byte', () => {
  const r = formToCase(caseToForm(saved));
  assert.equal(r.ok, true);
  assert.equal(r.value.uid, saved.uid);
  // Mutation checked: the editor keeping only `numbers` → the structure, evidence, refusal, claims and schema are dropped and this fails.
  assert.equal(JSON.stringify(r.value.expect), JSON.stringify(EXPECT));
});

test('an edited case keeps its assertions; a case with only one is still a case; none adds no key', () => {
  const edited = formToCase({ ...caseToForm(saved), must_include: 'MRR\nGrowth' });
  assert.equal(edited.ok, true);
  assert.equal(edited.value.uid, undefined, 'a changed case is a new case');
  assert.deepEqual(edited.value.expect.structure, EXPECT.structure);
  const only = formToCase(caseToForm({ ...saved, expect: { output: 'brief', must_include: [], must_say_not_recorded: [], must_not_include: [], claims: EXPECT.claims } }));
  assert.equal(only.ok, true, 'a claims-only case');
  const plain = formToCase(caseToForm({ ...saved, expect: { output: 'brief', must_include: ['MRR'], must_say_not_recorded: [], must_not_include: [] } }));
  assert.deepEqual(Object.keys(plain.value.expect), ['output', 'must_include', 'must_say_not_recorded', 'must_not_include']);
  const empty = formToCase(caseToForm({ ...saved, expect: { output: 'brief', must_include: [], must_say_not_recorded: [], must_not_include: [] } }));
  assert.equal(empty.ok, false);
});
