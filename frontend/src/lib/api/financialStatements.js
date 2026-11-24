/**
 * D5836 (#5836, part 1): a venture's accounting statements, read only
 * (routes/financial_statements.ts over D5833's store). The venture's founder,
 * team members and admins only; an advisor or investor gets 404.
 *
 * `latest(projectId, { report })` → `{ items }`: the latest revision of each statement, with
 *   `revisions`, `lines` (exact text and minor units, each with its state), currency, basis and periods.
 * `revision(projectId, uid)` → `{ item }`: one exact revision, superseded or not.
 * `pins(projectId)` → `{ items }`: each pin with the revision it points at and `superseded_by`.
 */
import { request } from '../api.js';

export const financialStatementsApi = {
  latest: (projectId, { report } = {}) =>
    request(`/financial-statements/${encodeURIComponent(projectId)}${report ? `?report=${encodeURIComponent(report)}` : ''}`),
  revision: (projectId, uid) =>
    request(`/financial-statements/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(uid)}`),
  pins: (projectId) => request(`/financial-statements/${encodeURIComponent(projectId)}/pins`),
};
