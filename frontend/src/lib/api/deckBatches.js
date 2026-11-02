// D1502 part 2 (#3753, deck v2 A3a) — a deck generation run, read, followed and stopped.
// Worker: routes/deck_batches.ts, mounted at /api/decks; runs live in the deck's DeckGenRoom.
//   GET  /api/decks/areas/batches/:uid → { uid, deck_id, class, state, quote_microusd, held_microusd, charged_microusd,
//                                          created_at, started_at, settled_at, counts: { done, running, waiting, failed, stopped },
//                                          steps: [{ seq, card_uid, area_id, element, kind, model_label, state, seconds,
//                                                    cost_microusd, fallback_used, error_code, result }] }
//        `model_label` is the model's name or "No model · free"; `seconds` is null until a step ends.
//   GET  /api/decks/areas/batches/:uid/events → Server-Sent Events: `snapshot` (the run as the room holds it), then
//        `area_started`, `area_busy` ("Busy, retrying": attempt, wait_ms), `step_done`, `variant_ready`, `area_failed`
//        and `batch_done`, each with card_uid, element, model_label, state, seconds, cost_microusd and the running
//        charged_microusd of held_microusd. 503 runtime_unavailable where no room runs: read the run instead.
//   POST /api/decks/areas/batches/:uid/cancel → the run, as GET answers it. Steps that started are charged; the rest are
//        released. 403 not_your_run for anyone but its starter.
// The stream is read with fetch, not EventSource, because EventSource cannot send the Authorization header.
import { request, refusalError } from '../api.js';

const runPath = (uid) => `/decks/areas/batches/${encodeURIComponent(uid)}`;

/** Splits a Server-Sent Events text into `{ event, data }`, keeping what has not ended yet. */
export function parseSse(buffer) {
  const events = [];
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data.push(line.slice(6));
    }
    if (!data.length) continue;
    try { events.push({ event, data: JSON.parse(data.join('\n')) }); } catch { /* a malformed event is skipped, never guessed */ }
  }
  return { events, rest };
}

function authHeaders() {
  try {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
}

export const deckBatchesApi = {
  batch: (uid) => request(runPath(uid)),
  cancel: (uid) => request(`${runPath(uid)}/cancel`, { method: 'POST' }),
  /**
   * Follows the run: calls `onEvent({ event, data })` for the snapshot and each event, and resolves when the
   * stream ends (the run ended, or `signal` aborted it). Throws the Worker's refusal, e.g. 503 runtime_unavailable.
   */
  events: async (uid, onEvent, { signal } = {}) => {
    const res = await fetch(`/api${runPath(uid)}/events`, { headers: { Accept: 'text/event-stream', ...authHeaders() }, credentials: 'include', signal });
    if (!res.ok || !res.body) throw await refusalError(res, 'Live progress could not be read');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSse(buffer);
      buffer = rest;
      for (const e of events) onEvent(e);
    }
  },
};
