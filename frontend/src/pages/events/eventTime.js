/** D1131: event UTC timestamps and the event's own calendar day. */
export function eventTime(value) {
  if (!value) return null;
  const s = String(value).trim();
  const iso = s.replace(' ', 'T');
  const t = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`);
  return Number.isFinite(t) ? t : null;
}
export function dayIn(ms, zone) {
  try { return new Date(ms).toLocaleDateString('en-CA', { timeZone: zone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }); }
  catch { return new Date(ms).toISOString().slice(0, 10); }
}
export function onEventDay(event, now = Date.now()) {
  const start = eventTime(event?.starts_at);
  if (start == null) return false;
  const end = eventTime(event?.ends_at) ?? start;
  const zone = event?.timezone || 'UTC';
  const today = dayIn(now, zone);
  return today >= dayIn(start, zone) && today <= dayIn(Math.max(start, end), zone);
}
