// D1582 (#3829, deck v2 F3) — a deck version's likely investor questions (D1559), optionally for one prospect.
// Present › Rehearse's report draws them, with "Practise answers", behind the adapter's `rehearse` row.
// The read states only bound figures and runs no model; the founder alone may read it.
// Worker: routes/deck_qa.ts, mounted at /api/decks (no migration).
//   GET /api/decks/:id/qa?prospect=&stage=&investor_type=
//     → { deck_id, version, stage, stage_label, investor_type, prospect, prospects, questions, more, reads }
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

export const deckQaApi = {
  questions: (deckId, opts) => request(`/decks/${enc(deckId)}/qa${query(opts)}`),
};
