/**
 * D1512 (#3764, deck v2 A3) — Generate into areas, mounted at `/api/decks`
 * beside the other deck routes.
 *
 *   POST /api/decks/:id/areas/quote        { card, areas: [{ id, grid, element, card? }], variants, class? }
 *                                          → per-area lines, gates and hold, the total hold, quote_uid, expires_at
 *   POST /api/decks/:id/areas              the same body (+ quote_uid), with an Idempotency-Key header:
 *                                          admits ONE run (`admitDeckRun`, one parent hold) and makes one
 *                                          proposal per area → { batch_uid, proposals, refused }
 *   GET  /api/decks/:id/areas/proposals    ?batch=<uid>: the run's proposals, each settled from its
 *                                          steps as they end; without it, the deck's open proposals
 *   POST /api/decks/:id/areas/:card_uid/:area_id/accept   { proposal_uid, variant, all? }
 *                                          Accept: one variant of the area's proposal; the area's
 *                                          other open proposals are superseded
 *   POST /api/decks/:id/areas/proposals/:uid/discard
 *
 * Who: the deck's writers (`projectOwned` with write). A deck the member may
 * not read is 404; one they may read but not write is 403. Admission runs
 * under the `deck_generate` rate bucket (`middleware/rateLimit.ts`).
 *
 * The client never sends a model: each element's model is the AIRail's,
 * resolved here (`elementModelFor`). An area that cannot run (its gate, its
 * plan, nothing to write from) is refused on its own, with its sentence; the
 * others still run. Nothing reaches a card from here: the editor places an
 * accepted variant and Save makes it a version.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { quoteRun } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { getDeckRow, themeOfRow } from './decks';
import { deckOf, elementModelFor } from './deck_element_models';
import { mercuryFor } from './deck_sources';
import { readSources } from '../services/decks/sources';
import { ventureElement } from '../services/decks/ventureElements';
import { artOfDeck } from '../services/decks/imageDraw';
import { BODY_CONTRAST, contrast, themeTokens } from '../services/decks/designSystem';
import { D1GenRuntime } from '../services/decks/genRuntime';
import { admitDeckRun } from '../services/decks/genRooms';
import {
  FAILED_LINE, expiresAtOf, parseRequest, planAreas, proposalView, quoteHolds, quoteView, recordsVariant, settleProposals,
  type DeckAspect, type PlanCtx, type ProposalRow, type Variant,
} from '../services/decks/areas';

const deckAreas = new Hono<{ Bindings: Env }>();
const UID = '{[0-9a-f-]{36}}';
const ACTIVE = new Set(['queued', 'running', 'cancelling']);

export type Deck = { deckId: number; projectId: number; cards: any[]; aspect: DeckAspect; voice: unknown; contrastAa: boolean | null };

/** The deck the caller may write, its saved cards, aspect, voice and the theme's contrast (shared by `deck_instruct.ts`). */
export async function deckFor(c: any, user: User): Promise<Deck | Response> {
  const d = await deckOf(c, user, true);
  if (d instanceof Response) return d;
  const row = await getDeckRow(c.env, d.deckId);
  let cards: any[] = [];
  try { cards = Array.isArray(row.slides) ? row.slides : JSON.parse(row.slides || '[]'); } catch { cards = []; }
  const theme = themeOfRow(row);
  const aspect: DeckAspect = theme?.aspect === '4:3' ? '4:3' : '16:9';
  let contrastAa: boolean | null = null;
  try {
    const colours = theme?.tokens?.colours ?? themeTokens(theme?.kind ?? 'brand').tokens.colours;
    contrastAa = contrast(String(colours.ink), String(colours.ground)) >= BODY_CONTRAST;
  } catch { contrastAa = null; }
  return { deckId: d.deckId, projectId: d.projectId, cards: Array.isArray(cards) ? cards : [], aspect, voice: theme?.voice ?? null, contrastAa };
}

