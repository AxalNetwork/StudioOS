/**
 * D1549 (#3796, deck v2 C1) — the deck's preset, and HQ's org default and
 * lock, on `deck_model_picks` (migration 717). Migration: none.
 *
 * The deck (mounted at `/api/decks`, beside `deck_element_models.ts`):
 *
 *   GET /api/decks/:id/model-presets
 *       → { deck_id, project_id, preset, stored, options: [{ id, label }],
 *           groups: [{ group, label, lead, presets: [{ preset, model, name, plan_locked }],
 *                      resolved: { model, name, source, locked }, lock }],
 *           locks: [{ group, label, model, name, line }] }
 *   PUT /api/decks/:id/model-presets   { preset: 'fast' | 'balanced' | 'best' | 'custom' }
 *       → the GET's answer, read again after the write
 *
 * `preset` is the one in force: the stored preset (Fast, Balanced or Best)
 * when the deck holds no pick of its own, Custom when it does, and Balanced
 * when it holds neither, since Balanced is each job's Default. A preset maps
 * to a model per element group through its elements' own job rows
 * (`presetModelFor`), so no model is named here. Fast, Balanced or Best
 * clears the deck's own picks (its areas' are kept) so the preset decides;
 * Custom clears the stored preset and leaves the picks. Who: the deck
 * routes' `projectOwned`, read for GET and write for PUT. No activity row: a
 * model choice is not a venture write (as `deck_element_models.ts`).
 *
 * `locks` is each element group HQ locked, with aird5's line "Set by Axal VC
 * HQ"; `deckV2Adapter.orgLocks` reads it, and the AIRail draws it on the group.
 *
 * HQ (mounted at `/api/admin/ai/deck-models`), the aird6b table:
 *
 *   GET /api/admin/ai/deck-models
 *       → { groups: [{ group, label, lead, choices: [{ id, name, lock }], catalogue_default: { id, name },
 *                      org: null | { model, name, locked, updated_at } }] }
 *   PUT /api/admin/ai/deck-models   { group, model: <id> | null, locked: boolean }
 *       → { ok, group, model, locked }
 *
 * A Super Admin's, with a recent step-up, as HQ › AI usage (the page it is
 * drawn on). A row is HQ's default for the group; `locked` makes it HQ's lock,
 * which wins over every other level (`resolveElementModel`). A null model
 * clears the row, so the catalogue's Default decides again. The model must be
 * one the group offers (`keyOffers`), offered now and allowed by policy. Each
 * write is audited through `logAdminAction` with the group, the model and the
 * lock, never a name or an email.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, requireStepUp, requireSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';
import { isOffered, modelById, type CatalogueSwitches } from '../services/ai/catalogue';
import { MODEL_LOCKS, lockLabel, offerable } from '../services/ai/modelUseCases';
import {
  ELEMENT_GROUPS, GROUP_LABELS, ORG_HQ, PRESETS, PRESET_KEY, PRESET_LABELS, choicesFor, groupElements, groupKey, isPreset,
  keyOffers, lockFor, planRankOf, presetModelFor, resolveElementModel, type Preset,
} from '../services/decks/elementModels';
import { clearStale, deckOf, nameOf, pickRows, planRankFor, type Row } from './deck_element_models';

/** aird5's line on a group HQ locked. */
export const LOCK_LINE = 'Set by Axal VC HQ';

/** The element groups a model runs in, in the picker's order: each with its lead element. */
const routedGroups = () => ELEMENT_GROUPS.map((group) => ({ group, ids: groupElements(group) })).filter((g) => g.ids.length > 0);

// ---------------------------------------------------------------------------
// The deck's preset
// ---------------------------------------------------------------------------

export const deckModelPresets = new Hono<{ Bindings: Env }>();

