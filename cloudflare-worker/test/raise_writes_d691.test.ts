import { raiseEvidenceTables } from './_raise_evidence_fixture.ts';
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
 * applied over them, and the routes run through `_d1_sqlite.mjs`. The cycle
 * routes' fixture also applies 459 (D690's activity index) and builds the
 * fund directory from 365's CREATE statements and 406 whole, with made-up funds.
 *
 * #1700's first PR adds tests 10 (holders), 6 (links), 7 (data room) and the
 * founder read of 17. Its second adds step 5's cycle routes and their logging
 * (decision 12): the cases of tests 2, 4 and 8-13 for those routes. The record
 * actions, form-options and `since: 'last'` come with the closing PR.
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
import { personalMatchTables } from './_mercury_d713.ts';

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
  db.exec(sqlOf('567_deck_share_nda_include.sql')); // D902: a link's NDA and what it includes
  raiseEvidenceTables(db);
  db.exec(sqlOf('544_narrative_sections.sql')); // D908: a version based on another copies its narrative stores
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
  db.exec(sqlOf('549_deck_share_nullable_view_limit.sql'));
  db.exec(sqlOf('567_deck_share_nda_include.sql')); // D902, after 549's rebuild
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
  for (const t of ['data_room_grants', 'data_room_files', 'data_room_folders', 'data_room_access_log', 'pairwise_ndas', 'raise_prospects', 'dd_cases', 'dd_requests', 'activity_logs']) {
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

// ---------------------------------------------------------------------------
// #1700's second PR — step 5's cycle routes and decision 12's log rows.
// Tests 2, 4 and 8-13 for these routes; the record actions, form-options and
// `since: 'last'` come with the closing PR, after #1699's.
// ---------------------------------------------------------------------------

import cycleRaise from '../src/routes/cycle_raise.ts';

const C_FOUNDER = 110, C_FREE = 111, C_OTHER = 120, C_PARTNER = 140, C_INVESTOR = 150, C_ADVISOR = 160;
const C_P = 1, C_PB = 2;
const C_ROLE: Record<number, string> = {
  [C_FOUNDER]: 'founder', [C_FREE]: 'founder', [C_OTHER]: 'founder', [C_PARTNER]: 'partner', [C_INVESTOR]: 'investor', [C_ADVISOR]: 'advisor', [ADMIN]: 'admin',
};
const B_DECK = 9, B_LINK = 90, B_PROSPECT = 92;
// Every made-up person and fund name a write below sends: no log summary may hold one.
const NAMES = /Ines|Duarte|Northwind|Alder|Harbour|Kite Partner|Juno|Osprey Angel/i;

function ddlOnly(file: string): string {
  return sqlOf(file).split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => /^CREATE\s+(TABLE|INDEX)/i.test(s)).map((s) => `${s};`).join('\n');
}

function cycleFixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of [
    'users', 'projects', 'activity_logs', 'cap_table_scenarios', 'cap_table_holders', 'cap_table_vesting', 'raise_prospects', 'raise_rounds',
    'spinout_deck_overrides', 'pitch_decks', 'pitch_deck_share_tokens', 'deck_share_views', 'data_room_folders', 'data_room_files',
    'dd_cases', 'dd_requests', 'contacts', 'pain_groups', 'hypotheses', 'mvp_features', 'roadmap_okrs',
  ]) db.exec(tableFromBaseline(BASELINE, t));
  const cols = (t: string) => new Set((db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as any[]).map((r) => r.name));
  if (!cols('pitch_deck_share_tokens').has('revoked_at')) db.exec(sqlOf('248_deck_share_revoked_at.sql'));
  for (const [c, d] of [['amount', 'REAL'], ['close_id', 'INTEGER'], ['commit_status', 'TEXT'], ['instrument', 'TEXT']]) {
    if (!cols('raise_prospects').has(c)) db.exec(`ALTER TABLE raise_prospects ADD COLUMN ${c} ${d}`);
  }
  db.exec(sqlOf('129_captable_one_canonical_per_project.sql'));
  db.exec(sqlOf('249_project_metrics.sql'));
  db.exec(sqlOf('410_safe_issuances.sql'));
  db.exec(sqlOf('442_raise_cycle_stores.sql'));
  db.exec(sqlOf('459_cycle_activity_convention.sql'));
  db.exec(sqlOf('463_raise_record_stores.sql'));
  raiseEvidenceTables(db);
  db.exec(sqlOf('549_deck_share_nullable_view_limit.sql'));
  db.exec(sqlOf('567_deck_share_nda_include.sql')); // D902, after 549's rebuild
  db.exec(sqlOf('544_narrative_sections.sql'));
  personalMatchTables(db); // D752: the trigger on raise_prospects
  addColumnsFrom(db, sqlOf('441_build_cycle_stores.sql'), 'cap_table_holders');
  // The fund directory: the CREATE statements only, and 406 whole, with made-up funds.
  db.exec(ddlOnly('365_research_eurotech_fund_directory.sql'));
  db.exec(sqlOf('406_research_fund_sources.sql'));
  db.prepare(`INSERT INTO research_fund_sources (source_name, title, terms_status, evidence, verdict, verdict_reason, reviewed_on)
              VALUES (?, 't', 'not found', 'e', ?, 'r', '2026-10-06')`).run('A served list', 'cite only');
  db.prepare(`INSERT INTO research_fund_sources (source_name, title, terms_status, evidence, verdict, verdict_reason, reviewed_on)
              VALUES (?, 't', 'not found', 'e', ?, 'r', '2026-10-06')`).run('A withdrawn list', 'not allowed');
  const f = db.prepare(`INSERT INTO research_fund_directory (uid, name, sector_focus, source_name, source_url, as_of) VALUES (?, ?, 'Generalist', ?, 'https://example.test/list', '2026-10-04')`);
  f.run('alder-ventures', 'Alder Ventures', 'A served list');
  f.run('withdrawn-fund', 'Withdrawn Fund', 'A withdrawn list');

  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, subscription_tier) VALUES (?, ?, ?, ?, 1, ?, ?)');
  u.run(C_FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001, 'studio');
  u.run(C_FREE, 'founder', 'Fred Free', 'fred@example.test', 1001, 'free');
  u.run(C_OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002, 'studio');
  u.run(C_PARTNER, 'partner', 'Pat Partner', 'pat@example.test', null, 'free');
  u.run(C_INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null, 'free');
  u.run(C_ADVISOR, 'advisor', 'Ari Advisor', 'ari@example.test', null, 'free');
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null, 'free');
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${C_P}, 'Kestrel Labs', 1001), (${C_PB}, 'Osprey Works', 1002)`);
  db.exec(`INSERT INTO pitch_decks (id, project_id, version, slides) VALUES (5, ${C_P}, 1, '[]'), (${B_DECK}, ${C_PB}, 1, '[]')`);
  db.exec(`INSERT INTO pitch_deck_share_tokens (id, deck_id, token_hash, expires_at, view_limit, view_count) VALUES (${B_LINK}, ${B_DECK}, 'h', '2999-01-01 00:00:00', 1, 0)`);
  db.exec(`INSERT INTO raise_prospects (id, uid, project_id, name, email, stage) VALUES (${B_PROSPECT}, 'rp-b', ${C_PB}, 'Osprey Angel', 'angel@osprey.example.test', 'meeting')`);
  // Venture B has narrative version 3; Kestrel has none.
  db.exec(`INSERT INTO spinout_deck_overrides (project_id, field_key, value, version, investor_type) VALUES (${C_PB}, '_version', 'angel', 3, 'angel')`);
  return db;
}

const cycleApp = new Hono<any>();
cycleApp.route('/api/cycles/raise', cycleRaise);
cycleApp.route('/api/decks', decks);
cycleApp.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function cyc(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: C_ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await cycleApp.request(path.startsWith('/api/') ? path : `/api/cycles/raise${path}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, envOf(db));
    const raw = await res.text();
    return { status: res.status, body: raw ? JSON.parse(raw) : null, raw };
  } finally { [console.warn, console.error] = saved; }
}
const q = (path: string, pid = C_P) => `${path}${path.includes('?') ? '&' : '?'}project=${pid}`;
const logs = (db: DatabaseSync, where = '1 = 1', ...args: any[]) =>
  db.prepare(`SELECT project_id, user_id, entity_type, entity_id, action, details FROM activity_logs WHERE ${where} ORDER BY id`).all(...args) as any[];
