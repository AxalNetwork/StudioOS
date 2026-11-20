import { request } from '../api.js';

// D6862 (#6862, D6021 V17/V18) — Eadwyn's read of the evidence offered for one
// decision on Record a decision (`routes/verdict_summary.ts`). The body is
// `{ for: 'venture'|'h-<id>', evidence: [key…] }`. `quote` holds and runs
// nothing; `run` answers rows, each citing one evidence key, and stores nothing.
const path = (projectId, tail = '') => `/cycles/validate/decision-summary${tail}?project=${encodeURIComponent(projectId)}`;

export const decisionSummaryApi = {
  quote: (projectId, body) => request(path(projectId, '/quote'), { method: 'POST', body: JSON.stringify(body) }),
  run: (projectId, body) => request(path(projectId), { method: 'POST', body: JSON.stringify(body) }),
};
