/**
 * D1579 (#3826, deck v2 E6) — `GET /api/decks/:id/card-status`: each card's
 * status and assignee on one deck version, filtered, with what is not Done.
 *
 *   GET /api/decks/:id/card-status?status=all|todo|in_progress|done&assignee=anyone|none|<user id>
 *       → { deck_id, version, tracked, filter, total, cards, not_done: { count, cards }, people }
 *
 * `cards` is exactly the cards matching both the status and the assignee
 * asked for (`services/decks/cardStatus.ts` `filterCards`), each with its
 * place, uid, title, status and assignee `{ id, name }` or null. `total` is
 * every card of the version. `not_done` is the cards whose status is To do or
 * In progress, whatever the filter: the count and titles the pre-share
 * warning ("[n] cards are not Done. Share anyway?") and the home deck card's
 * "[n] cards not Done" pill read. A deck no card of which carries a status is
 * not `tracked`, and nothing on it is "not Done".
 *
 * `people` is who a card can be assigned to: D1570's rule
 * (`services/decks/deckPeople.ts`), the people who can work on the deck.
 *
 * Status and assignee live in the version's card document (`slideModel.ts`),
 * so they are written by saving a version (`PUT /api/decks/:id`), which checks
 * each new assignee against `people` and notifies them once. This route only
 * reads. Who: whoever may read the deck (`projectOwned`, as `GET /:id`).
 * Mounted beside the other deck routes, before `decks.ts`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../services/decks/access';
import decks, { ensureSchema, getDeckRow } from './decks';
import type { RouteMount } from '../util/routeRegistry';
import { cardStates, filterCards, filterOf, isTracked, notDone } from '../services/decks/cardStatus';
import { peopleOf } from '../services/decks/deckPeople';
import { refuse } from '../util/refusal';

const deckCardStatus = new Hono<{ Bindings: Env }>();

deckCardStatus.get('/:id{[0-9]+}/card-status', async (c) => {
  const user = await requireAuth(c);
  const filter = filterOf({ status: c.req.query('status') ?? null, assignee: c.req.query('assignee') ?? null });
  if ('error' in filter) return refuse(c, 400, { code: 'invalid_filter', message: `The filter's ${filter.error}` });
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, Number(c.req.param('id'))); } catch { return c.json({ error: 'not found' }, 404); }
  try { await projectOwned(c, user, Number(row.project_id)); } catch { return c.json({ error: 'forbidden' }, 403); }

  let slides: unknown[] = [];
  try { const s = JSON.parse(row.slides || '[]'); slides = Array.isArray(s) ? s : []; } catch { slides = []; }
  const all = cardStates(slides);
  const people = await peopleOf(c.env, Number(row.project_id));
  // An assignee no longer among the people keeps their name from their account.
  const names = new Map<number, string | null>(people.map((p) => [p.id, p.name]));
  const missing = [...new Set(all.map((x) => x.assignee).filter((x): x is number => x !== null && !names.has(x)))];
  if (missing.length) {
    const rows = (await c.env.DB.prepare('SELECT id, name FROM users WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))')
      .bind(JSON.stringify(missing)).all<{ id: number; name: string | null }>()).results ?? [];
    for (const r of rows) names.set(Number(r.id), r.name ?? null);
  }
  const shape = (x: (typeof all)[number]) => ({
    index: x.index, uid: x.uid, title: x.title, status: x.status,
    assignee: x.assignee === null ? null : { id: x.assignee, name: names.get(x.assignee) ?? null },
  });
  const waiting = notDone(all);
  return c.json({
    deck_id: Number(row.id),
    version: Number(row.version),
    tracked: isTracked(slides),
    filter,
    total: all.length,
    cards: filterCards(all, filter.status, filter.assignee).map(shape),
    not_done: { count: waiting.length, cards: waiting.map((x) => ({ index: x.index, uid: x.uid, title: x.title, status: x.status })) },
    people: people.map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
  });
});

export default deckCardStatus;

export const mount: RouteMount = { path: '/api/decks', router: deckCardStatus, before: [decks] };
