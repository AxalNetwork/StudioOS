/**
 * D886 (#2584, B6 of #2577) — the meeting bot's transcript, assembled: the
 * diarized text, the platform's active-speaker timeline and the roster become
 * named passages and the participant list. Pure: no I/O, no model call.
 *
 * WHAT COMES IN.
 *   - Passages from Nova-3 with diarization (`sttFormats.ts`), one transcribed
 *     chunk at a time, each with the chunk's `seq` and times from the start of
 *     the recording (the chunk's offset already added, as D870's
 *     `transcribeStoredChunks` does).
 *   - The runtime's events (B2, #2580), on the same clock:
 *       join / leave / rename  — the roster, by the platform's participant id;
 *       active_speaker         — the platform's own indicator: from `at_ms` the
 *                                participant named is speaking, until the next
 *                                active_speaker event (`participant_id: null`
 *                                is silence).
 *
 * WHY PER CHUNK. Nova-3 numbers speakers within one request: its speaker 0 in
 * one chunk need not be speaker 0 in the next. So a speaker is a (chunk,
 * speaker) pair here, and each pair is matched against the timeline inside its
 * own chunk. The timeline is what carries a person across the call.
 *
 * THE RULE. A pair is named after the participant whose active-speaker time
 * overlaps its passages most, when:
 *   - that overlap is more than zero,
 *   - it is strictly more than any other participant's (a tie names no one),
 *   - and it covers at least MIN_SHARE of the pair's own speaking time.
 * Otherwise the pair keeps a neutral label, "Speaker N", numbered across the
 * call in order of first speech, never a guess. Two unnamed pairs in different
 * chunks may be one person; they are numbered apart, because nothing says so.
 *
 * NAMES. A participant's label is their last display name (a rename mid-call
 * names all their passages). The founder is "Me" when a participant's name
 * matches the founder's display name. A display name that is an email address
 * is never shown: it reads "Participant N". The bot itself ("Eadwyn AI", or
 * any participant the runtime marks `is_bot`) is never a speaker or a
 * participant. Display names only: no email, no platform id leaves this module.
 */
import type { SttSegment } from '../sttFormats';

/** The share of a speaker's own talk that the chosen participant's indicator must cover. */
export const MIN_SHARE = 0.25;
/** The bot's display name (#2577, owner decision 1). */
export const BOT_NAME = 'Eadwyn AI';

export interface BotPassage extends SttSegment { chunk: number }

export type BotEvent =
  | { type: 'join'; participant_id: string; name: string; at_ms: number; is_bot?: boolean }
  | { type: 'leave'; participant_id: string; at_ms: number }
  | { type: 'rename'; participant_id: string; name: string; at_ms: number }
  | { type: 'active_speaker'; participant_id: string | null; at_ms: number };

export interface NamedPassage { start_ms: number | null; end_ms: number | null; text: string; speaker: string }
export interface Participant { name: string; joined_at_ms: number; left_at_ms: number | null }

export interface Assembled {
  passages: NamedPassage[];
  participants: Participant[];
  /** Counts only, for a log line or a receipt: never a name. */
  stats: { speakers: number; named: number; unnamed: number; participants: number };
}

interface Person { id: string; name: string; joins: Array<[number, number | null]>; bot: boolean }

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const norm = (s: string | null | undefined) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** The roster by participant id, renames applied in time order. */
function rosterOf(events: readonly BotEvent[]): Map<string, Person> {
  const people = new Map<string, Person>();
  const sorted = [...events].sort((a, b) => a.at_ms - b.at_ms);
  for (const e of sorted) {
    if (e.type === 'join') {
      const p = people.get(e.participant_id) ?? { id: e.participant_id, name: e.name, joins: [], bot: false };
      p.name = e.name || p.name;
      p.bot = p.bot || e.is_bot === true || norm(e.name) === norm(BOT_NAME);
      p.joins.push([e.at_ms, null]);
      people.set(e.participant_id, p);
    } else if (e.type === 'leave') {
      const open = people.get(e.participant_id)?.joins.find((j) => j[1] === null);
      if (open) open[1] = e.at_ms;
    } else if (e.type === 'rename') {
      const p = people.get(e.participant_id);
      if (p && e.name) p.name = e.name;
    }
  }
  return people;
}

