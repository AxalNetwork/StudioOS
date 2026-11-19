/**
 * D1496 part 2 (#3842, of #3727) — the only way a team agent runs.
 *
 * The run is the SPONSOR's (owner Q2 = B): `run()` is called with
 * `userId: sponsor_user_id`, so it is held and charged from the sponsor's AI
 * tokens, passes the sponsor's page switch, licence and spend limit, and is
 * logged under the sponsor with `ai_usage_logs.agent_id`. Its output is a
 * proposal (owner Q1 = A): an `ai_rail_proposals` row with `agent_id`, under
 * the sponsor's `user_id`, which a person decides. Nothing is automatic.
 *
 * In order, each step refusing in its own words:
 *  1. the agent, its scope and its rule book in force;
 *  2. the sponsor still passes the scope's manage gate, else the agent is
 *     paused `sponsor_left` and the run is 403 `sponsor_lost_access`;
 *  3. a paused agent is 403 `agent_paused`; the module is in `works_in`
 *     (403 `module_not_allowed`) and the option in `may_propose` and offered
 *     in that module (403 `option_not_allowed`); an option that needs a file,
 *     a picture or audio is 422 `option_not_text`: an agent writes text;
 *  4. the agent's spend this UTC month, the sum of its rows'
 *     `charged_microusd`: at or over the cap, the agent is paused `cap` and the
 *     run is 402 `agent_cap_reached`. A spend that cannot be read refuses the
 *     run (503 `agent_spend_unreadable`); it is never read as 0;
 *  5. `run()` on the option's own rail row and the agent's model, the hold
 *     named `agent.<role_key>` on the `ai` surface. Every refusal of `run()`
 *     passes through with its own words;
 *  6. `proposeRail` writes the output with `agent_id`;
 *  7. a `run` event (with `usage_log_id` and `proposal_uid`) or a `refused` one,
 *     both by the sponsor; a pause is the system's (no actor).
 *
 * Part 5 (#3844): between steps 4 and 5, the reads the sponsor named
 * (`toolReads`) run through `agentTools.ts`: only granted tools, at most five,
 * each metered and cut to 8 KB, the results in the prompt only inside the
 * untrusted-data wrapper. A granted server that is gone or drifted pauses the
 * agent `tool_disconnected` and the run is 409 `tool_disconnected`.
 *
 * RUN IDENTITY (#3846, #3742 E2). A run has a uid (`runUid`; a fresh one when
 * the caller names none). Its key is `agent:<run uid>`: the proposal's
 * `run_key` (unique) and, with `:run`, the hold's idempotency key, so a step
 * retried any number of times takes one hold, makes at most one proposal and
 * is charged once:
 *  - a retry whose proposal exists answers that proposal (`replayed: true`)
 *    before any check, and runs nothing;
 *  - a retry whose hold replays with no proposal runs nothing and ends
 *    `step_lost` (409, charging nothing more), or `step_in_flight` (409) while
 *    the first attempt's hold is still pending.
 * The hold also carries `executionId: <run uid>`. A `taskId` must be a task
 * assigned to this agent (422 `task_not_assigned`) and is written on the
 * proposal.
 *
 * GATEWAY (#3847, D1528). The run passes the `agents` AI Gateway id
 * (`AGENT_AI_GATEWAY`, unset = none); a call the gateway refused for its limit
 * answers 503 `gateway_limit`, which the runtime treats as the platform's
 * circuit breaker.
 *
 * D7073 (#7073): the gateway fails closed. An id that is set but unusable
 * refuses every run (503 `gateway_misconfigured`); a run the engine started
 * (`engine: true`, the task loop) with no id refuses 503 `gateway_required`,
 * unless the deterministic inference stub answers the call (no model is
 * reached). Both refuse before anything is priced, held or read. A sponsor's
 * own run with no id set is unchanged. And a 429 is no longer always the
 * gateway's: an attempt Workers AI refused for capacity (codes 3040, 3036) is
 * `model_throttled` (503), which pauses nothing.
 *
 * The tool reads are named by the same run uid. Neither the prompt nor the
 * output is logged, thrown or written to an event.
 *
 * SKILLS (D1612 part D, #3954). A run may name one of the agent's skills
 * (`skill`, its uid). After the reads are shaped and before the model sees
 * anything, `skillForRun` (`skillEval.ts`) takes the version pinned on the
 * agent, refuses a suspended one, re-checks its tools against the agent's
 * grants (`tool_not_approved`) and refuses a read outside its allow-list
 * (`tool_not_in_skill`). Its steps and allow-list join the system prompt; the
 * usage row records `skill_id` and `skill_version`.
 *
 * SKILL RUNTIME (D4555, #4555). The skill's text comes through
 * `skillTextForRun` (`skillRuntime.ts`). The legacy loader is the default and
 * gives today's `skillPrompt()` text with no other read. Only the preview
 * Worker with `AGENT_SKILL_RUNTIME=cloudflare_sdk` (`skillEngineOf`) loads it
 * through the Agent Skills SDK adapter, over the D1-authorized run manifest;
 * a D1 re-check that refuses there is 409 `skill_unavailable` before any
 * model call, and its `run` event names the runtime (`skill_runtime`).
 *
 * EVIDENCE (D4667-p2, #4667). A skill of the first ten runs only when its required evidence can be supplied:
 * right after `skillForRun`, and before the skill text, the tool reads, the hold and the model,
 * `skillEvidenceForRun` reads the same preflight the readiness surface reports, as the sponsor, through the keys
 * the agent's rule book reads. `not_ready` is 422 `skill_not_ready`, naming the inputs; nothing is held or charged.
 * A conditional run's system prompt states its limits. A manual run carries the evidence it judged in its message,
 * as data. An engine run gets that check from the task loop (`readiness`), whose context holds the reads already.
 * A retried step still answers its proposal first, before any check.
 */
