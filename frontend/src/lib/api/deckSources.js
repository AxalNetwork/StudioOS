// D896 (#2675, part 2 of #2434) — what a pitch deck can be filled from, and
// which of a version's bound figures their stores have moved past.
// Worker: routes/deck_sources.ts over services/decks/sources.ts. Read only.
//   GET  /api/decks/sources?project_id=<id>[&include=scoring]
//        → { project_id, items: [{ source_key, area, module, label, value, unit, of?,
//            as_of, grade, source, href, record_ref, snapshot_hash, state, optional? }],
//            coverage: { slots, filled, by_grade, not_recorded, unreadable } }
//   POST /api/decks/:id/refresh
//        → { deck_id, version, checked, stale, rows: [{ slide, field, source_key,
//            bound, state: fresh|stale|gone|unknown, current }] }
// Refresh writes nothing: re-reading a value into the deck is the editor's Save.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const deckSourcesApi = {
  list: (projectId, { includeScoring = false } = {}) =>
    request(`/decks/sources?project_id=${enc(projectId)}${includeScoring ? '&include=scoring' : ''}`),
  refresh: (deckId) => request(`/decks/${enc(deckId)}/refresh`, { method: 'POST', body: JSON.stringify({}) }),
};
