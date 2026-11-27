// D1525 (#3783, deck v2 B7) — rank an area's variants: one Clef decision, blind, from another model family than
// the writers'. Worker: routes/deck_judge.ts, mounted at /api/decks. The client never sends a model.
//   POST /api/decks/areas/:uid/judge/quote → { ai: true, hold_microusd, model_label, family, writer_families, of }
//        | { ai: false, reason, message }. Runs nothing; Clef is held for its input tokens only.
//   POST /api/decks/areas/:uid/judge → { proposal_uid, ranked: true, model_label, family, writer_families,
//        ranking: [{ n, rank, probability, line }], best, of, score, clears, panel: { best, agrees, line }, charged_microusd }
//        | { proposal_uid, ranked: false, reason, message, charged_microusd }. Ranking accepts nothing.
//   `:uid` is the area's proposal; 404 for anyone who may not write its deck, 409 not_open once it is decided.
import { request } from '../api.js';

const path = (uid) => `/decks/areas/${encodeURIComponent(uid)}/judge`;

export const deckJudgeApi = {
  quote: (proposalUid) => request(`${path(proposalUid)}/quote`, { method: 'POST' }),
  rank: (proposalUid) => request(path(proposalUid), { method: 'POST' }),
};