const n = (db: DatabaseSync, sql: string, ...args: any[]) => Number((db.prepare(sql).get(...args) as any).n);

test('4 (who): a partner, an advisor member, an investor and another venture\'s founder get 403 on every write', async () => {
  const db = cycleFixture();
  const writes: Array<[string, string, unknown]> = [
    ['PUT', '/readiness/team', { score: 5, evidence: 'pattern' }],
    ['POST', '/readiness/rescore', {}],
    ['POST', '/narrative-versions', { investor_type: 'angel' }],
    ['PATCH', '/narrative-versions/1', { why_now: 'x' }],
    ['POST', '/deck-links', { deck_id: 5, investor_label: 'Kite Partner', expires_days: 7 }],
    ['PATCH', '/deck-links/1', { allow_download: false }],
    ['POST', '/holders', { name: 'Juno', group: 'founders', instrument: 'common', shares: 10 }],
    ['PATCH', '/holders/h-1', { shares: 10 }],
    ['PUT', '/use-of-funds', { sections: [{ key: 'product', pct: 100 }] }],
    ['POST', '/prospects', { name: 'Northwind Angels', stage: 'identified' }],
    ['PATCH', '/prospects/1', { stage: 'meeting' }],
    ['PUT', '/prospects/1/next-step', { next_step: 'x' }],
    ['PUT', '/data-room/files/1/checklist', { item: null }],
  ];
  for (const who of [C_PARTNER, C_ADVISOR, C_INVESTOR, C_OTHER]) {
    for (const [m, path, b] of writes) {
      const r = await cyc(db, who, m, q(path), b);
      assert.equal(r.status, 403, `${C_ROLE[who]} ${who} ${m} ${path}`);
    }
  }
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM activity_logs'), 0, 'a refused write logs nothing');
});

test('4 (ids): a venture-B id with ?project=A answers 404 on every PATCH, and so does a B id a body names', async () => {
  const db = cycleFixture();
  const bHolder = db.prepare(`INSERT INTO cap_table_holders (user_id, project_id, name, security_type, shares, kind) VALUES (${C_OTHER}, ${C_PB}, 'B founder', 'common', 10, 'founder') RETURNING id`).get() as any;
  const cases: Array<[string, string, unknown]> = [
    ['PATCH', '/narrative-versions/3', { why_now: 'Taken over' }],
    ['PATCH', `/deck-links/${B_LINK}`, { allow_download: false }],
    ['PATCH', `/holders/h-${bHolder.id}`, { name: 'Taken over' }],
    ['PATCH', `/prospects/${B_PROSPECT}`, { stage: 'passed' }],
    ['POST', '/deck-links', { deck_id: B_DECK, investor_label: 'Kite Partner', expires_days: 7 }],
    ['POST', '/deck-links', { deck_id: 5, prospect_id: B_PROSPECT, expires_days: 7 }],
    ['POST', '/narrative-versions', { investor_type: 'angel', start_from: 'version', based_on_version: 3 }],
    ['POST', '/holders', { name: 'Juno', group: 'investors', instrument: 'safe', amount_cents: 100_00, prospect_id: B_PROSPECT }],
  ];
  for (const [m, path, b] of cases) {
    const r = await cyc(db, C_FOUNDER, m, q(path), b);
    assert.equal(r.status, 404, `${m} ${path} ${JSON.stringify(b)}: ${r.raw}`);
  }
  assert.equal((db.prepare('SELECT allow_download FROM pitch_deck_share_tokens WHERE id = ?').get(B_LINK) as any).allow_download, 1);
  assert.equal((db.prepare('SELECT stage FROM raise_prospects WHERE id = ?').get(B_PROSPECT) as any).stage, 'meeting');
  assert.equal((db.prepare('SELECT name FROM cap_table_holders WHERE id = ?').get(bHolder.id) as any).name, 'B founder');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM pitch_deck_share_tokens'), 1, 'no link was made');
  assert.equal(n(db, `SELECT COUNT(*) AS n FROM spinout_deck_overrides WHERE project_id = ${C_P}`), 0, 'no version was made');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM activity_logs'), 0);
});

test('8: re-score takes a subset and keeps earlier scores; an empty body scores the six; team is 400', async () => {
  const db = cycleFixture();
  const computed = () => n(db, "SELECT COUNT(*) AS n FROM readiness_scores WHERE source = 'computed'");
  const r1 = await cyc(db, C_FOUNDER, 'POST', q('/readiness/rescore'), { items: ['deck', 'cap_table'] });
  assert.equal(r1.status, 200, r1.raw);
  assert.deepEqual(r1.body, { scored: 2, items: ['deck', 'cap_table'] });
  assert.deepEqual((db.prepare(`SELECT i.item_key FROM readiness_scores s JOIN readiness_items i ON i.id = s.item_id ORDER BY i.item_key`).all() as any[]).map((r) => r.item_key), ['cap_table', 'deck']);
  const r2 = await cyc(db, C_FOUNDER, 'POST', q('/readiness/rescore'));
  assert.equal(r2.status, 200);
  assert.equal(r2.body.scored, 6, '#1652\'s caller: no body, the six computed items');
  assert.equal(computed(), 8, 'earlier scores are kept');
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM readiness_scores s JOIN readiness_items i ON i.id = s.item_id WHERE i.item_key = 'team'"), 0, 'team is left alone');
  const team = await cyc(db, C_FOUNDER, 'POST', q('/readiness/rescore'), { items: ['deck', 'team'] });
  assert.deepEqual([team.status, team.body.detail], [400, 'Team is scored by a person, not by a check']);
  assert.equal((await cyc(db, C_FOUNDER, 'POST', q('/readiness/rescore'), { items: ['nope'] })).status, 400);
  assert.equal((await cyc(db, C_FOUNDER, 'POST', q('/readiness/rescore'), { since: 'yesterday' })).status, 400);
  assert.equal(computed(), 8, 'a refused re-score writes nothing');
  assert.equal(logs(db, "action = 'readiness_rescored'").length, 8, 'one row per item scored');
});

test('8: since: last skips an item whose stores did not change, and re-scores one whose store has a newer row or a different finding', async () => {
  const db = cycleFixture();
  const last = async () => (await cyc(db, C_FOUNDER, 'POST', q('/readiness/rescore'), { since: 'last' })).body;
  assert.deepEqual((await last()).items, ['deck', 'use_of_funds', 'cap_table', 'traction', 'data_room', 'narrative'], 'an unscored item is scored');
  // Nothing changed: only the two checks that read projects fields, which keep no write time, run again.
  assert.deepEqual((await last()).items, ['use_of_funds', 'traction']);
  // A deck saved after the newest score re-scores the deck (its score is still 10); the data room did not change.
  db.exec(`UPDATE readiness_scores SET scored_at = '2026-01-01 00:00:00'`);
  db.exec(`UPDATE pitch_decks SET created_at = '2025-12-01 00:00:00'`);
  db.exec(`INSERT INTO pitch_decks (project_id, version, slides, created_at) VALUES (${C_P}, 2, '[]', '2026-02-01 00:00:00')`);
  assert.deepEqual((await last()).items, ['deck', 'use_of_funds', 'traction']);
  // A deleted deck leaves no newer row, but the check now finds something else, so it is re-scored.
  db.exec(`UPDATE readiness_scores SET scored_at = '2026-03-01 00:00:00'`);
  db.exec(`DELETE FROM pitch_decks WHERE project_id = ${C_P}`);
  const r = await last();
  assert.deepEqual(r.items, ['deck', 'use_of_funds', 'traction']);
  // A subset is still a subset.
  assert.deepEqual((await cyc(db, C_FOUNDER, 'POST', q('/readiness/rescore'), { items: ['data_room', 'traction'], since: 'last' })).body.items, ['traction']);
});

