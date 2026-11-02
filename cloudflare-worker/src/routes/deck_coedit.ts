/**
 * D1577 (#3824, deck v2 E4) — co-editing a deck.
 *
 *   PATCH /api/decks/:id/cards/:uid/areas/:area   one area of a card's working copy, { base, next }
 *   POST  /api/decks/:id/restore-card             { card_uid }: one card of version :id into the current version
 *   GET   /api/decks/:id/presence                 who is editing the deck now
 *   GET   /api/decks/:id/presence/ws              the editors' socket (Upgrade: websocket)
 *
 * AREA SAVES. A9's `PATCH /cards/:uid` (D1501) takes the whole card under
 * `If-Match`, so of two members on one card only the first save wins. This
 * route takes one area: the server applies it onto the card as it holds it now
 * (`mergeArea`) and saves under the card's own `rev`, retrying when another
 * area's save got there first. Two members on different areas both keep their
 * edit; two on the same area get 409 `area_conflict` with the server's copy.
 *
 * SINGLE-SLIDE RESTORE, beside the whole-version `POST /:id/restore` (decks.ts):
 * the card with `card_uid` in version `:id` replaces the same card in the
 * deck's current version, as a new version. No other card changes.
 *
 * PRESENCE runs in the `DeckPresence` Durable Object (one per venture's deck).
 * It is not bound until the owner approves D1577's cost estimate (decision L):
 * until then both presence routes answer 503 `presence_off`.
 *
 * Who: a deck's readers may read its presence; its writers may save an area,
 * restore a card and join the editors' socket (`projectOwned`).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { refuse } from '../util/refusal';
import { doNamespace } from '../util/doNamespace';
import { auditDeckWrite, ensureSchema, getDeckRow, insertVersion, rowToDeck, sanitizeImageUrl, sanitizeSlides, themeOfRow } from './decks';
import { modelProblems } from '../services/decks/slideModel';
import { AREA_ID, mergeArea, restoreOneCard } from '../services/decks/coedit';
import { authenticateForUpgrade, checkUpgradeRate } from './realtime';

const deckCoedit = new Hono<{ Bindings: Env }>();

const UID = /^[A-Za-z0-9_-]{1,40}$/;
/** How many times an area save retries when another area's save moved the card's rev first. */
export const AREA_RETRIES = 4;

export const PRESENCE_OFF = 'Seeing who else is editing is not switched on yet.';

async function deckFor(c: any, user: any, write: boolean): Promise<{ row: any } | Response> {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id < 1) return c.json({ error: 'not found' }, 404);
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, id); } catch { return c.json({ error: 'not found' }, 404); }
  try { await projectOwned(c, user, Number(row.project_id), write ? { write: true } : undefined); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  return { row };
}

type CardRow = { json: string; rev: number; ord: number; updated_at: string };

deckCoedit.patch('/:id{[0-9]+}/cards/:uid/areas/:area', async (c) => {
  const user = await requireAuth(c);
  const got = await deckFor(c, user, true);
  if (got instanceof Response) return got;
  const deckId = Number(got.row.id);
  const uid = c.req.param('uid');
  const area = c.req.param('area');
  if (!UID.test(uid)) return refuse(c, 400, { code: 'invalid_card_uid', message: 'That is not a card of this deck.' });
  if (!AREA_ID.test(area)) return refuse(c, 400, { code: 'invalid_area', message: 'That is not an area of this card.' });
  const body: any = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('next' in body)) {
    return refuse(c, 400, { code: 'area_required', message: 'Send the area as { base, next }.' });
  }
  for (let attempt = 0; attempt < AREA_RETRIES; attempt += 1) {
    const row = await c.env.DB.prepare('SELECT json, rev, ord, updated_at FROM pitch_deck_cards WHERE deck_id = ?1 AND card_uid = ?2')
      .bind(deckId, uid).first<CardRow>();
    if (!row) return refuse(c, 409, { code: 'no_working_copy', message: 'This card has no working copy yet. Save the card first.' });
    let current: any = null;
    try { current = JSON.parse(row.json); } catch { current = null; }
    const merged = mergeArea(current, area, body.base ?? null, body.next);
    if (!merged.ok && merged.code === 'invalid_area') return refuse(c, 400, { code: 'invalid_area', message: merged.message });
    if (!merged.ok) {
      return refuse(c, 409, {
        code: 'area_conflict',
        message: 'Another member changed this area while you were editing it. Nothing was saved.',
        extra: { rev: Number(row.rev), server: merged.server },
      });
    }
    if (!merged.changed) return c.json({ ok: true, deck_id: deckId, card_uid: uid, area, rev: Number(row.rev), saved: false });
    const problems = modelProblems([merged.card], sanitizeImageUrl);
    if (problems.length) return refuse(c, 400, { code: 'SLIDE_MODEL', message: problems[0], extra: { problems } });
    const card = sanitizeSlides([{ ...merged.card, uid }])[0];
    const r = await c.env.DB.prepare(
      `UPDATE pitch_deck_cards SET json = ?4, rev = rev + 1, updated_at = datetime('now')
        WHERE deck_id = ?1 AND card_uid = ?2 AND rev = ?3`,
    ).bind(deckId, uid, Number(row.rev), JSON.stringify(card)).run();
    if (Number(r?.meta?.changes || 0) === 1) {
      return c.json({ ok: true, deck_id: deckId, card_uid: uid, area, rev: Number(row.rev) + 1, saved: true, card });
    }
    // Another save moved the card's rev between our read and our write: read it again and re-apply this area.
  }
  return refuse(c, 409, { code: 'card_busy', message: 'This card is being saved by several members at once. Try again in a moment.' });
});