import { agentModels, planOk } from './modelOffers';
import { allowlistRefusal } from './allowlists';
import type { Env, User } from '../../types';
import { inferenceStubOn } from '../ai/inferenceStub';
import { accountSlots, runAccounts, slotQuote } from './agentAccounts';
import { memberChargeMultiplier } from '../aiBudget';
import { PLATFORM_PAUSED_MESSAGE, modelUnder, readPolicy } from './aiPolicy';
import { agentArea } from './adminReads';
import { ROUTE, quoteRun, run, type RailContext, type RefusalReason, type RunOptions, type TaskClass } from '../aiRouter';
import { railOptionsOn, type RailOptionRow } from '../ai/railMatrix';
import { proposeRail, railByRunKey, type RailProposal } from '../railProposals';
import { moduleOf, optionsIn, type ModuleDef, type Rules } from './catalogue';
import { agentDisclaimerText, disclaimerKeyForRole } from './disclaimers';
import { personaOf } from './personas';
import { canManage, effectiveBook, logEvent, monthSpend, scopeOfAgent, type AgentRow, type Scope, type Spend } from './teams';
import { cleanReads, grantsOf, readTools, type ToolDeps } from './agentTools';
import { skillForRun, tagUsage } from './skillEval';
import { skillEngineOf, skillTextForRun, type RunSkillDeps, type RunSkillText } from './skillRuntime';
import { documentOfRecord, EVIDENCE_NOTICE, limitsPrompt, skillEvidenceForRun, ventureOfRun, type RunEvidence } from './skillEvidence';

export const PROMPT_MAX = 8000;
const CYCLE_PAGE = { validate: 'Founder · Validate', build: 'Founder · Build', raise: 'Founder · Raise', grow: 'Founder · Grow' } as const;

export type AgentRunInput = {
  agent: AgentRow;
  module: string;
  option: string;
  record?: string | null;
  prompt: string;
  /** Part 5: the reads the sponsor named, `[{ integration_uid, tool, arguments? }]`; untrusted until `cleanReads`. */
  toolReads?: unknown;
  /** Tests only: the tool call and the meter. */
  toolDeps?: ToolDeps;
  /** #3846: the task this run works on; it must be assigned to this agent. */
  taskId?: number | null;
  /** #3846: the run's uid, the same on every retry of one step. Absent, the run gets a fresh one. */
  runUid?: string | null;
  /** D1612 part D (#3954): the uid of one of the agent's skills; its PINNED version guides the run. */
  skill?: string | null;
  /** D4534: the version the caller saved (a scheduled session); a different pin is refused `skill_version_changed`. */
  skillVersion?: number | null;
  /** D4555, tests only: the SDK and resource provider the preview skill runtime uses. */
  skillDeps?: RunSkillDeps;
  /** D7073: true only from the task loop (`agents/loop.ts`). An engine run needs the `agents` gateway. */
  engine?: boolean;
  /**
   * D4667-p2: the task loop's evidence check of this run's skill (`skillEvidenceForRun` over its own context).
   * Read only on an engine run and only for the same skill; any other run makes its own check.
   */
  readiness?: Pick<RunEvidence, 'slug' | 'limits'> | null;
};

export type AgentRefusal = { ok: false; status: number; code: string; message: string; extra?: Record<string, unknown> };
/** #3846: a retried step whose hold was taken but whose proposal never landed. Nothing more was charged. */
export type AgentStepLost = AgentRefusal & { code: 'step_lost'; holdStatus: string; runKey: string };
export type AgentRunResult =
  | { ok: true; proposal: RailProposal; charged: Spend; usageLogId: number | null; runKey: string; replayed: boolean }
  | AgentStepLost
  | AgentRefusal;

const RUN_UID_RE = /^[A-Za-z0-9-]{8,64}$/;
/** `agent:<run uid>`: the proposal's `run_key`; `<run key>:run` is the hold's idempotency key. */
export const runKeyOf = (runUid: string) => `agent:${runUid}`;
export const holdKeyOf = (runKey: string) => `${runKey}:run`;
/**
 * D7073: what `AGENT_AI_GATEWAY` holds. `none` is unset or blank; `malformed`
 * is set to something that cannot name a gateway, which is never read as none.
 */
