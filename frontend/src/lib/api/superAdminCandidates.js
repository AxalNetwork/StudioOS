// D5044 (#5044) — the Super Admin transfer picker's own read, filtered on the server.
// Worker: routes/admin_super_admins.ts (Super Admin).
//   list()   GET /admin/super-admins/candidates
//       → { candidates: [{ id, name, email }] } — active administrators who do not hold the
//         elevation. It replaces the holder console's use of HQ Team's supervision read.
import { request } from '../api.js';

export const superAdminCandidatesApi = {
  list: () => request('/admin/super-admins/candidates'),
};
