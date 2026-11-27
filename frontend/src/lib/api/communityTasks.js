// D545 — the community task list the Eadwyn chat's Tasks panel reads:
// the approved tasks for the caller's persona, and the caller's own
// suggestions with their review state. Worker: routes/community_tasks.ts.
import { request } from '../api.js';

export const communityTasksApi = {
  // `suggestionsBefore` is the previous page's `my_suggestions_next`.
  list: (suggestionsBefore) => request(
    suggestionsBefore ? `/community-tasks?suggestions_before=${encodeURIComponent(suggestionsBefore)}` : '/community-tasks',
  ),
  // D606 — what an approved suggestion and a fixed bug earn today, for the
  // panels' notes: { rewards: { task_approved, bug_high, bug_medium, bug_low } },
  // each { credits, active } or null.
  rewards: () => request('/community-tasks/rewards'),
};
