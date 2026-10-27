// D1256 (#3279) — the venture scorecard (#2428, part 3).
// Worker: routes/venture_scores.ts, at /api/venture-scores. The Worker reads
// and masks every score; the page sends no value, band, confidence or grade.
// Parts 4 and 5 (#3280, #3281) draw them.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const ventureScoresApi = {
  // Model v1 as data, and the versions stored so far.
  models: () => request('/venture-scores/models'),
  // { weights: { team: 0..5, … } | null, equal, updated_at }
  weights: () => request('/venture-scores/weights'),
  // `null` resets to equal. Your weighting changes your sort only.
  saveWeights: (weights) => request('/venture-scores/weights', { method: 'PUT', body: JSON.stringify({ weights }) }),
  // The deal list's strip: { items: [{ deal_id, project_id, locked, scopes: [{ scope, state, band, confidence_word }] }], not_readable }
  batch: (dealIds) => request('/venture-scores/batch', { method: 'POST', body: JSON.stringify({ deal_ids: dealIds }) }),
  // HQ: the latest quarterly fairness check.
  fairness: () => request('/venture-scores/fairness'),
  // An investor's read through a deal: locked, masked before the NDA, inputs after.
  deal: (dealId) => request(`/venture-scores/deal/${enc(dealId)}`),
  // The founder's, staff's or a shared advisor's read.
  venture: (projectId) => request(`/venture-scores/${enc(projectId)}`),
  recompute: (projectId) => request(`/venture-scores/${enc(projectId)}/recompute`, { method: 'POST' }),
  // An Operating Partner's or Admin's review: a note, or up to ±15 points with a reason.
  review: (projectId, scope, { adjustment = 0, reason = null, note = null }) =>
    request(`/venture-scores/${enc(projectId)}/scopes/${enc(scope)}/review`, {
      method: 'PUT', body: JSON.stringify({ adjustment, reason, note }),
    }),
  // The founder's "Ask to correct" on one input.
  askCorrection: (projectId, { scope, inputKey, message }) =>
    request(`/venture-scores/${enc(projectId)}/corrections`, {
      method: 'POST', body: JSON.stringify({ scope, input_key: inputKey, message }),
    }),
  sharing: (projectId) => request(`/venture-scores/${enc(projectId)}/sharing`),
  // { investors?: boolean, advisors?: [userId] }
  saveSharing: (projectId, change) =>
    request(`/venture-scores/${enc(projectId)}/sharing`, { method: 'PUT', body: JSON.stringify(change) }),
};
