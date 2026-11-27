/**
 * D8769 (#8769, `design/incoming/Team Agent and Model Choice Page.dc.html`,
 * TMM01–TMM11) — choosing an agent and its model by the work, whether it can
 * run, and what a run costs. Pure: no React, no network.
 *
 *   agentReadiness   one state per roster row, in the canvas's priority
 *                    (TMM07 C): paused, then no skills, then a count not
 *                    read, then Active. An unread count is never Active.
 *   engineNote       the team's engine (TMM07 A), one line above the table.
 *   rowOpenLabel / moreActionsLabel
 *                    the roster's two controls, named by the displayed name
 *                    and what they open, never by the persona's motto.
 *   modelGroups      the Model and cap step's models by the work they are
 *                    listed for (the Worker's `jobs`, from `USE_KINDS`): the
 *                    group suited to the agent's area first, then the rest
 *                    under the first job each is listed for.
 *   modelOffer       whether a listed model can be chosen: the plan lock and
 *                    the team's allowlist (D4422), never guessed.
 *   per100Line / capRunsLine / basisLine
 *                    the estimate's words, only from D4121's
 *                    `GET /:scope/:id/cost-estimate` answer; no answer, no figure.
 *   coverageSentence the coverage card's sentence, chosen by what the rows
 *                    hold (TMM09), never by the absence of a people gap alone.
 */
import { NOT_RECORDED } from '../../lib/absence.js';
import { workLabel } from './personaModel.js';
import { coverageSummary } from './skillsModel.js';

export { NOT_RECORDED };

// ── The roster (TMM01, TMM07) ─────────────────────────────────────────────

/**
 * The team's engine, from `useEngineRead(agentEngineApi.engine)`:
 * 'off' (the engine answered `agent_engine_off`), 'platform' (HQ halted or
 * paused every agent), 'team' (this team's agents are paused), 'on', or
 * 'unknown' while it is read or when it could not be.
 */
export function engineState(read) {
  if (!read || read.status === 'loading' || read.status === 'error' || read.status === 'refused') return 'unknown';
  if (read.status === 'off') return 'off';
  const e = read.data;
  if (!e || typeof e !== 'object') return 'unknown';
  if (e.halted || e.engine === 'paused' || e.engine === 'canary') return 'platform';
  if (e.scope_paused) return 'team';
  return 'on';
}

/**
 * The team's engine in words, for one line above the roster (TMM07 A's
 * banner), or null when it is on or not read. It is never a row's pill: the
 * engine runs goals and plans (D1531), while a person's own run of an agent
 * (`POST /agents/:uid/run`) does not need it, so an engine that is off does not
 * mean an agent cannot run. HQ's platform pause has its own banner (D4162).
 */
export const ENGINE_NOTE = Object.freeze({
  off: 'The agent engine is off for this team, so goals and plans do not run. Agents still propose when someone runs them.',
  platform: 'Axal has paused the agent engine on the platform, so goals and plans do not run.',
  team: 'An editor paused the agent engine for this team, so goals and plans do not run.',
});
export const engineNote = (engine) => ENGINE_NOTE[engine] || null;

const skillsWord = (n) => `${n} skill${n === 1 ? '' : 's'}`;

/**
 * One row's "Can it run now": `{ key, pill, tone, line }`, in the canvas's
 * priority (TMM07 C) for what belongs to the agent: paused (its reason is
 * drawn by the row), then no skills, then a count not read, then Active. The
 * line can name a second fact ("Paused · also no skills"). `tone` is 'ok',
 * 'amber' or 'muted'. An outside assistant holds no Axal skills, so its count
 * is not asked of it.
 */
export function agentReadiness(agent) {
  const outside = agent?.source === 'mcp_client';
  const raw = agent?.skill_count;
  const count = raw == null || raw === '' || !Number.isFinite(Number(raw)) ? null : Number(raw);
  const noSkills = !outside && count === 0;
  if (agent?.status === 'paused') return { key: 'paused', pill: 'Paused', tone: 'amber', line: `Paused${noSkills ? ' · also no skills' : ''}` };
  if (noSkills) return { key: 'no_skills', pill: 'No skills yet', tone: 'amber', line: 'Can’t run until a skill is added' };
  if (!outside && count == null) return { key: 'not_read', pill: NOT_RECORDED, tone: 'muted', line: 'Its skills could not be read' };
  return { key: 'active', pill: 'Active', tone: 'ok', line: outside ? 'Runs on its own assistant' : skillsWord(count) };
}

