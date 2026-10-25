import { request } from '../api.js';

// D845 (#2471) — a member's own usage reports over api_usage_events (D843), on
// routes/developer_usage.ts. Signed in with a session; the caller's own rows
// only, and a `key` that is not one of theirs answers 404 `unknown_key`. Ranges are
// UTC days, at most 92; without them, the last 30 days.
//   report  GET /developer/usage          { from, to, group, by, key, cursor }
//                                          → { recorded, recorded_since, range, group, by, key,
//                                              totals, groups: [{ key, label, by_key?, by_label?, calls, ok,
//                                              errors, refused, rate_limited, insufficient_tokens, error,
//                                              charged_microusd|null, refunded_microusd|null,
//                                              metered_calls, p50_ms|null }], next_cursor }
//   events  GET /developer/usage/events   { from, to, key, outcome, surface, operation, provider,
//                                           connector, company, cursor } → { range, events, next_cursor }
//   keys    GET /developer/usage/keys     { month }  → { month, near_limit_percent, keys: [{ uid, name,
//                                              key_id, live, monthly_limit_microusd|null, calls,
//                                              charged_microusd|null, metered_calls, used_percent|null,
//                                              alert: 'near_limit'|'at_limit'|null }] }
// A NULL charge means "not metered", never nothing spent.
function query(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const developerUsageApi = {
  report: (params) => request(`/developer/usage${query(params)}`),
  events: (params) => request(`/developer/usage/events${query(params)}`),
  keys: (params) => request(`/developer/usage/keys${query(params)}`),
};
