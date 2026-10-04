// D545 — the community task list the Eadwyn chat's Tasks panel reads:
// the approved tasks for the caller's persona, and the caller's own
// suggestions with their review state. Worker: routes/community_tasks.ts.
import { request } from '../api.js';

export const communityTasksApi = {
  list: () => request('/community-tasks'),
};
