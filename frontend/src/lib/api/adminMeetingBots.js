// D886 B10: mounted Super Admin routes in admin_platform.ts.
import { request, refusalError } from '../api.js';
export const adminMeetingBotsApi = {
  read: () => request('/admin/platform/meeting-bots'),
  startTest: (sessionId, meetingUrl) => request('/admin/platform/meeting-bots/test', {
    method: 'POST', body: JSON.stringify({ session_id: sessionId, meeting_url: meetingUrl }),
  }),
  test: (uid) => request(`/admin/platform/meeting-bots/test/${encodeURIComponent(uid)}`),
  // #3708: the owner's staged diagnostic against a Meet or Zoom call they host; no session or charge.
  diagnose: (meetingUrl) => request('/admin/platform/meeting-bots/diagnose', {
    method: 'POST', body: JSON.stringify({ meeting_url: meetingUrl }),
  }),
  diagnosis: (id) => request(`/admin/platform/meeting-bots/diagnose/${encodeURIComponent(id)}`),
  // The stopping point's screenshot, for its owner only (binary endpoint, not typed drift). The caller makes and revokes the URL.
  diagnosisScreenshot: async (id) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/platform/meeting-bots/diagnose/${encodeURIComponent(id)}/screenshot`, {
      credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw await refusalError(res, 'The screenshot could not be read.');
    return res.blob();
  },
};
