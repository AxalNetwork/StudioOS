// D1579 (#3826, deck builder v2 E6) — each card's status and assignee on one
// deck version, filtered, the cards not Done, and who a card can be assigned to.
// The studio reads it through `pages/raise/pitch/deckV2Adapter.js` (`cardStatus`).
// Status and assignee are the card's own fields, written by saving a version
// (`api.deckUpdate`), so this module only reads.
// Worker: routes/deck_card_status.ts (no migration).
//   GET /api/decks/:id/card-status?status=&assignee=
//     → { deck_id, version, tracked, filter, total, cards, not_done: { count, cards }, people }
import { request } from '../api.js';

const enc = encodeURIComponent;

/** `status`: all, todo, in_progress or done; `assignee`: anyone, none or a person's id. Either left out reads all. */
const query = ({ status, assignee } = {}) => {
  const q = new URLSearchParams();
  if (status && status !== 'all') q.set('status', String(status));
  if (assignee != null && assignee !== 'anyone') q.set('assignee', String(assignee));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const deckCardStatusApi = {
  read: (deckId, filter) => request(`/decks/${enc(deckId)}/card-status${query(filter)}`),
};
