/** D6052 (#6052): inviting a raise prospect to Axal through Contacts' one invite path, and each prospect's invitation state. */
import { request } from '../api.js';
export const prospectInvitesApi = {
  // Each prospect's invitation state for a venture, and whether this viewer may invite. No address is returned.
  states: projectId => request('/contacts/raise-prospects/invites?' + new URLSearchParams({ project_id: String(projectId) }).toString()),
  // `email` only when the prospect has none recorded.
  send: ({ projectId, prospectId, email }) => request('/contacts/invite', { method: 'POST',
    body: JSON.stringify({ project_id: projectId, prospect_id: prospectId, ...(email ? { email } : {}) }) }),
};
