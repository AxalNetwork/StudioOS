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
//
// D764 (#2089): a page's models from the Worker's matrix, and the member's pick
// and switch per page. A page key is the canvas's, such as
// "Founder · Build · Prototype / MVP", so it travels in the query or the body.
//   GET /api/ai/rail?page=<key>[&option=<key>] → { ok, page, crumbs, kind, models: [{ id, name, role,
//                                                   line, price }], options, pick, mode, billing, guard };
//                                                 404 unknown_page
//   PUT /api/ai/rail/pick { page, option?, model: <id>|null }; 400 model_not_offered
//   PUT /api/ai/rail/mode { page, mode: 'eadwyn'|'manual'|null }
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
  page: (page, option) =>
    request(`/ai/rail?page=${encodeURIComponent(page)}${option ? `&option=${encodeURIComponent(option)}` : ''}`),
  setPagePick: (page, model, option) =>
    request('/ai/rail/pick', {
      method: 'PUT', body: JSON.stringify({ page, ...(option ? { option } : {}), model: model ?? null }),
    }),
  setPageMode: (page, mode) =>
    request('/ai/rail/mode', { method: 'PUT', body: JSON.stringify({ page, mode: mode ?? null }) }),
};
