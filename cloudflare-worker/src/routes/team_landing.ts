/**
 * D5624 (#5624) — a team's Landing settings: repository, landing tiers and T2
 * signers, repair, path owners, per-repository concurrency, compute budget and
 * executors. Contract: `merge-control/contract/landingPolicy.ts`. Nothing here
 * enforces them yet (#5570, #5580); this is the store and its gates.
 *
 *   GET  /api/teams/:scope/:id/landing   read    { landing, version, updated_at, defaults, caps, can_manage }
 *   PUT  /api/teams/:scope/:id/landing   manage  body: the fields to change, null resets one;
 *                                                optional `version` (the one read) makes a stale save 409 landing_changed
 *
 * 404 `team_landing_off` unless TEAM_LANDING is "true" and the agent engine is
 * on (`agentEngineEnabled`). `:scope` is `company` (uid) or `project` (id), and
 * the gates are the `/engine` pair's (`services/agents/teams.ts`), except that a
 * caller who cannot read the team gets 404, not 403. 400 `invalid_landing`
 * carries `field`. Every save writes the row and one change-log row (actor,
 * before, after) in one batch, or neither.
 *
 * Mounted before `agent_engine.ts` (and so before `team_agents.ts`, whose `*`
 * middleware answers `team_agents_off` for every `/api/teams` path it reaches).
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { mapError } from './_t13t14t15_helpers';
import agentEngineRoutes, { agentEngineEnabled } from './agent_engine';
import { canManage, canRead, loadScope, onTeam, type Scope } from '../services/agents/teams';
import { PROVIDERS } from '../services/agents/workspaceSpec';
import {
  HQ_LANDING_CAPS, LANDING_DEFAULTS, UNSET_POLICY, validateLandingPolicy,
  type ActorRef, type LandingCaps, type LandingPolicy,
} from '../../../merge-control/contract/landingPolicy';

type C = Context<{ Bindings: Env }>;

export const teamLandingEnabled = (env: Env) => env.TEAM_LANDING === 'true' && agentEngineEnabled(env);

/** HQ's bounds: the contract's caps, and the executor ids D5565 registers. */
export const landingCaps = (): LandingCaps => ({ ...HQ_LANDING_CAPS, executors: PROVIDERS });

type Row = {
  id: number; version: number; updated_at: string;
  repository_ref: string | null; landing_json: string | null; repair_json: string | null; path_owners_json: string | null;
  max_parallel_per_repo: number | null; compute_budget_microusd: number | null; executors_json: string | null;
};

const cols = (s: Scope): [string, number | null, number | null] => (s.kind === 'company' ? ['company', s.id, null] : ['project', null, s.id]);

const json = (s: string | null) => (s === null ? null : JSON.parse(s));

/** The stored policy; every field null when there is no row. Throws when unreadable. */
async function readLanding(env: Env, s: Scope): Promise<{ policy: LandingPolicy; version: number; updated_at: string | null }> {
  const row = await env.DB.prepare(
    `SELECT id, version, updated_at, repository_ref, landing_json, repair_json, path_owners_json,
            max_parallel_per_repo, compute_budget_microusd, executors_json
       FROM agent_landing_settings WHERE scope_kind = ? AND IFNULL(company_id, 0) = IFNULL(?, 0) AND IFNULL(project_id, 0) = IFNULL(?, 0)`,
  ).bind(...cols(s)).first<Row>();
  if (!row) return { policy: { ...UNSET_POLICY }, version: 0, updated_at: null };
  return {
    policy: {
      repository: row.repository_ref,
      landing: json(row.landing_json),
      repair: json(row.repair_json),
      path_owners: json(row.path_owners_json),
      max_parallel_per_repo: row.max_parallel_per_repo,
      compute_budget_microusd: row.compute_budget_microusd,
      executors: json(row.executors_json),
    },
    version: row.version,
    updated_at: row.updated_at,
  };
}

