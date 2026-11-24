/** The founder's QuickBooks Online connection and statement sync; Worker routes/quickbooks.ts (#5834). */
import { request } from '../api.js';
export const quickbooksApi = {
  connection: () => request('/quickbooks/connection'),
  sync: (connectionId, body) => request(`/quickbooks/connection/${encodeURIComponent(connectionId)}/sync`, { method: 'POST', body: JSON.stringify(body || {}) }),
};
