// D702 (#1664) — the founder's profile pages: You, Your venture, What others
// see and Visibility. Worker: routes/founder_profile.ts (/api/profile/me,
// /venture, /preview) and the privacy route in routes/settings.ts, which takes
// `?project=` for the venture's investor toggle.
import { request } from '../api.js';

const enc = encodeURIComponent;
const project = (id) => `project=${enc(id)}`;

export const profileApi = {
  me: () => request('/profile/me'),
  venture: (projectId) => request(`/profile/venture?${project(projectId)}`),
  saveVenture: (projectId, body) => request(`/profile/venture?${project(projectId)}`, {
    method: 'PATCH', body: JSON.stringify(body ?? {}),
  }),
  preview: (projectId, audience) => request(`/profile/preview?${project(projectId)}&audience=${enc(audience)}`),
  // Without a venture the route reads and writes the member's own settings only.
  privacy: (projectId) => request(projectId ? `/settings/privacy?${project(projectId)}` : '/settings/privacy'),
  setPrivacy: (projectId, body) => request(projectId ? `/settings/privacy?${project(projectId)}` : '/settings/privacy', {
    method: 'PUT', body: JSON.stringify(body ?? {}),
  }),
};