/** The connected repository record, when it is this team's and current (D5569's joins). */
async function repositoryOfScope(env: Env, s: Scope, uid: string): Promise<boolean> {
  const r = await env.DB.prepare(
    `SELECT 1 AS ok FROM venture_git_installations i
       JOIN projects p ON p.id = i.project_id AND p.company_id = i.company_id
       JOIN company_profiles c ON c.id = i.company_id
      WHERE i.uid = ? AND i.revoked_at IS NULL AND p.deleted_at IS NULL AND COALESCE(c.archived_at, '') = ''
        AND ((? = 'company' AND i.company_id = ?) OR (? = 'project' AND i.project_id = ?))`,
  ).bind(uid, s.kind, s.id, s.kind, s.id).first<{ ok: number }>();
  return !!r;
}

/** A person on this team's seats (never an agent: agents are not users). */
async function personOnTeam(env: Env, s: Scope, uid: string): Promise<boolean> {
  const u = await env.DB.prepare('SELECT id FROM users WHERE uid = ?').bind(uid).first<{ id: number }>();
  return !!u && onTeam(env, s, u.id);
}

/** A live agent of this team. */
async function agentOfTeam(env: Env, s: Scope, uid: string): Promise<boolean> {
  const [kind, company, project] = cols(s);
  const r = await env.DB.prepare(
    `SELECT 1 AS ok FROM team_agents WHERE uid = ? AND status <> 'removed' AND scope_kind = ? AND IFNULL(company_id, 0) = IFNULL(?, 0) AND IFNULL(project_id, 0) = IFNULL(?, 0)`,
  ).bind(uid, kind, company, project).first<{ ok: number }>();
  return !!r;
}

/** The first reference in the patch that is not this team's, as `[field, message]`. */
async function foreignReference(env: Env, s: Scope, patch: Partial<LandingPolicy>): Promise<[string, string] | null> {
  if (patch.repository && !(await repositoryOfScope(env, s, patch.repository))) {
    return ['repository', 'That repository is not connected to this team.'];
  }
  const people: Array<[string, string]> = [];
  const actors: Array<[string, ActorRef]> = [];
  for (const p of patch.landing?.t2_signers ?? []) people.push(['landing.t2_signers', p.uid]);
  for (const o of patch.path_owners ?? []) for (const p of o.owners) people.push(['path_owners.owners', p.uid]);
  for (const a of patch.repair?.pushers ?? []) actors.push(['repair.pushers', a]);
  for (const [field, uid] of people) {
    if (!(await personOnTeam(env, s, uid))) return [field, `${field} are people on this team; ${uid} is not.`];
  }
  for (const [field, a] of actors) {
    const ok = a.kind === 'person' ? await personOnTeam(env, s, a.uid) : await agentOfTeam(env, s, a.uid);
    if (!ok) return [field, `${a.uid} is not ${a.kind === 'person' ? 'a person' : 'an agent'} on this team.`];
  }
  return null;
}

const off = (c: C) => c.json({ error: 'team_landing_off' }, 404);
const notFound = (c: C) => refuse(c, 404, { code: 'not_found', message: 'There is no such team.' });
const notManager = (c: C) => refuse(c, 403, { code: 'not_manager', message: 'Only the team’s editors can change its Landing settings.' });
const unreadable = (c: C) => refuse(c, 503, { code: 'landing_unreadable', message: 'The team’s Landing settings could not be read.' });
const invalid = (c: C, field: string, message: string) => refuse(c, 400, { code: 'invalid_landing', message, extra: { field } });

async function readBody(c: C): Promise<unknown> {
  try { return await c.req.json(); } catch { return undefined; }
}

/** The scope the caller may read, or the response that refuses it. */
async function readableScope(c: C, user: User): Promise<Scope | Response> {
  const s = await loadScope(c.env, c.req.param('scope') ?? '', c.req.param('id') ?? '');
  if (!s || !(await canRead(c.env, s, user))) return notFound(c);
  return s;
}

const teamLanding = new Hono<{ Bindings: Env }>();

