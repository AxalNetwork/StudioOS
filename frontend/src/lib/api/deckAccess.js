// D4359 (#4359, #2434 Q8 = A) — may this member use the Pitch deck studio.
// Worker: routes/deck_access.ts over services/decks/studioAccess.ts.
//   GET /api/decks/access → { open, required: 'studio', plan: { tier, name, plan_key }, message }
// The studio's pages draw open or locked from this answer, which is the rule
// the Worker's own deck gates apply; the frontend keeps no plan list of its own.
import { request } from '../api.js';

export const deckAccessApi = {
  get: () => request('/decks/access'),
};