export function planCtx(c: any, user: User, deck: Deck): PlanCtx {
  const env = c.env as Env;
  const userId = Number(user.id) || 0;
  let sources: Promise<any[]> | null = null;
  return {
    userId, projectId: deck.projectId, deckId: deck.deckId, cards: deck.cards, aspect: deck.aspect, voice: deck.voice,
    quote: (o) => quoteRun(env, { ...o, surface: AI_SURFACE.raisePitch }),
    modelFor: (element, area) => elementModelFor(env, user, deck.projectId, element, area),
    venture: (element) => ventureElement(env, deck.projectId, element, {}),
    sources: () => (sources ??= (async () => {
      const project = await env.DB.prepare('SELECT founder_id, company_id FROM projects WHERE id = ?').bind(deck.projectId).first<any>().catch(() => null);
      const { items } = await readSources({ env, projectId: deck.projectId, today: new Date().toISOString().slice(0, 10), mercury: project ? await mercuryFor(c, user, project) : { withheld: true } });
      return items;
    })()),
    art: () => artOfDeck(env, deck.deckId, deck.projectId),
  };
}

export async function bodyOf(c: any): Promise<any> { try { return await c.req.json(); } catch { return null; } }

deckAreas.post('/:id{[0-9]+}/areas/quote', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckFor(c, user);
  if (deck instanceof Response) return deck;
  const req = parseRequest(await bodyOf(c));
  if ('refusal' in req) return refuse(c, 400, { code: req.refusal, message: req.message });
  const plan = await planAreas(planCtx(c, user, deck), req);
  return c.json(await quoteView(plan, Date.now()));
});

deckAreas.post('/:id{[0-9]+}/areas', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckFor(c, user);
  if (deck instanceof Response) return deck;
  const body = await bodyOf(c);
  const req = parseRequest(body);
  if ('refusal' in req) return refuse(c, 400, { code: req.refusal, message: req.message });
  const userId = Number(user.id) || 0;
  const now = Date.now();
  const plan = await planAreas(planCtx(c, user, deck), req);
  if (body?.quote_uid != null && !(await quoteHolds(body.quote_uid, plan, now))) {
    return refuse(c, 409, { code: 'quote_stale', message: 'The price or the areas changed since this quote, or it expired. Read the quote again; nothing was charged.' });
  }
  const runnable = plan.areas.filter((a) => !a.refusal);
  const refused = plan.areas.filter((a) => a.refusal).map((a) => ({ key: a.key, card_uid: a.card_uid, area_id: a.area_id, element: a.element, gates: a.gates, refusal: a.refusal }));
  if (!runnable.length) return refuse(c, 422, { code: 'nothing_to_run', message: 'None of these areas can run. Each one says why; nothing was charged.', extra: { refused } });

  let batch: { uid: string; quote_microusd: number; replayed: boolean } | null = null;
  if (plan.lines.length) {
    const idemKey = String(c.req.header('Idempotency-Key') ?? body?.idempotency_key ?? '');
    const r = await admitDeckRun(c.env, {
      deckId: deck.deckId, projectId: deck.projectId, userId, cls: plan.cls, idemKey, lines: plan.lines,
      quoteUid: typeof body?.quote_uid === 'string' ? body.quote_uid : null,
    });
    if (!r.body.ok) return refuse(c, r.status, { code: r.body.refusal, message: r.body.message });
    batch = { uid: r.body.uid, quote_microusd: r.body.quote_microusd, replayed: r.body.replayed };
  }
  // A retried request is the same run: its proposals already exist.
  if (batch?.replayed) {
    const rows = ((await c.env.DB.prepare('SELECT * FROM deck_area_proposals WHERE batch_uid = ?1 ORDER BY created_at, uid').bind(batch.uid).all<ProposalRow>()).results ?? []) as ProposalRow[];
    return c.json({ batch_uid: batch.uid, class: plan.cls, hold_microusd: batch.quote_microusd, replayed: true, proposals: rows.map(proposalView), refused });
  }
  const expires = expiresAtOf(now);
  const made: ProposalRow[] = [];
  const stmts = runnable.map((a) => {
    const uid = crypto.randomUUID();
    const records = a.kind === 'records';
    const variants: Variant[] | null = records ? [recordsVariant((a.payload as any).record)] : null;
    const payload = records ? { kind: 'records', replaces_block: a.payload.replaces_block ?? null } : a.payload;
    made.push({
      uid, deck_id: deck.deckId, project_id: deck.projectId, card_uid: a.card_uid, area_id: a.area_id, batch_uid: records ? null : batch?.uid ?? null,
      mode: records ? 'records' : 'variants', element: a.element, payload_json: JSON.stringify(payload), variants_json: variants ? JSON.stringify(variants) : null,
      state: records ? 'ready' : 'running', outcome: null, accepted_variant: null, replaces_block: (a.payload.replaces_block as string | null) ?? null,
      created_by: userId, created_at: new Date(now).toISOString().slice(0, 19).replace('T', ' '), decided_at: null, expires_at: expires,
    });
    const m = made[made.length - 1];
    return c.env.DB.prepare(`INSERT INTO deck_area_proposals (uid, deck_id, project_id, card_uid, area_id, batch_uid, mode, element, payload_json, variants_json, state, replaces_block, created_by, created_at, expires_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`)
      .bind(m.uid, m.deck_id, m.project_id, m.card_uid, m.area_id, m.batch_uid, m.mode, m.element, m.payload_json, m.variants_json, m.state, m.replaces_block, m.created_by, m.created_at, m.expires_at);
  });
  await c.env.DB.batch(stmts);
  return c.json({ batch_uid: batch?.uid ?? null, class: plan.cls, hold_microusd: batch?.quote_microusd ?? 0, replayed: false, proposals: made.map(proposalView), refused });
});

