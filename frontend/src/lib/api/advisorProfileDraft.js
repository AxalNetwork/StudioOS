/** Owner-only Expertise profile draft and publication API calls. */
import { request } from '../api.js';

export const advisorProfileDraftApi = {
  get: () => request('/advisors/me/profile-draft'),
  save: (fields, revision) => request('/advisors/me/profile-draft', {
    method: 'PATCH', body: JSON.stringify({ ...fields, revision }),
  }),
  publish: (revision) => request('/advisors/me/profile-draft/publish', {
    method: 'POST', body: JSON.stringify({ revision }),
  }),
  discard: (revision) => request('/advisors/me/profile-draft', {
    method: 'DELETE', body: JSON.stringify({ revision }),
  }),
};
