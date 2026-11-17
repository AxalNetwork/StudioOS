/** D6006 (#6006): Problem discovery's bulk write — several quotes assigned to one theme, or to a new one, in one step. */
import { request } from '../api.js';
export const painThemesApi = {
  // { phrases: string[], group_id } or { phrases: string[], new_title }; answers the pain-groups view plus `assigned` and `group_id`.
  assignMany: (projectId, body) => request(`/progress/pain-groups/${projectId}/assign-many`, { method: 'POST', body: JSON.stringify(body) }),
};
