// D1584 (#3831, deck builder v2 F5) — investor-update reuse.
// Worker: routes/deck_update_reuse.ts, services/decks/updateReuse.ts. No migration.
//   GET /api/decks/:id/derive-update   → { deck_id, update | null, proposals, unchanged, not_in_update, reason? }
//       the version's bound metric tiles refreshed from the latest sent investor update: a proposal, nothing saved
//   GET /api/decks/:id/changes-since   → { since, current | null, latest, changes: { figures, cards } }
//       what changed between this version (the one an investor's link froze) and the current one
import { request } from '../api.js';

const enc = encodeURIComponent;

export const deckUpdateReuseApi = {
  deriveUpdate: (deckId) => request(`/decks/${enc(deckId)}/derive-update`),
  changesSince: (deckId) => request(`/decks/${enc(deckId)}/changes-since`),
};
