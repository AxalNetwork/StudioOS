/**
 * D1496 (#3840, part 1 of #3727) — team agents: the registry and the rule
 * books. Mounted at `/api/teams`.
 *
 *   GET    /roles                              the catalogue: eleven roles, their default rule books, and the models an agent may run on
 *   GET    /personas                           D4117: the personas an agent wears (D4158: the ones HQ offers, as HQ named them), the 6 value labels and the 8 areas
 *   GET    /:scope/:id/agents?include=projects&module=
 *   POST   /:scope/:id/agents                  add one (manage + paid plan)
 *   GET    /agents/:uid                        its profile: rule book, matrix, spend, proposals, events
 *   PATCH  /agents/:uid                        pause, resume, cap, name (manage)
 *   GET    /agents/:uid/sponsors               D4387: the team's members and whether each may sponsor it (manage)
 *   PUT    /agents/:uid/sponsor                D4387: a new sponsor, with a reason; resumes a `sponsor_left` pause (manage)
 *   DELETE /agents/:uid                        remove: rows kept, open proposals withdrawn (manage)
 *   GET    /:scope/:id/rulebooks/:role         default, effective, versions, diff, floor
 *   PUT    /:scope/:id/rulebooks/:role         a new version, within the floor (manage)
 *   GET    /agents/:uid/run/quote?module=&option=  what a run would hold (the sponsor)
 *   POST   /agents/:uid/run                    run it: a proposal, charged to the sponsor (part 2, #3842); `tool_reads` (part 5)
 *   GET/PUT /:scope/:id/allowlists              D4422: inherited model/tool restrictions, saved by the effective scope’s editors
 *   GET    /tools                              the caller's own approved read tools, to grant an agent (part 5, #3844)
 *   GET    /:scope/:id/queue?role=&module=&option=&status=&cursor=&include=projects   the approvals queue (part 3, #3843)
 *   GET    /queue/:proposalUid                 one proposal and what the agent read for it
 *   POST   /queue/:proposalUid/decide          accept, edit or discard it once (manage, or the sponsor)
 *
 * `:scope` is `company` (by uid) or `project` (by numeric id). Every route is
 * 404 `team_agents_off` unless `TEAM_AGENTS_ENABLED` is "true".
 *
 * GATES. Read: a company's `user_company_links` row (or HQ's admin); a
 * project's `canAccessProject`. Manage: the company's `canEdit`; the
 * project's `isProjectManager`, called and never reimplemented, so the
 * company branch #3697 part 2 adds reaches agents unchanged. Plan (owner Q6 =
 * A): adding an agent needs a founder on a paid plan, the D852 rule; HQ's
 * admin passes.
 *
 * NEVER AN EMAIL, NEVER A NUMERIC USER ID. A person is `{ uid, name }`.
 * Spend is `{ available: false }` when its read fails or a run's charge is
 * unrecorded, never 0 (the page says "Not recorded").
 *
 * Part 2 (#3842) adds the run: only the sponsor runs an agent, through
 * `services/agents/agentRun.ts`, which every refusal comes from. Part 3
 * (#3843) adds the queue, through `services/agents/queue.ts`: a scope's
 * agents' proposals, decided once by its manager or the agent's sponsor
 * through the same `decideRailAs` the member route uses, with
 * `decided_by_user_id` and a `proposal_decided` event.
 * Part 5 (#3844, owner Q3 = A) adds the sponsor's approved read tools
 * (D852), through `services/agents/agentTools.ts`.
 * D4387 (#4387, #3742 E8) adds the sponsor change, checked by
 * `services/agents/sponsor.ts`, and each agent's `resumes_at`: the UTC day a
 * cap-paused agent resumes, which the sweep does (null otherwise).
 */
import { agentModels, planOk } from '../services/agents/modelOffers';
import { effectiveAllowlistScope, readAllowlists, saveAllowlists, allowlistRefusal, allowlistTools, parseAllowlists } from '../services/agents/allowlists';
import { maxTeamCap } from '../services/agents/aiPolicy';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { agentQuote, agentRun, type AgentRefusal } from '../services/agents/agentRun';
import { checkGrants, grantsView } from '../services/agents/agentTools';
import { ATTACH_STATUS, checkSkillList, linkStatement } from '../services/agents/skillLinks';
import { configOf, customMcpEnabled, grantableTools } from '../integrations/customMcp';
import type { IntegrationRow } from '../integrations/registry';
import { isAdmin, mapError, newUid } from './_t13t14t15_helpers';
import { neverFillMessage } from '../services/fills/neverFill';
import { NeverFillRefusal, type RailDecision, type RailProposalStatus } from '../services/railProposals';
import { QUEUE_STATUSES, queueCount, queueDecide, queueItem, queueList, type QueueRefusal } from '../services/agents/queue';
import { ALWAYS_ASKS_FLOOR, MODULES, ROLES, moduleOf, optionsIn, roleOf } from '../services/agents/catalogue';
import { AREAS, ROLE_PERSONA, VALUE_LEGEND, personaOf } from '../services/agents/personas';
import { PLATFORM_CAP_MAX_MICROUSD, RETIRED_PAUSE, galleryPersonas, loadPersonaSettings, maxCapOf, personaView, statusOf, unavailable } from '../services/agents/rosterAdmin';
import { checkRules, diffRules } from '../services/agents/rulebook';
import { SPONSOR_WORDS, capResumesAt, sponsorRefusal, teamMembers } from '../services/agents/sponsor';
import { notify } from '../services/notify';
import {
  agentByUid, bookRows, canManage, canRead, effectiveBook, loadScope, logEvent, monthSpend, scopeCols, scopeOfAgent,
  type AgentRow,
} from '../services/agents/teams';

export { agentModels, planOk } from '../services/agents/modelOffers';

type C = Context<{ Bindings: Env }>;

