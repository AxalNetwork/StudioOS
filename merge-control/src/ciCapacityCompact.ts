/** D8348: compact record of a passing request, so the full request can leave the store before the age limit
 * while its check can still be corrected. Store half only; nothing here publishes, validates or routes. */
import type { CapacityEvidence } from './ciCapacity.ts';
import { aggregateCapacity, receiptMatches } from './lib/ciCapacityPolicy.ts';
import type { Aggregate, CapacityRequest, CiAttempt, CiProfile, CiSubmission, ExecutionReceipt } from './lib/ciCapacityPolicy.ts';

export const CAPACITY_COMPACT_LIMIT = 32_768;
export const CAPACITY_COMPACT_PAGE = 100;
export const CAPACITY_COMPACT_EXPIRY_PAGE = 64;
export const CAPACITY_COMPACT_ATTEMPTS = 18;
export const CAPACITY_COMPACT_BYTES = 4_096;

export type CompactMode = 'pilot' | 'full-suite';
export type CompactAttempt = {
  logicalShard: string; generation: number; profile: CiProfile;
  childRunId: number; childAttempt: 1; startDeadline: number; executionDeadline: number;
  /** The shard's generation at handoff. History only: it grants no receipt, admission or late success. */
  current: boolean;
};
export type CompactRecord = {
  version: 1;
  /** The mode whose check this request was published under. A later configuration never reinterprets it. */
  publicationMode: CompactMode;
  /** Exactly as accepted, queue identity and child workflow revision included. */
  submission: CiSubmission;
  acceptedAt: number; completedAt: number; deadline: number;
  /** Every attempt that owned a child run. */
  attempts: CompactAttempt[];
};
export type CompactFailure = { logicalShard: string; generation: number; childRunId: number; jobId: number };
export type CompactView = CompactRecord & { failed: boolean; failure: CompactFailure | null };

/** Supplied by the composed publisher. Without one the store never compacts and never expires a compact record. */
export interface CapacityCompactConsumer {
  /** The validated publication mode, or null when it is not known. Null, or anything else, prevents compaction. */
  mode(): CompactMode | null;
  /** `owed`, `revisable` or `final` for a request held only as a compact record. Throwing counts as `owed`. */
  evidence(record: CompactView, superseded: boolean): CapacityEvidence;
}
export interface CapacityCompactStore {
  compactCount(): number;
  compact(id: string): CompactView | null;
  /** Identity order, strictly after `after`. At most CAPACITY_COMPACT_PAGE whatever `limit` asks. */
  compactPage(after: string, limit: number): CompactView[];
  /** Sticky negative truth. True when the record holds a failure after the call. */
  compactFailure(receipt: ExecutionReceipt, jobId: number): boolean;
}

const positive = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
const isMode = (mode: unknown): mode is CompactMode => mode === 'pilot' || mode === 'full-suite';
function bound(a: CiAttempt): ExecutionReceipt | null {
  if (a.childRunId === null) return null;
  const { phase: _phase, cancelDeadline: _cancelDeadline, reason: _reason, verifiedTestFailure: _failure, rejectedWorkflowSha: _rejected, ...receipt } = a;
  return { ...receipt, childRunId: a.childRunId };
}

/** The exact receipt of one preserved attempt, or null when the record holds no such attempt. */
export function compactReceipt(record: CompactRecord, logicalShard: string, generation: number): ExecutionReceipt | null {
  const a = record.attempts.find(attempt => attempt.logicalShard === logicalShard && attempt.generation === generation);
  if (!a) return null;
  const s = record.submission;
  return {
    version: 1, requestId: s.requestId, repository: s.repository, logicalShard: a.logicalShard,
    event: s.event, parentWorkflowId: s.parentWorkflowId, parentRunId: s.parentRunId, parentAttempt: s.parentAttempt,
    sourceSha: s.sourceSha, queueBaseSha: s.queueBaseSha, planDigest: s.planDigest, planArtifactId: s.planArtifactId,
    executorSha: s.executorSha, ...(s.childWorkflowSha === undefined ? {} : { childWorkflowSha: s.childWorkflowSha }),
    profile: a.profile, generation: a.generation, childRunId: a.childRunId, childAttempt: a.childAttempt,
    startDeadline: a.startDeadline, executionDeadline: a.executionDeadline,
  };
}

/** The preserved local result: a pass, lowered by a recorded failure or a newer parent attempt. It is not
 * fresh parent evidence, full-suite evidence or permission to publish. */
export function compactAggregate(view: CompactView, superseded: boolean): Aggregate {
  if (view.failed) return { status: 'failure', reason: 'verified_failure' };
  if (superseded) return { status: 'cancelled', reason: 'parent_inactive' };
  return { status: 'success', reason: 'entire_expected_set_verified' };
}

