/**
 * D691 (S19-B, #1699 and #1700) — Raise's writes on real SQLite.
 *
 * #1699 ships test 3 here: the cap table's entry keys, through the tool's own
 * routes (`POST` and `PUT /api/captable/scenarios`), which now save through
 * `saveScenario()` (decision 4). #1700 extends this file with the cycle's
 * writes, `addHolder()` among them.
 *
 * The tables come from schema_baseline.sql through `_baseline.mjs`, with
 * migrations 129 (the one base cap table per venture), 410, 442 and 463
 * applied over them, and the routes run through `_d1_sqlite.mjs`. Migration
 * 459 (D690 S18-A's PR 1) is not on main yet; #1700 applies it here once it is.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/raise_writes_d691.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import captable from '../src/routes/captable.ts';
import { simulate } from '../src/services/captable.ts';
import { withEntryKeys, ENTRY_KEY_SEQ } from '../src/services/capTableWrites.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${file}`), 'utf8');

const ADMIN = 30;
const P = 1;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of [
    'users', 'projects', 'activity_logs', 'cap_table_scenarios', 'cap_table_holders', 'raise_prospects',
    'spinout_deck_overrides', 'pitch_decks', 'pitch_deck_share_tokens', 'deck_share_views', 'data_room_files',
    'dd_cases', 'dd_requests',
  ]) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(sqlOf('129_captable_one_canonical_per_project.sql'));
  db.exec(sqlOf('249_project_metrics.sql'));
  db.exec(sqlOf('410_safe_issuances.sql'));
  db.exec(sqlOf('442_raise_cycle_stores.sql'));
  db.exec(sqlOf('463_raise_record_stores.sql'));
  db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)').run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test');
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001)`);
  return db;
}

let wrap: ((db: any) => any) | null = null;
async function call(db: DatabaseSync, method: string, path: string, body?: unknown) {
  const tok = await new SignJWT({ user_id: ADMIN, role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const DB = wrap ? wrap(d1Over(db)) : d1Over(db);
  const res = await captable.request(path, {
    method,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const save = (db: DatabaseSync, inputs: unknown) => call(db, 'POST', '/scenarios', { name: 'Kestrel cap table', project_id: P, inputs });
const stored = (db: DatabaseSync) => JSON.parse((db.prepare(
  'SELECT inputs_json FROM cap_table_scenarios WHERE project_id = ? AND is_variant = 0',
).get(P) as any).inputs_json);
const keys = (inputs: any) => Object.fromEntries(['founders', 'safes', 'rounds'].map((l) => [
  l, (inputs[l] || []).map((e: any) => `${e.name}=${e.key}`),
]));

// Made-up holders: what the tool posts, never carrying a key, since it does not reload after a save.
const TABLE = {
  founders: [{ name: 'Mira Okafor', shares: 6_000_000 }, { name: 'Tomas Reyes', shares: 4_000_000 }],
  option_pool_pct: 10,
  safes: [{ name: 'Harbour Angels', amount: 250_000, cap: 8_000_000, discount: 0.2 }],
  rounds: [{ name: 'Seed', pre_money: 9_000_000, investment: 2_000_000, post_round_pool_pct: 12 }],
  exit_value: 60_000_000,
};
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------------------
// Test 3 — keys hold
// ---------------------------------------------------------------------------

test('3: a save gives every founder, SAFE and round entry a key, and saving the same inputs again keeps each one', async () => {
  const db = fixture();
  const first = await save(db, TABLE);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(keys(first.body.inputs), {
    founders: ['Mira Okafor=e-1', 'Tomas Reyes=e-2'], safes: ['Harbour Angels=e-3'], rounds: ['Seed=e-4'],
  });
  assert.equal(first.body.inputs[ENTRY_KEY_SEQ], 4);
  assert.deepEqual(stored(db), first.body.inputs, 'the keys are what inputs_json holds');

  for (let i = 0; i < 2; i++) {
    const again = await save(db, TABLE);
    assert.equal(again.status, 200);
    assert.equal(again.body.uid, first.body.uid, 'still one cap table for the venture');
    assert.deepEqual(keys(again.body.inputs), keys(first.body.inputs), `save ${i + 2} keeps every key`);
  }
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM cap_table_scenarios').get() as any).n, 1);
});

test('3: a key follows its entry by name, not by position, and an edit keeps it', async () => {
  const db = fixture();
  await save(db, TABLE);
  const moved = clone(TABLE);
  moved.founders.reverse();
  moved.founders[0].shares = 5_000_000;
  const r = await save(db, moved);
  assert.deepEqual(keys(r.body.inputs).founders, ['Tomas Reyes=e-2', 'Mira Okafor=e-1']);
});

test('3: a removed entry\'s key is never reused, not even by an entry of the same name added back', async () => {
  const db = fixture();
  await save(db, TABLE);
  const without = clone(TABLE);
  without.founders = [without.founders[0]];
  without.safes = [];
  without.rounds = [];
  const r1 = await save(db, without);
  assert.deepEqual(keys(r1.body.inputs), { founders: ['Mira Okafor=e-1'], safes: [], rounds: [] });
  assert.equal(r1.body.inputs[ENTRY_KEY_SEQ], 4, 'the highest key issued is kept although e-2, e-3 and e-4 are gone');

  const added = clone(without);
  added.founders.push({ name: 'Lin Park', shares: 1_000_000 });
  added.safes.push({ name: 'Harbour Angels', amount: 100_000, cap: 9_000_000, discount: 0 });
  added.rounds.push({ name: 'Seed', pre_money: 9_000_000, investment: 2_000_000, post_round_pool_pct: 12 });
  const r2 = await save(db, added);
  assert.deepEqual(keys(r2.body.inputs), { founders: ['Mira Okafor=e-1', 'Lin Park=e-5'], safes: ['Harbour Angels=e-6'], rounds: ['Seed=e-7'] });
  assert.equal(r2.body.inputs[ENTRY_KEY_SEQ], 7);
});

test('3: a key the tool sends back is kept through a rename; a malformed or repeated one is replaced', async () => {
  const db = fixture();
  const first = await save(db, TABLE);
  // The tool loaded the scenario, so its rows carry their keys (updateRow spreads the entry).
  const loaded = clone(first.body.inputs);
  loaded.founders[0].name = 'Mira Okafor-Lind';
  loaded.founders[1].key = 'Tomas Reyes';
  loaded.safes[0].key = 'e-1';
  const r = await call(db, 'PUT', `/scenarios/${first.body.uid}`, { name: 'Kestrel cap table', inputs: loaded, project_id: P });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(keys(r.body.inputs), {
    founders: ['Mira Okafor-Lind=e-1', 'Tomas Reyes=e-2'], safes: ['Harbour Angels=e-3'], rounds: ['Seed=e-4'],
  });
  for (const list of ['founders', 'safes', 'rounds']) {
    for (const e of r.body.inputs[list]) assert.match(e.key, /^[a-z0-9][a-z0-9_-]*$/);
  }
  // D632's row is still written by the PUT.
  assert.deepEqual((db.prepare('SELECT action FROM activity_logs').all() as any[]).map((x) => x.action), ['captable_scenario_updated']);
});

test('3: a sequence sent back lower than the stored one never lowers it, and two entries never share a key', () => {
  const storedInputs: any = withEntryKeys(clone(TABLE) as any, null);
  const posted: any = clone(TABLE);
  posted[ENTRY_KEY_SEQ] = 1;
  posted.founders.push({ name: 'Mira Okafor', shares: 10 });
  const out: any = withEntryKeys(posted, storedInputs);
  assert.deepEqual(keys(out).founders, ['Mira Okafor=e-1', 'Tomas Reyes=e-2', 'Mira Okafor=e-5']);
  assert.equal(out[ENTRY_KEY_SEQ], 5);
  const all = ['founders', 'safes', 'rounds'].flatMap((l) => out[l].map((e: any) => e.key));
  assert.equal(new Set(all).size, all.length);
  assert.equal(posted.founders[0].key, undefined, 'the posted inputs are not changed');

  // A stored sequence above every stored key (the higher ones were removed) still wins over a stale one.
  const thinned: any = { founders: [{ name: 'Mira Okafor', shares: 1, key: 'e-1' }], [ENTRY_KEY_SEQ]: 6 };
  const stale: any = { founders: [{ name: 'Mira Okafor', shares: 1 }, { name: 'Lin Park', shares: 1 }], [ENTRY_KEY_SEQ]: 1 };
  const next: any = withEntryKeys(stale, thinned);
  assert.deepEqual(keys(next).founders, ['Mira Okafor=e-1', 'Lin Park=e-7']);
  assert.equal(next[ENTRY_KEY_SEQ], 7);
});

test('3: a key stays in its list: a round named like a removed SAFE gets a new key', () => {
  const before: any = {
    founders: [{ name: 'Mira Okafor', shares: 1, key: 'e-1' }],
    safes: [{ name: 'Harbour Angels', amount: 1, cap: 1, key: 'e-2' }],
    [ENTRY_KEY_SEQ]: 2,
  };
  const after: any = withEntryKeys({
    founders: [{ name: 'Mira Okafor', shares: 1 }],
    safes: [],
    rounds: [{ name: 'Harbour Angels', pre_money: 1, investment: 1 }],
  } as any, before);
  assert.deepEqual(keys(after), { founders: ['Mira Okafor=e-1'], safes: [], rounds: ['Harbour Angels=e-3'] });
});

test('3: a lost race to insert the base cap table keys against the winner\'s entries', async () => {
  const db = fixture();
  const winner = await save(db, TABLE);
  // The losing save read the venture before the winner's row was visible, so it takes the insert path.
  let missed = false;
  wrap = (DB) => ({
    ...DB,
    prepare(sql: string) {
      const st = DB.prepare(sql);
      if (!missed && /WHERE project_id = \? AND COALESCE\(is_variant,0\) = 0/.test(sql)) {
        missed = true;
        return { bind: () => ({ first: async () => null }) };
      }
      return st;
    },
  });
  try {
    // In another order, so a keying that ignored the winner's entries would give other keys.
    const reordered = clone(TABLE);
    reordered.founders.reverse();
    const r = await save(db, reordered);
    assert.ok(missed, 'the first lookup missed');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.uid, winner.body.uid, 'the winner\'s row was updated');
    assert.deepEqual(keys(r.body.inputs).founders, ['Tomas Reyes=e-2', 'Mira Okafor=e-1']);
    assert.deepEqual(keys(r.body.inputs).safes, keys(winner.body.inputs).safes);
  } finally { wrap = null; }
});

test('3: the keys change no result: simulate gives the same with and without them, and the stored result is that', async () => {
  const db = fixture();
  const r = await save(db, TABLE);
  const keyed = withEntryKeys(clone(TABLE) as any, null);
  assert.ok((keyed as any).founders.every((e: any) => e.key));
  assert.deepEqual(simulate(keyed), simulate(clone(TABLE) as any));
  assert.deepEqual(r.body.result, simulate(clone(TABLE) as any));
  const row = db.prepare('SELECT result_json FROM cap_table_scenarios WHERE uid = ?').get(r.body.uid) as any;
  assert.deepEqual(JSON.parse(row.result_json), simulate(clone(TABLE) as any));
});
