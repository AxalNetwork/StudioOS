/**
 * A stored time as epoch milliseconds, or `null` when there is none.
 *
 * D1 writes `CURRENT_TIMESTAMP` as "YYYY-MM-DD HH:MM:SS" with no zone, and
 * that time is UTC. `Date.parse` reads a zone-less stamp as the viewer's local
 * time, so a page that hands it one straight draws every date a few hours off,
 * and a day off near midnight. This reads such a stamp as UTC; an ISO stamp
 * that carries its own zone (`expires_at`'s `Z`, an editor's `+02:00`) is read
 * as it is written.
 *
 * Written for the Events desk (D915) and moved here by D923 (#2370), so the
 * Events desk and Partner invitations read a stamp by one rule. Pure: no
 * React, so a page's model imports this file itself and stays loadable in a
 * plain `node --test`.
 */
export function parseStamp(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