/** The answer for one venture's deck and one member, from the pick rows. Exported for the contract test. */
export function presetView(rows: readonly Row[], deck: { deckId: number; projectId: number }, user: User, env: CatalogueSwitches) {
  const project = String(deck.projectId);
  const member = String(Number(user.id) || 0);
  const planRank = planRankFor(user);
  const presetRow = rows.find((r) => r.scope === 'deck' && r.scope_id === project && r.key === PRESET_KEY) ?? null;
  const stored: Preset | null = presetRow && isPreset(presetRow.model) ? presetRow.model : null;
  // The deck's own picks, outside a group HQ locked (a lock reads none of them).
  const own = rows.some((r) => r.scope === 'deck' && r.scope_id === project && r.key !== PRESET_KEY && !lockFor(rows, r.key));
  const preset: Preset | 'custom' = own ? 'custom' : stored ?? 'balanced';
  const stale: Row[] = [];
  const groups = routedGroups().map(({ group, ids }) => {
    const lead = ids[0];
    const r = resolveElementModel({ element: lead, rows, deck: project, member, planRank, env });
    stale.push(...(r.stale as Row[]));
    const lockRow = lockFor(rows, groupKey(group));
    return {
      group, label: GROUP_LABELS[group] ?? group, lead,
      presets: PRESETS.map((p) => {
        const model = presetModelFor(lead, p);
        return { preset: p, model, name: nameOf(model), plan_locked: model ? planRankOf(MODEL_LOCKS[model] ?? 'all') > planRank : false };
      }),
      resolved: { model: r.model, name: nameOf(r.model), source: r.source, locked: r.locked },
      lock: lockRow ? { model: lockRow.model, name: nameOf(lockRow.model), line: LOCK_LINE } : null,
    };
  });
  return {
    view: {
      deck_id: deck.deckId, project_id: deck.projectId, preset, stored,
      options: [...PRESETS, 'custom' as const].map((id) => ({ id, label: PRESET_LABELS[id] })),
      groups: groups.map(({ group, label, lead, presets, resolved, lock }) => ({ group, label, lead, presets, resolved, lock })),
      locks: groups.filter((g) => g.lock).map((g) => ({ group: g.group, label: g.label, model: g.lock!.model, name: g.lock!.name, line: LOCK_LINE })),
    },
    stale,
  };
}

async function readView(c: any, user: User, deck: { deckId: number; projectId: number }) {
  const rows = await pickRows(c.env, deck.projectId, Number(user.id) || 0);
  const { view, stale } = presetView(rows, deck, user, c.env as CatalogueSwitches);
  await clearStale(c.env, stale);
  return view;
}

deckModelPresets.get('/:id{[0-9]+}/model-presets', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckOf(c, user, false);
  if (deck instanceof Response) return deck;
  return c.json(await readView(c, user, deck));
});

deckModelPresets.put('/:id{[0-9]+}/model-presets', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckOf(c, user, true);
  if (deck instanceof Response) return deck;
  const body = await c.req.json().catch(() => ({} as any));
  const preset = body?.preset;
  if (preset !== 'custom' && !isPreset(preset)) {
    return refuse(c, 400, { code: 'invalid_preset', message: 'A preset is "fast", "balanced", "best" or "custom".' });
  }
  const project = String(deck.projectId);
  if (preset === 'custom') {
    await c.env.DB.prepare('DELETE FROM deck_model_picks WHERE scope = ?1 AND scope_id = ?2 AND key = ?3').bind('deck', project, PRESET_KEY).run();
  } else {
    // The preset decides: the deck's own picks go, and the preset is stored, in one batch.
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM deck_model_picks WHERE scope = ?1 AND scope_id = ?2').bind('deck', project),
      c.env.DB.prepare(
        `INSERT INTO deck_model_picks (scope, scope_id, key, model, locked, plan_min, set_by, updated_at)
         VALUES (?1, ?2, ?3, ?4, 0, NULL, ?5, datetime('now'))`,
      ).bind('deck', project, PRESET_KEY, preset, Number(user.id) || null),
    ]);
  }
  return c.json(await readView(c, user, deck));
});

