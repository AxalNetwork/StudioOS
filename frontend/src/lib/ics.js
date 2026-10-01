/**
 * An iCalendar (.ics) file, built in the browser from rows already on screen.
 *
 * Lifted out of `pages/advisor/practice/SessionsZone.jsx` (D393) so the
 * Cohorts calendar can export the same way: nothing leaves the browser, no
 * endpoint is needed, and one escaping rule serves both.
 *
 * An event with no end is written with DTSTART only — a point in time, which
 * is what a Lab deadline or a week opening is. Inventing a one-hour block for
 * it would put a meeting in someone's calendar that nobody scheduled.
 */

/** RFC 5545 TEXT escaping: backslash, semicolon, comma, and newlines. */
export const icsText = (s) => String(s ?? '').replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\r?\n/g, '\\n');

/** An ISO timestamp as a UTC DATE-TIME, or null when it does not parse. */
export function icsStamp(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${d.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/**
 * `events`: `{ uid, start, end?, summary, description? }`. An event whose start
 * does not parse is skipped rather than written with a guessed date.
 */
export function buildIcs({ prodId, events }) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${prodId}`];
  for (const e of events || []) {
    const start = icsStamp(e.start);
    if (!start) continue;
    const end = icsStamp(e.end);
    lines.push('BEGIN:VEVENT', `UID:${icsText(e.uid)}@axal.vc`, `DTSTART:${start}`);
    if (end) lines.push(`DTEND:${end}`);
    lines.push(`SUMMARY:${icsText(e.summary || 'Event')}`, `DESCRIPTION:${icsText(e.description || '')}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/** Hand the file to the browser as a download. */
export function downloadIcs(text, filename) {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
