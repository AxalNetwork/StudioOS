/**
 * D6654 (#6654) — the one record-erasure path writes the suppression ledger row, or deletes nothing.
 *
 * `eraseRecordObjects` (services/recordErasure.ts) writes one `record_suppression_ledger` row per key in
 * one D1 batch before it deletes, and the file restore (scripts/file-recovery.py) reads that ledger and
 * never puts an erased object back. The database is node:sqlite built from the migration itself, so the
 * table's CHECKs and append-only triggers run. Every key and object is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { makeD1 } from './_d1_sqlite.mjs';
import { eraseRecordObjects, recordClassOf, suppressionKeyHash, RECORD_FILE_CLASSES, SUPPRESSION_BUCKET } from '../src/services/recordErasure.ts';

const ROOT = new URL('../../', import.meta.url);
const MIGRATIONS = new URL('cloudflare-worker/sql/migrations/', ROOT);
const migration = readdirSync(MIGRATIONS).filter((f) => /^\d{12}_6654_record_suppression_ledger\.sql$/.test(f));
const LEDGER_SQL = readFileSync(new URL(migration[0], MIGRATIONS), 'utf8');

function bucket(keys: string[]) {
  const store = new Map(keys.map((k) => [k, `synthetic bytes of ${k}`]));
  const deletes: unknown[] = [];
  return { store, deletes, async delete(k: string | string[]) { deletes.push(k); for (const key of Array.isArray(k) ? k : [k]) store.delete(key); } };
}
const rows = (db: any) => db.prepare('SELECT * FROM record_suppression_ledger ORDER BY id').all() as Record<string, unknown>[];

test('the ledger migration is named by its minute and this issue', () => {
  assert.equal(migration.length, 1);
});

test('erasing writes one ledger row per key, then deletes the live objects', async (t) => {
  t.mock.method(console, 'log', () => {});
  const { DB, db } = makeD1(LEDGER_SQL);
  const keys = ['kyc/synthetic-case/passport.pdf', 'research/0/synthetic.pdf'];
  const files = bucket([...keys, 'kyc/synthetic-case/kept.pdf']);
  await eraseRecordObjects(files as any, keys, 'erasure_request', { db: DB, requestId: 'dsr-synthetic-1', actor: 'operator' });
  assert.deepEqual([...files.store.keys()], ['kyc/synthetic-case/kept.pdf']);
  const ledger = rows(db);
  assert.equal(ledger.length, 2);
  assert.deepEqual(ledger.map((r) => [r.bucket, r.key_hash, r.record_class, r.reason, r.request_id, r.actor]), [
    [SUPPRESSION_BUCKET, createHash('sha256').update(keys[0]).digest('hex'), 'files-kyc', 'erasure_request', 'dsr-synthetic-1', 'operator'],
    [SUPPRESSION_BUCKET, createHash('sha256').update(keys[1]).digest('hex'), 'files-research', 'erasure_request', 'dsr-synthetic-1', 'operator'],
  ]);
  assert.ok(ledger.every((r) => !Number.isNaN(Date.parse(String(r.erased_at)))));
});

test('a ledger row holds no content and no key: only the fields the issue names', async (t) => {
  t.mock.method(console, 'log', () => {});
  const { DB, db } = makeD1(LEDGER_SQL);
  const key = 'data-room/synthetic-company/secret-term-sheet.pdf';
  const files = bucket([key]);
  await eraseRecordObjects(files as any, key, 'owner_removed', { db: DB });
  const [row] = rows(db);
  assert.deepEqual(Object.keys(row).sort(), ['actor', 'bucket', 'erased_at', 'id', 'key_hash', 'reason', 'record_class', 'request_id']);
  const text = JSON.stringify(row);
  for (const fragment of ['secret-term-sheet', 'synthetic-company', 'synthetic bytes', 'data-room/']) assert.ok(!text.includes(fragment), fragment);
  assert.match(String(row.request_id), /^op:[0-9a-f-]{36}$/, 'without a request id the row names the operation');
  assert.equal(row.actor, 'system');
});

test('when the ledger write fails, nothing is deleted', async (t) => {
  t.mock.method(console, 'log', () => {});
  const keys = ['kyb/synthetic/a.pdf', 'kyb/synthetic/b.pdf'];
  // No ledger table at all.
  const none = makeD1('CREATE TABLE unrelated (id INTEGER)');
  const files = bucket(keys);
  await assert.rejects(eraseRecordObjects(files as any, keys, 'purge', { db: none.DB }));
  assert.deepEqual(files.deletes, []);
  assert.equal(files.store.size, 2);
  // The second row is refused by the table's CHECK: the batch is one transaction, so the first row is gone too.
  const { DB, db } = makeD1(LEDGER_SQL);
  const failing = { prepare: DB.prepare.bind(DB), async batch(stmts: any[]) { return DB.batch([...stmts, DB.prepare("INSERT INTO record_suppression_ledger (bucket, key_hash, record_class, reason, request_id, actor, erased_at) VALUES ('b', 'not-a-hash', 'c', 'purge', 'r', 'system', 't')")]); } };
  await assert.rejects(eraseRecordObjects(files as any, keys, 'purge', { db: failing as any }));
  assert.deepEqual(files.deletes, []);
  assert.equal(rows(db).length, 0);
  // An unusable request id or actor is refused before anything is written or deleted.
  for (const ledger of [{ requestId: 'has spaces and/slashes' }, { requestId: '' }, { actor: 'user-42' as any }]) {
    await assert.rejects(eraseRecordObjects(files as any, keys, 'purge', { db: DB, ...ledger }), /record_erasure_ledger_invalid/);
  }
  assert.deepEqual(files.deletes, []);
  assert.equal(rows(db).length, 0);
});

test('a rollback of an object this request just stored still goes when the ledger cannot be written', async (t) => {
  t.mock.method(console, 'log', () => {});
  const warned: string[] = [];
  t.mock.method(console, 'warn', (line: string) => { warned.push(line); });
  const none = makeD1('CREATE TABLE unrelated (id INTEGER)');
  const files = bucket(['kyc/synthetic-case/just-stored.pdf']);
  await eraseRecordObjects(files as any, 'kyc/synthetic-case/just-stored.pdf', 'unreferenced', { db: none.DB });
  assert.equal(files.store.size, 0, 'no orphan with personal data is left behind');
  assert.deepEqual(warned.map((l) => JSON.parse(l)), [{ event: 'record_rollback_unledgered', count: 1 }]);
  // Every reason that erases an object which existed before the request keeps the rule: no row, no delete.
  for (const reason of ['owner_removed', 'retention_expired', 'purge', 'erasure_request'] as const) {
    const kept = bucket(['kyc/synthetic-case/older.pdf']);
    await assert.rejects(eraseRecordObjects(kept as any, 'kyc/synthetic-case/older.pdf', reason, { db: none.DB }));
    assert.equal(kept.store.size, 1, reason);
  }
});

test('a failed delete keeps its ledger rows, so a restore can never bring the object back', async (t) => {
  t.mock.method(console, 'log', () => {});
  const { DB, db } = makeD1(LEDGER_SQL);
  const failing = { async delete() { throw new Error('synthetic R2 outage'); } };
  await assert.rejects(eraseRecordObjects(failing as any, 'governance/synthetic/v1.pdf', 'owner_removed', { db: DB }), /synthetic R2 outage/);
  assert.equal(rows(db).length, 1);
});

test('the ledger is append-only and checks its reason, actor and hash', () => {
  const { DB, db } = makeD1(LEDGER_SQL);
  const insert = (over: Record<string, string> = {}) => {
    const v = { bucket: 'studioos-files', key_hash: 'a'.repeat(64), record_class: 'files-kyc', reason: 'purge', request_id: 'r', actor: 'system', erased_at: '2026-11-22T00:00:00.000Z', ...over };
    db.prepare('INSERT INTO record_suppression_ledger (bucket, key_hash, record_class, reason, request_id, actor, erased_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(v.bucket, v.key_hash, v.record_class, v.reason, v.request_id, v.actor, v.erased_at);
  };
  insert();
  assert.throws(() => db.exec("UPDATE record_suppression_ledger SET reason = 'purge'"), /append-only/);
  assert.throws(() => db.exec('DELETE FROM record_suppression_ledger'), /append-only/);
  for (const bad of [{ reason: 'restored' }, { actor: 'user-42' }, { key_hash: 'A'.repeat(64) }, { key_hash: 'a'.repeat(63) }, { request_id: '' }]) {
    assert.throws(() => insert(bad), /CHECK constraint/, JSON.stringify(bad));
  }
  assert.equal(rows(db).length, 1);
  void DB;
});

test('the hash is plain SHA-256 of the key, the one the restore computes', async () => {
  for (const key of ['kyc/x', 'wg/v1/synthetic/éß', '']) assert.equal(await suppressionKeyHash(key), createHash('sha256').update(key, 'utf8').digest('hex'));
});

test('the Worker class list is exactly the inventory record classes of studioos-files', () => {
  const inventory = JSON.parse(readFileSync(new URL('documentation/operations/R2_INVENTORY.json', ROOT), 'utf8'));
  const expected = inventory.classes.filter((c: any) => c.class === 'record' && c.bucket === 'studioos-files').map((c: any) => [c.prefix, c.id]).sort();
  assert.deepEqual([...RECORD_FILE_CLASSES].map((e) => [...e]).sort(), expected);
  // Every class the erasure site's callers pass (the D6651 provenance entry) resolves to itself.
  const site = inventory.key_references.find((r: any) => r.site.startsWith('cloudflare-worker/src/services/recordErasure.ts | eraseRecordObjects | delete'));
  for (const id of site.classes) {
    const prefix = expected.find((e: string[]) => e[1] === id)?.[0];
    assert.ok(prefix, `${id} is a studioos-files record class`);
    assert.equal(recordClassOf(`${prefix}synthetic/object`), id);
  }
  assert.equal(recordClassOf('trust-center/reports/synthetic.pdf'), 'files-trust-center-reports');
  assert.equal(recordClassOf('trust-center/other/synthetic.pdf'), 'unclassified');
});
