/**
 * D1521 (#3773, deck v2 A22) — an instruction on the grid selection, mounted at
 * `/api/decks` beside the areas routes.
 *
 *   POST /api/decks/:id/areas/instruct/quote   { card?, selection: [{card_uid?, area_id, instruction?}],
 *                                              instruction? | action?, variants? | mode? }
 *                                              → the areas quote: per-area lines, gates and hold, the total,
 *                                                quote_uid, expires_at
 *   POST /api/decks/:id/areas/instruct         the same body (+ quote_uid), with an Idempotency-Key header:
 *                                              admits ONE run under one hold and makes one proposal per
 *                                              selected area → { batch_uid, class, hold_microusd, replayed,
 *                                              selection, action, proposals, refused }
 *
 * The proposals are #3764's (`deck_area_proposals`), so they are read, settled,
 * accepted by the area and discarded through the areas routes. Each records
 * the selection it was scoped to (`selection_json`), the hash of the words
 * (`instruction_sha256`) and what was asked (`action`); the words themselves
 * live only in the run's step input.
 *
 * An instruction that names a figure is 422 `names_figure` before anything is
 * quoted or held. Who: the deck's writers. Admission runs under the
 * `deck_generate` rate bucket.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { admitDeckRun } from '../services/decks/genRooms';
import { expiresAtOf, proposalView, quoteHolds, quoteView, type ProposalRow } from '../services/decks/areas';
import { parseInstruct, planInstruct, selectionJson } from '../services/decks/instruct';
import { bodyOf, deckFor, planCtx } from './deck_areas';

const deckInstruct = new Hono<{ Bindings: Env }>();

/** A refused body: a figure is well formed and refused on purpose (422); anything else is a bad request (400). */
const refusedBody = (c: any, req: { refusal: string; message: string }) => refuse(c, req.refusal === 'names_figure' ? 422 : 400, { code: req.refusal, message: req.message });

deckInstruct.post('/:id{[0-9]+}/areas/instruct/quote', async (c) => {
  const user: User = await requireAuth(c);
  const deck = await deckFor(c, user);
  if (deck instanceof Response) return deck;
  const req = parseInstruct(await bodyOf(c));
  if ('refusal' in req) return refusedBody(c, req);
  const plan = await planInstruct(planCtx(c, user, deck), req);
  return c.json(await quoteView(plan, Date.now()));
});

deckInstruct.post('/:id{[0-9]+}/areas/instruct', async (c) => {
  const user: User = await requireAuth(c);
  const deck = await deckFor(c, user);
  if (deck instanceof Response) return deck;
  const body = await bodyOf(c);
  const req = parseInstruct(body);
  if ('refusal' in req) return refusedBody(c, req);
  const userId = Number(user.id) || 0;
  const now = Date.now();
  const plan = await planInstruct(planCtx(c, user, deck), req);
  if (body?.quote_uid != null && !(await quoteHolds(body.quote_uid, plan, now))) {
    return refuse(c, 409, { code: 'quote_stale', message: 'The price, the areas or the instruction changed since this quote, or it expired. Read the quote again; nothing was charged.' });
  }
  const runnable = plan.areas.filter((a) => !a.refusal);
  const refused = plan.areas.filter((a) => a.refusal).map((a) => ({ key: a.key, card_uid: a.card_uid, area_id: a.area_id, element: a.element, gates: a.gates, refusal: a.refusal }));
  if (!runnable.length) return refuse(c, 422, { code: 'nothing_to_run', message: 'None of these areas can run. Each one says why; nothing was charged.', extra: { refused } });

  const idemKey = String(c.req.header('Idempotency-Key') ?? body?.idempotency_key ?? '');
  const r = await admitDeckRun(c.env, {
    deckId: deck.deckId, projectId: deck.projectId, userId, cls: plan.cls, idemKey, lines: plan.lines,
    quoteUid: typeof body?.quote_uid === 'string' ? body.quote_uid : null,
  });
  if (!r.body.ok) return refuse(c, r.status, { code: r.body.refusal, message: r.body.message });
  const batch = { uid: r.body.uid, quote_microusd: r.body.quote_microusd, replayed: r.body.replayed };
  const scope = { selection: JSON.parse(selectionJson(plan)) as Array<{ card_uid: string; area_id: string }>, action: req.action ?? 'instruction' };
  // A retried request is the same run: its proposals already exist, and nothing is charged again.
  if (batch.replayed) {
    const rows = ((await c.env.DB.prepare('SELECT * FROM deck_area_proposals WHERE batch_uid = ?1 ORDER BY created_at, uid').bind(batch.uid).all<ProposalRow>()).results ?? []) as ProposalRow[];
    return c.json({ batch_uid: batch.uid, class: plan.cls, hold_microusd: batch.quote_microusd, replayed: true, ...scope, proposals: rows.map(proposalView), refused });
  }
  const expires = expiresAtOf(now);
  const created = new Date(now).toISOString().slice(0, 19).replace('T', ' ');
  const selection = JSON.stringify(scope.selection);
  const made: ProposalRow[] = [];
  const stmts = runnable.map((a) => {
    const p = a.payload as any;
    const row: ProposalRow = {
      uid: crypto.randomUUID(), deck_id: deck.deckId, project_id: deck.projectId, card_uid: a.card_uid, area_id: a.area_id, batch_uid: batch.uid,
      mode: 'variants', element: a.element, payload_json: JSON.stringify(p), variants_json: null, state: 'running', outcome: null, accepted_variant: null,
      replaces_block: p.replaces_block ?? null, created_by: userId, created_at: created, decided_at: null, expires_at: expires,
    };
    made.push(row);
    return c.env.DB.prepare(`INSERT INTO deck_area_proposals (uid, deck_id, project_id, card_uid, area_id, batch_uid, mode, element, payload_json, state, replaces_block, created_by, created_at, expires_at, selection_json, instruction_sha256, action)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`)
      .bind(row.uid, row.deck_id, row.project_id, row.card_uid, row.area_id, row.batch_uid, row.mode, row.element, row.payload_json, row.state, row.replaces_block, row.created_by, row.created_at, row.expires_at, selection, p.instruction_sha256, p.instruct);
  });
  await c.env.DB.batch(stmts);
  return c.json({ batch_uid: batch.uid, class: plan.cls, hold_microusd: batch.quote_microusd, replayed: false, ...scope, proposals: made.map(proposalView), refused });
});

export default deckInstruct;
