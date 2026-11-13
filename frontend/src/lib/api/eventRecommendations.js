/** D1487/D1488 (#3724): event recommendations and the quoted Explain, ready for the approved screens. */
import { request } from '../api.js';
const enc = encodeURIComponent;
export const eventRecommendationsApi = {
  recommended: (limit = 8) => request('/events/recommended?limit=' + enc(limit)),
  prefs: () => request('/events/recommendation-prefs'),
  savePrefs: (prefs) => request('/events/recommendation-prefs', { method:'PUT',body:JSON.stringify(prefs) }),
  feedback: (id,verdict,reason) => request('/events/' + enc(id) + '/recommendation-feedback', { method:'POST',body:JSON.stringify({verdict,reason}) }),
  quote: (id) => request('/events/' + enc(id) + '/recommendation/explain/quote', { method:'POST' }),
  // D4450: retain quote.quote_uid and reuse it for retries; request a new quote for a new paid run.
  explain: (id,quoteUid) => request('/events/' + enc(id) + '/recommendation/explain', { method:'POST',headers:{'Idempotency-Key':quoteUid},body:JSON.stringify({quote_uid:quoteUid}) }),
};