export type AgentGateway = { kind: 'none' } | { kind: 'ok'; id: string } | { kind: 'malformed' };
export const agentGateway = (env: Pick<Env, 'AGENT_AI_GATEWAY'>): AgentGateway => {
  const v = String(env.AGENT_AI_GATEWAY ?? '').trim();
  if (!v) return { kind: 'none' };
  return /^[A-Za-z0-9_-]{1,64}$/.test(v) ? { kind: 'ok', id: v } : { kind: 'malformed' };
};
/**
 * D1528 (#3847, #3742 E3): the `agents` AI Gateway id, from `AGENT_AI_GATEWAY`;
 * unset is none. Only this file passes a gateway id to the router.
 */
export const agentGatewayId = (env: Pick<Env, 'AGENT_AI_GATEWAY'>): string | null => {
  const g = agentGateway(env);
  return g.kind === 'ok' ? g.id : null;
};
/**
 * D7073: the gateway's refusal of a run, before anything is priced, held or
 * read; null lets it on. A malformed id refuses every run. An engine run with
 * no id is refused unless the inference stub answers it (`inferenceStubOn`:
 * the preview Worker of #4594, where no model is reached).
 */
export function gatewayRefusal(env: Pick<Env, 'AGENT_AI_GATEWAY' | 'ENVIRONMENT' | 'STUDIOOS_ENV' | 'AGENT_INFERENCE_STUB'>, engineRun: boolean): AgentRefusal | null {
  const g = agentGateway(env);
  if (g.kind === 'malformed') return no(503, 'gateway_misconfigured', 'The agent gateway is set up wrongly, so the agent was not run. Nothing was charged.');
  if (g.kind === 'none' && engineRun && !inferenceStubOn(env)) return no(503, 'gateway_required', 'The agent gateway is not set up yet, so the agent was not run. Nothing was charged.');
  return null;
}
type Attempt = { ok: boolean; status?: number; code?: number | null };
/** Workers AI's own 429s: 3040 out of capacity, 3036 the account's allocation. Neither is the gateway's limit. */
const MODEL_THROTTLE_CODES: ReadonlySet<number> = new Set([3036, 3040]);
const limited = (x: Attempt) => !x.ok && x.status === 429;
const modelsOwn = (x: Attempt) => MODEL_THROTTLE_CODES.has(Number(x.code));
/** A gatewayed call the gateway refused for its limit: an attempt answered 429 that Workers AI's capacity does not explain. */
export const gatewayLimited = (r: { attempts?: Attempt[] }) => !!r.attempts?.some((x) => limited(x) && !modelsOwn(x));
/** D7073: every 429 of a failed run was Workers AI's own capacity. Ordinary throttling: nothing is paused. */
export const modelThrottled = (r: { attempts?: Attempt[] }) => {
  const l = (r.attempts ?? []).filter(limited);
  return l.length > 0 && l.every(modelsOwn);
};
export type AgentQuote = { ok: true; quote: Spend } | AgentRefusal;

const no = (status: number, code: string, message: string, extra?: Record<string, unknown>): AgentRefusal => ({ ok: false, status, code, message, ...(extra ? { extra } : {}) });

/** The status a refusal of the router's run answers with. Its words are the router's own. */
export function runRefusalStatus(r: RefusalReason | undefined): number {
  switch (r) {
    case 'assist_off': case 'ai_paused': return 403;
    case 'budget_user_day': case 'budget_user_month': case 'budget_review': case 'spend_limit': return 402;
    case 'model_not_offered': case 'model_unpriced': case 'model_terms_unreviewed': case 'guard_blocked': case 'guard_blocked_output': case 'safety_block': return 422;
    case 'invalid_input': return 400;
    default: return 503;
  }
}

/**
 * The option's own rail row in the module: on the module's page, or on its
 * cycle's page ("Founder · Grow" holds every Grow module's options), or under
 * a page-less module's own pages. Null when the module does not offer it.
 */
export function optionRowIn(moduleKey: string, optionKey: string): RailOptionRow | null {
  const m = moduleOf(moduleKey);
  if (!m || !optionsIn(moduleKey).includes(optionKey)) return null;
  const pages = [m.page, ...(m.cycle ? [CYCLE_PAGE[m.cycle]] : [])];
  for (const p of pages) {
    const row = railOptionsOn(p).find((o) => o.optionKey === optionKey);
    if (row) return row;
  }
  return null;
}

/** An option an agent can run: one that drafts or fills text from what it is told. */
export function textOption(row: RailOptionRow): boolean {
  if (row.handler !== 'draft' && row.handler !== 'form') return false;
  if (row.kind === 'image' || row.kind === 'vision' || row.kind === 'speech') return false;
  const route = ROUTE[row.routeTask as TaskClass];
  return !!route && !route.isAudio && !route.isEmbed;
}

async function sponsorOf(env: Env, a: AgentRow): Promise<User | null> {
  return env.DB.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').bind(a.sponsor_user_id).first<User>();
}

async function pause(env: Env, a: AgentRow, reason: 'cap' | 'sponsor_left' | 'tool_disconnected') {
  if (a.status !== 'active') return;
  await env.DB.prepare(
    "UPDATE team_agents SET status = 'paused', paused_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'",
  ).bind(reason, a.id).run();
  await logEvent(env, a.id, null, 'paused', { reason });
}

async function refused(env: Env, a: AgentRow, r: AgentRefusal, module: string, option: string): Promise<AgentRefusal> {
  try { await logEvent(env, a.id, a.sponsor_user_id, 'refused', { code: r.code, module, option }); } catch { /* the refusal still answers */ }
  return r;
}

