/**
 * D1501 (#3751, deck v2 A9) — a deck version's working copy, kept on the
 * Worker card by card (migration 715), so a paid generation or an insert is
 * never lost to a closed tab.
 *
 *   PATCH  /api/decks/:id/cards/:uid   one card's working copy, `If-Match: <rev>`
 *   GET    /api/decks/:id/draft        the version's working copy
 *   DELETE /api/decks/:id/draft        discard it
 *
 * `If-Match` is required on a PATCH: `0` creates the card's first working copy,
 * `n` replaces revision n. Both are one conditional statement, so of two tabs
 * writing the same card only one wins; the other gets 409 `card_rev_conflict`
 * with the server's copy. A missing header is 428 `if_match_required`.
 *
 * A working copy is checked with the same model rules as a save
 * (`modelProblems`) and kept whole, so whatever a card references (a generated
 * image, a figure's binding, an inserted proposal's blocks) stays referenced.
 * "Save as version" stays the explicit `PUT /api/decks/:id`. Nothing outside
 * these three routes reads `pitch_deck_cards`: no share link, export or reader.
 *
 * Who: the deck's readers may read its draft; its writers may change it
 * (`projectOwned`, as `GET` and `PUT /:id`).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { refuse } from '../util/refusal';
import { ensureSchema, getDeckRow, sanitizeImageUrl, sanitizeSlides } from './decks';
import { modelProblems } from '../services/decks/slideModel';
import { revOf } from '../services/decks/ifMatch';

const deckDraft = new Hono<{ Bindings: Env }>();

const UID = /^[A-Za-z0-9_-]{1,40}$/;
/** As many cards as a deck may hold (`sanitizeSlides`). */
export const DRAFT_MAX_CARDS = 60;

type CardRow = { card_uid: string; ord: number; json: string; rev: number; updated_at: string };
const cardOf = (r: CardRow) => {
  let card: unknown = null;
  try { card = JSON.parse(r.json); } catch { card = null; }
  return { uid: r.card_uid, ord: Number(r.ord), rev: Number(r.rev), updated_at: r.updated_at, card };
};

async function deckFor(c: any, write: boolean): Promise<{ row: any } | Response> {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id < 1) return c.json({ error: 'not found' }, 404);
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, id); } catch { return c.json({ error: 'not found' }, 404); }
  try { await projectOwned(c, user, Number(row.project_id), write ? { write: true } : undefined); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  return { row };
}

deckDraft.get('/:id{[0-9]+}/draft', async (c) => {
  const got = await deckFor(c, false);
  if (got instanceof Response) return got;
  const res = await c.env.DB.prepare(
    'SELECT card_uid, ord, json, rev, updated_at FROM pitch_deck_cards WHERE deck_id = ?1 ORDER BY ord, card_uid',
  ).bind(Number(got.row.id)).all<CardRow>();
  const cards = (res.results || []).map(cardOf);
  const updated = cards.reduce<string | null>((m, x) => (!m || x.updated_at > m ? x.updated_at : m), null);
  return c.json({ deck_id: Number(got.row.id), version: Number(got.row.version), rev: Number(got.row.version), updated_at: updated, cards });
});

deckDraft.delete('/:id{[0-9]+}/draft', async (c) => {
  const got = await deckFor(c, true);
  if (got instanceof Response) return got;
  const r = await c.env.DB.prepare('DELETE FROM pitch_deck_cards WHERE deck_id = ?1').bind(Number(got.row.id)).run();
  return c.json({ ok: true, deck_id: Number(got.row.id), discarded: Number(r?.meta?.changes || 0) });
});

deckDraft.patch('/:id{[0-9]+}/cards/:uid', async (c) => {
  const got = await deckFor(c, true);
  if (got instanceof Response) return got;
  const deckId = Number(got.row.id);
  const uid = c.req.param('uid');
  if (!UID.test(uid)) return refuse(c, 400, { code: 'invalid_card_uid', message: 'That is not a card of this deck.' });
  const header = c.req.header('if-match');
  if (header == null) return refuse(c, 428, { code: 'if_match_required', message: 'Send the card revision you edited (If-Match), or 0 for its first save.' });
  const rev = revOf(header);
  if (rev == null) return refuse(c, 400, { code: 'invalid_if_match', message: 'If-Match must be the card revision you edited, a whole number.' });
  const body: any = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || !body.card || typeof body.card !== 'object' || Array.isArray(body.card)) {
    return refuse(c, 400, { code: 'card_required', message: 'Send the card as { card }.' });
  }
  const ordIn = body.ord;
  if (ordIn !== undefined && !(Number.isInteger(ordIn) && ordIn >= 0 && ordIn < DRAFT_MAX_CARDS)) {
    return refuse(c, 400, { code: 'invalid_ord', message: `A card's place is 0 to ${DRAFT_MAX_CARDS - 1}.` });
  }
  // The same rules as a save, so a working copy can always become a version.
  const problems = modelProblems([body.card], sanitizeImageUrl);
  if (problems.length) return refuse(c, 400, { code: 'SLIDE_MODEL', message: problems[0], extra: { problems } });
  const card = sanitizeSlides([{ ...body.card, uid }])[0];
  const json = JSON.stringify(card);
  const current = async () => (await c.env.DB.prepare(
    'SELECT card_uid, ord, json, rev, updated_at FROM pitch_deck_cards WHERE deck_id = ?1 AND card_uid = ?2',
  ).bind(deckId, uid).first<CardRow>()) ?? null;
  const conflict = async () => {
    const server = await current();
    return refuse(c, 409, {
      code: 'card_rev_conflict',
      message: 'This card changed in another tab or by another member while you were editing. Nothing was saved.',
      extra: { rev: server ? Number(server.rev) : 0, server: server ? cardOf(server) : null },
    });
  };
  let changes = 0;
  if (rev === 0) {
    // The card's first working copy, under the deck's card limit.
    const r = await c.env.DB.prepare(
      `INSERT INTO pitch_deck_cards (deck_id, card_uid, ord, json, rev, updated_at)
       SELECT ?1, ?2, ?3, ?4, 1, datetime('now')
        WHERE NOT EXISTS (SELECT 1 FROM pitch_deck_cards WHERE deck_id = ?1 AND card_uid = ?2)
          AND (SELECT COUNT(*) FROM pitch_deck_cards WHERE deck_id = ?1) < ?5`,
    ).bind(deckId, uid, ordIn ?? 0, json, DRAFT_MAX_CARDS).run();
    changes = Number(r?.meta?.changes || 0);
    if (!changes && !(await current())) {
      return refuse(c, 409, { code: 'draft_full', message: `A deck holds at most ${DRAFT_MAX_CARDS} cards.` });
    }
  } else {
    const r = await c.env.DB.prepare(
      `UPDATE pitch_deck_cards SET json = ?4, ord = COALESCE(?5, ord), rev = rev + 1, updated_at = datetime('now')
        WHERE deck_id = ?1 AND card_uid = ?2 AND rev = ?3`,
    ).bind(deckId, uid, rev, json, ordIn ?? null).run();
    changes = Number(r?.meta?.changes || 0);
  }
  if (!changes) return conflict();
  const saved = await current();
  return c.json({ ok: true, deck_id: deckId, card: saved ? cardOf(saved) : null });
});

export default deckDraft;
