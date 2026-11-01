/**
 * D1503 (#3754, deck v2 A10) — a model per grid element.
 *
 *   GET /api/decks/:id/element-models
 *       → { deck_id, project_id, billing, plan_rank,
 *           elements: [{ element, group, job, kind, task, plan_min, expected_ms, per_run_microusd,
 *                        suggested: [≤ 3 { id, name, role, line, price, lock, plan_locked }],
 *                        more: [{ id, name, line, price, lock, plan_locked }],
 *                        pick, resolved: { model, name, source, locked, notice } }],
 *           groups: [{ group, elements, lead, suggested, more, pick, resolved }],
 *           free: [{ element, group, line: 'No model · free' }] }
 *   PUT /api/decks/:id/element-models   { scope: 'deck' | 'member', key: <element> | 'group:<group>', model: <id> | null }
 *       → { ok, scope, key, model }   403 role_locked when HQ locked the key
 *
 * `suggested`, `more` and `pick` are #3741's shape (`GET /api/ai/rail`): at
 * most three suggestions, every other model of the element under `more`, and
 * the stored pick that applies (null when the row default runs). `resolved`
 * says which model the next run uses and why (`resolveElementModel`'s
 * level); a stale pick is cleared by the read, and `notice` names the model
 * used instead.
 *
 * A deck pick is the venture's (scope id: the project), so it holds across
 * versions; a member pick is the caller's own. HQ's defaults and locks are
 * written by C1 / B10, never here. Who: the deck routes' `projectOwned`, read
 * for GET and write for PUT. Bound SQL only; no activity row (a model choice
 * is not a venture write, as migration 465's are not).
 *
 * `elementModelFor` is the generation side (dk-auto amendment 10): `POST
 * /api/decks/generate` and the deck's image runs resolve their element's
 * model through it.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { userMeetsTier } from '../middleware/requireTier';
import { getDeckRow } from './decks';
import { unitPrices } from './ai';
import { refuse } from '../util/refusal';
import { aiLicenceKey } from '../services/aiBudget';
import { billingMode, multiplierFor } from '../services/ai/pricing';
import { MODEL_NAMES } from '../services/aiCatalog';
import { isOffered, modelById, type CatalogueSwitches } from '../services/ai/catalogue';
import { MODEL_LOCKS, lockLabel, offerable } from '../services/ai/modelUseCases';
import {
  ELEMENTS, ELEMENT_GROUPS, ELEMENT_ROUTES, FREE_LINE, ORG_HQ, choicesFor, estimateDeck, expected_ms, groupElements, isRouted,
  keyOffers, lockFor, pickKeyOk, planRankOf, resolveElementModel, type PickRow, type Resolved,
} from '../services/decks/elementModels';

const deckElementModels = new Hono<{ Bindings: Env }>();

/** The caller's plan as MODEL_LOCKS ranks it: 2 on Raise + Grow (and every role the plan gate lets through), 1 on Validate + Build, 0 on Free. */
export function planRankFor(user: User): number {
  return userMeetsTier(user, 'studio') ? 2 : userMeetsTier(user, 'growth') ? 1 : 0;
}

type Row = PickRow & { id: number };

/** Every pick row that can apply to this venture's deck and this member: HQ's, the deck's, its areas' and the member's. */
async function pickRows(env: Env, projectId: number, userId: number): Promise<Row[]> {
  const res = await env.DB.prepare(
    `SELECT id, scope, scope_id, key, model, locked, plan_min, set_by FROM deck_model_picks
      WHERE (scope = 'org' AND scope_id = ?1) OR (scope = 'deck' AND scope_id = ?2)
         OR (scope = 'area' AND scope_id LIKE ?3) OR (scope = 'member' AND scope_id = ?4)`,
  ).bind(ORG_HQ, String(projectId), `${projectId}/%`, String(userId)).all<Row>();
  return res.results ?? [];
}

/** Clears the stale rows a read found; HQ's rows are HQ's to change, so they are read as none and kept. */
async function clearStale(env: Env, stale: readonly PickRow[]): Promise<void> {
  const ids = [...new Set(stale.filter((r) => r.scope !== 'org').map((r) => Number((r as Row).id)).filter((n) => Number.isSafeInteger(n) && n > 0))];
  for (const id of ids) await env.DB.prepare('DELETE FROM deck_model_picks WHERE id = ?1').bind(id).run();
  if (ids.length) console.log('[deck_element_models] stale picks cleared', { count: ids.length });
}

/**
 * The generation side: the model `element` runs on for this venture's deck
 * and this member, through the 8 levels, with any stale pick cleared. Throws
 * when the picks cannot be read, so a run never goes ahead on a guess.
 */
export async function elementModelFor(env: Env, user: User, projectId: number, element: string, area?: { card: number; area: string } | null): Promise<Resolved> {
  const rows = await pickRows(env, projectId, Number(user.id) || 0);
  const r = resolveElementModel({
    element, rows, deck: String(projectId), member: String(Number(user.id) || 0), area: area ?? null, planRank: planRankFor(user), env: env as CatalogueSwitches,
  });
  await clearStale(env, r.stale);
  return r;
}

/**
 * The `model` a run passes for its element: the resolved pick when a level
 * above the row default chose it, else undefined, so a venture with no pick
 * runs exactly as before (its rail option's own default and the member's
 * earlier option pick).
 */
export const runModelOf = (r: Resolved): string | undefined => (r.model && r.source !== 'default' && r.source !== 'none' ? r.model : undefined);