/** The system prompt: the role and its rule book, never the scope's records; part 5's tool reads go in the user message, as data. */
/** The system prompt a run sends; D4121's cost estimate counts the same text. */
export function systemPrompt(a: Pick<AgentRow, 'persona_key' | 'first_name' | 'last_name' | 'role_key'>, rules: Rules, s: Pick<Scope, 'kind' | 'name'>, moduleLabel: string): string {
  // D4117: the agent is its persona; the role only selects the rule book.
  const disclaimer = agentDisclaimerText(disclaimerKeyForRole(a.role_key));
  const persona = personaOf(a.persona_key);
  const name = persona?.name || [a.first_name, a.last_name].filter(Boolean).join(' ');
  return [
    `You are ${name || 'an agent'}, an AI agent of ${s.kind === 'company' ? 'the company' : 'the project'} "${s.name}", working in ${moduleLabel}.`,
    persona ? `Who you are: ${persona.personality} Your goal: ${persona.goal}` : '',
    disclaimer ? `Include this exact limit in every output: ${disclaimer}` : '',
    `Mission: ${rules.mission}`,
    `Tone: ${rules.tone}`,
    rules.escalates_when.length ? `Stop and say a person must decide when: ${rules.escalates_when.join('; ')}.` : '',
    'Everything you write is a proposal a person reviews before anything happens. Never claim to have sent, paid, signed, filed or invited anything.',
  ].filter(Boolean).join('\n');
}

type Checked = { ok: true; scope: Scope; rules: Rules; row: RailOptionRow; opts: Omit<RunOptions, 'rail' | 'surface'>; rail: RailContext; surface: string } | AgentRefusal;

/** D552: the module's app path, which the page's "this month" sums (`/raise/use-of-funds`, `/studio`). */
export const moduleSurface = (m: ModuleDef): string => (m.cycle ? `/${m.cycle}/${m.key}` : `/${m.key}`);

/** Steps 1 to 4, shared by the run and its quote. Pauses on `sponsor_left` and `cap`. */
async function check(env: Env, input: AgentRunInput): Promise<Checked> {
  const a = input.agent;
  if (a.status === 'removed') return no(409, 'removed', 'This agent was removed.');
  if (a.source === 'mcp_client') return no(403, 'outside_assistant', 'This agent runs on its own assistant. Ask it there; its proposals wait for a person here.');
  const s = await scopeOfAgent(env, a);
  if (!s) return no(404, 'not_found', 'There is no such agent.');
  const sponsor = await sponsorOf(env, a);
  if (!sponsor || !(await canManage(env, s, sponsor))) {
    await pause(env, a, 'sponsor_left');
    return no(403, 'sponsor_lost_access', 'The person who added this agent can no longer manage this team, so it is paused. An editor can choose a new sponsor.');
  }
  const allowed = await allowlistRefusal(env, s, a.model_id, grantsOf(a.tool_grants_json));
  if (allowed) return allowed;
  if (!planOk(sponsor)) return no(403, 'plan_required', 'Agents come with a paid Founder plan.');
  if (!agentModels(env, sponsor).some((m) => m.id === a.model_id && !m.plan_locked)) return no(403, 'model_not_offered', 'This agent’s model is no longer offered on its sponsor’s plan.');
  if (a.status === 'paused') return no(403, 'agent_paused', 'This agent is paused. Resume it to run it.', { paused_reason: a.paused_reason });
  const { rules } = await effectiveBook(env, s, a.role_key);
  const m = moduleOf(input.module);
  if (!m || !rules.works_in.includes(m.key)) return no(403, 'module_not_allowed', 'This agent does not work in that module. Its rule book lists where it works.');
  const row = rules.may_propose.includes(input.option) ? optionRowIn(m.key, input.option) : null;
  if (!row) return no(403, 'option_not_allowed', 'This agent may not propose that here. Its rule book lists what it may propose.');
  if (!textOption(row)) return no(422, 'option_not_text', 'That option needs a file, a picture or a recording. An agent can only write text for now.');
  const spent = await monthSpend(env, a.id);
  if (!spent.available) return no(503, 'agent_spend_unreadable', 'This agent\'s spend this month could not be read, so it was not run. Try again shortly.');
  if (spent.value_microusd >= a.monthly_cap_microusd) {
    await pause(env, a, 'cap');
    return no(402, 'agent_cap_reached', 'This agent has reached its monthly cap, so it is paused. Raise the cap to resume it.');
  }
  const opts: Omit<RunOptions, 'rail' | 'surface'> = {
    task: row.routeTask as TaskClass,
    userId: sponsor.id,
    role: sponsor.role ?? null,
    model: a.model_id,
    systemPrompt: systemPrompt(a, rules, s, m.label),
    messages: [{ role: 'user', content: input.prompt }],
    guardText: input.prompt,
    agentId: a.id,
    agentRole: a.role_key,
  };
  // D765: the option's own page, the option and the record, at the call (rail_run_path_d765 reads it there).
  const rail: RailContext = { page: row.pageKey, option: row.optionKey, record: input.record ?? null };
  return { ok: true, scope: s, rules, row, opts, rail, surface: moduleSurface(m) };
}