// ---------------------------------------------------------------------------
// HQ's org default and lock (aird6b)
// ---------------------------------------------------------------------------

export const adminDeckModels = new Hono<{ Bindings: Env }>();

/** The step-up, then the elevation, as HQ › AI usage checks them. */
async function gate(c: any): Promise<User> {
  await requireStepUp(c);
  return requireSuperAdmin(c);
}

adminDeckModels.get('/', async (c) => {
  await gate(c);
  let rows: Row[];
  try {
    const res = await c.env.DB.prepare(
      'SELECT id, scope, scope_id, key, model, locked, plan_min, set_by, updated_at FROM deck_model_picks WHERE scope = ?1 AND scope_id = ?2',
    ).bind('org', ORG_HQ).all<Row & { updated_at: string }>();
    rows = res.results ?? [];
  } catch (error) {
    return refuse(c, 503, { code: 'deck_models_unreadable', message: 'Unreadable: HQ\'s deck models could not be read.', raw: error });
  }
  return c.json({
    groups: routedGroups().map(({ group, ids }) => {
      const lead = ids[0];
      const ch = choicesFor(lead);
      const row = rows.find((r) => r.key === groupKey(group)) as (Row & { updated_at?: string }) | undefined;
      const first = ch.suggested[0]?.id ?? null;
      return {
        group, label: GROUP_LABELS[group] ?? group, lead,
        choices: [...ch.suggested, ...ch.more].map((m) => ({ id: m.id, name: nameOf(m.id), lock: lockLabel(m.id) })),
        catalogue_default: { id: first, name: nameOf(first) },
        org: row ? { model: row.model, name: nameOf(row.model), locked: Boolean(Number(row.locked)), updated_at: row.updated_at ?? null } : null,
      };
    }),
  });
});

adminDeckModels.put('/', async (c) => {
  const user = await gate(c);
  const body = await c.req.json().catch(() => ({} as any));
  const group = body?.group;
  if (typeof group !== 'string' || !routedGroups().some((g) => g.group === group)) {
    return refuse(c, 400, { code: 'invalid_group', message: 'The group is an element group that runs a model.' });
  }
  if (typeof body?.locked !== 'boolean') return refuse(c, 400, { code: 'invalid_lock', message: 'Lock is true or false.' });
  const key = groupKey(group);
  const model = body?.model;
  if (model === null) {
    if (body.locked) return refuse(c, 400, { code: 'lock_needs_model', message: 'Pick a model to lock the group to.' });
    await c.env.DB.prepare('DELETE FROM deck_model_picks WHERE scope = ?1 AND scope_id = ?2 AND key = ?3').bind('org', ORG_HQ, key).run();
    await logAdminAction(c.env, Number(user.id), user.email ?? '', 'deck_model_org_cleared', { group });
    return c.json({ ok: true, group, model: null, locked: false });
  }
  const m = typeof model === 'string' ? modelById(model) : null;
  if (!m || !isOffered(m, c.env as CatalogueSwitches) || !offerable(model) || !keyOffers(key, model)) {
    return refuse(c, 400, { code: 'model_not_offered', message: 'That model is not offered for this group.' });
  }
  await c.env.DB.prepare(
    `INSERT INTO deck_model_picks (scope, scope_id, key, model, locked, plan_min, set_by, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))
     ON CONFLICT (scope, scope_id, key) DO UPDATE SET model = excluded.model, locked = excluded.locked, plan_min = excluded.plan_min, set_by = excluded.set_by, updated_at = excluded.updated_at`,
  ).bind('org', ORG_HQ, key, model, body.locked ? 1 : 0, MODEL_LOCKS[model] ?? 'all', Number(user.id) || null).run();
  await logAdminAction(c.env, Number(user.id), user.email ?? '', body.locked ? 'deck_model_org_locked' : 'deck_model_org_default', { group, model, locked: body.locked });
  return c.json({ ok: true, group, model, locked: body.locked });
});
