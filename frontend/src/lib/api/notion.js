// D1086 (#2951, #2405 part 2) — a founder's picked Notion sources and the
// shared sync. Worker: routes/notion.ts.
//   /connectors/notion            search, sources, a database's schema, the mapping, Stop using, preview
//   /cycles/:section/notion       a module's From Notion, Sync from Notion, Accept, Dismiss, Delete
// Read-only: nothing here writes to Notion. A preview stores nothing.
import { request } from '../api.js';

const enc = encodeURIComponent;
const base = '/connectors/notion';
const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) });

export const notionApi = {
  search: (project, q) => request(`${base}/search?project=${enc(project)}&q=${enc(q)}`),
  sources: (project) => request(`${base}/sources${project ? `?project=${enc(project)}` : ''}`),
  /** { project, module, kind: 'page'|'page_tree'|'database', notion_id, field_map?, default_source? } */
  addSource: (body) => post(`${base}/sources`, body),
  schema: (uid) => request(`${base}/sources/${enc(uid)}/schema`),
  /** { field_map: { fields: { <field>: { property, values? } }, default_source? } } */
  mapSource: (uid, fieldMap) => request(`${base}/sources/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify({ field_map: fieldMap }) }),
  stopSource: (uid) => request(`${base}/sources/${enc(uid)}`, { method: 'DELETE' }),
  /** Five rows as they would land; `map` is a mapping not yet saved. */
  preview: (uid, map) => request(`${base}/sources/${enc(uid)}/preview${map ? `?map=${enc(JSON.stringify(map))}` : ''}`),
  fromNotion: (section, project, module) => request(`/cycles/${enc(section)}/notion?project=${enc(project)}&module=${enc(module)}`),
  sync: (section, project) => post(`/cycles/${enc(section)}/notion/sync`, { project }),
  accept: (section, project, id, extra = {}) => post(`/cycles/${enc(section)}/notion/proposals/${enc(id)}/accept`, { ...extra, project }),
  dismiss: (section, project, id) => post(`/cycles/${enc(section)}/notion/proposals/${enc(id)}/dismiss`, { project }),
  deleteFact: (section, project, ledgerId) => request(`/cycles/${enc(section)}/notion/facts/${enc(ledgerId)}?project=${enc(project)}`, { method: 'DELETE' }),
};
