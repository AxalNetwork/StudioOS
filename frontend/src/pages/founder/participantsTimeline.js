/**
 * #4018 (#3710 REC3, `Interview Record Page.dc.html` frames `rec3` and
 * `rec6a`): the session page's participants timeline, pure.
 *
 * Each person in the bot's latest roster is a bar from `joined_ms` to
 * `left_ms` across the call's length, and the bot ("Eadwyn AI") is a bar
 * across all of it. The call's length runs from the bot's `started_at` to its
 * `ended_at`, or to now while it records. A person still in the latest roster
 * (`left_ms` null) runs to the end: now while recording, else the call's end.
 *
 * Once transcribed, each person whose name matches a speaker label carries
 * that speaker's share of the final segments' durations. A label that matches
 * no one is left out, and a person no label matches shows no share: never an
 * invented one, never "0%".
 *
 * Names only. The Worker already turns an email-looking name into
 * "Participant n" (`services/meetingBotParticipants.ts`); this does the same
 * again, so an address can never be drawn.
 */

export const BOT_NAME = 'Eadwyn AI';
export const READING = 'Reading participants…';
export const UNREADABLE = 'Unreadable: the participants could not be read.';
export const NOT_RECORDED = 'Not recorded: the bot has not sent a roster.';
export const NO_ONE = 'No participants in the latest roster.';
export const NO_LENGTH = 'Not recorded: the call’s length is not known yet.';

const ms = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
const epoch = (v) => (Number.isFinite(v) && v > 0 ? v : null);
const key = (s) => String(s ?? '').trim().toLowerCase();

/** "0:00", "12:05", "1:02:05". */
export function clock(value) {
  const t = ms(value);
  if (t === null) return null;
  const s = Math.floor(t / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** A name to draw: never an address. */
export function nameOf(raw, index) {
  const n = typeof raw === 'string' ? raw.trim() : '';
  return n && !n.includes('@') ? n : `Participant ${index + 1}`;
}

/** The call's length in ms, from the bot read; null when it cannot be known. */
export function callLength(bot, now = Date.now()) {
  const start = epoch(bot?.started_at);
  if (start === null) return null;
  const end = epoch(bot?.ended_at) ?? (bot?.status === 'recording' ? epoch(now) : null);
  return end !== null && end >= start ? end - start : null;
}

/**
 * Each speaker label's share of the final segments' durations, as whole
 * percents, keyed by the label lowercased. Only `source: 'final'` segments
 * with a whole, non-negative duration count; nothing counts, nothing shows.
 */
export function speakerShares(segments) {
  const totals = new Map();
  let all = 0;
  for (const s of Array.isArray(segments) ? segments : []) {
    if (s?.source !== 'final') continue;
    const a = Number(s.start_ms);
    const b = Number(s.end_ms);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    all += b - a;
    const label = key(s.speaker_label);
    if (label) totals.set(label, (totals.get(label) || 0) + (b - a));
  }
  const out = new Map();
  if (all <= 0) return out;
  for (const [label, d] of totals) out.set(label, Math.round((d / all) * 100));
  return out;
}

/**
 * The timeline to draw:
 *   { state: 'reading' | 'unreadable' | 'not_recorded' | 'ready', line, length,
 *     ticks: [ '0:00', '<length>' ] | null,
 *     rows: [{ key, name, bot, joined, left, open, from, width, share }] }
 * `from` and `width` are percents of the call's length, or null when the
 * length or the times are not known.
 */
export function timelineOf({ participants, bot = null, segments = [], now = Date.now() }) {
  if (participants === undefined) return { state: 'reading', line: READING, rows: [], length: null, ticks: null };
  if (participants === 'unreadable' || (participants !== null && !Array.isArray(participants))) {
    return { state: 'unreadable', line: UNREADABLE, rows: [], length: null, ticks: null };
  }
  if (participants === null) return { state: 'not_recorded', line: NOT_RECORDED, rows: [], length: null, ticks: null };
  const length = callLength(bot, now);
  const recording = bot?.status === 'recording';
  const shares = speakerShares(segments);
  const pct = (v) => (length ? Math.max(0, Math.min(100, (v / length) * 100)) : null);
  const rows = [{ key: 'bot', name: BOT_NAME, bot: true, joined: 0, left: length, open: recording, from: length ? 0 : null, width: length ? 100 : null, share: null }];
  participants.forEach((p, i) => {
    const name = nameOf(p?.display_name, i);
    const joined = ms(p?.joined_ms);
    const left = p?.left_ms === null ? null : ms(p?.left_ms);
    const open = p?.left_ms === null;
    const end = open ? length : left;
    const known = length !== null && joined !== null && end !== null && end >= joined;
    const share = shares.has(key(name)) ? shares.get(key(name)) : null;
    rows.push({
      key: `p-${i}`, name, bot: false, joined, left, open,
      from: known ? pct(joined) : null,
      width: known ? Math.max(pct(end) - pct(joined), 0) : null,
      share,
    });
  });
  return {
    state: 'ready',
    line: participants.length ? (length === null ? NO_LENGTH : null) : NO_ONE,
    rows,
    length,
    ticks: length === null ? null : [clock(0), clock(length)],
  };
}
