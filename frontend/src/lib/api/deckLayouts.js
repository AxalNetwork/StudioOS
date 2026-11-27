// D1572 (#3819, deck v2 D11) — a .pptx template and the venture's own layouts (pd30, pd10).
// Worker: routes/deck_layouts.ts over services/decks/pptxTemplate.ts.
//   POST   /api/decks/templates/import?project_id=   multipart `file` (.pptx up to 50 MB)
//          → { source_name, palette, colours, fonts: [{ role, found, use, fallback }],
//              layouts: [{ name, placed: true, areas } | { name, placed: false, reason, why }],
//              counts: { found, placed, not_placed } }   nothing is stored
//          404 not_switched_on (HQ's deck:pptx_import) · 413 too_large · 422 not_a_pptx · 422 unreadable
//   GET    /api/decks/layouts?project_id=            → { layouts: [{ uid, name, source_name, areas, created_at }] }
//   POST   /api/decks/layouts?project_id=            { source_name, layouts: [{ name, areas }] } → { saved, layouts }
//          422 not_whole_cells · 409 too_many_layouts
//   DELETE /api/decks/layouts/:uid?project_id=       → { layouts }
import { request } from '../api.js';

const q = (projectId) => `project_id=${encodeURIComponent(projectId)}`;

export const deckLayoutsApi = {
  importTemplate: (projectId, file) => {
    const body = new FormData();
    body.append('file', file);
    return request(`/decks/templates/import?${q(projectId)}`, { method: 'POST', body });
  },
  layouts: (projectId) => request(`/decks/layouts?${q(projectId)}`),
  save: (projectId, sourceName, layouts) => request(`/decks/layouts?${q(projectId)}`, { method: 'POST', body: JSON.stringify({ source_name: sourceName, layouts }) }),
  remove: (projectId, uid) => request(`/decks/layouts/${encodeURIComponent(uid)}?${q(projectId)}`, { method: 'DELETE' }),
};
