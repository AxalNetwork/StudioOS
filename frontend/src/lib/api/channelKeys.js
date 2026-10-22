import { request } from '../api.js';

// D885 (#2561) — the interview channels' Worker secrets, in HQ › Integration
// keys › Channels, on routes/admin_integration_keys.ts. Super Admin, and every
// write behind the write bar. The list comes with `GET /admin/integration-keys`
// (its `channels`); a value is never read back, and a generated one is
// returned once, by `rotate` with `generate: true`.
//   set     PUT    /admin/integration-keys/channels/:channel          { <SECRET_NAME>: value, ... }
//   rotate  POST   /admin/integration-keys/channels/:channel/rotate   { name, value } | { name, generate: true }
//   remove  DELETE /admin/integration-keys/channels/:channel
const enc = encodeURIComponent;

export const channelKeysApi = {
  set: (channel, values) => request(`/admin/integration-keys/channels/${enc(channel)}`, {
    method: 'PUT', body: JSON.stringify(values || {}),
  }),
  rotate: (channel, name, value) => request(`/admin/integration-keys/channels/${enc(channel)}/rotate`, {
    method: 'POST', body: JSON.stringify({ name, value }),
  }),
  generate: (channel, name) => request(`/admin/integration-keys/channels/${enc(channel)}/rotate`, {
    method: 'POST', body: JSON.stringify({ name, generate: true }),
  }),
  remove: (channel) => request(`/admin/integration-keys/channels/${enc(channel)}`, { method: 'DELETE' }),
};
