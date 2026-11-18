/**
 * D6651 (#6651) — the single path that deletes `record`-class R2 objects.
 *
 * Record files are write-once (`recordStore.ts`): request code never overwrites one and never
 * deletes one as housekeeping (a rollback, a replacement). What remains is deletion the law or
 * a stated retention promise requires — a member removing their own file, a retention sweep
 * (call audio, compute artifacts), a Trash purge, an erasure request. #6652 (owner's answer A)
 * puts those through one audited Worker path; #6654 builds its suppression ledger. This module
 * is that path's one door: each call names its reason, and every delete is logged with the
 * reason and the number of objects, never a key. #6654 adds the ledger row in the same
 * operation here, so no caller changes when it lands.
 *
 * `scripts/check-record-writes.mjs` allows a `.delete(` of a record prefix in this file only.
 */

/** Why a record object is being deleted. A new reason is a reviewed change to this list. */
export type RecordErasureReason =
  /** The member (or the operator on their behalf) removed their own file. */
  | 'owner_removed'
  /** A stated retention period ended (a sweep). */
  | 'retention_expired'
  /** A purge of something already in Trash, or of a rejected case's documents. */
  | 'purge'
  /** Erasure of a person's or scope's data (a DSR or account/scope removal). */
  | 'erasure_request'
  /**
   * An object the same failed operation just created with `putRecordOrThrow` and never served, where a stated
   * rule forbids keeping such bytes (D4557: a cancelled, revoked or losing compute completion keeps no output).
   */
  | 'unreferenced';

/** Delete `keys` from `bucket` for `reason`. Throws as `R2Bucket.delete` throws. */
export async function eraseRecordObjects(bucket: Pick<R2Bucket, 'delete'>, keys: string | string[], reason: RecordErasureReason): Promise<void> {
  const count = Array.isArray(keys) ? keys.length : 1;
  if (!count) return;
  await bucket.delete(keys);
  console.log(JSON.stringify({ event: 'record_objects_erased', reason, count }));
}
