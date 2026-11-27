// D4254 P5 (#4273, ps3) — the Decks tile's model: the deck and its variants as cards,
// and the Versions timeline. Pure, so it is tested without a page. A count that could
// not be read is "Not recorded", never 0; a counted 0 is "No links".
import { NOT_RECORDED, dayLabel, versionLabel } from './pitchStudioModel';

/** "No links", "1 link", "3 links"; null (unread) is "Not recorded". */
export function linksWord(n) {
  if (n == null || !Number.isFinite(Number(n))) return NOT_RECORDED;
  const k = Number(n);
  return k === 0 ? 'No links' : k === 1 ? '1 link' : `${k} links`;
}

const live = (r) => r && r.status === 'ok';
const listOf = (data, key) => (Array.isArray(data?.[key]) ? data[key] : []);

/**
 * The deck (Main) and each variant of its current version, as ps3's cards.
 * Links are counted from the current version's investor links: a link with no
 * variant is Main's, one with a variant is that variant's. A variant store or a
 * links read that could not be read leaves its figure "Not recorded".
 */
export function deckCards({ current, cards = null, variants, links }) {
  if (!current) return [];
  const rows = live(links) ? listOf(links.data, 'links') : null;
  // A link row names its variant as `version.variant` (`GET /api/decks/:id/investor-links`, D1565).
  const count = (uid) => (rows ? rows.filter((r) => (r.version?.variant?.uid ?? null) === uid).length : null);
  const by = String(current.by?.name || '').trim();
  const main = {
    key: 'main', kind: 'Main', name: String(current.title || '').trim() || 'Untitled deck',
    version: versionLabel(current),
    cards: Number.isInteger(cards) ? `${cards} cards` : null,
    edited: current.created_at ? `Edited ${dayLabel(current.created_at)}${by ? ` by ${by}` : ''}` : null,
    links: linksWord(count(null)),
  };
  const vs = live(variants) ? listOf(variants.data, 'variants') : [];
  return [main, ...vs.map((v) => ({
    key: `v:${v.uid}`, kind: 'Variant', name: String(v.name || '').trim() || 'Untitled variant',
    version: versionLabel(current), cards: Array.isArray(v.slide_order) && v.slide_order.length ? `${v.slide_order.length} cards` : null,
    edited: v.created_at ? `Made ${dayLabel(v.created_at)}` : null,
    links: linksWord(count(v.uid)),
  }))];
}

/** Whether the variants read failed: the tile then says so once, and draws the deck alone. */
export const variantsUnread = (variants) => Boolean(variants && variants.status === 'error');

/** The Versions timeline, newest first: who saved each and when, and the links that point to it. */
export function timeline(versions) {
  return [...(Array.isArray(versions) ? versions : [])]
    .sort((a, b) => Number(b.version ?? -1) - Number(a.version ?? -1))
    .map((v) => ({
      id: v.id,
      label: versionLabel(v),
      by: String(v.by?.name || '').trim() || NOT_RECORDED,
      saved: v.created_at ? dayLabel(v.created_at) : NOT_RECORDED,
      links: linksWord(Number.isInteger(v.shared_links) ? v.shared_links : null),
      current: Boolean(v.is_current || v.current),
    }));
}
