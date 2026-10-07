import { request } from '../api.js';
export const aiBudgetApi = {
  mine: () => request('/ai-budget/me'),
  topUp: () => request('/ai-budget/top-up'),
};
