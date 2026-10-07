import { request } from '../api.js';
export const fundPerformanceApi = {
  list: () => request('/fund-performance'),
  read: (id) => request(`/fund-performance/${id}`),
  attribute: (id, fundId) => request(`/fund-performance/positions/${id}/fund`, { method: 'PUT', body: JSON.stringify({ fund_id: fundId }) }),
  recordValuation: (id, data) => request(`/fund-performance/positions/${id}/valuations`, { method: 'POST', body: JSON.stringify(data) }),
};
