// Recorded lifecycle events for the partner pipeline (D5942).
import { request } from '../api.js';

export const partnerPipelineActivityApi = {
  list: ({ needId, limit } = {}) => {
    const query = new URLSearchParams();
    if (needId != null) query.set('need_id', String(needId));
    if (limit != null) query.set('limit', String(limit));
    return request(`/partner/pipeline/activity?${query}`);
  },
};
