// D1176: Use of funds' mounted Worker routes. Project scope is explicit on every call.
// D5069: every write to a scenario, its split or its milestones carries `expected_revision`, the
// `revision` it was read at; a plan that moved since answers 409 `changed_since_open`.
// D5375: so does a hire edit or removal, with the hire's own revision.
import { request } from '../api.js';
import { api } from '../api.js';
const q = (project, values = {}) => new URLSearchParams({ ...values, project: String(project) }).toString();
const seg = value => encodeURIComponent(String(value));
export const useOfFundsApi = {
  readings: project => request(`/cycles/raise/use-of-funds/eadwyn?${q(project)}`),
  readingRoadmap: project => request(`/cycles/raise/use-of-funds/eadwyn/roadmap?${q(project)}`),
  previewReading: (project, body, headers) => request(`/cycles/raise/use-of-funds/eadwyn?${q(project)}`, { method: 'POST', body: JSON.stringify(body), headers }),
  keepReading: (project, receipt) => request(`/cycles/raise/use-of-funds/eadwyn/keep?${q(project)}`, { method: 'POST', body: JSON.stringify({ receipt }) }),
  plan: project => request(`/cycles/raise/use-of-funds/plan?${q(project)}`),
  scenarios: project => request(`/cycles/raise/use-of-funds/scenarios?${q(project)}`),
  scenario: (project, id) => request(`/cycles/raise/use-of-funds/scenarios/${seg(id)}?${q(project)}`),
  createScenario: (project, body) => request(`/cycles/raise/use-of-funds/scenarios?${q(project)}`, { method: 'POST', body: JSON.stringify(body) }),
  updateScenario: (project, id, body) => request(`/cycles/raise/use-of-funds/scenarios/${seg(id)}?${q(project)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteScenario: (project, id) => request(`/cycles/raise/use-of-funds/scenarios/${seg(id)}?${q(project)}`, { method: 'DELETE' }),
  makeBase: (project, id) => request(`/cycles/raise/use-of-funds/scenarios/${seg(id)}/make-base?${q(project)}`, { method: 'POST', body: '{}' }),
  compare: (project, ids) => request(`/cycles/raise/use-of-funds/compare?${q(project, { ids: ids.join(',') })}`),
  milestones: (project, scenarioId) => request(`/cycles/raise/use-of-funds/milestones?${q(project, scenarioId == null ? {} : { scenario_id: String(scenarioId) })}`),
  milestone: (project, id) => request(`/cycles/raise/use-of-funds/milestones/${seg(id)}?${q(project)}`),
  createMilestone: (project, body) => request(`/cycles/raise/use-of-funds/milestones?${q(project)}`, { method: 'POST', body: JSON.stringify(body) }),
  updateMilestone: (project, id, body) => request(`/cycles/raise/use-of-funds/milestones/${seg(id)}?${q(project)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  // D5069: a DELETE has no body, so the scenario revision it read travels in the query.
  deleteMilestone: (project, id, revision) => request(`/cycles/raise/use-of-funds/milestones/${seg(id)}?${q(project, revision == null ? {} : { expected_revision: String(revision) })}`, { method: 'DELETE' }),
  hires: project => request(`/cycles/raise/use-of-funds/hires?${q(project)}`),
  updateHire: (project, id, body) => request(`/cycles/raise/use-of-funds/hires/${seg(id)}?${q(project)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  // D5375: a hire edit carries `expected_revision` in its body; a removal, having no body, carries it in the query.
  deleteHire: (project, id, revision) => request(`/cycles/raise/use-of-funds/hires/${seg(id)}?${q(project, revision == null ? {} : { expected_revision: String(revision) })}`, { method: 'DELETE' }),
  // D1177 (#3104): the plan's history, 20 a page; Mercury rows are the founder's alone.
  history: (project, page = 1) => request(`/cycles/raise/use-of-funds/history?${q(project, { page: String(page) })}`),
  // D6084 (#6084): the base plan as a file, and a dated PDF filed in the data room. Each writes an audit row.
  exportCsv: project => api._downloadCsv(`/cycles/raise/use-of-funds/export.csv?${q(project)}`, 'use-of-funds.csv'),
  exportPdf: project => api._downloadCsv(`/cycles/raise/use-of-funds/export.pdf?${q(project)}`, 'use-of-funds.pdf'),
  snapshot: project => request(`/cycles/raise/use-of-funds/snapshot?${q(project)}`, { method: 'POST', body: '{}' }),
  saveSplit: (project, body) => request(`/cycles/raise/use-of-funds?${q(project)}`, { method: 'PUT', body: JSON.stringify(body) }),
  // Forecast retains its existing store and strict driver/source validation.
  forecast: project => request(`/financials/${seg(project)}`),
  saveForecast: (project, assumptions) => request(`/financials/${seg(project)}`, { method: 'PUT', body: JSON.stringify({ assumptions }) }),
};
