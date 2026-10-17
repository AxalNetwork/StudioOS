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
 * #1700's first PR adds tests 10 (holders), 6 (links), 7 (data room) and the
 * founder read of 17. The cycle routes that call them, and their logging
 * (decision 12), come with the closing PR, after D690 S18-A's `logCycleWrite`.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/raise_writes_d691.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import captable from '../src/routes/captable.ts';
import { simulate } from '../src/services/captable.ts';
import { withEntryKeys, ENTRY_KEY_SEQ, addHolder, updateHolder, HolderError } from '../src/services/capTableWrites.ts';
import decks, { createShareLink, revokeShareLink, SHARE_NEVER_EXPIRES, SHARE_SENT_TO_SOMEONE_ELSE, SHARE_VIEWER_COOKIE } from '../src/routes/decks.ts';
import deckShareActions from '../src/routes/deck_share_actions.ts';
import dataRoom from '../src/routes/data_room.ts';
import research from '../src/routes/research.ts';
import { admittedCounts } from '../src/services/dataRoomAccess.ts';
import { tierUpsell } from '../src/middleware/requireTier.ts';
import { tableFromBaseline, stripForeignKeys, addColumnsFrom } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${file}`), 'utf8');

const ADMIN = 30;
const P = 1;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of [
    'users', 'projects', 'activity_logs', 'cap_table_scenarios', 'cap_table_holders', 'cap_table_vesting', 'raise_prospects',
    'spinout_deck_overrides', 'pitch_decks', 'pitch_deck_share_tokens', 'deck_share_views', 'data_room_files',
    'dd_cases', 'dd_requests',
  ]) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(sqlOf('129_captable_one_canonical_per_project.sql'));
  db.exec(sqlOf('249_project_metrics.sql'));
  db.exec(sqlOf('410_safe_issuances.sql'));
  db.exec(sqlOf('442_raise_cycle_stores.sql'));
  db.exec(sqlOf('463_raise_record_stores.sql'));
  addColumnsFrom(db, sqlOf('441_build_cycle_stores.sql'), 'cap_table_holders');
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

// ---------------------------------------------------------------------------
// Test 10 — holders: addHolder() and updateHolder() (decision 4)
// ---------------------------------------------------------------------------

const OWNER = 11;        // the account whose founder_id is Kestrel's
const P_B = 2;           // another venture, owned by someone else
const PROSPECT = 501;    // Kestrel's prospect
const PROSPECT_B = 502;  // venture B's prospect

function holderFixture() {
  const db = fixture();
  db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)')
    .run(OWNER, 'founder', 'Kai Owner', 'kai@example.test', 1001);
  db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)')
    .run(12, 'founder', 'Bea Other', 'bea@example.test', 1002);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P_B}, 'Osprey Works', 1002)`);
  db.prepare('INSERT INTO raise_prospects (id, uid, project_id, name, email, stage) VALUES (?, ?, ?, ?, ?, ?)')
    .run(PROSPECT, 'rp-kestrel', P, 'Harbour Angels', 'deals@harbour.example.test', 'meeting');
  db.prepare('INSERT INTO raise_prospects (id, uid, project_id, name, email, stage) VALUES (?, ?, ?, ?, ?, ?)')
    .run(PROSPECT_B, 'rp-osprey', P_B, 'Other Fund', 'deals@other.example.test', 'meeting');
  return db;
}

