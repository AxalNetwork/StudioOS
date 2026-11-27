/**
 * D7109: the signed-event adapters for the manual "Fix conflicts" check. The webhook keeps only the verified fields
 * (`conflictIngress`); the repository object then publishes the advisory check on a conflict ejection, turns an
 * authorized click into one durable request, dispatches the conflict-only resolver once per request, and expires the
 * button when the pull request moves. Off unless MANUAL_CONFLICT_ENABLED is `true`; holds no model key.
 */
import { createHash } from 'node:crypto';
import { handleConflictCheckClick, handleConflictEjection } from './manualConflictActions.ts';
import type { ConflictActionServices, ConflictEjection, ConflictRequest } from './manualConflictActions.ts';
import { CONFLICT_CHECK_NAME, conflictCheckUpdate } from './lib/manualConflictCheck.ts';
import type { CheckAuthority, ConflictTarget, LiveQueuePull, SignedQueueEjection } from './lib/manualConflictCheck.ts';
import { GRAPHQL } from './github.ts';
import type { ConflictClickPayload, ConflictDelivery, Env, GithubApi } from './types.ts';

/** The conflict-only resolver (#6475). Its plan rechecks these pins, the switch and the queue before any model call. */
export const CONFLICT_WORKFLOW = 'landing-bot-conflict.yml';
/** Requests waiting for a dispatch. A full outbox refuses a new request (the Queue retries it) rather than drop one. */
export const MAX_PENDING = 20;
/** Published checks remembered per pull request, newest last, for expiry when it moves. */
const PER_PR = 10;
/** Pull request actions after which an offered button no longer matches the pull request. */
export const MOVED_ACTIONS = Object.freeze(['synchronize', 'enqueued', 'closed', 'converted_to_draft', 'edited']);

export type Ingress = ConflictDelivery | null | 'invalid' | 'ignore';
export type ConflictOutcome =
  | 'off' | 'not_configured' | 'ignored' | 'published' | 'recorded' | 'duplicate' | 'expired' | 'stale_expired';

export interface ConflictStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  /** One atomic write of several keys (Durable Object storage's `put(entries)`). */
  put(entries: Record<string, unknown>): Promise<void>;
}
interface StoredCheck { checkRunId: number; target: ConflictTarget; state: 'available' | 'requested' | 'expired' }
interface StoredRequest { request: ConflictRequest; dispatched: boolean }

const SHA = /^[a-f0-9]{40}$/;
/** The signed ejection snapshot for one removal, written before its check is published. */
const ejectionKey = (pr: number, removalId: string) => `conflict-ejection:${pr}:${removalId}`;
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const obj = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown, max: number) => typeof value === 'string' && value.length > 0 && value.length <= max;

export const manualConflictOn = (env: Pick<Env, 'MANUAL_CONFLICT_ENABLED'>) => String(env.MANUAL_CONFLICT_ENABLED) === 'true';

/** The App, installation and repository the check belongs to, from the owner's configuration; null if any is missing. */
export function conflictAuthority(env: Env): CheckAuthority | null {
  const id = (v: unknown) => (typeof v === 'string' && /^[1-9]\d{0,15}$/.test(v) ? Number(v) : null);
  const repositoryId = id(env.GITHUB_REPOSITORY_ID), appId = id(env.GITHUB_APP_ID), installationId = id(env.GITHUB_INSTALLATION_ID);
  if (!repositoryId || !appId || !installationId || typeof env.REPOSITORY !== 'string') return null;
  return { repository: env.REPOSITORY, repositoryId, appId, installationId };
}

/** GitHub writes the removal reason as an enum (`MERGE_CONFLICT`) in one API and words in another; one spelling here. */
export const normalizeReason = (reason: unknown) =>
  typeof reason === 'string' ? reason.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 64) : '';

/**
 * Called by the webhook after the signature check, on the parsed verified bytes. Returns the fields to enqueue, null
 * for an event this check does not read, 'invalid' for a malformed one (400) and 'ignore' for a check_run action that
 * is not a requested action (acknowledged, never enqueued).
 */
