import { request } from '../api.js';

// D6070 (#6070) — the Investor narrative's export log, on routes/narrative_exports.ts.
// Every call names the venture (`?project=`); its founder, or an admin with a live read reason.
//   narrativeExportLog(pid)          GET  /narrative-exports → { exports: [{ id, version, format, by, created_at }] }
//   narrativeExportRecord(pid, body) POST /narrative-exports { version, format: 'pdf' | 'text' } → 201 { export }
// The page makes the file (or an admin's copy) only after the record answers 201. An admin's PDF is 403
// `admin_copy_only`; version 0 is 409 `live_deck_not_exported`; a log that cannot be written is 503 `export_not_recorded`.
const enc = encodeURIComponent;

export const narrativeExportsApi = {
  log: (projectId) => request(`/narrative-exports?project=${enc(projectId)}`),
  record: (projectId, body) => request(`/narrative-exports?project=${enc(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
};