/** The compact record of a settled, passing request, or null when the request must stay whole.
 * Every owned attempt's receipt is rebuilt from the projection and compared with the original. */
export function compactProject(request: CapacityRequest, mode: unknown, superseded: boolean): CompactRecord | null {
  const s = request.submission;
  if (!isMode(mode) || request.completedAt === null) return null;
  // The pass must hold at the original completion snapshot, under the parent fence as it stands now.
  try {
    if (aggregateCapacity({ ...request, superseded: request.superseded || superseded }, request.completedAt).status !== 'success') return null;
  } catch { return null; } // A request the policy cannot read is not one to project.
  const all = request.shards.flatMap(shard => shard.attempts);
  if (all.some(a => a.rejectedWorkflowSha !== undefined)) return null;
  const attempts: CompactAttempt[] = [];
  for (const shard of request.shards) for (const a of shard.attempts) {
    if (a.childRunId === null) continue;
    attempts.push({ logicalShard: a.logicalShard, generation: a.generation, profile: a.profile, childRunId: a.childRunId,
      childAttempt: a.childAttempt, startDeadline: a.startDeadline, executionDeadline: a.executionDeadline,
      current: a.generation === shard.generation });
  }
  if (attempts.length === 0 || attempts.length > CAPACITY_COMPACT_ATTEMPTS) return null;
  if (new Set(attempts.map(a => `${a.logicalShard}\n${a.generation}`)).size !== attempts.length) return null;
  if (new Set(attempts.map(a => a.childRunId)).size !== attempts.length || !attempts.every(a => positive(a.childRunId))) return null;
  // Exactly one current owned attempt for each expected shard.
  if (s.shards.some(name => attempts.filter(a => a.logicalShard === name && a.current).length !== 1)
    || attempts.filter(a => a.current).length !== s.shards.length) return null;
  const record: CompactRecord = { version: 1, publicationMode: mode, submission: structuredClone(s),
    acceptedAt: request.acceptedAt, completedAt: request.completedAt, deadline: request.deadline, attempts };
  for (const a of all) {
    const original = bound(a);
    if (!original) continue;
    const rebuilt = compactReceipt(record, a.logicalShard, a.generation);
    // receiptMatches treats a missing child workflow revision as the executor's, so the key is compared too.
    if (!rebuilt || !receiptMatches(rebuilt, original) || rebuilt.childWorkflowSha !== original.childWorkflowSha) return null;
  }
  if (new TextEncoder().encode(compactEncode(record)).length > CAPACITY_COMPACT_BYTES) return null;
  return record;
}

type Encoded = { v: 1; m: CompactMode; s: CiSubmission; t: [number, number, number];
  a: [string, number, CiProfile, number, 1, number, number, 0 | 1][] };
/** The stored form: attempts as fixed-order rows, so eight of them cost about 1.3 KB instead of 2.1 KB. */
export function compactEncode(record: CompactRecord): string {
  const encoded: Encoded = { v: 1, m: record.publicationMode, s: record.submission, t: [record.acceptedAt, record.completedAt, record.deadline],
    a: record.attempts.map(a => [a.logicalShard, a.generation, a.profile, a.childRunId, a.childAttempt, a.startDeadline, a.executionDeadline, a.current ? 1 : 0]) };
  return JSON.stringify(encoded);
}
export function compactDecode(state: string): CompactRecord {
  const e = JSON.parse(state) as Encoded;
  if (e?.v !== 1 || !isMode(e.m) || !Array.isArray(e.a) || !Array.isArray(e.t)) throw new Error('capacity_compact_unreadable');
  return { version: 1, publicationMode: e.m, submission: e.s, acceptedAt: e.t[0], completedAt: e.t[1], deadline: e.t[2],
    attempts: e.a.map(([logicalShard, generation, profile, childRunId, childAttempt, startDeadline, executionDeadline, current]) =>
      ({ logicalShard, generation, profile, childRunId, childAttempt, startDeadline, executionDeadline, current: current === 1 })) };
}

type Row = { id: string; completed_at: number; failed: number; failure: string | null; state: string };
const view = (row: Row): CompactView => ({ ...compactDecode(row.state), failed: row.failed === 1,
  failure: row.failure === null ? null : JSON.parse(row.failure) as CompactFailure });

