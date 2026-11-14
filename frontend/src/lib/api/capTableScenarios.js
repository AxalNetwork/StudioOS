// D1023 (#2860) — part 3's two scenario reads from Today (D1018), which the
// Instruments tab's "Convert at" and the instrument drawer draw:
//   GET  /api/captable/scenarios/by-project/:projectId/today    → the record as
//        the engine's start, its result (each instrument's MFN read and the
//        post-money check) and what it could not model;
//   POST /api/captable/scenarios/by-project/:projectId/simulate → a round run
//        from Today, each instrument's conversion in its `conversions`. It saves
//        nothing.
// D1024 (#2861) — Scenarios' own reads and writes beside them: the model and
// its scenarios, a scenario typed by hand run through the engine, and one
// scenario's read, create, update and delete.
import { request } from '../api.js';

const base = (projectId) => `/captable/scenarios/by-project/${encodeURIComponent(projectId)}`;
const one = (uid) => `/captable/scenarios/${encodeURIComponent(uid)}`;

export const capTableScenariosApi = {
  today: (projectId) => request(`${base(projectId)}/today`),
  simulate: (projectId, body) => request(`${base(projectId)}/simulate`, { method: 'POST', body: JSON.stringify(body || {}) }),
  compare: (projectId) => request(`${base(projectId)}/compare`),
  // Computes typed inputs (a scenario that starts from the model); saves nothing.
  simulateModel: (inputs) => request('/captable/simulate', { method: 'POST', body: JSON.stringify({ inputs }) }),
  get: (uid) => request(one(uid)),
  create: (projectId, body) => request(`${base(projectId)}/variants`, { method: 'POST', body: JSON.stringify(body || {}) }),
  update: (uid, body) => request(one(uid), { method: 'PUT', body: JSON.stringify(body || {}) }),
  remove: (uid) => request(one(uid), { method: 'DELETE' }),
};
