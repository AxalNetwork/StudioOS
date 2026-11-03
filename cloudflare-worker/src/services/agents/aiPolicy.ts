/**
 * D4162 (#4162, H4 of #4137) — the platform's AI policy for agents: the
 * models per area and the models locked off, the caps and the per-run
 * ceiling, the read-only tools skills may request, the guardrails, and the
 * kill switch. One row, `ai_agent_policy` id 1 (migrations 202611022046 and
 * 202611022114), plus `ai_model_locks`.
 *
 * Where each rule bites:
 *   - the kill switch: `engine.ts` `engineRefusal`, which every admission
 *     path on both runtimes (`do` and `sdk`, a person's start, the sweep,
 *     `after`, a duty) reaches through `admitInScope`, and `agentRun`, the
 *     only way an agent runs. 403 `platform_paused`. Open proposals stay
 *     decidable: deciding one admits no run here.
 *   - a locked model: `agentRun` swaps it for the agent's area default when
 *     that one is not locked, else refuses 403 `model_locked`.
 *   - the per-run ceiling: `agentRun` quotes first and refuses 402
 *     `run_ceiling` before anything is held or charged.
 *   - the maximum team cap: `routes/team_agents.ts` refuses a cap above it.
 *
 * A policy that cannot be read admits no run: a kill switch must never be
 * missed (the same rule as `agents:halt`). A schema without the policy
 * table (a database before these migrations) reads as no policy.
 */
import type { Env } from '../../types';
import { RADAR_AXES } from '../skillsTaxonomySchema';
import { modelById } from '../ai/catalogue';

export const AREAS = RADAR_AXES.map((a) => a.slug) as readonly string[];
export const SUGGESTED_MAX = 3;
export const REASON_MAX = 500;
export const READ_TOOLS_MAX = 50;
export const PAUSE_WORD = 'PAUSE';
export const PLATFORM_PAUSED_MESSAGE = 'Axal has paused all AI agents on the platform. Open proposals can still be decided.';

export type AreaModels = Record<string, { suggested: string[]; default: string }>;
export type Policy = {
  platform_budget_microusd: number | null;
  default_team_cap_microusd: number | null;
  max_team_cap_microusd: number | null;
  per_run_ceiling_microusd: number | null;
  area_models: AreaModels;
  read_tools: string[];
  locks: Array<{ model: string; reason: string; locked_at: string; locked_by: { id: number; name: string | null } }>;
  paused: { on: false } | { on: true; since: string; by: { id: number; name: string | null }; reason: string };
};

const parse = <T>(s: unknown, d: T): T => { if (typeof s !== 'string') return d; try { return JSON.parse(s) as T; } catch { return d; } };
const missingTable = (e: unknown) => /no such table|no such column/i.test(String((e as Error)?.message ?? e));

/** The policy, or `null` when it cannot be read. A database before these migrations reads as the empty policy. */
export async function readPolicy(env: Env): Promise<Policy | null> {
  try {
    const r = await env.DB.prepare(
      `SELECT p.*, u.name AS paused_by_name FROM ai_agent_policy p LEFT JOIN users u ON u.id = p.paused_by WHERE p.id = 1`,
    ).first<any>();
    const locks = await env.DB.prepare(
      'SELECT l.model, l.reason, l.locked_at, l.locked_by, u.name AS locked_by_name FROM ai_model_locks l LEFT JOIN users u ON u.id = l.locked_by ORDER BY l.locked_at, l.model',
    ).all<any>();
    return {
      platform_budget_microusd: r?.platform_budget_microusd ?? null,
      default_team_cap_microusd: r?.default_team_cap_microusd ?? null,
      max_team_cap_microusd: r?.max_team_cap_microusd ?? null,
      per_run_ceiling_microusd: r?.per_run_ceiling_microusd ?? null,
      area_models: parse<AreaModels>(r?.area_models_json, {}),
      read_tools: parse<string[]>(r?.read_tools_json, []),
      locks: (locks.results ?? []).map((l) => ({ model: l.model, reason: l.reason, locked_at: l.locked_at, locked_by: { id: Number(l.locked_by), name: l.locked_by_name ?? null } })),
      paused: Number(r?.paused) === 1
        ? { on: true, since: String(r.paused_at), by: { id: Number(r.paused_by), name: r.paused_by_name ?? null }, reason: String(r.paused_reason ?? '') }
        : { on: false },
    };
  } catch (e) {
    if (missingTable(e)) return emptyPolicy();
    return null;
  }
}