test('9: New version stores its fields, starts from live, a version or blank, and Edit runs the check again', async () => {
  const db = cycleFixture();
  db.exec(`INSERT INTO spinout_deck_overrides (project_id, field_key, value, version) VALUES (${C_P}, 'cover.thesis', 'Live thesis', 0), (${C_P}, 'ask.title', 'Live ask', 0)`);
  const words = (v: number) => Object.fromEntries((db.prepare(`SELECT field_key, value FROM spinout_deck_overrides WHERE project_id = ${C_P} AND version = ? AND field_key != '_version'`).all(v) as any[]).map((r) => [r.field_key, r.value]));
  const meta = (v: number) => ({ ...(db.prepare(`SELECT start_from, based_on_version, why_now, check_against_json, created_by FROM narrative_version_meta WHERE project_id = ${C_P} AND version = ?`).get(v) as any) });

  const v1 = await cyc(db, C_FOUNDER, 'POST', q('/narrative-versions'), {
    investor_type: 'seed_fund', one_liner: 'Grid batteries for cold towns', why_now: 'Tariffs changed this year', ask: 'Raising $2,000,000', check_against: ['metrics', 'deck'],
  });
  assert.equal(v1.status, 201, v1.raw);
  assert.equal(v1.body.version, 1);
  assert.deepEqual(words(1), { 'cover.thesis': 'Grid batteries for cold towns', 'ask.title': 'Raising $2,000,000' });
  assert.deepEqual(meta(1), { start_from: 'live', based_on_version: null, why_now: 'Tariffs changed this year', check_against_json: '["deck","metrics"]', created_by: C_FOUNDER });

  const v2 = await cyc(db, C_FOUNDER, 'POST', q('/narrative-versions'), { investor_type: 'angel', start_from: 'version', based_on_version: 1 });
  assert.equal(v2.body.version, 2);
  assert.deepEqual(words(2), words(1), 'start from a version copies that version\'s words');
  assert.equal(meta(2).based_on_version, 1);

  const v3 = await cyc(db, C_FOUNDER, 'POST', q('/narrative-versions'), { investor_type: 'angel', start_from: 'blank' });
  assert.deepEqual(words(v3.body.version), {}, 'blank copies nothing');
  // #1652's caller: only the type, and the live wording, as before.
  const v4 = await cyc(db, C_FOUNDER, 'POST', q('/narrative-versions'), { investor_type: 'angel' });
  assert.equal(v4.status, 201);
  assert.deepEqual(words(v4.body.version), { 'cover.thesis': 'Live thesis', 'ask.title': 'Live ask' });
  assert.equal(meta(v4.body.version).start_from, 'live');

  for (const [b, status] of [
    [{ investor_type: 'angel', start_from: 'version' }, 404], [{ investor_type: 'angel', start_from: 'someday' }, 400],
    [{ investor_type: 'angel', based_on_version: 1 }, 400], [{ investor_type: 'angel', check_against: ['data_room'] }, 400], [{ investor_type: 'vc' }, 400],
  ] as const) assert.equal((await cyc(db, C_FOUNDER, 'POST', q('/narrative-versions'), b)).status, status, JSON.stringify(b));

  // Edit: the deck states $2M; once an active round records $5M, the check finds it.
  db.exec(`UPDATE projects SET funding_needed = 2000000 WHERE id = ${C_P}`);
  db.exec(`INSERT INTO raise_rounds (uid, project_id, name, status, target_amount) VALUES ('rr-k', ${C_P}, 'Seed', 'active', 5000000)`);
  const e = await cyc(db, C_FOUNDER, 'PATCH', q('/narrative-versions/1'), { ask: 'Raising $2,500,000', why_now: 'Prices fell' });
  assert.equal(e.status, 200, e.raw);
  assert.ok(e.body.mismatches.length >= 1, 'the check ran again');
  assert.equal(n(db, `SELECT COUNT(*) AS n FROM narrative_checks WHERE project_id = ${C_P} AND version = 1`), e.body.mismatches.length);
  assert.equal(words(1)['ask.title'], 'Raising $2,500,000');
  assert.equal(meta(1).why_now, 'Prices fell');
  const sf = await cyc(db, C_FOUNDER, 'PATCH', q('/narrative-versions/1'), { start_from: 'blank', why_now: 'Changed' });
  assert.deepEqual([sf.status, sf.body.detail], [400, 'Start from is set when the version is made']);
  assert.equal(meta(1).why_now, 'Prices fell', 'a refused edit changes nothing');
  assert.equal((await cyc(db, C_FOUNDER, 'PATCH', q('/narrative-versions/1'), { based_on_version: 2 })).status, 400, 'based on a later version');
  assert.equal((await cyc(db, C_FOUNDER, 'PATCH', q('/narrative-versions/9'), { why_now: 'x' })).status, 404);
  assert.deepEqual(logs(db, "entity_type = 'raise.investor-narrative'").map((r) => [r.entity_id, r.action]),
    [['1', 'narrative_version_created'], ['2', 'narrative_version_created'], ['3', 'narrative_version_created'], ['4', 'narrative_version_created'], ['1', 'narrative_version_updated']]);
});

test('9: the consistency check reads Why now: a figure stated only there is checked against the metrics', async () => {
  const db = cycleFixture();
  db.exec(`INSERT INTO raise_rounds (uid, project_id, name, status, target_amount) VALUES ('rr-k', ${C_P}, 'Seed', 'active', 5000000)`);
  const v = await cyc(db, C_FOUNDER, 'POST', q('/narrative-versions'), { investor_type: 'angel', start_from: 'blank', why_now: 'We are raising $2M before the tariff change' });
  assert.equal(v.status, 201, v.raw);
  assert.deepEqual(v.body.mismatches.map((m: any) => [m.figure, m.stated_value, m.stated_source, m.metric_value]),
    [['raise', 2_000_000, 'Narrative · why_now', 5_000_000]]);
  // The same words anywhere else in the version would be checked too; with Why now cleared there is nothing left to compare.
  const e = await cyc(db, C_FOUNDER, 'PATCH', q(`/narrative-versions/${v.body.version}`), { why_now: 'Tariffs change in March' });
  assert.deepEqual(e.body.mismatches, []);
});

test('6 (route): New link through the cycle stores its investor and settings, returns the link once, and logs it', async () => {
  const db = cycleFixture();
  db.exec(`INSERT INTO raise_prospects (id, uid, project_id, name, stage) VALUES (7, 'rp-k', ${C_P}, 'Harbour Angels', 'meeting')`);
  const r = await cyc(db, C_FOUNDER, 'POST', q('/deck-links'), { deck_id: 5, investor_label: 'Kite Partner', expires_days: null, allow_download: false, allow_forwarding: false });
  assert.equal(r.status, 201, r.raw);
  assert.match(r.body.share_path, /^\/share\/deck\/.{20,}$/);
  const token = r.body.share_path.slice('/share/deck/'.length);
  const row = db.prepare('SELECT * FROM pitch_deck_share_tokens WHERE id = ?').get(r.body.id) as any;
  assert.deepEqual([row.investor_label, row.prospect_id, row.expires_at, row.allow_download, row.allow_forwarding, row.created_by],
    ['Kite Partner', null, SHARE_NEVER_EXPIRES, 0, 0, C_FOUNDER]);
  assert.equal(row.token_hash, createHash('sha256').update(token).digest('hex'));
  const list = await cyc(db, C_FOUNDER, 'GET', q('/modules/pitch-deck'));
  assert.ok(!list.raw.includes(token), 'no read returns the raw link again');
  const byProspect = await cyc(db, C_FOUNDER, 'POST', q('/deck-links'), { deck_id: 5, prospect_id: 7, expires_days: 7 });
  assert.equal(byProspect.status, 201);
  assert.equal((db.prepare('SELECT prospect_id FROM pitch_deck_share_tokens WHERE id = ?').get(byProspect.body.id) as any).prospect_id, 7);
  for (const b of [
    { deck_id: 5, expires_days: 7 }, { deck_id: 5, prospect_id: 7, investor_label: 'Kite Partner', expires_days: 7 },
    { deck_id: 5, investor_label: 'Kite Partner', expires_days: 5 }, { deck_id: 5, investor_label: 'Kite Partner' },
    { deck_id: 5, investor_label: 'Kite Partner', expires_days: 7, allow_download: 'no' },
  ]) assert.equal((await cyc(db, C_FOUNDER, 'POST', q('/deck-links'), b)).status, 400, JSON.stringify(b));
  // The share route's plan gate (decision 13): a free account on the same venture is refused, and nothing is written.
  const free = await cyc(db, C_FREE, 'POST', q('/deck-links'), { deck_id: 5, investor_label: 'Kite Partner', expires_days: 7 });
  assert.equal(free.status, 402);
  assert.deepEqual(free.body, tierUpsell('studio'));
  assert.equal(n(db, `SELECT COUNT(*) AS n FROM pitch_deck_share_tokens WHERE deck_id = 5`), 2);
  assert.deepEqual(logs(db, "entity_type = 'raise.pitch-deck'").map((x) => [x.entity_id, x.action, x.details]), [
    [String(r.body.id), 'deck_link_created', 'Link created; never expires'],
    [String(byProspect.body.id), 'deck_link_created', `Link created; expires ${String((db.prepare('SELECT expires_at FROM pitch_deck_share_tokens WHERE id = ?').get(byProspect.body.id) as any).expires_at).slice(0, 10)}`],
  ]);
});

