/**
 * D902 (#2681) — Share & analytics (PD19) for one deck version, added to
 * `GET /api/decks/:id/engagement`. A version is one `pitch_decks` row, and a
 * link is frozen to one version, so everything here is that version's.
 *
 *   viewers           one per browser: the view's `ip_hash` and
 *                     `ua_fingerprint` together, as the studio counts them.
 *   median_seconds    the median of each viewer's total read time over every
 *                     view of the version (not a page of them). Null when
 *                     nobody has opened a link to it.
 *   cards             seconds per card on this version, from
 *                     `deck_view_slides`; `previous` is the same for the
 *                     version before it, so the chart can draw it dotted. The
 *                     Raise module's card sums every version together; this
 *                     does not.
 *   reached_ask       viewers whose furthest card read is the ask card or
 *                     past it. The ask card is found in the version's own
 *                     cards; a version with none says so (`recorded: false`).
 *   links             per link: the investor, its settings, NDA signatures.
 *
 * Counts only. No hash leaves this read: a viewer is a count.
 */
import type { Env } from '../../types';
import { parseShareInclude, type ShareInclude } from './shareInclude';

export const NO_ASK_CARD = 'This version has no ask card, so how many reached it is not known.';

const n = (v: unknown) => Math.max(0, Math.trunc(Number(v) || 0));

/** The index of the version's ask card: the first whose template, title or fields name the ask. */
export function askCardIndex(slides: unknown): number | null {
  if (!Array.isArray(slides)) return null;
  const i = slides.findIndex((s: any) => {
    if (!s || typeof s !== 'object') return false;
    if (/(^|[_-])ask([_-]|$)/i.test(String(s.spec_id || ''))) return true;
    if (/^(the\s+)?ask\b/i.test(String(s.title || '').trim())) return true;
    return Array.isArray(s.fields) && s.fields.some((f: any) => /^ask_/.test(String(f?.key || '')));
  });
  return i < 0 ? null : i;
}

/** The median of whole seconds; null for none. */
export function medianSeconds(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

async function cardSeconds(env: Env, deckId: number): Promise<Array<{ index: number; seconds: number }>> {
  const q = await env.DB.prepare(
    `SELECT s.slide_index AS idx, SUM(s.seconds) AS secs
       FROM deck_view_slides s JOIN deck_share_views v ON v.id = s.view_id
      WHERE v.deck_id = ?
      GROUP BY s.slide_index ORDER BY s.slide_index`,
  ).bind(deckId).all<{ idx: number; secs: number }>();
  return (q.results || []).map((r) => ({ index: n(r.idx), seconds: n(r.secs) }));
}

export type LinkAnalytics = {
  investor: string | null;
  allow_download: boolean;
  allow_forwarding: boolean;
  nda_required: boolean;
  include: ShareInclude;
  nda_signed: number;
};

export async function shareAnalytics(env: Env, deck: { id: number; project_id: number; version: number; slides: string | null }) {
  const viewers = await env.DB.prepare(
    `SELECT COALESCE(ip_hash, '') || '|' || COALESCE(ua_fingerprint, '') AS who,
            SUM(read_seconds) AS secs
       FROM deck_share_views WHERE deck_id = ? GROUP BY who`,
  ).bind(deck.id).all<{ who: string; secs: number }>();
  const rows = viewers.results || [];
  const median = medianSeconds(rows.map((r) => n(r.secs)));

  let slides: unknown = [];
  try { slides = JSON.parse(deck.slides || '[]'); } catch { slides = []; }
  const askIndex = askCardIndex(slides);
  let reached: { recorded: true; ask_index: number; viewers: number } | { recorded: false; reason: string };
  if (askIndex == null) {
    reached = { recorded: false, reason: NO_ASK_CARD };
  } else {
    const r = await env.DB.prepare(
      `SELECT COUNT(DISTINCT who) AS n FROM (
         SELECT COALESCE(v.ip_hash, '') || '|' || COALESCE(v.ua_fingerprint, '') AS who, MAX(s.slide_index) AS furthest
           FROM deck_share_views v JOIN deck_view_slides s ON s.view_id = v.id
          WHERE v.deck_id = ? AND s.seconds > 0
          GROUP BY v.id
       ) WHERE furthest >= ?`,
    ).bind(deck.id, askIndex).first<{ n: number }>();
    reached = { recorded: true, ask_index: askIndex, viewers: n(r?.n) };
  }

  const prev = await env.DB.prepare(
    'SELECT id, version FROM pitch_decks WHERE project_id = ? AND version < ? ORDER BY version DESC LIMIT 1',
  ).bind(deck.project_id, deck.version).first<{ id: number; version: number }>();

  const links = new Map<number, LinkAnalytics>();
  const lq = await env.DB.prepare(
    `SELECT t.id, t.investor_label, COALESCE(NULLIF(p.firm, ''), p.name) AS prospect,
            t.allow_download, t.allow_forwarding, t.nda_required, t.include_json
       FROM pitch_deck_share_tokens t LEFT JOIN raise_prospects p ON p.id = t.prospect_id
      WHERE t.deck_id = ?`,
  ).bind(deck.id).all<any>();
  const signed = new Map<number, number>();
  try {
    const sq = await env.DB.prepare(
      `SELECT share_token_id AS id, COUNT(DISTINCT COALESCE(user_id, -id)) AS n
         FROM deck_share_conversions WHERE deck_id = ? AND type = 'nda_signed' GROUP BY share_token_id`,
    ).bind(deck.id).all<{ id: number; n: number }>();
    for (const r of sq.results || []) signed.set(Number(r.id), n(r.n));
  } catch { /* no conversion table yet: nobody has signed */ }
  for (const r of lq.results || []) {
    links.set(Number(r.id), {
      investor: r.prospect ? String(r.prospect) : r.investor_label ? String(r.investor_label) : null,
      allow_download: Number(r.allow_download ?? 1) === 1,
      allow_forwarding: Number(r.allow_forwarding ?? 1) === 1,
      nda_required: Number(r.nda_required ?? 0) === 1,
      include: parseShareInclude(r.include_json),
      nda_signed: signed.get(Number(r.id)) ?? 0,
    });
  }

  return {
    viewers: rows.length,
    median_seconds_per_viewer: median,
    cards: { version: Number(deck.version), seconds: await cardSeconds(env, deck.id) },
    previous: prev ? { version: Number(prev.version), deck_id: Number(prev.id), seconds: await cardSeconds(env, Number(prev.id)) } : null,
    reached_ask: reached,
    links,
  };
}
