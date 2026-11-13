// D1582 (#3829, deck v2 F3) — a deck version's likely investor questions (D1559), optionally for one prospect.
// Present › Rehearse's report draws them, with "Practise answers", behind the adapter's `rehearse` row.
// The read states only bound figures and runs no model; the founder alone may read it.
// Worker: routes/deck_qa.ts, mounted at /api/decks.
//   GET /api/decks/:id/qa?prospect=&stage=&investor_type=
//     → { deck_id, version, stage, stage_label, investor_type, prospect, prospects, questions, more,
//         answered_count, total, reads }
// D4270 (#4270): the founder's written answers and typed questions (migration 202611031500, never shown to an investor).
//   PUT    /api/decks/:id/qa/answers/:key { answer, source: 'ask'|'typed' } → { question, written }
//   POST   /api/decks/:id/qa/answers      { question, card?, answer? }    → 201 { question }
//   DELETE /api/decks/:id/qa/answers/:key                                → { question, written: null }
import { request } from '../api.js';

const enc = encodeURIComponent;

/** `prospect`: one of the venture's Capital relationships prospects (its id); left out, the venture's order. */
const query = ({ prospect, stage, investorType } = {}) => {
  const q = new URLSearchParams();
  if (prospect != null && prospect !== '') q.set('prospect', String(prospect));
  if (stage) q.set('stage', String(stage));
  if (investorType) q.set('investor_type', String(investorType));
  const s = q.toString();
  return s ? `?${s}` : '';
};

const answers = (deckId, key = '') => `/decks/${enc(deckId)}/qa/answers${key ? `/${enc(key)}` : ''}`;

export const deckQaApi = {
  questions: (deckId, opts) => request(`/decks/${enc(deckId)}/qa${query(opts)}`),
  saveAnswer: (deckId, key, { answer, source = 'typed' }) => request(answers(deckId, key), { method: 'PUT', body: JSON.stringify({ answer, source }) }),
  addQuestion: (deckId, { question, card = null, answer = null }) => request(answers(deckId), { method: 'POST', body: JSON.stringify({ question, card, answer }) }),
  removeAnswer: (deckId, key) => request(answers(deckId, key), { method: 'DELETE' }),
};