teamLanding.get('/:scope/:id/landing', async (c) => {
  try {
    if (!teamLandingEnabled(c.env)) return off(c);
    const user = await requireAuth(c);
    const s = await readableScope(c, user);
    if (s instanceof Response) return s;
    const got = await readLanding(c.env, s).catch(() => null);
    if (!got) return unreadable(c);
    return c.json({
      landing: got.policy, version: got.version, updated_at: got.updated_at,
      defaults: LANDING_DEFAULTS, caps: landingCaps(), can_manage: await canManage(c.env, s, user),
    });
  } catch (e) { return mapError(c, e); }
});

teamLanding.put('/:scope/:id/landing', async (c) => {
  try {
    if (!teamLandingEnabled(c.env)) return off(c);
    const user = await requireAuth(c);
    const s = await readableScope(c, user);
    if (s instanceof Response) return s;
    if (!(await canManage(c.env, s, user))) return notManager(c);
    const raw = await readBody(c);
    let expected: number | undefined;
    let body = raw;
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'version' in raw) {
      const { version, ...rest } = raw as Record<string, unknown>;
      if (!Number.isSafeInteger(version) || (version as number) < 0) return invalid(c, 'version', 'version is the one you read, a whole number.');
      expected = version as number;
      body = rest;
    }
    const v = validateLandingPolicy(body, landingCaps());
    if (!v.ok) return invalid(c, v.field, v.message);
    const foreign = await foreignReference(c.env, s, v.patch);
    if (foreign) return invalid(c, foreign[0], foreign[1]);

    const before = await readLanding(c.env, s).catch(() => null);
    if (!before) return unreadable(c);
    if (expected !== undefined && expected !== before.version) return changed(c);
    const after: LandingPolicy = { ...before.policy, ...v.patch };
    const enc = (x: unknown) => (x === null ? null : JSON.stringify(x));
    const values = [
      after.repository, enc(after.landing), enc(after.repair), enc(after.path_owners),
      after.max_parallel_per_repo, after.compute_budget_microusd, enc(after.executors),
    ];
    const [kind, company, project] = cols(s);
    const next = before.version + 1;
    // The write is conditional on the version read; the log row is written only when it changed a row.
    const write = before.version === 0
      ? c.env.DB.prepare(
        `INSERT INTO agent_landing_settings (scope_kind, company_id, project_id, repository_ref, landing_json, repair_json,
            path_owners_json, max_parallel_per_repo, compute_budget_microusd, executors_json, version, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      ).bind(kind, company, project, ...values, user.id)
      : c.env.DB.prepare(
        `UPDATE agent_landing_settings SET repository_ref = ?, landing_json = ?, repair_json = ?, path_owners_json = ?,
            max_parallel_per_repo = ?, compute_budget_microusd = ?, executors_json = ?, version = ?, updated_by = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE scope_kind = ? AND IFNULL(company_id, 0) = IFNULL(?, 0) AND IFNULL(project_id, 0) = IFNULL(?, 0) AND version = ?`,
      ).bind(...values, next, user.id, kind, company, project, before.version);
    const log = c.env.DB.prepare(
      `INSERT INTO agent_landing_setting_changes (scope_kind, company_id, project_id, actor_user_id, version, before_json, after_json)
       SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
    ).bind(kind, company, project, user.id, next, JSON.stringify(before.policy), JSON.stringify(after));
    let logged: number;
    try {
      const res = await c.env.DB.batch([write, log]);
      logged = Number(res[1]?.meta?.changes ?? 0);
    } catch (e) {
      // A concurrent first save took the scope's one row.
      if (/UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e))) return changed(c);
      throw e;
    }
    if (logged !== 1) return changed(c);
    const got = await readLanding(c.env, s);
    return c.json({
      landing: got.policy, version: got.version, updated_at: got.updated_at,
      defaults: LANDING_DEFAULTS, caps: landingCaps(), can_manage: true,
    });
  } catch (e) { return mapError(c, e); }
});

const changed = (c: C) => refuse(c, 409, { code: 'landing_changed', message: 'Someone saved these settings since you read them. Reload and try again.' });

export default teamLanding;

export const mount: RouteMount = { path: '/api/teams', router: teamLanding, before: [agentEngineRoutes] };