export const teamAgentsEnabled = (env: Env) => env.TEAM_AGENTS_ENABLED === 'true';
export const NAME_MAX = 40;
export const CAP_MAX_MICROUSD = PLATFORM_CAP_MAX_MICROUSD;
const PROPOSAL_STATUSES = ['proposed', 'accepted', 'edited', 'discarded', 'withdrawn'] as const;

const router = new Hono<{ Bindings: Env }>();

router.use('*', async (c, next) => {
  if (!teamAgentsEnabled(c.env)) return c.json({ error: 'team_agents_off' }, 404);
  await next();
});

const say = (c: C, status: number, code: string, message: string, extra?: Record<string, unknown>) =>
  refuse(c, status, { code, message, extra });

/** D4162 (#4162): HQ's maximum team cap. A cap above it is refused; a policy that cannot be read sets no new cap. */
async function capOverPlatform(c: any, cap: number): Promise<Response | null> {
  const m = await maxTeamCap(c.env);
  if (!m.ok) return say(c, 503, 'policy_unreadable', 'The platform\'s AI policy could not be read, so the cap was not changed. Try again shortly.');
  if (m.max != null && cap > m.max) return say(c, 422, 'cap_over_platform_max', `The platform allows a monthly cap of at most $${(m.max / 1e6).toFixed(2)} per agent.`);
  return null;
}
const notFound = (c: C) => say(c, 404, 'not_found', 'There is no such team.');

// ── Gates ───────────────────────────────────────────────────────────────────
// Scope, read and manage live in `services/agents/teams.ts`, shared with the run.

// ── Agents ──────────────────────────────────────────────────────────────────

async function lastActivity(env: Env, agentId: number): Promise<string | null> {
  try {
    const row = await env.DB.prepare('SELECT MAX(created_at) AS at FROM team_agent_events WHERE agent_id = ?').bind(agentId).first<{ at: string | null }>();
    return row?.at ?? null;
  } catch { return null; }
}

async function personOf(env: Env, userId: number | null): Promise<{ uid: string; name: string } | null> {
  if (!userId) return null;
  const u = await env.DB.prepare('SELECT uid, name FROM users WHERE id = ?').bind(userId).first<{ uid: string; name: string }>();
  return u ? { uid: u.uid, name: u.name } : null;
}

async function agentDto(env: Env, a: AgentRow) {
  const project = a.scope_kind === 'project'
    ? await env.DB.prepare('SELECT id, name FROM projects WHERE id = ?').bind(a.project_id).first<{ id: number; name: string }>()
    : null;
  const persona = personaOf(a.persona_key);
  // D4158: the persona as HQ named it; its values, risk and natural fit are always the catalogue's.
  const settings = persona ? await loadPersonaSettings(env) : null;
  return {
    uid: a.uid,
    // D4117: the role keys the rule book only; no job title reaches the client.
    role_key: a.role_key,
    persona: persona ? personaView(persona, settings!.get(persona.key)) : null,
    first_name: a.first_name,
    last_name: a.last_name,
    model_id: a.model_id,
    // Part 5: each granted tool with its server's name and whether it can be read now.
    tools: await grantsView(env, a),
    sponsor: await personOf(env, a.sponsor_user_id),
    status: a.status,
    paused_reason: a.paused_reason,
    // D4387: the UTC day (YYYY-MM-DD) a cap-paused agent resumes; null for every other agent. The page never works it out.
    resumes_at: await capResumesAt(env, a),
    monthly_cap_microusd: a.monthly_cap_microusd,
    month_spend: await monthSpend(env, a.id),
    last_activity_at: await lastActivity(env, a.id),
    scope_kind: a.scope_kind,
    project: project ? { id: project.id, name: project.name } : null,
  };
}

/** A name part: trimmed, at most 40 characters, no control characters; '' and null clear it. `undefined` = not sent. */
export function namePart(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false };
  const t = v.trim();
  if (t.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(t)) return { ok: false };
  return { ok: true, value: t || null };
}


const answer = (c: C, r: AgentRefusal) => say(c, r.status, r.code, r.message, r.extra);

/** D1612's attach refusals, in the add route's words. */
const SKILL_WORDS = {
  not_found: 'There is no such skill.',
  version_not_published: 'Only a published version can be pinned.',
  skill_retired: 'This skill is retired and cannot be added again.',
  skill_suspended: 'HQ suspended this skill, so it cannot be added. The company can publish a fixed version.',
  role_mismatch: 'An agent can only be given skills of its own role.',
  tool_not_approved: 'That skill needs a read tool its sponsor has not approved.',
} as const;

const validCap = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= CAP_MAX_MICROUSD;

async function readBody(c: C): Promise<Record<string, any> | null> {
  try { const b = await c.req.json(); return b && typeof b === 'object' && !Array.isArray(b) ? b : null; } catch { return null; }
}

// ── Routes ──────────────────────────────────────────────────────────────────

router.get('/roles', async (c) => {
  try {
    const user = await requireAuth(c);
    return c.json({
      roles: ROLES.map((r) => ({
        key: r.key, name: r.name, mission: r.mission,
        works_in: r.default_rules.works_in.map((k) => ({ key: k, label: moduleOf(k)?.label ?? k })),
        default_rules: r.default_rules,
        ...(r.disclaimer_key ? { disclaimer_key: r.disclaimer_key } : {}),
      })),
      models: agentModels(c.env, user),
    });
  } catch (e) { return mapError(c, e); }
});

// ── Personas (D4117) ────────────────────────────────────────────────────────

/**
 * The Add-agent gallery: the personas HQ offers (D4158: a hidden or retired one
 * is left out), with HQ's identity and team defaults. Values, risk and natural
 * fit are fixed. Readable by any signed-in member, like the roles.
 */
