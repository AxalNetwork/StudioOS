/**
 * D4254 P4 (#4272) — Share & analytics (ps7) for a venture's investor links,
 * across its deck versions: views per day split by NDA-gated against open
 * links, the two funnels, and where readers drop off on two versions.
 *
 *   days      every UTC date in the range, oldest first: `{ date, nda, open,
 *             first_nda, first_open }`. A view is a `deck_share_views` row on
 *             an investor link (a link with a prospect or an investor label).
 *             A first view is a link's earliest view. A day with no view is a
 *             real 0: views are counted, not sampled.
 *   funnels   `{ nda, open }`, one per NDA class, over the investor links sent
 *             in the range: sent → opened → NDA shown → accepted → reached the
 *             ask. An NDA link's gate shows on every open, so NDA shown is
 *             opened; an open link has no NDA step, so both are null there.
 *             Reached the ask is null when no link of the class sends an ask
 *             card or counts time per slide: it cannot be known.
 *   dropoff   `{ current, previous }`: seconds per card on a version and the
 *             one before it, with the share of readers who stop after each
 *             card. Seconds nobody counted are null, never 0.
 *
 * Bounded by the date range (at most 90 days), not by a row cap. Counts only:
 * no hash, email or reader identity leaves this read.
 */
import type { Env } from '../../types';
import { askCardIndex } from './shareAnalytics';
import { timePerSlideOn } from './slideAnalytics';

export const MAX_DAYS = 90;
export const DEFAULT_DAYS = 30;
export const NDA_FILTERS = ['all', 'yes', 'no'] as const;
export type NdaFilter = typeof NDA_FILTERS[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

export type RangeError = { error: 'bad_date' | 'from_after_to' | 'range_too_long' | 'bad_nda' | 'bad_version'; message: string };
export type DailyQuery = { from: string; to: string; nda: NdaFilter; version: number | null };

/** The query, or why it is refused. Default: the 30 days ending today (UTC). */
export function readDailyQuery(q: { from?: string; to?: string; nda?: string; version?: string }, today: string): DailyQuery | RangeError {
  const to = q.to ?? today;
  const from = q.from ?? iso(dayMs(to) - (DEFAULT_DAYS - 1) * DAY_MS);
  for (const d of [from, to]) {
    if (!DATE_RE.test(d) || Number.isNaN(dayMs(d)) || iso(dayMs(d)) !== d) return { error: 'bad_date', message: 'Give dates as YYYY-MM-DD.' };
  }
  if (dayMs(from) > dayMs(to)) return { error: 'from_after_to', message: 'The start date is after the end date.' };
  if ((dayMs(to) - dayMs(from)) / DAY_MS + 1 > MAX_DAYS) return { error: 'range_too_long', message: `Pick at most ${MAX_DAYS} days.` };
  const nda = (q.nda ?? 'all') as NdaFilter;
  if (!NDA_FILTERS.includes(nda)) return { error: 'bad_nda', message: 'nda is all, yes or no.' };
  let version: number | null = null;
  if (q.version != null && q.version !== '') {
    version = Number(q.version);
    if (!Number.isSafeInteger(version) || version < 1) return { error: 'bad_version', message: 'There is no such version.' };
  }
  return { from, to, nda, version };
}

/** Every date from `from` to `to`, inclusive. */
export function datesIn(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = dayMs(from); t <= dayMs(to); t += DAY_MS) out.push(iso(t));
  return out;
}

export type DayRow = { d: string; nda_required: number | null; n: number; first: number };
export type Day = { date: string; nda: number; open: number; first_nda: number; first_open: number };

/** The per-day series, every date present; the NDA filter leaves the other class at 0 views shown. */
export function daySeries(rows: DayRow[], q: DailyQuery): Day[] {
  const by = new Map<string, Day>(datesIn(q.from, q.to).map((date) => [date, { date, nda: 0, open: 0, first_nda: 0, first_open: 0 }]));
  for (const r of rows) {
    const day = by.get(String(r.d));
    if (!day) continue;
    const gated = Number(r.nda_required) === 1;
    if ((q.nda === 'yes' && !gated) || (q.nda === 'no' && gated)) continue;
    if (gated) { day.nda += Number(r.n) || 0; day.first_nda += Number(r.first) || 0; } else { day.open += Number(r.n) || 0; day.first_open += Number(r.first) || 0; }
  }
  return [...by.values()];
}

