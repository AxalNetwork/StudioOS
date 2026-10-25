import { request } from '../api.js';
export const fundPerformanceApi = {
  list: () => request('/fund-performance'),
  read: (id) => request(`/fund-performance/${id}`),
  // D1158 (FND10): each position with its latest mark, and the quarterly history. GP of record and admins only.
  positions: (id) => request(`/fund-performance/${id}/positions`),
  history: (id) => request(`/fund-performance/${id}/history?step=quarter`),
  attribute: (id, fundId) => request(`/fund-performance/positions/${id}/fund`, { method: 'PUT', body: JSON.stringify({ fund_id: fundId }) }),
  recordValuation: (id, data) => request(`/fund-performance/positions/${id}/valuations`, { method: 'POST', body: JSON.stringify(data) }),
};