export const emptyPolicy = (): Policy => ({
  platform_budget_microusd: null, default_team_cap_microusd: null, max_team_cap_microusd: null, per_run_ceiling_microusd: null,
  area_models: {}, read_tools: [], locks: [], paused: { on: false },
});

/** The kill switch as the runtime reads it: on, off, or unreadable (which counts as on). */
export async function platformPaused(env: Env): Promise<boolean> {
  try {
    const r = await env.DB.prepare('SELECT paused FROM ai_agent_policy WHERE id = 1').first<{ paused: number }>();
    return Number(r?.paused ?? 0) === 1;
  } catch (e) {
    return !missingTable(e);
  }
}

/** What the team banner reads: `{ paused, since, by_name }`, the admin by name, never by email. */
export async function platformStatus(env: Env): Promise<{ paused: boolean; since: string | null; by_name: string | null }> {
  const p = await readPolicy(env);
  if (!p) return { paused: true, since: null, by_name: null };
  return p.paused.on ? { paused: true, since: p.paused.since, by_name: p.paused.by.name } : { paused: false, since: null, by_name: null };
}

// ── Validation ──────────────────────────────────────────────────────────────

export type Problem = { code: string; message: string; status?: number };

export function reasonProblem(reason: unknown): Problem | null {
  if (typeof reason !== 'string' || !reason.trim()) return { code: 'reason_required', message: 'Every change to the AI policy needs a reason.' };
  if (reason.trim().length > REASON_MAX) return { code: 'reason_too_long', message: `Keep the reason under ${REASON_MAX} characters.` };
  return null;
}

const knownModel = (m: unknown): m is string => typeof m === 'string' && !!modelById(m);

/** The area models a body names, checked: known areas, at most 3 known models each, a default among them. */
export function areaModelsOf(v: unknown): { ok: true; value: AreaModels } | { ok: false; problem: Problem } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, problem: { code: 'invalid_models', message: 'Name the models per area.' } };
  const out: AreaModels = {};
  for (const [area, raw] of Object.entries(v as Record<string, any>)) {
    if (!AREAS.includes(area)) return { ok: false, problem: { code: 'invalid_area', message: `${area} is not one of the 8 areas.` } };
    const suggested = Array.isArray(raw?.suggested) ? raw.suggested : null;
    if (!suggested || suggested.length < 1 || suggested.length > SUGGESTED_MAX || new Set(suggested).size !== suggested.length || !suggested.every(knownModel)) {
      return { ok: false, problem: { code: 'invalid_models', message: `Each area suggests 1 to ${SUGGESTED_MAX} different models from the catalogue, in order.` } };
    }
    const def = raw?.default ?? suggested[0];
    if (!suggested.includes(def)) return { ok: false, problem: { code: 'invalid_default', message: 'The default model is one of the area\'s suggestions.' } };
    out[area] = { suggested, default: def };
  }
  return { ok: true, value: out };
}

export type Caps = Pick<Policy, 'platform_budget_microusd' | 'default_team_cap_microusd' | 'max_team_cap_microusd' | 'per_run_ceiling_microusd'>;
const CAP_KEYS = ['platform_budget_microusd', 'default_team_cap_microusd', 'max_team_cap_microusd', 'per_run_ceiling_microusd'] as const;

