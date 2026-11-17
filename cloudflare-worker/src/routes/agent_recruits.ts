/**
 * D7075 (#7075, part of #7072) — recruits: the requests a plan files for a
 * role the team has no agent for. Mounted at `/api/team-recruits`.
 *
 *   GET  /:scope/:id?status=open|all   a team's requests and the tasks waiting on each (read)
 *   POST /:uid/approve                 add the agent through the ordinary add path, then hand it the tasks (manage)
 *   POST /:uid/decline                 decline once; the tasks stay unassigned and say why (manage)
 *
 * `:scope` is `company` (by uid) or `project` (by numeric id), as on
 * `/api/teams`. Every route is 404 `team_agents_off` unless
 * `TEAM_AGENTS_ENABLED` is "true".
 *
 * GATES. Read: `canRead` of the request's own scope. Manage (owner decision
 * D1): `canManage` with the roster flag, the same gate as adding an agent.
 * Approval goes through `team_agents.ts` `addAgentAs`, so it makes every
 * check an add makes (the paid plan, HQ's persona roster and maximum cap,
 * the model offer, the allowlists, the one agent per role) and the approver
 * becomes the sponsor. An approval sends the model, the cap and optionally
 * the persona and the name; never tool grants or skills, which the sponsor
 * adds on the agent's page.
 *
 * With `self_start` and the engine on, the scope's object is asked to admit
 * the first assigned task that is ready (best effort; a refusal leaves it for
 * the sweep or a person's Start).
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { mapError } from './_t13t14t15_helpers';
import { addAgentAs, teamAgentsEnabled } from './team_agents';
import { canManage, canRead, loadScope, scopeOfAgent, type AgentRow, type Scope } from '../services/agents/teams';
import { declineRecruit, recruitByUid, recruitDto, recruitsOf, settleApproved, type RecruitRow } from '../services/agents/recruits';
import { agentRuntime, autonomy, engineMode, type AgentRuntime } from '../agents/runtime';

type C = Context<{ Bindings: Env }>;

/** The runtime an approval asks to admit; tests pass their own. */
export type RecruitRouteDeps = { runtime: (env: Env) => Promise<AgentRuntime> };

const say = (c: C, status: number, code: string, message: string) => refuse(c, status as any, { code, message });

async function readBody(c: C): Promise<Record<string, any> | null> {
  try { const b = await c.req.json(); return b && typeof b === 'object' && !Array.isArray(b) ? b : null; } catch { return null; }
}

async function scopeOfRecruit(env: Env, r: RecruitRow): Promise<Scope | null> {
  return scopeOfAgent(env, { scope_kind: r.scope_kind, company_id: r.company_id, project_id: r.project_id } as AgentRow);
}

/** The request and its scope, for one of the team's managers; or the refusal. */
async function managedRecruit(c: C, user: User): Promise<{ r: RecruitRow; s: Scope } | { refusal: Response }> {
  const r = await recruitByUid(c.env, c.req.param('uid') ?? '');
  const s = r ? await scopeOfRecruit(c.env, r) : null;
  if (!r || !s || !(await canRead(c.env, s, user) || await canManage(c.env, s, user, { agentRoster: true }))) {
    return { refusal: say(c, 404, 'not_found', 'There is no such request.') };
  }
  if (!(await canManage(c.env, s, user, { agentRoster: true }))) return { refusal: say(c, 403, 'not_manager', 'Only the team’s editors can decide a request for an agent.') };
  if (r.status !== 'open') return { refusal: say(c, 409, 'recruit_decided', 'This request was already approved or declined.') };
  return { r, s };
}

const DEFAULT_DEPS: RecruitRouteDeps = { runtime: agentRuntime };
let deps: RecruitRouteDeps = DEFAULT_DEPS;
/** Tests pass their own runtime; null restores the default. */
export function __setRecruitRouteDeps(d: Partial<RecruitRouteDeps> | null) { deps = d ? { ...DEFAULT_DEPS, ...d } : DEFAULT_DEPS; }

