/** D7887: durable CI coordinator core; no production adapter or result producer is enabled here. */
import {
  activeAttempt, admitReceipt, aggregateCapacity, applyObservation, selectPools, submissionMatches,
  validateCapacityPolicy,
} from './lib/ciCapacityPolicy.ts';
import type {
  Aggregate, CapacityInventory, CapacityPolicy, CapacityRequest, ChildObservation, CiAttempt,
  CiProvenance, CiSubmission, ExecutionReceipt, PrerequisiteResult,
} from './lib/ciCapacityPolicy.ts';

export interface CapacityStore {
  get(id: string): CapacityRequest | null;
  list(): CapacityRequest[];
  save(request: CapacityRequest): void;
}

/** Own table and transaction boundary, independent of issue leases and merge cancellation. */
export class SqlCapacityStore implements CapacityStore {
  private readonly storage: Pick<DurableObjectStorage, 'sql' | 'transactionSync'>;
  constructor(storage: Pick<DurableObjectStorage, 'sql' | 'transactionSync'>) {
    this.storage = storage;
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS ci_capacity_requests (
      id TEXT PRIMARY KEY, parent TEXT NOT NULL UNIQUE, state TEXT NOT NULL)`);
  }
  get(id: string): CapacityRequest | null {
    const rows = this.storage.sql.exec<{ state: string }>('SELECT state FROM ci_capacity_requests WHERE id = ?', id).toArray();
    return rows.length ? JSON.parse(rows[0].state) as CapacityRequest : null;
  }
  list(): CapacityRequest[] {
    // Fail closed at the storage bound. Reviewed archival is required before reaching it.
    const rows = this.storage.sql.exec<{ state: string }>('SELECT state FROM ci_capacity_requests ORDER BY id LIMIT 1001').toArray();
    if (rows.length > 1000) throw new Error('capacity_storage_bound');
    return rows.map(row => JSON.parse(row.state) as CapacityRequest);
  }
  save(request: CapacityRequest): void {
    const s = request.submission;
    this.storage.transactionSync(() => {
      this.storage.sql.exec(`INSERT INTO ci_capacity_requests (id, parent, state) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET state = excluded.state`,
      s.requestId, `${s.repository}:${s.parentRunId}:${s.parentAttempt}`, JSON.stringify(request));
    });
  }
}

/** Trusted adapters must authenticate and verify metadata, never echo a caller/webhook as proof.
 * Every network method must have a bounded timeout. Null means uncertain, not cancelled or passed.
 * A dispatch must return GitHub's exact created run ID; it must not poll from a hosted Actions job.
 */
export interface CapacityPorts {
  verify(input: CiSubmission): Promise<CiProvenance>;
  inventory(): Promise<CapacityInventory | null>;
  parent(input: CiSubmission): Promise<boolean>;
  prerequisites(input: CiSubmission): Promise<PrerequisiteResult[] | null>;
  dispatch(attempt: Readonly<CiAttempt>): Promise<number>;
  discover(attempt: Readonly<CiAttempt>): Promise<number | null>;
  observe(receipt: ExecutionReceipt): Promise<ChildObservation | null>;
  cancel(receipt: ExecutionReceipt): Promise<void>;
}

const terminal = (a: CiAttempt) => ['passed', 'failed', 'cancelled'].includes(a.phase);
const validRunId = (id: number) => Number.isSafeInteger(id) && id > 0;
const identity = (s: CiSubmission) => JSON.stringify({ ...s, shards: [...s.shards].sort(), prerequisites: [...s.prerequisites].sort() });

/** The owning DO must keep one coordinator instance and schedule bounded ticks with its durable alarm.
 * Effects are preceded by durable intent. Recovery never repeats an ambiguous dispatch.
 */
export class CiCapacity {
  private serial: Promise<unknown> = Promise.resolve();
  private readonly store: CapacityStore;
  private readonly ports: CapacityPorts;
  private readonly repository: string;
  private readonly policy: CapacityPolicy;
  private readonly now: () => number;
  constructor(store: CapacityStore, ports: CapacityPorts, repository: string, policy: CapacityPolicy, now: () => number = Date.now) {
    validateCapacityPolicy(policy);
    this.store = store; this.ports = ports; this.repository = repository;
    this.policy = structuredClone(policy); this.now = now;
  }

  private ordered<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.serial.then(fn);
    this.serial = result.catch(() => undefined);
    return result;
  }

  submit(input: CiSubmission): Promise<{ accepted: true; requestId: string }> {
    return this.ordered(async () => {
      const proof = await this.ports.verify(input);
      if (!submissionMatches(input, proof, this.repository)) throw new Error('capacity_submission_refused');
      const previous = this.store.get(input.requestId);
      if (previous) {
        if (identity(previous.submission) !== identity(input)) throw new Error('capacity_request_conflict');
        return { accepted: true, requestId: input.requestId };
      }
      const requests = this.store.list();
      if (requests.some(r => r.submission.parentRunId === input.parentRunId
        && r.submission.parentAttempt >= input.parentAttempt)) throw new Error('capacity_parent_conflict');
      const now = this.now();
      if (requests.filter(r => aggregateCapacity(r, now).status === 'pending' || r.shards.some(s => s.attempts.some(a => !terminal(a)))).length >= 8) {
        throw new Error('capacity_active_bound');
      }
      let inventory: CapacityInventory | null = null;
      try { inventory = await this.ports.inventory(); } catch { /* Unknown inventory chooses hosted before delegation. */ }
      const reservations: Record<string, number> = {};
      for (const request of requests) for (const shard of request.shards) for (const attempt of shard.attempts) {
        if (!terminal(attempt)) reservations[attempt.profile] = (reservations[attempt.profile] ?? 0) + 1;
      }
      const acceptedAt = this.now();
      const assignments = selectPools(input, proof.trustedSource, inventory, reservations, this.policy, acceptedAt);
      const request: CapacityRequest = {
        submission: structuredClone(input), acceptedAt, completedAt: null, deadline: acceptedAt + this.policy.budgets.queueMs,
        parentLive: true, trustedSource: proof.trustedSource, superseded: false, evidenceConflict: false,
        shards: [], prerequisites: input.prerequisites.map(name => ({ name, conclusion: 'pending' })),
      };
      request.shards = assignments.map(({ shard, profile }) => ({
        name: shard, generation: 1, attempts: [this.attempt(request, shard, profile, 1, acceptedAt)],
      }));
      // No remote effect occurs before this commit. Acceptance means submission, never tests passed.
      this.store.save(request);
      for (const old of requests.filter(r => r.submission.parentRunId === input.parentRunId && !r.superseded)) {
        old.superseded = true;
        this.store.save(old);
      }
      return { accepted: true, requestId: input.requestId };
    });
  }

  private attempt(request: CapacityRequest, shard: string, profile: CiAttempt['profile'], generation: number, now: number): CiAttempt {
    const s = request.submission;
    const b = this.policy.budgets;
    const startDeadline = now + (profile === 'hosted' ? b.hostedStartMs : b.externalStartMs);
    return {
      version: 1, requestId: s.requestId, repository: s.repository, logicalShard: shard,
      event: s.event, parentWorkflowId: s.parentWorkflowId, parentRunId: s.parentRunId, parentAttempt: s.parentAttempt,
      sourceSha: s.sourceSha, queueBaseSha: s.queueBaseSha, planDigest: s.planDigest, planArtifactId: s.planArtifactId, executorSha: s.executorSha,
      profile, generation, childRunId: null, childAttempt: 1, startDeadline,
      executionDeadline: startDeadline + (profile === 'hosted' ? b.hostedExecutionMs : b.externalExecutionMs),
      phase: 'reserved', cancelDeadline: null, reason: null,
    };
  }

  /** Authenticated child identity must be supplied by the future OIDC adapter, never request JSON. */
  receipt(requestId: string, shard: string, childRunId: number, childAttempt: number): Promise<ExecutionReceipt | null> {
    return this.ordered(async () => {
      const request = this.store.get(requestId);
      const logical = request?.shards.find(s => s.name === shard);
      if (!request || !logical || this.superseded(request)) return null;
      const attempt = activeAttempt(logical);
      if (attempt.childRunId !== childRunId || attempt.childAttempt !== childAttempt || attempt.childRunId === null) return null;
      let live = false;
      try { live = await this.ports.parent(request.submission); } catch { return null; }
      if (!live) { request.parentLive = false; this.store.save(request); return null; }
      const receipt = this.bound(attempt);
      return admitReceipt(request, receipt, this.now()) ? receipt : null;
    });
  }

  /** Authenticated webhook identity is only a hint; read GitHub again and constrain to an owned child. */
  reconcileChild(requestId: string, childRunId: number): Promise<boolean> {
    return this.ordered(async () => {
      const request = this.store.get(requestId);
      if (!request) return false;
      const attempt = request.shards.flatMap(s => s.attempts).find(a => a.childRunId === childRunId);
      if (!attempt) return false;
      const observation = await this.ports.observe(this.bound(attempt));
      if (!observation || !applyObservation(request, observation, this.now())) return false;
      if (aggregateCapacity(request, this.now()).status === 'success') request.completedAt ??= this.now();
      this.store.save(request);
      return true;
    });
  }

  private superseded(request: CapacityRequest): boolean {
    // Derived from committed parent identities as well as the cached flag. A crash between
    // accepting the new attempt and writing the old flag must never revive an old child.
    return request.superseded || this.store.list().some(r => r.submission.parentRunId === request.submission.parentRunId
      && r.submission.parentAttempt > request.submission.parentAttempt);
  }

  private bound(a: CiAttempt): ExecutionReceipt {
    if (a.childRunId === null) throw new Error('capacity_unbound_child');
    const { phase: _phase, cancelDeadline: _cancelDeadline, reason: _reason, ...receipt } = a;
    return { ...receipt, childRunId: a.childRunId };
  }

  status(id: string): Aggregate | null {
    const request = this.store.get(id);
    if (!request) return null;
    request.superseded = this.superseded(request);
    return aggregateCapacity(request, this.now());
  }

  /** Wakeups/events are hints. Only verified adapter observations change child outcomes. */
  tick(): Promise<number | null> {
    return this.ordered(async () => {
      let pending = false;
      // Bounded accepted population. The future adapter must also cap API calls per tick.
      for (const request of this.store.list()) {
        request.superseded = this.superseded(request);
        if (aggregateCapacity(request, this.now()).status === 'success') continue;
        if (aggregateCapacity(request, this.now()).status !== 'pending'
            && request.shards.every(s => s.attempts.every(terminal))) continue;
        pending = true;
        try { request.parentLive = request.parentLive && await this.ports.parent(request.submission); }
        catch { continue; } // No new dispatch/admission on unreadable parent metadata.
        try {
          const results = await this.ports.prerequisites(request.submission);
          if (results && results.length === request.submission.prerequisites.length
              && new Set(results.map(p => p.name)).size === results.length
              && results.every(p => request.submission.prerequisites.includes(p.name)
                && ['success', 'failure', 'pending'].includes(p.conclusion))) {
            for (const result of results) {
              const old = request.prerequisites.find(p => p.name === result.name)!;
              if (old.conclusion !== 'failure') old.conclusion = result.conclusion;
            }
          }
        } catch { /* Keep pending or previously verified failure. */ }
        this.store.save(request);
        for (const shard of request.shards) {
          // Recover observations from older owned children too. Contradictory test failure stays sticky.
          for (const previous of shard.attempts.filter(a => a.generation !== shard.generation && a.childRunId !== null)) {
            try {
              const observation = await this.ports.observe(this.bound(previous));
              if (observation) applyObservation(request, observation, this.now());
            } catch { /* Unknown is not success. */ }
          }
          let a = activeAttempt(shard);
          if (a.phase === 'dispatching') { a.phase = 'dispatch_unknown'; a.reason = 'dispatch_interrupted'; this.store.save(request); }
          if (a.phase === 'dispatch_unknown') {
            try {
              const id = await this.ports.discover(structuredClone(a));
              if (id !== null && validRunId(id)
                  && !this.store.list().some(r => r.shards.some(s => s.attempts.some(a => a.childRunId === id)))) { a.childRunId = id; a.phase = 'queued'; a.reason = null; this.store.save(request); }
            } catch { /* Never repeat a dispatch with an uncertain outcome. */ }
          }
          if (a.childRunId !== null && !terminal(a)) {
            try {
              const observation = await this.ports.observe(this.bound(a));
              if (observation) applyObservation(request, observation, this.now());
            } catch { /* Persisted deadlines below still apply during an API outage. */ }
          }
          const now = this.now();
          const aggregate = aggregateCapacity(request, now);
          const stopped = aggregate.status === 'failure' || aggregate.status === 'cancelled';
          if (a.phase === 'reserved' && (stopped || now >= a.startDeadline)) {
            a.phase = 'cancelled'; a.reason = stopped ? 'request_stopped' : 'not_dispatched';
          }
          if (a.childRunId !== null && !terminal(a) && (stopped
              || a.phase === 'cancelling' || a.phase === 'cancellation_unknown'
              || (a.phase === 'queued' && now >= a.startDeadline) || now >= a.executionDeadline)) {
            a.cancelDeadline ??= now + this.policy.budgets.cancellationMs;
            a.phase = now >= a.cancelDeadline ? 'cancellation_unknown' : 'cancelling';
            a.reason ??= stopped ? 'request_stopped' : 'lease_expired';
            this.store.save(request); // Fence receipt before cancellation, even if the API hangs/fails.
            try { await this.ports.cancel(this.bound(a)); } catch { /* Only observed termination permits fallback. */ }
          }
          if (!stopped && a.phase === 'cancelled' && a.profile !== 'hosted'
              && now + this.policy.budgets.hostedStartMs + this.policy.budgets.hostedExecutionMs
                + this.policy.budgets.controlMarginMs <= request.deadline) {
            shard.generation++;
            a = this.attempt(request, shard.name, 'hosted', shard.generation, now);
            shard.attempts.push(a);
            this.store.save(request); // New generation revokes every older receipt.
          }
          if (!stopped && a.phase === 'reserved') {
            let live = false;
            try { live = await this.ports.parent(request.submission); } catch { continue; }
            if (!live) { request.parentLive = false; this.store.save(request); continue; }
            a.phase = 'dispatching';
            this.store.save(request); // Durable reservation and dispatch intent precede the remote effect.
            try {
              const id = await this.ports.dispatch(structuredClone(a));
              if (!validRunId(id) || this.store.list().some(r => r.shards.some(s => s.attempts.some(a => a.childRunId === id)))) {
                throw new Error('capacity_dispatch_id_refused');
              }
              a.childRunId = id; a.phase = 'queued'; a.reason = null;
            } catch { a.phase = 'dispatch_unknown'; a.reason = 'dispatch_outcome_unknown'; }
            this.store.save(request); // Exact returned run ID is durable before any later observation/wait.
          }
          this.store.save(request);
        }
        if (aggregateCapacity(request, this.now()).status === 'success') {
          request.completedAt ??= this.now();
          this.store.save(request);
        }
      }
      return pending ? this.now() + this.policy.budgets.reconcileMs : null;
    });
  }
}