export type LinkFacts = { nda_required: boolean; opened: boolean; accepted: boolean; timed: boolean; ask_index: number | null; furthest: number | null };
export type Funnel = { sent: number; opened: number; nda_shown: number | null; accepted: number | null; reached_ask: number | null };

/** One class's funnel over its links. */
export function funnelOf(links: LinkFacts[], gated: boolean): Funnel {
  const mine = links.filter((l) => l.nda_required === gated);
  const opened = mine.filter((l) => l.opened).length;
  // Reached the ask is known only for a link that sends an ask card and counts time per slide.
  const knowable = mine.filter((l) => l.ask_index != null && l.timed);
  return {
    sent: mine.length,
    opened,
    nda_shown: gated ? opened : null,
    accepted: gated ? mine.filter((l) => l.accepted).length : null,
    reached_ask: knowable.length ? knowable.filter((l) => l.furthest != null && l.furthest >= (l.ask_index as number)).length : null,
  };
}

export type ViewSeconds = { view_id: number; index: number; seconds: number };
export type DropCard = { index: number; card_uid: string | null; title: string | null; seconds: number | null; drop_pct: number | null };

/**
 * Seconds per card on one version, and the share of readers who stop after
 * each card: of the views that read card i (their furthest card is i or later),
 * the share whose furthest is i. The last card, and a card nobody reached, has
 * no drop. With no timed view at all, every value is null.
 */
export function dropOff(cards: Array<{ uid?: unknown; title?: unknown }>, rows: ViewSeconds[]): DropCard[] {
  const secs = new Map<number, number>();
  const furthest = new Map<number, number>();
  for (const r of rows) {
    const s = Math.max(0, Math.trunc(Number(r.seconds) || 0));
    if (s <= 0 || r.index < 0 || r.index >= cards.length) continue;
    secs.set(r.index, (secs.get(r.index) ?? 0) + s);
    furthest.set(r.view_id, Math.max(furthest.get(r.view_id) ?? -1, r.index));
  }
  const reach = cards.map((_, i) => [...furthest.values()].filter((f) => f >= i).length);
  return cards.map((c, i) => ({
    index: i,
    card_uid: typeof c?.uid === 'string' ? c.uid : null,
    title: typeof c?.title === 'string' && c.title.trim() ? c.title.trim().slice(0, 200) : null,
    seconds: secs.get(i) ?? null,
    drop_pct: i < cards.length - 1 && reach[i] > 0 ? Math.round(100 * (1 - reach[i + 1] / reach[i])) : null,
  }));
}

type DeckRow = { id: number; version: number; slides: string | null };
const slidesOf = (d: DeckRow | undefined): any[] => {
  try { const s = JSON.parse(d?.slides || '[]'); return Array.isArray(s) ? s : []; } catch { return []; }
};

