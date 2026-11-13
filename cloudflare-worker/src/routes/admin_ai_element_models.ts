/**
 * D4251 (#4251, deck v2 B10a) — HQ › AI models: the elements × models grid
 * and the kill switch, without a deploy.
 *
 *   GET /api/admin/ai/element-models
 *       → { groups: [{ group, label }],
 *           elements: [{ element, group }],
 *           models: [{ id, name, kind, status, offered, required, elements: [element ids it serves],
 *                      policy: { enabled, plan_min, note, updated_by: { uid, name } | null, updated_at } | null }],
 *           plan_mins }
 *   PUT /api/admin/ai/element-models   { model_id, enabled, plan_min?, note?, reason }
 *       → { ok, model_id, policy }
 *
 * The grid's rows are the catalogue models any grid element offers
 * (`elementModels.choicesFor`), and any model with a policy row; its columns
 * the elements, by group. `offered` is the catalogue's own answer before the
 * policy (status, price, partner gate); the policy then decides (D4251,
 * `services/ai/modelPolicy.ts`). A write takes effect on the next call: the
 * run path and every reply read the policy each time.
 *
 * WHO. HQ only, which is a Super Admin on HQ's deployment
 * (`requireSuperAdmin`; a branch is refused 403). Every write is one admin
 * audit row (`ai_model_policy_set`) with the reason and the policy before and
 * after. A model id the catalogue does not hold is refused 400
 * `unknown_model`; the safety model cannot be switched off (409
 * `model_required`). Names, never an email.
 *
 * Mounts itself (#4105) at `/api/admin/ai/element-models`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { logAdminAction } from '../services/adminAudit';
import { isOffered, modelById, type CatalogueSwitches } from '../services/ai/catalogue';
import { ELEMENTS, ELEMENT_GROUPS, GROUP_LABELS, choicesFor } from '../services/decks/elementModels';
import { PLAN_MINS, REQUIRED_MODELS, loadPolicy, policyProblem, type PolicyRow } from '../services/ai/modelPolicy';

const r = new Hono<{ Bindings: Env }>();

/** Each element's models, from the one element catalogue. */
export function servedBy(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of ELEMENTS) {
    const c = choicesFor(e.id);
    for (const id of new Set([...c.suggested, ...c.more].map((m) => m.id))) {
      if (!out.has(id)) out.set(id, []);
      out.get(id)!.push(e.id);
    }
  }
  return out;
}

async function namesOf(env: Env, ids: number[]): Promise<Map<number, { uid: string; name: string }>> {
  const names = new Map<number, { uid: string; name: string }>();
  if (!ids.length) return names;
  try {
    const people = (await env.DB.prepare('SELECT id, uid, name FROM users WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids))
      .all<{ id: number; uid: string; name: string | null }>()).results ?? [];
    for (const u of people) names.set(Number(u.id), { uid: u.uid, name: u.name || 'A former admin' });
  } catch { /* unread: updated_by reads null, never an id */ }
  return names;
}

const policyView = (p: PolicyRow, names: Map<number, { uid: string; name: string }>) => ({
  enabled: Boolean(Number(p.enabled)), plan_min: p.plan_min ?? null, note: p.note ?? null,
  updated_by: p.updated_by ? names.get(Number(p.updated_by)) ?? null : null, updated_at: p.updated_at,
});

r.get('/', async (c) => {
  await requireSuperAdmin(c);
  let rows: PolicyRow[];
  try {
    rows = (await c.env.DB.prepare('SELECT model_id, enabled, plan_min, note, updated_by, updated_at FROM ai_model_policy ORDER BY model_id').all<PolicyRow>()).results ?? [];
  } catch {
    return refuse(c, 503, { code: 'policy_unreadable', message: 'The model policy could not be read. Every model is as the catalogue offers it until it can.' });
  }
  const byModel = new Map(rows.map((p) => [p.model_id, p]));
  const names = await namesOf(c.env, [...new Set(rows.map((p) => Number(p.updated_by)).filter((n) => Number.isSafeInteger(n) && n > 0))]);
  const served = servedBy();
  const ids = [...new Set([...served.keys(), ...byModel.keys()])].filter((id) => modelById(id)).sort();
  // The catalogue's answer before any policy or flag: what HQ would be switching.
  const bare = { AI_PARTNER_MODELS: (c.env as any).AI_PARTNER_MODELS, AI_PAID_MODELS: (c.env as any).AI_PAID_MODELS } as CatalogueSwitches;
  const models = ids.map((id) => {
    const m = modelById(id)!;
    const p = byModel.get(id);
    return {
      id, name: m.name, kind: m.kind, status: m.status, offered: isOffered(m, bare), required: REQUIRED_MODELS.has(id),
      elements: served.get(id) ?? [], policy: p ? policyView(p, names) : null,
    };
  });
  return c.json({
    groups: ELEMENT_GROUPS.map((g) => ({ group: g, label: GROUP_LABELS[g] ?? g })),
    elements: ELEMENTS.map((e) => ({ element: e.id, group: e.group })),
    models, plan_mins: PLAN_MINS,
  });
});

r.put('/', async (c) => {
  const admin = await requireSuperAdmin(c);
  const body = await c.req.json().catch(() => ({} as any));
  const bad = policyProblem(body);
  if (bad) return refuse(c, bad.status, { code: bad.code, message: bad.message });
  const id = String(body.model_id);
  const before = (await loadPolicy(c.env)).find((p) => p.model_id === id) ?? null;
  const planMin = body.plan_min ?? null;
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
  await c.env.DB.prepare(
    `INSERT INTO ai_model_policy (model_id, enabled, plan_min, note, updated_by, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
     ON CONFLICT (model_id) DO UPDATE SET enabled = excluded.enabled, plan_min = excluded.plan_min, note = excluded.note,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(id, body.enabled ? 1 : 0, planMin, note, Number(admin.id) || null).run();
  const after = { enabled: Boolean(body.enabled), plan_min: planMin, note };
  // One audit row per write: who (by id; the governance feed names them), why, before and after.
  await logAdminAction(c.env, Number(admin.id), String((admin as any).email ?? ''), 'ai_model_policy_set', {
    model_id: id, reason: String(body.reason).trim(),
    before: before ? { enabled: Boolean(Number(before.enabled)), plan_min: before.plan_min ?? null, note: before.note ?? null } : null,
    after,
  });
  console.log('[ai_model_policy] written', { enabled: after.enabled, plan_min: planMin });
  const written = (await loadPolicy(c.env)).find((p) => p.model_id === id);
  const names = await namesOf(c.env, written?.updated_by ? [Number(written.updated_by)] : []);
  return c.json({ ok: true, model_id: id, policy: written ? policyView(written, names) : null });
});

export default r;

/** #4105: mounts itself; nothing else answers under this path. */
export const mount: RouteMount = { path: '/api/admin/ai/element-models', router: r };