test('6 (route): a link made through /api/decks/:id/share logs the same row', async () => {
  const db = cycleFixture();
  const r = await cyc(db, C_FOUNDER, 'POST', '/api/decks/5/share', { expires_in_hours: 24 });
  assert.equal(r.status, 200, r.raw);
  assert.deepEqual(logs(db, "entity_type = 'raise.pitch-deck'").map((x) => [x.project_id, x.entity_id, x.action]), [[C_P, String(r.body.id), 'deck_link_created']]);
});

test('6 (route): an edit can bring the expiry forward, never extend it; it changes the investor and the settings', async () => {
  const db = cycleFixture();
  const mk = async (expires_days: number | null) => (await cyc(db, C_FOUNDER, 'POST', q('/deck-links'), { deck_id: 5, investor_label: 'Kite Partner', expires_days })).body.id;
  const week = await mk(7), never = await mk(null);
  assert.equal((await cyc(db, C_FOUNDER, 'PATCH', q(`/deck-links/${week}`), { expires_days: 30 })).status, 400, 'extending a 7-day link');
  assert.equal((await cyc(db, C_FOUNDER, 'PATCH', q(`/deck-links/${week}`), { expires_days: null })).status, 400, 'Never on a finite link extends it');
  const before = (db.prepare('SELECT expires_at FROM pitch_deck_share_tokens WHERE id = ?').get(week) as any).expires_at;
  const ok = await cyc(db, C_FOUNDER, 'PATCH', q(`/deck-links/${never}`), { expires_days: 14, allow_forwarding: false, investor_label: 'Juno Capital' });
  assert.equal(ok.status, 200, ok.raw);
  const row = db.prepare('SELECT expires_at, allow_forwarding, investor_label FROM pitch_deck_share_tokens WHERE id = ?').get(never) as any;
  assert.notEqual(row.expires_at, SHARE_NEVER_EXPIRES);
  assert.deepEqual([row.allow_forwarding, row.investor_label], [0, 'Juno Capital']);
  assert.equal((db.prepare('SELECT expires_at FROM pitch_deck_share_tokens WHERE id = ?').get(week) as any).expires_at, before, 'a refused edit changes nothing');
  assert.equal((await cyc(db, C_FOUNDER, 'PATCH', q(`/deck-links/${never}`), {})).status, 400);
  assert.deepEqual(logs(db, "action = 'deck_link_updated'").map((x) => [x.entity_id, x.details]), [[String(never), 'Link edited: investor, forwarding off, expiry']]);
});

test('10 (route): Add holder and Edit holder go through addHolder() and updateHolder(), and each logs one row', async () => {
  const db = cycleFixture();
  db.exec(`INSERT INTO raise_prospects (id, uid, project_id, name, stage) VALUES (7, 'rp-k', ${C_P}, 'Harbour Angels', 'committed')`);
  const f = await cyc(db, C_FOUNDER, 'POST', q('/holders'), {
    name: 'Ines Duarte', group: 'Founders', instrument: 'Common', ownership_pct: 40,
    vesting: { start_date: '2026-01-01', total_months: 48, cliff_months: 12 },
  });
  assert.equal(f.status, 201, f.raw);
  assert.match(f.body.id, /^h-[1-9][0-9]*$/);
  const holderId = Number(f.body.id.slice(2));
  assert.equal((db.prepare('SELECT project_id FROM cap_table_holders WHERE id = ?').get(holderId) as any).project_id, C_P);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM cap_table_vesting WHERE holder_id = ?', holderId), 1);
  const s = await cyc(db, C_FOUNDER, 'POST', q('/holders'), { name: 'Harbour Angels', group: 'investors', instrument: 'Convertible note', amount_cents: 250_000_00, cap_cents: 8_000_000_00, prospect_id: 7 });
  assert.equal(s.status, 201, s.raw);
  assert.match(s.body.id, /^e-[1-9][0-9]*$/);
  const safe = stored(db).safes.find((x: any) => x.key === s.body.id);
  assert.deepEqual([safe.instrument, safe.amount, safe.prospect_id], ['note', 250_000, 7]);

  // 2 (ids): the founder reads as h-<register id> in the Raise list, and no id holds a name.
  const list = await cyc(db, C_FOUNDER, 'GET', q('/modules/cap-table'));
  const ids = list.body.records.rows.map((r: any) => r.id);
  assert.ok(ids.includes(f.body.id), JSON.stringify(ids));
  for (const id of ids.filter(Boolean)) { assert.match(id, /^[a-z0-9][a-z0-9_-]*$/); assert.doesNotMatch(id, NAMES); }

  const e = await cyc(db, C_FOUNDER, 'PATCH', q(`/holders/${f.body.id}`), { shares: 3_000_000 });
  assert.equal(e.status, 200, e.raw);
  assert.equal((db.prepare('SELECT shares FROM cap_table_holders WHERE id = ?').get(holderId) as any).shares, 3_000_000);
  for (const [group, instrument] of [['option_pool', 'options'], ['advisors', 'common'], ['founders', 'options'], ['investors', 'preferred']]) {
    assert.equal((await cyc(db, C_FOUNDER, 'POST', q('/holders'), { name: 'Juno', group, instrument, shares: 5 })).status, 400, `${group} · ${instrument}`);
  }
  assert.equal((await cyc(db, C_FOUNDER, 'PATCH', q(`/holders/${f.body.id}`), { group: 'investors' })).status, 400);
  assert.equal((await cyc(db, C_FOUNDER, 'PATCH', q('/holders/pool'), { shares: 5 })).status, 404);
  const was = { h: n(db, 'SELECT COUNT(*) AS n FROM cap_table_holders'), l: n(db, 'SELECT COUNT(*) AS n FROM activity_logs') };
  const free = await cyc(db, C_FREE, 'POST', q('/holders'), { name: 'Juno', group: 'founders', instrument: 'common', shares: 5 });
  assert.equal(free.status, 402, 'the tool\'s plan gate, through addHolder() itself');
  assert.equal((await cyc(db, C_FREE, 'PATCH', q(`/holders/${f.body.id}`), { shares: 5 })).status, 402);
  assert.deepEqual({ h: n(db, 'SELECT COUNT(*) AS n FROM cap_table_holders'), l: n(db, 'SELECT COUNT(*) AS n FROM activity_logs') }, was, 'no holder and no log row');
  assert.deepEqual(logs(db, "entity_type = 'raise.cap-table'").map((x) => [x.entity_id, x.action, x.details]), [
    [f.body.id, 'holder_created', 'Holder added: Founders · Common'],
    [s.body.id, 'holder_created', 'Holder added: Investors · Convertible note'],
    [f.body.id, 'holder_updated', 'Holder edited: shares'],
  ]);
});

