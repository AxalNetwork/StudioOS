/**
 * D5842 (#5842): one selected Search Console aggregate as Raise evidence (`routes/raise_search_console_evidence.ts`):
 * preview and recheck (part 1), then pin it to a claim as a Private item, re-review it after a correction, or withdraw it
 * (part 2). The venture's founders only. Sharing beyond Private stays on the evidence item (`PATCH /cycles/raise/evidence/items/:id`).
 */
import { request } from '../api.js';

const q = (projectId) => `project=${encodeURIComponent(projectId)}`;

export const raiseSearchConsoleEvidenceApi = {
  // A founder's choice: the venture's selected property, a Monday that starts a whole week, and clicks, impressions or ctr.
  preview: (projectId, { site_url, week_start, metric }) => request(`/cycles/raise/evidence/search-console/preview?${new URLSearchParams({
    project: String(projectId), site_url, week_start, metric, search_type: 'web' })}`),
  // A recorded reference: current, corrected (original beside revised, re-review required), missing or revoked.
  recheck: (projectId, { source_ref, snapshot_hash, revision_key }) => request(`/cycles/raise/evidence/search-console/recheck?${new URLSearchParams({
    project: String(projectId), source_ref, snapshot_hash, revision_key })}`),
  // Every pinned aggregate with what it kept and where its source stands now.
  selections: (projectId) => request(`/cycles/raise/evidence/search-console/selections?${q(projectId)}`),
  // Pin the previewed aggregate to one organic-search claim: { site_url, week_start, metric, snapshot_hash, claim_id }.
  pin: (projectId, { site_url, week_start, metric, snapshot_hash, claim_id }) => request(`/cycles/raise/evidence/search-console/selections?${q(projectId)}`,
    { method: 'POST', body: JSON.stringify({ site_url, week_start, metric, search_type: 'web', snapshot_hash, claim_id }) }),
  // After a correction: confirm the revised week by the hash its preview shows, as a new Private item.
  review: (projectId, uid, { snapshot_hash, claim_id }) => request(`/cycles/raise/evidence/search-console/selections/${encodeURIComponent(uid)}/review?${q(projectId)}`,
    { method: 'POST', body: JSON.stringify(claim_id ? { snapshot_hash, claim_id } : { snapshot_hash }) }),
  withdraw: (projectId, uid) => request(`/cycles/raise/evidence/search-console/selections/${encodeURIComponent(uid)}/withdraw?${q(projectId)}`,
    { method: 'POST', body: JSON.stringify({}) }),
};
