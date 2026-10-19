// D716 (#1781, #1866): the LP's own Subscription Booklet. Worker: routes/fund_booklets.ts.
// Every field id comes from the Worker's last view; the page builds none.
import { request } from '../api.js';

export const fundBookletsApi = {
  open: () => request('/fund-booklets/mine', { method: 'POST' }),
  mine: () => request('/fund-booklets/mine'),
  paper: ({ part } = {}) => request(`/fund-booklets/mine/paper${part ? `?part=${encodeURIComponent(part)}` : ''}`),
  answer: (answers) => request('/fund-booklets/mine/answers', { method: 'PUT', body: JSON.stringify({ answers }) }),
  submit: (digest) => request('/fund-booklets/mine/submit', { method: 'POST', body: JSON.stringify({ digest }) }),
};