test('11: Edit split round-trips the five sections, the milestones and the runway, keeps milestone_costs, and refuses a split off 100', async () => {
  const db = cycleFixture();
  db.prepare('UPDATE projects SET use_of_funds_meta = ? WHERE id = ?').run(JSON.stringify({ milestone_costs: { m1: { bucket: 'eng', cost: 5000 } }, deck_synced_at: '2026-10-01T00:00:00Z' }), C_P);
  const body = {
    amount_to_raise_cents: 2_000_000_00, runway_months: 20,
    sections: [
      { key: 'product', pct: 40, milestone_label: 'Ship the pilot', milestone_by: '2027-06' }, { key: 'go-to-market', pct: 30 },
      { key: 'infrastructure', pct: 10 }, { key: 'operations', pct: 10 }, { key: 'reserve', pct: 10 },
    ],
  };
  const r = await cyc(db, C_FOUNDER, 'PUT', q('/use-of-funds'), body);
  assert.equal(r.status, 200, r.raw);
  const p = db.prepare('SELECT use_of_funds, funding_needed, use_of_funds_meta FROM projects WHERE id = ?').get(C_P) as any;
  assert.deepEqual(JSON.parse(p.use_of_funds), [
    { label: 'Product & engineering', pct: 40 }, { label: 'GTM: sales and marketing', pct: 30 }, { label: 'Infrastructure & data', pct: 10 },
    { label: 'Operations, legal & compliance', pct: 10 }, { label: 'Hiring / runway reserve', pct: 10 },
  ], 'the stored labels, in the page\'s order');
  assert.equal(p.funding_needed, 2_000_000, 'the column\'s dollars');
  const meta = JSON.parse(p.use_of_funds_meta);
  assert.deepEqual(meta.milestone_costs, { m1: { bucket: 'eng', cost: 5000 } }, 'other keys are kept');
  assert.equal(meta.runway_months, 20);
  assert.deepEqual(meta.milestones, { product: { label: 'Ship the pilot', by: '2027-06' } });
  assert.equal(meta.deck_synced_at, null, 'a change marks the deck out of sync');
  const rows = Object.fromEntries((await cyc(db, C_FOUNDER, 'GET', q('/modules/use-of-funds'))).body.records.rows.map((x: any) => [x.id, x.cells]));
  assert.equal(rows.product.amount, 800_000);
  assert.equal(rows.product.monthly, 40_000, 'monthly is amount ÷ runway');
  assert.equal(rows.product.milestone, 'Ship the pilot by 2027-06');

  const off = { ...body, sections: body.sections.map((s) => (s.key === 'reserve' ? { ...s, pct: 5 } : s)) };
  const bad = await cyc(db, C_FOUNDER, 'PUT', q('/use-of-funds'), off);
  assert.deepEqual([bad.status, bad.body.detail], [400, 'Use of Funds must total exactly 100%.']);
  for (const b of [
    { sections: [{ key: 'marketing', pct: 100 }] }, { sections: [{ key: 'product', pct: 50 }, { key: 'product', pct: 50 }] },
    { ...body, runway_months: 0 }, { ...body, amount_to_raise_cents: 12.5 },
    { sections: [{ key: 'product', pct: 100, milestone_label: 'x', milestone_by: 'soon' }] },
  ]) assert.equal((await cyc(db, C_FOUNDER, 'PUT', q('/use-of-funds'), b)).status, 400, JSON.stringify(b));
  assert.equal((db.prepare('SELECT use_of_funds_meta FROM projects WHERE id = ?').get(C_P) as any).use_of_funds_meta, p.use_of_funds_meta, 'a refused split writes nothing');
  assert.deepEqual(logs(db, "entity_type = 'raise.use-of-funds'").map((x) => x.entity_id), ['product', 'go-to-market', 'infrastructure', 'operations', 'reserve']);
});

test('12: Add investor stores Identified as to_contact, a fund by its name, answers a duplicate with 409, and never takes a withdrawn fund', async () => {
  const db = cycleFixture();
  const a = await cyc(db, C_FOUNDER, 'POST', q('/prospects'), { name: 'Northwind Angels', stage: 'Identified', warm_path: 'Via a cofounder', next_step: 'Intro', next_step_due: '2026-11-02' });
  assert.equal(a.status, 201, a.raw);
  const row = db.prepare('SELECT * FROM raise_prospects WHERE id = ?').get(a.body.id) as any;
  assert.deepEqual([row.project_id, row.name, row.stage, row.warm_path, row.next_step, row.next_step_due], [C_P, 'Northwind Angels', 'to_contact', 'Via a cofounder', 'Intro', '2026-11-02']);
  const fund = await cyc(db, C_FOUNDER, 'POST', q('/prospects'), { research_fund_uid: 'alder-ventures', stage: 'contacted' });
  assert.equal(fund.status, 201, fund.raw);
  const fr = db.prepare('SELECT name, firm, research_fund_uid, stage FROM raise_prospects WHERE id = ?').get(fund.body.id) as any;
  assert.deepEqual({ ...fr }, { name: 'Alder Ventures', firm: 'Alder Ventures', research_fund_uid: 'alder-ventures', stage: 'contacted' });
  const was = n(db, 'SELECT COUNT(*) AS n FROM raise_prospects');
  assert.equal((await cyc(db, C_FOUNDER, 'POST', q('/prospects'), { research_fund_uid: 'withdrawn-fund' })).status, 404, 'a fund from a not-allowed list');
  assert.equal((await cyc(db, C_FOUNDER, 'POST', q('/prospects'), { research_fund_uid: 'no-such-fund' })).status, 404);
  db.exec(`INSERT INTO raise_prospects (uid, project_id, name, email, stage) VALUES ('rp-dup', ${C_P}, 'Harbour Angels', 'deals@harbour.example.test', 'meeting')`);
  const dup = await cyc(db, C_FOUNDER, 'POST', q('/prospects'), { name: 'Harbour Again', email: 'Deals@Harbour.example.test' });
  assert.equal(dup.status, 409, 'createProspect\'s own duplicate answer');
  for (const b of [{ name: 'Juno', stage: 'hot' }, { stage: 'meeting' }, { name: 'Juno', next_step_due: 'Friday' }]) {
    assert.equal((await cyc(db, C_FOUNDER, 'POST', q('/prospects'), b)).status, 400, JSON.stringify(b));
  }
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM raise_prospects'), was + 1, 'only the fixture\'s duplicate row was added');

  const e = await cyc(db, C_FOUNDER, 'PATCH', q(`/prospects/${a.body.id}`), { stage: 'passed', notes: 'Not this fund', next_step: '' });
  assert.equal(e.status, 200, e.raw);
  assert.deepEqual({ ...(db.prepare('SELECT stage, notes, next_step FROM raise_prospects WHERE id = ?').get(a.body.id) as any) }, { stage: 'passed', notes: 'Not this fund', next_step: null });
  assert.equal((await cyc(db, C_FOUNDER, 'PATCH', q(`/prospects/${a.body.id}`), { email: 'deals@harbour.example.test' })).status, 409);
  assert.equal((await cyc(db, C_FOUNDER, 'PATCH', q(`/prospects/${a.body.id}`), { research_fund_uid: 'withdrawn-fund' })).status, 404);
  assert.equal((await cyc(db, C_FOUNDER, 'PATCH', q(`/prospects/${a.body.id}`), {})).status, 400);
  assert.deepEqual(logs(db, "entity_type = 'raise.capital-relationships'").map((x) => [x.entity_id, x.action, x.details]), [
    [String(a.body.id), 'prospect_created', 'Investor added at Identified'],
    [String(fund.body.id), 'prospect_created', 'Investor added at Contacted'],
    [String(a.body.id), 'prospect_updated', 'Investor edited: next step, stage, notes'],
  ]);
});

