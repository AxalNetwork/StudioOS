/**
 * D4251 (#4251) — HQ › Decks › AI models, the words and rules the tab draws
 * by. Pure, for the Node test. The tab (`AiModelsTab.jsx`) reads and writes
 * `GET/PUT /api/admin/ai/element-models`.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';

export { NOT_RECORDED };

export const AI_MODELS_LINE = 'Switch a model off for everyone, or keep it to a plan. It applies on the next call, with no deploy. Every change asks for a reason and is audited.';
export const PLAN_LABELS = { free: 'Any plan', growth: 'Validate + Build and up', studio: 'Raise + Grow only' };
export const REASON_MIN = 10;
export const NOTE_MAX = 500;
export const reasonOk = (r) => {
  const t = String(r ?? '').trim();
  return t.length >= REASON_MIN && t.length <= 500;
};

/** A model's state as the grid says it: the catalogue's answer, then HQ's policy over it. */
export function stateOf(m) {
  if (m?.policy && m.policy.enabled === false) return { key: 'off', label: 'Off for everyone' };
  if (m?.offered === false) return { key: 'not_offered', label: 'Not offered by the catalogue' };
  const floor = m?.policy?.plan_min;
  if (floor && floor !== 'free') return { key: 'floor', label: PLAN_LABELS[floor] || floor };
  return { key: 'on', label: 'On' };
}

/**
 * The grid: one row per model, one cell per element group with how many of
 * that group's elements the model serves (0 is drawn as a dash, never a 0
 * that reads like a count of runs).
 */
export function modelGrid(reply) {
  const groups = Array.isArray(reply?.groups) ? reply.groups : [];
  const elements = Array.isArray(reply?.elements) ? reply.elements : [];
  const inGroup = Object.fromEntries(groups.map((g) => [g.group, elements.filter((e) => e.group === g.group).map((e) => e.element)]));
  const rows = (Array.isArray(reply?.models) ? reply.models : []).map((m) => {
    const served = new Set(Array.isArray(m.elements) ? m.elements : []);
    return {
      id: m.id, name: m.name || m.id, kind: m.kind || NOT_RECORDED, required: Boolean(m.required), state: stateOf(m),
      cells: groups.map((g) => {
        const of = inGroup[g.group] || [];
        const n = of.filter((id) => served.has(id)).length;
        return { group: g.group, n, of: of.length, names: of.filter((id) => served.has(id)) };
      }),
      by: m.policy?.updated_by?.name || null, at: m.policy?.updated_at || null, note: m.policy?.note || null,
      planMin: m.policy?.plan_min || 'free', enabled: m.policy ? m.policy.enabled !== false : true,
    };
  });
  return { groups, rows };
}

/** The PUT body for a change, or null while it cannot be sent (no reason, or the safety model switched off). */
export function changeBody(row, { enabled, planMin, note, reason }) {
  if (!row || !reasonOk(reason)) return null;
  if (row.required && (enabled === false || (planMin && planMin !== 'free'))) return null;
  const n = String(note ?? '').trim();
  if (n.length > NOTE_MAX) return null;
  return { model_id: row.id, enabled: Boolean(enabled), plan_min: planMin && planMin !== 'free' ? planMin : null, note: n || null, reason: String(reason).trim() };
}
