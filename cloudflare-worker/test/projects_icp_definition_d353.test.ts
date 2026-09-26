/**
 * The ICP definition store — D353, migration 308.
 *
 * `normalizeIcpDefinitionMeta` is the only gate between a request and
 * `projects.icp_definition_meta`. What these tests pin:
 *   * version, confirmed_at and updated_at come from the STORED row and the
 *     server clock — a request that sends its own is ignored;
 *   * confirming needs every required answer, a draft does not;
 *   * a choice outside the canvas's options is refused, unknown keys dropped;
 *   * each refusal is a code plus our sentence (D258), and the route sends it
 *     through `refuse()`;
 *   * the column is DECLARED by migration 308 (D235), and the runtime
 *     bootstrap caches readiness per binding.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeIcpDefinitionMeta, icpMissingFields, ICP_FIELDS } from '../src/routes/projects';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ROUTE = read('cloudflare-worker/src/routes/projects.ts');
const MIGRATION = read('cloudflare-worker/sql/migrations/308_icp_definition_meta.sql');

const NOW = '2026-09-26T20:00:00.000Z';
const COMPLETE: Record<string, string> = {
  type: 'B2B', industry: 'Clinical operations', size: '50–500 employees', persona: 'Head of Ops', geo: 'EU',
  pain1: 'Handover data is lost', alternative: 'Spreadsheets', whyFail: 'Nobody owns them',
  outcome: 'One trusted record', trigger: 'Second site opens', metric: 'Hours lost per week',
  urgency: 'Active — looking now', budget: 'High — budget exists, needs a case', objection: 'We have an EHR',
  valueProp: 'One record for every handover', differentiator: 'Reads the EHR you already run', tone: 'Technical',
};
const parse = (r: { value?: string | null }) => JSON.parse(String(r.value));

test('a draft may be partial and is stored without a version', () => {
  const r = normalizeIcpDefinitionMeta({ status: 'draft', step: 2, fields: { type: 'B2B' } }, null, NOW);
  assert.equal(r.error, undefined);
  const v = parse(r);
  assert.deepEqual(v, { status: 'draft', step: 2, fields: { type: 'B2B' }, version: 0, confirmed_at: null, updated_at: NOW });
});

test('confirming with a required answer missing is refused with our sentence', () => {
  const fields = { ...COMPLETE };
  delete fields.objection;
  const r = normalizeIcpDefinitionMeta({ status: 'confirmed', step: 5, fields }, null, NOW);
  assert.equal(r.error, 'icp_definition_incomplete');
  assert.match(String(r.message), /cannot be confirmed yet: 1 required answer is still empty/);
  assert.deepEqual(icpMissingFields(fields), ['objection']);
});

test('the optional pains are not required to confirm', () => {
  assert.ok(ICP_FIELDS.pain2.optional && ICP_FIELDS.pain3.optional);
  const r = normalizeIcpDefinitionMeta({ status: 'confirmed', step: 5, fields: COMPLETE }, null, NOW);
  assert.equal(r.error, undefined);
});

test('version, confirmed_at and updated_at are the server’s, never the request’s', () => {
  const prev = JSON.stringify({ status: 'confirmed', version: 2, confirmed_at: '2026-09-01T00:00:00Z', fields: COMPLETE });
  const r = normalizeIcpDefinitionMeta(
    { status: 'confirmed', step: 5, fields: COMPLETE, version: 99, confirmed_at: '1999-01-01', updated_at: '1999-01-01' },
    prev, NOW,
  );
  const v = parse(r);
  assert.equal(v.version, 3, 'a confirmation moves the stored version by one');
  assert.equal(v.confirmed_at, NOW);
  assert.equal(v.updated_at, NOW);
});

test('editing back to a draft keeps the version and the last confirmation', () => {
  const prev = JSON.stringify({ status: 'confirmed', version: 2, confirmed_at: '2026-09-01T00:00:00Z' });
  const v = parse(normalizeIcpDefinitionMeta({ status: 'draft', step: 1, fields: {} }, prev, NOW));
  assert.equal(v.version, 2);
  assert.equal(v.confirmed_at, '2026-09-01T00:00:00Z');
});

test('a choice outside the canvas’s options is refused; unknown keys are dropped', () => {
  const bad = normalizeIcpDefinitionMeta({ status: 'draft', step: 1, fields: { tone: 'Aggressive' } }, null, NOW);
  assert.equal(bad.error, 'icp_definition_invalid_choice');
  const v = parse(normalizeIcpDefinitionMeta({ status: 'draft', step: 1, fields: { persona: 'CFO', secret_score: '99' } }, null, NOW));
  assert.deepEqual(v.fields, { persona: 'CFO' });
});

test('text is trimmed and capped; a bad status is refused; null clears', () => {
  const v = parse(normalizeIcpDefinitionMeta({ status: 'draft', step: 9, fields: { persona: `  ${'x'.repeat(500)}  ` } }, null, NOW));
  assert.equal(v.fields.persona.length, 200);
  assert.equal(v.step, 1, 'an out-of-range step is the first step, not stored as 9');
  assert.equal(normalizeIcpDefinitionMeta({ status: 'final' }, null, NOW).error, 'icp_definition_invalid');
  assert.deepEqual(normalizeIcpDefinitionMeta(null, 'anything', NOW), { value: null });
});

test('the route normalises against the stored row and refuses through refuse()', () => {
  assert.match(ROUTE, /normalizeIcpDefinitionMeta\(data\.icp_definition_meta, \(project as any\)\.icp_definition_meta, new Date\(\)\.toISOString\(\)\)/);
  assert.match(ROUTE, /return refuse\(c, 400, \{ code: meta\.error, message: meta\.message/);
  assert.match(ROUTE, /'cofounder_decision_meta', 'icp_definition_meta', 'data_room_url'/, 'the column is not in the writable field list');
});

test('the column is declared by migration 308 and bootstrapped per binding', () => {
  assert.match(MIGRATION, /^ALTER TABLE projects ADD COLUMN icp_definition_meta TEXT;$/m);
  assert.doesNotMatch(MIGRATION, /\bBEGIN\b|\bCOMMIT\b/);
  assert.match(ROUTE, /const _icpDefinitionReady = new WeakMap<object, true>\(\);/);
  assert.match(ROUTE, /const key = bindingKey\(env\);\s+if \(_icpDefinitionReady\.has\(key\)\) return;/);
});
