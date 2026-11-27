// D6043 (#6043) — a Build module's records list as a CSV file, with the page's search, filters and sort.
// Worker: routes/cycle_build.ts (`GET /cycles/build/modules/:slug/export`).
import { api } from '../api.js';

/** The page's query as the export reads it: `q`, `filter` (`key:value,…`), `sort`. Never a page. */
export function buildExportPath(projectId, slug, { q = '', filter = '', sort = '' } = {}) {
  const p = new URLSearchParams({ project: String(projectId) });
  if (q) p.set('q', q);
  if (filter) p.set('filter', filter);
  if (sort) p.set('sort', sort);
  return `/cycles/build/modules/${encodeURIComponent(slug)}/export?${p.toString()}`;
}

export const buildModuleExportApi = {
  exportCsv: (projectId, slug, query) => api._downloadCsv(buildExportPath(projectId, slug, query), `${slug}.csv`),
};
