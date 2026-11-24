/** Owner-only inspection and adoption of one independently discovered publication. */
import { createHash } from 'node:crypto';
import { FULL_CHECK, PILOT_CHECK, PUBLICATION_CREATE_LIMIT } from './ciCapacityOutbox.ts';
import type { SqlCapacityStore } from './ciCapacity.ts';
import type { CapacityApi } from './ciCapacityGithub.ts';
import type { SqlCapacityResults } from './lib/ciCapacityResults.ts';

type Mode = 'pilot' | 'full-suite';
type Config = { repository: string; repositoryId: number; publication: Mode; appId: number };
const PAGE = 32;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reasons = [
  'create_exhausted',
  'intent_unresolved',
  'mode_conflict',
  'negative_pending',
  'cleanup_unknown'
] as const;
type Reason = (typeof reasons)[number];

export class CapacityReconciliation {
  constructor(
    storage: DurableObjectStorage,
    store: SqlCapacityStore,
    results: SqlCapacityResults,
    config: Config
  ) {
    this.storage = storage;
    this.store = store;
    this.results = results;
    if (!Number.isSafeInteger(config.repositoryId) || config.repositoryId <= 0 ||
        !Number.isSafeInteger(config.appId) || config.appId <= 0) throw new Error('capacity_reconciliation_identity');
    this.config = config;
    this.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS capacity_publications (id TEXT PRIMARY KEY, state TEXT NOT NULL)'
    );
  }
  private storage: DurableObjectStorage;
  private store: SqlCapacityStore;
  private results: SqlCapacityResults;
  private config: Config;

  inspect(id: string) {
    if (!uuid.test(id)) throw new Error('invalid request identity');
    const full = this.store.get(id),
      compact = this.store.compact(id);
    const submission = (full ?? compact)?.submission;
    const { publication: mode, repository, repositoryId, appId } = this.config;
    const key = id + ':' + mode;
    const raw = this.storage.sql
      .exec<{ state: string }>('SELECT state FROM capacity_publications WHERE id=?', key)
      .toArray()[0]?.state;
    const issues: Reason[] = [];
    const other = this.storage.sql
      .exec(
        'SELECT id FROM capacity_publications WHERE id=?',
        id + ':' + (mode === 'pilot' ? 'full-suite' : 'pilot')
      )
      .toArray();
    if ((compact && compact.publicationMode !== mode) || other.length) issues.push('mode_conflict');
    let exhausted = false;
    let sentFailure = false;
    let locallyFailed =
      compact?.failed === true ||
      full?.shards.some((shard) =>
        shard.attempts.some((a) => a.phase === 'failed' || a.verifiedTestFailure === true)
      );
    try {
      const intent = JSON.parse(raw ?? 'null');
      const matches = intent?.requestId === id && intent.mode === mode && typeof intent.failed === 'boolean';
      exhausted =
        matches &&
        intent.phase === 'creating' &&
        intent.checkId === null &&
        intent.sent === null &&
        intent.createAttempts === PUBLICATION_CREATE_LIMIT &&
        Number.isSafeInteger(intent.lastCreateAt);
      if (matches && intent.failed) locallyFailed = true;
      const validCheck =
        matches && intent.phase === 'known' && Number.isSafeInteger(intent.checkId) && intent.checkId > 0;
      const sent = validCheck && typeof intent.sent === 'string' ? JSON.parse(intent.sent)?.status : null;
      sentFailure = sent === 'failure';
      if (exhausted) issues.push('create_exhausted');
      else if (!validCheck || !['pending', 'success', 'failure', 'cancelled'].includes(sent))
        issues.push('intent_unresolved');
    } catch {
      issues.push('intent_unresolved');
    }
    if (!submission || submission.requestId !== id || submission.repository !== repository || (full && compact)) {
      if (!issues.includes('intent_unresolved')) issues.push('intent_unresolved');
    }
    let resultUnreadable = false;
    try {
      if (this.results.pendingFailure(id) || (locallyFailed && !sentFailure)) issues.push('negative_pending');
    } catch {
      resultUnreadable = true;
      issues.push('negative_pending');
    }
    const cleanup = full?.shards.some((shard) =>
      shard.attempts.some((a) => ['dispatch_unknown', 'cancellation_unknown', 'cancelling'].includes(a.phase))
    );
    if (cleanup) issues.push('cleanup_unknown');
    const source = submission?.sourceSha;
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          repository,
          repositoryId,
          appId,
          key,
          submission?.parentRunId,
          submission?.parentAttempt,
          source,
          raw,
          issues
        ])
      )
      .digest('hex');
    const adoptable =
      !resultUnreadable &&
      exhausted &&
      !!source &&
      /^[0-9a-f]{40}$/.test(source) &&
      !issues.includes('mode_conflict') &&
      !issues.includes('intent_unresolved');
    return {
      key,
      source,
      parentRunId: submission?.parentRunId,
      parentAttempt: submission?.parentAttempt,
      issues,
      fingerprint,
      adoptable
    };
  }

  counts(after: string) {
    if (after !== '' && !uuid.test(after)) throw new Error('invalid cursor');
    // Read one bounded prefix from each primary key or request-owner index before merging.
    const owners = new Set<string>();
    for (const table of [
      'ci_capacity_requests',
      'ci_capacity_compact',
      'capacity_execution_results',
      'capacity_result_failures',
      'capacity_publications'
    ]) {
      const publication = table === 'capacity_publications';
      const column =
        table === 'capacity_execution_results' || table === 'capacity_result_failures' ? 'request_id' : 'id';
      const rows = this.storage.sql
        .exec<{
          id: string;
        }>(`SELECT DISTINCT ${column} AS id FROM ${table} WHERE ${column}>? ORDER BY ${column} LIMIT ?`, publication && after ? after + ':~' : after, publication ? 2 * (PAGE + 1) : PAGE + 1)
        .toArray();
      for (const row of rows) owners.add(publication ? row.id.split(':')[0] : row.id);
    }
    const ids = [...owners].sort(),
      page = ids.slice(0, PAGE);
    const counts = Object.fromEntries(reasons.map((reason) => [reason, 0])) as Record<Reason, number>;
    for (const id of page) for (const reason of this.inspect(id).issues) counts[reason]++;
    return { scanned: page.length, counts, next: ids.length > PAGE ? page.at(-1) : null };
  }

  async adopt(id: string, fingerprint: string, checkId: number, api: CapacityApi) {
    const before = this.inspect(id);
    if (!before.adoptable || before.fingerprint !== fingerprint || !Number.isSafeInteger(checkId) || checkId <= 0)
      return false;
    const { publication, appId, repository } = this.config;
    const name = publication === 'pilot' ? PILOT_CHECK : FULL_CHECK;
    const run = (await api(
      'GET',
      `/repos/${repository}/actions/runs/${before.parentRunId}/attempts/${before.parentAttempt}`
    )) as {
      id: number;
      run_attempt: number;
      head_sha: string;
      repository: { id: number; full_name: string };
    };
    if (
      run?.id !== before.parentRunId ||
      run.run_attempt !== before.parentAttempt ||
      run.head_sha !== before.source ||
      run.repository?.id !== this.config.repositoryId ||
      run.repository?.full_name !== repository
    )
      return false;
    const reply = (await api(
      'GET',
      `/repos/${repository}/commits/${before.source}/check-runs?check_name=${encodeURIComponent(name)}&filter=all&per_page=100`
    )) as {
      total_count: number;
      check_runs: { id: number; external_id: string; name: string; head_sha: string; app: { id: number } }[];
    };
    if (
      !Array.isArray(reply?.check_runs) ||
      reply.total_count !== reply.check_runs.length ||
      reply.total_count > 100
    )
      return false;
    const matches = reply.check_runs.filter(
      (c) => c.external_id === before.key && c.name === name && c.head_sha === before.source && c.app?.id === appId
    );
    if (matches.length !== 1 || matches[0].id !== checkId) return false;
    return this.storage.transactionSync(() => {
      const current = this.inspect(id);
      if (!current.adoptable || current.fingerprint !== fingerprint) return false;
      this.storage.sql.exec(
        `UPDATE capacity_publications
        SET state=json_set(state,'$.phase','known','$.checkId',?,
                           '$.ownerAdoption',json_object('observedAt',?,'priorFingerprint',?)) WHERE id=?`,
        checkId,
        Date.now(),
        fingerprint,
        current.key
      );
      return true;
    });
  }
}
