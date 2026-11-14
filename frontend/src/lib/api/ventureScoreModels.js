// D1259 (#3282, part 6 of #2428) — HQ › Scoring: the venture model versions
// and Publish, and the country indices model v1.1 reads.
// Worker: routes/venture_score_models.ts over services/ventureScoring/publish.ts
// and countryIndex.ts, migration 627. Reads are HQ admin; both writes take the
// Super Admin write bar (a TOTP session and a fresh step-up: the global
// step-up prompt asks for the authenticator code).
//   GET  /api/venture-scores/hq/models                  → { live, draft: { version, changes, ventures, minutes } | null, versions }
//   POST /api/venture-scores/models/:version/publish    → { ok, version, published_at, ventures_total }
//   GET  /api/venture-scores/hq/indices                 → { sources: [{ key, name, publisher, kind, licence, licence_note, editions }] }
//   POST /api/venture-scores/hq/indices/:source/import  { edition, published_on, countries? } → { ok, source, edition, value_count, countries }
// A source whose licence is null is refused at import (409 licence_not_recorded) and never read.
import { request } from '../api.js';

export const ventureScoreModelsApi = {
  models: () => request('/venture-scores/hq/models'),
  publish: (version) => request(`/venture-scores/models/${encodeURIComponent(version)}/publish`, { method: 'POST' }),
  indices: () => request('/venture-scores/hq/indices'),
  importIndex: (source, body) => request(`/venture-scores/hq/indices/${encodeURIComponent(source)}/import`, { method: 'POST', body: JSON.stringify(body) }),
};
