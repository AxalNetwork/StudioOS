// D6033 (#6033, BD25) — Solution design's risks list, 25 a page, and the risk edit that list offers.
// Worker: routes/cycle_build.ts (`GET /cycles/build/risks`, `PATCH /cycles/build/risks/:id`). Add a risk is
// `cyclesWrite.build.risk` (`POST /cycles/build/risks`), the write the feature record's Add a risk runs.
import { request } from '../api.js';

/** The list's query: the venture, a state (`open`, `mitigating`, `closed`), tied or untied, and a page from 1. */
export function buildRisksPath(projectId, { state = '', feature = '', page = 1 } = {}) {
  const p = new URLSearchParams({ project: String(projectId) });
  if (state) p.set('state', state);
  if (feature) p.set('feature', feature);
  if (page > 1) p.set('page', String(page));
  return `/cycles/build/risks?${p.toString()}`;
}

export const buildRisksApi = {
  list: (projectId, filter) => request(buildRisksPath(projectId, filter)),
  // Title, severity, mitigation and state. The Worker ignores owner and feature here (BD25).
  update: (projectId, id, body) => request(`/cycles/build/risks/${encodeURIComponent(String(id))}?${new URLSearchParams({ project: String(projectId) })}`,
    { method: 'PATCH', body: JSON.stringify(body) }),
};
