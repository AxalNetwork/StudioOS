/**
 * D1500 (#3750): card uids. Every card of a deck has a stable uid, and a
 * store that names a card (an image, a note, an assist press, a view's slide,
 * a reader's reactions) keeps it beside the card's place. This module imports
 * nothing, so a store can name a card without reaching the slide model's
 * readers (D752's import graph checks that).
 */

const ID = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * D1500: every card gets a uid. A card's own uid is kept when it is sound and
 * not already used on this deck; a card without one gets `c<n>` from its place
 * (with a suffix if that is taken), so the same stored version reads the same
 * uids every time and a result made before the first save still finds its card.
 */
export function assignCardUids<T extends Record<string, any>>(cards: T[]): Array<T & { uid: string }> {
  const list = Array.isArray(cards) ? cards : [];
  const used = new Set<string>();
  const own = list.map((c) => (typeof c?.uid === 'string' && ID.test(c.uid) ? c.uid : null));
  const kept = own.map((u) => { if (!u || used.has(u)) return null; used.add(u); return u; });
  return list.map((c, i) => {
    let uid = kept[i];
    if (!uid) {
      uid = `c${i + 1}`;
      for (let n = 2; used.has(uid); n += 1) uid = `c${i + 1}-${n}`;
      used.add(uid);
    }
    return { ...(c || {}), uid } as T & { uid: string };
  });
}

/** D1500: a card's place on a version from its uid, or -1. */
export const cardIndexOf = (cards: unknown, uid: unknown): number => (Array.isArray(cards) && typeof uid === 'string' ? assignCardUids(cards).findIndex((c) => c.uid === uid) : -1);

/** D1500: the uid of the card at a place on a version, or null. */
export const cardUidAt = (cards: unknown, index: unknown): string | null => (Array.isArray(cards) && Number.isInteger(index) && (index as number) >= 0 && (index as number) < cards.length ? assignCardUids(cards)[index as number].uid : null);

/**
 * D1500: the card a request names on a version, by uid first. A uid the
 * stored version does not hold yet (a card added since its last save) is kept
 * as sent, with the place the request gives; a place alone reads its card's
 * uid from the version. `error` when either is malformed.
 */
export function cardRefOf(cards: unknown, ask: { card?: unknown; card_uid?: unknown }): { index: number | null; uid: string | null } | { error: string } {
  const rawUid = ask?.card_uid;
  if (rawUid != null && rawUid !== '' && !(typeof rawUid === 'string' && ID.test(rawUid))) return { error: 'card_uid must be a card of the deck.' };
  const rawIdx = ask?.card;
  const idx = rawIdx == null || rawIdx === '' ? null : Number(rawIdx);
  if (idx !== null && (!Number.isInteger(idx) || idx < 0 || idx > 59)) return { error: 'card must be a card of the deck, from 0.' };
  if (typeof rawUid === 'string' && rawUid) {
    const at = cardIndexOf(cards, rawUid);
    return { uid: rawUid, index: at >= 0 ? at : idx };
  }
  return { uid: idx == null ? null : cardUidAt(cards, idx), index: idx };
}

