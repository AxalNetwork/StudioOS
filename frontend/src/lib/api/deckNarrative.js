// D1516 (#3768, deck v2 A5) — New deck from the narrative: the outline with its grid plan and price, then one build.
// Worker: routes/deck_narrative.ts, mounted at /api/decks. The client never sends a model or a figure.
//   POST /api/decks/narrative/outline  { project_id, audience?, stage?, sector? }
//        → { project_id, narrative: { version, ref, reason, dropped }, stage, stage_label, stage_source,
//            cards: [{ card, uid, title, why, proof, structure, areas: [{ id, element }] }], left_out, warnings,
//            theme: { kind, reason }, template: { template_id, reason }, quote }   runs nothing, holds nothing
//   POST /api/decks/narrative/build    the same body + quote_uid, with an Idempotency-Key header
//        → { deck_id, version, narrative_version, batch_uid, class: 'deck_build', hold_microusd, replayed,
//            theme, template, proposals, refused, left_out }   a new version that is not current; one run, one hold
//        The run is followed through deckBatchesApi and its proposals through deckAreasApi (deck_id).
import { request } from '../api.js';

/** One key per press, so a retried build is the same build and is never charged twice. */
const newKey = () => `narrative-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export const deckNarrativeApi = {
  outline: (body) => request('/decks/narrative/outline', { method: 'POST', body: JSON.stringify(body) }),
  build: (body, key = newKey()) => request('/decks/narrative/build', { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': key } }),
};
