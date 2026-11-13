// D1557 (#3804, deck v2 C9) — the investor critic on a deck version.
// Worker: routes/deck_critic.ts over services/decks/critic.ts.
//   POST /api/decks/:id/critic/quote  { investor_type?, stage? }
//        → { ai: true, hold_microusd, model, family, writer_family } | { ai: false, reason, message }
//   POST /api/decks/:id/critic        (same body)
//        → { stage_label, persona, findings: [{ key, source, severity, code, card_uid, card_index, message, action }],
//            benchmark: { available, value? | reason }, critic: { state, code?, message?, model?, family? }, cost }
// The rule findings are free and always answered; the critic's own run is on a
// model of another family than the writer's, or it is not run and says why.
// `headers` on the run is the press's own rail context (`railPressHeaders`).
import { request } from '../api.js';

const enc = encodeURIComponent;
const post = (path, body, headers) => request(path, { method: 'POST', body: JSON.stringify(body || {}), ...(headers ? { headers } : {}) });

export const deckCriticApi = {
  quote: (deckId, body) => post(`/decks/${enc(deckId)}/critic/quote`, body),
  run: (deckId, body, headers) => post(`/decks/${enc(deckId)}/critic`, body, headers),
};
