import { request } from '../api.js';

// D1361 — the OAuth client a Lovable custom connector signs Axal VC members in
// with, in HQ › Integration keys, on routes/admin_connector_clients.ts. Super
// Admin only. The secret is returned once, by `createLovable`; a read never
// carries it. Creating again replaces the client (the old one stops working).
//   get     GET  /admin/connector-clients/lovable
//   create  POST /admin/connector-clients/lovable
export const connectorClientsApi = {
  getLovable: () => request('/admin/connector-clients/lovable'),
  createLovable: () => request('/admin/connector-clients/lovable', { method: 'POST', body: JSON.stringify({}) }),
};
