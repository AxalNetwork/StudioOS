/**
 * D1516 (#3768, deck v2 A5) — New deck from the narrative, mounted at
 * `/api/decks` beside the areas routes.
 *
 *   POST /api/decks/narrative/outline  { project_id, audience?, stage?, sector? }
 *        → { project_id, narrative: { version, ref, reason, dropped }, stage, stage_label, stage_source,
 *            cards: [{ card, uid, title, why, proof, structure, areas: [{ id, element }] }],
 *            left_out: [{ card, title, line }], warnings, theme: { kind, reason }, template: { template_id, reason },
 *            quote: the areas quote of every area (class deck_build) }
 *        The outline, the grid plan and the price. It runs nothing and holds nothing.
 *   POST /api/decks/narrative/build    the same body + quote_uid, with an Idempotency-Key header
 *        → { deck_id, version, narrative_version, batch_uid, class, hold_microusd, replayed, theme, template,
 *            proposals, refused, left_out }
 *        Saves the planned cards as a new version that is NOT current (the founder's deck stays as it was until
 *        they save), and admits ONE run of class `deck_build` over every area under one hold, as #3764's
 *        proposals. 409 `quote_stale`; 422 `nothing_to_run`. The same key twice is the same build: no second
 *        version, no second hold.
 *
 * The narrative's words reach the models only as the cards' notes, each
 * sentence that names a figure dropped (`figureFree`): figures come from the
 * records elements, bound. Who: the venture's writers (`projectOwned`, write).
 * The build path is under the `deck_generate` rate bucket.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { admitDeckRun } from '../services/decks/genRooms';
import { planAreas, proposalView, quoteHolds, quoteView, type AreasPlan, type ProposalRow } from '../services/decks/areas';
import { deckBrandKitFor } from '../services/decks/brandKit';
import { deckStage } from '../services/decks/stagePlan';
import {
  buildAreas, cardsFor, gridPlan, isAudience, narrativeWords, pickTheme, plannedCards, type GridCard,
} from '../services/decks/narrativeBuild';
import { ensureSchema, projectOwned } from './decks';
import { insertProposals, planCtx, type Deck } from './deck_areas';
import { pickHqTemplate } from './deck_templates';

const deckNarrative = new Hono<{ Bindings: Env }>();

const projectIdOf = (v: unknown) => (Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
/**
 * The deck id the plan is made under before its version exists: per venture, so
 * each venture's areas get their own seeds, and the same in the outline and the build.
 */
const seedDeck = (projectId: number) => -projectId;
async function bodyOf(c: any): Promise<any> { try { return await c.req.json(); } catch { return null; } }

/** Everything the outline and the build share: the cut, the grid plan, the cards, the theme, the template and the planned run. */
async function planOf(c: any, user: User, projectId: number, body: any, deckId: number) {
  const env = c.env as Env;
  const audience = isAudience(body?.audience) ? body.audience : null;
  const project = await env.DB.prepare('SELECT stage FROM projects WHERE id = ?').bind(projectId).first<{ stage: string | null }>().catch(() => null);
  const { stage, source } = deckStage(body?.stage, audience, project?.stage ?? null);
  const sector = typeof body?.sector === 'string' && body.sector.trim() ? body.sector.trim().slice(0, 80) : null;
  const deck: Deck = { deckId, projectId, cards: [], aspect: '16:9', voice: null, contrastAa: null };
  const ctx = planCtx(c, user, deck);
  const [items, narrative, kit, template] = await Promise.all([
    ctx.sources().catch(() => []),
    narrativeWords(env, projectId),
    deckBrandKitFor(env, projectId).catch(() => null),
    pickHqTemplate(env, { stage, audience, sector }).catch(() => ({ template_id: null, reason: 'The template gallery could not be read right now.' })),
  ]);
  const cut = cardsFor(stage, audience, items);
  const grid = gridPlan(cut.cards, items);
  const theme = pickTheme({ brandKit: !!kit, stage, audience, sector });
  // The run over every area. An area the records cannot fill after all writes words instead, once (no empty area).
  let plan: AreasPlan;
  for (let pass = 0; ; pass += 1) {
    ctx.cards = plannedCards(grid, narrative);
    plan = await planAreas(ctx, { card: null, areas: buildAreas(grid), variants: 1, cls: 'deck_build' });
    const swap = plan.areas.filter((a) => a.refusal && a.kind !== 'text');
    if (!swap.length || pass > 0) break;
    for (const a of swap) {
      const card = grid.cards.find((g) => g.uid === a.card_uid);
      const area = card?.areas.find((x) => x.id === a.area_id);
      if (area) area.element = 'body';
    }
  }
  return { audience, stage, stageSource: source, cut, grid, narrative, theme, template, plan, cards: ctx.cards };
}

const cardsView = (grid: { cards: GridCard[] }, cut: ReturnType<typeof cardsFor>) => grid.cards.map((g) => {
  const c = cut.cards.find((x) => x.card === g.card)!;
  return { card: g.card, uid: g.uid, title: g.title, why: c.why, proof: c.proof, structure: g.structure, areas: g.areas };
});

async function writer(c: any, user: User, projectId: number): Promise<Response | null> {
  try { await projectOwned(c, user, projectId, { write: true }); return null; } catch (e: any) {
    return e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403);
  }
}

