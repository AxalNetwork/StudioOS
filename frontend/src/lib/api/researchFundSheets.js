// Research › Funds Google Sheets sync client (D7170, #7170): status, connect, the tab list by gid, the destination, the export and import previews and runs, and reconcile.
//
// Every route is Super Admin only (`requireSuperAdmin` in routes/research.ts).
// `exportRun` and `importRun` carry an idempotency key the page makes once per
// reviewed run, so sending the same run twice answers the first one instead of
// writing again. `pull` is Export and `push` is Import on the Worker.
import { request } from '../api.js';

// A run reads the tab, writes and reads back, each a Google call of up to 15s.
const SLOW = 90_000;
const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body || {}), timeoutMs: SLOW });

export const researchFundSheetsApi = {
  status: () => request('/research/funds/sheet/status'),
  connect: () => request('/research/funds/sheet/connect', { method: 'POST' }),
  disconnect: () => request('/research/funds/sheet/disconnect', { method: 'POST' }),
  tabs: (url) => request(`/research/funds/sheet/tabs${url ? `?url=${encodeURIComponent(url)}` : ''}`, { timeoutMs: SLOW }),
  saveDestination: ({ url, sheetGid = null, createTab = null }) => request('/research/funds/sheet/link', {
    method: 'PATCH',
    body: JSON.stringify({ url, sheet_gid: sheetGid, create_tab: createTab }),
    timeoutMs: SLOW,
  }),
  exportPreview: (fields) => post('/research/funds/sheet/export/preview', { fields }),
  importPreview: (fields, resolutions) => post('/research/funds/sheet/import/preview', { fields, resolutions }),
  exportRun: ({ fields, idempotencyKey }) => post('/research/funds/sheet/pull', { fields, idempotency_key: idempotencyKey }),
  importRun: ({ fields, resolutions, idempotencyKey }) => post('/research/funds/sheet/push', {
    fields, resolutions, idempotency_key: idempotencyKey,
  }),
  reconcile: (runUid, write) => post(`/research/funds/sheet/runs/${encodeURIComponent(runUid)}/reconcile`, { write: !!write }),
};
