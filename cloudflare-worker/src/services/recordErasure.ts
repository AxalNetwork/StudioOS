/**
 * D6651 (#6651), D6654 (#6654) — the single path that deletes `record`-class R2 objects, and the
 * suppression ledger it writes.
 *
 * Record files are write-once (`recordStore.ts`): request code never overwrites one and never
 * deletes a replaced one. What remains is deletion the law or a stated retention promise
 * requires — a member removing their own file, a retention sweep (call audio, compute
 * artifacts), a Trash purge, an erasure request — and the rollback of an object the same
 * failed request just created and no row ever named (`unreferenced`), so a failed write leaves
 * no orphaned personal data behind. #6652 (owner's answer A) puts those through one audited
 * Worker path. This module is that path's one door: each call names its reason, and every delete
 * is logged with the reason and the number of objects, never a key.
 *
 * D6654: before anything is deleted, the call writes one `record_suppression_ledger` row per key
 * (the SHA-256 of the key, its bucket and inventory class, the reason, the request id, an actor
 * category and the time) in one D1 batch. If that batch fails, nothing is deleted, except a rollback
 * (`unreferenced`): that object is not a record yet and is still removed, with a warning. The file
 * restore (`scripts/file-recovery.py`) reads the ledger first and never puts a suppressed object
 * back. A row holds no file content and no key. If the delete itself fails after the rows landed,
 * the rows stay: an object that is suppressed but still live is never lost by a restore, whereas
 * an erased object without a row could come back.
 *
 * `scripts/check-record-writes.mjs` allows a `.delete(` of a record prefix in this file only.
 */

/** Why a record object is being deleted. A new reason is a reviewed change to this list (and the ledger's CHECK). */
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
   * A rollback: an object the same failed request (or call) just created with a successful write-once put, that no
   * row names and nothing ever served — a row write that failed, conflicted or hit a limit after the bytes landed, or
   * a cancelled, revoked or losing compute completion (D4557). Never an object that existed before the request, and
   * never a content-addressed blob another row may share.
   */
  | 'unreferenced';

/** Who asked for the erasure, as a category: the ledger keeps no user id (D6654). */
export type RecordErasureActor = 'member' | 'operator' | 'system';

/** The ledger a call writes to. `requestId` is the erasure request's id; without one, the call's own operation id. */
export interface RecordErasureLedger {
  db: Pick<D1Database, 'prepare' | 'batch'>;
  requestId?: string;
  actor?: RecordErasureActor;
}

/** Every caller passes the `FILES` binding (D6651 inventory provenance), so the ledger names that bucket. */
export const SUPPRESSION_BUCKET = 'studioos-files';

/**
 * The `studioos-files` record classes of `documentation/operations/R2_INVENTORY.json`, by prefix.
 * `record_erasure_6654.test.ts` fails if this list and the inventory disagree. A key under no listed
 * prefix is still suppressed, as `unclassified`: suppression is by key hash, never by class.
 */
export const RECORD_FILE_CLASSES: ReadonlyArray<readonly [prefix: string, id: string]> = [
  ['83b-receipts/', 'files-83b-receipts'],
  ['accreditation-evidence/', 'files-accreditation-evidence'],
  ['advisor-deliverables/', 'files-advisor-deliverables'],
  ['agent-compute/', 'files-agent-compute'],
  ['build-proof/', 'files-build-proof'],
  ['company-documents/', 'files-company-documents'],
  ['contracts/evidence/', 'files-contracts-evidence'],
  ['data-room/', 'files-data-room'],
  ['dd-evidence/', 'files-dd-evidence'],
  ['dd-ndas/', 'files-dd-ndas'],
  ['deck-reviews/', 'files-deck-reviews'],
  ['esign/signed/', 'files-esign-signed'],
  ['fund-notices/', 'files-fund-notices'],
  ['governance/', 'files-governance'],
  ['grow-minutes/', 'files-grow-minutes'],
  ['imports/', 'files-imports'],
  ['kyb/', 'files-kyb'],
  ['kyc/', 'files-kyc'],
  ['mark-request-evidence/', 'files-mark-request-evidence'],
  ['mercury-statements/', 'files-mercury-statements'],
  ['publications/', 'files-publications'],
  ['reports/', 'files-reports'],
  ['research/', 'files-research'],
  ['resumes/', 'files-resumes'],
  ['taxforms/', 'files-taxforms'],
  ['trust-center/reports/', 'files-trust-center-reports'],
  ['validate-audio/', 'files-validate-audio'],
  ['validate-evidence/', 'files-validate-evidence'],
  ['wellbeing/credentials/', 'files-wellbeing-credentials'],
  ['wg/v1/', 'files-wg-v1'],
];

/** The inventory class of `key`: the longest matching record prefix, or `unclassified`. */
export function recordClassOf(key: string): string {
  let best: readonly [string, string] | null = null;
  for (const entry of RECORD_FILE_CLASSES) if (key.startsWith(entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
  return best ? best[1] : 'unclassified';
}

/** Lower-case hex SHA-256 of the key: the ledger's only reference to the object (`file-recovery.py` hashes the same way). */
export async function suppressionKeyHash(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ACTORS: ReadonlySet<string> = new Set(['member', 'operator', 'system']);
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Delete `keys` from `bucket` for `reason`, writing one suppression-ledger row per key first.
 * Throws when the ledger write fails (and then deletes nothing, unless `reason` is `unreferenced`), and as
 * `R2Bucket.delete` throws.
 */
export async function eraseRecordObjects(bucket: Pick<R2Bucket, 'delete'>, keys: string | string[], reason: RecordErasureReason, ledger: RecordErasureLedger): Promise<void> {
  const list = Array.isArray(keys) ? keys : [keys];
  const count = list.length;
  if (!count) return;
  const requestId = ledger.requestId ?? `op:${crypto.randomUUID()}`;
  const actor = ledger.actor ?? 'system';
  if (!REQUEST_ID.test(requestId) || !ACTORS.has(actor)) throw new Error('record_erasure_ledger_invalid');
  const erasedAt = new Date().toISOString();
  const rows = await Promise.all(list.map(async (key) => ledger.db.prepare(
    'INSERT INTO record_suppression_ledger (bucket, key_hash, record_class, reason, request_id, actor, erased_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(SUPPRESSION_BUCKET, await suppressionKeyHash(key), recordClassOf(key), reason, requestId, actor, erasedAt)));
  // One batch is one D1 transaction: every row lands, or none does and nothing below runs.
  try {
    await ledger.db.batch(rows);
  } catch (error) {
    // A rollback's object was never a record (D6651): this request stored it a moment ago and no row names it.
    // Keeping it because D1 is failing would leave an orphan with personal data and nothing to find it by, so it
    // still goes. Every other reason erases an object that existed before the request: no row, no delete.
    if (reason !== 'unreferenced') throw error;
    console.warn(JSON.stringify({ event: 'record_rollback_unledgered', count }));
  }
  await bucket.delete(keys);
  console.log(JSON.stringify({ event: 'record_objects_erased', reason, count }));
}
