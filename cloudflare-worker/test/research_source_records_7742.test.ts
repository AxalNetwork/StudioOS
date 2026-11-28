/**
 * D7742 (#7742) — the Research imports staging store, on real SQLite built from main's schema plus this migration.
 *
 * Invented records only (reserved example domains). MARK is planted in every invented value; the privacy tests
 * show it appears nowhere outside a stored body, and a withheld value appears nowhere at all.
 *
 * Run alone:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/research_source_records_7742.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import {
  LIMITS, SQL, SourceStoreRefusal, bodyJson, membershipDigest, openRun, planChunk, reconcileChunk, removePrivateFields,
  removeRecord, removeSource, liftRemoval, sealRun, sha256Hex, writeChunk,
  type HashRecipe, type Manifest, type SourceRecordInput,
} from '../src/services/researchSourceRecords.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATION = 'cloudflare-worker/sql/migrations/202611220322_7742_research_source_records.sql';
const MARK = 'QXMARK7742';
const NOW = new Date('2026-11-22T03:30:00Z');
const ENV = { JWT_SECRET: 'test-only-secret-not-a-real-key-0123456789', ENVIRONMENT: 'test' } as never;
const COLUMNS = ['name', 'website', 'notes', 'stages', 'active', 'founded', 'email'];

function freshDb() {
  const raw = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(raw);
  raw.exec('PRAGMA foreign_keys = ON');
  const DB = d1Over(raw) as unknown as D1Database & { prepared: string[] };
  const prepare = DB.prepare.bind(DB);
  DB.prepared = [];
  (DB as { prepare: unknown }).prepare = (sql: string) => { DB.prepared.push(sql); return prepare(sql); };
  return { raw, DB };
}

/** A record with a blank, a null, long text, an ordered list and an unchecked box; email is a contact column. */
function record(id: string, over: Partial<Record<string, unknown>> = {}): SourceRecordInput {
  const cells: Array<[string, unknown]> = [
    ['name', `Example Fund ${id} ${MARK}`],
    ['website', `https://fund-${id}.example.org/${MARK}`],
    ['notes', `  Long text with ${MARK}, kept exactly as recorded: ${'x'.repeat(2000)}  `],
    ['stages', ['Seed', `Series A ${MARK}`]],
    ['active', false],
    ['founded', ''],
    ['email', `person-${id}-${MARK}@example.com`],
  ];
  const out = cells.filter(([n]) => !(n in over && over[n] === undefined)).map(([n, v]) => [n, n in over ? over[n] : v]) as Array<[string, never]>;
  return { source_key: 'invented_funds', provider_record_id: id, stated_row_hash: `h-${id}`, captured_at: '2026-11-19', cells: out };
}

const classes = {
  invented_funds: {
    name: { class: 'fact', role: 'name' }, website: { class: 'fact', role: 'website' }, notes: { class: 'prose' },
    stages: { class: 'fact' }, active: { class: 'fact' }, founded: { class: 'fact' }, email: { class: 'contact' },
  },
} as const;

async function manifestFor(records: SourceRecordInput[], extra: Partial<Manifest['sources'][0]> = {}): Promise<Manifest> {
  return { sources: [{ source_key: 'invented_funds', columns: COLUMNS, expected_records: records.length,
    expected_cells: records.length * COLUMNS.length, digest: await membershipDigest(records), ...extra }] };
}

let key = 0;
async function open(DB: D1Database, records: SourceRecordInput[], over: Record<string, unknown> = {}) {
  key++;
  return openRun(DB, { idempotencyKey: `run-key-${key}-0000`, actorUserId: 42, payloadSha256: 'a'.repeat(64),
    hashRecipeId: null, manifest: await manifestFor(records), columnClasses: classes as never, now: NOW, ...over });
}

const rowsOf = (raw: DatabaseSync, table: string) => raw.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;

