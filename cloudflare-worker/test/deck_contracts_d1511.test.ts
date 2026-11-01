/**
 * D1511 (#3762, deck v2 A18) — the contract schemas, and `test:drift` from
 * "the route exists" to "the reply matches its schema".
 *
 *   1. The validator checks what its schemas ask, and refuses a keyword it
 *      cannot check.
 *   2. `GET /api/decks/:id/grid`'s reply, for an old deck and a v2 deck at
 *      4:3, matches `deckGrid.schema.json`; a field the contract does not
 *      name, or one it needs and the reply lacks, fails.
 *   3. Every `deckV2Adapter.js` method swapped to `through(…)` has a contract,
 *      and every contract names a swapped method, so an adapter swap changes
 *      no screen.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_contracts_d1511.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckGrid from '../src/routes/deck_grid.ts';
import deckTypedValues, { TYPED_UNITS } from '../src/routes/deck_typed_values.ts';
import { CONTRACTS as NAMED } from '../src/contracts/index.ts';
import { contractErrors } from '../src/contracts/validate.ts';
import { CONSISTENCY_RULES, deckConsistency } from '../src/services/deckConsistency.ts';
import { LAYOUTS } from '../src/services/decks/slideModel.ts';
import { STRUCTURES } from '../src/services/decks/structures.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

/** Each contract with its schema read from its JSON file. */
const CONTRACTS = Object.fromEntries(Object.entries(NAMED).map(([k, c]) => [k, { ...c,
  schema: JSON.parse(readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/contracts', c.schema), 'utf8')) }])) as Record<keyof typeof NAMED, { issue: number; route: string; schema: any }>;

// ── 1. The validator ─────────────────────────────────────────────────────

test('1. the validator checks types, required fields, closed objects, items, enums, consts, bounds and local refs', () => {
  const s = {
    type: 'object', additionalProperties: false, required: ['a', 'b'],
    properties: { a: { type: 'integer', minimum: 1, maximum: 3 }, b: { type: 'array', minItems: 1, maxItems: 2, items: { $ref: '#/$defs/x' } }, c: { enum: ['p', 'q'] }, d: { const: 8 } },
    $defs: { x: { type: 'string' } },
  };
  assert.deepEqual(contractErrors(s, { a: 2, b: ['k'], c: 'p', d: 8 }), []);
  assert.deepEqual(contractErrors(s, { a: 2.5, b: [], c: 'r', d: 9, e: 1 }), [
    '$.a: must be integer, is number', '$.b: needs at least 1 items', '$.c: must be one of ["p","q"]', '$.d: must be 8', '$: e is not in the contract',
  ]);
  assert.deepEqual(contractErrors(s, { b: [1] }), ['$: missing a', '$.b[0]: must be string, is integer']);
  assert.deepEqual(contractErrors(s, { a: 4, b: ['k', 'l', 'm'] }), ['$.a: must be at most 3', '$.b: holds at most 2 items']);
  assert.deepEqual(contractErrors(s, { a: 0, b: ['k'] }), ['$.a: must be at least 1']);
  assert.deepEqual(contractErrors({ type: 'number' }, 3), [], 'an integer is a number');
  assert.deepEqual(contractErrors({ type: ['integer', 'null'] }, null), [], 'a list of types is any one of them');
  assert.deepEqual(contractErrors({ type: ['integer', 'null'] }, 'x'), ['$: must be integer or null, is string']);
  assert.deepEqual(contractErrors({ pattern: '^a' }, 'a'), ['$: the schema uses pattern, which the validator does not check']);
  assert.deepEqual(contractErrors({ $ref: '#/$defs/none' }, 1), ['$: unknown $ref #/$defs/none']);
});

test('1. every contract schema uses only what the validator checks', () => {
  for (const [method, c] of Object.entries(CONTRACTS)) {
    // Each schema node, reached through properties, items and $defs, uses only checked keywords.
    const walk = (node: any): void => {
      const errs = contractErrors(node, undefined as any);
      assert.equal(errs.some((e) => /does not check/.test(e)), false, `${method}: ${errs.join(' ')}`);
      for (const child of [...Object.values(node.properties ?? {}), ...Object.values(node.$defs ?? {}), ...(node.items ? [node.items] : [])]) walk(child);
    };
    walk(c.schema);
  }
});

// ── 2. The route's reply ─────────────────────────────────────────────────

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((n) => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations).filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (10, ?, ?, ?, 1, 1001)').run('founder', 'Synthetic Founder', 'founder@example.test');
  db.exec("INSERT INTO projects (id, name, founder_id) VALUES (1, 'Synthetic venture', 1001)");
  const old = [{ layout: 'chart_text', blocks: LAYOUTS.find((l) => l.id === 'chart_text')!.blocks }];
  const v2 = [{ structure: 'hero_3', areas: STRUCTURES.find((s) => s.id === 'hero_3')!.areas, blocks: [] }];
  const add = db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current, theme_json) VALUES (?, 1, ?, ?, ?, ?, ?)');
  add.run(1, 1, 'Pre-v2 deck', JSON.stringify(old), 1, null);
  add.run(2, 2, 'v2 deck', JSON.stringify(v2), 0, JSON.stringify({ kind: 'brand', aspect: '4:3' }));
  return db;
}
async function get(db: DatabaseSync, path: string) {
  const app = new Hono<any>().route('/api/decks', deckGrid).route('/api/decks', deckTypedValues);
  const token = await new SignJWT({ user_id: 10, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withThrownResponses(() => app.request(path, { headers: { Authorization: `Bearer ${token}` } }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
  return { status: res.status, body: await res.json() as any };
}

test('2. every object in a contract is closed and names every field it holds as required or as one of its own', () => {
  // A field added to a reply must be added to its contract on purpose: the top level holds only what it requires.
  const s = CONTRACTS.grid.schema;
  assert.deepEqual(Object.keys(s.properties).sort(), [...s.required].sort());
  assert.equal(s.additionalProperties, false);
});

test('2. the grid route\'s reply matches its contract, for a deck saved before v2 and a v2 deck at 4:3', async () => {
  const db = world();
  for (const id of [1, 2]) {
    const r = await get(db, `/api/decks/${id}/grid`);
    assert.equal(r.status, 200);
    assert.deepEqual(contractErrors(CONTRACTS.grid.schema, r.body), [], `deck ${id}`);
  }
  const r = await get(db, '/api/decks/1/grid');
  assert.deepEqual(contractErrors(CONTRACTS.grid.schema, { ...r.body, cards: [{ ...r.body.cards[0], hidden: true }] }), ['$.cards[0]: hidden is not in the contract']);
  const { baseline: _b, ...noBaseline } = r.body;
  assert.deepEqual(contractErrors(CONTRACTS.grid.schema, noBaseline), ['$: missing baseline']);
  assert.deepEqual(contractErrors(CONTRACTS.grid.schema, { ...r.body, aspect: '1:1' }), ['$.aspect: must be one of ["16:9","4:3"]']);
});

test('2. the deck check\'s consistency matches its contract, with a finding and with none, and the contract names every rule', () => {
  const card = (title: string, text: string) => ({ title, blocks: [{ id: 'b1', kind: 'text', style: 'paragraph', grid: { c1: 1, c2: 12, r1: 1, r2: 6 }, text }] });
  const found = deckConsistency([card('Traction', 'We have $1.2M ARR.'), card('Team', 'Synthetic team.'), card('Ask', 'Our ARR is $1.5M today.')]);
  assert.ok(found.findings.length >= 1);
  assert.deepEqual(contractErrors(CONTRACTS.consistency.schema, found), []);
  assert.deepEqual(contractErrors(CONTRACTS.consistency.schema, deckConsistency([])), []);
  assert.deepEqual(contractErrors(CONTRACTS.consistency.schema, deckConsistency(null)), []);
  assert.deepEqual(CONTRACTS.consistency.schema.properties.findings.items.properties.rule.enum, [...CONSISTENCY_RULES]);
});

test('2. the typed values\' reply matches its contract, empty and with a figure and a word', async () => {
  const db = world();
  const empty = await get(db, '/api/decks/1/typed-values');
  assert.equal(empty.status, 200, JSON.stringify(empty.body));
  assert.deepEqual(contractErrors(CONTRACTS.typedTables.schema, empty.body), []);
  db.prepare("INSERT INTO deck_typed_values (deck_id, project_id, key, label, value_num, value_text, unit, typed_by, typed_at) VALUES (1, 1, 'tam', 'TAM', 4200000000, NULL, 'usd', 10, '2026-11-01 10:00:00'), (1, 1, 'icp', 'Who buys', NULL, 'Finance leads', 'text', NULL, '2026-11-01 10:00:00')").run();
  const two = await get(db, '/api/decks/1/typed-values');
  assert.equal(two.body.values.length, 2);
  assert.deepEqual(contractErrors(CONTRACTS.typedTables.schema, two.body), []);
  assert.deepEqual(CONTRACTS.typedTables.schema.properties.values.items.properties.unit.enum, [...TYPED_UNITS]);
});

// ── 3. The adapter's swapped methods ─────────────────────────────────────

test('3. every adapter method swapped to through() has a contract, and every contract is a swapped method', () => {
  const src = readFileSync(resolve(process.cwd(), 'frontend/src/pages/raise/pitch/deckV2Adapter.js'), 'utf8');
  const swapped = [...src.matchAll(/^export const (\w+) = [^\n]*\bthrough\(/gm)].map((m) => m[1]).sort();
  assert.ok(swapped.length >= 1, 'grid is swapped on main');
  assert.deepEqual(swapped, Object.keys(CONTRACTS).sort());
  for (const [method, c] of Object.entries(CONTRACTS)) {
    assert.match(src, new RegExp(`${method}: \\{ issue: ${c.issue},`), `${method} keeps its issue`);
  }
});
