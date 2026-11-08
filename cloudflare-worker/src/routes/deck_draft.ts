/**
 * D1501 (#3751, deck v2 A9) — a deck version's working copy, kept on the
 * Worker card by card (migration 715), so a paid generation or an insert is
 * never lost to a closed tab.
 *
 *   PATCH  /api/decks/:id/cards/:uid   one card's working copy, `If-Match: <rev>`
 *   GET    /api/decks/:id/draft        the version's working copy
 *   DELETE /api/decks/:id/draft        discard it
 *   PUT    /api/decks/:id/draft-doc    D4596: which cards the working copy keeps, their order, the theme and the audience
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
import { projectOwned } from '../services/decks/access';
import { refuse } from '../util/refusal';
import { ensureSchema, getDeckRow, sanitizeImageUrl, sanitizeSlides } from './decks';
import { AUDIENCES, THEME_KINDS, modelProblems, sanitizeTheme } from '../services/decks/slideModel';
import { revOf } from '../services/decks/ifMatch';
import { saveGateRefusal } from '../services/decks/saveGates';

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

type DocRow = { rev: number; order_json: string; theme_json: string | null; audience: string | null; updated_at: string };
/** D4596: the working copy's deck-level state, or null when none was ever saved. */
async function docOf(env: Env, deckId: number) {
  const r = await env.DB.prepare('SELECT rev, order_json, theme_json, audience, updated_at FROM pitch_deck_draft_doc WHERE deck_id = ?1').bind(deckId).first<DocRow>();
  if (!r) return null;
  let order: unknown = [], theme: unknown = null;
  try { order = JSON.parse(r.order_json); } catch { order = []; }
  try { theme = r.theme_json ? JSON.parse(r.theme_json) : null; } catch { theme = null; }
  return { rev: Number(r.rev), order: Array.isArray(order) ? order as string[] : [], theme, audience: r.audience ?? null, updated_at: r.updated_at };
}

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
  const doc = await docOf(c.env, Number(got.row.id));
  return c.json({ deck_id: Number(got.row.id), version: Number(got.row.version), rev: Number(got.row.version), updated_at: doc && (!updated || doc.updated_at > updated) ? doc.updated_at : updated, cards, doc });
});

deckDraft.delete('/:id{[0-9]+}/draft', async (c) => {
  const got = await deckFor(c, true);
  if (got instanceof Response) return got;
  const [r] = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM pitch_deck_cards WHERE deck_id = ?1').bind(Number(got.row.id)),
    c.env.DB.prepare('DELETE FROM pitch_deck_draft_doc WHERE deck_id = ?1').bind(Number(got.row.id)),
  ]);
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
  // D1543 (#3781): the same gates as a save: an unpermitted logo or an unconsented quote is refused, nothing written.
  // D1572 (#3819): a locked palette checks only colours new to the card (its working copy, else its saved version).
  let prior: unknown = null;
  try {
    const kept = await c.env.DB.prepare('SELECT json FROM pitch_deck_cards WHERE deck_id = ?1 AND card_uid = ?2').bind(deckId, uid).first<{ json: string }>();
    prior = kept ? JSON.parse(kept.json) : JSON.parse(got.row.slides || '[]');
  } catch { prior = null; }
  const gate = await saveGateRefusal(c.env, Number(got.row.project_id), [card], { prior });
  if (gate) return refuse(c, 409, gate);
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

/**
 * D4596 (#4596) — PUT /:id/draft-doc { order, theme, audience } with `If-Match: <rev>` (0 for the first).
 * `order` is the complete list of the card uids the working copy keeps, in order: a card it does not
 * list is removed, and its working copy is deleted in the same batch, gated on this write having won.
 * One conditional statement decides between two writers; the loser gets 409 `doc_rev_conflict` with
 * the server's state, and nothing is written. Theme and audience are checked as a save checks them.
 */
deckDraft.put('/:id{[0-9]+}/draft-doc', async (c) => {
  const got = await deckFor(c, true);
  if (got instanceof Response) return got;
  const deckId = Number(got.row.id);
  const header = c.req.header('if-match');
  if (header == null) return refuse(c, 428, { code: 'if_match_required', message: 'Send the revision you edited (If-Match), or 0 for the first save.' });
  const rev = revOf(header);
  if (rev == null) return refuse(c, 400, { code: 'invalid_if_match', message: 'If-Match must be the revision you edited, a whole number.' });
  const body: any = await c.req.json().catch(() => null);
  const order = body?.order;
  if (!Array.isArray(order) || order.length > DRAFT_MAX_CARDS || !order.every((u: unknown) => typeof u === 'string' && UID.test(u)) || new Set(order).size !== order.length) {
    return refuse(c, 400, { code: 'invalid_order', message: `Send order as the deck's card uids, at most ${DRAFT_MAX_CARDS}, each once.` });
  }
  const audience = body?.audience ?? null;
  if (audience !== null && !(typeof audience === 'string' && (AUDIENCES as readonly string[]).includes(audience))) {
    return refuse(c, 400, { code: 'invalid_audience', message: `audience must be one of ${AUDIENCES.join(', ')}` });
  }
  let theme: unknown = body?.theme ?? null;
  if (theme !== null) {
    theme = sanitizeTheme(theme, sanitizeImageUrl);
    if (!theme) return refuse(c, 400, { code: 'invalid_theme', message: `theme.kind must be one of ${THEME_KINDS.join(', ')}` });
  }
  const next = rev + 1;
  const write = rev === 0
    ? c.env.DB.prepare(`INSERT INTO pitch_deck_draft_doc (deck_id, rev, order_json, theme_json, audience, updated_at)
                        SELECT ?1, 1, ?2, ?3, ?4, datetime('now') WHERE NOT EXISTS (SELECT 1 FROM pitch_deck_draft_doc WHERE deck_id = ?1)`)
        .bind(deckId, JSON.stringify(order), theme ? JSON.stringify(theme) : null, audience)
    : c.env.DB.prepare(`UPDATE pitch_deck_draft_doc SET order_json = ?3, theme_json = ?4, audience = ?5, rev = rev + 1, updated_at = datetime('now')
                         WHERE deck_id = ?1 AND rev = ?2`)
        .bind(deckId, rev, JSON.stringify(order), theme ? JSON.stringify(theme) : null, audience);
  // The cards it no longer keeps go in the same batch, but only when THIS write is the doc's current revision.
  const prune = c.env.DB.prepare(
    `DELETE FROM pitch_deck_cards WHERE deck_id = ?1 AND card_uid NOT IN (SELECT value FROM json_each(?2))
        AND EXISTS (SELECT 1 FROM pitch_deck_draft_doc WHERE deck_id = ?1 AND rev = ?3 AND order_json = ?2)`,
  ).bind(deckId, JSON.stringify(order), next);
  const [won] = await c.env.DB.batch([write, prune]);
  if (!Number(won?.meta?.changes || 0)) {
    return refuse(c, 409, {
      code: 'doc_rev_conflict',
      message: 'This deck changed in another tab or by another member while you were editing. Nothing was saved.',
      extra: { rev: (await docOf(c.env, deckId))?.rev ?? 0, server: await docOf(c.env, deckId) },
    });
  }
  return c.json({ ok: true, deck_id: deckId, doc: await docOf(c.env, deckId) });
});

export default deckDraft;
