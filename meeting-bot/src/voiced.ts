/**
 * #2582 (D886 §1 Q5, §4): Zoom's per-participant streams as voiced-only parts.
 *
 * Each participant's own stream is cut into parts that hold only their
 * speech (the energy gate in `constants.ts`), so transcription is billed for
 * speaking time, not participants × duration. Every part carries its
 * participant's key, which B1's chunk event stores as `participant_id` and
 * B6 names a passage by.
 *
 * A part's `start_ms` is where it sits on the recording's timeline, from the
 * clock at the frame's arrival: a stream the SDK stops delivering through a
 * silence resumes at its true time, never glued to the last part. All parts
 * share the run's one `SeqSource`, so `chunk_seq` stays contiguous and inside
 * B1's range; a voiced part past the range is counted, never sent.
 */
import { CHUNK_SAMPLES, SAMPLE_RATE, VOICE_HANGOVER_MS, VOICE_MIN_MS, VOICE_PREROLL_MS, VOICE_RMS, VOICE_WINDOW_SAMPLES } from './constants.ts';
import { encodeWav } from './wav.ts';
import type { Chunk, SeqSource } from './wav.ts';

const PER_MS = SAMPLE_RATE / 1000;
const W = VOICE_WINDOW_SAMPLES;
const windows = (ms: number) => Math.ceil((ms * PER_MS) / W);
const HANGOVER = windows(VOICE_HANGOVER_MS) * W;
const PREROLL = windows(VOICE_PREROLL_MS);
const MIN_VOICED = windows(VOICE_MIN_MS) * W;

interface Part { start: number; windows: Int16Array[]; length: number; voiced: number; quiet: number }
interface Stream { pos: number; pending: Int16Array; part: Part | null; preroll: Int16Array[] }

/** True when a window's RMS reaches the gate. */
export function voiced(window: Int16Array): boolean {
  let sum = 0;
  for (const x of window) sum += x * x;
  return Math.sqrt(sum / window.length) >= VOICE_RMS;
}

export class VoicedStreams {
  private readonly streams = new Map<string, Stream>();
  private readonly seqs: SeqSource;
  /** Milliseconds since the recording's origin, the chunks' timeline. */
  private readonly now: () => number;
  private sentCount = 0;
  private droppedCount = 0;

  constructor(seqs: SeqSource, now: () => number) {
    this.seqs = seqs;
    this.now = now;
  }

  get sent(): number { return this.sentCount; }
  get dropped(): number { return this.droppedCount; }
  get streamCount(): number { return this.streams.size; }

  /** One frame of one participant's stream; returns the parts it completed. */
  push(key: string, samples: Int16Array): Chunk[] {
    const out: Chunk[] = [];
    const begin = Math.max(0, Math.round(this.now() * PER_MS) - samples.length);
    let s = this.streams.get(key);
    if (!s) { s = { pos: begin, pending: new Int16Array(0), part: null, preroll: [] }; this.streams.set(key, s); }
    else if (begin - (s.pos + s.pending.length) > HANGOVER) {
      // The SDK sent nothing through a silence: close what was open and resume at the true time.
      if (s.part) this.close(key, s, out);
      s.pending = new Int16Array(0); s.preroll = []; s.pos = begin;
    }
    const all = new Int16Array(s.pending.length + samples.length);
    all.set(s.pending); all.set(samples, s.pending.length);
    let at = 0;
    for (; at + W <= all.length; at += W) this.window(key, s, all.slice(at, at + W), out);
    s.pending = all.slice(at);
    return out;
  }

  /** The call ended: every open part is closed. A partial window (under 20 ms) is not audio worth a part. */
  flush(): Chunk[] {
    const out: Chunk[] = [];
    for (const [key, s] of this.streams) if (s.part) this.close(key, s, out);
    return out;
  }

  private window(key: string, s: Stream, w: Int16Array, out: Chunk[]): void {
    const loud = voiced(w);
    if (!s.part) {
      if (loud) {
        const length = (s.preroll.length + 1) * W;
        s.part = { start: s.pos + W - length, windows: [...s.preroll, w], length, voiced: W, quiet: 0 };
        s.preroll = [];
      } else {
        s.preroll.push(w);
        if (s.preroll.length > PREROLL) s.preroll.shift();
      }
    } else {
      const p = s.part;
      p.windows.push(w); p.length += W;
      if (loud) { p.voiced += W; p.quiet = 0; } else p.quiet += W;
      // A long turn is cut at the chunk size; its next voiced window opens the next part where this one ends.
      if (p.quiet >= HANGOVER || p.length >= CHUNK_SAMPLES) this.close(key, s, out);
    }
    s.pos += W;
  }

  private close(key: string, s: Stream, out: Chunk[]): void {
    const p = s.part!;
    s.part = null;
    if (p.voiced < MIN_VOICED || !p.length) return;
    if (this.seqs.left <= 0) { this.droppedCount += 1; return; }
    const pcm = new Int16Array(p.length);
    let at = 0;
    for (const w of p.windows) { pcm.set(w, at); at += w.length; }
    out.push({ seq: this.seqs.next(), start_ms: Math.round(Math.max(0, p.start) / PER_MS), wav: encodeWav(pcm), participant: key });
    this.sentCount += 1;
  }
}
