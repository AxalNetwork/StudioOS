// D897 (#2677, part 3 of #2434) — New deck: who it is for, an outline, and a
// proposal kept card by card. Worker: routes/deck_new.ts over services/decks/newDeck.ts.
//   GET  /api/decks/new/context?project_id=<id>
//        → { audiences, lengths, cards, standard, round, averages, fast_path, prompt_max }
//   POST /api/decks/new/quote      { project_id, step, audience, length, prompt?, outline? }
//        → { step, ai: true, hold_microusd, model, quote_uid?, pricing_version? } | { step, ai: false, reason, message }
//        D1540 (#3791): send `quote_uid` back with the outline or the build and that run
//        settles at no more than `hold_microusd`; 409 `quote_stale` when the quote was
//        used, lapsed or priced another run (quote again).
//   POST /api/decks/outline        { project_id, audience, round_ref?, length, prompt?, start? }
//        → { proposal, outline: { rows, proposed_by, reason? }, cost }
//   POST /api/decks/generate       { project_id, proposal_id?, audience?, length?, prompt?, outline? }
//        → { proposal, progress, wording, cost }
//   POST /api/decks/proposals/:id/keep-slides   { indexes? | all?, save?, base_hash? }
//        → { proposal, proposal_hash } | { deck }
//   POST /api/decks/proposals/:id/regenerate-card { index, base_hash? }   (D897 §9, #3659)
//        → { proposal, proposal_hash, card: { index, layout }, wording, cost }
//        its price first from `quote` with `step: 'card'` and the row's `index`.
// D897 §9: a write that sends `base_hash` (the `proposal_hash` its page last read)
// is refused 409 `proposal_changed` when another tab moved the proposal since.
// A prompt or outline row that states a figure is refused 422 `figure_in_prompt`
// with the module that records it; nothing runs and nothing is charged.
// `headers` on the two runs is the press's own rail context (`railPressHeaders`).
import { request } from '../api.js';

const enc = encodeURIComponent;
const post = (path, body, headers) => request(path, { method: 'POST', body: JSON.stringify(body), ...(headers ? { headers } : {}) });

export const newDeckApi = {
  context: (projectId) => request(`/decks/new/context?project_id=${enc(projectId)}`),
  quote: (body) => post('/decks/new/quote', body),
  outline: (body, headers) => post('/decks/outline', body, headers),
  build: (body, headers) => post('/decks/generate', body, headers),
  keepSlides: (proposalId, body) => post(`/decks/proposals/${enc(proposalId)}/keep-slides`, body),
  regenerateCard: (proposalId, body, headers) => post(`/decks/proposals/${enc(proposalId)}/regenerate-card`, body, headers),
};