function promptRefusal(prompt: unknown): AgentRefusal | null {
  if (typeof prompt !== 'string' || !prompt.trim()) return no(400, 'invalid_prompt', 'Say what the agent should work on.');
  if (prompt.length > PROMPT_MAX) return no(400, 'invalid_prompt', `Keep the request under ${PROMPT_MAX} characters.`);
  return null;
}

/** What the run would hold now: an upper bound, `available: false` when it cannot be read, never 0. */
export async function agentQuote(env: Env, input: Omit<AgentRunInput, 'prompt'> & { prompt?: string }): Promise<AgentQuote> {
  const c = await check(env, { ...input, prompt: input.prompt?.trim() ? input.prompt : ' ' });
  if (!c.ok) return c;
  // #5340: with the preview switch on, a quote for a named skill holds the text the SDK path sends; switched off, nothing is read for it.
  if (input.skill != null && skillEngineOf(env) === 'cloudflare_sdk') {
    const skill = await skillForRun(env, input.agent, input.skill, [], input.skillVersion ?? null);
    if (!skill.ok) return skill;
    const loaded = await skillTextForRun(env, input.agent.id, skill, 'cloudflare_sdk', input.skillDeps);
    if (!loaded.ok) return no(409, 'skill_unavailable', 'This skill is no longer available to this agent, so it was not run.');
    c.opts.systemPrompt = `${c.opts.systemPrompt}\n\n${loaded.text}`;
  }
  try {
    const q = await quoteRun(env, { ...c.opts, rail: c.rail, surface: c.surface });
    // `misconfigured` is quoteRun's "Unreadable": the price is unknown, which is not 0 and not a refusal of the run.
    if (!q.ok && q.refusal === 'misconfigured') return { ok: true, quote: { available: false } };
    if (!q.ok) return no(runRefusalStatus(q.refusal), q.refusal, q.error);
    return { ok: true, quote: { available: true, value_microusd: q.hold_microusd } };
  } catch {
    return { ok: true, quote: { available: false } };
  }
}

/** The usage row's charge with its guard rows', or unknown when any is unrecorded. */
export async function chargedFor(env: Env, usageLogId: number | null): Promise<Spend> {
  if (!usageLogId) return { available: false };
  try {
    const row = await env.DB.prepare(
      `SELECT SUM(charged_microusd) AS charged, SUM(CASE WHEN charged_microusd IS NULL THEN 1 ELSE 0 END) AS unrecorded
         FROM ai_usage_logs WHERE id = ? OR guard_for = ?`,
    ).bind(usageLogId, usageLogId).first<{ charged: number | null; unrecorded: number | null }>();
    if (!row || Number(row.unrecorded) > 0 || row.charged == null) return { available: false };
    return { available: true, value_microusd: Number(row.charged) };
  } catch {
    return { available: false };
  }
}

/** #3846: a task this agent may work on: one of its own, assigned to it. */
async function taskRefusal(env: Env, a: AgentRow, taskId: number | null | undefined): Promise<AgentRefusal | null> {
  if (taskId == null) return null;
  const t = Number.isSafeInteger(taskId) && taskId > 0
    ? await env.DB.prepare("SELECT id FROM scope_tasks WHERE id = ? AND assignee_kind = 'agent' AND assignee_agent_id = ?").bind(taskId, a.id).first<{ id: number }>()
    : null;
  return t ? null : no(422, 'task_not_assigned', 'That task is not this agent\'s.');
}

/**
 * D4162: the platform's AI policy on one run. The kill switch refuses it (403
 * `platform_paused`); a locked model is swapped for the agent's area default,
 * or refused (403 `model_locked`) when that is locked too; a quote above the
 * per-run ceiling is refused (402 `run_ceiling`) before any hold. A policy that
 * cannot be read refuses the run: it may be paused.
 */
async function underPolicy(env: Env, a: AgentRow, c: { opts: Omit<RunOptions, 'rail' | 'surface'>; rail: RailContext; surface: string }): Promise<AgentRefusal | null> {
  const policy = await readPolicy(env);
  if (!policy) return no(503, 'policy_unreadable', 'The platform\'s AI policy could not be read, so the agent was not run. Try again shortly.');
  if (policy.paused.on) return no(403, 'platform_paused', PLATFORM_PAUSED_MESSAGE);
  if (c.opts.model) {
    const area = await agentArea(env, a.id);
    const m = modelUnder(policy, String(c.opts.model), area);
    if (!m) return no(403, 'model_locked', 'This agent\'s model is switched off on the platform, and so is its area\'s default. Pick another model for it.');
    const scope = await scopeOfAgent(env, a);
    if (!scope) return no(404, 'not_found', 'There is no such agent.');
    const allowed = await allowlistRefusal(env, scope, m.model, []);
    if (allowed) return allowed;
    c.opts.model = m.model;
  }
  return ceilingRefusal(env, c, policy.per_run_ceiling_microusd);
}

