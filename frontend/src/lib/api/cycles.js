import { request } from '../api.js';

// D661 (#1474) — the cycle pages' shared read (#1469, D656), one entry per
// cycle whose read is on `main`. Each path is spelled out so the drift check
// can match it to its Worker route; a cycle joins this table in the PR that
// wires it (Validate first, then Grow, Build and Raise).
const query = (projectId, { q = '', filter = '', sort = '', page = 1 } = {}) => {
  const p = new URLSearchParams({ project: String(projectId) });
  if (q) p.set('q', q);
  if (filter) p.set('filter', filter);
  if (sort) p.set('sort', sort);
  if (page > 1) p.set('page', String(page));
  return p.toString();
};

const READS = {
  validate: {
    overview: (projectId) => request(`/cycles/validate/overview?${query(projectId)}`),
    module: (projectId, slug, q) => request(`/cycles/validate/modules/${encodeURIComponent(slug)}?${query(projectId, q)}`),
  },
  raise: {
    overview: (projectId) => request(`/cycles/raise/overview?${query(projectId)}`),
    module: (projectId, slug, q) => request(`/cycles/raise/modules/${encodeURIComponent(slug)}?${query(projectId, q)}`),
  },
  grow: {
    overview: (projectId) => request(`/cycles/grow/overview?${query(projectId)}`),
    module: (projectId, slug, q) => request(`/cycles/grow/modules/${encodeURIComponent(slug)}?${query(projectId, q)}`),
  },
  build: {
    overview: (projectId) => request(`/cycles/build/overview?${query(projectId)}`),
    module: (projectId, slug, q) => request(`/cycles/build/modules/${encodeURIComponent(slug)}?${query(projectId, q)}`),
  },
};

/** The cycles whose read the page can draw. A cycle not here keeps its current page. */
export const WIRED_CYCLES = Object.keys(READS);

export const cyclesApi = {
  overview: (cycle, projectId) => READS[cycle].overview(projectId),
  module: (cycle, projectId, slug, q) => READS[cycle].module(projectId, slug, q),
};
