// D4860 (#4860) — the commit and environment HQ's own Worker runs, for the
// version context in HQ · Platform's header. Super Admin only.
// Worker: routes/admin_platform_build.ts.
//   GET /api/admin/platform-build → { commit, commit_basis, environment, deployed_at, deployed_at_reason }
import { request } from '../api.js';

export const platformBuildApi = {
  read: () => request('/admin/platform-build'),
};
