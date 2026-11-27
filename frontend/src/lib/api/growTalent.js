import { request } from '../api.js';

/**
 * #3938 part 2 (D1478 task 4, job GR4) — routes/research.ts, mounted at /api/research.
 *   rank(scopeKey, postingId)  POST /research/grow/talent/rank { scope_key, posting_id }
 *     The founder's press: one posting's applicants retrieved, ranked, then one line each.
 *     → { job, steps: { retrieved, ranked, written }, rows: [{ application_id, position, line }] }
 *     A null line is none given. Nothing writes an application's status.
 */
export const growTalentApi = {
  rank: (scopeKey, postingId) => request('/research/grow/talent/rank', {
    method: 'POST', body: JSON.stringify({ scope_key: scopeKey, posting_id: postingId }),
  }),
};
