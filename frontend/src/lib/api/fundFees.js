import { request } from '../api.js';

/**
 * D709 (#1774) — the management fee, under `/api/fund-fees/:fundId`. Reads,
 * and the writes D714 (#1779) gates: confirming terms and issuing a period
 * are the Super Admin's (`fee_terms.confirm`, `fee_period.issue`); every other
 * write is `fee.write`, an Admin's. Nothing here moves money: issuing records
 * amounts and reference codes.
 */
export const fundFeesApi = {
  state: (fundId) => request(`/fund-fees/${fundId}`),
  recordTerms: (fundId, body) => request(`/fund-fees/${fundId}/terms`, { method: 'POST', body: JSON.stringify(body) }),
  confirmTerms: (fundId, termsUid) => request(`/fund-fees/${fundId}/terms/${encodeURIComponent(termsUid)}/confirm`, { method: 'POST', body: '{}' }),
  recordAdmission: (fundId, lpId, body) =>
    request(`/fund-fees/${fundId}/lps/${lpId}/admission`, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  recordNetInvested: (fundId, body) => request(`/fund-fees/${fundId}/net-invested`, { method: 'POST', body: JSON.stringify(body) }),
  recordOffset: (fundId, body) => request(`/fund-fees/${fundId}/offsets`, { method: 'POST', body: JSON.stringify(body) }),
  previewPeriod: (fundId, quarter) => request(`/fund-fees/${fundId}/periods/${quarter}/preview`, { method: 'POST', body: '{}' }),
  issuePeriod: (fundId, quarter, digest, fundingCallUid) =>
    request(`/fund-fees/${fundId}/periods/${quarter}/issue`, { method: 'POST', body: JSON.stringify({ digest, ...(fundingCallUid ? { funding_call_uid: fundingCallUid } : {}) }) }),
  linkFundingCall: (fundId, quarter, callUid) =>
    request(`/fund-fees/${fundId}/periods/${quarter}/funding-call`, { method: 'POST', body: JSON.stringify({ call_uid: callUid }) }),
  period: (fundId, quarter) => request(`/fund-fees/${fundId}/periods/${quarter}`),
  statement: (fundId, quarter, lpId) => request(`/fund-fees/${fundId}/periods/${quarter}/statements/${lpId}`),
};
