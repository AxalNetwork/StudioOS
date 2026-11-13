import { request } from '../api.js';

/** D1153: the investor's working tabs on a deal — the room's door, the round in sum, and a reasoned withdrawal. */
export const dealWorkroomApi = {
  roomAccess: (id) => request(`/deals/${encodeURIComponent(id)}/room-access`),
  requestRoomAccess: (id, message) => request(`/deals/${encodeURIComponent(id)}/room-access/request`, { method: 'POST', body: JSON.stringify({ message: message || null }) }),
  sharedRoom: (projectUid) => request(`/data-room/shared/${encodeURIComponent(projectUid)}`),
  round: (id) => request(`/deals/${encodeURIComponent(id)}/round`),
  withdraw: (id, uid, reason) => request(`/deals/${encodeURIComponent(id)}/commitments/${encodeURIComponent(uid)}/withdrawal`, { method: 'POST', body: JSON.stringify({ reason }) }),
};
