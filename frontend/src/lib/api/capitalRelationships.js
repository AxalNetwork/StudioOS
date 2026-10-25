import { request } from '../api.js';

// D1190 (#3124) — Capital relationships part 2: the tool's Commitments and
// Match reads, on routes/cycle_raise.ts at /api/cycles/raise. The module's own
// gate applies (the venture's founder or an admin).
//   commitments(p)   GET /cycles/raise/capital-relationships/commitments?project=
//                    → { currency, round, totals: { counted_cents, not_counted_cents, by_status, percent_of_target, … },
//                        investors: [{ key, prospect_id, name, chosen, lines: [{ source, status, counted, cents, currency, on, via }] }],
//                        sources: { prospects, round_calls, deals, mercury, closings }, words, basis }
//                    Each investor counts once, by their strongest line; a missing amount is null, never 0.
//                    Mercury's matched credits are read for the venture's founder alone.
//   match(p, q)      GET /cycles/raise/capital-relationships/match?project=&q=&hq_country=&focus=&size_band=&fit=&warm=1&sort=&limit=&offset=
//                    → the fund directory's answer, each fund with { fit, warm_paths, in_pipeline, stage: null };
//                      verified_investors: { count }, never names. `stage` is refused (400).
const MATCH_KEYS = ['q', 'hq_country', 'focus', 'size_band', 'fit', 'warm', 'sort', 'limit', 'offset'];
const project = (projectId) => `project=${encodeURIComponent(String(projectId))}`;
const matchQuery = (q = {}) => {
  const p = new URLSearchParams();
  for (const k of MATCH_KEYS) if (q[k] != null && q[k] !== '') p.set(k, String(q[k]));
  const s = p.toString();
  return s ? `&${s}` : '';
};
export const capitalRelationshipsApi = {
  commitments: (projectId) => request(`/cycles/raise/capital-relationships/commitments?${project(projectId)}`),
  match: (projectId, q) => request(`/cycles/raise/capital-relationships/match?${project(projectId)}${matchQuery(q)}`),
};
