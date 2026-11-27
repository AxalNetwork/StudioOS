/**
 * D5586 part 4 (#5586): the venture's swarm capacity read, mounted at /api/work-graph/swarm. Read-only: nothing here
 * requests, promotes, settles or withdraws a ticket. OFF BY DEFAULT: unless `WORK_GRAPH_SWARM_READ` is exactly `on`,
 * every route answers 404 `swarm_read_off` before it reads a session or anything in D1. Decision:
 * `documentation/architecture/decisions/D5586-p4.md`.
 *
 *   GET /capacity?tenant_id&company_id[&since]   the coordinator's snapshot of this venture, as the capacity read model
 *                                                (per modality, team, provider, budget, storage, backlog, costs,
 *                                                alerts), the bottleneck signals since `since` (default 7 days, at
 *                                                most 30) and part 4's recorders
 *   GET /audit?tenant_id&company_id[&ticket_uid][&limit]   the venture's admission audit: D1's copy
 *                                                (`swarm_admission_events`) and the in-state entries not yet copied
 *
 * GATE, in order: a session (`requireAuth`); a link to the company that is not archived (`resolveActiveCompany`); the
 * role that runs the company's work, Owner, Admin, Founder or the primary admin (`canEditAsMember`, the role that
 * manages its team agents); and the company's WorkGraph records do not live under another tenant than the one named.
 * Any failure is the same 404 `not_found`, so a caller cannot tell a company they are not in from one under another
 * tenant, or from one that does not exist. Being a platform admin adds nothing: HQ has its own views.
 *
 * SCOPE. The scope every read uses is the one the gate checked, never a body's. The coordinator answers only that
 * venture's tickets and audit (`swarmSnapshotFor`), and every D1 statement is bound to its tenant and company.
 *
 * NOT ZERO. A figure nothing records is `not_recorded`; one whose record could not be read is `unavailable`. A
 * coordinator that cannot be reached makes the snapshot sections `unavailable` and leaves D1's reads standing.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { resolveActiveCompany } from '../middleware/activeCompany';
import { canEditAsMember } from '../services/companyAccess';
import { scopeFrom } from '../services/workGraphReleaseAdmin';
import type { Scope } from '../services/workGraphContracts';
import { swarmSnapshotFor } from '../services/agents/workspaceAdmissionClient';
import { ventureKey } from '../services/agents/swarmAdmission';
import { readSwarmAdmissionEvents } from '../services/agents/swarmAudit';
import { capacityReadModel, readBottlenecks } from '../services/agents/swarmCapacity';
import { SWARM_RETENTION_MS } from '../services/agents/swarmRetention';
import { readImageModelCapacity, readRegisteredAgents } from '../services/agents/swarmRecorders';

const r = new Hono<{ Bindings: Env }>();

/** The clock the routes read; tests set a fixed one (D5614: no real clock in tests). */
export const SWARM_READ_DEPS = { now: (): number => Date.now() };

export const swarmReadEnabled = (env: Pick<Env, 'WORK_GRAPH_SWARM_READ'> | undefined) => env?.WORK_GRAPH_SWARM_READ === 'on';
/** The bottleneck window: 7 days unless `since` names a later start; never more than 30 days back. */
export const SWARM_READ_WINDOW = Object.freeze({ defaultMs: 7 * 86_400_000, maxMs: 30 * 86_400_000 });
/** The signals no table records yet (D5586-p4 §4), named so a reader sees what is missing rather than a 0. */
export const SWARM_NOT_RECORDED = Object.freeze(['github_pr_ci_wait', 'preview_transcoding', 'egress', 'venture_policy',
  'cost:ci_minutes', 'cost:stream_output', 'cost:egress', 'cost:storage_gb_month'] as const);

r.use('*', async (c, next) => {
  if (!swarmReadEnabled(c.env)) return refuse(c, 404, { code: 'swarm_read_off', message: 'The swarm capacity read is not enabled on this deployment.' });
  await next();
});

const notFound = (c: Context) => refuse(c, 404, { code: 'not_found', message: 'There is no such venture.' });
const badScope = (c: Context) => refuse(c, 400, { code: 'malformed', message: 'Name the venture: tenant_id and company_id, both positive integers.' });

