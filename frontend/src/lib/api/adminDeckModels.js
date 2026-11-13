// D1549 (#3796, deck v2 C1) — HQ's org default and lock per deck element group
// (aird6b, "Deck models · org default"). Worker: routes/deck_model_presets.ts
// (`adminDeckModels`, /api/admin/ai/deck-models). A Super Admin's, with a recent
// step-up; `request()` asks for the step-up when the Worker answers `step_up_required`.
//   GET /admin/ai/deck-models → { groups: [{ group, label, lead, choices: [{ id, name, lock }],
//        catalogue_default: { id, name }, org: null | { model, name, locked, updated_at } }] }
//   PUT /admin/ai/deck-models { group, model: <id> | null, locked } → { ok, group, model, locked }
import { request } from '../api.js';

export const adminDeckModelsApi = {
  read: () => request('/admin/ai/deck-models'),
  set: ({ group, model, locked }) => request('/admin/ai/deck-models', { method: 'PUT', body: JSON.stringify({ group, model, locked }) }),
};