// A studio-tier founder, deliberately not the owner account, so a write keyed
// on the actor rather than the venture owner shows.
const STUDIO = { id: 99, role: 'founder', subscription_tier: 'studio', subscription_status: 'active' } as any;
const envOf = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
const counts = (db: DatabaseSync) => Object.fromEntries(['cap_table_holders', 'cap_table_vesting', 'cap_table_scenarios', 'activity_logs']
  .map((t) => [t, Number((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n)]));
async function refusal(p: Promise<unknown>): Promise<{ status: number; body: any }> {
  try { await p; } catch (e: any) {
    if (e instanceof Response) return { status: e.status, body: await e.json() };
    if (e instanceof HolderError) return { status: e.status, body: e.sentence };
    throw e;
  }
  return assert.fail('the write was not refused');
}

test('10: a founder with ownership_pct gets a register row, a vesting row on the same user, an entry and that share; Build lists them', async () => {
  const db = holderFixture();
  await save(db, TABLE);
  const out = await addHolder(envOf(db), {
    projectId: P, actor: STUDIO, name: 'Ines Duarte', email: 'ines@example.test', group: 'founders', instrument: 'common',
    ownership_pct: 20, founder_role: 'CTO', vesting: { start_date: '2026-01-01', total_months: 48, cliff_months: 12 },
  });
  assert.match(out.id, /^h-[1-9][0-9]*$/);
  const reg = db.prepare('SELECT * FROM cap_table_holders WHERE id = ?').get(out.holderId) as any;
  assert.equal(reg.project_id, P);
  assert.equal(reg.user_id, OWNER, 'the register row is the venture owner\'s');
  assert.equal(reg.security_type, 'common');
  assert.equal(reg.kind, 'founder');
  assert.equal(reg.founder_role, 'CTO');
  assert.equal(reg.ownership_pct, 20);
  const vest = db.prepare('SELECT * FROM cap_table_vesting WHERE holder_id = ?').all(out.holderId) as any[];
  assert.equal(vest.length, 1);
  assert.equal(vest[0].user_id, reg.user_id, 'the vesting row carries the holder\'s own user_id');
  assert.equal(vest[0].total_shares, reg.shares);
  // 20% of the founding table: 10,000,000 others → 2,500,000 shares.
  const founders = stored(db).founders;
  const entry = founders.find((f: any) => f.holder_id === out.holderId);
  assert.equal(entry.shares, 2_500_000);
  assert.equal(reg.shares, 2_500_000);
  const total = founders.reduce((n: number, f: any) => n + f.shares, 0);
  assert.equal(entry.shares / total, 0.2);
  assert.match(entry.key, /^e-[0-9]+$/, 'the entry is keyed like any other');
  // Build's Founding team read (cycle_build.ts) lists founders by register row with a role.
  const listed = db.prepare(
    `SELECT h.id, h.name, h.founder_role, v.total_months FROM cap_table_holders h
       LEFT JOIN cap_table_vesting v ON v.holder_id = h.id AND v.user_id = h.user_id
      WHERE h.project_id = ? AND h.founder_role IS NOT NULL ORDER BY h.id`,
  ).all(P).map((r: any) => ({ ...r }));
  assert.deepEqual(listed, [{ id: out.holderId, name: 'Ines Duarte', founder_role: 'CTO', total_months: 48 }]);
  // addHolder logs nothing itself.
  assert.equal(counts(db).activity_logs, 0);
});

test('10: a SAFE with a prospect changes the after-round share and links the prospect', async () => {
  const db = holderFixture();
  const before = (await save(db, TABLE)).body.result;
  const out = await addHolder(envOf(db), {
    projectId: P, actor: STUDIO, name: 'Harbour Angels II', group: 'investors', instrument: 'safe',
    amount_cents: 50_000_000, cap_cents: 600_000_000, discount_pct: 20, prospect_id: PROSPECT,
  });
  assert.match(out.id, /^e-[0-9]+$/);
  assert.equal(out.holderId, null);
  const safe = stored(db).safes.find((x: any) => x.key === out.id);
  assert.deepEqual({ name: safe.name, amount: safe.amount, cap: safe.cap, discount: safe.discount, prospect_id: safe.prospect_id },
    { name: 'Harbour Angels II', amount: 500_000, cap: 6_000_000, discount: 0.2, prospect_id: PROSPECT });
  const after = JSON.parse((db.prepare('SELECT result_json FROM cap_table_scenarios WHERE project_id = ?').get(P) as any).result_json);
  assert.notDeepEqual(after, before, 'the recompute moved the table');
  assert.deepEqual(after, simulate(stored(db)));
  // A note is the same write, marked a note.
  const note = await addHolder(envOf(db), { projectId: P, actor: STUDIO, name: 'Bridge note', group: 'investors', instrument: 'note', amount_cents: 10_000_000, cap_cents: 900_000_000 });
  assert.equal(stored(db).safes.find((x: any) => x.key === note.id).instrument, 'note');
});

test('10: updateHolder on an h- id changes the register row, the entry and the vesting, and recomputes', async () => {
  const db = holderFixture();
  await save(db, TABLE);
  const { id, holderId } = await addHolder(envOf(db), {
    projectId: P, actor: STUDIO, name: 'Ines Duarte', group: 'founders', instrument: 'common', shares: 1_000_000,
    vesting: { start_date: '2026-01-01', total_months: 48, cliff_months: 12 },
  });
  await updateHolder(envOf(db), { projectId: P, actor: STUDIO, id, name: 'Ines Duarte-Silva', shares: 2_000_000,
    vesting: { start_date: '2026-02-01', total_months: 36, cliff_months: 6 } });
  const reg = db.prepare('SELECT name, shares FROM cap_table_holders WHERE id = ?').get(holderId) as any;
  assert.deepEqual({ ...reg }, { name: 'Ines Duarte-Silva', shares: 2_000_000 });
  const entry = stored(db).founders.find((f: any) => f.holder_id === holderId);
  assert.deepEqual({ name: entry.name, shares: entry.shares }, { name: 'Ines Duarte-Silva', shares: 2_000_000 });
  const vest = db.prepare('SELECT start_date, total_months, cliff_months, total_shares FROM cap_table_vesting WHERE holder_id = ?').all(holderId) as any[];
  assert.deepEqual(vest.map((v) => ({ ...v })), [{ start_date: '2026-02-01', total_months: 36, cliff_months: 6, total_shares: 2_000_000 }]);
  const result = JSON.parse((db.prepare('SELECT result_json FROM cap_table_scenarios WHERE project_id = ?').get(P) as any).result_json);
  assert.deepEqual(result, simulate(stored(db)));
  // A founder added without vesting gets their first vesting row from an edit, on their own user_id.
  const bare = await addHolder(envOf(db), { projectId: P, actor: STUDIO, name: 'Lin Park', group: 'founders', instrument: 'common', shares: 500_000 });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM cap_table_vesting WHERE holder_id = ?').get(bare.holderId) as any).n, 0);
  await updateHolder(envOf(db), { projectId: P, actor: STUDIO, id: bare.id, vesting: { start_date: '2026-03-01', total_months: 24, cliff_months: 0 } });
  assert.deepEqual((db.prepare('SELECT user_id, total_months, total_shares FROM cap_table_vesting WHERE holder_id = ?').all(bare.holderId) as any[]).map((v) => ({ ...v })),
    [{ user_id: OWNER, total_months: 24, total_shares: 500_000 }]);
  // An e- SAFE is edited in place.
  const safeKey = stored(db).safes[0].key;
  await updateHolder(envOf(db), { projectId: P, actor: STUDIO, id: safeKey, amount_cents: 30_000_000, prospect_id: PROSPECT });
  const safe = stored(db).safes.find((x: any) => x.key === safeKey);
  assert.deepEqual({ amount: safe.amount, prospect_id: safe.prospect_id }, { amount: 300_000, prospect_id: PROSPECT });
});

test('10: Option pool, Advisors, Options and Preferred answer 400 and write nothing', async () => {
  const db = holderFixture();
  await save(db, TABLE);
  const was = counts(db);
  const inputs = JSON.stringify(stored(db));
  for (const [group, instrument] of [['option_pool', 'common'], ['advisors', 'common'], ['founders', 'options'], ['investors', 'preferred'], ['founders', 'safe']]) {
    const r = await refusal(addHolder(envOf(db), { projectId: P, actor: STUDIO, name: 'Someone', group, instrument, shares: 10 } as any));
    assert.equal(r.status, 400, `${group} · ${instrument}`);
  }
  assert.deepEqual(counts(db), was);
  assert.equal(JSON.stringify(stored(db)), inputs);
});

test('10: a caller below studio gets ensureTier\'s 402 from addHolder and updateHolder themselves, and nothing is written', async () => {
  const db = holderFixture();
  await save(db, TABLE);
  const { id } = await addHolder(envOf(db), { projectId: P, actor: STUDIO, name: 'Ines Duarte', group: 'founders', instrument: 'common', shares: 1_000_000 });
  const was = counts(db);
  const inputs = JSON.stringify(stored(db));
  for (const tier of ['free', 'growth']) {
    const actor = { id: OWNER, role: 'founder', subscription_tier: tier, subscription_status: 'active' } as any;
    const add = await refusal(addHolder(envOf(db), {
      projectId: P, actor, name: 'Lin Park', group: 'founders', instrument: 'common', shares: 5,
      vesting: { start_date: '2026-01-01', total_months: 48, cliff_months: 12 },
    }));
    assert.equal(add.status, 402, tier);
    assert.deepEqual(add.body, tierUpsell('studio'), 'ensureTier\'s own upgrade body');
    const up = await refusal(updateHolder(envOf(db), { projectId: P, actor, id, shares: 9 }));
    assert.equal(up.status, 402, tier);
  }
  assert.deepEqual(counts(db), was, 'no holder, vesting, scenario or log row');
  assert.equal(JSON.stringify(stored(db)), inputs);
});

test('10 (who): another venture\'s prospect or register row answers 404, and nothing is written', async () => {
  const db = holderFixture();
  await save(db, TABLE);
  const was = counts(db);
  const r1 = await refusal(addHolder(envOf(db), { projectId: P, actor: STUDIO, name: 'Other', group: 'investors', instrument: 'safe', amount_cents: 100, prospect_id: PROSPECT_B }));
  assert.deepEqual(r1, { status: 404, body: 'Prospect not found' });
  // Venture B's own register row, named by its h- id against Kestrel.
  const b = db.prepare(`INSERT INTO cap_table_holders (user_id, project_id, name, security_type, shares, kind) VALUES (12, ?, 'B founder', 'common', 10, 'founder') RETURNING id`).get(P_B) as any;
  const was2 = counts(db);
  const r2 = await refusal(updateHolder(envOf(db), { projectId: P, actor: STUDIO, id: `h-${b.id}`, name: 'Taken over' }));
  assert.deepEqual(r2, { status: 404, body: 'Holder not found' });
  assert.equal((db.prepare('SELECT name FROM cap_table_holders WHERE id = ?').get(b.id) as any).name, 'B founder');
  assert.equal(was2.cap_table_holders, was.cap_table_holders + 1);
  assert.deepEqual(counts(db), was2);
  // A posted founder naming B's holder_id through the tool is not linked to it (keepOwnHolders).
  const posted = clone(stored(db));
  posted.founders[0].holder_id = b.id;
  const r3 = await save(db, posted);
  assert.equal(r3.status, 200);
  assert.equal(stored(db).founders[0].holder_id, undefined);
});

test('2 (ids): a founder added through addHolder reads as h-<register id>, the id Build\'s Founding team returns', async () => {
  const db = holderFixture();
  await save(db, TABLE);
  const { id, holderId } = await addHolder(envOf(db), { projectId: P, actor: STUDIO, name: 'Ines Duarte', group: 'founders', instrument: 'common', shares: 1_000_000 });
  assert.equal(id, `h-${holderId}`);
  assert.match(id, /^[a-z0-9][a-z0-9_-]*$/);
  assert.doesNotMatch(id, /ines|duarte/i, 'an id never holds a holder\'s name');
});

// ---------------------------------------------------------------------------
// Test 6 — links (decision 5): createShareLink(), the live-link predicate, the viewer cookie
// ---------------------------------------------------------------------------

const DECK = 5;
const linksApp = new Hono<any>();
linksApp.route('/api/decks', decks);
linksApp.route('/api/decks', deckShareActions);

function linksFixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'activity_logs', 'spinout_deck_overrides', 'pitch_decks', 'pitch_deck_share_tokens', 'deck_share_views', 'raise_prospects']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  db.exec(sqlOf('248_deck_share_revoked_at.sql'));
  addColumnsFrom(db, stripForeignKeys(sqlOf('463_raise_record_stores.sql')), 'pitch_deck_share_tokens');
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001)`);
  db.exec(`INSERT INTO pitch_decks (id, project_id, version, slides) VALUES (${DECK}, ${P}, 1, '[]')`);
  return db;
}
const link = (db: DatabaseSync, over: Record<string, unknown> = {}) => createShareLink(envOf(db), {
  deckId: DECK, deckVersion: 1, userId: ADMIN, actorEmail: null, ttlSeconds: null, viewLimit: null, ...over,
} as any);
async function open(db: DatabaseSync, token: string, cookie?: string) {
  const res = await linksApp.request(`/api/decks/share/${token}`, { headers: cookie ? { cookie } : {} }, envOf(db));
  const set = res.headers.get('set-cookie');
  return { status: res.status, body: await res.json().catch(() => null) as any, cookie: set ? set.split(';')[0] : null };
}
const views = (db: DatabaseSync) => Number((db.prepare('SELECT COUNT(*) AS n FROM deck_share_views').get() as any).n);
const otherBrowser = `${SHARE_VIEWER_COOKIE}=${'b'.repeat(32)}`;

test('6: a new link returns the raw link once; only its hash is stored, and no row holds it', async () => {
  const db = linksFixture();
  const out = await link(db, { investorLabel: 'Seed fund' });
  assert.ok(out.token.length > 20);
  const row = db.prepare('SELECT * FROM pitch_deck_share_tokens WHERE id = ?').get(out.id) as any;
  assert.equal(row.token_hash, createHash('sha256').update(out.token).digest('hex'));
  assert.ok(!Object.values(row).some((v) => typeof v === 'string' && v.includes(out.token)), 'the raw link is not stored');
  assert.equal(row.investor_label, 'Seed fund');
});

test('6: a Never link stores the sentinel and still opens after 31 days; a new link opens more than 100 times', async () => {
  const db = linksFixture();
  const out = await link(db);
  assert.equal(out.expiresAt, SHARE_NEVER_EXPIRES);
  assert.equal((db.prepare('SELECT expires_at FROM pitch_deck_share_tokens WHERE id = ?').get(out.id) as any).expires_at, SHARE_NEVER_EXPIRES);
  const realNow = Date.now;
  Date.now = () => realNow() + 31 * 86400_000;
  try { assert.equal((await open(db, out.token)).status, 200, 'opens on day 31'); } finally { Date.now = realNow; }
  for (let i = 0; i < 101; i++) assert.equal((await open(db, out.token)).status, 200, `open ${i + 2}`);
  assert.equal(views(db), 102);
});

test('6: with forwarding off, the first browser is bound; a second gets 403 with the sentence and no view; the first opens again', async () => {
  const db = linksFixture();
  const out = await link(db, { allowForwarding: false });
  const first = await open(db, out.token);
  assert.equal(first.status, 200);
  assert.ok(first.cookie?.startsWith(`${SHARE_VIEWER_COOKIE}=`), 'the first browser gets its cookie');
  const n = views(db);
  const second = await open(db, out.token, otherBrowser);
  assert.equal(second.status, 403);
  assert.equal(second.body.message ?? second.body.error, SHARE_SENT_TO_SOMEONE_ELSE);
  const noCookie = await open(db, out.token);
  assert.equal(noCookie.status, 403, 'a browser with no cookie is a second browser too');
  assert.equal(views(db), n, 'a refused browser uses no view');
  assert.equal((await open(db, out.token, first.cookie!)).status, 200);
  // The share actions answer the second browser as a bad signature.
  const ctx = await linksApp.request(`/api/decks/share/${out.token}/context`, { headers: { cookie: otherBrowser } }, envOf(db));
  assert.equal(ctx.status, 401);
  assert.equal((await ctx.json() as any).error, 'invalid_token');
  const ok = await linksApp.request(`/api/decks/share/${out.token}/context`, { headers: { cookie: first.cookie! } }, envOf(db));
  assert.notEqual(ok.status, 401);
});

test('6: two first opens at once bind one browser', async () => {
  const db = linksFixture();
  const out = await link(db, { allowForwarding: false });
  const [a, b] = await Promise.all([open(db, out.token, `${SHARE_VIEWER_COOKIE}=${'a'.repeat(32)}`), open(db, out.token, otherBrowser)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 403]);
  assert.equal(views(db), 1);
});

test('6: with forwarding on, two browsers open it and two view rows exist; allow_download is returned', async () => {
  const db = linksFixture();
  const out = await link(db, { allowDownload: false });
  const a = await open(db, out.token, `${SHARE_VIEWER_COOKIE}=${'a'.repeat(32)}`);
  const b = await open(db, out.token, otherBrowser);
  assert.deepEqual([a.status, b.status], [200, 200]);
  assert.equal(a.cookie, null, 'no cookie is set when forwarding is on');
  assert.equal(views(db), 2);
  assert.equal(a.body.allow_download, false);
});

test('6: a pre-463 link opens once and returns allow_download: true', async () => {
  const db = linksFixture();
  const tok = (await link(db)).token;
  // The row as a link minted before 463 reads: the columns' defaults, a view limit of one.
  db.exec(`UPDATE pitch_deck_share_tokens SET view_limit = 1, allow_download = 1, allow_forwarding = 1, prospect_id = NULL, investor_label = NULL, bound_viewer_hash = NULL`);
  const r = await open(db, tok);
  assert.equal(r.status, 200);
  assert.equal(r.body.allow_download, true);
  assert.equal((await open(db, tok)).status, 410, 'its single view is spent');
});

test('6: revoke keeps the views; a revoked Never link answers invalid_token on context and signup, and its heartbeat stops', async () => {
  const db = linksFixture();
  const out = await link(db);
  const v = await open(db, out.token);
  assert.equal(v.status, 200);
  assert.equal(views(db), 1);
  assert.ok(await revokeShareLink(envOf(db), DECK, out.id!));
  assert.equal(views(db), 1, 'the views stay');
  assert.equal((await open(db, out.token)).status, 410);
  for (const [method, path] of [['GET', 'context'], ['POST', 'signup']]) {
    const res = await linksApp.request(`/api/decks/share/${out.token}/${path}`, {
      method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined,
    }, envOf(db));
    assert.equal(res.status, 401, path);
    assert.equal((await res.json() as any).error, 'invalid_token', path);
  }
  // revoked_at alone (a revoke whose expires_at write did not land) still stops every read.
  const half = await link(db, { actorEmail: 'second.link@example.test' });
  const hv = await open(db, half.token);
  db.prepare(`UPDATE pitch_deck_share_tokens SET revoked_at = datetime('now') WHERE id = ?`).run(half.id);
  const ctxHalf = await linksApp.request(`/api/decks/share/${half.token}/context`, {}, envOf(db));
  assert.equal(ctxHalf.status, 401);
  const hbHalf = await linksApp.request(`/api/decks/share/${half.token}/heartbeat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ view_id: hv.body.view_id, seconds: 30 }),
  }, envOf(db));
  assert.equal((await hbHalf.json() as any).ok, false);
  const hb = await linksApp.request(`/api/decks/share/${out.token}/heartbeat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ view_id: v.body.view_id, seconds: 30 }),
  }, envOf(db));
  assert.equal((await hb.json() as any).ok, false);
  assert.equal(Number((db.prepare('SELECT read_seconds FROM deck_share_views').get() as any).read_seconds), 0);
});

// ---------------------------------------------------------------------------
// Tests 7 and 17 — the data room's one predicate (decision 6), and the founder read
// ---------------------------------------------------------------------------

const R_FOUNDER = 21, COMMITTED = 22, INVITED = 23, R_ADVISOR = 24;
const ROOM = 7;
function roomFixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT UNIQUE NOT NULL, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
  `);
  for (const t of ['data_room_grants', 'data_room_files', 'data_room_folders', 'data_room_access_log', 'pairwise_ndas', 'raise_prospects', 'dd_cases', 'dd_requests']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  addColumnsFrom(db, stripForeignKeys(sqlOf('463_raise_record_stores.sql')), 'data_room_files');
  addColumnsFrom(db, stripForeignKeys(sqlOf('442_raise_cycle_stores.sql')), 'data_room_files');
  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?,?,?,?,?)');
  u.run(R_FOUNDER, 'founder', 300, 'Fen Founder', 'fen@example.test');
  u.run(COMMITTED, 'investor', null, 'Cal Committed', 'Cal@Example.test');
  u.run(INVITED, 'investor', null, 'Ivo Invited', 'ivo@example.test');
  u.run(R_ADVISOR, 'advisor', null, 'Ada Advisor', 'ada.adv@example.test');
  db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?,?,?,?)').run(ROOM, 'p-room', 'Kestrel Labs', 300);
  db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?,?,?,?)').run(8, 'p-else', 'Osprey Works', 400);
  // Cal is a committed prospect of Kestrel (the email matches, case aside); Ivo is only in Osprey's pipeline, committed there.
  const rp = db.prepare('INSERT INTO raise_prospects (uid, project_id, name, email, stage) VALUES (?,?,?,?,?)');
  rp.run('rp-cal', ROOM, 'Cal fund', 'cal@example.test', 'committed');
  rp.run('rp-ivo', ROOM, 'Ivo fund', 'ivo@example.test', 'diligence');
  rp.run('rp-ivo-else', 8, 'Ivo fund', 'ivo@example.test', 'committed');
  const g = db.prepare(`INSERT INTO data_room_grants (uid, project_id, investor_user_id, granted_by_user_id, status) VALUES (?,?,?,?, 'active')`);
  g.run('g-committed', ROOM, COMMITTED, R_FOUNDER);
  g.run('g-invited', ROOM, INVITED, R_FOUNDER);
  // Both investors have an NDA, so every hidden file below is hidden by the tier, not the NDA.
  const n = db.prepare(`INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (?, ?, 'active')`);
  n.run(R_FOUNDER, COMMITTED);
  n.run(R_FOUNDER, INVITED);
  const f = db.prepare(
    `INSERT INTO data_room_files (id, uid, project_id, name, r2_key, content_type, size_bytes, visibility, access_tier, access_expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  f.run(31, 'f-open', ROOM, 'Deck.pdf', 'k/open', 'application/pdf', 10, 'open', 'invited', null);
  f.run(32, 'f-nda', ROOM, 'Terms.pdf', 'k/nda', 'application/pdf', 10, 'nda', 'invited', null);
  f.run(33, 'f-committed', ROOM, 'Side letter.pdf', 'k/committed', 'application/pdf', 10, 'open', 'committed', null);
  f.run(34, 'f-nobody', ROOM, 'Private.pdf', 'k/nobody', 'application/pdf', 10, 'open', 'nobody', null);
  f.run(35, 'f-expired', ROOM, 'Old model.xlsx', 'k/expired', 'application/pdf', 10, 'open', 'invited', '2020-01-01');
  f.run(36, 'f-later', ROOM, 'Plan.pdf', 'k/later', 'application/pdf', 10, 'open', 'invited', '2999-01-01');
  return db;
}
const ROOM_ROLE: Record<number, string> = { [R_FOUNDER]: 'founder', [COMMITTED]: 'investor', [INVITED]: 'investor', [R_ADVISOR]: 'advisor' };
async function roomCall(app: any, db: DatabaseSync, userId: number, method: string, path: string, body?: unknown) {
  const tok = await new SignJWT({ user_id: userId, role: ROOM_ROLE[userId] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://x${path}`, {
    method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), FILES: { put: async () => {}, delete: async () => {} } } as any);
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null, raw };
}
const uids = (files: any[]) => files.map((f) => f.uid).sort();
const HIDDEN_NAMES = /Private\.pdf|Old model|Side letter/;

