// D1572 (#3819, deck v2 D11) — brand locks (pd31). Worker: routes/deck_brand_kit.ts
// over services/decks/brandLocks.ts.
//   GET /api/decks/brand-kit/locks?project_id=
//       → { project_id, locks: { fonts, palette, logo }, can_lock, admins_only }
//         each lock { part, by, at } or null
//   PUT /api/decks/brand-kit/locks?project_id=   { part: 'fonts' | 'palette' | 'logo', locked }
//       → the same   403 admins_only ("Only the venture’s admins can lock.")
// While a part is locked, a kit save that changes it, or a card save bringing in an
// off-palette colour, answers 409 brand_locked ("… locked in the brand kit by [name]. Nothing changed.").
import { request } from '../api.js';

export const deckBrandLocksApi = {
  locks: (projectId) => request(`/decks/brand-kit/locks?project_id=${encodeURIComponent(projectId)}`),
  setLock: (projectId, part, locked) => request(`/decks/brand-kit/locks?project_id=${encodeURIComponent(projectId)}`, { method: 'PUT', body: JSON.stringify({ part, locked }) }),
};
