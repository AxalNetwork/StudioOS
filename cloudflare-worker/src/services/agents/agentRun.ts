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
 */
import { agentModels, planOk } from './modelOffers';
import { allowlistRefusal } from './allowlists';
import type { Env, User } from '../../types';
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
import { skillForRun, skillPrompt, tagUsage } from './skillEval';

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
 * D1528 (#3847, #3742 E3): the `agents` AI Gateway id, from `AGENT_AI_GATEWAY`;
 * unset is none. Only this file passes a gateway id to the router.
 */
export const agentGatewayId = (env: Pick<Env, 'AGENT_AI_GATEWAY'>): string | null => {
  const v = String(env.AGENT_AI_GATEWAY ?? '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
};
/** A gatewayed call the gateway refused for its limit: an attempt answered 429. */
export const gatewayLimited = (r: { attempts?: { ok: boolean; status?: number }[] }) => !!r.attempts?.some((x) => !x.ok && x.status === 429);
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
  const ceiling = policy.per_run_ceiling_microusd;
  if (ceiling != null) {
    let q: Awaited<ReturnType<typeof quoteRun>>;
    try { q = await quoteRun(env, { ...c.opts, rail: c.rail, surface: c.surface }); } catch { q = { ok: false, refusal: 'misconfigured', error: 'unreadable' } as any; }
    if (!q.ok) return no(503, 'run_quote_unreadable', 'This run could not be priced, so it was not checked against the platform\'s per-run ceiling. Nothing was charged.');
    if (q.hold_microusd > ceiling) {
      return no(402, 'run_ceiling', `This run would cost more than the platform's per-run ceiling of $${(ceiling / 1e6).toFixed(2)}. Nothing was charged.`);
    }
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
  // D4162 (#4162): HQ's AI policy, before anything is read, held or charged.
  const held = await underPolicy(env, a, c);
  if (held) return refused(env, a, held, input.module, input.option);
  // Part 5: the named reads, through granted tools only, before the model sees anything.
  const shaped = cleanReads(input.toolReads, grantsOf(a.tool_grants_json));
  if (!shaped.ok) return refused(env, a, shaped, input.module, input.option);
  // D1612 part D (#3954): a named skill runs at the agent's pinned version; its tools are checked again now.
  const skill = input.skill != null ? await skillForRun(env, a, input.skill, shaped.reads.map((t) => t.tool)) : null;
  if (skill && !skill.ok) return refused(env, a, skill, input.module, input.option);
  if (skill) c.opts.systemPrompt = `${c.opts.systemPrompt}\n\n${skillPrompt(skill.version)}`;
  const read = await readTools(env, a, shaped.reads, runUid, input.toolDeps);
  if ('disconnected' in read) {
    await pause(env, a, 'tool_disconnected');
    return refused(env, a, no(409, 'tool_disconnected', `${read.disconnected.name} is disconnected or one of its tools changed, so this agent is paused. Reconnect it, then resume the agent.`,
      { server: read.disconnected }), input.module, input.option);
  }
  if (!read.ok) return refused(env, a, read, input.module, input.option);
  if (read.block) c.opts.messages = [{ role: 'user', content: `${input.prompt}\n\n${read.block}` }];
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
  }, { usageLogId, proposalUid: proposal.uid });
  return { ok: true, proposal, charged: await chargedFor(env, usageLogId), usageLogId, runKey, replayed: false };
}
