// D715 (#1780) PR 3b and D713 (#1778) — a founder's or partner's own Mercury.
// `status()` is the caller's connection and the uses their role holds
// (`venture_revenue`, `practice_income`, `partner_deals`, each with
// `available` and a `reason`). It reads the caller's own integrations row only,
// never the bank. #1778's PR C adds the match and import calls here.
// Nothing here moves money. Worker: routes/mercury_personal.ts.
import { request } from '../api.js';

export const mercuryPersonalApi = {
  status: () => request('/mercury/personal/status'),
};
