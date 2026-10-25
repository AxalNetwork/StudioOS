// D899 (#2678, part 5 of #2434) — Eadwyn's card tools in the deck editor.
// Worker: routes/deck_assist.ts over services/decks/assist.ts.
//   POST /api/decks/:id/cards/:card/assist/quote  { action, block_id?, text?, tone?, language?, instruction?, source_keys? }
//        → { action, option, ai: true, hold_microusd, model } | { action, option, ai: false, reason, message }
//   POST /api/decks/:id/cards/:card/assist        (same body)
//        → { proposal, action, option, before, after, cost }            (text tools)
//        → { proposal, action, option, block, title, cost }             (chart, table, timeline)
// A bound figure is refused 422 `never_fill`; a wording that names a figure
// the text did not is refused 422 `figure_in_output`, charged for the run.
// Nothing is placed: Accept places the proposal, Save writes the version.
// `headers` on the run is the press's own rail context (`railPressHeaders`).
import { request } from '../api.js';

const enc = encodeURIComponent;
const post = (path, body, headers) => request(path, { method: 'POST', body: JSON.stringify(body), ...(headers ? { headers } : {}) });

export const deckAssistApi = {
  quote: (deckId, card, body) => post(`/decks/${enc(deckId)}/cards/${enc(card)}/assist/quote`, body),
  run: (deckId, card, body, headers) => post(`/decks/${enc(deckId)}/cards/${enc(card)}/assist`, body, headers),
};
