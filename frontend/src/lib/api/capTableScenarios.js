// D1024 — a venture's scenarios (CT6–CT9): Today from the record beside the
// saved model (D1018), a scenario run from Today, and a scenario's own reads
// and writes. Worker: the `/scenarios` section of routes/captable.ts.
import { request } from '../api.js';

const project = (projectId) => `/captable/scenarios/by-project/${encodeURIComponent(projectId)}`;
const one = (uid) => `/captable/scenarios/${encodeURIComponent(uid)}`;

export const capTableScenariosApi = {
  compare: (projectId) => request(`${project(projectId)}/compare`),
  today: (projectId) => request(`${project(projectId)}/today`),
  // Computes from the record with the caller's rounds, exits and converting set; saves nothing.
  simulateFromToday: (projectId, body) => request(`${project(projectId)}/simulate`, { method: 'POST', body: JSON.stringify(body || {}) }),
  // Computes typed inputs (a scenario that starts from the model); saves nothing.
  simulate: (inputs) => request('/captable/simulate', { method: 'POST', body: JSON.stringify({ inputs }) }),
  get: (uid) => request(one(uid)),
  create: (projectId, body) => request(`${project(projectId)}/variants`, { method: 'POST', body: JSON.stringify(body || {}) }),
  update: (uid, body) => request(one(uid), { method: 'PUT', body: JSON.stringify(body || {}) }),
  remove: (uid) => request(one(uid), { method: 'DELETE' }),
};
