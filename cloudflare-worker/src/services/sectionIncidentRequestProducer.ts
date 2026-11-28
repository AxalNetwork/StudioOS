/** D5981 (#5981): server failures of authenticated API operations, as section incident episodes in the D5979 outbox. */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { decideSectionIncident } from './sectionIncidentRules';
import { enqueueSectionIncident } from './sectionIncidentOutbox';

/** What the observability middleware knows once the response exists. Nothing here comes from the request's content. */
export type RequestOperation = {
  method: string;
  /** Hono's matched route pattern (`/api/deals/:id`), never the request path. */
  routePattern: string | null | undefined;
  status: number;
  errored: boolean;
  authenticated: boolean;
};

export type ProducerResult = 'off' | 'skipped' | 'dropped' | 'counted' | 'sampled_out' | 'enqueued' | 'failed';

type Dependencies = {
  decide: typeof decideSectionIncident;
  enqueue: typeof enqueueSectionIncident;
};

// Proposed for owner review (D5981): per isolate, at most SAMPLE_LIMIT episode
// observations per operation per SAMPLE_WINDOW_MS. Every further failure is counted.
export const SAMPLE_WINDOW_MS = 60_000;
export const SAMPLE_LIMIT = 5;
const MAX_KEYS = 256;
const START = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

const counters = new Map<string, number>();
const windows = new Map<string, { opened: number; admitted: number }>();

/** Counts of events that were not enqueued, keyed `section|reason`. #5982's digest is their durable home. */
export function sectionIncidentRequestCounts(): Record<string, number> {
  return Object.fromEntries(counters);
}

export function resetSectionIncidentRequestProducer(): void {
  counters.clear();
  windows.clear();
}

/** Off unless the start time is set, well formed and reached, and never on a branch Worker. */
export function requestIncidentProducerActive(env: Env, now: Date): boolean {
  const start = env.AXAL_SECTION_REQUEST_INCIDENT_START_UTC;
  if (!start || !START.test(start)) return false;
  try {
    if (branchOf(env)) return false;
  } catch {
    return false;
  }
  const at = Date.parse(start);
  return Number.isFinite(at) && now.getTime() >= at;
}

function count(section: string, reason: string) {
  const key = `${section}|${reason}`;
  if (!counters.has(key) && counters.size >= MAX_KEYS) return;
  counters.set(key, Math.min((counters.get(key) ?? 0) + 1, Number.MAX_SAFE_INTEGER));
}

function admit(operation: string, instant: number): boolean {
  const current = windows.get(operation);
  if (!current || instant - current.opened >= SAMPLE_WINDOW_MS) {
    if (!current && windows.size >= MAX_KEYS) windows.clear();
    windows.set(operation, { opened: instant, admitted: 1 });
    return true;
  }
  if (current.admitted >= SAMPLE_LIMIT) return false;
  current.admitted += 1;
  return true;
}

/** The operation is the method and the route table's pattern. An unmatched request is one operation. */
function operationOf(method: string, pattern: string | null | undefined): string {
  const verb = METHODS.has(method) ? method : 'OTHER';
  const route = typeof pattern === 'string' && pattern.startsWith('/') && !pattern.includes('*') && pattern.length <= 200
    ? pattern : 'unmatched';
  return `${verb} ${route}`;
}

async function sha256(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Call after the response exists, inside the middleware's background task.
 * It never throws and never awaits storage: the outbox write is registered with `waitUntil`.
 */
export async function produceRequestSectionIncident(
  env: Env,
  context: Pick<ExecutionContext, 'waitUntil'>,
  operation: RequestOperation,
  now: Date = new Date(),
  deps: Dependencies = { decide: decideSectionIncident, enqueue: enqueueSectionIncident },
): Promise<ProducerResult> {
  try {
    if (!requestIncidentProducerActive(env, now)) return 'off';
    // D5980: the producer verifies identity before calling the rules.
    if (!operation.authenticated) return 'skipped';
    const failed = operation.errored || operation.status >= 500;
    const rejected = !failed && operation.status >= 400 && operation.status <= 499;
    if (!failed && !rejected) return 'skipped';
    // No audience or section yet: #5682 maps route families. The rules send it to platform triage.
    const decision = deps.decide({ source: 'server_operation', outcome: failed ? 'confirmed_impact' : 'expected_4xx', occurrences: 1 });
    if (decision.action === 'drop') return 'dropped';
    if (decision.action === 'count_only') {
      count(decision.event.slug, decision.event.outcome);
      return 'counted';
    }
    if (decision.stage !== 'impact') return 'dropped';
    const digest = await sha256(operationOf(operation.method, operation.routePattern));
    if (!admit(digest, now.getTime())) {
      count(decision.event.slug, 'sampled_out');
      return 'sampled_out';
    }
    const day = now.toISOString().slice(0, 10).replaceAll('-', '');
    deps.enqueue(env, context, {
      episodeId: `request-${digest.slice(0, 24)}-${day}`,
      eventId: crypto.randomUUID(),
      fingerprint: `server_operation-${digest.slice(0, 32)}`,
      section: decision.event.slug,
      kind: 'occurrence',
    });
    return 'enqueued';
  } catch {
    console.warn('[section-incident-request] producer failed', { count: 1 });
    return 'failed';
  }
}
