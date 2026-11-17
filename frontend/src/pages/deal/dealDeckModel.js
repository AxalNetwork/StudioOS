/**
 * D6165 (#6165) — the Deck card's states on the investor's deal page, from
 * D1587's `GET /api/deals/:id/deck` (`deckGrantsApi.deck`). Canvas DL1
 * `deckK`: the deck's title, its version, "frozen as of" and Open the deck.
 *
 *   loading     the read is out
 *   unreadable  the read failed: the card says so with Try again
 *   not_granted `granted: false`: the Worker's own sentence, and no viewer
 *   ready       the title, the version and the frozen date; Open the deck
 *               draws the slides exactly as the Worker returned them
 *
 * A missing title or date reads "Not recorded", never a blank or a made-up
 * value. The model never writes and never reads anything but this answer.
 *
 * Pure: no React, no network.
 */
import { NOT_RECORDED } from '../../lib/absence.js';

export const DECK_CARD = Object.freeze({
  eye: 'Pitch deck',
  title: 'Deck',
  open: 'Open the deck',
  reading: 'Reading the deck…',
  what: 'The deck',
  claim: 'That is not a claim that the venture has not shared it.',
  // The Worker's sentence is the one shown; this is only for an answer that carries none.
  notGranted: 'The venture has not shared its deck with you on this deal yet.',
});

/** A D1 or ISO timestamp as "21 Oct 2026" (UTC), or null when it is not a date. */
export function frozenDay(at) {
  if (at == null || at === '') return null;
  const raw = String(at).trim();
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

/** The card's state from the read (`{ status: 'loading' | 'unreadable' | 'ready', data }`). */
export function deckCardOf(read) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status !== 'ready') return { state: 'unreadable' };
  const data = read.data || {};
  if (data.granted !== true || !data.deck || typeof data.deck !== 'object') {
    const line = typeof data.message === 'string' && data.message.trim() ? data.message.trim() : DECK_CARD.notGranted;
    return { state: 'not_granted', line };
  }
  const deck = data.deck;
  const title = typeof deck.title === 'string' && deck.title.trim() ? deck.title.trim() : NOT_RECORDED;
  const v = Number(deck.frozen?.version);
  const version = deck.frozen?.version != null && Number.isFinite(v) ? `v${v}` : `Version ${NOT_RECORDED.toLowerCase()}`;
  const day = frozenDay(deck.frozen?.as_of);
  const frozen = day ? `frozen as of ${day}` : `frozen date ${NOT_RECORDED.toLowerCase()}`;
  const venture = typeof data.venture === 'string' && data.venture.trim() ? data.venture.trim() : null;
  return {
    state: 'ready',
    title,
    titleMissing: title === NOT_RECORDED,
    venture,
    line: [venture, version, frozen].filter(Boolean).join(' · '),
    deck,
  };
}