test('7: a committed file reaches only a committed prospect; nobody and expired files reach no one, in the room, the list and the download', async () => {
  const db = roomFixture();
  const cal = await roomCall(dataRoom, db, COMMITTED, 'GET', '/shared/p-room');
  const ivo = await roomCall(dataRoom, db, INVITED, 'GET', '/shared/p-room');
  assert.equal(cal.status, 200);
  assert.deepEqual(uids(cal.body.files), ['f-committed', 'f-later', 'f-nda', 'f-open']);
  assert.deepEqual(uids(ivo.body.files), ['f-later', 'f-nda', 'f-open'], 'committed elsewhere is not committed here');
  assert.equal(ivo.body.withheld_behind_nda, 0, 'a hidden file is not counted as withheld');
  assert.doesNotMatch(ivo.raw, HIDDEN_NAMES);
  const list = await roomCall(dataRoom, db, INVITED, 'GET', '/shared');
  assert.equal(list.body.items[0].file_count, 3);
  assert.equal((await roomCall(dataRoom, db, COMMITTED, 'GET', '/shared')).body.items[0].file_count, 4);
  for (const [who, uid, status] of [[INVITED, 'f-committed', 404], [COMMITTED, 'f-nobody', 404], [COMMITTED, 'f-expired', 404], [INVITED, 'f-nobody', 404]] as const) {
    const r = await roomCall(dataRoom, db, who, 'POST', `/shared/p-room/files/${uid}/download`);
    assert.equal(r.status, status, `${uid} for ${who}`);
    assert.equal(r.body.detail, 'File not found');
  }
  assert.equal((await roomCall(dataRoom, db, COMMITTED, 'POST', '/shared/p-room/files/f-committed/download')).status, 200);
  assert.equal((await roomCall(dataRoom, db, INVITED, 'POST', '/shared/p-room/files/f-open/download')).status, 200);
});

