import { request } from '../api.js';

// D7704 (#7704) — market sizing versions, mounted by the Worker at
// `/api/market-sizing`. The Worker computes TAM, SAM and SOM (formula
// version 2) from `assumptions` (keyed as the sizing drawer keys them) and
// saves the inputs, the figures and their history as one version. `preview`
// stores nothing. Refusals carry the field's name in `err.code`
// (`missing_sam_pct`, `invalid_population`).
const base = (projectId) => `/market-sizing/projects/${encodeURIComponent(projectId)}`;

export const marketSizingApi = {
  preview: (projectId, { assumptions, inputLabels } = {}) => request(`${base(projectId)}/preview`, {
    method: 'POST', body: JSON.stringify({ assumptions, input_labels: inputLabels }),
  }),
  saveVersion: (projectId, { assumptions, inputLabels, marketFigureSource } = {}) => request(`${base(projectId)}/versions`, {
    method: 'POST', body: JSON.stringify({ assumptions, input_labels: inputLabels, market_figure_source: marketFigureSource }),
  }),
  versions: (projectId) => request(`${base(projectId)}/versions`),
  version: (projectId, uid) => request(`${base(projectId)}/versions/${encodeURIComponent(uid)}`),
};