router.get('/personas', async (c) => {
  try {
    await requireAuth(c);
    return c.json({ personas: galleryPersonas(await loadPersonaSettings(c.env)), values: VALUE_LEGEND, areas: AREAS });
  } catch (e) { return mapError(c, e); }
});

// ── Tools (part 5) ──────────────────────────────────────────────────────────

/** The caller's own approved read tools (D852), for the Add-agent sheet. Descriptions are not stored with an approval, so they are null. */
router.get('/tools', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!customMcpEnabled(c.env)) return say(c, 404, 'custom_mcp_off', 'Connected MCP servers are not switched on.');
    if (!planOk(user)) return say(c, 403, 'plan_required', 'Agents come with a paid Founder plan.');
    // A failed read is an error, never "no servers".
    const rows = (await c.env.DB.prepare("SELECT * FROM integrations WHERE user_id = ? AND provider_key LIKE 'custom:%' ORDER BY id")
      .bind(user.id).all<IntegrationRow>()).results ?? [];
    const servers = rows.filter((r) => configOf(r)).map((r) => {
      const offer = grantableTools(r);
      return {
        integration_uid: r.provider_key.slice('custom:'.length),
        name: r.display_name || 'Your MCP server',
        status: offer.connected ? 'connected' as const : 'disconnected' as const,
        tools: offer.tools.map((name) => ({ name, description: null })),
      };
    });
    return c.json({ servers });
  } catch (e) { return mapError(c, e); }
});

// ── The run (part 2) ────────────────────────────────────────────────────────

/** The agent, when the caller is its sponsor: only the sponsor runs it, paid from their tokens (owner Q2 = B). */
async function sponsored(c: C, user: User) {
  const a = await agentByUid(c.env, c.req.param('uid') ?? '');
  const s = a && await scopeOfAgent(c.env, a);
  if (!a || !s || !(await canRead(c.env, s, user))) return { refusal: say(c, 404, 'not_found', 'There is no such agent.') };
  if (a.sponsor_user_id !== user.id) return { refusal: say(c, 403, 'not_sponsor', 'Only the person who added this agent can run it.') };
  return { agent: a };
}

router.get('/agents/:uid/run/quote', async (c) => {
  try {
    const user = await requireAuth(c);
    const got = await sponsored(c, user);
    if (!got.agent) return got.refusal;
    const q = await agentQuote(c.env, { agent: got.agent, module: c.req.query('module') ?? '', option: c.req.query('option') ?? '' });
    return q.ok ? c.json({ quote: q.quote }) : answer(c, q);
  } catch (e) { return mapError(c, e); }
});

router.post('/agents/:uid/run', async (c) => {
  try {
    const user = await requireAuth(c);
    const got = await sponsored(c, user);
    if (!got.agent) return got.refusal;
    if (!planOk(user)) return say(c, 403, 'plan_required', 'Agents come with a paid Founder plan.');
    const b = await readBody(c);
    if (!b) return say(c, 400, 'invalid_body', 'Send the module, the option and what the agent should work on.');
    const record = b.record == null ? null : typeof b.record === 'string' ? b.record : undefined;
    if (record === undefined) return say(c, 400, 'invalid_record', 'The record is a reference such as project:7.');
    const r = await agentRun(c.env, {
      agent: got.agent, module: typeof b.module === 'string' ? b.module : '', option: typeof b.option === 'string' ? b.option : '',
      record, prompt: b.prompt, toolReads: b.tool_reads,
      // D1612 part D (#3954): one of the agent's skills, by uid; it runs at the pinned version.
      skill: b.skill == null ? null : String(b.skill),
    });
    if (!r.ok) return answer(c, r);
    return c.json({ proposal: r.proposal, charged: r.charged });
  } catch (e) { return mapError(c, e); }
});

// ── The queue (part 3) ──────────────────────────────────────────────────────

const DECISIONS: readonly RailDecision[] = ['accept', 'edit', 'discard'];
const queueAnswer = (c: C, r: QueueRefusal) => say(c, r.status, r.code, r.message, r.extra);

router.get('/:scope/:id/queue', async (c) => {
  try {
    const user = await requireAuth(c);
    const s = await loadScope(c.env, c.req.param('scope'), c.req.param('id'));
    if (!s) return notFound(c);
    if (!(await canRead(c.env, s, user))) return say(c, 403, 'not_member', 'Only the team can see its approvals.');
    const status = c.req.query('status') || 'proposed';
    if (!QUEUE_STATUSES.includes(status as RailProposalStatus)) return say(c, 400, 'invalid_status', 'Choose proposed, accepted, edited, discarded or withdrawn.');
    const rawCursor = c.req.query('cursor');
    if (rawCursor && !/^[1-9][0-9]{0,15}$/.test(rawCursor)) return say(c, 400, 'invalid_cursor', 'That page marker is not one this list gave.');
    // TM1e: a company's editors may also see the projects inside it (the owner's authority rule).
    const includeProjects = s.kind === 'company' && c.req.query('include') === 'projects' && await canManage(c.env, s, user);
    const filter = {
      role: c.req.query('role') || null, module: c.req.query('module') || null, option: c.req.query('option') || null,
      status: status as RailProposalStatus, cursor: rawCursor ? Number(rawCursor) : null, includeProjects,
    };
    const page = await queueList(c.env, s, filter);
    return c.json({ items: page.items, counts: { proposed: await queueCount(c.env, s, filter) }, next_cursor: page.next_cursor });
  } catch (e) { return mapError(c, e); }
});

router.get('/queue/:proposalUid', async (c) => {
  try {
    const user = await requireAuth(c);
    const r = await queueItem(c.env, user, c.req.param('proposalUid'));
    return r.ok ? c.json({ item: r.item, inputs: r.inputs }) : queueAnswer(c, r);
  } catch (e) { return mapError(c, e); }
});

