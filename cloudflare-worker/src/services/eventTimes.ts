/** D1115: new local clock values belong to the selected IANA zone, not the browser.
 * Explicit-offset instants keep their meaning. Legacy stored rows are not rewritten.
 */
const MESSAGES = {
 invalid_event_time: 'Choose a valid event date and time.',
 invalid_timezone: 'Choose a valid event time zone.',
 nonexistent_event_time: 'That local time is skipped by a clock change. Choose another time.',
 ambiguous_event_time: 'That local time occurs twice during a clock change. Choose an unambiguous time or supply an explicit offset.',
} as const;
type EventTimeCode = keyof typeof MESSAGES;
export const eventTimeMessage = (code: EventTimeCode): string => MESSAGES[code];
export class EventTimeError extends Error {
 code: EventTimeCode;
 constructor(code: EventTimeCode) { super(MESSAGES[code]); this.code = code; }
}
const invalid = () => new EventTimeError('invalid_event_time');
function wallAt(ms: number, zone: string): number {
 const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
 }).formatToParts(ms).map(p => [p.type, p.value]));
 return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
}
function instant(value: unknown, zone: string): string {
 if (typeof value !== 'string') throw invalid();
 if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
  const ms = Date.parse(value); if (!Number.isFinite(ms)) throw invalid();
  return new Date(ms).toISOString();
 }
 const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
 if (!m) throw invalid();
 const [, y, month, day, hour, minute, second = '0'] = m;
 const target = Date.UTC(+y, +month - 1, +day, +hour, +minute, +second);
 const d = new Date(target);
 if (d.getUTCFullYear() !== +y || d.getUTCMonth() !== +month - 1 || d.getUTCDate() !== +day || d.getUTCHours() !== +hour || d.getUTCMinutes() !== +minute || d.getUTCSeconds() !== +second) throw invalid();
 // Collect offsets on both sides of any clock change; keep only exact round trips.
 const offsets = new Set([-36, -12, 0, 12, 36].map(h => { const t = target + h * 3600000; return wallAt(t, zone) - t; }));
 const candidates = [...offsets].map(offset => target - offset).filter(ms => wallAt(ms, zone) === target);
 if (!candidates.length) throw new EventTimeError('nonexistent_event_time');
 if (candidates.length > 1) throw new EventTimeError('ambiguous_event_time');
 return new Date(candidates[0]).toISOString();
}
/** Only supplied fields change. A zone-only update preserves the existing instants. */
export function eventTimeFields(body: Record<string, unknown>, existing?: { timezone?: string }): Record<string, unknown> {
 if (!['timezone', 'starts_at', 'ends_at'].some(key => key in body)) return {};
 const zone = body.timezone ?? existing?.timezone ?? 'UTC';
 try { if (typeof zone !== 'string' || !zone) throw invalid(); new Intl.DateTimeFormat('en-GB', { timeZone: zone }); }
 catch { throw new EventTimeError('invalid_timezone'); }
 const out: Record<string, unknown> = {};
 if ('timezone' in body) out.timezone = zone;
 if ('starts_at' in body) out.starts_at = instant(body.starts_at, zone as string);
 if ('ends_at' in body) out.ends_at = body.ends_at === null || body.ends_at === '' ? null : instant(body.ends_at, zone as string);
 return out;
}
/** Existing offset-free D1 timestamps are UTC. Formatting alone is not a schedule edit. */
export function sameEventInstant(a: unknown, b: unknown): boolean {
 if (a === b) return true;
 if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
 const stamp = (value: string) => Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : value.replace(' ', 'T') + 'Z');
 return stamp(a) === stamp(b);
}
