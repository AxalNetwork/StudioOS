// D7168 (#7168) — My funds: the founder's saved funds, searched and paged on the Worker, with every count over all saved rows.
// `list` takes q, limit (1–100, default 50), offset, sort (updated | saved |
// name), filter (right | warm | passed), identity (linked | own | legacy) and
// catalogue_uid, and answers { items, total, limit, offset, counts_scope:
// 'all_saved', saved_count, right_stage_count, warm_path_count, passed_count,
// passed_without_reason, linked_count, own_count, legacy_count,
// cheque_overlap_count, allocation_count, allocation_set_count,
// catalogue_links }. A bad parameter is a 400 naming its `field`. The dossier
// reads and writes one row through `api.research.fundGet` / `fundUpdate`
// (PATCH takes `expected_updated_at`, `catalogue_uid`, `own_record` and
// `intended_allocation_cents`). Read by FundsZone, FundCatalogProfile and the
// dossier's chooser.
import { request } from '../api.js';

export const researchMyFundsApi = {
  list: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
    return request(`/research/funds${qs ? `?${qs}` : ''}`);
  },
};
