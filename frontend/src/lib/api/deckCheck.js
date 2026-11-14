// D900 (#2679, part 6 of #2434) — the deck's check against the records.
// Worker: routes/deck_check.ts over services/deckCheck.ts and D1264's raiseClaims.ts.
//   GET  /api/decks/checks?project_id=<id>
//        → { project_id, versions: [{ deck_id, version, checked, checked_at, counts | null }] }
//   GET  /api/decks/:id/check   → the version's last check (states only for a reader who is not the founder)
//   POST /api/decks/:id/check   → { deck_id, version, outcome, checked_at, counts, figures,
//        claims: [{ uid, slide, figure, label, state, display_state, stale, stated_shown, record, note, note_outdated }] }
//   POST /api/decks/:id/claims/:uid/use-record  { record_value } → { deck }   (a new version)
// "Keep mine, with a note" is raiseEvidenceApi.note.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const deckCheckApi = {
  versions: (projectId) => request(`/decks/checks?project_id=${enc(projectId)}`),
  read: (deckId) => request(`/decks/${enc(deckId)}/check`),
  run: (deckId) => request(`/decks/${enc(deckId)}/check`, { method: 'POST', body: JSON.stringify({}) }),
  useRecord: (deckId, claimUid, recordValue) =>
    request(`/decks/${enc(deckId)}/claims/${enc(claimUid)}/use-record`, { method: 'POST', body: JSON.stringify({ record_value: recordValue }) }),
};