export function conflictIngress(event: string, payload: unknown): Ingress {
  const body = obj(payload);
  if (event === 'check_run') {
    if (body.action !== 'requested_action') return 'ignore';
    const check = obj(body.check_run), sender = obj(body.sender), repo = obj(body.repository);
    const identifier = obj(body.requested_action).identifier;
    if (!str(identifier, 20) || !positive(obj(body.installation).id) || !positive(repo.id) || !str(repo.full_name, 200) ||
        !positive(sender.id) || !str(sender.login, 100) || !str(sender.type, 20) || !positive(check.id) ||
        !str(check.name, 200) || !str(check.status, 20) || !(check.conclusion === null || str(check.conclusion, 20)) ||
        typeof check.head_sha !== 'string' || !SHA.test(check.head_sha) || !str(check.external_id, 400) ||
        !positive(obj(check.app).id)) return 'invalid';
    const payloadOut: ConflictClickPayload = {
      action: 'requested_action', requested_action: { identifier: identifier as string },
      installation: { id: obj(body.installation).id as number },
      repository: { id: repo.id as number, full_name: repo.full_name as string },
      sender: { id: sender.id as number, login: sender.login as string, type: sender.type as string },
      check_run: { id: check.id as number, name: check.name as string, status: check.status as string,
        conclusion: check.conclusion as string | null, head_sha: check.head_sha, external_id: check.external_id as string,
        app: { id: obj(check.app).id as number } },
    };
    return { kind: 'click', payload: payloadOut };
  }
  if (event !== 'pull_request') return null;
  const pr = obj(body.pull_request), head = obj(pr.head), base = obj(pr.base);
  if (body.action === 'dequeued') {
    const headRepo = head.repo === null ? null : obj(head.repo).id;
    if (!positive(pr.number) || typeof head.sha !== 'string' || !SHA.test(head.sha) || typeof base.sha !== 'string' ||
        !SHA.test(base.sha) || !str(base.ref, 255) || !positive(obj(body.repository).id) || !positive(obj(body.installation).id) ||
        !(headRepo === null || positive(headRepo)) || typeof body.reason !== 'string' || body.reason.length > 100) return 'invalid';
    return { kind: 'ejection', repositoryId: obj(body.repository).id as number, headRepositoryId: headRepo as number | null,
      installationId: obj(body.installation).id as number, pr: pr.number, headSha: head.sha, baseRef: base.ref as string,
      baseSha: base.sha, reason: normalizeReason(body.reason) };
  }
  if (MOVED_ACTIONS.includes(String(body.action))) return positive(pr.number) ? { kind: 'moved', pr: pr.number } : 'invalid';
  return null;
}

const PULL_QUERY = `query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){databaseId
  pullRequest(number:$n){number state isDraft isInMergeQueue mergeable baseRefName baseRefOid headRefOid headRepository{databaseId}
    timelineItems(last:1,itemTypes:[ADDED_TO_MERGE_QUEUE_EVENT,REMOVED_FROM_MERGE_QUEUE_EVENT]){nodes{__typename
      ... on AddedToMergeQueueEvent{id} ... on RemovedFromMergeQueueEvent{id reason beforeCommit{oid}}}}}}}`;

/** The live pull request and its latest queue transition (an addition included), in one GraphQL read. Throws on anything partial. */
export async function loadPull(api: GithubApi, repository: string, pr: number): Promise<LiveQueuePull> {
  const [owner, name] = repository.split('/');
  const result = obj(await api('POST', GRAPHQL, { query: PULL_QUERY, variables: { owner, name, n: pr } }));
  const repo = obj(obj(result.data).repository), pull = obj(repo.pullRequest);
  if (Array.isArray(result.errors) && result.errors.length) throw new Error('GraphQL errors');
  if (!positive(repo.databaseId) || pull.number !== pr || typeof pull.headRefOid !== 'string' || typeof pull.baseRefOid !== 'string') {
    throw new Error('incomplete pull request read');
  }
  const nodes = obj(pull.timelineItems).nodes;
  const last = Array.isArray(nodes) && nodes.length ? obj(nodes[nodes.length - 1]) : null;
  const headRepo = pull.headRepository === null ? null : obj(pull.headRepository).databaseId;
  return {
    repositoryId: repo.databaseId, headRepositoryId: positive(headRepo) ? headRepo : null, pr,
    headSha: pull.headRefOid, baseRef: String(pull.baseRefName ?? ''), baseSha: pull.baseRefOid,
    state: String(pull.state ?? ''), draft: pull.isDraft !== false, inMergeQueue: pull.isInMergeQueue !== false,
    mergeable: String(pull.mergeable ?? ''),
    latestQueueEvent: last && typeof last.id === 'string' ? {
      type: String(last.__typename ?? ''), id: last.id,
      reason: last.reason === undefined || last.reason === null ? null : normalizeReason(last.reason),
      beforeSha: typeof obj(last.beforeCommit).oid === 'string' ? obj(last.beforeCommit).oid as string : null,
    } : null,
    signedEjection: null,
  };
}

