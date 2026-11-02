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
 *   quote                     THROUGH (D1442): `POST /api/eadwyn/conversations/:uid/quote`;
 *                             no request without a conversation and a question, and
 *                             a refusal or a failed read is off, never a $0.00 hold
 *   waiting                   THROUGH (D1442): `GET /api/ai/rail/proposals?page=&status=proposed`,
 *                             the "N waiting" on Ask; a failed read is off, never "0 waiting"
 */
import { eadwynApi } from '../lib/api/eadwyn.js';
import { railProposalsApi } from '../lib/api/railProposals.js';
import { fillsApi } from '../lib/api/fills.js';

export const ASK_NOT_ON = 'The Worker part of the Ask panel (D1442) is not on yet.';

const through = (fn) => async (...args) => ({ available: true, data: await fn(...args) });

/** A call whose failure is off with its reason, so a read that failed is never drawn as an answer. */
const guarded = (fn) => async (...args) => {
  try { return await fn(...args); } catch (e) { return { available: false, reason: e?.message || 'could not be read' }; }
};

export const askPanelAdapter = {
  start: through((page) => eadwynApi.start(page)),
  conversation: through((uid) => eadwynApi.conversation(uid)),
  conversations: through((page) => eadwynApi.conversations(page)),
  ask: through((uid, question, page) => eadwynApi.ask(uid, { question, page })),
  run: through((page, option) => fillsApi.run({ page, option })),
  proposals: through((option) => railProposalsApi.list({ option, status: 'proposed' })),
  decide: through((uid, decision, payload) => railProposalsApi.decide(uid, decision, payload)),
  quote: guarded(async (uid, question, page) => {
    if (!uid || !String(question || '').trim()) return { available: false, reason: 'Type a question to see what it holds.' };
    const q = await eadwynApi.quote(uid, { question, page });
    return q?.ai === true ? { available: true, data: q } : { available: false, reason: q?.message || ASK_NOT_ON };
  }),
  waiting: guarded(async (page) => {
    if (!page) return { available: false, reason: 'No rail page.' };
    const r = await railProposalsApi.list({ page, status: 'proposed' });
    return { available: true, data: { count: Array.isArray(r?.proposals) ? r.proposals.length : 0 } };
  }),
};

/** The methods that are off, for the decision file and its test. D1442 turned the last two on. */
export const ASK_OFF_METHODS = Object.freeze([]);
