/** Advisor proof publication and consent cancellation API calls. */
import { request } from '../api.js';

export const advisorProofApi = {
  setPublication: (proofId, published) => request(
    `/advisors/me/proof/${encodeURIComponent(proofId)}/publication`,
    { method: 'PATCH', body: JSON.stringify({ published }) },
  ),
  cancelConsent: (proofId, consentId) => request(
    `/advisors/me/proof/${encodeURIComponent(proofId)}/consents/${encodeURIComponent(consentId)}/cancel`,
    { method: 'POST', body: JSON.stringify({}) },
  ),
};