test('13: every write logs its record\'s row — project, raise.<slug>, the record id — with no person\'s name; old rows are unchanged', async () => {
  const db = cycleFixture();
  db.exec(`INSERT INTO activity_logs (id, action, details, actor, user_id, project_id) VALUES (1, 'raise.readiness.rescored', '6 computed checks', 'user:${C_FOUNDER}', ${C_FOUNDER}, ${C_P})`);
  const old = { ...(db.prepare('SELECT * FROM activity_logs WHERE id = 1').get() as any) };
  db.exec(`INSERT INTO data_room_files (id, uid, project_id, name, r2_key) VALUES (4, 'x4', ${C_P}, 'Harbour side letter.pdf', 'k4')`);
  const writes: Array<[string, string, unknown]> = [
    ['PUT', '/readiness/team', { score: 6, evidence: 'pattern', missing: 'Ines Duarte as CTO' }],
    ['POST', '/readiness/rescore', { items: ['deck'] }],
    ['POST', '/narrative-versions', { investor_type: 'angel', one_liner: 'Pitched to Harbour' }],
    ['PATCH', '/narrative-versions/1', { why_now: 'Northwind asked' }],
    ['POST', '/deck-links', { deck_id: 5, investor_label: 'Kite Partner', expires_days: 7 }],
    ['POST', '/holders', { name: 'Ines Duarte', group: 'founders', instrument: 'common', shares: 1_000_000 }],
    ['PUT', '/use-of-funds', { sections: [{ key: 'product', pct: 100 }] }],
    ['POST', '/prospects', { name: 'Northwind Angels' }],
    ['PUT', '/data-room/files/4/checklist', { item: 'incorporation' }],
  ];
  for (const [m, path, b] of writes) {
    const before = n(db, 'SELECT COUNT(*) AS n FROM activity_logs');
    const r = await cyc(db, C_FOUNDER, m, q(path), b);
    assert.ok(r.status >= 200 && r.status < 300, `${m} ${path}: ${r.raw}`);
    assert.equal(n(db, 'SELECT COUNT(*) AS n FROM activity_logs') - before, 1, `${m} ${path} logs one row`);
  }
  const rows = logs(db, 'id > 1');
  for (const r of rows) {
    assert.equal(r.project_id, C_P);
    assert.equal(r.user_id, C_FOUNDER);
    assert.match(r.entity_type, /^raise\.(fundraising-readiness|investor-narrative|pitch-deck|data-room|cap-table|use-of-funds|capital-relationships)$/);
    assert.match(r.entity_id, /^[a-z0-9][a-z0-9_-]*$/);
    assert.doesNotMatch(r.details, NAMES, `${r.action}: ${r.details}`);
  }
  assert.deepEqual(rows.map((r) => `${r.entity_type}/${r.entity_id}`), [
    'raise.fundraising-readiness/team', 'raise.fundraising-readiness/deck', 'raise.investor-narrative/1', 'raise.investor-narrative/1',
    `raise.pitch-deck/${(db.prepare('SELECT MAX(id) AS id FROM pitch_deck_share_tokens').get() as any).id}`,
    `raise.cap-table/h-${(db.prepare(`SELECT MAX(id) AS id FROM cap_table_holders`).get() as any).id}`,
    'raise.use-of-funds/product', `raise.capital-relationships/${(db.prepare('SELECT MAX(id) AS id FROM raise_prospects').get() as any).id}`,
    'raise.data-room/4',
  ]);
  assert.deepEqual({ ...(db.prepare('SELECT * FROM activity_logs WHERE id = 1').get() as any) }, old, 'an old row is read as it is, never rewritten');
});

test('13 (data room): the upload and the file edit each log one row on the file\'s record, naming no file', async () => {
  const db = roomFixture();
  const data = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 x').toString('base64')}`;
  const up = await roomCall(dataRoom, db, R_FOUNDER, 'POST', '/p-room/files', { name: 'Harbour term sheet.pdf', data, access_tier: 'committed' });
  assert.equal(up.status, 201, up.raw);
  const id = (db.prepare('SELECT id FROM data_room_files WHERE uid = ?').get(up.body.uid) as any).id;
  const p = await roomCall(dataRoom, db, R_FOUNDER, 'PATCH', `/p-room/files/${up.body.uid}`, { name: 'Northwind term sheet.pdf', access_tier: 'nobody' });
  assert.equal(p.status, 200, p.raw);
  const rows = db.prepare('SELECT project_id, user_id, entity_type, entity_id, action, details FROM activity_logs ORDER BY id').all() as any[];
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { project_id: ROOM, user_id: R_FOUNDER, entity_type: 'raise.data-room', entity_id: String(id), action: 'file_uploaded', details: 'File uploaded; access committed' },
    { project_id: ROOM, user_id: R_FOUNDER, entity_type: 'raise.data-room', entity_id: String(id), action: 'file_updated', details: 'File edited: name, access tier' },
  ]);
  assert.equal((await roomCall(dataRoom, db, R_FOUNDER, 'PATCH', '/p-room/files/no-such', { name: 'x' })).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get().n, 2, 'a refused edit logs nothing');
});

// ---------------------------------------------------------------------------
// #1700's third PR — step 6's action writers, called directly. The closing PR
// declares them on services/records/raise.ts's records and drives them
// through the action route.
// ---------------------------------------------------------------------------

import {
  duplicateNarrativeVersion, revokeDeckLink, addSectionHire, logProspectEvent, addProspectFeedback, markProspectPassed,
  saveNarrativeVersion, WriterError as RaiseWriterError,
} from '../src/services/raiseWriters.ts';
import { replaceDataRoomFile, removeDataRoomFile } from '../src/routes/data_room.ts';

async function refused2(p: Promise<unknown>): Promise<{ status: number; sentence: string }> {
  try { await p; } catch (e: any) {
    if (e instanceof RaiseWriterError) return { status: e.status, sentence: e.sentence };
    throw e;
  }
  return assert.fail('the write was not refused');
}
const rows = (db: DatabaseSync, sql: string, ...args: any[]) => db.prepare(sql).all(...args) as any[];

test('9 (duplicate): the next version, based on this one, for its investor type, with its words; a venture-B version answers 404', async () => {
  const db = cycleFixture();
  const env = envOf(db);
  const v1 = await saveNarrativeVersion(env, { projectId: C_P, userId: C_FOUNDER, investorType: 'seed_fund', startFrom: 'blank', oneLiner: 'Grid batteries for cold towns' });
  const before = n(db, 'SELECT COUNT(*) AS n FROM activity_logs');
  const v2 = await duplicateNarrativeVersion(env, { projectId: C_P, userId: C_FOUNDER, version: v1.version });
  assert.equal(v2.version, 2);
  const meta = db.prepare('SELECT start_from, based_on_version FROM narrative_version_meta WHERE project_id = ? AND version = 2').get(C_P) as any;
  assert.deepEqual({ ...meta }, { start_from: 'version', based_on_version: 1 });
  assert.equal((db.prepare("SELECT value FROM spinout_deck_overrides WHERE project_id = ? AND version = 2 AND field_key = 'cover.thesis'").get(C_P) as any).value, 'Grid batteries for cold towns');
  assert.equal((db.prepare('SELECT investor_type FROM spinout_deck_overrides WHERE project_id = ? AND version = 2 LIMIT 1').get(C_P) as any).investor_type, 'seed_fund');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM activity_logs') - before, 1, 'one row');
  assert.match(logs(db, "action = 'narrative_version_created' AND entity_id = '2'")[0].details, /based on version 1/);
  const was = n(db, 'SELECT COUNT(*) AS n FROM spinout_deck_overrides');
  assert.equal((await refused2(duplicateNarrativeVersion(env, { projectId: C_P, userId: C_FOUNDER, version: 3 }))).status, 404, 'venture B\'s version 3');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM spinout_deck_overrides'), was, 'nothing written');
});