deckAreas.get('/:id{[0-9]+}/areas/proposals', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckFor(c, user);
  if (deck instanceof Response) return deck;
  const batchUid = c.req.query('batch');
  if (batchUid != null) {
    if (!/^[0-9a-f-]{36}$/.test(batchUid)) return refuse(c, 400, { code: 'invalid_batch', message: 'That is not a run.' });
    const st = await new D1GenRuntime(c.env, async () => ({ ok: false, charged_microusd: 0 })).status(batchUid);
    if (!st || Number(st.deck_id) !== deck.deckId) return refuse(c, 404, { code: 'run_not_found', message: 'That generation run is not available.' });
    await settleProposals(c.env, batchUid, { aspect: deck.aspect, contrastAa: deck.contrastAa });
    const rows = ((await c.env.DB.prepare('SELECT * FROM deck_area_proposals WHERE batch_uid = ?1 ORDER BY created_at, uid').bind(batchUid).all<ProposalRow>()).results ?? []) as ProposalRow[];
    const views = rows.map(proposalView);
    return c.json({
      batch: { uid: st.uid, state: st.state, held_microusd: Number(st.quote_microusd), charged_microusd: Number(st.charged_microusd) },
      done: !ACTIVE.has(st.state) && views.every((p) => p.state !== 'running'),
      proposals: views,
    });
  }
  const rows = ((await c.env.DB.prepare(`SELECT * FROM deck_area_proposals WHERE deck_id = ?1 AND state IN ('running', 'ready', 'failed') ORDER BY created_at DESC, uid LIMIT 200`).bind(deck.deckId).all<ProposalRow>()).results ?? []) as ProposalRow[];
  return c.json({ proposals: rows.map(proposalView) });
});

const sqlNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const imageUidOf = (v: Variant | undefined) => {
  const img = (v?.payload as any)?.image;
  return typeof img?.uid === 'string' ? img.uid : null;
};

