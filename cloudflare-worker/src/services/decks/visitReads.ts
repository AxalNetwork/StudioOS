/**
 * D8249 (#8249, Pitch analytics PS-08 B) — seconds per card per visit on one
 * investor link: which cards each visit read, and which card held it longest.
 *
 * NO NEW STORE (migration: none). D663's `deck_view_slides` already keeps one
 * running total per view and slide place, named by card uid since D1500
 * (migration 714), so a visit's reads are its own rows. `secondsByCard` reads
 * them against the cards as the link sends them, as the link read's sum does.
 *
 * BOUNDED, NEWEST FIRST. At most `VISIT_READS_LIMIT` visits, the newest by
 * `deck_share_views.created_at` (then id). Each is `{ view_id, at, cards_read,
 * seconds, longest, cards }`; `cards` lists only the cards a heartbeat counted,
 * in the link's order, each `{ card_uid, index, title, seconds }`.
 *
 * MISSING IS NULL, NEVER 0. A visit no heartbeat timed (the reader closed the
 * tab at once, or Time per slide was off then) has `cards_read`, `seconds`,
 * `longest` and `cards` all null. With Time per slide off now, the route
 * answers `visit_reads: null` and does not call this.
 */
import { secondsByCard, type SecondsRow } from './slideAnalytics';

/** The newest visits the per-visit read covers. */
export const VISIT_READS_LIMIT = 50;

type Card = { uid?: unknown; title?: unknown };
export type VisitRead = {
  view_id: number;
  at: string;
  cards_read: number | null;
  seconds: number | null;
  longest: { card_uid: string; index: number; title: string | null; seconds: number } | null;
  cards: Array<{ card_uid: string; index: number; title: string | null; seconds: number }> | null;
};

const titleOf = (c: Card | undefined) => (typeof c?.title === 'string' && c.title.trim() ? c.title.trim().slice(0, 200) : null);

/**
 * Each visit's reads. `views` may come in any order; the answer is newest
 * first and at most `limit` long. `rows` are the heartbeat rows of those views.
 */
export function visitReads(cards: Card[], views: Array<{ id: number; created_at: string }>, rows: SecondsRow[], limit = VISIT_READS_LIMIT): VisitRead[] {
  const byView = new Map<number, SecondsRow[]>();
  for (const r of rows) {
    const id = Number(r.view_id);
    if (!byView.has(id)) byView.set(id, []);
    byView.get(id)!.push(r);
  }
  const newest = [...views].filter((v) => v?.created_at)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : Number(b.id) - Number(a.id)))
    .slice(0, Math.max(0, limit));
  return newest.map((v) => {
    const by = secondsByCard(cards, byView.get(Number(v.id)) ?? []);
    const read: NonNullable<VisitRead['cards']> = [];
    cards.forEach((c, index) => {
      const uid = typeof c?.uid === 'string' ? c.uid : null;
      // `secondsByCard` keeps only cards with counted seconds (> 0), so a 0 s heartbeat is not a read.
      const s = uid ? by.get(uid) : undefined;
      if (uid && s != null) read.push({ card_uid: uid, index, title: titleOf(c), seconds: s });
    });
    if (!read.length) return { view_id: Number(v.id), at: v.created_at, cards_read: null, seconds: null, longest: null, cards: null };
    let longest = read[0];
    for (const c of read) if (c.seconds > longest.seconds) longest = c;
    return {
      view_id: Number(v.id),
      at: v.created_at,
      cards_read: read.length,
      seconds: read.reduce((n, c) => n + c.seconds, 0),
      longest,
      cards: read,
    };
  });
}
