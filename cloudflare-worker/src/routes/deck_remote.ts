/**
 * D1581 (#3828, deck v2 F2) — the phone remote for Present, paired by code.
 * The room is `DeckRemote` (`durable-objects/deck-remote.ts`); the rules are in
 * `services/decks/remote.ts`.
 *
 *   POST   /api/decks/:id/remote/pair   a six-digit code for this version, good
 *                                       for ten minutes and one join; a new
 *                                       code ends the remote paired before
 *   GET    /api/decks/:id/remote        { code_live, paired, presenting }
 *   GET    /api/decks/:id/remote/ws     Present's socket (`bearer.<jwt>`
 *                                       subprotocol): `hello`, `paired`,
 *                                       `unpaired`, and `step` frames
 *   DELETE /api/decks/:id/remote        unpair
 *   POST   /api/decks/remote/join       { code } → { deck_id, remote_id, expires_at }
 *   POST   /api/decks/:id/remote/step   { remote_id, step } → { ok, delivered }
 *
 * Who: whoever may read the deck (`projectOwned`, the rule `GET /:id` uses),
 * on every route, the phone included. A code alone opens nothing: a member who
 * cannot read the deck is refused at the join as if the code were wrong. The
 * pair and join routes sit under the fail-closed buckets `deck_remote_pair`
 * and `deck_remote_join` (middleware/rateLimit.ts). Without the `DECK_REMOTE`
 * binding every route is 503 `remote_off`.
 *
 * The pairing screen and the phone remote are not drawn yet (needs-design on
 * #3828); Present already obeys the steps.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../services/decks/access';
import { refuse } from '../util/refusal';
import { doNamespace } from '../util/doNamespace';
import type { RouteMount } from '../util/routeRegistry';
import decks, { ensureSchema, getDeckRow } from './decks';
import { authenticateForUpgrade, checkUpgradeRate } from './realtime';
import { isCode, isRemoteId, stepOf } from '../services/decks/remote';

const deckRemote = new Hono<{ Bindings: Env }>();

const REMOTE_OFF = 'The phone remote is not switched on here.';
const CODE_WRONG = 'That code is not right, or it has expired. Ask for a new one on the presenting screen.';
const CODE_TRIES = 5;

/** The deck's room, or a pointer for a code. Only through doNamespace (D264). */
function remoteOf(env: Env, name: string) {
  const ns = doNamespace(env, env.DECK_REMOTE!);
  return ns.get(ns.idFromName(name));
}
const call = (stub: DurableObjectStub, path: string, body: unknown = {}) =>
  stub.fetch(`https://deck-remote${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function readableDeck(c: any, user: any, id: number): Promise<{ row: any } | Response> {
  if (!Number.isSafeInteger(id) || id < 1) return refuse(c, 404, { code: 'deck_not_found', message: 'That deck is not available.' });
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, id); } catch { return refuse(c, 404, { code: 'deck_not_found', message: 'That deck is not available.' }); }
  try { await projectOwned(c, user, Number(row.project_id)); } catch { return refuse(c, 404, { code: 'deck_not_found', message: 'That deck is not available.' }); }
  return { row };
}

const off = (c: any) => refuse(c, 503, { code: 'remote_off', message: REMOTE_OFF });

deckRemote.post('/:id{[0-9]+}/remote/pair', async (c) => {
  const user = await requireAuth(c);
  if (!c.env.DECK_REMOTE) return off(c);
  const got = await readableDeck(c, user, Number(c.req.param('id')));
  if (got instanceof Response) return got;
  const deckId = Number(got.row.id);
  const room = remoteOf(c.env, `deck:${deckId}`);
  // A code is one number among a million: claim its pointer, and draw again on the rare clash.
  for (let i = 0; i < CODE_TRIES; i++) {
    const made = (await (await call(room, '/pair', { user_id: user.id })).json()) as { code: string; expires_at: string };
    const claim = await call(remoteOf(c.env, `code:${made.code}`), '/claim', { deck_id: deckId });
    if (claim.ok) return c.json({ deck_id: deckId, code: made.code, expires_at: made.expires_at });
  }
  await call(room, '/unpair');
  return refuse(c, 503, { code: 'code_unavailable', message: 'A pairing code could not be made. Try again.' });
});

deckRemote.get('/:id{[0-9]+}/remote', async (c) => {
  const user = await requireAuth(c);
  if (!c.env.DECK_REMOTE) return off(c);
  const got = await readableDeck(c, user, Number(c.req.param('id')));
  if (got instanceof Response) return got;
  const res = await remoteOf(c.env, `deck:${Number(got.row.id)}`).fetch('https://deck-remote/state');
  const st = (await res.json().catch(() => null)) as any;
  return c.json({ deck_id: Number(got.row.id), code_live: !!st?.code_live, paired: !!st?.paired, presenting: Number(st?.presenting || 0) });
});

deckRemote.delete('/:id{[0-9]+}/remote', async (c) => {
  const user = await requireAuth(c);
  if (!c.env.DECK_REMOTE) return off(c);
  const got = await readableDeck(c, user, Number(c.req.param('id')));
  if (got instanceof Response) return got;
  await call(remoteOf(c.env, `deck:${Number(got.row.id)}`), '/unpair');
  return c.json({ ok: true, deck_id: Number(got.row.id) });
});

deckRemote.get('/:id{[0-9]+}/remote/ws', async (c) => {
  if (c.req.header('upgrade') !== 'websocket') return c.json({ error: 'Expected WebSocket upgrade' }, 426);
  if (!c.env.DECK_REMOTE) return off(c);
  const authed = await authenticateForUpgrade(c);
  if (!authed) return c.json({ error: 'Unauthorized' }, 401);
  const got = await readableDeck(c, authed, Number(c.req.param('id')));
  if (got instanceof Response) return got;
  if (!(await checkUpgradeRate(c.env, authed.id))) return c.json({ error: 'Too many WS upgrades' }, 429);
  const headers: Record<string, string> = { upgrade: 'websocket' };
  const proto = c.req.header('sec-websocket-protocol');
  if (proto) headers['sec-websocket-protocol'] = proto;
  return remoteOf(c.env, `deck:${Number(got.row.id)}`).fetch(new Request('https://deck-remote/ws', { headers }));
});

deckRemote.post('/remote/join', async (c) => {
  const user = await requireAuth(c);
  if (!c.env.DECK_REMOTE) return off(c);
  const body = (await c.req.json().catch(() => ({}))) as any;
  if (!isCode(body?.code)) return refuse(c, 400, { code: 'invalid_code', message: 'Type the six digits shown on the presenting screen.' });
  const took = (await (await call(remoteOf(c.env, `code:${body.code}`), '/take')).json().catch(() => null)) as any;
  const deckId = Number(took?.deck_id);
  if (!deckId) return refuse(c, 404, { code: 'code_not_found', message: CODE_WRONG });
  // A member who may not read the deck learns nothing: the same answer as a wrong code.
  const got = await readableDeck(c, user, deckId);
  if (got instanceof Response) return refuse(c, 404, { code: 'code_not_found', message: CODE_WRONG });
  const res = await call(remoteOf(c.env, `deck:${deckId}`), '/join', { code: body.code, user_id: user.id });
  if (!res.ok) return refuse(c, 404, { code: 'code_not_found', message: CODE_WRONG });
  const joined = (await res.json()) as { remote_id: string; expires_at: string };
  return c.json({ deck_id: deckId, remote_id: joined.remote_id, expires_at: joined.expires_at });
});

deckRemote.post('/:id{[0-9]+}/remote/step', async (c) => {
  const user = await requireAuth(c);
  if (!c.env.DECK_REMOTE) return off(c);
  const body = (await c.req.json().catch(() => ({}))) as any;
  if (!isRemoteId(body?.remote_id)) return refuse(c, 400, { code: 'invalid_remote', message: 'Pair this phone again.' });
  if (!stepOf(body?.step)) return refuse(c, 400, { code: 'invalid_step', message: 'A remote moves next, back, to the first or last card, or to a card by number.' });
  const got = await readableDeck(c, user, Number(c.req.param('id')));
  if (got instanceof Response) return got;
  const res = await call(remoteOf(c.env, `deck:${Number(got.row.id)}`), '/step', { remote_id: body.remote_id, step: body.step });
  if (res.status === 409) return refuse(c, 409, { code: 'remote_not_paired', message: 'This phone is no longer paired. Pair it again.' });
  if (!res.ok) return refuse(c, 400, { code: 'invalid_step', message: 'A remote moves next, back, to the first or last card, or to a card by number.' });
  const out = (await res.json()) as { delivered: number };
  return c.json({ ok: true, delivered: Number(out.delivered) || 0 });
});

export default deckRemote;
// Before `decks`, so its `GET /:id` can never answer `/remote`.
export const mount: RouteMount = { path: '/api/decks', router: deckRemote, before: [decks] };