const router = new Hono<{ Bindings: Env }>();
router.use('*', async (c, next) => {
  if (!teamAgentsEnabled(c.env)) return c.json({ error: 'team_agents_off' }, 404);
  await next();
});

router.get('/:scope/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const s = await loadScope(c.env, c.req.param('scope'), c.req.param('id'));
    if (!s) return say(c, 404, 'not_found', 'There is no such team.');
    const manage = await canManage(c.env, s, user, { agentRoster: true });
    if (!manage && !(await canRead(c.env, s, user))) return say(c, 403, 'not_member', 'Only the team can see its requests.');
    const status = c.req.query('status') === 'all' ? 'all' : 'open';
    const rows = await recruitsOf(c.env, s, status);
    const requests = [];
    for (const r of rows) requests.push(await recruitDto(c.env, r));
    return c.json({ can_manage: manage, requests });
  } catch (e) { return mapError(c, e); }
});

router.post('/:uid/approve', async (c) => {
  try {
    const user = await requireAuth(c);
    const got = await managedRecruit(c, user);
    if ('refusal' in got) return got.refusal;
    const b = (await readBody(c)) ?? {};
    // The role is the request's; grants and skills are never part of an approval.
    const added = await addAgentAs(c, got.s, user, {
      role_key: got.r.role_key, model_id: b.model_id, monthly_cap_microusd: b.monthly_cap_microusd,
      ...(b.persona_key !== undefined ? { persona_key: b.persona_key } : {}),
      ...(b.first_name !== undefined ? { first_name: b.first_name } : {}),
      ...(b.last_name !== undefined ? { last_name: b.last_name } : {}),
    });
    if (added.status !== 201) return added;
    const agentUid = ((await added.clone().json()) as any)?.agent?.uid as string;
    const agent = await c.env.DB.prepare('SELECT * FROM team_agents WHERE uid = ?').bind(agentUid).first<AgentRow>();
    const settled = await settleApproved(c.env, got.r, agent!, Number(user.id));
    if (!settled.ok) return say(c, settled.status, settled.code, settled.message);
    // With self_start: ask the scope's object to admit the first assigned task that can start.
    let admission: { ok: boolean; code?: string } | null = null;
    if (autonomy(c.env) === 'self_start' && (await engineMode(c.env)) === 'on') {
      const first = settled.assigned.find((t) => t.option) ?? null;
      if (first) {
        try {
          const a = await (await deps.runtime(c.env)).admit({ kind: got.s.kind, id: got.s.id }, { agentId: agent!.id, taskId: first.id, by: Number(user.id), source: 'person' }) as any;
          admission = { ok: !!a?.ok, ...(a?.ok ? {} : { code: a?.code }) };
        } catch { admission = { ok: false, code: 'admit_failed' }; }
      }
    }
    const row = (await recruitByUid(c.env, got.r.uid))!;
    return c.json({
      request: await recruitDto(c.env, row),
      agent: ((await added.json()) as any).agent,
      assigned: settled.assigned.map((t) => t.uid),
      left_unassigned: settled.left.map((t) => t.uid),
      admission,
    }, 201);
  } catch (e) { return mapError(c, e); }
});

router.post('/:uid/decline', async (c) => {
  try {
    const user = await requireAuth(c);
    const got = await managedRecruit(c, user);
    if ('refusal' in got) return got.refusal;
    const b = (await readBody(c)) ?? {};
    const r = await declineRecruit(c.env, got.r, Number(user.id), b.reason);
    if (!r.ok) return say(c, r.status, r.code, r.message);
    return c.json({ request: await recruitDto(c.env, (await recruitByUid(c.env, got.r.uid))!) });
  } catch (e) { return mapError(c, e); }
});


export default router;
export const mount: RouteMount = { path: '/api/team-recruits', router: router };
