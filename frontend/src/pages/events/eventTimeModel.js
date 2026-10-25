/** D1115: display a saved instant in the event's zone. The Worker converts new wall times. */
const storedStamp = value => /(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(value)) ? String(value) : String(value).replace(' ', 'T') + 'Z';
export function eventLocalInput(value, timezone) {
  if (!value) return '';
  const stamp = storedStamp(value);
  const date = new Date(stamp);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  } catch { return ''; }
}
/** Preserve seconds and explicit offsets (including the second DST occurrence) on an unchanged edit. */
export function eventTimePayload(form, saved) {
  const value = key => {
    if (!form[key]) return null;
    if (saved && form.timezone === (saved.timezone || 'UTC') && form[key] === eventLocalInput(saved[key], form.timezone)) return storedStamp(saved[key]);
    return form[key];
  };
  return { starts_at: value('starts_at'), ends_at: value('ends_at'), timezone: form.timezone };
}
