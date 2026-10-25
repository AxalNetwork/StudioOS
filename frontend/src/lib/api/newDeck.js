// D897 (#2677, part 3 of #2434) — New deck: who it is for, an outline, and a
// proposal kept card by card. Worker: routes/deck_new.ts over services/decks/newDeck.ts.
//   GET  /api/decks/new/context?project_id=<id>
//        → { audiences, lengths, cards, standard, round, averages, fast_path, prompt_max }
//   POST /api/decks/new/quote      { project_id, step, audience, length, prompt?, outline? }
//        → { step, ai: true, hold_microusd, model } | { step, ai: false, reason, message }
//   POST /api/decks/outline        { project_id, audience, round_ref?, length, prompt?, start? }
//        → { proposal, outline: { rows, proposed_by, reason? }, cost }
//   POST /api/decks/generate       { project_id, proposal_id?, audience?, length?, prompt?, outline? }
//        → { proposal, progress, wording, cost }
//   POST /api/decks/proposals/:id/keep-slides   { indexes? | all?, save? }
//        → { proposal } | { deck }
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
};
