/**
 * D5568 part 2: the checkpoint pointer store on Durable Object storage transactions (owner answer A, 2026-11-15), beside
 * D5565's runner records in the same storage, so a runner generation bump fences checkpoint writers and GC with no
 * second call. Unmounted: no namespace, binding, route or migration; only tests construct it.
 */
import { CheckpointStoreRefusal, type CheckpointPointer, type CheckpointPointerStore } from './workspaceCheckpoint';
import type { RunnerRecord, RunnerStore } from './runnerProtocol';

export const POINTER_KEY_PREFIX = 'workspace-checkpoint-pointer-v1:';
export const RUNNER_KEY_PREFIX = 'workspace-runner-v1:';
const OBJECT_KEY = /^tenants\/([1-9][0-9]{0,15})\/workspace-checkpoints\/([A-Za-z0-9][A-Za-z0-9_.:-]{0,119})\/g[1-9][0-9]{0,15}\//;

/** Change callbacks are synchronous policy only; a promise is refused and the whole transaction rolls back. */
function synchronous<T>(result: T): T {
  if (result && typeof (result as { then?: unknown }).then === 'function') throw new CheckpointStoreRefusal('transaction_must_be_synchronous');
  return result;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Copies, so a change never mutates the stored snapshot it is compared against. */
const strip = <V>(stored: Map<string, V>, prefix: string) => new Map([...stored].map(([k, v]) => [k.slice(prefix.length), structuredClone(v)]));

/** D5565's `RunnerStore` on the same storage: one key per run, a generation that never decreases, no record removed. */
export class DurableRunnerStore implements RunnerStore {
  private readonly storage: DurableObjectStorage;
  constructor(storage: DurableObjectStorage) { this.storage = storage; }
  transaction<T>(change: (records: Map<string, RunnerRecord>) => T): Promise<T> {
    return this.storage.transaction(async txn => {
      const stored = await txn.list<RunnerRecord>({ prefix: RUNNER_KEY_PREFIX });
      const records = strip(stored, RUNNER_KEY_PREFIX);
      const result = synchronous(change(records));
      for (const key of stored.keys()) if (!records.has(key.slice(RUNNER_KEY_PREFIX.length))) throw new CheckpointStoreRefusal('runner_record_removed');
      for (const [run_id, record] of records) {
        const before = stored.get(RUNNER_KEY_PREFIX + run_id);
        if (record.spec.run_id !== run_id) throw new CheckpointStoreRefusal('run_contract_changed');
        if (before && record.spec.tenant_id !== before.spec.tenant_id) throw new CheckpointStoreRefusal('run_contract_changed');
        if (before && record.generation < before.generation) throw new CheckpointStoreRefusal('stale_generation');
        if (!same(before, record)) await txn.put(RUNNER_KEY_PREFIX + run_id, record);
      }
      return result;
    });
  }
}

/**
 * `CheckpointPointerStore` on one DO storage transaction. Before the change runs, each pointer's generation is raised to
 * its run's D5565 runner generation, so a reap or cancel committed earlier already fences every older writer and plan.
 * After it, the store refuses (throws, rolling everything back) a removed row, a changed tenant/run/origin, a lowered
 * generation, an undeleted tombstone, a head that goes backwards or advances at a generation other than the row's, and a
 * row below its runner's generation. Nothing outside this storage is read or written inside the transaction.
 */
export class DurableCheckpointPointerStore implements CheckpointPointerStore {
  private readonly storage: DurableObjectStorage;
  constructor(storage: DurableObjectStorage) { this.storage = storage; }
  transaction<T>(change: (rows: Map<string, CheckpointPointer>) => T): Promise<T> {
    return this.storage.transaction(async txn => {
      const stored = await txn.list<CheckpointPointer>({ prefix: POINTER_KEY_PREFIX });
      const runners = await txn.list<RunnerRecord>({ prefix: RUNNER_KEY_PREFIX });
      const runnerOf = (row: CheckpointPointer) => runners.get(RUNNER_KEY_PREFIX + row.run_id);
      const rows = strip(stored, POINTER_KEY_PREFIX);
      for (const row of rows.values()) {
        const runner = runnerOf(row);
        if (runner && runner.spec.tenant_id === row.tenant_id && runner.generation > row.generation) row.generation = runner.generation;
      }
      const result = synchronous(change(rows));
      for (const key of stored.keys()) if (!rows.has(key.slice(POINTER_KEY_PREFIX.length))) throw new CheckpointStoreRefusal('checkpoint_pointer_removed');
      for (const [key, row] of rows) {
        if (key !== `${row.tenant_id}/${row.run_id}`) throw new CheckpointStoreRefusal('checkpoint_pointer_key_mismatch');
        const runner = runnerOf(row), before = stored.get(POINTER_KEY_PREFIX + key);
        if (runner && runner.spec.tenant_id !== row.tenant_id) throw new CheckpointStoreRefusal('tenant_mismatch');
        if (runner && row.generation < runner.generation) throw new CheckpointStoreRefusal('stale_generation');
        const was = before?.head?.sequence ?? 0, now = row.head?.sequence ?? 0;
        if (before) {
          if (row.tenant_id !== before.tenant_id || row.run_id !== before.run_id || row.origin_region !== before.origin_region) throw new CheckpointStoreRefusal('run_contract_changed');
          if (row.generation < before.generation) throw new CheckpointStoreRefusal('stale_generation');
          if (before.deleted && !row.deleted) throw new CheckpointStoreRefusal('checkpoint_deleted');
          if (row.head && now < was) throw new CheckpointStoreRefusal('checkpoint_conflict');
        }
        if (row.head && now !== was && row.head.generation !== row.generation) throw new CheckpointStoreRefusal('stale_generation');
        if (!same(before, row)) await txn.put(POINTER_KEY_PREFIX + key, row);
      }
      return result;
    });
  }

  /**
   * The R2 adapter's delete fence: an object may be deleted only when its run's pointer exists for the same tenant and
   * the acknowledged head does not reference it. A new head can never reference an older key, because every commit
   * writes under its own `g<generation>/<token>/` prefix, so checking and then deleting is safe.
   */
  async mayDelete(objectKey: string): Promise<boolean> {
    const match = OBJECT_KEY.exec(objectKey);
    if (!match) return false;
    const tenant_id = Number(match[1]), run_id = match[2];
    return this.transaction(rows => {
      const row = rows.get(`${tenant_id}/${run_id}`);
      return !!row && row.tenant_id === tenant_id && !(row.head?.objects ?? []).includes(objectKey);
    });
  }
}