/** The compact table. Callers hold the transaction; the store runs the handoff and each update inside one. */
export class CapacityCompactTable {
  private readonly storage: Pick<DurableObjectStorage, 'sql'>;
  constructor(storage: Pick<DurableObjectStorage, 'sql'>) {
    this.storage = storage;
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS ci_capacity_compact (
      id TEXT PRIMARY KEY, completed_at INTEGER NOT NULL, failed INTEGER NOT NULL DEFAULT 0, failure TEXT, state TEXT NOT NULL)`);
    storage.sql.exec('CREATE INDEX IF NOT EXISTS ci_capacity_compact_expiry ON ci_capacity_compact(completed_at, id)');
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS ci_capacity_compact_cursor (
      name TEXT PRIMARY KEY CHECK (name = 'expiry'), completed_at INTEGER NOT NULL, id TEXT NOT NULL)`);
  }
  count(): number {
    return this.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM ci_capacity_compact').toArray()[0].n;
  }
  has(id: string): boolean {
    return this.storage.sql.exec('SELECT id FROM ci_capacity_compact WHERE id = ?', id).toArray().length > 0;
  }
  get(id: string): CompactView | null {
    const rows = this.storage.sql.exec<Row>('SELECT id, completed_at, failed, failure, state FROM ci_capacity_compact WHERE id = ?', id).toArray();
    return rows.length ? view(rows[0]) : null;
  }
  page(after: string, limit: number): CompactView[] {
    if (typeof after !== 'string' || !positive(limit)) throw new Error('capacity_compact_page');
    return this.storage.sql.exec<Row>(`SELECT id, completed_at, failed, failure, state FROM ci_capacity_compact
      WHERE id > ? ORDER BY id LIMIT ?`, after, Math.min(limit, CAPACITY_COMPACT_PAGE)).toArray().map(view);
  }
  /** A plain insert: an existing identity is a conflict the caller must have refused, never an overwrite. */
  insert(record: CompactRecord): void {
    this.storage.sql.exec('INSERT INTO ci_capacity_compact (id, completed_at, failed, failure, state) VALUES (?, ?, 0, NULL, ?)',
      record.submission.requestId, record.completedAt, compactEncode(record));
  }
  /** Sets the failure once. It never clears one, changes an identity or creates a record. The one stored
   * failure can show a different job only for the attempt it names; any other conflict is the caller's to refuse. */
  fail(receipt: ExecutionReceipt, jobId: number): boolean {
    if (!positive(jobId) || typeof receipt?.requestId !== 'string') return false;
    const record = this.get(receipt.requestId);
    if (!record) return false;
    const preserved = compactReceipt(record, receipt.logicalShard, receipt.generation);
    if (!preserved || !receiptMatches(preserved, receipt)) return false;
    if (record.failure) {
      const same = record.failure.logicalShard === preserved.logicalShard && record.failure.generation === preserved.generation;
      if (same && record.failure.jobId !== jobId) throw new Error('capacity_compact_conflict');
      return true;
    }
    const failure: CompactFailure = { logicalShard: preserved.logicalShard, generation: preserved.generation, childRunId: preserved.childRunId, jobId };
    this.storage.sql.exec('UPDATE ci_capacity_compact SET failed = 1, failure = ? WHERE id = ? AND failed = 0', JSON.stringify(failure), receipt.requestId);
    return true;
  }
  /** Visits at most one page of records past the age limit, after a durable cursor, and removes those whose
   * evidence is exactly `revisable` or `final`. Returns how many it read. */
  expire(before: number, evidence: (record: CompactView) => CapacityEvidence): number {
    const cursor = this.storage.sql.exec<{ completed_at: number; id: string }>(
      "SELECT completed_at, id FROM ci_capacity_compact_cursor WHERE name = 'expiry'").toArray()[0] ?? { completed_at: -1, id: '' };
    const rows = this.storage.sql.exec<Row>(`SELECT id, completed_at, failed, failure, state FROM ci_capacity_compact
      WHERE completed_at <= ? AND (completed_at > ? OR (completed_at = ? AND id > ?))
      ORDER BY completed_at, id LIMIT 64`, before, cursor.completed_at, cursor.completed_at, cursor.id).toArray();
    for (const row of rows) {
      let answer: CapacityEvidence = 'owed';
      try { answer = evidence(view(row)); } catch { /* Unreadable evidence keeps the record. */ }
      if (answer === 'revisable' || answer === 'final') this.storage.sql.exec('DELETE FROM ci_capacity_compact WHERE id = ?', row.id);
    }
    // A short page means the end was reached: the next visit starts again, so owed records are seen again.
    if (rows.length < CAPACITY_COMPACT_EXPIRY_PAGE) this.storage.sql.exec("DELETE FROM ci_capacity_compact_cursor WHERE name = 'expiry'");
    else this.storage.sql.exec("INSERT OR REPLACE INTO ci_capacity_compact_cursor (name, completed_at, id) VALUES ('expiry', ?, ?)", rows.at(-1)!.completed_at, rows.at(-1)!.id);
    return rows.length;
  }
}