/** Who the platform showed speaking, as [participant, from, to) intervals; silence and the bot leave gaps. */
export function speakerIntervals(events: readonly BotEvent[], endMs: number, bots: ReadonlySet<string> = new Set()): Array<{ id: string; from: number; to: number }> {
  const marks = events.filter((e): e is Extract<BotEvent, { type: 'active_speaker' }> => e.type === 'active_speaker')
    .sort((a, b) => a.at_ms - b.at_ms);
  const out: Array<{ id: string; from: number; to: number }> = [];
  for (let i = 0; i < marks.length; i += 1) {
    const m = marks[i];
    const to = i + 1 < marks.length ? marks[i + 1].at_ms : endMs;
    if (m.participant_id === null || bots.has(m.participant_id) || to <= m.at_ms) continue;
    out.push({ id: m.participant_id, from: m.at_ms, to });
  }
  return out;
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** The participant id a (chunk, speaker) pair is, or null: the rule above. */
export function matchSpeaker(
  passages: readonly { start_ms: number | null; end_ms: number | null }[],
  intervals: readonly { id: string; from: number; to: number }[],
): string | null {
  const timed = passages.filter((p) => p.start_ms !== null && p.end_ms !== null && p.end_ms > p.start_ms) as Array<{ start_ms: number; end_ms: number }>;
  const talk = timed.reduce((n, p) => n + (p.end_ms - p.start_ms), 0);
  if (!talk) return null;
  const by = new Map<string, number>();
  for (const p of timed) for (const iv of intervals) {
    const o = overlap(p.start_ms, p.end_ms, iv.from, iv.to);
    if (o > 0) by.set(iv.id, (by.get(iv.id) ?? 0) + o);
  }
  const ranked = [...by.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const [[id, best], second] = [ranked[0], ranked[1]];
  if (second && second[1] === best) return null;
  return best / talk >= MIN_SHARE ? id : null;
}

/**
 * The bot run's passages, named, and its participants. `founderName` is the
 * founder's display name in StudioOS; `endMs` closes the last indicator span
 * (the recording's length).
 */
export function assembleBotTranscript(
  passages: readonly BotPassage[], events: readonly BotEvent[], opts: { founderName?: string | null; endMs: number },
): Assembled {
  const people = rosterOf(events);
  const bots = new Set([...people.values()].filter((p) => p.bot).map((p) => p.id));
  const intervals = speakerIntervals(events, opts.endMs, bots);
  const founder = norm(opts.founderName);

  // A shown name for each human participant, in order of joining: the founder's "Me", an email's "Participant N".
  let hidden = 0;
  const shown = new Map<string, string>();
  const humans = [...people.values()].filter((p) => !p.bot).sort((a, b) => (a.joins[0]?.[0] ?? 0) - (b.joins[0]?.[0] ?? 0));
  for (const p of humans) {
    const name = String(p.name ?? '').trim().replace(/\s+/g, ' ');
    if (founder && norm(name) === founder) shown.set(p.id, 'Me');
    else if (!name || EMAIL.test(name)) { hidden += 1; shown.set(p.id, `Participant ${hidden}`); }
    else shown.set(p.id, name);
  }

  // Each (chunk, speaker) pair, in order of first speech.
  const ordered = [...passages].sort((a, b) => (a.start_ms ?? 0) - (b.start_ms ?? 0));
  const pairs = new Map<string, BotPassage[]>();
  for (const p of ordered) {
    const key = `${p.chunk}:${p.speaker ?? 'none'}`;
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key)!.push(p);
  }
  const label = new Map<string, string>();
  let unnamed = 0;
  let named = 0;
  for (const [key, list] of pairs) {
    const id = list[0].speaker === null ? null : matchSpeaker(list, intervals);
    const name = id !== null ? shown.get(id) : undefined;
    if (name) { named += 1; label.set(key, name); } else { unnamed += 1; label.set(key, `Speaker ${unnamed}`); }
  }

  const participants: Participant[] = humans.map((p) => ({
    name: shown.get(p.id)!,
    joined_at_ms: Math.min(...p.joins.map((j) => j[0])),
    left_at_ms: p.joins.some((j) => j[1] === null) ? null : Math.max(...p.joins.map((j) => j[1] as number)),
  }));

  return {
    passages: ordered.map((p) => ({ start_ms: p.start_ms, end_ms: p.end_ms, text: p.text, speaker: label.get(`${p.chunk}:${p.speaker ?? 'none'}`)! })),
    participants,
    stats: { speakers: pairs.size, named, unnamed, participants: participants.length },
  };
}
