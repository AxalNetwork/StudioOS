import { api, request } from '../api.js';

// D1103 (#2983) — Data room part 2: the founder's own files, versions, a
// grant's end date and folders, and the preview, on routes/data_room.ts at
// /api/data-room. Today's room calls (`api.dataRoom`, the folder and file
// writes, the grant writes) stay in api.js; these are the new ones.
//   download(p, uid)              POST  /data-room/:p/files/:uid/download → { url, expires_at, name, version: null }
//   versions(p, uid)              GET   /data-room/:p/files/:uid/versions → { file, current, versions: [{ version, content_type, size_bytes, uploaded_by_name, created_at }] }
//   downloadVersion(p, uid, n)    POST  /data-room/:p/files/:uid/versions/:n/download → { url, expires_at, name, version }
//   makeCurrent(p, uid, n)        POST  /data-room/:p/files/:uid/versions/:n/current → { ok, version }; 409 version_conflict
//   updateGrant(p, uid, body)     PATCH /data-room/:p/grants/:uid { expires_at?: 'YYYY-MM-DD' | null, folders?: [folderUid] | null } → { ok }
//   preview(p, grantUid)          GET   /data-room/:p/preview?grant= → { grant_uid, open, folders, files, withheld_behind_nda, hidden_from_grant }
// `folders: null` opens every folder. Sharing, revoking, a grant change and a
// gate are the owner's: a co-founder gets 403 { code: 'owner_only' }.
//
// D1104 (#2984) — Data room part 3: the access-request queue and the founder's NDA.
//   requests(p)                   GET   /data-room/:p/requests → { requests: [{ uid, investor, source, round_call, message, state, created_at, decided_at, decided_by, decline_reason, nda, has_access }], open, can_answer }; 503 requests_unreadable
//   acceptRequest(p, uid, body)   POST  /data-room/:p/requests/:uid/accept { expires_at?, folders? } → { ok, state }; 409 request_decided
//   declineRequest(p, uid, reason) POST /data-room/:p/requests/:uid/decline { reason } → { ok, state }; 409 request_decided
//   sendNda(p, grantUid)          POST  /data-room/:p/grants/:uid/nda → { status: 'envelope_issued', envelope_uuid, signing_url }; 409 nda_active | nda_pending; 404 for an admin (D1102), 403 founder_only
// D1107 (#2987) — Data room part 6, Access and Share:
//   shareCandidates(p)            GET   /data-room/:p/share-candidates → { candidates: [{ uid, name, firm, stage, email }] }; 403 owner_only
//   share(p, body)                POST  /data-room/:p/grants { prospect, expires_at?, folders? } → { ok }; the address is read from this venture's prospect; 400 no_email, 404 another venture's
//   The requests read also carries `diligence: [{ id, title, state, created_at, responded_at, reviewed_at, files: [{ uid, name }] }]`, or null with `diligence_unreadable`.
// D1105 (#2985) — Data room part 4, the owner's and a co-founder's reads:
//   activity(p, q)     GET /data-room/:p/activity?from&to&investor&action&page
//                      → { period, previous_period, filters, daily: [{ day, opened, downloaded, blocked }],
//                          totals, previous, investors: [{ grant_uid, name, email, last_at, opened, downloaded, blocked }],
//                          log: { total, page, page_size, pages, rows: [{ at, action, investor, file }] } }
//   activityCsv(p, q)  GET /data-room/:p/activity.csv?… (the same rows; 413 too_many_rows past 10,000)
//   checklist(p)       GET /data-room/:p/checklist → { grants_in_force, totals, items: [{ key, area, label, state, reason, files }] }
// A refusal (`blocked`) is never counted as an open. `investor` is a grant's uid.
const seg = (v) => encodeURIComponent(String(v));
const activityQuery = (q = {}) => {
  const p = new URLSearchParams();
  for (const k of ['from', 'to', 'investor', 'action', 'page']) if (q[k] != null && q[k] !== '') p.set(k, String(q[k]));
  const s = p.toString();
  return s ? `?${s}` : '';
};
export const dataRoomApi = {
  download: (projectUid, uid) => request(`/data-room/${seg(projectUid)}/files/${seg(uid)}/download`, { method: 'POST' }),
  versions: (projectUid, uid) => request(`/data-room/${seg(projectUid)}/files/${seg(uid)}/versions`),
  downloadVersion: (projectUid, uid, n) => request(`/data-room/${seg(projectUid)}/files/${seg(uid)}/versions/${seg(n)}/download`, { method: 'POST' }),
  makeCurrent: (projectUid, uid, n) => request(`/data-room/${seg(projectUid)}/files/${seg(uid)}/versions/${seg(n)}/current`, { method: 'POST' }),
  updateGrant: (projectUid, uid, body) => request(`/data-room/${seg(projectUid)}/grants/${seg(uid)}`, { method: 'PATCH', body: JSON.stringify(body || {}) }),
  preview: (projectUid, grantUid) => request(`/data-room/${seg(projectUid)}/preview?grant=${seg(grantUid)}`),
  requests: (projectUid) => request(`/data-room/${seg(projectUid)}/requests`),
  acceptRequest: (projectUid, uid, body) => request(`/data-room/${seg(projectUid)}/requests/${seg(uid)}/accept`, { method: 'POST', body: JSON.stringify(body || {}) }),
  declineRequest: (projectUid, uid, reason) => request(`/data-room/${seg(projectUid)}/requests/${seg(uid)}/decline`, { method: 'POST', body: JSON.stringify({ reason }) }),
  shareCandidates: (projectUid) => request(`/data-room/${seg(projectUid)}/share-candidates`),
  share: (projectUid, body) => request(`/data-room/${seg(projectUid)}/grants`, { method: 'POST', body: JSON.stringify(body || {}) }),
  sendNda: (projectUid, grantUid) => request(`/data-room/${seg(projectUid)}/grants/${seg(grantUid)}/nda`, { method: 'POST' }),
  activity: (projectUid, q) => request(`/data-room/${seg(projectUid)}/activity${activityQuery(q)}`),
  activityCsv: (projectUid, q) => api._downloadCsv(`/data-room/${seg(projectUid)}/activity.csv${activityQuery(q)}`, 'data-room-activity.csv'),
  checklist: (projectUid) => request(`/data-room/${seg(projectUid)}/checklist`),
};
