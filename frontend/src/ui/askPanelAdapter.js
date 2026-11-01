/**
 * D1443 (#3706) — the Ask panel's one seam to the Worker.
 *
 * Each method either goes THROUGH to a client method whose route is on `main`,
 * or is OFF: it answers `{ available: false, reason }` without a request, so
 * the panel draws the honest line and never invents a value. When the Worker
 * part lands (D1442, migration 694), its builder adds the client method with
 * its route and replaces only that method's body with `through(…)`.
 *
 *   ask, start, conversation  THROUGH: D652's conversations (`/api/eadwyn`)
 *   run                       THROUGH: `POST /api/ai/rail/run`, for a run chip
 *   proposals                 THROUGH: `GET /api/ai/rail/proposals?option=`
 *   decide                    THROUGH: `POST /api/ai/rail/proposals/:uid/decide`
 *   quote                     OFF until D1442: `POST /api/eadwyn/conversations/:uid/quote`
 *   waiting                   OFF until D1442: proposals by `page=` (the "N waiting" on Ask)
 */
import { eadwynApi } from '../lib/api/eadwyn.js';
import { railProposalsApi } from '../lib/api/railProposals.js';
import { fillsApi } from '../lib/api/fills.js';

export const ASK_NOT_ON = 'The Worker part of the Ask panel (D1442) is not on yet.';

const off = (reason = ASK_NOT_ON) => async () => ({ available: false, reason });
const through = (fn) => async (...args) => ({ available: true, data: await fn(...args) });

export const askPanelAdapter = {
  start: through((page) => eadwynApi.start(page)),
  conversation: through((uid) => eadwynApi.conversation(uid)),
  conversations: through((page) => eadwynApi.conversations(page)),
  ask: through((uid, question, page) => eadwynApi.ask(uid, { question, page })),
  run: through((page, option) => fillsApi.run({ page, option })),
  proposals: through((option) => railProposalsApi.list({ option, status: 'proposed' })),
  decide: through((uid, decision, payload) => railProposalsApi.decide(uid, decision, payload)),
  quote: off(),
  waiting: off(),
};

/** The methods that are off, for the decision file and its test. */
export const ASK_OFF_METHODS = Object.freeze(['quote', 'waiting']);
