// D5944 — firm-owned advisory negotiation lane limits.
import { request } from '../api.js';

export const partnerNegotiationsApi = {
  setLaneLimit: (stage, limit) => request(
    `/partner/pipeline/negotiations/wip-limits/${encodeURIComponent(stage)}`,
    { method: 'PUT', body: JSON.stringify({ limit }) },
  ),
};