/** The workflow's request input: 16 hex characters of the request key, so a repeated dispatch is seen as the same request. */
export const requestId = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 16);

/** The durable state the actions need, on Durable Object storage. Every multi-key change is one `put(entries)`. */
export function conflictState(storage: ConflictStorage, authority: CheckAuthority, api: GithubApi): ConflictActionServices['state'] {
  return {
    async publishOnce(key, target, create) {
      const saved = await storage.get<StoredCheck>(`conflict-check:${key}`);
      if (saved) return { checkRunId: saved.checkRunId, target: saved.target };
      // A POST that succeeded before a storage failure: adopt the App's check with this external_id on this head.
      const listed = obj(await api('GET', `commits/${target.headSha}/check-runs?check_name=${encodeURIComponent(CONFLICT_CHECK_NAME)}&app_id=${authority.appId}&per_page=100`));
      const found = (Array.isArray(listed.check_runs) ? listed.check_runs : []).map(obj)
        .find((run) => run.external_id === key && obj(run.app).id === authority.appId && run.head_sha === target.headSha && positive(run.id));
      const checkRunId = found ? found.id as number : await create();
      const perPr = (await storage.get<string[]>(`conflict-pr:${target.pr}`)) ?? [];
      await storage.put({
        [`conflict-check:${key}`]: { checkRunId, target, state: 'available' } satisfies StoredCheck,
        [`conflict-check-id:${checkRunId}`]: key,
        [`conflict-pr:${target.pr}`]: [...perPr.filter((k) => k !== key), key].slice(-PER_PR),
      });
      return { checkRunId, target };
    },
    async lookup(checkRunId) {
      const key = await storage.get<string>(`conflict-check-id:${checkRunId}`);
      const saved = key ? await storage.get<StoredCheck>(`conflict-check:${key}`) : undefined;
      return saved ? { checkRunId: saved.checkRunId, target: saved.target } : null;
    },
    async requestOnce(request) {
      if (await storage.get<StoredRequest>(`conflict-request:${request.key}`)) return 'duplicate';
      const outbox = (await storage.get<string[]>('conflict-outbox')) ?? [];
      if (outbox.length >= MAX_PENDING) throw new Error('conflict request outbox is full');
      const saved = await storage.get<StoredCheck>(`conflict-check:${request.key}`);
      await storage.put({
        [`conflict-request:${request.key}`]: { request, dispatched: false } satisfies StoredRequest,
        'conflict-outbox': [...outbox, request.key],
        ...(saved ? { [`conflict-check:${request.key}`]: { ...saved, state: 'requested' } satisfies StoredCheck } : {}),
      });
      return 'recorded';
    },
  };
}

/**
 * Dispatch each recorded request once, in order. The resolver's plan revalidates the pins before it spends or writes,
 * and skips a request id it has already run, so a dispatch repeated after an ambiguous response costs nothing.
 */
export async function drainOutbox(storage: ConflictStorage, actions: GithubApi): Promise<number> {
  let outbox = (await storage.get<string[]>('conflict-outbox')) ?? [];
  let sent = 0;
  while (outbox.length) {
    const key = outbox[0];
    const saved = await storage.get<StoredRequest>(`conflict-request:${key}`);
    outbox = outbox.slice(1);
    if (saved && !saved.dispatched) {
      const t = saved.request.target;
      await actions('POST', `actions/workflows/${CONFLICT_WORKFLOW}/dispatches`, { ref: 'main', inputs: {
        pr: String(t.pr), expected_head: t.headSha, expected_base: t.expectedBaseSha, request: requestId(key) } });
      sent += 1;
      await storage.put({ [`conflict-request:${key}`]: { ...saved, dispatched: true }, 'conflict-outbox': outbox });
    } else {
      await storage.put({ 'conflict-outbox': outbox });
    }
  }
  return sent;
}

async function expire(storage: ConflictStorage, api: GithubApi, key: string): Promise<boolean> {
  const saved = await storage.get<StoredCheck>(`conflict-check:${key}`);
  if (saved?.state !== 'available') return false;
  await api('PATCH', `check-runs/${saved.checkRunId}`, conflictCheckUpdate(saved.target, 'expired'));
  await storage.put({ [`conflict-check:${key}`]: { ...saved, state: 'expired' } satisfies StoredCheck });
  return true;
}