test('7: the NDA gate still applies on top of the tier', async () => {
  const db = roomFixture();
  db.exec(`DELETE FROM pairwise_ndas WHERE party_b_user_id = ${INVITED}`);
  db.exec(`UPDATE data_room_files SET visibility = 'nda' WHERE uid = 'f-committed'`);
  const ivo = await roomCall(dataRoom, db, INVITED, 'GET', '/shared/p-room');
  assert.deepEqual(uids(ivo.body.files), ['f-later', 'f-open']);
  assert.equal(ivo.body.withheld_behind_nda, 1, 'only the NDA file the tier admits is withheld; the committed one is not counted');
  assert.equal((await roomCall(dataRoom, db, INVITED, 'POST', '/shared/p-room/files/f-nda/download')).status, 403);
});

test('7: the research.ts reads honour the same predicate: counts, the room, the file read', async () => {
  const db = roomFixture();
  const list = await roomCall(research, db, INVITED, 'GET', '/diligence');
  assert.equal(list.status, 200, list.raw);
  const item = list.body.items.find((i: any) => i.grant_uid === 'g-invited');
  assert.deepEqual([item.file_total, item.file_open, item.withheld_behind_nda ?? 0], [3, 3, 0]);
  const calItem = (await roomCall(research, db, COMMITTED, 'GET', '/diligence')).body.items[0];
  assert.equal(calItem.file_total, 4);
  const room = await roomCall(research, db, INVITED, 'GET', '/diligence/g-invited');
  assert.equal(room.status, 200, room.raw);
  assert.doesNotMatch(room.raw, HIDDEN_NAMES);
  for (const uid of ['f-committed', 'f-nobody', 'f-expired']) {
    const r = await roomCall(research, db, INVITED, 'GET', `/diligence/g-invited/files/${uid}`);
    assert.equal(r.status, 404, uid);
    assert.doesNotMatch(r.raw, HIDDEN_NAMES);
  }
  assert.equal((await roomCall(research, db, COMMITTED, 'GET', '/diligence/g-committed/files/f-committed')).status, 200);
});