/** D4162's per-run ceiling, quoted on the run's system prompt as it stands; also called once the SDK path's skill text is in (#5340). */
async function ceilingRefusal(env: Env, c: { opts: Omit<RunOptions, 'rail' | 'surface'>; rail: RailContext; surface: string }, ceiling: number | null): Promise<AgentRefusal | null> {
  if (ceiling == null) return null;
  let q: Awaited<ReturnType<typeof quoteRun>>;
  try { q = await quoteRun(env, { ...c.opts, rail: c.rail, surface: c.surface }); } catch { q = { ok: false, refusal: 'misconfigured', error: 'unreadable' } as any; }
  if (!q.ok) return no(503, 'run_quote_unreadable', 'This run could not be priced, so it was not checked against the platform\'s per-run ceiling. Nothing was charged.');
  if (q.hold_microusd > ceiling) {
    return no(402, 'run_ceiling', `This run would cost more than the platform's per-run ceiling of $${(ceiling / 1e6).toFixed(2)}. Nothing was charged.`);
  }
  return null;
}

export async function agentRun(env: Env, input: AgentRunInput): Promise<AgentRunResult> {
  const a = input.agent;
  if (input.runUid != null && !(typeof input.runUid === 'string' && RUN_UID_RE.test(input.runUid))) {
    return no(400, 'invalid_run', 'A run is named by a uid of letters, digits and dashes.');
  }
  const runUid = input.runUid ?? crypto.randomUUID();
  const runKey = runKeyOf(runUid);
  // A retry of a step that already proposed answers that proposal and runs nothing.
  const done = await railByRunKey(env, a.sponsor_user_id, runKey);
  if (done) return { ok: true, proposal: done, charged: await chargedFor(env, done.usage_log_id), usageLogId: done.usage_log_id, runKey, replayed: true };
  const bad = promptRefusal(input.prompt) ?? await taskRefusal(env, a, input.taskId);
  if (bad) return refused(env, a, bad, input.module, input.option);
  const c = await check(env, input);
  if (!c.ok) return a.status === 'removed' || c.code === 'not_found' ? c : refused(env, a, c, input.module, input.option);
  // D7073: the gateway fails closed, before the policy quote, the reads and the hold.
  const ungated = gatewayRefusal(env, input.engine === true);
  if (ungated) return refused(env, a, ungated, input.module, input.option);
  // D4162 (#4162): HQ's AI policy, before anything is read, held or charged.
  const held = await underPolicy(env, a, c);
  if (held) return refused(env, a, held, input.module, input.option);
  // Part 5: the named reads, through granted tools only, before the model sees anything.
  const shaped = cleanReads(input.toolReads, grantsOf(a.tool_grants_json));
  if (!shaped.ok) return refused(env, a, shaped, input.module, input.option);
  // D1612 part D (#3954): a named skill runs at the agent's pinned version; its tools are checked again now.
  const skill = input.skill != null ? await skillForRun(env, a, input.skill, shaped.reads.map((t) => t.tool), input.skillVersion ?? null) : null;
  if (skill && !skill.ok) return refused(env, a, skill, input.module, input.option);
  // D4667-p2: a skill of the first ten runs only on evidence its readers can supply; before any text, read, hold or charge.
  let evidence: Pick<RunEvidence, 'slug' | 'limits'> & { blocks?: string[] } | null = null;
  if (skill) {
    const given = input.engine === true && input.readiness && input.readiness.slug === skill.skill.slug ? input.readiness : null;
    if (given) evidence = given;
    else {
      const checked = await skillEvidenceForRun(env, {
        agent: a, scope: c.scope, rules: c.rules, slug: skill.skill.slug, projectId: await ventureOfRun(env, c.scope, input.taskId),
        // D4667-p3: a run on one data-room document (`record`, `data_room_file:<uid>`) reads that document's text.
        document: documentOfRecord(input.record),
      });
      if (!checked.ok) return refused(env, a, checked, input.module, input.option);
      evidence = checked.evidence;
    }
  }
  // D4555: the skill's text through the skill runtime; the legacy loader unless the preview switch is on.
  const engine = skill ? skillEngineOf(env) : 'legacy';
  let loaded: RunSkillText | null = null;
  if (skill) {
    loaded = await skillTextForRun(env, a.id, skill, engine, input.skillDeps);
    if (!loaded.ok) return refused(env, a, no(409, 'skill_unavailable', 'This skill is no longer available to this agent, so it was not run.'), input.module, input.option);
    c.opts.systemPrompt = `${c.opts.systemPrompt}\n\n${loaded.text}`;
    const limits = limitsPrompt(evidence);
    if (limits) c.opts.systemPrompt = `${c.opts.systemPrompt}\n\n${limits}`;
    // #5340: the SDK path's text (activation and files) is priced before any hold; the ceiling quote above did not hold it.
    if (loaded.runtime === 'cloudflare_sdk') {
      const policy = await readPolicy(env);
      const over = policy ? await ceilingRefusal(env, c, policy.per_run_ceiling_microusd)
        : no(503, 'policy_unreadable', 'The platform\'s AI policy could not be read, so the agent was not run. Try again shortly.');
      if (over) return refused(env, a, over, input.module, input.option);
    }
  }
  // D4667-p2: a manual run carries the evidence its check read, as data, priced against the ceiling before any hold.
  const bound = evidence?.blocks?.length ? `${EVIDENCE_NOTICE}\n${evidence.blocks.join('\n')}` : '';
  if (bound) {
    c.opts.messages = [{ role: 'user', content: `${input.prompt}\n\n${bound}` }];
    const policy = await readPolicy(env);
    const over = policy ? await ceilingRefusal(env, c, policy.per_run_ceiling_microusd)
      : no(503, 'policy_unreadable', 'The platform\'s AI policy could not be read, so the agent was not run. Try again shortly.');
    if (over) return refused(env, a, over, input.module, input.option);
  }
  const read = await readTools(env, a, shaped.reads, runUid, input.toolDeps);
  if ('disconnected' in read) {
    await pause(env, a, 'tool_disconnected');
    return refused(env, a, no(409, 'tool_disconnected', `${read.disconnected.name} is disconnected or one of its tools changed, so this agent is paused. Reconnect it, then resume the agent.`,
      { server: read.disconnected }), input.module, input.option);
  }
  if (!read.ok) return refused(env, a, read, input.module, input.option);
  if (read.block) c.opts.messages = [{ role: 'user', content: [input.prompt, bound, read.block].filter(Boolean).join('\n\n') }];
  // #7073 part 2 (D7073-p2): a run the engine started calls the model accounts through the `agents` gateway, in order.
  // The Stage A preview's stub answers on the router's path below, so it never reaches a live account.
  if (input.engine === true && !inferenceStubOn(env)) {
    return accountRun(env, a, input, c, { runUid, runKey, shaped, skill });
  }
  const gatewayId = agentGatewayId(env);
  const r = await run(env, { ...c.opts, rail: c.rail, surface: c.surface, idempotencyKey: holdKeyOf(runKey), executionId: runUid, gatewayId });
  if (!r.ok && r.refusal === 'step_replayed') {
    // The hold was taken by an earlier attempt. Its proposal may have landed in the meantime.
    const landed = await railByRunKey(env, a.sponsor_user_id, runKey);
    if (landed) return { ok: true, proposal: landed, charged: await chargedFor(env, landed.usage_log_id), usageLogId: landed.usage_log_id, runKey, replayed: true };
    const holdStatus = r.replayedStatus ?? 'unknown';
    if (holdStatus === 'pending') {
      return refused(env, a, no(409, 'step_in_flight', 'This step is still running. Try again in a moment.'), input.module, input.option);
    }
    const lost: AgentStepLost = { ...no(409, 'step_lost', 'This step ran before, but what it wrote was not saved. Nothing more was charged.'), code: 'step_lost', holdStatus, runKey };
    await refused(env, a, lost, input.module, input.option);
    return lost;
  }
  if (!r.ok && gatewayId && gatewayLimited(r)) {
    // D1528: the `agents` gateway's limit is the platform's circuit breaker; the runtime pauses the engine.
    return refused(env, a, no(503, 'gateway_limit', 'Agents reached the platform\'s limit, so they are paused for now. You can still work on this yourself.'), input.module, input.option);
  }
  if (!r.ok && modelThrottled(r)) {
    // D7073: Workers AI was out of capacity. The task is tried again later; no agent and no engine is paused.
    return refused(env, a, no(503, 'model_throttled', 'The model is busy right now, so the agent did not finish. Try again shortly.'), input.module, input.option);
  }
  if (!r.ok) {
    // The guard's own words (and its Wellbeing link) when it refused; else the router's.
    const words = r.guard?.refusal?.message ?? r.error ?? 'The agent could not run.';
    const link = r.guard?.refusal?.link;
    return refused(env, a, no(runRefusalStatus(r.refusal), r.refusal ?? 'run_failed', words, link ? { link } : undefined), input.module, input.option);
  }
  const usageLogId = r.usageLogId ?? null;
  if (skill) await tagUsage(env, usageLogId, skill.skill.id, skill.version.version);
  let proposal: RailProposal;
  try {
    proposal = await proposeRail(env, {
      userId: c.opts.userId, page: c.row.pageKey, option: c.row.optionKey, record: input.record ?? null,
      kind: 'draft', payload: { text: r.output ?? '' }, model: r.usage.model, usageLogId, agentId: a.id,
      taskId: input.taskId ?? null, runKey,
    });
  } catch {
    return refused(env, a, no(500, 'proposal_not_saved', 'The agent ran, but its proposal could not be saved.'), input.module, input.option);
  }
  // The tools read are named, never their arguments or results.
  const tools = shaped.reads.map((t) => ({ integration_uid: t.integration_uid, tool: t.tool }));
  await logEvent(env, a.id, a.sponsor_user_id, 'run', {
    module: input.module, option: input.option, ...(tools.length ? { tool_reads: tools } : {}),
    ...(skill ? { skill: { uid: skill.skill.uid, version: skill.version.version } } : {}),
    // D4555: only a run that asked for the SDK names its runtime; a legacy run's event is unchanged.
    ...(engine === 'cloudflare_sdk' && loaded?.ok ? { skill_runtime: { runtime: loaded.runtime, fallback: loaded.fallback } } : {}),
  }, { usageLogId, proposalUid: proposal.uid });
  return { ok: true, proposal, charged: await chargedFor(env, usageLogId), usageLogId, runKey, replayed: false };
}