const stillOffered = (target: ConflictTarget, live: LiveQueuePull) =>
  live.state === 'OPEN' && !live.draft && !live.inMergeQueue && live.mergeable === 'CONFLICTING' &&
  live.headSha === target.headSha && live.baseSha === target.expectedBaseSha &&
  live.latestQueueEvent?.id === target.removalId;

export interface ConflictClients { checks(): Promise<GithubApi>; actions(): Promise<GithubApi> }

/** One verified conflict delivery. Errors propagate so the Queue retries; every write is keyed, so a retry repeats none. */
export async function processConflict(
  env: Env, delivery: ConflictDelivery, storage: ConflictStorage, clients: ConflictClients,
): Promise<ConflictOutcome> {
  if (!manualConflictOn(env)) return 'off';
  const authority = conflictAuthority(env);
  if (!authority || authority.repository !== env.REPOSITORY) return 'not_configured';
  const api = await clients.checks();
  const reads = new Map<number, LiveQueuePull>();
  const deps: ConflictActionServices = {
    api, state: conflictState(storage, authority, api),
    // One read per pull request per delivery: the ejection is correlated and published on the same snapshot. The
    // signed snapshot recorded for the latest removal rides along, so a click is checked against the signed ejection.
    async loadPull(pr) {
      if (!reads.has(pr)) {
        const live = await loadPull(api, authority.repository, pr);
        const removal = live.latestQueueEvent?.id;
        const signed = removal ? await storage.get<SignedQueueEjection>(ejectionKey(pr, removal)) : undefined;
        reads.set(pr, { ...live, signedEjection: signed ?? null });
      }
      return reads.get(pr)!;
    },
  };
  let outcome: ConflictOutcome;
  if (delivery.kind === 'ejection') {
    const live = await deps.loadPull(delivery.pr);
    // GitHub computes mergeability after the removal; an uncomputed answer is retried, not taken as no conflict.
    if (live.mergeable === 'UNKNOWN') throw new Error('mergeability not computed yet');
    const removal = live.latestQueueEvent;
    if (removal?.type !== 'RemovedFromMergeQueueEvent' || delivery.headRepositoryId === null) outcome = 'ignored';
    else {
      const event: ConflictEjection = {
        repositoryId: delivery.repositoryId, headRepositoryId: delivery.headRepositoryId, installationId: delivery.installationId,
        pr: delivery.pr, headSha: delivery.headSha, baseRef: delivery.baseRef, baseSha: delivery.baseSha,
        removalId: removal.id, reason: delivery.reason,
      };
      const { installationId: _installation, reason: _reason, ...signed } = event;
      await storage.put({ [ejectionKey(event.pr, event.removalId)]: signed satisfies SignedQueueEjection });
      outcome = await handleConflictEjection(authority, event, deps);
    }
  } else if (delivery.kind === 'click') {
    outcome = await handleConflictCheckClick(authority, 'check_run', delivery.payload, deps);
    if (outcome === 'ignored') {
      // A click on a button that no longer matches the pull request removes the button; an unauthorized click changes nothing.
      const key = await storage.get<string>(`conflict-check-id:${delivery.payload.check_run.id}`);
      const saved = key ? await storage.get<StoredCheck>(`conflict-check:${key}`) : undefined;
      if (key && saved?.state === 'available' && !stillOffered(saved.target, await deps.loadPull(saved.target.pr)) &&
          await expire(storage, api, key)) outcome = 'stale_expired';
    }
  } else {
    // The button goes only when the pull request no longer matches it: a title edit leaves it, a push or re-queue removes it.
    let any = false;
    for (const key of (await storage.get<string[]>(`conflict-pr:${delivery.pr}`)) ?? []) {
      const saved = await storage.get<StoredCheck>(`conflict-check:${key}`);
      if (saved?.state !== 'available' || stillOffered(saved.target, await deps.loadPull(delivery.pr))) continue;
      any = (await expire(storage, api, key)) || any;
    }
    outcome = any ? 'expired' : 'ignored';
  }
  if (((await storage.get<string[]>('conflict-outbox')) ?? []).length) await drainOutbox(storage, await clients.actions());
  return outcome;
}