test('7: the advisor brief counts as an invited investor who has not committed', async () => {
  const db = roomFixture();
  // advisor_grants.ts reads `admittedCounts(c.env, project.id, false, false)` (pinned in advisor_client_grants.test.ts).
  assert.deepEqual(await admittedCounts(envOf(db), ROOM, false, false), { total: 3, open: 2 });
  assert.deepEqual(await admittedCounts(envOf(db), ROOM, true, true), { total: 4, open: 4 });
});

test('17: the founder read returns each file\'s tier and expiry, and each grant\'s committed', async () => {
  const db = roomFixture();
  const r = await roomCall(dataRoom, db, R_FOUNDER, 'GET', '/p-room');
  assert.equal(r.status, 200, r.raw);
  const byUid = Object.fromEntries(r.body.files.map((f: any) => [f.uid, [f.access_tier, f.access_expires_at]]));
  assert.deepEqual(byUid['f-committed'], ['committed', null]);
  assert.deepEqual(byUid['f-nobody'], ['nobody', null]);
  assert.deepEqual(byUid['f-expired'], ['invited', '2020-01-01']);
  assert.equal(r.body.files.length, 6, 'the founder sees every file');
  const grants = Object.fromEntries(r.body.grants.map((g: any) => [g.uid ?? g.grant_uid, !!g.committed]));
  assert.deepEqual(grants, { 'g-committed': true, 'g-invited': false });
});

