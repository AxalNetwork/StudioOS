// D6237: fund-register corrections and removal; the Worker owns GP, capability and accounting checks.
import { request } from '../api.js';
export const fundLpsApi = {
  correct: (fundId, lpId, data) => request(`/funds/${fundId}/lps/${lpId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (fundId, lpId) => request(`/funds/${fundId}/lps/${lpId}`, { method: 'DELETE' }),
};
