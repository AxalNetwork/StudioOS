// D6869 (#6869) — a data-room file in an investor's Library, a live reference that follows the grant, and the
// founder's per-room switch. Worker: routes/room_library.ts (/api/room-library).
import { request } from '../api.js';

export const roomLibraryApi = {
  // An investor with a grant: whether the founder allows Library copies, and which of the room's files are in theirs.
  room: (projectUid) => request(`/room-library/rooms/${encodeURIComponent(projectUid)}`),
  // { project_uid, file_uid }. 409 `already_added` carries the Library row's uid; 403 `library_off` or `nda_required`.
  add: ({ projectUid, fileUid }) => request('/room-library/items', {
    method: 'POST',
    body: JSON.stringify({ project_uid: projectUid, file_uid: fileUid }),
  }),
  // The investor removes it from their Library; the room's file is never touched.
  remove: (documentUid) => request(`/room-library/items/${encodeURIComponent(documentUid)}`, { method: 'DELETE' }),
  // The room's founder or a cofounder: the switch, the live references, and whether the caller may change it.
  settings: (projectUid) => request(`/room-library/settings/${encodeURIComponent(projectUid)}`),
  // The owner only. Turning it off lapses every live reference to the room at once.
  setAllowed: (projectUid, allow) => request(`/room-library/settings/${encodeURIComponent(projectUid)}`, {
    method: 'PUT',
    body: JSON.stringify({ allow_library: Boolean(allow) }),
  }),
};
