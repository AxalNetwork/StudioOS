/**
 * D5568 part 2: `CheckpointObjectStore` over an injected R2-shaped bucket. Every put carries its SHA-256 (R2 verifies it on
 * write) and is read back and re-hashed; every get re-hashes against the recorded checksum; list reads one tenant/run
 * prefix; delete asks the pointer store's fence first. Keys live under an operator-chosen namespace. Unmounted: no
 * bucket, binding or wrangler.toml entry exists; only tests construct it.
 */
import { CheckpointStoreRefusal, type CheckpointObjectStore } from './workspaceCheckpoint';
import { sha256Hex } from './workspaceGitCache';

/** The subset of R2Bucket this adapter uses; a real R2Bucket satisfies it (checked below at compile time). */
export interface CheckpointBucket {
  put(key: string, value: Uint8Array, options: { sha256: string; customMetadata: Record<string, string> }): Promise<{ key: string; size: number } | null>;
  get(key: string): Promise<{ size: number; customMetadata?: Record<string, string>; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  list(options: { prefix: string; cursor?: string; limit?: number; include?: ('customMetadata')[] }): Promise<{ objects: { key: string; size: number }[]; truncated: boolean; cursor?: string }>;
  delete(key: string): Promise<void>;
}
type R2Satisfies = R2Bucket extends CheckpointBucket ? true : never;
const r2Satisfies: R2Satisfies = true;
void r2Satisfies;

/** The delete fence; `DurableCheckpointPointerStore.mayDelete` implements it. */
export interface CheckpointDeleteFence { mayDelete(key: string): Promise<boolean> }

const NAMESPACE = /^[a-z][a-z0-9-]{0,31}$/;
const REF = '[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}';
const ID = '[1-9][0-9]{0,15}';
const OBJECT_KEY = new RegExp(`^tenants/${ID}/workspace-checkpoints/${REF}/g${ID}/${REF}/(?:blobs/[a-f0-9]{64}|manifest\\.json)$`);
const RUN_PREFIX = new RegExp(`^tenants/${ID}/workspace-checkpoints/${REF}/$`);
const HEX64 = /^[a-f0-9]{64}$/;
export const CHECKPOINT_LIST_PAGE = 1000;
export const CHECKPOINT_LIST_MAX_PAGES = 100;

export function createR2CheckpointObjectStore({ bucket, namespace, fence }: { bucket: CheckpointBucket; namespace: string; fence: CheckpointDeleteFence }): CheckpointObjectStore {
  if (!NAMESPACE.test(namespace)) throw new Error('Invalid checkpoint namespace');
  const root = `${namespace}/`;
  const scoped = (key: string) => {
    if (typeof key !== 'string' || !OBJECT_KEY.test(key)) throw new CheckpointStoreRefusal('checkpoint_key_out_of_scope');
    return root + key;
  };
  /** Null when absent. A body whose bytes do not hash to the recorded checksum (or the one expected) is refused. */
  async function readVerified(key: string, expected?: string): Promise<Uint8Array | null> {
    const object = await bucket.get(scoped(key));
    if (!object) return null;
    const bytes = new Uint8Array(await object.arrayBuffer()), recorded = object.customMetadata?.sha256;
    if (!recorded || !HEX64.test(recorded) || (expected !== undefined && recorded !== expected) || await sha256Hex(bytes) !== recorded) throw new CheckpointStoreRefusal('checksum_mismatch');
    return bytes;
  }
  return {
    async put(key, bytes, meta) {
      const target = scoped(key);
      if (!HEX64.test(meta?.sha256 ?? '') || await sha256Hex(bytes) !== meta.sha256) throw new CheckpointStoreRefusal('checksum_mismatch');
      const written = await bucket.put(target, bytes, { sha256: meta.sha256, customMetadata: { sha256: meta.sha256 } });
      if (!written) throw new CheckpointStoreRefusal('checkpoint_upload_interrupted');
      if (!await readVerified(key, meta.sha256)) throw new CheckpointStoreRefusal('checkpoint_object_missing');
    },
    get: key => readVerified(key),
    async list(prefix) {
      if (typeof prefix !== 'string' || !RUN_PREFIX.test(prefix)) throw new CheckpointStoreRefusal('checkpoint_prefix_out_of_scope');
      const out: { key: string; size: number }[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < CHECKPOINT_LIST_MAX_PAGES; page++) {
        const listed = await bucket.list({ prefix: root + prefix, cursor, limit: CHECKPOINT_LIST_PAGE });
        for (const o of listed.objects) {
          if (!o.key.startsWith(root + prefix)) throw new CheckpointStoreRefusal('checkpoint_prefix_out_of_scope');
          out.push({ key: o.key.slice(root.length), size: o.size });
        }
        if (!listed.truncated) return out;
        if (!listed.cursor) throw new CheckpointStoreRefusal('checkpoint_list_incomplete');
        cursor = listed.cursor;
      }
      throw new CheckpointStoreRefusal('checkpoint_list_too_large');
    },
    async delete(key) {
      const target = scoped(key);
      if (!await fence.mayDelete(key)) throw new CheckpointStoreRefusal('stale_gc');
      await bucket.delete(target);
    },
  };
}