router.post('/queue/:proposalUid/decide', async (c) => {
  try {
    const user = await requireAuth(c);
    const b = await readBody(c);
    const decision = String(b?.decision || '') as RailDecision;
    if (!DECISIONS.includes(decision)) return say(c, 400, 'invalid_decision', 'Accept, edit or discard it.');
    const payload = b?.payload && typeof b.payload === 'object' && !Array.isArray(b.payload) ? b.payload : null;
    if (decision === 'edit' && !payload) return say(c, 400, 'payload_required', 'Send your edited version.');
    try {
      const r = await queueDecide(c.env, user, c.req.param('proposalUid'), decision, payload);
      return r.ok ? c.json({ item: r.item }) : queueAnswer(c, r);
    } catch (e) {
      if (e instanceof NeverFillRefusal) return say(c, 422, 'never_fill', neverFillMessage(e.field), { field: e.field, discarded: e.discarded });
      throw e;
    }
  } catch (e) { return mapError(c, e); }
});

router.get('/agents/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const a = await agentByUid(c.env, c.req.param('uid'));
    const s = a && await scopeOfAgent(c.env, a);
    if (!a || !s) return say(c, 404, 'not_found', 'There is no such agent.');
    if (!(await canRead(c.env, s, user))) return say(c, 403, 'not_member', 'Only the team can see its agents.');
    const book = await effectiveBook(c.env, s, a.role_key);
    const matrix = MODULES.map((m) => {
      const read = book.rules.works_in.includes(m.key);
      const offered = new Set(optionsIn(m.key));
      return { module: m.key, label: m.label, read, propose: read && book.rules.may_propose.some((o) => offered.has(o)), auto: false };
    });
    let proposals: Record<string, number> | null = null;
    try {
      const r = await c.env.DB.prepare('SELECT status, COUNT(*) AS n FROM ai_rail_proposals WHERE agent_id = ? GROUP BY status')
        .bind(a.id).all<{ status: string; n: number }>();
      proposals = Object.fromEntries(PROPOSAL_STATUSES.map((st) => [st, 0]));
      for (const row of r.results ?? []) if (row.status in proposals) proposals[row.status] = Number(row.n);
    } catch { proposals = null; }
    const ev = await c.env.DB.prepare(
      `SELECT e.kind, e.created_at, e.detail_json, e.proposal_uid, u.uid AS actor_uid, u.name AS actor_name
         FROM team_agent_events e LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.agent_id = ? ORDER BY e.id DESC LIMIT 50`,
    ).bind(a.id).all<{ kind: string; created_at: string; detail_json: string | null; proposal_uid: string | null; actor_uid: string | null; actor_name: string | null }>();
    const agent = await agentDto(c.env, a);
    return c.json({
      agent,
      can_manage: await canManage(c.env, s, user),
      rulebook: { effective: book.rules, version: book.version },
      matrix,
      cap_microusd: a.monthly_cap_microusd,
      month_spend: agent.month_spend,
      proposals,
      events: (ev.results ?? []).map((e) => ({
        kind: e.kind,
        actor: e.actor_uid ? { uid: e.actor_uid, name: e.actor_name } : null,
        at: e.created_at,
        detail: e.detail_json ? JSON.parse(e.detail_json) : null,
        // Part 2: a run's proposal, so the page links to it.
        proposal_uid: e.proposal_uid ?? null,
      })),
    });
  } catch (e) { return mapError(c, e); }
});

