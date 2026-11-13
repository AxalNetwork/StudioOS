// D4162 (#4162, H4 of #4137) — whether HQ has paused every AI agent on the
// platform, for the banner each team sees (SA6b).
// Worker: routes/team_platform_status.ts. Any signed-in member.
//   GET /api/teams/platform-status → { paused, since, by_name }
import { request } from '../api.js';

export const platformStatusApi = {
  read: () => request('/teams/platform-status'),
};
