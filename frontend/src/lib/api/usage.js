// D642 (#1435) — what a member has used, across all their companies. Worker:
// routes/usage.ts, mounted at /api/usage. Keyed on the caller alone: no
// company is sent, so switching company in the sidebar changes nothing.
import { request } from '../api.js';

export const usageApi = {
  storage: () => request('/usage/storage'),
};
