/**
 * D484 — the time an approved article goes out, as the review page reads and
 * writes it.
 *
 * The worker stores `publish_at` as UTC and refuses a time with no zone,
 * because "09:00" is a different instant in every reader's browser. The
 * page's `<input type="datetime-local">` gives exactly that zoneless string,
 * so it is read here in THIS browser's zone and sent as UTC, and the stored
 * time is shown back in both: the reader's own clock, and UTC, so two admins
 * in two zones agree on what was set.
 */

/** A `datetime-local` value, read in this browser's zone, as an ISO UTC string; null when it is not a time. */
export function publishAtFromLocal(value) {
  const s = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return null;
  const ms = new Date(s).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** A stored UTC time as `YYYY-MM-DD HH:MM UTC`; null when it does not parse. */
export function utcLabel(iso) {
  const ms = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(ms)) return null;
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** A stored UTC time as a `datetime-local` value in this browser's zone, to prefill the input; '' when none. */
export function localInputValue(iso) {
  const ms = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