/** The answer a run's accounts give, at most this many tokens. */
export const AGENT_MAX_TOKENS = 2048;
const ACCOUNT_REFUSAL_STATUS: Record<string, number> = {
  accounts_unconfigured: 503, accounts_exhausted: 402, account_failed: 424, gateway_limit: 503,
  guard_blocked: 422, guard_unavailable: 503, step_lost: 409, insufficient_tokens: 402,
};

/**
 * #7073 part 2: the engine's run on the model accounts (`agentAccounts.ts`), with the same checks the router path
 * has: HQ's locks and the scope's allow-list per account model, the per-run ceiling against the dearest account,
 * the sponsor's holds, the guard, one proposal per run key. Returns the run's result.
 */
async function accountRun(env: Env, a: AgentRow, input: AgentRunInput, c: Extract<Checked, { ok: true }>, ctx: {
  runUid: string; runKey: string; shaped: { reads: Array<{ integration_uid: string; tool: string }> };
  skill: { ok: true; skill: { id: number; uid: string }; version: { version: number } } | { ok: false } | null;
}): Promise<AgentRunResult> {
  const policy = await readPolicy(env);
  if (!policy) return refused(env, a, no(503, 'policy_unreadable', 'The platform\'s AI policy could not be read, so the agent was not run. Try again shortly.'), input.module, input.option);
  const models = [...new Set(accountSlots(env as never).slots.map((s) => s.model))];
  const allowedSet = new Set<string>();
  for (const m of models) {
    const unlocked = !policy.locks.some((l) => l.model === m);
    if (unlocked && !(await allowlistRefusal(env, c.scope, m, []))) allowedSet.add(m);
  }
  const allowed = (m: string) => allowedSet.has(m);
  const request = {
    system: c.opts.systemPrompt,
    messages: (c.opts.messages ?? []).map((m) => ({ role: m.role === 'assistant' ? 'assistant' as const : 'user' as const, content: String(m.content) })),
    maxTokens: AGENT_MAX_TOKENS,
  };
  if (policy.per_run_ceiling_microusd != null) {
    const multiplier = await memberChargeMultiplier(env, c.opts.userId);
    const dearest = Math.max(0, ...accountSlots(env as never, allowed).slots.map((s) => slotQuote(s, request, multiplier)));
    if (dearest > policy.per_run_ceiling_microusd) {
      return refused(env, a, no(402, 'run_ceiling', `This run would cost more than the platform's per-run ceiling of $${(policy.per_run_ceiling_microusd / 1e6).toFixed(2)}. Nothing was charged.`), input.module, input.option);
    }
  }
  const r = await runAccounts(env, {
    who: { userId: c.opts.userId, surface: c.surface, railPage: c.rail.page, railOption: c.rail.option ?? undefined, recordRef: c.rail.record ?? undefined, agentId: a.id },
    task: c.opts.task, executionId: ctx.runUid, request, guardText: String(c.opts.guardText ?? input.prompt), allowed,
  });
  const account = (x: { slot: number; alias: string; model: string }) => ({ slot: x.slot, alias: x.alias, model: x.model });
  if (!r.ok) {
    if (r.code === 'step_lost') {
      const lost: AgentStepLost = { ...no(409, 'step_lost', r.message), code: 'step_lost', holdStatus: 'settled', runKey: ctx.runKey };
      await refused(env, a, lost, input.module, input.option);
      return lost;
    }
    try {
      await logEvent(env, a.id, a.sponsor_user_id, 'refused', {
        code: r.code, module: input.module, option: input.option,
        accounts: r.attempts.map((x) => ({ ...account(x), outcome: x.outcome, billed: x.billed })),
      });
    } catch { /* the refusal still answers */ }
    return no(ACCOUNT_REFUSAL_STATUS[r.code] ?? 424, r.code, r.message);
  }
  if (ctx.skill?.ok) await tagUsage(env, r.usageLogId, ctx.skill.skill.id, ctx.skill.version.version);
  let proposal: RailProposal;
  try {
    proposal = await proposeRail(env, {
      userId: c.opts.userId, page: c.row.pageKey, option: c.row.optionKey, record: input.record ?? null,
      kind: 'draft', payload: { text: r.output }, model: r.model, usageLogId: r.usageLogId, agentId: a.id,
      taskId: input.taskId ?? null, runKey: ctx.runKey,
    });
  } catch {
    return refused(env, a, no(500, 'proposal_not_saved', 'The agent ran, but its proposal could not be saved.'), input.module, input.option);
  }
  const tools = ctx.shaped.reads.map((t) => ({ integration_uid: t.integration_uid, tool: t.tool }));
  // The account that answered is named by slot, alias and model; never a key, a token or the prompt.
  await logEvent(env, a.id, a.sponsor_user_id, 'run', {
    module: input.module, option: input.option, ...(tools.length ? { tool_reads: tools } : {}),
    ...(ctx.skill?.ok ? { skill: { uid: ctx.skill.skill.uid, version: ctx.skill.version.version } } : {}),
    account: account(r), accounts_tried: r.attempts.length,
  }, { usageLogId: r.usageLogId, proposalUid: proposal.uid });
  return { ok: true, proposal, charged: await chargedFor(env, r.usageLogId), usageLogId: r.usageLogId, runKey: ctx.runKey, replayed: false };
}
