// D1522 (#3774, deck v2 A23) — the stage plan of one deck version.
// Worker: routes/deck_stage.ts, mounted at /api/decks.
//   GET /api/decks/:id/stage-plan?stage=&investor_type=
//     → { deck_id, version, stage, stage_label, stage_source: 'asked' | 'audience' | 'venture' | 'default',
//         investor_type, order: [{ card, title, why, weight, required, in_deck, proof: 'recorded' | 'missing' | 'unchecked' }],
//         warnings: [{ card, code, message, action }], extra, sources, evidence, objections: { state, unanswered } }
// Read through `deckV2Adapter.stagePlan`; no screen calls it directly.
import { request } from '../api.js';

export const deckStageApi = {
  stagePlan: (deckId, { stage, investorType } = {}) => {
    const q = new URLSearchParams();
    if (stage) q.set('stage', stage);
    if (investorType) q.set('investor_type', investorType);
    const qs = q.toString();
    return request(`/decks/${encodeURIComponent(deckId)}/stage-plan${qs ? `?${qs}` : ''}`);
  },
};
