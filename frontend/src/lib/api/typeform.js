/** Typeform's mounted binding/import/mapping/review routes (#5830); no new selection store. */
import { api, request } from '../api.js';
import { cyclesApi } from './cycles.js';
const qs = (project, more = {}) => new URLSearchParams({ project: String(project), ...more });
export const typeformApi = {
  targets: async project => {
    const [board, module] = await Promise.all([api.getValidationBoard(project), cyclesApi.module('validate', project, 'experiments')]);
    if (module?.parts?.experiments?.state !== 'ok') throw new Error('experiment_choices_unreadable');
    return { hypotheses: (board.hypotheses || []).filter(h => !h.retired_at), experiments: module.parts.experiments.rows || [] };
  },
  forms: (project, page = 1) => request(`/typeform/forms?${qs(project, { page: String(page) })}`),
  fields: (project, form) => request(`/typeform/forms/${encodeURIComponent(form)}/fields?${qs(project)}`),
  select: (project, form_id) => request('/typeform/form', { method: 'PUT', body: JSON.stringify({ project, form_id }) }),
  check: project => request('/typeform/form/check', { method: 'POST', body: JSON.stringify({ project }) }),
  syncStatus: project => request(`/typeform/sync?${qs(project)}`),
  sync: (project, backfill = false) => request('/typeform/sync', { method: 'POST', body: JSON.stringify({ project, backfill }) }),
  mappings: project => request(`/typeform/mappings?${qs(project)}`),
  setMappings: (project, mappings) => request('/typeform/mappings', { method: 'PUT', body: JSON.stringify({ project, mappings }) }),
  evidenceMapping: (project, data) => request('/typeform/validate/evidence-mapping', { method: 'PUT', body: JSON.stringify({ project, ...data }) }),
  reviews: (project, before) => request(`/typeform/validate/reviews?${qs(project, before ? { before: String(before) } : {})}`),
  counts: project => request(`/typeform/validate/form-counts?${qs(project)}`),
  prepare: project => request('/typeform/validate/reviews/prepare', { method: 'POST', body: JSON.stringify({ project }) }),
  decide: (project, id, action) => request(`/typeform/validate/reviews/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, { method: 'POST', body: JSON.stringify({ project }) }),
};