deckAreas.post('/:id{[0-9]+}/areas/:card_uid/:area_id/accept', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckFor(c, user);
  if (deck instanceof Response) return deck;
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(c.req.param('card_uid')) || !/^[A-Za-z0-9:_.#-]{1,64}$/.test(c.req.param('area_id'))) {
    return refuse(c, 404, { code: 'proposal_not_found', message: 'That proposal is not on this area.' });
  }
  const body = await bodyOf(c);
  const uid = String(body?.proposal_uid ?? '');
  const n = Number(body?.variant ?? 1);
  if (!/^[0-9a-f-]{36}$/.test(uid) || !Number.isInteger(n) || n < 1 || n > 3) return refuse(c, 400, { code: 'invalid_accept', message: 'Name the proposal and the variant (1 to 3) to accept.' });
  const row = await c.env.DB.prepare('SELECT * FROM deck_area_proposals WHERE uid = ?1 AND deck_id = ?2 AND card_uid = ?3 AND area_id = ?4')
    .bind(uid, deck.deckId, c.req.param('card_uid'), c.req.param('area_id')).first<ProposalRow>();
  if (!row) return refuse(c, 404, { code: 'proposal_not_found', message: 'That proposal is not on this area.' });
  if (row.state !== 'ready') return refuse(c, 409, { code: 'not_open', message: row.state === 'running' ? 'This area is still generating.' : 'This proposal was already decided or has expired.' });
  const variants = (JSON.parse(row.variants_json || '[]') as Variant[]);
  const v = variants[n - 1];
  if (!v || v.state !== 'ready') return refuse(c, 409, { code: 'variant_not_ready', message: v?.state === 'failed' ? FAILED_LINE : 'That variant has nothing to place.' });
  const userId = Number(user.id) || 0;
  const now = sqlNow();
  const done = await c.env.DB.prepare(`UPDATE deck_area_proposals SET state = 'accepted', outcome = ?2, accepted_variant = ?3, decided_at = ?4 WHERE uid = ?1 AND state = 'ready'`)
    .bind(uid, body?.all === true ? 'accept_all' : 'accept', n, now).run();
  if (!Number(done.meta?.changes)) return refuse(c, 409, { code: 'not_open', message: 'This proposal was already decided or has expired.' });
  const stmts = [
    // Accept is by the area: its other open proposals are superseded.
    c.env.DB.prepare(`UPDATE deck_area_proposals SET state = 'discarded', outcome = 'superseded', decided_at = ?4
      WHERE deck_id = ?1 AND card_uid = ?2 AND area_id = ?3 AND uid <> ?5 AND state IN ('running', 'ready', 'failed')`).bind(deck.deckId, row.card_uid, row.area_id, now, uid),
  ];
  const kept = imageUidOf(v);
  if (kept) stmts.push(c.env.DB.prepare(`UPDATE deck_images SET state = 'kept', kept_at = COALESCE(kept_at, datetime('now')), kept_by = COALESCE(kept_by, ?3) WHERE uid = ?1 AND project_id = ?2 AND state = 'proposed'`).bind(kept, deck.projectId, userId));
  for (const other of variants.filter((x) => x !== v).map(imageUidOf).filter(Boolean) as string[]) {
    stmts.push(c.env.DB.prepare(`UPDATE deck_images SET state = 'discarded', discarded_at = datetime('now') WHERE uid = ?1 AND project_id = ?2 AND state = 'proposed'`).bind(other, deck.projectId));
  }
  await c.env.DB.batch(stmts);
  const after = await c.env.DB.prepare('SELECT * FROM deck_area_proposals WHERE uid = ?1').bind(uid).first<ProposalRow>();
  return c.json({ proposal: proposalView(after!), variant: v });
});

deckAreas.post(`/:id{[0-9]+}/areas/proposals/:uid${UID}/discard`, async (c) => {
  const user = await requireAuth(c);
  const deck = await deckFor(c, user);
  if (deck instanceof Response) return deck;
  const uid = c.req.param('uid');
  const row = await c.env.DB.prepare('SELECT * FROM deck_area_proposals WHERE uid = ?1 AND deck_id = ?2').bind(uid, deck.deckId).first<ProposalRow>();
  if (!row) return refuse(c, 404, { code: 'proposal_not_found', message: 'That proposal is not on this deck.' });
  const r = await c.env.DB.prepare(`UPDATE deck_area_proposals SET state = 'discarded', outcome = 'discard', decided_at = ?2 WHERE uid = ?1 AND state IN ('running', 'ready', 'failed')`).bind(uid, sqlNow()).run();
  if (!Number(r.meta?.changes)) return refuse(c, 409, { code: 'not_open', message: 'This proposal was already decided or has expired.' });
  const images = (JSON.parse(row.variants_json || '[]') as Variant[]).map(imageUidOf).filter(Boolean) as string[];
  if (images.length) await c.env.DB.batch(images.map((u) => c.env.DB.prepare(`UPDATE deck_images SET state = 'discarded', discarded_at = datetime('now') WHERE uid = ?1 AND project_id = ?2 AND state = 'proposed'`).bind(u, deck.projectId)));
  const after = await c.env.DB.prepare('SELECT * FROM deck_area_proposals WHERE uid = ?1').bind(uid).first<ProposalRow>();
  return c.json({ proposal: proposalView(after!) });
});

export default deckAreas;