test('7 (writes): upload and PATCH take the tier fields; a bad tier, date or checklist item is 400, another venture\'s request 404', async () => {
  const db = roomFixture();
  db.exec(`INSERT INTO dd_cases (id, uid, subject_type, subject_id, subject_label, owner_user_id) VALUES (70, 'dd-k', 'project', ${ROOM}, 'Kestrel Labs', ${R_FOUNDER}), (80, 'dd-o', 'project', 8, 'Osprey Works', ${R_FOUNDER})`);
  db.exec(`INSERT INTO dd_requests (id, case_id, title) VALUES (71, 70, 'Cap table'), (81, 80, 'Theirs')`);
  const data = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 x').toString('base64')}`;
  const up = await roomCall(dataRoom, db, R_FOUNDER, 'POST', '/p-room/files', {
    name: 'Side.pdf', data, access_tier: 'committed', access_expires_at: '2999-06-30', dd_request_id: 71, folder_name: 'Legal',
  });
  assert.equal(up.status, 201, up.raw);
  const row = db.prepare('SELECT access_tier, access_expires_at, dd_request_id, folder_id FROM data_room_files WHERE uid = ?').get(up.body.uid) as any;
  assert.deepEqual([row.access_tier, row.access_expires_at, row.dd_request_id], ['committed', '2999-06-30', 71]);
  assert.equal((db.prepare('SELECT name, parent_id FROM data_room_folders WHERE id = ?').get(row.folder_id) as any).name, 'Legal');
  const again = await roomCall(dataRoom, db, R_FOUNDER, 'POST', '/p-room/files', { name: 'B.pdf', data, folder_name: 'Legal' });
  assert.equal((db.prepare('SELECT folder_id FROM data_room_files WHERE uid = ?').get(again.body.uid) as any).folder_id, row.folder_id, 'one Legal folder');
  const before = Number((db.prepare('SELECT COUNT(*) AS n FROM data_room_files').get() as any).n);
  for (const [body, status] of [
    [{ access_tier: 'everyone' }, 400], [{ access_expires_at: 'tomorrow' }, 400], [{ checklist_item: 'not_a_key' }, 400], [{ dd_request_id: 81 }, 404],
  ] as const) {
    const r = await roomCall(dataRoom, db, R_FOUNDER, 'POST', '/p-room/files', { name: 'X.pdf', data, ...body });
    assert.equal(r.status, status, JSON.stringify(body));
    if ('access_tier' in body) assert.equal(r.body.detail, 'access_tier must be invited, committed or nobody', 'refused by the route, not by the column\'s CHECK');
    const p = await roomCall(dataRoom, db, R_FOUNDER, 'PATCH', `/p-room/files/${up.body.uid}`, body);
    assert.equal(p.status, status, `PATCH ${JSON.stringify(body)}`);
  }
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM data_room_files').get() as any).n), before, 'a refused upload writes nothing');
  const p = await roomCall(dataRoom, db, R_FOUNDER, 'PATCH', `/p-room/files/${up.body.uid}`, { access_tier: 'nobody', access_expires_at: null, dd_request_id: null });
  assert.equal(p.status, 200, p.raw);
  const after = db.prepare('SELECT access_tier, access_expires_at, dd_request_id FROM data_room_files WHERE uid = ?').get(up.body.uid) as any;
  assert.deepEqual({ ...after }, { access_tier: 'nobody', access_expires_at: null, dd_request_id: null });
});