async function deckOf(c: any, user: User, write: boolean): Promise<{ deckId: number; projectId: number } | Response> {
  const deckId = Number(c.req.param('id'));
  let row: any;
  try { row = await getDeckRow(c.env, deckId); } catch { return c.json({ error: 'not found' }, 404); }
  const projectId = Number(row.project_id);
  try { await projectOwned(c, user, projectId, { write }); } catch (e: any) {
    return e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403);
  }
  return { deckId, projectId };
}

const nameOf = (id: string | null) => (id ? MODEL_NAMES[id] ?? modelById(id)?.name ?? null : null);

deckElementModels.get('/:id{[0-9]+}/element-models', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckOf(c, user, false);
  if (deck instanceof Response) return deck;
  const userId = Number(user.id) || 0;
  const rows = await pickRows(c.env, deck.projectId, userId);
  const planRank = planRankFor(user);
  const multiplier = multiplierFor(aiLicenceKey(user));
  const priced = (id: string) => ({
    name: nameOf(id), price: unitPrices(id, multiplier), lock: lockLabel(id), plan_locked: planRankOf(MODEL_LOCKS[id] ?? 'all') > planRank,
  });
  const stale: PickRow[] = [];
  const viewOf = (element: string) => {
    const r = resolveElementModel({ element, rows, deck: String(deck.projectId), member: String(userId), planRank, env: c.env as CatalogueSwitches });
    stale.push(...r.stale);
    const ch = choicesFor(element);
    return {
      suggested: ch.suggested.map((m) => ({ id: m.id, role: m.role, line: m.line, ...priced(m.id) })),
      more: ch.more.map((m) => ({ id: m.id, line: m.line, ...priced(m.id) })),
      pick: r.source === 'default' || r.source === 'none' ? null : r.model,
      resolved: { model: r.model, name: nameOf(r.model), source: r.source, locked: r.locked, notice: r.notice ? `A model retired · Using ${nameOf(r.model) ?? 'no model'}` : null },
    };
  };
  const elements = ELEMENTS.filter((e) => isRouted(e.id)).map((e) => {
    const route = ELEMENT_ROUTES[e.id];
    const v = viewOf(e.id);
    const line = v.resolved.model ? estimateDeck({ [e.id]: 1 }, { [e.id]: v.resolved.model }, multiplier).lines[0] : null;
    return {
      element: e.id, group: e.group, job: route.job, kind: route.kind, task: route.task, plan_min: route.plan_min,
      expected_ms: expected_ms(e.id), per_run_microusd: line?.per_microusd ?? null, ...v,
    };
  });
  const groups = ELEMENT_GROUPS.map((group) => {
    const ids = groupElements(group);
    return ids.length ? { group, elements: ids, lead: ids[0], ...viewOf(ids[0]) } : { group, elements: [], lead: null, suggested: [], more: [], pick: null, resolved: null, free: FREE_LINE };
  });
  await clearStale(c.env, stale);
  return c.json({
    deck_id: deck.deckId, project_id: deck.projectId, billing: billingMode(c.env), plan_rank: planRank,
    elements, groups,
    free: ELEMENTS.filter((e) => !isRouted(e.id)).map((e) => ({ element: e.id, group: e.group, line: FREE_LINE })),
  });
});

deckElementModels.put('/:id{[0-9]+}/element-models', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckOf(c, user, true);
  if (deck instanceof Response) return deck;
  const body = await c.req.json().catch(() => ({} as any));
  const scope = body?.scope;
  if (scope !== 'deck' && scope !== 'member') return refuse(c, 400, { code: 'invalid_scope', message: 'A pick is for the deck or for you: scope is "deck" or "member".' });
  const key = body?.key;
  if (!pickKeyOk(key)) return refuse(c, 400, { code: 'invalid_key', message: 'The key is an element that runs a model, or "group:" and its group.' });
  const userId = Number(user.id) || 0;
  const rows = await pickRows(c.env, deck.projectId, userId);
  if (lockFor(rows, key)) return refuse(c, 403, { code: 'role_locked', message: 'Set by Axal VC HQ. This model cannot be changed here.' });
  const scopeId = scope === 'deck' ? String(deck.projectId) : String(userId);
  const model = body?.model;
  if (model === null) {
    await c.env.DB.prepare('DELETE FROM deck_model_picks WHERE scope = ?1 AND scope_id = ?2 AND key = ?3').bind(scope, scopeId, key).run();
    return c.json({ ok: true, scope, key, model: null });
  }
  const m = typeof model === 'string' ? modelById(model) : null;
  if (!m || !isOffered(m, c.env as CatalogueSwitches) || !offerable(model) || !keyOffers(key, model)) {
    return refuse(c, 400, { code: 'model_not_offered', message: 'That model is not offered for this element.' });
  }
  const plan = MODEL_LOCKS[model] ?? 'all';
  if (planRankOf(plan) > planRankFor(user)) {
    return refuse(c, 403, { code: 'plan_locked', message: `That model is on ${lockLabel(model) ?? 'another plan'}.`, extra: { plan: lockLabel(model) } });
  }
  await c.env.DB.prepare(
    `INSERT INTO deck_model_picks (scope, scope_id, key, model, locked, plan_min, set_by, updated_at)
     VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, datetime('now'))
     ON CONFLICT (scope, scope_id, key) DO UPDATE SET model = excluded.model, plan_min = excluded.plan_min, set_by = excluded.set_by, updated_at = excluded.updated_at`,
  ).bind(scope, scopeId, key, model, plan, userId || null).run();
  return c.json({ ok: true, scope, key, model });
});

export default deckElementModels;
