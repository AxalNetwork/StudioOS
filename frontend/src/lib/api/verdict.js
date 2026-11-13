import { request } from '../api.js';

// D693 (#1704) — Verdict's one write of its own: Record a decision,
// `POST /api/cycles/validate/decisions?project=N` (`routes/cycle_verdict.ts`).
// The Decisions table is the module read (`cycleValidateApi.module`) and a
// record's commitments go through the record's action route, so this module
// holds `record` alone. The body is `{ decision, for, reasoning?, evidence?,
// pivot_claim? }`, `for` being `venture` or `h-<id>`.
export const verdictApi = {
  record: (projectId, body) => request(`/cycles/validate/decisions?project=${encodeURIComponent(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
};
