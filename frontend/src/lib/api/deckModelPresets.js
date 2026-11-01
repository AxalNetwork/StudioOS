// D1549 (#3796, deck v2 C1) — the deck's preset (Fast, Balanced, Best or Custom)
// and HQ's locks. Worker: routes/deck_model_presets.ts, mounted at /api/decks.
//   GET /api/decks/:id/model-presets → { deck_id, project_id, preset, stored, options: [{ id, label }],
//        groups: [{ group, label, lead, presets: [{ preset, model, name, plan_locked }],
//                   resolved: { model, name, source, locked }, lock: null | { model, name, line } }],
//        locks: [{ group, label, model, name, line }] }
//   PUT /api/decks/:id/model-presets { preset: 'fast' | 'balanced' | 'best' | 'custom' } → the same answer, read again.
// No client mirror of the presets: every model is the Worker's answer.
import { request } from '../api.js';

export const deckModelPresetsApi = {
  read: (deckId) => request(`/decks/${encodeURIComponent(deckId)}/model-presets`),
  set: (deckId, preset) => request(`/decks/${encodeURIComponent(deckId)}/model-presets`, { method: 'PUT', body: JSON.stringify({ preset }) }),
};