test('the migration builds every table with its keys, CHECKs and trigger; the run row has no cascade from users', () => {
  const { raw } = freshDb();
  const tables = (raw.prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'research_source_%' ORDER BY name`).all() as Array<{ name: string }>).map((r) => r.name);
  // #7746 adds the two mapping tables (D7746), also named research_source_* so the privacy check below covers them.
  assert.deepEqual(tables, ['research_source_column_rules', 'research_source_flags', 'research_source_link_history', 'research_source_private_fields',
    'research_source_record_links', 'research_source_records', 'research_source_removals', 'research_source_run_records', 'research_source_runs']);
  for (const banned of ['research_source_imports', 'research_source_mappings', 'research_source_rules', 'research_source_promotions']) assert.ok(!tables.includes(banned));
  assert.deepEqual(raw.prepare(`PRAGMA foreign_key_list(research_source_runs)`).all(), [], 'no foreign key on the run, so no cascade from users');
  const uniq = raw.prepare(`SELECT sql FROM sqlite_schema WHERE name = 'research_source_records'`).get() as { sql: string };
  assert.match(uniq.sql, /UNIQUE \(source_key, provider_record_id, stated_row_hash\)/);
  const cascade = raw.prepare(`PRAGMA foreign_key_list(research_source_private_fields)`).all() as Array<{ on_delete: string }>;
  assert.equal(cascade[0].on_delete, 'CASCADE');
  assert.ok(raw.prepare(`SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='research_source_records_no_update'`).get());
  raw.exec(`INSERT INTO research_source_runs (uid, idempotency_key, payload_sha256, manifest_json, started_at)
    VALUES ('u1', 'k-00000001', '${'a'.repeat(64)}', '{}', 'x')`);
  const rule = (cls: string, handling: string, serve: number) => `INSERT INTO research_source_column_rules (source_key, column_name,
    column_order, class, contact_handling, serve, fixed_at, fixed_by_run_uid) VALUES ('s', '${cls}-${serve}', 0, '${cls}', ${handling}, ${serve}, 'x', 'u1')`;
  assert.throws(() => raw.exec(rule('contact', "'withheld'", 1)), /CHECK constraint failed/, 'a contact column cannot be marked servable');
  assert.throws(() => raw.exec(rule('contact', 'NULL', 0)), /CHECK constraint failed/, 'a contact column names its handling');
  raw.exec(rule('contact', "'withheld'", 0));
  raw.exec(rule('fact', 'NULL', 1));
});

test('a record reads back byte for byte in its column order; the contact column is withheld and only counted', async () => {
  const { raw, DB } = freshDb();
  const recs = [record('r1')];
  const { run_uid } = await open(DB, recs);
  const out = await writeChunk(DB, ENV, { runUid: run_uid, chunkIndex: 0, records: recs, now: NOW });
  assert.equal(out.status, 'written');
  const [row] = rowsOf(raw, 'research_source_records');
  const expected = recs[0].cells.filter(([n]) => n !== 'email');
  assert.equal(row.body_json, bodyJson(expected), 'stored bytes equal the non-contact cells as recorded');
  assert.deepEqual(JSON.parse(String(row.body_json)), expected, 'blank, false, list and untrimmed text kept apart and in order');
  assert.deepEqual(JSON.parse(String(row.columns_json)), COLUMNS);
  assert.equal(row.body_sha256, await sha256Hex(String(row.body_json)));
  assert.equal(row.hash_checked, 0, 'no recipe: the stated hash is kept as declared, not checked');
  assert.equal(rowsOf(raw, 'research_source_private_fields').length, 0);
  const counts = JSON.parse(String(rowsOf(raw, 'research_source_runs')[0].counts_json));
  assert.deepEqual(counts.cells.invented_funds.email, { stored: 0, withheld: 1, blank: 0 });
  assert.deepEqual(counts.cells.invented_funds.founded, { stored: 0, withheld: 0, blank: 1 });
  const sum = Object.values(counts.cells.invented_funds as Record<string, { stored: number; withheld: number; blank: number }>)
    .reduce((n, c) => n + c.stored + c.withheld + c.blank, 0);
  assert.equal(sum, COLUMNS.length, 'stored + withheld + blank = expected cells');
  assert.equal((await sealRun(DB, run_uid, NOW)).status, 'complete');
});

test('a null and an absent cell stay apart, and a record supplied without its contact column is accepted', async () => {
  const { raw, DB } = freshDb();
  const recs = [record('r2', { founded: null, email: undefined })];
  const { run_uid } = await open(DB, recs);
  await writeChunk(DB, ENV, { runUid: run_uid, chunkIndex: 0, records: recs, now: NOW });
  const [row] = rowsOf(raw, 'research_source_records');
  assert.deepEqual(JSON.parse(String(row.body_json)).find(([n]: [string]) => n === 'founded'), ['founded', null]);
  assert.ok(!JSON.parse(String(row.columns_json)).includes('email'), 'absent stays absent');
  assert.equal(row.body_sha256, await sha256Hex(String(row.body_json)), 'the body hash recomputes');
  assert.equal((await sealRun(DB, run_uid, NOW)).status, 'complete');
});

test('the same chunk twice stores nothing the second time, and the second run seals Complete from its own rows', async () => {
  const { raw, DB } = freshDb();
  const recs = [record('a'), record('b')];
  const first = await open(DB, recs);
  await writeChunk(DB, ENV, { runUid: first.run_uid, chunkIndex: 0, records: recs, now: NOW });
  await writeChunk(DB, ENV, { runUid: first.run_uid, chunkIndex: 0, records: recs, now: NOW });
  assert.equal(rowsOf(raw, 'research_source_records').length, 2);
  const counts = JSON.parse(String(rowsOf(raw, 'research_source_runs')[0].counts_json));
  assert.deepEqual(counts.outcomes, { new: 2 }, 'a replayed chunk never counts twice');
  assert.equal((await sealRun(DB, first.run_uid, NOW)).status, 'complete');
  const second = await open(DB, recs);
  const out = await writeChunk(DB, ENV, { runUid: second.run_uid, chunkIndex: 0, records: recs, now: NOW });
  assert.equal(out.counts.unchanged, 2);
  assert.equal(rowsOf(raw, 'research_source_records').length, 2, 'nothing new stored');
  const run2 = raw.prepare(`SELECT counts_json FROM research_source_runs WHERE uid = ?`).get(second.run_uid) as { counts_json: string };
  assert.deepEqual(JSON.parse(run2.counts_json).outcomes, { unchanged: 2 }, 'each run counts only its own rows');
  assert.equal((await sealRun(DB, second.run_uid, NOW)).status, 'complete');
  assert.equal((await open(DB, recs, { idempotencyKey: `run-key-${key}-0000` })).replayed, true, 'the same key answers the first run');
});

test('a changed record is kept beside the first, and an UPDATE of stored content is refused', async () => {
  const { raw, DB } = freshDb();
  const v1 = [record('c')];
  const r1 = await open(DB, v1);
  await writeChunk(DB, ENV, { runUid: r1.run_uid, chunkIndex: 0, records: v1, now: NOW });
  const v2 = [{ ...record('c', { notes: 'Rewritten' }), stated_row_hash: 'h-c-2' }];
  const r2 = await open(DB, v2);
  const out = await writeChunk(DB, ENV, { runUid: r2.run_uid, chunkIndex: 0, records: v2, now: NOW });
  assert.equal(out.counts.new_version, 1);
  assert.deepEqual(rowsOf(raw, 'research_source_records').map((r) => r.stated_row_hash), ['h-c', 'h-c-2']);
  assert.throws(() => raw.exec(`UPDATE research_source_records SET body_json = '[]'`), /stored content is never updated/);
});

test('under a known recipe a mismatch is refused by id; under an unknown one the hash is stored as declared', async () => {
  const recipe: HashRecipe = { id: 'invented-test-recipe', wholeRecordHash: async (cells) => (await sha256Hex(JSON.stringify(cells))).slice(0, 16) };
  const good = record('k1');
  good.stated_row_hash = await recipe.wholeRecordHash(good.cells);
  const bad = record('k2');
  const { raw, DB } = freshDb();
  const { run_uid } = await open(DB, [good, bad], { hashRecipeId: recipe.id });
  const out = await writeChunk(DB, ENV, { runUid: run_uid, chunkIndex: 0, records: [good, bad], now: NOW, recipes: { [recipe.id]: recipe } });
  assert.deepEqual(out.refused, [{ source_key: 'invented_funds', provider_record_id: 'k2', code: 'hash_mismatch' }]);
  assert.equal(out.counts.hash_checked, 1);
  assert.deepEqual(rowsOf(raw, 'research_source_records').map((r) => [r.provider_record_id, r.hash_checked]), [['k1', 1]]);
  const unknown = freshDb();
  const run = await open(unknown.DB, [bad], { hashRecipeId: 'not-registered' });
  const res = await writeChunk(unknown.DB, ENV, { runUid: run.run_uid, chunkIndex: 0, records: [bad], now: NOW, recipes: { [recipe.id]: recipe } });
  assert.equal(res.counts.hash_checked, 0);
  assert.equal(rowsOf(unknown.raw, 'research_source_records')[0].stated_row_hash, 'h-k2', 'kept as declared');
});

test('column rules: a missing class refuses the run naming the column; a contradicting request is refused', async () => {
  const { DB } = freshDb();
  const recs = [record('x')];
  const { email: _e, ...noEmail } = classes.invented_funds;
  await assert.rejects(open(DB, recs, { columnClasses: { invented_funds: noEmail } }),
    (e: SourceStoreRefusal) => e.code === 'column_class_missing' && e.detail.column === 'email');
  await open(DB, recs);
  await assert.rejects(open(DB, recs, { columnClasses: { invented_funds: { ...classes.invented_funds, notes: { class: 'fact' } } } }),
    (e: SourceStoreRefusal) => e.code === 'column_rules_disagree' && e.detail.column === 'notes');
  await assert.rejects(open(DB, recs, { columnClasses: { invented_funds: { ...classes.invented_funds, email: { class: 'contact', contact: 'held' } } } }),
    (e: SourceStoreRefusal) => e.code === 'held_not_enabled', 'held is off unless the caller enables it (#7739 Q3 = B)');
});

test('a held contact value (off for the four-source package) is stored only as ciphertext', async () => {
  const { raw, DB } = freshDb();
  const recs = [record('p1')];
  const { run_uid } = await open(DB, recs, { allowHeld: true,
    columnClasses: { invented_funds: { ...classes.invented_funds, email: { class: 'contact', contact: 'held' } } } });
  await writeChunk(DB, ENV, { runUid: run_uid, chunkIndex: 0, records: recs, now: NOW });
  const [priv] = rowsOf(raw, 'research_source_private_fields');
  assert.match(String(priv.ciphertext), /^v1\./);
  assert.ok(!String(priv.ciphertext).includes(MARK) && !String(priv.ciphertext).includes('@example.com'));
});

test('limits: a 9 KB record and a 41 KB manifest are accepted; an oversized chunk writes nothing; a chunk is a fixed number of statements', async () => {
  const { raw, DB } = freshDb();
  const big = record('big', { notes: 'n'.repeat(9 * 1024) });
  const wide = await manifestFor([big]);
  const manifest = { sources: [wide.sources[0], ...Array.from({ length: 19 }, (_, i) => ({ ...wide.sources[0], source_key: `pad_${i}`,
    columns: Array.from({ length: 40 }, (_, c) => `column_${String(c).padStart(2, '0')}_${'p'.repeat(40)}`) }))] };
  assert.ok(new TextEncoder().encode(JSON.stringify(manifest)).byteLength > 41 * 1024);
  const pad = Object.fromEntries(manifest.sources.slice(1).map((s) => [s.source_key, Object.fromEntries(s.columns.map((c) => [c, { class: 'fact' }]))]));
  const { run_uid } = await open(DB, [big], { manifest, columnClasses: { ...classes, ...pad } });
  const full = Array.from({ length: LIMITS.MAX_CHUNK_RECORDS }, (_, i) => record(`f${i}`));
  DB.prepared.length = 0;
  await writeChunk(DB, ENV, { runUid: run_uid, chunkIndex: 0, records: full, now: NOW });
  assert.equal(DB.prepared.length, LIMITS.STATEMENTS_PER_CHUNK, 'a full chunk issues the fixed number of statements');
  DB.prepared.length = 0;
  await writeChunk(DB, ENV, { runUid: run_uid, chunkIndex: 1, records: [big], now: NOW });
  assert.equal(DB.prepared.length, LIMITS.STATEMENTS_PER_CHUNK);
  assert.ok(rowsOf(raw, 'research_source_records').some((r) => r.provider_record_id === 'big'));
  const before = rowsOf(raw, 'research_source_records').length;
  DB.prepared.length = 0;
  await assert.rejects(writeChunk(DB, ENV, { runUid: run_uid, chunkIndex: 2, records: [...full, record('one-more')], now: NOW }), /chunk_too_large/);
  await assert.rejects(writeChunk(DB, ENV, { runUid: run_uid, chunkIndex: 2, records: [record('huge', { notes: 'h'.repeat(LIMITS.MAX_BOUND_VALUE_BYTES) })], now: NOW }), /chunk_too_large/);
  assert.equal(DB.prepared.length, 0, 'an oversized chunk issues no statement');
  assert.equal(rowsOf(raw, 'research_source_records').length, before);
  const binds = (sql: string) => new Set(sql.match(/\?\d+/g) ?? []).size;
  for (const sql of Object.values(SQL)) {
    assert.ok(new TextEncoder().encode(sql).byteLength < LIMITS.MAX_STATEMENT_TEXT_BYTES);
    assert.ok(binds(sql) <= LIMITS.MAX_BOUND_PARAMS);
  }
  for (const name of ['runForChunk', 'rulesFor', 'identities', 'activeRemovals', 'insertRecords', 'insertRunRecords', 'insertPrivate', 'insertFlags', 'updateCounts'] as const) {
    assert.ok(binds(SQL[name]) <= 3, `${name}: a chunk statement binds three values at most, whatever the chunk holds`);
  }
});

test('one missing and one altered record make the run partial, never Complete', async () => {
  const { raw, DB } = freshDb();
  const recs = [record('m1'), record('m2'), record('m3')];
  const { run_uid } = await open(DB, recs);
  await writeChunk(DB, ENV, { runUid: run_uid, chunkIndex: 0, records: recs, now: NOW });
  raw.exec(`DROP TRIGGER research_source_records_no_update`);
  raw.exec(`UPDATE research_source_records SET body_json = '[["name","tampered"]]' WHERE provider_record_id = 'm2'`);
  raw.exec(`DELETE FROM research_source_records WHERE provider_record_id = 'm3'`);
  const seal = await sealRun(DB, run_uid, NOW);
  assert.equal(seal.status, 'partial');
  assert.deepEqual([seal.sources.invented_funds.missing, seal.sources.invented_funds.altered], [1, 1]);
  const short = freshDb();
  const run = await open(short.DB, recs);
  await writeChunk(short.DB, ENV, { runUid: run.run_uid, chunkIndex: 0, records: recs.slice(0, 2), now: NOW });
  assert.equal((await sealRun(short.DB, run.run_uid, NOW)).status, 'partial', 'a record the manifest expects but no chunk sent');
});

test('a cell count that does not match the manifest keeps the run partial', async () => {
  const { DB } = freshDb();
  const recs = [record('e1')];
  key++;
  const manifest = await manifestFor(recs, { expected_cells: COLUMNS.length + 1 });
  const { run_uid } = await openRun(DB, { idempotencyKey: `run-key-${key}-0000`, actorUserId: 42, payloadSha256: 'a'.repeat(64),
    hashRecipeId: null, manifest, columnClasses: classes as never, now: NOW });
  await writeChunk(DB, ENV, { runUid: run_uid, chunkIndex: 0, records: recs, now: NOW });
  const seal = await sealRun(DB, run_uid, NOW);
  assert.equal(seal.status, 'partial');
  assert.equal(seal.sources.invented_funds.cells_ok, false);
});

test('a chunk of unknown outcome leaves the run uncertain until reconcile settles it', async () => {
  const { DB } = freshDb();
  const recs = [record('u1')];
  const { run_uid } = await open(DB, recs);
  const batch = DB.batch.bind(DB);
  (DB as { batch: unknown }).batch = async () => { throw new Error('network: the connection closed'); };
  assert.equal((await writeChunk(DB, ENV, { runUid: run_uid, chunkIndex: 0, records: recs, now: NOW })).status, 'uncertain');
  (DB as { batch: unknown }).batch = batch;
  assert.equal((await sealRun(DB, run_uid, NOW)).status, 'uncertain', 'never Complete while a chunk is unknown');
  assert.equal((await reconcileChunk(DB, ENV, { runUid: run_uid, chunkIndex: 0, records: recs, now: NOW })).status, 'written');
  assert.equal((await sealRun(DB, run_uid, NOW)).status, 'complete');
});

test('removals: private fields keep id and hashes; a record or a source leaves no content; each is recorded and refuses a replay until lifted', async () => {
  const { raw, DB } = freshDb();
  const heldClasses = { invented_funds: { ...classes.invented_funds, email: { class: 'contact', contact: 'held' } } };
  const recs = [record('d1'), record('d2')];
  const r1 = await open(DB, recs, { allowHeld: true, columnClasses: heldClasses });
  await writeChunk(DB, ENV, { runUid: r1.run_uid, chunkIndex: 0, records: recs, now: NOW });
  assert.equal(rowsOf(raw, 'research_source_private_fields').length, 2);

  await removePrivateFields(DB, { sourceKey: 'invented_funds', providerRecordId: 'd1', actorUserId: 7, now: NOW });
  assert.equal(rowsOf(raw, 'research_source_private_fields').length, 1);
  assert.ok(rowsOf(raw, 'research_source_records').some((r) => r.provider_record_id === 'd1' && r.body_sha256 && r.stated_row_hash));
  const v2 = [{ ...record('d1'), stated_row_hash: 'h-d1-2' }];
  const r2 = await open(DB, v2, { allowHeld: true, columnClasses: heldClasses });
  await writeChunk(DB, ENV, { runUid: r2.run_uid, chunkIndex: 0, records: v2, now: NOW });
  assert.equal(rowsOf(raw, 'research_source_private_fields').length, 1, 'a replay does not restore removed private fields');

  await removeRecord(DB, { sourceKey: 'invented_funds', providerRecordId: 'd2', actorUserId: 7, now: NOW });
  assert.ok(!rowsOf(raw, 'research_source_records').some((r) => r.provider_record_id === 'd2'));
  assert.ok(rowsOf(raw, 'research_source_run_records').some((r) => r.provider_record_id === 'd2' && r.stated_row_hash === 'h-d2'), 'ids and hashes stay');
  const r3 = await open(DB, [record('d2')], { allowHeld: true, columnClasses: heldClasses });
  const replay = await writeChunk(DB, ENV, { runUid: r3.run_uid, chunkIndex: 0, records: [record('d2')], now: NOW });
  assert.deepEqual(replay.refused.map((r) => r.code), ['record_removed']);

  const removal = await removeSource(DB, { sourceKey: 'invented_funds', actorUserId: 7, now: NOW });
  assert.deepEqual(removal.counts, { records: 2, private_fields: 0, flags: 0 });
  for (const t of ['research_source_records', 'research_source_private_fields', 'research_source_flags']) assert.equal(rowsOf(raw, t).length, 0);
  assert.ok(rowsOf(raw, 'research_source_run_records').length >= 4, 'run ids, hashes and counts stay');
  await assert.rejects(open(DB, recs, { allowHeld: true, columnClasses: heldClasses }), /source_removed/);
  const logged = rowsOf(raw, 'research_source_removals');
  assert.deepEqual(logged.map((r) => r.scope), ['private_fields', 'record', 'source']);
  assert.ok(logged.every((r) => r.actor_user_id === 7 && !JSON.stringify(r).includes(MARK)));
  assert.equal(await liftRemoval(DB, Number(logged[2].id), 7, NOW), true);
  assert.ok((await open(DB, recs, { allowHeld: true, columnClasses: heldClasses })).run_uid, 'lifted, the source opens again');
});

test('privacy: the planted marker appears in no error, return value or log, and a withheld value is never written', async () => {
  const { raw, DB } = freshDb();
  const logs: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  const seen: string[] = [];
  try {
    const recs = [record('z1'), { ...record('z2'), cells: [...record('z2').cells, ['not_a_column', MARK]] as never }];
    const { run_uid } = await open(DB, recs);
    seen.push(JSON.stringify(await writeChunk(DB, ENV, { runUid: run_uid, chunkIndex: 0, records: recs, now: NOW })));
    seen.push(JSON.stringify(await sealRun(DB, run_uid, NOW)));
    seen.push(JSON.stringify(await planChunk({ manifest: await manifestFor(recs), rules: new Map(), existing: new Map(),
      removals: { sources: new Set(), records: new Set(), privateFields: new Set() }, records: [], recipe: null, now: NOW })));
    for (const bad of [{ notes: 7 as never, stages: [`\uD800${MARK}`] }]) {
      try { await writeChunk(DB, ENV, { runUid: run_uid, chunkIndex: 1, records: [record('z3', bad)], now: NOW }); } catch (e) { seen.push(String((e as Error).message)); }
    }
    try { await writeChunk(DB, ENV, { runUid: run_uid, chunkIndex: 2, records: [record('z4', { notes: MARK.repeat(LIMITS.MAX_BOUND_VALUE_BYTES / MARK.length) })], now: NOW }); } catch (e) { seen.push((e as Error).message); }
  } finally { Object.assign(console, orig); }
  assert.ok(seen.length >= 4);
  for (const s of [...seen, ...logs]) assert.ok(!s.includes(MARK), 'no value in an error, a return value or a log line');
  for (const t of ['research_source_runs', 'research_source_run_records', 'research_source_flags', 'research_source_column_rules', 'research_source_removals', 'research_source_private_fields']) {
    assert.ok(!JSON.stringify(rowsOf(raw, t)).includes(MARK), `${t} holds no value`);
  }
  const dump = JSON.stringify(rowsOf(raw, 'research_source_records'));
  assert.ok(dump.includes(MARK), 'the marker is in the stored body');
  assert.ok(!dump.includes('@example.com'), 'a withheld contact value is never written');
});

/** Every `CREATE TABLE research_source_*` in the migrations, as whole-word names. */
function storeTables(): string[] {
  const dir = join(ROOT, 'cloudflare-worker/sql/migrations');
  const names = new Set<string>();
  for (const f of readdirSync(dir)) for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(research_source_\w+)/gi)) names.add(m[1]);
  return [...names];
}
/** Files outside researchSource* / research_source_* that name one of the store's tables. */
export function tableLeaks(files: Array<{ path: string; text: string }>, tables: string[]): string[] {
  // Whole words through one fixed pattern and a set lookup; no pattern is built from a string.
  const names = new Set(tables);
  const namesOne = (text: string) => (text.match(/[A-Za-z0-9_]+/g) ?? []).some((word) => names.has(word));
  return files.filter((f) => !/^(researchSource|research_source_)/.test(basename(f.path)) && namesOne(f.text)).map((f) => f.path);
}
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}

test('privacy: no file under cloudflare-worker/src names a store table unless its name starts with researchSource or research_source_', () => {
  const tables = storeTables();
  assert.equal(tables.length, 9, String(readFileSync(join(ROOT, MIGRATION), 'utf8').length));
  const files = walk(join(ROOT, 'cloudflare-worker/src')).filter((p) => /\.(ts|js|mjs)$/.test(p)).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));
  assert.ok(files.some((f) => f.path.endsWith('routes/_registry.ts')), 'the generated registry is in the sweep');
  assert.deepEqual(tableLeaks(files, tables), []);
  assert.deepEqual(tableLeaks([{ path: 'cloudflare-worker/src/routes/research.ts', text: 'SELECT * FROM research_source_records' }], tables),
    ['cloudflare-worker/src/routes/research.ts'], 'the check fails on an invented file outside the allowed names');
  assert.deepEqual(tableLeaks([{ path: 'x/research.ts', text: 'research_source_records_view is another word' }], tables), [], 'whole words only');
});
