import { request } from '../api.js';

export const advisorProofApi = {
  cancelConsent: (proofId, consentId) => request(
    `/advisors/me/proof/${encodeURIComponent(proofId)}/consents/${encodeURIComponent(consentId)}/cancel`,
    { method: 'POST', body: JSON.stringify({}) },
  ),
};
