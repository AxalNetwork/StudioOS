/**
 * D1573 (#3820, deck builder v2 D12) — per-slide investor analytics for one investor link (PD-8 · pd37).
 *
 *   GET /api/decks/:id/investor-links/:shareId/analytics       one link's views, seconds per card, most-read card and visit timeline
 *   PUT /api/decks/:id/investor-links/:shareId/time-per-slide  { on: true | false } → { ok, link }: the link's "Time per slide" consent
 *
 * NO NEW STORE (migration: none). The seconds are D663's `deck_view_slides`,
 * keyed by card uid (D1500, migration 714); the consent is the link's own
 * `include_json` key (`services/decks/slideAnalytics.ts`). With it off the
 * share reader's heartbeat stores nothing past the visit count
 * (`routes/decks.ts`), and this read answers `cards: null`.
 *
 * THE READ. `{ deck_id, link_id, investor, nda, status, withdrawn_at,
 * time_per_slide, views, last_viewed_at, read_seconds, cards, most_read,
 * ask_card_uid, timeline }`. `cards` are the link's own, in the order its
 * reader sees them (a variant's order, D1565), each `{ card_uid, index, title,
 * seconds }`; `seconds` is null for a card no heartbeat counted. Missing is
 * null, never 0. A withdrawn link keeps everything read so far.
 *
 * WHO. `projectOwned`, as `GET /:id/engagement`: the read for the venture's
 * readers, the consent with `write: true`. The link must be one of this
 * deck's investor links, or 404.
 *
 * Mounts itself (#4105), with no `before`: no `decks` route answers these
 * paths (its `GET /:id` is one segment), so it takes the registry's slot, as
 * `deck_update_reuse.ts` does.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { auditDeckWrite, linkSentCards } from './decks';
import { deckFor, rowsOf } from './deck_investor_links';
import type { RouteMount } from '../util/routeRegistry';
import { askCardIndex } from '../services/decks/shareAnalytics';
import { cardsWithSeconds, timePerSlideOn, visitTimeline, withTimePerSlide, type SecondsRow } from '../services/decks/slideAnalytics';

const deckSlideAnalytics = new Hono<{ Bindings: Env }>();

type Row = Awaited<ReturnType<typeof rowsOf>>[number];
const shareIdOf = (c: any) => Number(c.req.param('shareId'));

/** One link's pd37 sheet. */
export async function linkSlideAnalytics(env: Env, deckRow: any, row: Row) {
  const deckId = Number(deckRow.id);
  const link = await env.DB.prepare('SELECT id, include_json, variant_id FROM pitch_deck_share_tokens WHERE id = ? AND deck_id = ?')
    .bind(row.id, deckId).first<{ id: number; include_json: string | null; variant_id: number | null }>();
  const timed = timePerSlideOn(link?.include_json);
  const views = (await env.DB.prepare(
    'SELECT id, created_at FROM deck_share_views WHERE share_token_id = ? AND deck_id = ? ORDER BY created_at, id LIMIT 500',
  ).bind(row.id, deckId).all<{ id: number; created_at: string }>()).results || [];
  const cards = await linkSentCards(env, deckRow, link);
  const askAt = askCardIndex(cards);
  const askUid = askAt == null ? null : (typeof cards[askAt]?.uid === 'string' ? cards[askAt].uid : null);

  let seconds: SecondsRow[] = [];
  if (timed) {
    seconds = (await env.DB.prepare(
      `SELECT s.view_id, s.slide_index, s.card_uid, s.seconds, s.updated_at
         FROM deck_view_slides s JOIN deck_share_views v ON v.id = s.view_id
        WHERE v.share_token_id = ? AND v.deck_id = ? ORDER BY s.view_id, s.slide_index LIMIT 20000`,
    ).bind(row.id, deckId).all<SecondsRow>()).results || [];
  }
  // A view reached the ask when a heartbeat counted seconds on the ask card (by uid, or by place before 714).
  const reached = new Map<number, string>();
  if (askUid) {
    for (const s of seconds) {
      const uid = s.card_uid ?? (cards[Number(s.slide_index)]?.uid ?? null);
      if (uid !== askUid || !(Number(s.seconds) > 0) || !s.updated_at) continue;
      reached.set(Number(s.view_id), s.updated_at);
    }
  }
  const per = timed ? cardsWithSeconds(cards, seconds) : null;
  return {
    deck_id: deckId,
    link_id: row.id,
    investor: row.investor,
    nda: row.nda,
    status: row.status,
    withdrawn_at: row.withdrawn_at,
    time_per_slide: timed,
    views: row.analytics.views,
    last_viewed_at: row.analytics.last_viewed_at,
    read_seconds: row.analytics.read_seconds,
    cards: per ? per.cards : null,
    most_read: per ? per.most_read : null,
    ask_card_uid: askUid,
    timeline: visitTimeline({
      views,
      nda_accepted_at: row.nda.state === 'accepted' ? row.nda.accepted_at : null,
      reached_ask: [...reached].map(([view_id, at]) => ({ view_id, at })),
    }),
  };
}

deckSlideAnalytics.get('/:id{[0-9]+}/investor-links/:shareId{[0-9]+}/analytics', async (c) => {
  const user = await requireAuth(c);
  const got = await deckFor(c, user, false);
  if ('refused' in got) return got.refused;
  const row = (await rowsOf(c.env, Number(got.row.id))).find((r) => r.id === shareIdOf(c));
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(await linkSlideAnalytics(c.env, got.row, row));
});

deckSlideAnalytics.put('/:id{[0-9]+}/investor-links/:shareId{[0-9]+}/time-per-slide', async (c) => {
  const user = await requireAuth(c);
  const got = await deckFor(c, user, true);
  if ('refused' in got) return got.refused;
  const deckId = Number(got.row.id);
  const link = await c.env.DB.prepare(
    'SELECT id, include_json FROM pitch_deck_share_tokens WHERE id = ? AND deck_id = ? AND (prospect_id IS NOT NULL OR investor_label IS NOT NULL)',
  ).bind(shareIdOf(c), deckId).first<{ id: number; include_json: string | null }>();
  if (!link) return c.json({ error: 'not found' }, 404);
  const b = await c.req.json<any>().catch(() => null);
  if (typeof b?.on !== 'boolean') return refuse(c, 422, { code: 'on_missing', message: 'Say whether to count time per slide: on true or false.' });
  await c.env.DB.prepare('UPDATE pitch_deck_share_tokens SET include_json = ? WHERE id = ?').bind(withTimePerSlide(link.include_json, b.on), link.id).run();
  // Turning it off stops what is stored from now on; what was counted so far is kept, and shown again if it is turned back on.
  await auditDeckWrite(c, user, Number(got.row.project_id), b.on ? 'deck_link_time_per_slide_on' : 'deck_link_time_per_slide_off',
    b.on ? 'Time per slide turned on for a share link' : 'Time per slide turned off for a share link: visit counts only');
  const row = (await rowsOf(c.env, deckId)).find((r) => r.id === Number(link.id)) ?? null;
  return c.json({ ok: true, link: row });
});

export default deckSlideAnalytics;

export const mount: RouteMount = { path: '/api/decks', router: deckSlideAnalytics };
