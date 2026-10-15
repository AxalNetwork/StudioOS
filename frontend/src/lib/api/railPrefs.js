// D698 (#1660) — the Eadwyn AI rail's preferences, kept on the Worker so a
// mode or a pick set on one device is in place on another.
// Worker: routes/ai.ts, migration 465's `ai_rail_preferences`. Caller only.
//   GET /api/ai/rail-preferences                → { ok, modes: { <section>: 'eadwyn'|'manual' },
//                                                   models: { <section>: { <task>: <model id> } } }
//   PUT /api/ai/rail-preferences/:section       { mode: 'eadwyn'|'manual'|null }
//   PUT /api/ai/rail-preferences/:section/:task { model: <id>|null }; 400 model_not_offered when the
//                                                 task's alternates do not include it
// A null clears the row. localStorage stays the cache (ui/railModelChoice.js,
// hooks/useAssistMode.js).
import { request } from '../api.js';

export const railPrefsApi = {
  read: () => request('/ai/rail-preferences'),
  setMode: (section, mode) =>
    request(`/ai/rail-preferences/${encodeURIComponent(section)}`, {
      method: 'PUT', body: JSON.stringify({ mode: mode ?? null }),
    }),
  setModel: (section, task, model) =>
    request(`/ai/rail-preferences/${encodeURIComponent(section)}/${encodeURIComponent(task)}`, {
      method: 'PUT', body: JSON.stringify({ model: model ?? null }),
    }),
};
