// D4251 (#4251) — HQ › Decks › AI models: the elements × models grid and the
// kill switch, without a deploy. Worker: routes/admin_ai_element_models.ts
// (/api/admin/ai/element-models), a Super Admin on HQ's deployment only.
//   GET /admin/ai/element-models   { groups, elements, models: [{ id, name, kind, status, offered, required, elements, policy }], plan_mins }
//   PUT /admin/ai/element-models   { model_id, enabled, plan_min?, note?, reason }  → { ok, model_id, policy }
// A write applies on the next call: the run path and every reply read the policy each time.
import { request } from '../api.js';

export const adminAiModelsApi = {
  read: () => request('/admin/ai/element-models'),
  set: (body) => request('/admin/ai/element-models', { method: 'PUT', body: JSON.stringify(body) }),
};