/** The caps a body sets: each a whole number of micro-dollars above 0, or null to clear it; the default never above the maximum. */
export function capsOf(body: any, current: Caps): { ok: true; value: Caps } | { ok: false; problem: Problem } {
  const next: Caps = { ...current };
  for (const k of CAP_KEYS) {
    if (!(k in (body ?? {}))) continue;
    const v = body[k];
    if (v !== null && !(Number.isSafeInteger(v) && v > 0)) return { ok: false, problem: { code: 'invalid_cap', message: 'A cap is a whole number of micro-dollars above zero, or null to clear it.' } };
    next[k] = v;
  }
  if (next.default_team_cap_microusd != null && next.max_team_cap_microusd != null && next.default_team_cap_microusd > next.max_team_cap_microusd) {
    return { ok: false, problem: { code: 'default_over_max', message: 'The default team cap cannot be above the maximum team cap.' } };
  }
  return { ok: true, value: next };
}

const TOOL = /^[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,63}$/;
/** A read tool's verb. Anything else (create, update, send, delete, post, …) is a write and is never allowed. */
const READ_VERB = /^(read|list|get|search|find|fetch|lookup|count|view|describe|query)(_|$)/;
export const isReadTool = (t: string) => TOOL.test(t) && READ_VERB.test(t.split('.')[1]);

export function readToolsOf(v: unknown): { ok: true; value: string[] } | { ok: false; problem: Problem } {
  if (!Array.isArray(v) || v.length > READ_TOOLS_MAX || v.some((t) => typeof t !== 'string' || !TOOL.test(t))) {
    return { ok: false, problem: { code: 'invalid_tools', message: `List up to ${READ_TOOLS_MAX} connector tools by name, such as hubspot.read_contacts.` } };
  }
  const write = (v as string[]).filter((t) => !isReadTool(t));
  if (write.length) {
    return { ok: false, problem: { code: 'write_tool', status: 422, message: `Skills may only request read tools. ${write.join(', ')} ${write.length === 1 ? 'is' : 'are'} not a read.` } };
  }
  return { ok: true, value: [...new Set(v as string[])].sort() };
}

// ── At run time ─────────────────────────────────────────────────────────────

/** The model an agent's run uses under the policy: its own, or its area's default when its own is locked; null when both are locked. */
export function modelUnder(p: Policy, model: string, area: string | null): { model: string; swapped: boolean } | null {
  const locked = new Set(p.locks.map((l) => l.model));
  if (!locked.has(model)) return { model, swapped: false };
  const def = area ? p.area_models[area]?.default : undefined;
  if (def && !locked.has(def)) return { model: def, swapped: true };
  return null;
}

/** The highest monthly cap a team agent may be given, or null when none is set. Unreadable is no new cap: refused by the caller. */
export async function maxTeamCap(env: Env): Promise<{ ok: true; max: number | null } | { ok: false }> {
  const p = await readPolicy(env);
  return p ? { ok: true, max: p.max_team_cap_microusd } : { ok: false };
}

// ── Guardrails ──────────────────────────────────────────────────────────────

/**
 * The three platform guardrails, each with the check that enforces it. None of
 * those checks writes a row a count could be read from (they refuse in the
 * moment, or fail the build), so each count is null: "Not recorded", never 0.
 * A check that starts recording adds its query here.
 */
export const GUARDRAILS = [
  { key: 'no_advice_wording', rule: 'Never advisor or advice on AI surfaces', check: 'scripts/check-regulated-wording.mjs (the build) and the rail\'s regulated-wording refusals', area: null },
  { key: 'legal_capital_explain', rule: 'Legal and Capital explain or draft, never decide', check: 'agents propose and a named person accepts (D1496); Legal and Capital skills output drafts or briefs (D1612)', area: null },
  { key: 'no_invented_figures', rule: 'No invented figures', check: 'figure_in_prompt / figure_in_output refusals on the deck assists (D1523) and the record-sourced figures', area: null },
] as const;

export async function guardrailCounts(_env: Env): Promise<Array<{ key: string; rule: string; check: string; violations_30d: number | null; recorded: boolean }>> {
  return GUARDRAILS.map((g) => ({ key: g.key, rule: g.rule, check: g.check, violations_30d: null, recorded: false }));
}
