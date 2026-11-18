// D7176 (#7176) — applying a competitor analysis's rerun proposal.
//
// `POST /competitors/:id/rerun` answers a proposal and writes nothing (the
// existing `api.competitors.rerun`). `apply` takes the ticked changes of that
// proposal: `version` is the proposal's `base_version` and travels as
// `If-Match`; body { proposal_id, add, remove, output }. A stale version
// answers 409 `version_conflict`, a superseded proposal 409 `proposal_gone`.
import { request } from '../api.js';

export const competitorReviewApi = {
  apply: (id, version, body) => request(`/competitors/${encodeURIComponent(id)}/rerun/apply`, {
    method: 'POST',
    headers: { 'If-Match': String(version) },
    body: JSON.stringify(body || {}),
  }),
};
