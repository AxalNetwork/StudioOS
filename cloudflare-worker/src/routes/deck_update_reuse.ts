/**
 * D1584 (#3831, deck builder v2 F5) — investor-update reuse
 * (`services/decks/updateReuse.ts`).
 *
 *   GET /api/decks/:id/derive-update
 *       → { deck_id, update: { uid, title, sent_at, period_start, period_end } | null,
 *           proposals: [Proposal], unchanged, not_in_update: [{ card, block_id, label, reason }], reason? }
 *       The version's bound metric tiles refreshed from the latest investor
 *       update the venture SENT (`portfolio_updates.sent_at`). A proposal: the
 *       editor's Accept places it on the card, held until a version is saved,
 *       as Refresh from records is. This route writes nothing.
 *   GET /api/decks/:id/changes-since
 *       → { since: { deck_id, version }, current: { deck_id, version } | null, latest, changes: { figures, cards } }
 *       What changed between this version (the one an investor's link froze)
 *       and the deck's current version, for pd35's "Changes since vN".
 *
 * WHO. `projectOwned`, as every deck route. derive-update needs write access
 * (it proposes an edit to the deck); changes-since needs read access, as the
 * investor-links table it draws on.
 *
 * NO UPDATE YET. A venture that has sent no update gets `update: null`, no
 * proposal, and the reason in words; never a deck refreshed to zeros.
 *
 * Mounted through the route registry (#4105, `mount` below). `decks.ts` has no
 * route that answers `/:id/derive-update` or `/:id/changes-since`, so it needs no
 * `before`.
 * All SQL is bound.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { projectOwned } from '../services/decks/access';
import { ensureSchema, getDeckRow } from './decks';
import { updateFigures } from './portfolio_updates';
import { changesSince, deriveFromUpdate, type LatestUpdate } from '../services/decks/updateReuse';

const r = new Hono<{ Bindings: Env }>();

export const NO_UPDATE = 'No investor update has been sent yet. Send one from Grow › Investor updates, then refresh from it.';

const slidesOf = (row: any): unknown[] => {
  try {
    const s = typeof row?.slides === 'string' ? JSON.parse(row.slides || '[]') : row?.slides;
    return Array.isArray(s) ? s : [];
  } catch { return []; }
};

/** The deck row and its access, or the response that refuses it. */
async function deckFor(c: any, write: boolean): Promise<{ row: any } | { refused: Response }> {
  const user = await requireAuth(c);
  const deckId = Number(c.req.param('id'));
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, deckId); } catch { return { refused: c.json({ error: 'not found' }, 404) }; }
  try { await projectOwned(c, user, Number(row.project_id), write ? { write: true } : {}); } catch (e: any) {
    return { refused: e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403) };
  }
  return { row };
}

/** The latest update the venture sent, with its figures; null when none was sent. */
export async function latestSentUpdate(env: Env, projectId: number): Promise<LatestUpdate | null> {
  const u = await env.DB.prepare(
    `SELECT uid, title, sent_at, period_start, period_end, kpis_json, metrics_json
       FROM portfolio_updates
      WHERE project_id = ? AND sent_at IS NOT NULL
      ORDER BY sent_at DESC, id DESC LIMIT 1`,
  ).bind(projectId).first<{ uid: string; title: string; sent_at: string | null; period_start: string | null; period_end: string | null; kpis_json: string | null; metrics_json: string | null }>();
  if (!u) return null;
  return {
    uid: u.uid, title: u.title, sent_at: u.sent_at, period_start: u.period_start, period_end: u.period_end,
    figures: updateFigures(u).figures,
  };
}

r.get('/:id{[0-9]+}/derive-update', async (c) => {
  const got = await deckFor(c, true);
  if ('refused' in got) return got.refused;
  const deckId = Number(got.row.id);
  const update = await latestSentUpdate(c.env, Number(got.row.project_id));
  if (!update) return c.json({ deck_id: deckId, update: null, proposals: [], unchanged: 0, not_in_update: [], reason: NO_UPDATE });
  const derived = deriveFromUpdate(slidesOf(got.row), update);
  const head = { uid: update.uid, title: update.title, sent_at: update.sent_at, period_start: update.period_start, period_end: update.period_end };
  return c.json({ deck_id: deckId, update: head, ...derived });
});

r.get('/:id{[0-9]+}/changes-since', async (c) => {
  const got = await deckFor(c, false);
  if ('refused' in got) return got.refused;
  const since = { deck_id: Number(got.row.id), version: Number(got.row.version) };
  const cur = await c.env.DB.prepare('SELECT id, version, slides FROM pitch_decks WHERE project_id = ? AND is_current = 1 ORDER BY version DESC LIMIT 1')
    .bind(Number(got.row.project_id)).first<{ id: number; version: number; slides: string | null }>();
  if (!cur) return c.json({ since, current: null, latest: true, changes: { figures: [], cards: { before: slidesOf(got.row).length, after: slidesOf(got.row).length } } });
  const current = { deck_id: Number(cur.id), version: Number(cur.version) };
  const latest = current.deck_id === since.deck_id;
  const changes = latest
    ? { figures: [], cards: { before: slidesOf(got.row).length, after: slidesOf(got.row).length } }
    : changesSince(slidesOf(got.row), slidesOf(cur));
  return c.json({ since, current, latest, changes });
});

export default r;

/** #4105: `/api/decks`, in the registry's slot; no `decks` route answers these two paths. */
export const mount: RouteMount = { path: '/api/decks', router: r };
