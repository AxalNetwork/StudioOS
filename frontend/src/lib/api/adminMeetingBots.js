// D886 B10: mounted Super Admin routes in admin_platform.ts.
import { request } from '../api.js';
export const adminMeetingBotsApi = {
  read: () => request('/admin/platform/meeting-bots'),
  startTest: (sessionId, meetingUrl) => request('/admin/platform/meeting-bots/test', {
    method: 'POST', body: JSON.stringify({ session_id: sessionId, meeting_url: meetingUrl }),
  }),
  test: (uid) => request(`/admin/platform/meeting-bots/test/${encodeURIComponent(uid)}`),
};
