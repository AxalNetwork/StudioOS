// D1512 (#3764, deck v2 A3) — Generate into areas: one quote, one hold, 1–3 variants per area, as proposals.
// Worker: routes/deck_areas.ts, mounted at /api/decks. The client never sends a model: the server resolves each
// element's model from the AIRail's picks (D1503).
//   POST /api/decks/:id/areas/quote  { card, areas: [{ id, grid, element }], variants, class? }
//        → { class, quote_uid, expires_at, hold_microusd, runs, refused,
//            areas: [{ key, card_uid, area_id, element, kind, model, model_label, variants,
//                      gates: { image_check, plan, records }, refusal, lines: [{ label, count, per_microusd, microusd }],
//                      hold_microusd }] }   each area's lines sum to its hold; the areas' holds sum to the total
//   POST /api/decks/:id/areas        the same body + quote_uid, with an Idempotency-Key header
//        → { batch_uid, class, hold_microusd, replayed, proposals: [proposal], refused: [{ key, refusal, gates }] }
//        409 quote_stale; 422 nothing_to_run; the run's own refusals (deck_busy, an allowance) as admitDeckRun answers
//   GET  /api/decks/:id/areas/proposals?batch=<uid>
//        → { batch: { uid, state, held_microusd, charged_microusd }, done, proposals: [proposal] }
//        proposal: { uid, card_uid, area_id, element, kind, state, outcome, accepted_variant, replaces_block,
//                    variants: [{ n, seed, model_label, cost_microusd, seconds, state, error, payload, critique }] }
//   POST /api/decks/:id/areas/:card_uid/:area_id/accept  { proposal_uid, variant, all? } → { proposal, variant }
//   POST /api/decks/:id/areas/proposals/:uid/discard     → { proposal }
import { request } from '../api.js';

const enc = encodeURIComponent;
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
/** One key per press, so a retried request is the same run and is never charged twice. */
const newKey = () => `areas-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export const deckAreasApi = {
  quote: (deckId, body) => request(`/decks/${enc(deckId)}/areas/quote`, { method: 'POST', body: JSON.stringify(body) }),
  start: (deckId, body, key = newKey()) => request(`/decks/${enc(deckId)}/areas`, { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': key } }),
  proposals: (deckId, batchUid) => request(`/decks/${enc(deckId)}/areas/proposals${batchUid ? `?batch=${enc(batchUid)}` : ''}`),
  accept: (deckId, cardUid, areaId, proposalUid, variant, { all = false } = {}) =>
    request(`/decks/${enc(deckId)}/areas/${enc(cardUid)}/${enc(areaId)}/accept`, { method: 'POST', body: JSON.stringify({ proposal_uid: proposalUid, variant, ...(all ? { all: true } : {}) }) }),
  discard: (deckId, proposalUid) => request(`/decks/${enc(deckId)}/areas/proposals/${enc(proposalUid)}/discard`, { method: 'POST' }),
  /**
   * Starts the run and follows it until every area has settled: `{ batch_uid, batch, proposals, refused }`.
   * `onProgress` sees each read (pd9n's "Area 2 done."). Records-only areas settle at once; a run that outlives
   * `maxMs` answers with what has settled, and the rest stay readable through `proposals(deckId, batch_uid)`.
   */
  generate: async (deckId, body, { onProgress, pollMs = 1500, maxMs = 10 * 60_000, sleep = sleepReal } = {}) => {
    const started = await deckAreasApi.start(deckId, body);
    if (!started?.batch_uid) return { batch_uid: null, batch: null, proposals: started?.proposals ?? [], refused: started?.refused ?? [] };
    const end = Date.now() + maxMs;
    let read = null;
    for (;;) {
      read = await deckAreasApi.proposals(deckId, started.batch_uid);
      onProgress?.(read);
      if (read?.done || Date.now() >= end) break;
      await sleep(pollMs);
    }
    const settled = new Map((read?.proposals ?? []).map((p) => [p.uid, p]));
    return {
      batch_uid: started.batch_uid, batch: read?.batch ?? null,
      proposals: (started.proposals ?? []).map((p) => settled.get(p.uid) ?? p),
      refused: started.refused ?? [],
    };
  },
};
