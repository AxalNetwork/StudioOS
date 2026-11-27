/** D6214: per-fund reporting rules; the Worker rechecks GP ownership on every write. */
import { request } from '../api.js';
export const portfolioReportingSettingsApi = {
 books: () => request('/portfolio-reporting-settings/books'),
 read: (fund, cadence, { period } = {}) => request(`/portfolio-reporting-settings/${encodeURIComponent(fund)}?${new URLSearchParams({ cadence, ...(period ? { period } : {}) })}`),
 save: (fund, body) => request(`/portfolio-reporting-settings/${encodeURIComponent(fund)}`, { method: 'PUT', body: JSON.stringify(body) }),
};
