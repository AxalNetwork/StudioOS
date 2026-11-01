// D1490 (#3904) — event syndication: HQ's channel accounts and one event's listings.
// Worker: routes/admin_event_syndication.ts and routes/event_syndication.ts over
// services/eventSyndication/. Part A has no adapter: every channel reads
// `adapter_ready: false` and Connect answers 409 adapter_not_ready.
//
// HQ (`/api/admin/event-syndication`):
//   GET   /channels                   → { channels: [{ channel, capability|null, adapter_ready, account|null }] }   Super Admin
//   POST  /channels/:channel/connect  { api_key } or {} → 201 { account } | { authorize_url }                      write bar
//   PATCH /channels/:uid              { default_on } → { account }
//   POST  /channels/:uid/disconnect   → { account } (posted listings stay up)
//   GET   /settings | PUT /settings   { hosts, default_channels_by_type, host_accounts } → { settings }
//   GET   /log?event=&channel=&outcome=&before=&limit= → { rows: [{ id, at, event|null, channel, action, outcome, detail,
//         http_status, actor_name|null }], next }
//   An account is { uid, channel, owner_kind, display_name, status, expires_at, last_error, default_on,
//   connected_by_name, connected_at }; it never carries credentials.
//
// One event (`/api/events/:id/syndication`, host or admin; anyone else 404):
//   GET  → { eligible, reason|null, rows: [{ uid|null, channel, account_uid, display_name, capability, on, status,
//         sync_state, skip_reason, last_error, external_url, posted_at, registrations: null, registrations_reason }] }
//   PUT  { channels: [{ account_uid, on, overrides?: { title?, description?, ticket_url? } }] } → the same shape
//   POST /preview { account_uid, overrides? } → { channel, capability, title, text, link, cover_url, warnings }
//   POST /:uid/retry | /:uid/withdraw → { row }
// `registrations` stays null with "Not recorded: …" until registrations are imported (Part D); never 0.
import { request } from '../api.js';

const enc = encodeURIComponent;
const BASE = '/admin/event-syndication';
const send = (path, method, body) => request(path, { method, body: JSON.stringify(body ?? {}) });

export const eventSyndicationApi = {
  channels: () => request(`${BASE}/channels`),
  connect: (channel, body = {}) => send(`${BASE}/channels/${enc(channel)}/connect`, 'POST', body),
  updateChannel: (uid, patch) => send(`${BASE}/channels/${enc(uid)}`, 'PATCH', patch),
  disconnect: (uid) => send(`${BASE}/channels/${enc(uid)}/disconnect`, 'POST', {}),
  settings: () => request(`${BASE}/settings`),
  saveSettings: (settings) => send(`${BASE}/settings`, 'PUT', settings),
  log: (filters = {}) => {
    const qs = new URLSearchParams();
    for (const k of ['event', 'channel', 'outcome', 'before', 'limit']) if (filters[k] != null && filters[k] !== '') qs.set(k, String(filters[k]));
    const s = qs.toString();
    return request(`${BASE}/log${s ? `?${s}` : ''}`);
  },
  forEvent: (eventId) => request(`/events/${enc(eventId)}/syndication`),
  choose: (eventId, channels) => send(`/events/${enc(eventId)}/syndication`, 'PUT', { channels }),
  preview: (eventId, accountUid, overrides) => send(`/events/${enc(eventId)}/syndication/preview`, 'POST', { account_uid: accountUid, ...(overrides ? { overrides } : {}) }),
  retry: (eventId, uid) => send(`/events/${enc(eventId)}/syndication/${enc(uid)}/retry`, 'POST', {}),
  withdraw: (eventId, uid) => send(`/events/${enc(eventId)}/syndication/${enc(uid)}/withdraw`, 'POST', {}),
};