/** The whole read for one venture. `null` values are drawn "Not recorded". */
export async function shareDaily(env: Env, projectId: number, q: DailyQuery) {
  const decks = ((await env.DB.prepare('SELECT id, version, slides FROM pitch_decks WHERE project_id = ? ORDER BY version DESC')
    .bind(projectId).all<DeckRow>()).results || []).map((d) => ({ ...d, id: Number(d.id), version: Number(d.version) }));
  const byId = new Map(decks.map((d) => [d.id, d]));

  const dayRows = (await env.DB.prepare(
    `SELECT date(v.created_at) AS d, t.nda_required AS nda_required, COUNT(*) AS n,
            SUM(CASE WHEN v.id = (SELECT MIN(v2.id) FROM deck_share_views v2 WHERE v2.share_token_id = v.share_token_id) THEN 1 ELSE 0 END) AS first
       FROM deck_share_views v
       JOIN pitch_deck_share_tokens t ON t.id = v.share_token_id
       JOIN pitch_decks d ON d.id = v.deck_id
      WHERE d.project_id = ?1 AND (?2 IS NULL OR d.version = ?2)
        AND (t.prospect_id IS NOT NULL OR t.investor_label IS NOT NULL)
        AND date(v.created_at) BETWEEN ?3 AND ?4
      GROUP BY d, t.nda_required`,
  ).bind(projectId, q.version, q.from, q.to).all<DayRow>()).results || [];

  // The links sent in the range, each with what its readers did (at any time since).
  const links = (await env.DB.prepare(
    `SELECT t.id, t.deck_id, t.nda_required, t.include_json,
            EXISTS (SELECT 1 FROM deck_share_views v WHERE v.share_token_id = t.id) AS opened
       FROM pitch_deck_share_tokens t JOIN pitch_decks d ON d.id = t.deck_id
      WHERE d.project_id = ?1 AND (?2 IS NULL OR d.version = ?2)
        AND (t.prospect_id IS NOT NULL OR t.investor_label IS NOT NULL)
        AND date(t.created_at) BETWEEN ?3 AND ?4`,
  ).bind(projectId, q.version, q.from, q.to).all<{ id: number; deck_id: number; nda_required: number | null; include_json: string | null; opened: number }>()).results || [];
  const ids = JSON.stringify(links.map((l) => Number(l.id)));
  const accepted = new Set<number>();
  try {
    const a = await env.DB.prepare(
      `SELECT DISTINCT share_token_id AS id FROM deck_share_conversions
        WHERE type = 'nda_signed' AND share_token_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?1))`,
    ).bind(ids).all<{ id: number }>();
    for (const r of a.results || []) accepted.add(Number(r.id));
  } catch { /* no conversion table: nobody has accepted */ }
  const furthestBy = new Map<number, number>();
  const fq = await env.DB.prepare(
    `SELECT v.share_token_id AS id, MAX(s.slide_index) AS furthest
       FROM deck_share_views v JOIN deck_view_slides s ON s.view_id = v.id
      WHERE s.seconds > 0 AND v.share_token_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?1))
      GROUP BY v.share_token_id`,
  ).bind(ids).all<{ id: number; furthest: number }>();
  for (const r of fq.results || []) furthestBy.set(Number(r.id), Number(r.furthest));
  const facts: LinkFacts[] = links.map((l) => ({
    nda_required: Number(l.nda_required) === 1,
    opened: Number(l.opened) === 1,
    accepted: accepted.has(Number(l.id)),
    timed: timePerSlideOn(l.include_json),
    ask_index: askCardIndex(slidesOf(byId.get(Number(l.deck_id)))),
    furthest: furthestBy.get(Number(l.id)) ?? null,
  }));

  // Drop-off: the chosen version (or the newest) and the one before it.
  const at = q.version == null ? 0 : decks.findIndex((d) => d.version === q.version);
  const pair = at < 0 ? [] : decks.slice(at, at + 2);
  const dropFor = async (d: DeckRow) => {
    const cards = slidesOf(d);
    const uids = cards.map((c: any) => (typeof c?.uid === 'string' ? c.uid : null));
    const rows = ((await env.DB.prepare(
      `SELECT s.view_id, s.slide_index, s.card_uid, s.seconds
         FROM deck_view_slides s JOIN deck_share_views v ON v.id = s.view_id
         JOIN pitch_deck_share_tokens t ON t.id = v.share_token_id
        WHERE v.deck_id = ?1 AND (t.prospect_id IS NOT NULL OR t.investor_label IS NOT NULL)
          AND date(v.created_at) BETWEEN ?2 AND ?3
        LIMIT 50000`,
    ).bind(d.id, q.from, q.to).all<{ view_id: number; slide_index: number; card_uid: string | null; seconds: number }>()).results || [])
      // A row named by uid counts for that card; one written before migration 714 named it by place.
      .map((r) => ({ view_id: Number(r.view_id), index: r.card_uid ? uids.indexOf(r.card_uid) : Number(r.slide_index), seconds: Number(r.seconds) }));
    return { version: d.version, deck_id: d.id, cards: dropOff(cards, rows) };
  };

  return {
    project_id: projectId,
    from: q.from,
    to: q.to,
    nda: q.nda,
    version: q.version,
    versions: decks.map((d) => ({ version: d.version, deck_id: d.id })),
    days: daySeries(dayRows, q),
    funnels: { nda: funnelOf(facts, true), open: funnelOf(facts, false) },
    dropoff: { current: pair[0] ? await dropFor(pair[0]) : null, previous: pair[1] ? await dropFor(pair[1]) : null },
  };
}