router.patch('/agents/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const a = await agentByUid(c.env, c.req.param('uid'));
    const s = a && await scopeOfAgent(c.env, a);
    if (!a || !s) return say(c, 404, 'not_found', 'There is no such agent.');
    if (!(await canRead(c.env, s, user))) return say(c, 403, 'not_member', 'Only the team can see its agents.');
    if (!(await canManage(c.env, s, user))) return say(c, 403, 'not_manager', 'Only the team’s editors can change its agents.');
    if (a.status === 'removed') return say(c, 409, 'removed', 'This agent was removed.');
    const b = await readBody(c);
    if (!b) return say(c, 400, 'invalid_body', 'Send what to change.');
    const next = { status: a.status, paused_reason: a.paused_reason, cap: a.monthly_cap_microusd, first_name: a.first_name, last_name: a.last_name };
    const events: [string, unknown?][] = [];
    if ('status' in b) {
      if (b.status !== 'active' && b.status !== 'paused') return say(c, 400, 'invalid_status', 'An agent is active or paused.');
      if (b.status !== a.status) {
        // D4158: an agent HQ paused by retiring its persona resumes only once HQ offers or hides it again.
        if (b.status === 'active' && a.paused_reason === RETIRED_PAUSE && a.persona_key
          && statusOf((await loadPersonaSettings(c.env)).get(a.persona_key)) === 'retired') {
          return say(c, 409, 'persona_retired', 'Axal VC HQ retired this agent. It cannot be resumed.');
        }
        next.status = b.status; next.paused_reason = b.status === 'paused' ? 'manual' : null;
        events.push([b.status === 'paused' ? 'paused' : 'resumed', b.status === 'paused' ? { reason: 'manual' } : undefined]);
      }
    }
    if ('monthly_cap_microusd' in b) {
      if (!validCap(b.monthly_cap_microusd)) return say(c, 400, 'invalid_cap', 'The monthly cap is a whole number of micro-dollars above zero.');
      const over = await capOverPlatform(c, b.monthly_cap_microusd);
      if (over) return over;
      const maxCap = a.persona_key ? maxCapOf((await loadPersonaSettings(c.env)).get(a.persona_key)) : null;
      if (maxCap != null && b.monthly_cap_microusd > maxCap && b.monthly_cap_microusd > a.monthly_cap_microusd) {
        return say(c, 422, 'cap_above_max', 'That cap is above the most a team may set for this agent.', { max_cap_microusd: maxCap });
      }
      if (b.monthly_cap_microusd !== a.monthly_cap_microusd) {
        next.cap = b.monthly_cap_microusd;
        events.push(['cap_changed', { from_microusd: a.monthly_cap_microusd, to_microusd: b.monthly_cap_microusd }]);
      }
    }
    for (const k of ['first_name', 'last_name'] as const) {
      if (!(k in b)) continue;
      const n = namePart(b[k]);
      if (!n.ok) return say(c, 400, 'invalid_name', `A name is at most ${NAME_MAX} characters.`);
      next[k] = n.value;
    }
    await c.env.DB.prepare(
      `UPDATE team_agents SET status = ?, paused_reason = ?, monthly_cap_microusd = ?, first_name = ?, last_name = ?,
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).bind(next.status, next.paused_reason, next.cap, next.first_name, next.last_name, a.id).run();
    for (const [kind, detail] of events) await logEvent(c.env, a.id, user.id, kind, detail);
    const fresh = await c.env.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(a.id).first<AgentRow>();
    return c.json({ agent: await agentDto(c.env, fresh!) });
  } catch (e) { return mapError(c, e); }
});

// ── The sponsor (D4387) ─────────────────────────────────────────────────────

export const SPONSOR_REASON_MIN = 10;
export const SPONSOR_REASON_MAX = 500;
const USER_UID = /^[A-Za-z0-9_-]{1,64}$/;

/** The agent and its scope, for one of its managers; or the refusal, in PATCH's gate order. */
async function managed(c: C, user: User) {
  const a = await agentByUid(c.env, c.req.param('uid') ?? '');
  const s = a && await scopeOfAgent(c.env, a);
  if (!a || !s) return { refusal: say(c, 404, 'not_found', 'There is no such agent.') };
  if (!(await canRead(c.env, s, user))) return { refusal: say(c, 403, 'not_member', 'Only the team can see its agents.') };
  if (!(await canManage(c.env, s, user))) return { refusal: say(c, 403, 'not_manager', 'Only the team’s editors can change who sponsors an agent.') };
  if (a.status === 'removed') return { refusal: say(c, 409, 'removed', 'This agent was removed.') };
  return { agent: a, scope: s };
}

/** The team's members, each with whether they may sponsor this agent and, when not, why in words. Never an email or a numeric id. */
router.get('/agents/:uid/sponsors', async (c) => {
  try {
    const user = await requireAuth(c);
    const got = await managed(c, user);
    if (!got.agent) return got.refusal;
    const candidates = [];
    for (const m of await teamMembers(c.env, got.scope)) {
      const current = m.id === got.agent.sponsor_user_id;
      const r = current ? null : await sponsorRefusal(c.env, got.scope, m);
      candidates.push({ uid: m.uid, name: m.name, current, can_sponsor: !current && !r, code: r?.code ?? null, reason: r?.message ?? null });
    }
    return c.json({ sponsor: await personOf(c.env, got.agent.sponsor_user_id), candidates });
  } catch (e) { return mapError(c, e); }
});

/**
 * A new sponsor, `{ sponsor_uid, reason, drop_tools? }`. The new sponsor
 * passes `sponsorRefusal`; the reason (10 to 500 characters) is kept in the
 * `sponsor_changed` event with the caller as its actor. An agent paused
 * `sponsor_left` resumes. Its read tools are the old sponsor's own servers,
 * which no one else can read through, so an agent with tools changes sponsor
 * only with `drop_tools: true`, and they are dropped.
 */
router.put('/agents/:uid/sponsor', async (c) => {
  try {
    const user = await requireAuth(c);
    const got = await managed(c, user);
    if (!got.agent) return got.refusal;
    const a = got.agent;
    const b = await readBody(c);
    if (!b) return say(c, 400, 'invalid_body', 'Send the new sponsor and why.');
    const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
    if (reason.length < SPONSOR_REASON_MIN || reason.length > SPONSOR_REASON_MAX) {
      return say(c, 400, 'reason_required', `Say why the sponsor changes, in ${SPONSOR_REASON_MIN} to ${SPONSOR_REASON_MAX} characters. It is kept in the agent’s activity.`);
    }
    const target = typeof b.sponsor_uid === 'string' && USER_UID.test(b.sponsor_uid)
      ? await c.env.DB.prepare('SELECT * FROM users WHERE uid = ? AND is_active = 1').bind(b.sponsor_uid).first<User>()
      : null;
    if (!target) return say(c, 422, 'sponsor_not_found', SPONSOR_WORDS.sponsor_not_found);
    if (target.id === a.sponsor_user_id) return say(c, 409, 'same_sponsor', 'That person already sponsors this agent.');
    const refusal = await sponsorRefusal(c.env, got.scope, target);
    if (refusal) return say(c, refusal.status, refusal.code, refusal.message);
    let grants: unknown[] = [];
    try { const g = JSON.parse(a.tool_grants_json || '[]'); grants = Array.isArray(g) ? g : []; } catch { grants = []; }
    if (grants.length && b.drop_tools !== true) {
      return say(c, 422, 'sponsor_tools', `This agent reads through ${grants.length === 1 ? 'a tool' : `${grants.length} tools`} on its current sponsor’s own connected servers, which a new sponsor cannot use. Choose to drop ${grants.length === 1 ? 'it' : 'them'} to change the sponsor.`, { tools: grants.length });
    }
    const resume = a.status === 'paused' && a.paused_reason === 'sponsor_left';
    // Only from the sponsor this read saw: a change made meanwhile is not overwritten.
    const u = await c.env.DB.prepare(
      `UPDATE team_agents SET sponsor_user_id = ?, tool_grants_json = ?,
         status = CASE WHEN status = 'paused' AND paused_reason = 'sponsor_left' THEN 'active' ELSE status END,
         paused_reason = CASE WHEN status = 'paused' AND paused_reason = 'sponsor_left' THEN NULL ELSE paused_reason END,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND sponsor_user_id = ? AND status <> 'removed'`,
    ).bind(target.id, grants.length ? '[]' : a.tool_grants_json, a.id, a.sponsor_user_id).run();
    if (!u.meta?.changes) return say(c, 409, 'sponsor_changed_meanwhile', 'Someone changed this agent a moment ago. Reload it and try again.');
    await logEvent(c.env, a.id, user.id, 'sponsor_changed', {
      from: await personOf(c.env, a.sponsor_user_id), to: { uid: target.uid, name: target.name }, reason,
      ...(grants.length ? { tools_dropped: grants.length } : {}),
    });
    if (resume) await logEvent(c.env, a.id, user.id, 'resumed', { reason: 'sponsor_changed' });
    const fresh = await c.env.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(a.id).first<AgentRow>();
    const agent = await agentDto(c.env, fresh!);
    // The new sponsor is told: their tokens pay this agent's runs from now on. Best effort.
    try {
      const name = agent.persona?.name || [agent.first_name, agent.last_name].filter(Boolean).join(' ') || 'An agent';
      await notify(c.env, {
        userId: target.id, type: 'agent_sponsor', channels: ['in_app'], category: 'proactive_nudges', link: null,
        title: `You now sponsor ${name}`,
        body: `${user.name || 'An editor'} made you the sponsor of ${name} on ${got.scope.name}. Its runs are paid from your AI tokens, capped per month. Their reason: "${reason.slice(0, 200)}"`,
      });
    } catch { console.warn('[agents] sponsor_notice_failed'); }
    return c.json({ agent });
  } catch (e) { return mapError(c, e); }
});

router.delete('/agents/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const a = await agentByUid(c.env, c.req.param('uid'));
    const s = a && await scopeOfAgent(c.env, a);
    if (!a || !s) return say(c, 404, 'not_found', 'There is no such agent.');
    if (!(await canRead(c.env, s, user))) return say(c, 403, 'not_member', 'Only the team can see its agents.');
    if (!(await canManage(c.env, s, user))) return say(c, 403, 'not_manager', 'Only the team’s editors can remove its agents.');
    if (a.status === 'removed') return c.json({ ok: true });
    const withdrawn = await c.env.DB.prepare(
      "UPDATE ai_rail_proposals SET status = 'withdrawn', updated_at = CURRENT_TIMESTAMP WHERE agent_id = ? AND status = 'proposed'",
    ).bind(a.id).run();
    await c.env.DB.prepare(
      "UPDATE team_agents SET status = 'removed', paused_reason = NULL, removed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(a.id).run();
    await logEvent(c.env, a.id, user.id, 'removed', { proposals_withdrawn: Number(withdrawn.meta?.changes ?? 0) });
    // D1530 (#3849, E5): its notes are kept 90 days after removal (Q6 A), its duties end.
    // Best effort: the removal stands even where migration 728 has not run.
    try {
      const { onAgentRemoved } = await import('../services/agents/memory');
      await onAgentRemoved(c.env, a.id);
      await c.env.DB.prepare("UPDATE agent_duties SET status = 'removed', updated_at = CURRENT_TIMESTAMP WHERE agent_id = ? AND status <> 'removed'").bind(a.id).run();
    } catch { console.warn('[agents] removal_retention_failed'); }
    // D1528 (#3847): the removed agent's runs end and its scope object forgets it.
    const { eraseAgentRuntime } = await import('../agents/erasure');
    await eraseAgentRuntime(c.env, a);
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

router.get('/:scope/:id/agents', async (c) => {
  try {
    const user = await requireAuth(c);
    const s = await loadScope(c.env, c.req.param('scope'), c.req.param('id'));
    if (!s) return notFound(c);
    if (!(await canRead(c.env, s, user))) return say(c, 403, 'not_member', 'Only the team can see its agents.');
    const manage = await canManage(c.env, s, user);
    const [companyId, projectId] = scopeCols(s);
    const rows = (await c.env.DB.prepare(
      `SELECT * FROM team_agents WHERE status <> 'removed' AND scope_kind = ? AND IFNULL(company_id, 0) = ? AND IFNULL(project_id, 0) = ? ORDER BY id`,
    ).bind(s.kind, companyId ?? 0, projectId ?? 0).all<AgentRow>()).results ?? [];
    // TM1e: a company's editors also see the live agents of the projects inside it (the owner's authority rule).
    if (s.kind === 'company' && c.req.query('include') === 'projects' && manage) {
      const more = (await c.env.DB.prepare(
        `SELECT a.* FROM team_agents a JOIN projects p ON p.id = a.project_id
          WHERE a.scope_kind = 'project' AND a.status <> 'removed' AND p.company_id = ? ORDER BY a.id`,
      ).bind(s.id).all<AgentRow>()).results ?? [];
      rows.push(...more);
    }
    let list = rows;
    const module = c.req.query('module');
    if (module) {
      const keep: AgentRow[] = [];
      for (const a of rows) {
        const own = a.scope_kind === 'company' ? s : await scopeOfAgent(c.env, a);
        if (own && (await effectiveBook(c.env, own, a.role_key)).rules.works_in.includes(module)) keep.push(a);
      }
      list = keep;
    }
    const agents = [];
    for (const a of list) agents.push(await agentDto(c.env, a));
    return c.json({ can_manage: manage, plan_ok: planOk(user), agents });
  } catch (e) { return mapError(c, e); }
});

// D4422: company projects always read and write the parent company's policy.
router.get('/:scope/:id/allowlists', async (c) => {
  try {
    const user = await requireAuth(c);
    const s = await loadScope(c.env, c.req.param('scope'), c.req.param('id'));
    if (!s) return notFound(c);
    const parent = await effectiveAllowlistScope(c.env, s);
    if (!parent) return say(c, 503, 'allowlists_unreadable', 'The company settings could not be read.');
    if (!(await canRead(c.env, s, user)) && !(await canRead(c.env, parent, user))) return say(c, 403, 'not_member', 'Only the team can read its settings.');
    const lists = await readAllowlists(c.env, parent);
    if (!lists) return say(c, 503, 'allowlists_unreadable', 'The allowed models and tools could not be read.');
    return c.json({ ...lists, can_manage: await canManage(c.env, parent, user), inherited: parent.kind !== s.kind,
      scope: { kind: parent.kind, id: parent.kind === 'company' ? parent.uid : String(parent.id), name: parent.name },
      models: agentModels(c.env, user), servers: await allowlistTools(c.env, parent) });
  } catch (e) { return mapError(c, e); }
});

router.put('/:scope/:id/allowlists', async (c) => {
  try {
    const user = await requireAuth(c);
    const s = await loadScope(c.env, c.req.param('scope'), c.req.param('id'));
    if (!s) return notFound(c);
    const parent = await effectiveAllowlistScope(c.env, s);
    if (!parent) return say(c, 503, 'allowlists_unreadable', 'The company settings could not be read.');
    if (!(await canRead(c.env, s, user)) && !(await canRead(c.env, parent, user))) return say(c, 403, 'not_member', 'Only the team can read its settings.');
    if (!(await canManage(c.env, parent, user))) return say(c, 403, 'not_manager', 'Only this company or project’s editors can change its allowed models and tools.');
    const wanted = parseAllowlists(await readBody(c));
    if (!wanted) return say(c, 400, 'invalid_allowlists', 'Send model_ids and tool_grants as lists, or null for the plan default.');
    const offered = agentModels(c.env, user);
    if (wanted.model_ids?.some((id) => !offered.some((m) => m.id === id && !m.plan_locked))) return say(c, 403, 'model_not_allowed', 'Choose only models currently offered on your plan.');
    const servers = await allowlistTools(c.env, parent);
    if (wanted.tool_grants?.some((g) => !planOk(user) || !servers.some((v) => v.integration_uid === g.integration_uid && v.tools.some((t) => t.name === g.tool)))) return say(c, 403, 'tool_not_allowed', 'Choose only approved read tools connected to this team.');
    await saveAllowlists(c.env, parent, user.id, wanted);
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

router.post('/:scope/:id/agents', async (c) => {
  try {
    const user = await requireAuth(c);
    const s = await loadScope(c.env, c.req.param('scope'), c.req.param('id'));
    if (!s) return notFound(c);
    if (!(await canRead(c.env, s, user))) return say(c, 403, 'not_member', 'Only the team can see its agents.');
    if (!(await canManage(c.env, s, user))) return say(c, 403, 'not_manager', 'Only the team’s editors can add agents.');
    if (!planOk(user)) return say(c, 403, 'plan_required', 'Agents come with a paid Founder plan.');
    const b = await readBody(c);
    if (!b) return say(c, 400, 'invalid_body', 'Send the role, the model and the monthly cap.');
    const role = typeof b.role_key === 'string' ? roleOf(b.role_key) : null;
    if (!role) return say(c, 400, 'invalid_role', 'Choose one of the roles.');
    // D4117: who the agent is. Sent, or the role's default persona while the screens still send a role alone.
    if (b.persona_key !== undefined && !personaOf(b.persona_key)) return say(c, 400, 'invalid_persona', 'Choose one of the agents.');
    const persona = personaOf(b.persona_key ?? ROLE_PERSONA[role.key])!;
    // D4158: HQ's roster. A hidden or retired persona is not offered to a new team, and HQ's maximum cap holds.
    const setting = (await loadPersonaSettings(c.env)).get(persona.key);
    const gone = unavailable(setting);
    if (gone) return say(c, 409, 'persona_unavailable', 'That agent is not offered to teams now. Choose another.', { persona_key: persona.key, status: gone });
    if (!validCap(b.monthly_cap_microusd)) return say(c, 400, 'invalid_cap', 'The monthly cap is a whole number of micro-dollars above zero.');
    const over = await capOverPlatform(c, b.monthly_cap_microusd);
    if (over) return over;
    const maxCap = maxCapOf(setting);
    if (maxCap != null && b.monthly_cap_microusd > maxCap) return say(c, 422, 'cap_above_max', 'That cap is above the most a team may set for this agent.', { max_cap_microusd: maxCap });
    const first = namePart(b.first_name); const last = namePart(b.last_name);
    if (!first.ok || !last.ok) return say(c, 400, 'invalid_name', `A name is at most ${NAME_MAX} characters.`);
    if (typeof b.model_id !== 'string' || !agentModels(c.env, user).some((m) => m.id === b.model_id && !m.plan_locked)) {
      return say(c, 422, 'model_not_offered', 'That model is not offered. Choose one from the list.');
    }
    // Part 5: each grant is the sponsor's (the caller's) own connected server, an approved, pinned read tool.
    const granted = await checkGrants(c.env, user.id, b.tool_grants);
    if (!granted.ok) return answer(c, granted);
    const allowed = await allowlistRefusal(c.env, s, b.model_id, granted.grants);
    if (allowed) return answer(c, allowed);
    // D1612 A2 (#3956): the Add-an-agent Skills step, through the same gates as PUT …/skills.
    if (b.skills !== undefined && (!Array.isArray(b.skills) || b.skills.length > 40)) return say(c, 400, 'invalid_skills', 'Send the agent\'s skills as a list of up to 40.');
    const [cId, pId] = scopeCols(s);
    const skillsChecked = Array.isArray(b.skills) && b.skills.length
      ? await checkSkillList(c.env, { id: null, scope_kind: s.kind, company_id: cId, project_id: pId, role_key: role.key, tool_grants_json: JSON.stringify(granted.grants) }, b.skills,
        // A1's read gate: an HQ skill for everyone; a company's skill for that company's members (or HQ's admin).
        async (sk) => sk.scope === 'hq' || isAdmin(user) || (sk.company_id != null
          && !!(await c.env.DB.prepare('SELECT 1 AS ok FROM user_company_links WHERE company_id = ? AND user_id = ?').bind(sk.company_id, user.id).first())))
      : { ok: true as const, wanted: [] };
    if (!skillsChecked.ok) {
      const bl = skillsChecked.blocked;
      return say(c, ATTACH_STATUS[bl.code], bl.code, SKILL_WORDS[bl.code], { skill_uid: skillsChecked.skill_uid, ...(bl.tool ? { tool: bl.tool } : {}) });
    }
    const [companyId, projectId] = scopeCols(s);
    const personaTaken = () => say(c, 409, 'persona_on_team', `${persona.name} is already on this team.`, { persona_key: persona.key });
    const roleTaken = () => say(c, 409, 'role_taken', 'This team already has an agent in that role.');
    // The role first: a second agent in a role is role_taken, whichever persona it would wear.
    const taken = await c.env.DB.prepare(
      `SELECT MAX(role_key = ?) AS role_hit, MAX(persona_key = ?) AS persona_hit FROM team_agents
        WHERE status <> 'removed' AND scope_kind = ? AND IFNULL(company_id, 0) = ? AND IFNULL(project_id, 0) = ?`,
    ).bind(role.key, persona.key, s.kind, companyId ?? 0, projectId ?? 0).first<{ role_hit: number | null; persona_hit: number | null }>();
    if (taken?.role_hit) return roleTaken();
    if (taken?.persona_hit) return personaTaken();
    const uid = newUid();
    try {
      await c.env.DB.prepare(
        `INSERT INTO team_agents (uid, scope_kind, company_id, project_id, role_key, persona_key, first_name, last_name, model_id,
           tool_grants_json, sponsor_user_id, monthly_cap_microusd, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(uid, s.kind, companyId, projectId, role.key, persona.key, first.value, last.value, b.model_id, JSON.stringify(granted.grants), user.id, b.monthly_cap_microusd, user.id).run();
    } catch (e: any) {
      const msg = String(e?.message);
      // Two adds of the same persona at once: the partial unique index answers for the one that lost.
      if (/UNIQUE/i.test(msg) && /persona/i.test(msg)) return personaTaken();
      if (/UNIQUE/i.test(msg)) return roleTaken();
      throw e;
    }
    const a = await c.env.DB.prepare('SELECT * FROM team_agents WHERE uid = ?').bind(uid).first<AgentRow>();
    await logEvent(c.env, a!.id, user.id, 'added', { role_key: role.key, persona_key: persona.key, model_id: b.model_id, monthly_cap_microusd: b.monthly_cap_microusd });
    if (skillsChecked.wanted.length) await c.env.DB.batch(skillsChecked.wanted.map((w) => linkStatement(c.env, a!.id, w.s.id, w.version, user.id)));
    return c.json({ agent: await agentDto(c.env, a!) }, 201);
  } catch (e) { return mapError(c, e); }
});

