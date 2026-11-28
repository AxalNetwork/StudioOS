/**
 * D8519 (#8519) — the model inventory: both failures it exists for, the
 * allowlist's two rules, the extraction rules, and the repository as it is.
 * Fixtures use invented ids; nothing here reads the network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInventory, catalogueRows, inventoryProblems, localPriceIds, providerRows, readSources, wranglerModels } from './modelInventory.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CAT = 'cloudflare-worker/src/services/ai/catalogue.ts';
const row = (id, status, prices) => `  { id: '${id}', name: 'x', kind: 'Text Generation', capabilities: [], context_window: null, status: '${status}', paid_only: false, partner: false, prices: ${prices}, docs_url: null },`;
const catalogue = (...rows) => ({ rel: CAT, text: `export const CATALOGUE = Object.freeze([\n${rows.join('\n')}\n]);\n` });
const user = (id, rel = 'cloudflare-worker/src/services/use.ts') => ({ rel, text: `export const M = '${id}';\n` });
const inv = (files, wrangler = '') => buildInventory({ files, wrangler });
const byId = (i, id) => i.models.find((m) => m.id === id);

test('a callable id with no price entry fails, naming the id and its surface', () => {
  const i = inv([catalogue(row('@cf/acme/free-1', 'ga', '{}')), user('@cf/acme/free-1')]);
  const p = inventoryProblems(i, []);
  assert.equal(p.length, 1);
  assert.match(p[0], /^unpriced: @cf\/acme\/free-1 .*services\/use\.ts/);
});

test('an id the catalogue does not know at all is unpriced', () => {
  const p = inventoryProblems(inv([catalogue(), user('@cf/acme/unknown-1')]), []);
  assert.match(p[0], /^unpriced: @cf\/acme\/unknown-1/);
});

test('a price entry no code calls fails as stale', () => {
  const p = inventoryProblems(inv([catalogue(row('@cf/acme/old-1', 'ga', "{ tokens_in: '0.1' }"))]), []);
  assert.equal(p.length, 1);
  assert.match(p[0], /^stale: @cf\/acme\/old-1/);
});

test('a deprecated priced row is history, not stale; a current one is', () => {
  assert.deepEqual(inventoryProblems(inv([catalogue(row('@cf/acme/gone-1', 'deprecated', "{ tokens_in: '0.1' }"))]), []), []);
  assert.match(inventoryProblems(inv([catalogue(row('@cf/acme/gone-1', 'beta', "{ tokens_in: '0.1' }"))]), []).join('\n'), /^stale:/);
});

test('a priced, called id passes', () => {
  const i = inv([catalogue(row('@cf/acme/ok-1', 'ga', "{ tokens_in: '0.1' }")), user('@cf/acme/ok-1')]);
  assert.deepEqual(inventoryProblems(i, []), []);
  assert.deepEqual(byId(i, '@cf/acme/ok-1').surfaces, ['cloudflare-worker/src/services/use.ts']);
});

test('the allowlist clears a gap only with its rule and a reason, and a dead entry fails', () => {
  const files = [catalogue(row('@cf/acme/free-1', 'ga', '{}')), user('@cf/acme/free-1')];
  const reason = 'Billed by the account, never priced per call here.';
  assert.deepEqual(inventoryProblems(inv(files), [{ id: '@cf/acme/free-1', rule: 'unpriced', reason }]), []);
  assert.match(inventoryProblems(inv(files), [{ id: '@cf/acme/free-1', rule: 'stale', reason }]).join('\n'), /unpriced: @cf\/acme\/free-1/);
  assert.match(inventoryProblems(inv(files), [{ id: '@cf/acme/free-1', rule: 'unpriced', reason: '' }]).join('\n'), /has no reason/);
  const ok = [catalogue(row('@cf/acme/ok-1', 'ga', "{ tokens_in: '0.1' }")), user('@cf/acme/ok-1')];
  assert.match(inventoryProblems(inv(ok), [{ id: '@cf/acme/ok-1', rule: 'unpriced', reason }]).join('\n'), /no longer has that gap/);
});

test('comments, the catalogue and the notOffered block are not calls', () => {
  const files = [
    catalogue(row('@cf/acme/a-1', 'ga', "{ tokens_in: '0.1' }"), row('@cf/acme/b-1', 'ga', "{ tokens_in: '0.1' }")),
    { rel: 'cloudflare-worker/src/services/x.ts', text: "// '@cf/acme/a-1' only in a comment\nexport const n = 1;\n" },
    { rel: 'cloudflare-worker/src/services/ai/modelUseCases.ts', text: "export const COVERAGE = Object.freeze({\n  notOffered: Object.freeze({\n    \"@cf/acme/b-1\": \"beta\",\n  }) as Readonly<Record<string, string>>,\n});\nexport const D = '@cf/acme/c-1';\n" },
  ];
  const i = inv(files);
  assert.deepEqual(byId(i, '@cf/acme/a-1').surfaces, []);
  assert.deepEqual(byId(i, '@cf/acme/b-1').surfaces, []);
  assert.equal(byId(i, '@cf/acme/c-1').surfaces.length, 1, 'text after the block still counts');
});

test('wrangler MODEL vars count as callers, OPENAI_MODEL as openai/<id>', () => {
  assert.deepEqual(wranglerModels('OPENAI_MODEL = "gpt-9-x"\nAGENT_CLAUDE_MODEL = "anthropic/claude-x-1"\nOTHER = "a"\n'), [
    { key: 'OPENAI_MODEL', id: 'openai/gpt-9-x' }, { key: 'AGENT_CLAUDE_MODEL', id: 'anthropic/claude-x-1' },
  ]);
  const p = inventoryProblems(inv([catalogue()], 'OPENAI_MODEL = "gpt-9-x"\n'), []);
  assert.match(p[0], /^unpriced: openai\/gpt-9-x .*wrangler\.toml OPENAI_MODEL/);
});

test('provider tables price by row, and are called through their accessor', () => {
  const text = `export const PROVIDER_MODELS = Object.freeze([\n  {\n    id: 'anthropic/claude-x-1',\n    rates: Object.freeze({ tokens_in: '2', tokens_out: '10' }),\n  },\n  {\n    id: 'anthropic/claude-y-1',\n    provider: 'anthropic',\n  },\n]);\n`;
  assert.deepEqual(providerRows(text, { name: 'PROVIDER_MODELS', rate: /rates:\s*Object\.freeze\(\{[^}]*tokens_in:\s*'\d/ }), [
    { id: 'anthropic/claude-x-1', priced: true }, { id: 'anthropic/claude-y-1', priced: false },
  ]);
  const files = [{ rel: CAT, text }, { rel: 'cloudflare-worker/src/services/p.ts', text: 'const m = providerModelById(x);\n' }];
  const i = inv(files);
  assert.equal(byId(i, 'anthropic/claude-x-1').priced, true);
  assert.equal(byId(i, 'anthropic/claude-x-1').surfaces.length, 1);
  assert.match(inventoryProblems(i, []).join('\n'), /unpriced: anthropic\/claude-y-1/);
});

test('a route price table resolves [CONST] keys', () => {
  const t = "const A = 'claude-a-1';\nconst PRICING: Record<string, P> = {\n  [A]: { input: 1 },\n  'claude-b-2': { input: 2 },\n};\n";
  assert.deepEqual(localPriceIds(t, 'PRICING'), ['claude-a-1', 'claude-b-2']);
  assert.deepEqual(catalogueRows(row('@cf/acme/r-1', 'beta', '{}')), [{ id: '@cf/acme/r-1', status: 'beta', priced: false }]);
});

test('price-table and constant names are exact identifiers, including dollar signs', () => {
  for (const [table, key] of [['PRICING', 'A'], ['$PRICING', '$A'], ['PRICING$', 'A$'], ['PRICE$S', 'A$B']]) {
    const text = [
      `const ${key}suffix = 'claude-decoy-1';`,
      `const ${key} = 'claude-selected-1';`,
      `const ${table}suffix = {`,
      "  'claude-other-1': { input: 1 },",
      '};',
      `const ${table}: Record<string, P> = {`,
      `  [${key}]: { input: 1 },`,
      "  'claude-literal-1': { input: 2 },",
      '  "claude-literal-2": { input: 3 },',
      '  [MISSING]: { input: 4 },',
      '};',
    ].join('\n');
    assert.deepEqual(localPriceIds(text, table), ['claude-selected-1', 'claude-literal-1', 'claude-literal-2']);
    assert.deepEqual(localPriceIds(text, `${table}missing`), []);
  }
});

test('provider accessor discovery preserves whole-word boundaries for every table', () => {
  const rel = 'cloudflare-worker/src/services/access.ts';
  for (const [name, accessor, id] of [
    ['PROVIDER_MODELS', 'providerModelById', 'anthropic/claude-test-1'],
    ['GATEWAY_IMAGE_MODELS', 'gatewayImageModelFor', 'bria/image-test-1'],
    ['GATEWAY_TEXT_MODELS', 'gatewayTextModelById', 'openai/gpt-test-1'],
  ]) {
    const cat = { rel: CAT, text: `export const ${name} = Object.freeze([\n  {\n    id: '${id}',\n  },\n]);\n` };
    for (const text of [accessor, name, `$${accessor}$`, `${accessor}.call`]) {
      assert.deepEqual(byId(inv([cat, { rel, text }]), id).surfaces, [rel]);
    }
    for (const text of [`pre${accessor}`, `${accessor}_suffix`, `${accessor}2`, `_${name}`, '']) {
      assert.deepEqual(byId(inv([cat, { rel, text }]), id).surfaces, []);
    }
  }
});

test('the repository: no gap beyond the reviewed allowlist, and the render is order-independent', () => {
  const sources = readSources(ROOT);
  const i = buildInventory(sources);
  assert.deepEqual(inventoryProblems(i), []);
  assert.ok(i.models.length > 50 && i.models.every((m) => m.provider && Array.isArray(m.surfaces)));
  assert.deepEqual(buildInventory(readSources(ROOT, { reversed: true })), i);
});
