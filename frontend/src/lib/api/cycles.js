import { api, request } from '../api.js';
import { makeCycleWrites } from './cycleWrites.js';

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

/**
 * D6103 (#6103): the module exports, by cycle and slug: the table's own search,
 * filter and sort, as a file. A module is here only when its Worker route
 * exports it (`routes/cycle_grow.ts` `GET /modules/:slug/export`, a writer on
 * the venture); every other module has no Export control.
 */
const EXPORTS = {
  grow: {
    'product-improvement': (projectId, q) => api._downloadCsv(`/cycles/grow/modules/product-improvement/export?${query(projectId, q)}`, 'feedback.csv'),
    'revenue-and-traction': (projectId, q) => api._downloadCsv(`/cycles/grow/modules/revenue-and-traction/export?${query(projectId, q)}`, 'kpis.csv'),
  },
};

/** Whether a module has an export (the page draws Export only then). */
export const canExport = (cycle, slug) => typeof EXPORTS[cycle]?.[slug] === 'function';

/** The cycles whose read the page can draw. A cycle not here keeps its current page. */
export const WIRED_CYCLES = Object.keys(READS);

/** The cycle pages' writes, bound to the app's `request` (see `cycleWrites.js`). */
export const cyclesWrite = makeCycleWrites(request);

export const cyclesApi = {
  overview: (cycle, projectId) => READS[cycle].overview(projectId),
  module: (cycle, projectId, slug, q) => READS[cycle].module(projectId, slug, q),
  record: (cycle, projectId, slug, id) => {
    if (!WIRED_CYCLES.includes(cycle)) return Promise.reject(new Error('No such cycle'));
    return request(`/cycles/${cycle}/modules/${encodeURIComponent(slug)}/records/${encodeURIComponent(id)}?project=${encodeURIComponent(projectId)}`);
  },
  recordActivity: (cycle, projectId, slug, id, page = 1) => {
    if (!WIRED_CYCLES.includes(cycle)) return Promise.reject(new Error('No such cycle'));
    return request(`/cycles/${cycle}/modules/${encodeURIComponent(slug)}/records/${encodeURIComponent(id)}/activity?project=${encodeURIComponent(projectId)}&page=${encodeURIComponent(page)}`);
  },
  /** `{ q, filter, sort }` as the table holds them; resolves `{ filename, rows }` once the file is handed over. */
  exportCsv: (cycle, projectId, slug, q) => (canExport(cycle, slug)
    ? EXPORTS[cycle][slug](projectId, { ...q, page: 1 })
    : Promise.reject(new Error('This module has no export'))),
  // D909 (#2693): D908's section-by-section compare of two narrative versions.
  narrativeCompare: (projectId, a, b) => request(`/cycles/raise/narrative/compare?project=${encodeURIComponent(projectId)}&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`),
  // One implementation with the write table's, which Add filing's Proof calls (D695 #1656).
  recordAction: (cycle, projectId, slug, id, key, body = {}) => {
    if (!WIRED_CYCLES.includes(cycle)) return Promise.reject(new Error('No such cycle'));
    return cyclesWrite.recordAction(cycle, projectId, slug, id, key, body);
  },
};