deckNarrative.post('/narrative/outline', async (c) => {
  const user = await requireAuth(c);
  const body = await bodyOf(c);
  const projectId = projectIdOf(body?.project_id);
  if (!projectId) return refuse(c, 400, { code: 'project_required', message: 'Name the venture.' });
  const denied = await writer(c, user, projectId);
  if (denied) return denied;
  const p = await planOf(c, user, projectId, body, seedDeck(projectId));
  return c.json({
    project_id: projectId,
    narrative: { version: p.narrative.version, ref: p.narrative.ref, reason: p.narrative.reason, dropped: p.narrative.dropped },
    stage: p.stage, stage_label: p.cut.stage_label, stage_source: p.stageSource,
    cards: cardsView(p.grid, p.cut), left_out: p.cut.left_out, warnings: p.cut.warnings,
    theme: p.theme, template: p.template, quote: await quoteView(p.plan, Date.now()),
  });
});

deckNarrative.post('/narrative/build', async (c) => {
  const user = await requireAuth(c);
  const body = await bodyOf(c);
  const projectId = projectIdOf(body?.project_id);
  if (!projectId) return refuse(c, 400, { code: 'project_required', message: 'Name the venture.' });
  const denied = await writer(c, user, projectId);
  if (denied) return denied;
  const env = c.env as Env;
  const userId = Number(user.id) || 0;
  const idemKey = String(c.req.header('Idempotency-Key') ?? body?.idempotency_key ?? '');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(idemKey)) return refuse(c, 400, { code: 'idempotency_key_required', message: 'A build needs its Idempotency-Key, so a retried press is the same build.' });

  // A retried press is the same build: its version and its proposals already exist, and nothing is held again.
  const prior = await env.DB.prepare(`SELECT b.uid, b.deck_id, b.quote_microusd, d.version, d.narrative_version, d.theme_json FROM deck_area_batches b JOIN pitch_decks d ON d.id = b.deck_id
    WHERE b.idem_key = ? AND b.class = 'deck_build' AND d.project_id = ?`).bind(`narrative:${projectId}:${idemKey}`, projectId).first<any>();
  if (prior) {
    const rows = ((await env.DB.prepare('SELECT * FROM deck_area_proposals WHERE deck_id = ? ORDER BY created_at, uid').bind(prior.deck_id).all<ProposalRow>()).results ?? []) as ProposalRow[];
    return c.json({ deck_id: prior.deck_id, version: prior.version, narrative_version: prior.narrative_version, batch_uid: prior.uid, class: 'deck_build', hold_microusd: Number(prior.quote_microusd), replayed: true, proposals: rows.map(proposalView), refused: [] });
  }

  const now = Date.now();
  const p = await planOf(c, user, projectId, body, seedDeck(projectId));
  if (body?.quote_uid != null && !(await quoteHolds(body.quote_uid, p.plan, now))) {
    return refuse(c, 409, { code: 'quote_stale', message: 'The price, the cards or your records changed since this quote, or it expired. Read the outline again; nothing was charged.' });
  }
  const runnable = p.plan.areas.filter((a) => !a.refusal);
  const refused = p.plan.areas.filter((a) => a.refusal).map((a) => ({ key: a.key, card_uid: a.card_uid, area_id: a.area_id, element: a.element, gates: a.gates, refusal: a.refusal }));
  if (!runnable.length) return refuse(c, 422, { code: 'nothing_to_run', message: 'No card of this deck can be built from your records yet. Each area says why; nothing was charged.', extra: { refused, left_out: p.cut.left_out } });

  // The planned cards as a new version that is not current: nothing the founder sees changes until they save.
  await ensureSchema(env);
  const theme = { kind: p.theme.kind, background: null, reason: p.theme.reason, template_id: p.template.template_id };
  const title = 'Deck from your narrative';
  const ins = await env.DB.prepare(`INSERT INTO pitch_decks (project_id, version, slides, title, is_current, created_by, audience, theme_json, narrative_version)
    VALUES (?1, (SELECT COALESCE(MAX(version), 0) + 1 FROM pitch_decks WHERE project_id = ?1), ?2, ?3, 0, ?4, ?5, ?6, ?7)`)
    .bind(projectId, JSON.stringify(p.cards), title, userId, p.audience, JSON.stringify(theme), p.narrative.version).run();
  const deckId = Number(ins.meta?.last_row_id);
  const row = await env.DB.prepare('SELECT version FROM pitch_decks WHERE id = ?').bind(deckId).first<{ version: number }>();

  const r = await admitDeckRun(env, {
    deckId, projectId, userId, cls: 'deck_build', idemKey: `narrative:${projectId}:${idemKey}`, lines: p.plan.lines,
    quoteUid: typeof body?.quote_uid === 'string' ? body.quote_uid : null,
  });
  if (!r.body.ok || r.body.replayed) {
    // Refused, or a second press that raced the first: this version goes, and nothing else was written.
    await env.DB.prepare('DELETE FROM pitch_decks WHERE id = ? AND is_current = 0').bind(deckId).run();
    if (!r.body.ok) return refuse(c, r.status, { code: r.body.refusal, message: r.body.message });
    return refuse(c, 409, { code: 'build_in_flight', message: 'This build is already running. Its proposals appear as each area finishes.' });
  }
  const made = await insertProposals(env, { deckId, projectId }, runnable, r.body.uid, userId, now);
  return c.json({
    deck_id: deckId, version: row?.version ?? null, narrative_version: p.narrative.version, batch_uid: r.body.uid, class: 'deck_build',
    hold_microusd: r.body.quote_microusd, replayed: false, theme: p.theme, template: p.template,
    proposals: made.map(proposalView), refused, left_out: p.cut.left_out,
  });
});

export default deckNarrative;
