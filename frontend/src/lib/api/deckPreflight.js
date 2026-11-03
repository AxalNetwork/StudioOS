// D4208 (#4208, part of #3661 P1) — a deck version's dismissed preflight warnings.
// Worker: routes/deck_preflight.ts.
//   GET /api/decks/:id/preflight/dismissals?version=<n>  → { deck_id, version, dismissed: [finding_id] }
//   PUT /api/decks/:id/preflight/dismissals  { version, finding_id, dismissed, severity? }
//        → { deck_id, version, dismissed: [finding_id] }
// A reader may read; only an editor may write. A blocking finding (layout,
// overflow, an image block with no image) is refused 422 `finding_blocking`.
// Only the finding's id is kept, never its words.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const deckPreflightApi = {
  dismissals: (deckId, version) => request(`/decks/${enc(deckId)}/preflight/dismissals?version=${enc(version)}`),
  setDismissed: (deckId, { version, finding_id, dismissed, severity }) => request(`/decks/${enc(deckId)}/preflight/dismissals`, {
    method: 'PUT',
    body: JSON.stringify({ version, finding_id, dismissed: !!dismissed, ...(severity ? { severity } : {}) }),
  }),
};
