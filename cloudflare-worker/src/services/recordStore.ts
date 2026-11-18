/**
 * D6651 (#6651) — the one writer of `record`-class R2 objects: write-once, never a replace.
 *
 * R2 keeps no previous versions (#6428, D5581-p3), so an overwrite or a delete of an original
 * record (a signed contract, a KYC document, a filed snapshot) cannot be undone from the bucket.
 * Every write to a prefix that `documentation/operations/R2_INVENTORY.json` classes `record`
 * goes through `putRecord`, a conditional put that only commits while the key is absent.
 * When the key already holds an object R2 stores nothing and `putRecord` answers a typed
 * refusal; the object already there keeps its bytes.
 *
 * There is no delete here. A route that "replaces" a record writes a new key and points its
 * row at the newest one. The only deletes of a record key are the legally required ones in
 * `recordErasure.ts` (#6652 A, completed by #6654). `scripts/check-record-writes.mjs` fails
 * the build on a direct `.put(` or `.delete(` of a record prefix anywhere else.
 */

/** What a record body may be: the same values `R2Bucket.put` accepts. */
export type RecordBody = Parameters<R2Bucket['put']>[1];

/** Metadata for the stored object. `onlyIf` is the helper's own and cannot be passed. */
export type RecordPutOptions = Omit<R2PutOptions, 'onlyIf'>;

export type RecordPutResult =
  | { ok: true; key: string; object: R2Object }
  | { ok: false; refusal: 'record_exists'; key: string };

/** The condition that makes the put write-once: commit only while no object is at the key. */
export const WRITE_ONCE: R2Conditional = Object.freeze({ etagDoesNotMatch: '*' }) as R2Conditional;

/** R2 answers `null` when the precondition fails, and nothing is written: that is the refusal. */
function settle(key: string, stored: R2Object | null): RecordPutResult {
  if (stored === null) return { ok: false, refusal: 'record_exists', key };
  return { ok: true, key, object: stored };
}

// One entry point per bucket, each with its own conditional put, so the R2 inventory (D6650) resolves
// every write's bucket and prefix from its callers without pairing one bucket's keys with another's.

/** Store `body` at `key` in the FILES bucket only if nothing is stored there. */
export async function putRecord(files: Pick<R2Bucket, 'put'>, key: string, body: RecordBody, options: RecordPutOptions = {}): Promise<RecordPutResult> {
  return settle(key, await files.put(key, body, { ...options, onlyIf: WRITE_ONCE }));
}

/** `putRecord` for the publications archive (PUBLICATIONS, or FILES where it is not bound). */
export async function putPublicationRecord(bucket: Pick<R2Bucket, 'put'>, key: string, body: RecordBody, options: RecordPutOptions = {}): Promise<RecordPutResult> {
  return settle(key, await bucket.put(key, body, { ...options, onlyIf: WRITE_ONCE }));
}

/** `putRecord` for the BACKUPS bucket's snapshots. */
export async function putBackupRecord(backups: Pick<R2Bucket, 'put'>, key: string, body: RecordBody, options: RecordPutOptions = {}): Promise<RecordPutResult> {
  return settle(key, await backups.put(key, body, { ...options, onlyIf: WRITE_ONCE }));
}

/**
 * A content-addressed record (`wg/v1/…/sha256/<digest>`, D5581-p3): the key names the SHA-256 of the
 * only bytes it may ever hold, and R2 refuses a put whose body does not hash to `sha256`. So a write
 * here can only store those exact bytes again — repairing a torn or corrupt copy, or rewriting its
 * metadata — and never changes the record. A key that does not end in its digest is refused before
 * any write. Returns what `R2Bucket.put` returns.
 */
export async function putContentAddressedRecord(
  bucket: Pick<R2Bucket, 'put'>, key: string, body: RecordBody, sha256: string, options: Omit<RecordPutOptions, 'sha256'> = {},
): Promise<R2Object | null> {
  if (!/^[0-9a-f]{64}$/.test(sha256) || !key.endsWith(`/${sha256}`)) throw new Error('content_address_mismatch');
  return bucket.put(key, body, { ...options, sha256 });
}

/** The refusal as an error, for call sites whose failure path is a throw. */
export class RecordExistsError extends Error {
  readonly code = 'record_exists';
  constructor() { super('A record file is already stored under this name; it was not replaced.'); this.name = 'RecordExistsError'; }
}

/** `putRecord`, throwing `RecordExistsError` on the refusal. */
export async function putRecordOrThrow(bucket: Pick<R2Bucket, 'put'>, key: string, body: RecordBody, options: RecordPutOptions = {}): Promise<void> {
  const result = await putRecord(bucket, key, body, options);
  if (!result.ok) throw new RecordExistsError();
}
