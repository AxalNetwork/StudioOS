/**
 * D1573 (#3820, deck builder v2 D12) — per-slide investor analytics: one
 * link's seconds per card, its visit timeline, and the link's "Time per
 * slide" consent (PD-8 · pd37 "Viewer analytics", pd35's Analytics cell).
 *
 * NO NEW STORE (migration: none). The seconds are D663's `deck_view_slides`,
 * written by the share reader's heartbeat and named by card uid since D1500
 * (migration 714). The consent is one key on the link's own `include_json`,
 * beside D1564's `publish`: `time_per_slide: false` turns it off. A link
 * without the key (every link made before D1573, and a new one by default,
 * as pd35's row editor draws it) has it on.
 *
 * CONSENT OFF STORES COUNTS ONLY. The share read still writes the view row
 * (that is the visit count), and the heartbeat writes nothing more: no read
 * seconds, no seconds per card (`routes/decks.ts`). So the read below answers
 * `cards: null` and `read_seconds: null` for it, never a zero.
 *
 * THE TIMELINE. One event per thing that happened on the link, oldest first,
 * each `{ kind, at, view_id }`:
 *   opened        the link's first view (`deck_share_views.created_at`);
 *   nda_accepted  the first NDA acceptance on the link (`deck_share_conversions`);
 *   reached_ask   a view that counted seconds on the version's ask card, at
 *                 that card's last counted heartbeat in the view (the store
 *                 keeps no first-reached time, so this is the latest it can be);
 *   revisited     every later view.
 * The kinds are what #3815's signals read (first view, revisit, reached the
 * ask); a revisit after 48 h is a `revisited` event 48 h past the one before.
 *
 * Missing is null, never 0: a card no heartbeat counted reads null, and a
 * link nobody timed has no most-read card.
 */

/** The consent's key on `include_json`. */
export const TIME_PER_SLIDE_KEY = 'time_per_slide';
export const TIMELINE_KINDS = ['opened', 'nda_accepted', 'reached_ask', 'revisited'] as const;
export type TimelineKind = typeof TIMELINE_KINDS[number];
export type TimelineEvent = { kind: TimelineKind; at: string; view_id: number | null };

function objectOf(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...(raw as Record<string, unknown>) };
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

/** Whether a link counts time per slide: on unless its `include_json` says `time_per_slide: false`. */
export const timePerSlideOn = (includeJson: unknown): boolean => objectOf(includeJson)[TIME_PER_SLIDE_KEY] !== false;

/** `include_json` with the consent set; every other key (what is included, D1564's publish) is kept. */
export function withTimePerSlide(includeJson: unknown, on: boolean): string {
  const o = objectOf(includeJson);
  o[TIME_PER_SLIDE_KEY] = on === true;
  return JSON.stringify(o);
}

type Card = { uid?: unknown; title?: unknown };
export type SecondsRow = { view_id: number; slide_index: number; card_uid: string | null; seconds: number; updated_at: string | null };

/**
 * Seconds per card uid over a link's rows. A row named by uid counts for that
 * card; a row written before 714 named it by place, and is read against the
 * cards as the link sends them. A uid the link does not send is dropped.
 */
export function secondsByCard(cards: Card[], rows: SecondsRow[]): Map<string, number> {
  const uids = cards.map((c) => (typeof c?.uid === 'string' ? c.uid : null));
  const known = new Set(uids.filter(Boolean) as string[]);
  const out = new Map<string, number>();
  for (const r of rows) {
    const uid = r.card_uid ?? uids[Number(r.slide_index)] ?? null;
    const s = Math.max(0, Math.trunc(Number(r.seconds) || 0));
    if (!uid || !known.has(uid) || s <= 0) continue;
    out.set(uid, (out.get(uid) ?? 0) + s);
  }
  return out;
}

/** The link's cards with their seconds (null when none was counted), and the most read one. */
export function cardsWithSeconds(cards: Card[], rows: SecondsRow[]) {
  const by = secondsByCard(cards, rows);
  const list = cards.map((c, index) => {
    const uid = typeof c?.uid === 'string' ? c.uid : `c${index + 1}`;
    return { card_uid: uid, index, title: typeof c?.title === 'string' && c.title.trim() ? c.title.trim().slice(0, 200) : null, seconds: by.get(uid) ?? null };
  });
  let most: (typeof list)[number] | null = null;
  for (const c of list) if (c.seconds != null && (most == null || c.seconds > (most.seconds as number))) most = c;
  return { cards: list, most_read: most };
}

const t = (v: string) => Date.parse(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? '' : 'Z'));

/**
 * The visit timeline from a link's views (oldest first), its first NDA
 * acceptance and the views that reached the ask. Sorted by time; a tie keeps
 * the order a reader lives it (opened, the NDA, the ask, a revisit).
 */
export function visitTimeline(a: {
  views: Array<{ id: number; created_at: string }>;
  nda_accepted_at: string | null;
  reached_ask: Array<{ view_id: number; at: string }>;
}): TimelineEvent[] {
  const views = [...a.views].filter((v) => v?.created_at).sort((x, y) => t(x.created_at) - t(y.created_at) || x.id - y.id);
  const out: TimelineEvent[] = views.map((v, i) => ({ kind: i === 0 ? 'opened' : 'revisited', at: v.created_at, view_id: Number(v.id) }));
  if (a.nda_accepted_at) out.push({ kind: 'nda_accepted', at: a.nda_accepted_at, view_id: null });
  for (const r of a.reached_ask) if (r?.at) out.push({ kind: 'reached_ask', at: r.at, view_id: Number(r.view_id) });
  const rank: Record<TimelineKind, number> = { opened: 0, nda_accepted: 1, reached_ask: 2, revisited: 3 };
  return out.sort((x, y) => t(x.at) - t(y.at) || rank[x.kind] - rank[y.kind]);
}