/** True when the company's WorkGraph or swarm records live under another tenant than the one named. */
async function heldElsewhere(env: Env, scope: Scope): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS one FROM work_graph_assets WHERE company_id = ? AND tenant_id <> ?
     UNION ALL SELECT 1 FROM work_graph_release_lines WHERE company_id = ? AND tenant_id <> ?
     UNION ALL SELECT 1 FROM swarm_admission_events WHERE company_id = ? AND tenant_id <> ? LIMIT 1`,
  ).bind(scope.companyId, scope.tenantId, scope.companyId, scope.tenantId, scope.companyId, scope.tenantId).first();
  return !!row;
}

/** The gate (see the header). Null is the one 404 for every failure. */
async function gate(c: Context<{ Bindings: Env }>): Promise<{ scope: Scope } | { refusal: Response }> {
  const user = await requireAuth(c);
  const scope = scopeFrom(c.req.query('tenant_id'), c.req.query('company_id'));
  if (!scope) return { refusal: badScope(c) };
  if (await resolveActiveCompany(c.env, { id: Number(user.id) }, String(scope.companyId)) === null) return { refusal: notFound(c) };
  if (!(await canEditAsMember(c.env, { id: scope.companyId }, user))) return { refusal: notFound(c) };
  if (await heldElsewhere(c.env, scope)) return { refusal: notFound(c) };
  return { scope };
}

r.get('/capacity', async (c) => {
  const g = await gate(c);
  if ('refusal' in g) return g.refusal;
  const { scope } = g;
  const now = SWARM_READ_DEPS.now();
  const sinceRaw = c.req.query('since');
  const sinceMs = sinceRaw === undefined ? now - SWARM_READ_WINDOW.defaultMs : Date.parse(sinceRaw);
  if (!Number.isFinite(sinceMs) || sinceMs > now) return refuse(c, 400, { code: 'malformed', message: '`since` is a past ISO time.' });
  const sinceIso = new Date(Math.max(sinceMs, now - SWARM_READ_WINDOW.maxMs)).toISOString();
  const venture = { tenant_id: scope.tenantId, company_id: scope.companyId };

  const [snapshot, bottlenecks, registered, image] = await Promise.all([
    swarmSnapshotFor(c.env, scope),
    readBottlenecks(c.env, { scope }, scope, sinceIso, now).catch(() => null),
    readRegisteredAgents(c.env, scope),
    readImageModelCapacity(c.env, scope, sinceIso),
  ]);
  const signals = bottlenecks && bottlenecks.ok ? { ...bottlenecks.bottlenecks, image_model_capacity: image } : null;
  const agents = typeof registered === 'object' ? registered.registered : null;
  let capacity: unknown = 'unavailable';
  let retention: unknown = 'unavailable';
  if (snapshot.ok) {
    const model = capacityReadModel({ swarm: snapshot.value, now, halted: false, scope: venture, ventures: {}, registeredAgents: agents, bottlenecks: signals });
    // An agent count that could not be read is `unavailable`, not the read model's `not_recorded`.
    capacity = { ...model, registered_agents: typeof registered === 'object' ? registered.registered : registered };
    const key = ventureKey(venture), retired = snapshot.value.retired;
    retention = { retention_ms: SWARM_RETENTION_MS, retired_tickets: retired?.tickets[key] ?? 0, retired_charged_microusd: retired?.charged[key] ?? 0 };
  }
  return c.json({
    ok: true, preview: true, scope: venture, since: sinceIso,
    admission: snapshot.ok ? 'read' : { state: 'unavailable', code: snapshot.code },
    capacity,
    bottlenecks: signals ?? 'unavailable',
    registered_agents: registered,
    retention,
    // The policy (concurrency, budget, storage quota) has no broker record yet, so budget and storage are not_recorded.
    not_recorded: SWARM_NOT_RECORDED,
  });
});

r.get('/audit', async (c) => {
  const g = await gate(c);
  if ('refusal' in g) return g.refusal;
  const { scope } = g;
  const uid = c.req.query('ticket_uid');
  if (uid !== undefined && !/^[A-Za-z0-9_.:-]{1,200}$/.test(uid)) return refuse(c, 400, { code: 'malformed', message: '`ticket_uid` is not a ticket uid.' });
  const lim = Number(c.req.query('limit'));
  const limit = Number.isSafeInteger(lim) && lim > 0 ? Math.min(lim, 500) : 200;
  const [copied, snapshot] = await Promise.all([
    readSwarmAdmissionEvents(c.env, { scope }, scope, { ...(uid ? { ticket_uids: [uid] } : {}), limit }),
    swarmSnapshotFor(c.env, scope),
  ]);
  const flushed = snapshot.ok ? snapshot.value.audit_flushed_seq ?? 0 : null;
  return c.json({
    ok: true, preview: true, scope: { tenant_id: scope.tenantId, company_id: scope.companyId },
    events: copied.ok ? copied.events : 'unavailable',
    // Entries the coordinator holds that D1 does not yet: the next swarm call copies them.
    pending_copy: snapshot.ok
      ? snapshot.value.audit.filter(e => e.seq > (flushed as number) && (!uid || e.ticket_uid === uid)).slice(0, limit)
      : 'unavailable',
  });
});

export default r;
export const mount: RouteMount = { path: '/api/work-graph/swarm', router: r };