/** What the agent does, for the roster's second column and the profile: its area of work and how many skills. */
export function whatItDoes(agent) {
  if (agent?.source === 'mcp_client') return 'Connected app';
  return workLabel(agent?.role_key);
}

/** The row's name control: "Tessaly, AI agent, Finance: open profile". */
export function rowOpenLabel(name, agent) {
  const n = String(name || '').trim() || 'This agent';
  return `${n}, AI agent, ${whatItDoes(agent)}: open profile`;
}

/** The ⋯ button: "More actions for Tessaly". */
export const moreActionsLabel = (name) => `More actions for ${String(name || '').trim() || 'this agent'}`;

/** The ⋯ menu's items: always the profile; for a manager, the paused row's one fix. */
export function actionItems(row, canManage) {
  const items = [{ key: 'open', label: `Open ${row?.name || 'this agent'}’s profile` }];
  if (canManage && row?.pause?.fix) items.push({ key: 'fix', label: row.pause.fix, action: row.pause.action || null });
  return items;
}

// ── The model step (TMM05, TMM06) ─────────────────────────────────────────

/**
 * The job whose models suit each area of work (role key) — a judgement call
 * recorded in D8769: research, numbers and legal have their own `USE_KINDS`
 * kind; company direction, operations and product are planning; the rest
 * mostly write. A role with no entry has no suited group.
 */
export const ROLE_JOB = Object.freeze({
  research_analyst: 'research', cfo: 'numbers', general_counsel: 'legal', cto: 'code',
  ceo: 'plan', coo: 'plan', cpo: 'plan',
  cmo: 'write', sales: 'write', people: 'write', investor_relations: 'write',
});

/** A job's name as the step says it ("Suited to research", "Writing"). */
export const JOB_WORD = Object.freeze({
  research: 'Research', reason: 'Reasoning', numbers: 'Numbers', legal: 'Legal', write: 'Writing', synth: 'Summarising',
  plan: 'Planning', agent: 'Using tools', chat: 'Conversation', code: 'Code', read_images: 'Reading images',
});
export const jobWord = (job) => JOB_WORD[job?.key || job] || job?.label || 'Other work';
const jobsOf = (m) => (Array.isArray(m?.jobs) ? m.jobs.filter((j) => j && j.key) : []);

/**
 * The listed models by work: `{ suited, others }`. `suited` is
 * `{ key, title, models }` or null (no role, or no listed model fits it);
 * `others` keeps the rest under the first job each is listed for, in the
 * Worker's job order, and a model listed for no job under "Other work". Each
 * model appears once.
 */
export function modelGroups(models, roleKey) {
  const list = Array.isArray(models) ? models : [];
  const want = ROLE_JOB[roleKey] || null;
  const suitedModels = want ? list.filter((m) => jobsOf(m).some((j) => j.key === want)) : [];
  const suited = suitedModels.length ? { key: want, title: `Suited to ${jobWord(want).toLowerCase()}`, models: suitedModels } : null;
  const by = new Map();
  for (const m of list) {
    if (suited && suitedModels.includes(m)) continue;
    const first = jobsOf(m)[0];
    const k = first ? first.key : 'other';
    if (!by.has(k)) by.set(k, { key: k, title: first ? jobWord(first) : 'Other work', models: [] });
    by.get(k).models.push(m);
  }
  const order = Object.keys(JOB_WORD);
  const others = [...by.values()].sort((a, b) => (order.indexOf(a.key) < 0 ? 99 : order.indexOf(a.key)) - (order.indexOf(b.key) < 0 ? 99 : order.indexOf(b.key)));
  return { suited, others };
}

/**
 * The team's allowed model ids from `readAllowlists` (D4422): null when the
 * team keeps the plan default (every offered model), a Set when it chose, and
 * 'unread' when the read failed, so nothing is marked on a guess.
 */
export function allowedModels(block) {
  if (!block) return 'unread';
  if (!block.available) return 'unread';
  const ids = block.value?.model_ids;
  if (ids === null || ids === undefined) return null;
  return Array.isArray(ids) ? new Set(ids) : 'unread';
}

/** Whether a listed model can be chosen: 'ok', 'plan' (not on the plan) or 'not_allowed' (the team's allowlist). */
export function modelOffer(m, allowed) {
  if (m?.plan_locked) return 'plan';
  if (allowed instanceof Set && !allowed.has(m?.id)) return 'not_allowed';
  return 'ok';
}
export const OFFER_WORDS = Object.freeze({ plan: 'Not on your plan', not_allowed: 'Not allowed on this team' });

