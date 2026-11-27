/** D5842 (#5842): preview and recheck one selected Search Console aggregate as Raise evidence (`routes/raise_search_console_evidence.ts`). */
import { request } from '../api.js';

export const raiseSearchConsoleEvidenceApi = {
  // A founder's choice: the venture's selected property, a Monday that starts a whole week, and clicks, impressions or ctr.
  preview: (projectId, { site_url, week_start, metric }) => request(`/cycles/raise/evidence/search-console/preview?${new URLSearchParams({
    project: String(projectId), site_url, week_start, metric, search_type: 'web' })}`),
  // A recorded reference: current, corrected (original beside revised, re-review required), missing or revoked.
  recheck: (projectId, { source_ref, snapshot_hash, revision_key }) => request(`/cycles/raise/evidence/search-console/recheck?${new URLSearchParams({
    project: String(projectId), source_ref, snapshot_hash, revision_key })}`),
};
