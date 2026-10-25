// D1023 (#2860) — part 3's two scenario reads from Today (D1018), which the
// Instruments tab's "Convert at" and the instrument drawer draw:
//   GET  /api/captable/scenarios/by-project/:projectId/today    → the record as
//        the engine's start, its result (each instrument's MFN read and the
//        post-money check) and what it could not model;
//   POST /api/captable/scenarios/by-project/:projectId/simulate → a round run
//        from Today, each instrument's conversion in its `conversions`. It saves
//        nothing.
import { request } from '../api.js';

const base = (projectId) => `/captable/scenarios/by-project/${encodeURIComponent(projectId)}`;

export const capTableScenariosApi = {
  today: (projectId) => request(`${base(projectId)}/today`),
  simulate: (projectId, body) => request(`${base(projectId)}/simulate`, { method: 'POST', body: JSON.stringify(body || {}) }),
};
