import { request } from '../api.js';

// D7704 (#7704) — market sizing versions, mounted by the Worker at
// `/api/market-sizing`. The Worker computes TAM, SAM and SOM (formula
// version 2) from `assumptions` (keyed as the sizing drawer keys them) and
// saves the inputs, the figures and their history as one version. `preview`
// stores nothing. Refusals carry the field's name in `err.code`
// (`missing_sam_pct`, `invalid_population`).
//
// D7725 (#7725) — the labelled shape. Send `scenarios` (`{ base }`, or
// `{ low, base, high }`, each `{ inputs, tam_override_reason }`) with a source
// on every input, `revenueBasis` ('annual' or 'cumulative') and optionally
// `topDown`; the Worker copies each source's title, link and value from its
// stored row. `sensitivity` and `superseded` are reads. Without `scenarios`
// or `topDown` a save keeps #7704's shape.
const base = (projectId) => `/market-sizing/projects/${encodeURIComponent(projectId)}`;
const body = ({ assumptions, inputLabels, marketFigureSource, scenarios, revenueBasis, topDown } = {}) => JSON.stringify({
  assumptions, input_labels: inputLabels, market_figure_source: marketFigureSource,
  scenarios, revenue_basis: revenueBasis, top_down: topDown,
});

export const marketSizingApi = {
  preview: (projectId, opts = {}) => request(`${base(projectId)}/preview`, { method: 'POST', body: body(opts) }),
  saveVersion: (projectId, opts = {}) => request(`${base(projectId)}/versions`, { method: 'POST', body: body(opts) }),
  versions: (projectId) => request(`${base(projectId)}/versions`),
  version: (projectId, uid) => request(`${base(projectId)}/versions/${encodeURIComponent(uid)}`),
  sensitivity: (projectId, uid) => request(`${base(projectId)}/versions/${encodeURIComponent(uid)}/sensitivity`),
  superseded: (projectId) => request(`${base(projectId)}/superseded`),
};