/** What a model is good at, from the catalogue: "Reasons step by step · reads up to 128k tokens". */
export function strengthsLine(m) {
  const caps = Array.isArray(m?.capabilities) ? m.capabilities : [];
  const parts = [];
  if (caps.includes('Reasoning')) parts.push('Reasons step by step');
  if (caps.includes('Function calling')) parts.push('can use tools');
  if (caps.includes('Vision')) parts.push('also reads images');
  const cw = Number(m?.context_window);
  if (Number.isFinite(cw) && cw > 0) parts.push(`reads up to ${cw >= 1_000_000 ? `${Math.round(cw / 1_048_576 * 10) / 10}M` : `${Math.round(cw / 1000)}k`} tokens`);
  if (!parts.length) return null;
  const s = parts.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A raw token price, as a person pays it: "Input $0.4375 / 1M tokens", or Not recorded, never $0. */
export function tokenRate(label, value) {
  const v = Number(value);
  return value != null && Number.isFinite(v) ? `${label} $${v.toLocaleString('en-US', { maximumFractionDigits: 6 })} / 1M tokens` : `${label} ${NOT_RECORDED}`;
}

const ok = (est) => !!est && est.available === true && Number.isFinite(Number(est.est_usd_per_run));

/**
 * Owner Q3 = A (drawn): "≈ $0.20 per 100 runs" from the estimate's dearest
 * run × 100; "< $0.01 per 100 runs" for a real fraction of a cent; null when
 * there is no estimate (the step then says "Estimate unavailable").
 */
export function per100Line(est) {
  if (!ok(est)) return null;
  const v = Number(est.est_usd_per_run) * 100;
  if (v > 0 && v < 0.005) return '< $0.01 per 100 runs';
  return `≈ $${v.toFixed(2)} per 100 runs`;
}

/** "about 10,100": exact below 1,000, else three significant figures. */
export function aboutRuns(n) {
  if (!Number.isFinite(n) || n < 0) return null;
  const k = Math.floor(n);
  if (k < 1000) return k.toLocaleString('en-US');
  const p = 10 ** (String(k).length - 3);
  return (Math.round(k / p) * p).toLocaleString('en-US');
}

/**
 * How many of the dearest runs the cap pays for, as `estimate` works out
 * `monthly_at_cap` (cap ÷ the dearest run): "A $25 cap pays for about 10,100
 * runs". Null without an estimate or a cap above $0.
 */
export function capRunsLine(est, capMicro) {
  if (!ok(est)) return null;
  const cap = Number(capMicro);
  const dear = Number(est.est_usd_per_run) * 1_000_000;
  if (!Number.isSafeInteger(cap) || cap <= 0 || !(dear > 0)) return null;
  const d = cap / 1e6;
  return `A $${Number.isInteger(d) ? d : d.toFixed(2)} cap pays for about ${aboutRuns(cap / dear)} runs`;
}

/** The estimate's basis, from the Worker's own `basis` (D8769); null when it did not send one. */
export function basisLine(est) {
  const b = est?.basis;
  if (!b || !Number.isFinite(Number(b.request_tokens)) || !Number.isFinite(Number(b.output_tokens))) return null;
  return `One run is estimated as ${est.skills ? 'the agent’s instructions, its largest skill' : 'the agent’s instructions'} and a ${Number(b.request_tokens).toLocaleString('en-US')}-token request in, and a ${Number(b.output_tokens).toLocaleString('en-US')}-token proposal out, at what you pay. A run uses one skill, so this is the dearest run.`;
}

// ── Team coverage (TMM09) ─────────────────────────────────────────────────

/**
 * The coverage card's sentence from `coverageRows`: `{ kind, text, sub }`.
 *   zero        no row has a level or an agent: "No category is mapped yet."
 *   gaps        at least one people gap (today's sentence)
 *   covered     agents mapped and each has a person (today's sentence, only now)
 *   people_only people mapped but no agent on any category
 */
export function coverageSentence(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const gaps = coverageSummary(list);
  if (gaps) return { kind: 'gaps', text: gaps, sub: null };
  const withAgent = list.filter((r) => r.agent);
  const withPeople = list.filter((r) => r.people);
  if (!withAgent.length && !withPeople.length) {
    return { kind: 'zero', text: 'No category is mapped yet.', sub: 'Nobody on this team, person or agent, has a recorded level in any of the eight categories. People get levels from their /studio assessment; agents from their skills.' };
  }
  if (!withAgent.length) return { kind: 'people_only', text: 'No agent covers a category yet.', sub: null };
  return { kind: 'covered', text: 'Every category with an agent on it also has a person on it.', sub: null };
}