test('6 (revoke): the link is withdrawn and its views kept; a venture-B link answers 404; one row is logged', async () => {
  const db = cycleFixture();
  const env = envOf(db);
  const made = await cyc(db, C_FOUNDER, 'POST', q('/deck-links'), { deck_id: 5, investor_label: 'Kite Partner', expires_days: null });
  db.prepare('INSERT INTO deck_share_views (share_token_id, deck_id) VALUES (?, 5), (?, 5)').run(made.body.id, made.body.id);
  const out = await revokeDeckLink(env, { projectId: C_P, userId: C_FOUNDER, linkId: made.body.id });
  assert.equal(out.newly_revoked, true);
  const row = db.prepare('SELECT revoked_at, expires_at FROM pitch_deck_share_tokens WHERE id = ?').get(made.body.id) as any;
  assert.ok(row.revoked_at, 'revoked');
  assert.notEqual(row.expires_at, SHARE_NEVER_EXPIRES, 'a Never link expires on revoke');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM deck_share_views WHERE share_token_id = ?', made.body.id), 2, 'the views stay');
  assert.equal((await revokeDeckLink(env, { projectId: C_P, userId: C_FOUNDER, linkId: made.body.id })).newly_revoked, false, 'idempotent');
  assert.deepEqual(logs(db, "action = 'deck_link_revoked'").map((r) => [r.entity_id, r.details]), [[String(made.body.id), 'Link revoked'], [String(made.body.id), 'Link already revoked']]);
  assert.equal((await refused2(revokeDeckLink(env, { projectId: C_P, userId: C_FOUNDER, linkId: B_LINK }))).status, 404);
  assert.equal((db.prepare('SELECT revoked_at FROM pitch_deck_share_tokens WHERE id = ?').get(B_LINK) as any).revoked_at, null, 'B\'s link untouched');
});

test('11 (add hire): a hire on a section; a bad section, month, amount or currency is refused and writes nothing', async () => {
  const db = cycleFixture();
  const env = envOf(db);
  await addSectionHire(env, { projectId: C_P, userId: C_FOUNDER, sectionKey: 'product', body: { role: 'Firmware engineer', start_month: '2027-02', annual_cents: 120_000_00, currency: 'EUR' } });
  assert.deepEqual(rows(db, 'SELECT project_id, category_key, role, start_month, annual_cents, currency, created_by FROM use_of_funds_hires').map((r) => ({ ...r })),
    [{ project_id: C_P, category_key: 'product', role: 'Firmware engineer', start_month: '2027-02', annual_cents: 120_000_00, currency: 'eur', created_by: C_FOUNDER }]);
  assert.deepEqual(logs(db, "entity_type = 'raise.use-of-funds'").map((r) => [r.entity_id, r.action, r.details]), [['product', 'hire_added', 'Hire added: Firmware engineer from 2027-02']]);
  for (const [key, body, status] of [
    ['marketing', { role: 'x' }, 404], ['product', { role: '' }, 400], ['product', { role: 'x', start_month: '2027-13' }, 400],
    ['product', { role: 'x', annual_cents: 12.5 }, 400], ['product', { role: 'x', currency: 'euro' }, 400],
  ] as const) {
    assert.equal((await refused2(addSectionHire(env, { projectId: C_P, userId: C_FOUNDER, sectionKey: key, body }))).status, status, JSON.stringify([key, body]));
  }
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM use_of_funds_hires'), 1);
});

test('12 (log, add feedback, mark passed): each writes its row and logs one; a venture-B prospect answers 404 and nothing is written', async () => {
  const db = cycleFixture();
  const env = envOf(db);
  db.exec(`INSERT INTO raise_prospects (id, uid, project_id, name, stage) VALUES (7, 'rp-k', ${C_P}, 'Harbour Angels', 'meeting')`);
  await logProspectEvent(env, { projectId: C_P, userId: C_FOUNDER, prospectId: 7, body: { kind: 'meeting', note: 'Partner meeting', on: '2026-10-01' } });
  await logProspectEvent(env, { projectId: C_P, userId: C_FOUNDER, prospectId: 7, body: { kind: 'call', on: '2999-01-05' } });
  assert.deepEqual(rows(db, 'SELECT kind, note, due_on, done_at FROM raise_prospect_events ORDER BY id').map((r) => ({ ...r })), [
    { kind: 'meeting', note: 'Partner meeting', due_on: null, done_at: '2026-10-01' },
    { kind: 'call', note: null, due_on: '2999-01-05', done_at: null },
  ], 'a past date is done; a later one is due');
  await addProspectFeedback(env, { projectId: C_P, userId: C_FOUNDER, prospectId: 7, body: { objection: 'Too early for our fund', answer: 'Pilots start in Q1' } });
  assert.deepEqual({ ...(db.prepare('SELECT prospect_id, objection, answer FROM raise_prospect_feedback').get() as any) }, { prospect_id: 7, objection: 'Too early for our fund', answer: 'Pilots start in Q1' });
  await markProspectPassed(env, { projectId: C_P, userId: C_FOUNDER, prospectId: 7 });
  assert.equal((db.prepare('SELECT stage FROM raise_prospects WHERE id = 7').get() as any).stage, 'passed');
  assert.deepEqual(logs(db, "entity_type = 'raise.capital-relationships'").map((r) => [r.entity_id, r.action, r.details]), [
    ['7', 'prospect_event_logged', 'Meeting logged for 2026-10-01'],
    ['7', 'prospect_event_logged', 'Call logged for 2999-01-05'],
    ['7', 'prospect_feedback_added', 'Feedback added'],
    ['7', 'prospect_updated', 'Investor edited: stage'],
  ]);
  for (const [run, status] of [
    [() => logProspectEvent(env, { projectId: C_P, userId: C_FOUNDER, prospectId: 7, body: { kind: 'lunch' } }), 400],
    [() => logProspectEvent(env, { projectId: C_P, userId: C_FOUNDER, prospectId: 7, body: { kind: 'note', on: 'Friday' } }), 400],
    [() => addProspectFeedback(env, { projectId: C_P, userId: C_FOUNDER, prospectId: 7, body: { objection: '  ' } }), 400],
    [() => logProspectEvent(env, { projectId: C_P, userId: C_FOUNDER, prospectId: B_PROSPECT, body: { kind: 'note' } }), 404],
    [() => addProspectFeedback(env, { projectId: C_P, userId: C_FOUNDER, prospectId: B_PROSPECT, body: { objection: 'x' } }), 404],
    [() => markProspectPassed(env, { projectId: C_P, userId: C_FOUNDER, prospectId: B_PROSPECT }), 404],
  ] as const) assert.equal((await refused2(run())).status, status);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM raise_prospect_events'), 2);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM raise_prospect_feedback'), 1);
  assert.equal((db.prepare('SELECT stage FROM raise_prospects WHERE id = ?').get(B_PROSPECT) as any).stage, 'meeting');
});

/** The room fixture with migration 463's versions table, and a store that records puts and deletes. */
function versionedRoom() {
  const db = roomFixture();
  const ddl = /CREATE TABLE IF NOT EXISTS data_room_file_versions \([\s\S]*?\n\);/.exec(sqlOf('463_raise_record_stores.sql'))![0];
  db.exec(stripForeignKeys(ddl));
  const store = { puts: [] as string[], deletes: [] as string[] };
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db),
    FILES: { put: async (k: string) => { store.puts.push(k); }, delete: async (k: string) => { store.deletes.push(k); } } } as any;
  return { db, env, store, project: { id: ROOM, uid: 'p-room' } };
}

test('replace: the current object becomes the next version and the new one takes its place under the room\'s prefix; nothing is deleted', async () => {
  const { db, env, store, project } = versionedRoom();
  const bytes = new TextEncoder().encode('%PDF-1.4 new');
  const out = await replaceDataRoomFile(env, { project, userId: R_FOUNDER, fileId: 31, bytes, contentType: 'application/pdf' });
  assert.deepEqual(out, { id: 31, version: 1, size_bytes: bytes.byteLength });
  const file = db.prepare('SELECT r2_key, size_bytes, uploaded_by_user_id FROM data_room_files WHERE id = 31').get() as any;
  assert.match(file.r2_key, /^data-room\/p-room\/[0-9a-f-]+$/, 'derived, inside the prefix');
  assert.deepEqual(store.puts, [file.r2_key]);
  assert.deepEqual(rows(db, 'SELECT file_id, version, r2_key FROM data_room_file_versions').map((r) => ({ ...r })), [{ file_id: 31, version: 1, r2_key: 'k/open' }], 'the old object is kept as version 1');
  await replaceDataRoomFile(env, { project, userId: R_FOUNDER, fileId: 31, bytes, contentType: 'not a type' });
  assert.deepEqual(rows(db, 'SELECT version FROM data_room_file_versions ORDER BY version').map((r) => r.version), [1, 2]);
  assert.equal((db.prepare('SELECT content_type FROM data_room_files WHERE id = 31').get() as any).content_type, 'application/octet-stream');
  assert.deepEqual(store.deletes, [], 'replace deletes no object');
  assert.deepEqual(rows(db, "SELECT entity_type, entity_id, action, details FROM activity_logs").map((r) => [r.entity_type, r.entity_id, r.action, r.details]), [
    ['raise.data-room', '31', 'file_replaced', 'File replaced; version 1 kept'], ['raise.data-room', '31', 'file_replaced', 'File replaced; version 2 kept'],
  ]);
  const big = new Uint8Array(20 * 1024 * 1024 + 1);
  assert.equal((await refused2(replaceDataRoomFile(env, { project, userId: R_FOUNDER, fileId: 31, bytes: big, contentType: null }))).status, 413);
  assert.equal((await refused2(replaceDataRoomFile(env, { project: { id: 8, uid: 'p-else' }, userId: R_FOUNDER, fileId: 31, bytes, contentType: null }))).status, 404, 'another venture');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM data_room_file_versions'), 2, 'a refused replace writes nothing');
});

