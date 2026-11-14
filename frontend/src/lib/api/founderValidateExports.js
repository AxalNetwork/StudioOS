// D6019 (#6019) — Validate's three further CSV exports: the competitor list, the demand signals, and the evidence
// behind each claim with its experiments. Worker: routes/founder_validate.ts (`/founder/validate/<what>/:id/export.csv`),
// serialized by routes/_founder_validate_exports.ts. A refused export (403, or 503 `evidence_unreadable` when a source
// could not be read) throws with the Worker's sentence, through `api._downloadCsv` as the three older exports do.
import { api } from '../api.js';

export const validateExportsApi = {
  competitors: (projectId) =>
    api._downloadCsv(`/founder/validate/competitors/${projectId}/export.csv`, 'competitors.csv'),
  signals: (projectId) =>
    api._downloadCsv(`/founder/validate/signals/${projectId}/export.csv`, 'demand-signals.csv'),
  evidence: (projectId) =>
    api._downloadCsv(`/founder/validate/evidence/${projectId}/export.csv`, 'hypothesis-evidence.csv'),
};
