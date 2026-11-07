/**
 * #4739 (D4162, H4 of #4137; D3851) — the Policies tab's controls as pure
 * rules: dollars to micro-dollars and back, the four caps as the Worker's
 * body, the models per area, the read-tool list, and the engine halt. The
 * words for each refusal are in `refusals.js`. `PolicyControls.jsx` draws
 * these and calls `adminAiAgentsApi` and `agentEngineApi`.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';
import { REASON_MIN, REASON_MAX } from './refusals.js';

export const reasonFits = (r) => {
  const n = String(r ?? '').replace(/\s+/g, ' ').trim().length;
  return n >= REASON_MIN && n <= REASON_MAX;
};

/** The halt's reason is at most 64 characters (`routes/admin_agents.ts`). */
export const HALT_REASON_MAX = 64;
export const haltReasonFits = (r) => {
  const n = String(r ?? '').trim().length;
  return n >= REASON_MIN && n <= HALT_REASON_MAX;
};

export const CAP_KEYS = Object.freeze([
  { key: 'platform_budget', label: 'Platform monthly budget' },
  { key: 'default_team_cap', label: 'Default team cap' },
  { key: 'max_team_cap', label: 'Maximum team cap' },
  { key: 'per_run_ceiling', label: 'Per-run ceiling' },
]);

/** Micro-dollars as the dollars an input shows. Null is blank, never 0. */
export const microToUsd = (m) => (Number.isSafeInteger(m) && m > 0 ? String(m / 1e6) : '');

/** An input's dollars as micro-dollars: blank clears the cap (null); anything else is a whole number above zero or a problem. */
export function usdToMicro(text) {
  const t = String(text ?? '').trim().replace(/^\$/, '');
  if (t === '') return { ok: true, value: null };
  if (!/^\d+(\.\d{1,6})?$/.test(t)) return { ok: false };
  const micro = Math.round(Number(t) * 1e6);
  return Number.isSafeInteger(micro) && micro > 0 ? { ok: true, value: micro } : { ok: false };
}

/** The four cap inputs from the policy, as text. */
export const capsForm = (policy) => Object.fromEntries(CAP_KEYS.map(({ key }) => [key, microToUsd(policy?.[`${key}_microusd`])]));

/** The body of `PUT …/caps` from the inputs, or the first input that is not a dollar amount. */
export function capsPayload(form, reason) {
  const out = {};
  for (const { key, label } of CAP_KEYS) {
    const m = usdToMicro(form?.[key]);
    if (!m.ok) return { ok: false, field: key, problem: `${label} is a dollar amount above zero, or blank to clear it.` };
    out[`${key}_microusd`] = m.value;
  }
  if (out.default_team_cap_microusd != null && out.max_team_cap_microusd != null && out.default_team_cap_microusd > out.max_team_cap_microusd) {
    return { ok: false, field: 'default_team_cap', problem: 'The default team cap cannot be above the maximum team cap.' };
  }
  if (!reasonFits(reason)) return { ok: false, problem: `Say why, in ${REASON_MIN} to ${REASON_MAX} characters.` };
  return { ok: true, caps: out, reason: String(reason).trim() };
}

/** Whether a cap input differs from what the policy holds. */
export const capsChanged = (form, policy) => CAP_KEYS.some(({ key }) => String(form?.[key] ?? '').trim().replace(/^\$/, '') !== microToUsd(policy?.[`${key}_microusd`]));

// ─── Models per area ────────────────────────────────────────────────────────

export const SUGGESTED_MAX = 3;

/** An area's models as the picker holds them: up to three suggestions in order, and one default. */
export const areaForm = (areaModels, slug) => {
  const a = areaModels?.[slug];
  return { suggested: Array.isArray(a?.suggested) ? [...a.suggested] : [], default: a?.default ?? '' };
};

/** The body's `areas` after one area's picker changed: the others stay as the policy has them. */
export function areasPayload(areaModels, slug, form) {
  const suggested = [...new Set(form.suggested.filter(Boolean))];
  if (suggested.length < 1 || suggested.length > SUGGESTED_MAX) return { ok: false, problem: `Each area suggests 1 to ${SUGGESTED_MAX} different models, in order.` };
  if (!suggested.includes(form.default)) return { ok: false, problem: 'The default model is one of the area’s suggestions.' };
  return { ok: true, areas: { ...(areaModels ?? {}), [slug]: { suggested, default: form.default } } };
}

/** The models the picker offers: the catalogue, minus those locked off, but always the ones already chosen so they can be seen. */
export function modelOptions(models, locks, chosen = []) {
  const locked = new Set((locks ?? []).map((l) => l.model));
  const known = Array.isArray(models) ? models : [];
  const byId = new Map(known.map((m) => [m.id, m]));
  const ids = new Set([...known.filter((m) => !locked.has(m.id)).map((m) => m.id), ...chosen.filter(Boolean)]);
  return [...ids].map((id) => ({ id, label: byId.get(id)?.label ?? id, locked: locked.has(id) }));
}

// ─── Read tools ─────────────────────────────────────────────────────────────

const TOOL = /^[a-z0-9_]+\.[a-z0-9_]+$/;
export const READ_TOOLS_MAX = 50;

/** A tool name as typed, or null when it is not `connector.tool`. */
export const toolName = (text) => {
  const t = String(text ?? '').trim().toLowerCase();
  return TOOL.test(t) ? t : null;
};

/** The list after one is ticked off or added. */
export const withoutTool = (tools, name) => tools.filter((t) => t !== name);
export function withTool(tools, text) {
  const name = toolName(text);
  if (!name) return { ok: false, problem: 'Name a connector tool such as hubspot.read_contacts.' };
  if (tools.includes(name)) return { ok: false, problem: 'That tool is already on the list.' };
  if (tools.length >= READ_TOOLS_MAX) return { ok: false, problem: `The list holds up to ${READ_TOOLS_MAX} tools.` };
  return { ok: true, tools: [...tools, name] };
}

// ─── The engine halt ────────────────────────────────────────────────────────

/** The engine halt (`GET /api/admin/agents/halt`) as the line a person reads. Unknown is "Not recorded", never "not halted". */
export function haltLine(h) {
  if (!h || typeof h.halted !== 'boolean') return NOT_RECORDED;
  if (!h.halted) return 'Agents may run.';
  const by = h.by?.name ? ` by ${h.by.name}` : '';
  const at = h.at ? ` on ${String(h.at).slice(0, 10)}` : '';
  return `Every agent is halted${by}${at}${h.reason ? `: ${h.reason}` : ''}.`;
}
