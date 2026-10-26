// D716 (#1781, #1866): the LP's own Subscription Booklet. Worker: routes/fund_booklets.ts.
// Every field id comes from the Worker's last view; the page builds none.
import { request } from '../api.js';

export const fundBookletsApi = {
  open: () => request('/fund-booklets/mine', { method: 'POST' }),
  mine: () => request('/fund-booklets/mine'),
  paper: ({ part } = {}) => request(`/fund-booklets/mine/paper${part ? `?part=${encodeURIComponent(part)}` : ''}`),
  answer: (answers) => request('/fund-booklets/mine/answers', { method: 'PUT', body: JSON.stringify({ answers }) }),
  submit: (digest) => request('/fund-booklets/mine/submit', { method: 'POST', body: JSON.stringify({ digest }) }),
  // D759 (#1858): sends the submitted booklet for the applicant's e-signature; answers the signing token, held in memory only.
  sign: () => request('/fund-booklets/mine/sign', { method: 'POST' }),
  // D1162 — an Admin on HQ. `list` never carries a tick; `one` answers the
  // booklet with its ticks, and the Worker records that view in the audit log
  // before it answers (fund_booklet.read).
  list: () => request('/fund-booklets'),
  one: (uid) => request(`/fund-booklets/${encodeURIComponent(uid)}`),
  // {reason}: 10 to 200 characters (fund_booklet.withdraw).
  withdraw: (uid, reason) => request(`/fund-booklets/${encodeURIComponent(uid)}/withdraw`, { method: 'POST', body: JSON.stringify({ reason }) }),
  // A Super Admin sends the General Partner's stage again (fund_booklet.accept, with the step-up).
  sendToGeneralPartner: (uid) => request(`/fund-booklets/${encodeURIComponent(uid)}/acceptance`, { method: 'POST' }),
};