test('remove: the file, its versions and every object inside the room\'s prefix go; an object outside it is never deleted; another venture\'s file is null', async () => {
  const { db, env, store, project } = versionedRoom();
  db.exec(`INSERT INTO data_room_file_versions (file_id, version, r2_key) VALUES (31, 1, 'data-room/p-room/v1'), (31, 2, 'elsewhere/v2')`);
  db.exec(`UPDATE data_room_files SET r2_key = 'data-room/p-room/current' WHERE id = 31`);
  assert.equal(await removeDataRoomFile(env, { project: { id: 8, uid: 'p-else' }, userId: R_FOUNDER, fileId: 31 }), null, 'not this venture\'s');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM data_room_files WHERE id = 31'), 1);
  assert.deepEqual(await removeDataRoomFile(env, { project, userId: R_FOUNDER, fileId: 31 }), { id: 31 });
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM data_room_files WHERE id = 31'), 0);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM data_room_file_versions'), 0, 'the versions go with it');
  assert.deepEqual(store.deletes, ['data-room/p-room/current', 'data-room/p-room/v1'], 'every object inside the prefix, none outside');
  assert.deepEqual(rows(db, 'SELECT entity_id, action, details FROM activity_logs').map((r) => [r.entity_id, r.action, r.details]), [['31', 'file_removed', 'File removed with 2 earlier versions']]);
  // The founder's DELETE route goes through the same writer.
  const del = await roomCall(dataRoom, db, R_FOUNDER, 'DELETE', '/p-room/files/f-nda');
  assert.equal(del.status, 200, del.raw);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM data_room_files WHERE uid = 'f-nda'"), 0);
  assert.deepEqual(rows(db, "SELECT entity_id, action FROM activity_logs WHERE action = 'file_removed'").map((r) => r.entity_id), ['31', '32']);
  assert.equal((await roomCall(dataRoom, db, R_FOUNDER, 'DELETE', '/p-room/files/no-such')).status, 404);
});

test('D752: the D691 writer\'s stage change withdraws a committed prospect\'s raise receipt; a notes edit keeps it', async () => {
  const db = cycleFixture();
  db.exec(`INSERT INTO raise_prospects (id, uid, project_id, name, stage, amount) VALUES (77, 'rp-77', ${C_P}, 'Wren Angel', 'committed', 2500)`);
  db.exec(`INSERT INTO mercury_personal_matches (uid, user_id, integration_id, mercury_transaction_id, account_last_four, amount_cents, posted_on, target_kind, target_id)
           VALUES ('m-77', ${C_FOUNDER}, 9, 'txn-77', '4242', 250000, '2026-10-02', 'raise_prospect', 77)`);
  const state = () => (db.prepare("SELECT state, withdraw_reason FROM mercury_personal_matches WHERE uid = 'm-77'").get() as any);
  assert.equal((await cyc(db, C_FOUNDER, 'PATCH', q('/prospects/77'), { notes: 'Wired on Friday' })).status, 200);
  assert.equal(state().state, 'confirmed', 'a notes edit leaves it');
  assert.equal((await cyc(db, C_FOUNDER, 'PATCH', q('/prospects/77'), { stage: 'passed' })).status, 200);
  assert.deepEqual({ ...state() }, { state: 'withdrawn', withdraw_reason: "The prospect's amount or stage changed after the match (D752)." });
});


test('#2445: computed scores and measured personal evidence are refused without writing', async () => {
  const db = cycleFixture();
  try {
    for (const key of ['narrative','deck','data_room','cap_table','use_of_funds','traction']) {
      const r = await cyc(db,C_FOUNDER,'PUT',q('/readiness/'+key),{score:10,evidence:'pattern'});
      assert.equal(r.status,400,key);
    }
    assert.equal((await cyc(db,C_FOUNDER,'PUT',q('/readiness/team'),{score:10,evidence:'measured'})).status,400);
    assert.equal(n(db,'SELECT COUNT(*) AS n FROM readiness_scores'),0);
    assert.equal((await cyc(db,C_FOUNDER,'PUT',q('/readiness/team'),{score:6,evidence:'pattern'})).status,200);
    assert.equal(n(db,"SELECT COUNT(*) AS n FROM readiness_scores WHERE source='manual' AND evidence='pattern'"),1);
  } finally { db.close(); }
});


test('#2445: a hidden newer manual override cannot suppress since-last rescoring',async()=>{
 const db=cycleFixture();
 try{
  assert.equal((await cyc(db,C_FOUNDER,'POST',q('/readiness/rescore'),{items:['deck']})).status,200);
  db.exec("UPDATE readiness_scores SET scored_at='2026-01-01'; UPDATE pitch_decks SET created_at='2025-12-01'");
  db.exec("INSERT INTO pitch_decks(project_id,version,slides,created_at) VALUES(1,99,'[]','2026-02-01')");
  db.exec("INSERT INTO readiness_scores(item_id,project_id,score,evidence,missing,source,scored_at) SELECT item_id,project_id,score,'pattern',missing,'manual','2026-03-01' FROM readiness_scores LIMIT 1");
  const r=await cyc(db,C_FOUNDER,'POST',q('/readiness/rescore'),{items:['deck'],since:'last'});
  assert.equal(r.status,200);assert.deepEqual(r.body.items,['deck']);
 }finally{db.close();}
});


test('#2691: copies preserve version metadata, explicit overrides win, and saving never claims deck use',async()=>{
 const db=cycleFixture(); const env=envOf(db);
 try {
  db.exec(`INSERT INTO pitch_decks(project_id,version,slides) VALUES(${C_P},77,'[]')`);
  const original=await saveNarrativeVersion(env,{projectId:C_P,userId:C_FOUNDER,investorType:'angel',startFrom:'blank',oneLiner:'A story',whyNow:'Timing matters',checkAgainst:['metrics']});
  const based=await saveNarrativeVersion(env,{projectId:C_P,userId:C_FOUNDER,investorType:'seed_fund',startFrom:'version',basedOnVersion:original.version});
  const duplicate=await duplicateNarrativeVersion(env,{projectId:C_P,userId:C_FOUNDER,version:original.version});
  for(const v of [based.version,duplicate.version]) {
   assert.deepEqual({...db.prepare('SELECT why_now,check_against_json FROM narrative_version_meta WHERE project_id=? AND version=?').get(C_P,v)}, {why_now:'Timing matters',check_against_json:'["metrics"]'});
   assert.equal(db.prepare('SELECT deck_version FROM spinout_deck_overrides WHERE project_id=? AND version=? LIMIT 1').get(C_P,v)?.deck_version,null);
  }
  const override=await saveNarrativeVersion(env,{projectId:C_P,userId:C_FOUNDER,investorType:'angel',startFrom:'version',basedOnVersion:original.version,whyNow:null,checkAgainst:['deck']});
  assert.deepEqual({...db.prepare('SELECT why_now,check_against_json FROM narrative_version_meta WHERE project_id=? AND version=?').get(C_P,override.version)}, {why_now:null,check_against_json:'["deck"]'});
  assert.equal(logs(db,"entity_type='raise.investor-narrative'").length,4,'one cycle write per save/duplicate');
 }finally{db.close();}
});
