// D1503 (#3754, deck v2 A10) — a model per grid element, from the one catalogue.
// Worker: routes/deck_element_models.ts, mounted at /api/decks.
//   GET /api/decks/:id/element-models → { deck_id, project_id, billing, plan_rank,
//        elements: [{ element, group, job, kind, task, plan_min, expected_ms, per_run_microusd,
//                     suggested: [≤ 3 { id, name, role, line, price, lock, plan_locked }], more: [...], pick,
//                     resolved: { model, name, source, locked, notice } }],
//        groups: [{ group, elements, lead, suggested, more, pick, resolved, free? }],
//        free: [{ element, group, line }] }
//   PUT /api/decks/:id/element-models { scope: 'deck' | 'member', key: <element> | 'group:<group>', model: <id> | null }
//        → { ok, scope, key, model }; 403 role_locked when HQ locked it, 403 plan_locked off the plan.
// No client mirror of the routes: every model and default is the Worker's answer.
import { request } from '../api.js';

export const deckElementModelsApi = {
  read: (deckId) => request(`/decks/${encodeURIComponent(deckId)}/element-models`),
  pick: (deckId, { scope, key, model }) => request(`/decks/${encodeURIComponent(deckId)}/element-models`, { method: 'PUT', body: JSON.stringify({ scope, key, model }) }),
};