router.get('/:scope/:id/rulebooks/:role', async (c) => {
  try {
    const user = await requireAuth(c);
    const s = await loadScope(c.env, c.req.param('scope'), c.req.param('id'));
    const role = roleOf(c.req.param('role'));
    if (!s || !role) return notFound(c);
    if (!(await canRead(c.env, s, user))) return say(c, 403, 'not_member', 'Only the team can see its rule books.');
    const rows = await bookRows(c.env, s, role.key);
    const book = await effectiveBook(c.env, s, role.key);
    return c.json({
      role_key: role.key,
      default: role.default_rules,
      effective: book.rules,
      version: book.version,
      versions: rows.map((r) => ({ version: r.version, by: r.by_uid ? { uid: r.by_uid, name: r.by_name } : null, at: r.created_at })),
      diff: diffRules(role.default_rules, book.rules),
      floor: [...ALWAYS_ASKS_FLOOR],
    });
  } catch (e) { return mapError(c, e); }
});

router.put('/:scope/:id/rulebooks/:role', async (c) => {
  try {
    const user = await requireAuth(c);
    const s = await loadScope(c.env, c.req.param('scope'), c.req.param('id'));
    const role = roleOf(c.req.param('role'));
    if (!s || !role) return notFound(c);
    if (!(await canRead(c.env, s, user))) return say(c, 403, 'not_member', 'Only the team can see its rule books.');
    if (!(await canManage(c.env, s, user))) return say(c, 403, 'not_manager', 'Only the team’s editors can change a rule book.');
    const b = await readBody(c);
    const check = checkRules(b?.rules);
    if (!check.ok) return say(c, 422, check.code, check.message, { section: check.section });
    const [companyId, projectId] = scopeCols(s);
    const [top] = await bookRows(c.env, s, role.key);
    const version = (top?.version ?? 0) + 1;
    try {
      await c.env.DB.prepare(
        `INSERT INTO team_rulebooks (uid, scope_kind, company_id, project_id, role_key, version, rules_json, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(newUid(), s.kind, companyId, projectId, role.key, version, JSON.stringify(check.rules), user.id).run();
    } catch (e: any) {
      if (/UNIQUE/i.test(String(e?.message))) return say(c, 409, 'rulebook_changed', 'Someone saved this rule book a moment ago. Reload it and try again.');
      throw e;
    }
    const live = await c.env.DB.prepare(
      `SELECT id FROM team_agents WHERE status <> 'removed' AND scope_kind = ? AND IFNULL(company_id, 0) = ? AND IFNULL(project_id, 0) = ? AND role_key = ?`,
    ).bind(s.kind, companyId ?? 0, projectId ?? 0, role.key).first<{ id: number }>();
    if (live) await logEvent(c.env, live.id, user.id, 'rulebook_changed', { version });
    return c.json({ effective: check.rules, version });
  } catch (e) { return mapError(c, e); }
});

export default router;