deckCoedit.post('/:id{[0-9]+}/restore-card', async (c) => {
  const user = await requireAuth(c);
  const got = await deckFor(c, user, true);
  if (got instanceof Response) return got;
  const older = got.row;
  const body: any = await c.req.json().catch(() => ({}));
  const uid = typeof body?.card_uid === 'string' ? body.card_uid : '';
  if (!UID.test(uid)) return refuse(c, 400, { code: 'invalid_card_uid', message: 'Say which card to restore.' });
  const projectId = Number(older.project_id);
  const head = await c.env.DB.prepare('SELECT id, version FROM pitch_decks WHERE project_id = ?1 AND is_current = 1')
    .bind(projectId).first<{ id: number; version: number }>();
  if (!head) return c.json({ error: 'not found' }, 404);
  const currentRow = await getDeckRow(c.env, Number(head.id));
  const read = (r: any) => { try { return sanitizeSlides(JSON.parse(r.slides || '[]')); } catch { return []; } };
  const out = restoreOneCard(read(currentRow), read(older), uid);
  if (!out.ok && out.code === 'card_not_in_version') {
    return refuse(c, 404, { code: 'card_not_in_version', message: 'That card is not in this version.' });
  }
  if (!out.ok) return refuse(c, 409, { code: 'card_unchanged', message: 'The current version already has this card as it was.' });
  const newId = await insertVersion(c.env, projectId, out.slides, currentRow.title, Number(user.id) || null,
    { audience: currentRow.audience ?? null, round_ref: currentRow.round_ref ?? null, theme: themeOfRow(currentRow) },
    { id: Number(head.id), version: Number(head.version) });
  await auditDeckWrite(c, user, projectId, 'deck_card_restored', `Card restored from v${Number(older.version) || 1}`);
  return c.json({ ...rowToDeck(await getDeckRow(c.env, Number(newId))), restored: { card_uid: uid, from_version: Number(older.version), placed: out.placed, index: out.index } });
});

/** The deck's room: one per venture, so every version shares it. */
const roomOf = (c: any, projectId: number) => {
  const ns = doNamespace(c.env, c.env.DECK_PRESENCE);
  return ns.get(ns.idFromName(`deck:${projectId}`));
};

deckCoedit.get('/:id{[0-9]+}/presence', async (c) => {
  const user = await requireAuth(c);
  const got = await deckFor(c, user, false);
  if (got instanceof Response) return got;
  if (!c.env.DECK_PRESENCE) return refuse(c, 503, { code: 'presence_off', message: PRESENCE_OFF });
  const res = await roomOf(c, Number(got.row.project_id)).fetch('https://do/state');
  const state: any = await res.json().catch(() => null);
  return c.json({ deck_id: Number(got.row.id), editors: Array.isArray(state?.editors) ? state.editors : [] });
});

deckCoedit.get('/:id{[0-9]+}/presence/ws', async (c) => {
  if (c.req.header('upgrade') !== 'websocket') return c.json({ error: 'Expected WebSocket upgrade' }, 426);
  if (!c.env.DECK_PRESENCE) return refuse(c, 503, { code: 'presence_off', message: PRESENCE_OFF });
  const authed = await authenticateForUpgrade(c);
  if (!authed) return c.json({ error: 'Unauthorized' }, 401);
  const got = await deckFor(c, authed, true);
  if (got instanceof Response) return got;
  if (!(await checkUpgradeRate(c.env, authed.id))) return c.json({ error: 'Too many WS upgrades' }, 429);
  const who = await c.env.DB.prepare('SELECT name FROM users WHERE id = ?1').bind(authed.id).first<{ name: string | null }>();
  const headers: Record<string, string> = { upgrade: 'websocket', 'x-auth-user-id': String(authed.id) };
  if (who?.name) headers['x-auth-name'] = encodeURIComponent(who.name);
  const proto = c.req.header('sec-websocket-protocol');
  if (proto) headers['sec-websocket-protocol'] = proto;
  return roomOf(c, Number(got.row.project_id)).fetch(new Request('https://do/ws', { headers }));
});

export default deckCoedit;
