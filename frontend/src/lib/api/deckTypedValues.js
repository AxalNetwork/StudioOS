// D1538 (#3787, deck v2 B11) — the figures a founder types for a deck, Stated.
// Worker: routes/deck_typed_values.ts, mounted at /api/decks.
//   GET    /api/decks/:id/typed-values       → { deck_id, values: [{ key, label, value, unit, grade: 'Stated', typed_by: { id, name } | null, typed_at }] }
//   PUT    /api/decks/:id/typed-values/:key  { label, value, unit } → { value }
//   DELETE /api/decks/:id/typed-values/:key  → { deleted: true }
// A typed figure is the venture's: every version of the deck reads the same ones. A key nobody typed is absent, never 0.
import { request } from '../api.js';

const at = (deckId, key) => `/decks/${encodeURIComponent(deckId)}/typed-values${key == null ? '' : `/${encodeURIComponent(key)}`}`;

export const deckTypedValuesApi = {
  list: (deckId) => request(at(deckId)),
  set: (deckId, key, body) => request(at(deckId, key), { method: 'PUT', body: JSON.stringify(body) }),
  remove: (deckId, key) => request(at(deckId, key), { method: 'DELETE' }),
};
