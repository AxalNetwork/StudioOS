// D1176: Use of funds' mounted Worker routes. Project scope is explicit on every call.
import { request } from '../api.js';
const q = (project, values = {}) => new URLSearchParams({ ...values, project: String(project) }).toString();
const seg = value => encodeURIComponent(String(value));
export const useOfFundsApi = {
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
  deleteMilestone: (project, id) => request(`/cycles/raise/use-of-funds/milestones/${seg(id)}?${q(project)}`, { method: 'DELETE' }),
  hires: project => request(`/cycles/raise/use-of-funds/hires?${q(project)}`),
  updateHire: (project, id, body) => request(`/cycles/raise/use-of-funds/hires/${seg(id)}?${q(project)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteHire: (project, id) => request(`/cycles/raise/use-of-funds/hires/${seg(id)}?${q(project)}`, { method: 'DELETE' }),
  saveSplit: (project, body) => request(`/cycles/raise/use-of-funds?${q(project)}`, { method: 'PUT', body: JSON.stringify(body) }),
  // Forecast retains its existing store and strict driver/source validation.
  forecast: project => request(`/financials/${seg(project)}`),
  saveForecast: (project, assumptions) => request(`/financials/${seg(project)}`, { method: 'PUT', body: JSON.stringify({ assumptions }) }),
};
