// D1155 (#3060, DL17a) — the staff side of a deal page:
//   GET /api/deals/:id/transfer-gate → { held, open_conditions | null }, an Admin's
//   read of whether an open IC condition holds wires (`routes/deals.ts`). A
//   condition on a decision the caller cannot see holds the wire with no count.
// Recording a wire stays `api.dealTransferRecord` (D1215), an Admin's act.
import { request } from '../api.js';

export const dealStaffApi = {
  transferGate: (dealId) => request(`/deals/${encodeURIComponent(dealId)}/transfer-gate`),
};
