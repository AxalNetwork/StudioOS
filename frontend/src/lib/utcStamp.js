/**
 * D515 — a stored UTC timestamp, shown with its zone.
 *
 * `last_health_at` is SQLite `datetime('now')`, which is UTC. HQ's deploy
 * rows printed it as a bare date or date-time, so a reader east or west of
 * Greenwich read it as their own clock. These label it instead. Null in,
 * null out: no stamp is never shown as a date.
 */
const shape = (v) => {
  if (v == null || v === '') return null;
  const s = String(v).replace('T', ' ');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s : null;
};

/** 'YYYY-MM-DD HH:MM UTC', or null. */
export function utcMinute(v) {
  const s = shape(v);
  return s ? `${s.slice(0, 16)} UTC` : null;
}

/** 'YYYY-MM-DD UTC', or null. */
export function utcDay(v) {
  const s = shape(v);
  return s ? `${s.slice(0, 10)} UTC` : null;
}
