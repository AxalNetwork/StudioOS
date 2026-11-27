/**
 * D1076 (#2968) — the words `GET /api/public/status`'s history is read in.
 *
 * Nothing measures uptime: a day is "No incident reported", an incident's day,
 * or "Not recorded" (before the service's records began). A row counts the
 * days with no incident reported since then, never a percentage.
 */
/** What a history cell says, in words: each strip cell's title. */
export const DAY_WORDS = {
  no_incident: 'No incident reported',
  degraded: 'Incident reported',
  down: 'Outage reported',
  not_recorded: 'Not recorded',
  unknown: 'Not monitored',
};

/** A row's line under its name: the count since records began, never a percentage. */
export function recordLine(s) {
  if (s?.monitoring === 'not_monitored') return 'Not monitored: no history is kept';
  if (typeof s?.days_without_incident !== 'number' || typeof s?.days_recorded !== 'number' || !s?.records_since) return null;
  if (s.days_recorded === 0) return `Not recorded yet: records begin on ${s.records_since}`;
  const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
  return `${days(s.days_without_incident)} of ${days(s.days_recorded)} with no incident reported · records began on ${s.records_since}`;
}
