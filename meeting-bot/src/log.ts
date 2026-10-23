/**
 * D886 B2 (#2580): the only way the bot writes a log line.
 *
 * #2577's privacy rule: no meeting link, passcode, participant name or
 * transcript text in a log line. So a line takes an event name and fields
 * whose values are numbers, booleans or one of the bot's own codes. Any other
 * string is dropped before it is written, whatever key it came under, and an
 * adapter's error message is never passed in at all.
 */
import type { LogSink } from './types.ts';

const CODES: ReadonlySet<string> = new Set([
  // platforms
  'zoom', 'google_meet', 'teams',
  // states
  'joining', 'waiting_room', 'recording', 'left', 'failed',
  // failure codes
  'not_admitted', 'meeting_ended', 'link_invalid', 'platform_blocked', 'obf_unavailable',
  // leave reasons
  'call_ended', 'alone', 'stopped', 'time_limit',
]);

export type LogValue = string | number | boolean;

/** The fields a line may carry: numbers and booleans as given, strings only when they are one of the codes above. */
export function safeFields(fields: Record<string, unknown>): Record<string, LogValue> {
  const out: Record<string, LogValue> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!/^[a-z_]{1,32}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && CODES.has(v)) out[k] = v;
  }
  return out;
}

/** One line: `meeting_bot.<event>` plus safe fields. Event names are code-like or the line is not written. */
export function logLine(sink: LogSink, event: string, fields: Record<string, unknown> = {}): void {
  if (!/^[a-z_]{1,40}$/.test(event)) return;
  sink(`meeting_bot.${event}`, safeFields(fields));
}

/** Writes JSON lines to stdout. */
export const consoleSink: LogSink = (event, fields) => {
  console.log(JSON.stringify({ event, ...fields }));
};
