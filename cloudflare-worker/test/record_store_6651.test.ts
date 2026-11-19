/**
 * D6651 (#6651) — record files are write-once.
 *
 * `putRecord` (services/recordStore.ts) writes with a conditional put that only commits while the key
 * is absent; a second put to the same key is refused with a typed refusal and the first object's bytes
 * stay as they were. `eraseRecordObjects` (services/recordErasure.ts) is the only delete, and it logs
 * its reason and a count, never a key. The bucket is an in-memory stand-in that honours `onlyIf` the
 * way R2 does (a failed precondition answers null and stores nothing). Every object is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { putRecord, putPublicationRecord, putBackupRecord, putRecordOrThrow, putContentAddressedRecord, RecordExistsError, WRITE_ONCE } from '../src/services/recordStore.ts';
import { eraseRecordObjects } from '../src/services/recordErasure.ts';

/** A synthetic R2 bucket: honours `onlyIf.etagDoesNotMatch: '*'` (store only while absent) and `sha256`. */
function writeOnceBucket() {
  const store = new Map<string, { bytes: Uint8Array; etag: string; meta?: Record<string, string> }>();
  let n = 0;
  const bytesOf = async (body: unknown) => typeof body === 'string' ? new TextEncoder().encode(body)
    : body instanceof Uint8Array ? body : body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(await new Response(body as BodyInit).arrayBuffer());
  const hex = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');
  return {
    store,
    async put(key: string, body: unknown, opts: any = {}) {
      const bytes = await bytesOf(body);
      if (opts.onlyIf?.etagDoesNotMatch === '*' && store.has(key)) return null;
      if (opts.sha256 && await hex(bytes) !== opts.sha256) throw new Error('synthetic: checksum mismatch');
      const etag = `e${++n}`;
      store.set(key, { bytes: bytes.slice(), etag, meta: opts.customMetadata });
      return { key, size: bytes.byteLength, etag } as any;
    },
    async delete(keys: string | string[]) { for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k); },
  };
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

test('a second put to the same record key is refused and the first object keeps its bytes', async () => {
  const bucket = writeOnceBucket();
  const first = await putRecord(bucket as any, 'reports/synthetic/one.pdf', '%PDF first', { customMetadata: { who: 'first' } });
  assert.equal(first.ok, true);
  const second = await putRecord(bucket as any, 'reports/synthetic/one.pdf', '%PDF second', { customMetadata: { who: 'second' } });
  assert.deepEqual(second, { ok: false, refusal: 'record_exists', key: 'reports/synthetic/one.pdf' });
  assert.equal(text(bucket.store.get('reports/synthetic/one.pdf')!.bytes), '%PDF first');
  assert.deepEqual(bucket.store.get('reports/synthetic/one.pdf')!.meta, { who: 'first' });
  assert.equal(bucket.store.size, 1);
});

test('every bucket entry point writes once, and a caller cannot pass its own onlyIf', async () => {
  for (const put of [putRecord, putPublicationRecord, putBackupRecord]) {
    const bucket = writeOnceBucket();
    assert.equal((await put(bucket as any, 'kv/synthetic/2026-01-01.jsonl', 'a')).ok, true, put.name);
    assert.equal((await put(bucket as any, 'kv/synthetic/2026-01-01.jsonl', 'b', { onlyIf: undefined } as any)).ok, false, put.name);
    assert.equal(text(bucket.store.get('kv/synthetic/2026-01-01.jsonl')!.bytes), 'a', put.name);
  }
  assert.deepEqual(WRITE_ONCE, { etagDoesNotMatch: '*' });
  assert.ok(Object.isFrozen(WRITE_ONCE));
});

test('putRecordOrThrow throws the typed refusal and replaces nothing', async () => {
  const bucket = writeOnceBucket();
  await putRecordOrThrow(bucket as any, 'kyc/0/synthetic.pdf', 'original');
  await assert.rejects(putRecordOrThrow(bucket as any, 'kyc/0/synthetic.pdf', 'replacement'),
    (e: unknown) => e instanceof RecordExistsError && (e as RecordExistsError).code === 'record_exists');
  assert.equal(text(bucket.store.get('kyc/0/synthetic.pdf')!.bytes), 'original');
});

test('a content-addressed record can only re-store the bytes its key names', async () => {
  const bucket = writeOnceBucket();
  const bytes = new TextEncoder().encode('synthetic blob');
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const key = `wg/v1/t1/c1/sha256/${digest}`;
  assert.ok(await putContentAddressedRecord(bucket as any, key, bytes, digest));
  await assert.rejects(putContentAddressedRecord(bucket as any, `wg/v1/t1/c1/sha256/${'0'.repeat(64)}`, bytes, digest), /content_address_mismatch/);
  await assert.rejects(putContentAddressedRecord(bucket as any, key, new TextEncoder().encode('other bytes'), digest), /checksum mismatch/);
  assert.equal(text(bucket.store.get(key)!.bytes), 'synthetic blob');
});

test('the one record delete logs its reason and a count, never a key', async (t) => {
  const bucket = writeOnceBucket();
  await putRecord(bucket as any, 'research/0/a.pdf', 'a');
  await putRecord(bucket as any, 'research/0/b.pdf', 'b');
  const lines: string[] = [];
  t.mock.method(console, 'log', (line: string) => { lines.push(line); });
  await eraseRecordObjects(bucket as any, ['research/0/a.pdf', 'research/0/b.pdf'], 'owner_removed');
  await eraseRecordObjects(bucket as any, [], 'purge');
  assert.equal(bucket.store.size, 0);
  assert.deepEqual(lines.map((l) => JSON.parse(l)), [{ event: 'record_objects_erased', reason: 'owner_removed', count: 2 }]);
  assert.ok(!lines.join('').includes('research/'), 'no key is logged');
});
