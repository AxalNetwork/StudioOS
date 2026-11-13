// D1535 (#3782, deck v2 B6) — the template store behind the Gallery and "Save as my template".
// Worker: routes/deck_templates.ts, mounted at /api/decks (migration 725).
//   GET  /api/decks/templates?stage=&audience=&style= → { templates: [Meta], filters: { stages, audiences, styles } }
//   GET  /api/decks/templates/mine                    → { templates: [Meta] }
//   GET  /api/decks/templates/pick?stage=&audience=&sector= → { template_id, reason }
//   GET  /api/decks/templates/:uid                    → { template: Meta, cards, theme }
//   POST /api/decks/templates/:uid/apply { project_id } → { proposal, template_id }: a proposal, nothing kept before Accept
//   POST /api/decks/:id/save-as-template { name }     → 201 { template: Meta }: text and figures removed
// Meta = { uid, name, description, stage, audience_tags, deck_audience, style, swatch, card_count }.
import { request } from '../api.js';

const enc = encodeURIComponent;
const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o || {})) if (v) p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ''; };

export const deckTemplatesApi = {
  templates: ({ stage, audience, style } = {}) => request(`/decks/templates${qs({ stage, audience, style })}`),
  myTemplates: () => request('/decks/templates/mine'),
  pickTemplate: ({ stage, audience, sector } = {}) => request(`/decks/templates/pick${qs({ stage, audience, sector })}`),
  template: (uid) => request(`/decks/templates/${enc(uid)}`),
  applyTemplate: (uid, projectId) => request(`/decks/templates/${enc(uid)}/apply`, { method: 'POST', body: JSON.stringify({ project_id: projectId }) }),
  saveAsTemplate: (deckId, name) => request(`/decks/${enc(deckId)}/save-as-template`, { method: 'POST', body: JSON.stringify({ name }) }),
};
