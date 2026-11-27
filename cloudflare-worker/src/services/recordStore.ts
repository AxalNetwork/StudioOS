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
 * row at the newest one. The only deletes of a record key are in `recordErasure.ts` (#6652 A,
 * completed by #6654): the legally required ones, and the rollback of an object the same
 * request just stored and no row names (`unreferenced`). `scripts/check-record-writes.mjs` fails
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

/**
 * D5583 part 3: a content-addressed record written in parts (an R2 multipart upload). The key names the SHA-256 of
 * the whole object, as for `putContentAddressedRecord`. R2 cannot check a multipart object's SHA-256, so the caller
 * chains the hash over the parts it sent and `completeContentAddressedMultipart` refuses, before R2 commits anything,
 * unless that hash is the key's digest. A key that does not end in its digest is refused before any write. Aborting
 * an open upload discards parts R2 has not committed; it never touches a stored object.
 */
const contentAddressed = (key: string, sha256: string) => /^[0-9a-f]{64}$/.test(sha256) && key.endsWith(`/${sha256}`);

export async function createContentAddressedMultipart(
  bucket: Pick<R2Bucket, 'createMultipartUpload'>, key: string, sha256: string, options: R2MultipartOptions = {},
): Promise<R2MultipartUpload> {
  if (!contentAddressed(key, sha256)) throw new Error('content_address_mismatch');
  return bucket.createMultipartUpload(key, options);
}

/** One part of an open content-addressed upload. The caller hashes the part before sending it. */
export async function uploadContentAddressedPart(
  bucket: Pick<R2Bucket, 'resumeMultipartUpload'>, key: string, sha256: string, uploadId: string, partNumber: number, bytes: Uint8Array,
): Promise<R2UploadedPart> {
  if (!contentAddressed(key, sha256)) throw new Error('content_address_mismatch');
  return bucket.resumeMultipartUpload(key, uploadId).uploadPart(partNumber, bytes);
}

/** Commit the parts, only when the chained hash of everything sent is the key's digest. */
export async function completeContentAddressedMultipart(
  bucket: Pick<R2Bucket, 'resumeMultipartUpload'>, key: string, sha256: string, chainedSha256: string, uploadId: string, parts: R2UploadedPart[],
): Promise<R2Object> {
  if (!contentAddressed(key, sha256) || chainedSha256 !== sha256) throw new Error('content_address_mismatch');
  return bucket.resumeMultipartUpload(key, uploadId).complete(parts);
}

/** Discard an open upload's uncommitted parts. */
export async function abortContentAddressedMultipart(
  bucket: Pick<R2Bucket, 'resumeMultipartUpload'>, key: string, sha256: string, uploadId: string,
): Promise<void> {
  if (!contentAddressed(key, sha256)) throw new Error('content_address_mismatch');
  await bucket.resumeMultipartUpload(key, uploadId).abort();
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
