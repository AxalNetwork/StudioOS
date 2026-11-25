// D7716 (#7716) — Research market observations: the general query over the observation store.
// Worker: routes/research_observations.ts (/api/research/observations), signed-in users.
//   GET /research/observations?metric=&geography=&industry_code=&size_band=&status=&period_from=&period_to=&vintages=&limit=&offset=
//   GET /research/observations/metrics
//   GET /research/observations/export.csv?<the same filters>
//   GET /research/observations/:id
// A geography is a two- or three-letter country code or WLD, EU27_2020, OECD; an unknown one is refused, not empty.
import { api, request } from '../api.js';

const query = (params = {}) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();

export const researchObservationsApi = {
  /** `{ items, total, limit, offset, vintages, coverage }`; `coverage` is set when a metric and a geography are given. */
  list: (filters = {}) => request(`/research/observations${Object.keys(filters).length ? `?${query(filters)}` : ''}`),
  /** `{ observation, source, revisions }`: labelled dates and the revision chain, oldest first. */
  one: (id) => request(`/research/observations/${encodeURIComponent(id)}`),
  /** `{ items: [{ metric_key, source_id, source_name, enabled, label, definition, unit }] }`. */
  metrics: () => request('/research/observations/metrics'),
  /** The CSV for the same filters; rows of a source whose terms do not allow export are left out and counted. */
  exportCsv: (filters = {}) =>
    api._downloadCsv(`/research/observations/export.csv${Object.keys(filters).length ? `?${query(filters)}` : ''}`, 'research-observations.csv'),
};
