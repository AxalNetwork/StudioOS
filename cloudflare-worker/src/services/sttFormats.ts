/**
 * D657 — what each Workers AI speech-to-text model takes and returns.
 *
 * Pure functions and no imports, so `aiRouter.ts` can use them without a
 * cycle. Four batch models answer in three shapes, and the two live models
 * send two kinds of event; each is read here once.
 *
 *   @cf/openai/whisper                 in  { audio: number[] }
 *                                      out { text, words: [{ word, start, end }] }
 *   @cf/openai/whisper-large-v3-turbo  in  { audio }   (as the router has always sent it)
 *                                      out { text, transcription_info: { language },
 *                                            segments: [{ start, end, text }] }
 *   @cf/deepgram/nova-3                in  { audio: { body, contentType }, diarize,
 *                                            detect_language, punctuate, smart_format }
 *                                      out { results: { channels: [{ detected_language,
 *                                            alternatives: [{ transcript, words: [{ word,
 *                                            punctuated_word, start, end, speaker }] }] }] } }
 *
 * Live (WebSocket, `linear16` at 16 kHz):
 *   @cf/deepgram/nova-3   { type: 'Results', is_final, start, duration,
 *                           channel: { alternatives: [{ transcript, words }] } }
 *   @cf/deepgram/flux     { event: 'Update' | 'StartOfTurn' | 'EagerEndOfTurn' |
 *                           'TurnResumed' | 'EndOfTurn', transcript,
 *                           audio_window_start, audio_window_end, turn_index }
 *
 * Times arrive in seconds and are stored in milliseconds.
 */

export const NOVA_3 = '@cf/deepgram/nova-3';
export const FLUX = '@cf/deepgram/flux';
export const WHISPER = '@cf/openai/whisper';
export const WHISPER_TURBO = '@cf/openai/whisper-large-v3-turbo';
export const WHISPER_TINY_EN = '@cf/openai/whisper-tiny-en';

/** One passage. `speaker` is the model's own label (Nova-3: 0, 1, …), or null. */
export interface SttSegment { start_ms: number | null; end_ms: number | null; text: string; speaker: number | null }
export interface SttTranscript { text: string; language: string | null; segments: SttSegment[] }

const ms = (s: unknown): number | null => {
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : null;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * The request body a batch model takes for this clip. `language` (D685) is an
 * ISO-639-1 code or null for Detect. Nova-3 takes it instead of detecting;
 * Whisper Large v3 Turbo takes it as `language`; Whisper v1 is given none.
 */
export function audioInputFor(model: string, bytes: Uint8Array, mime: string, language: string | null = null): Record<string, unknown> {
  if (model === NOVA_3) {
    return {
      // A stream, as the binding's examples pass it; never a number[] copy.
      audio: { body: new Response(bytes).body, contentType: mime || 'audio/webm' },
      diarize: true,
      ...(language ? { language } : { detect_language: true }),
      punctuate: true,
      smart_format: true,
    };
  }
  if (model === WHISPER_TURBO && language) return { audio: Array.from(bytes), language };
  return { audio: Array.from(bytes) };
}

/** The options a live socket opens with. Nova-3 takes the language; Flux is English-only and takes none. */
export function liveInputFor(model: string, language: string | null): Record<string, string> {
  return {
    encoding: 'linear16',
    sample_rate: '16000',
    ...(model === NOVA_3 && language ? { language } : {}),
  };
}

/** Consecutive words by the same speaker become one passage. */
function wordsToSegments(words: any[]): SttSegment[] {
  const out: SttSegment[] = [];
  for (const w of words) {
    const text = str(w?.punctuated_word) || str(w?.word);
    if (!text) continue;
    const speaker = Number.isInteger(w?.speaker) ? Number(w.speaker) : null;
    const last = out[out.length - 1];
    if (last && last.speaker === speaker) {
      last.text = `${last.text} ${text}`;
      last.end_ms = ms(w?.end) ?? last.end_ms;
    } else {
      out.push({ start_ms: ms(w?.start), end_ms: ms(w?.end), text, speaker });
    }
  }
  return out;
}

/** A batch model's answer, read into one shape. Unknown shapes give text only. */
export function parseAudioOutput(model: string, out: any): SttTranscript {
  if (model === NOVA_3) {
    const ch = out?.results?.channels?.[0];
    const alt = ch?.alternatives?.[0];
    const words = Array.isArray(alt?.words) ? alt.words : [];
    const segments = wordsToSegments(words);
    const text = str(alt?.transcript).trim() || segments.map((s) => s.text).join(' ');
    return { text, language: str(ch?.detected_language) || null, segments };
  }
  const text = str(out?.text).trim();
  const language = str(out?.transcription_info?.language) || null;
  if (Array.isArray(out?.segments) && out.segments.length) {
    const segments = out.segments
      .map((s: any) => ({ start_ms: ms(s?.start), end_ms: ms(s?.end), text: str(s?.text).trim(), speaker: null }))
      .filter((s: SttSegment) => s.text);
    return { text, language, segments };
  }
  if (Array.isArray(out?.words) && out.words.length) {
    const words = out.words;
    return { text, language, segments: text ? [{ start_ms: ms(words[0]?.start), end_ms: ms(words[words.length - 1]?.end), text, speaker: null }] : [] };
  }
  return { text, language, segments: text ? [{ start_ms: null, end_ms: null, text, speaker: null }] : [] };
}

/**
 * One live event. Returns a FINISHED passage to store, or null for an interim
 * update (relayed to the page but not stored) or anything unrecognised.
 */
export function parseLiveEvent(model: string, raw: unknown): SttSegment | null {
  let ev: any = raw;
  if (typeof raw === 'string') { try { ev = JSON.parse(raw); } catch { return null; } }
  if (!ev || typeof ev !== 'object') return null;
  if (model === FLUX) {
    if (ev.event !== 'EndOfTurn') return null;
    const text = str(ev.transcript).trim();
    return text ? { start_ms: ms(ev.audio_window_start), end_ms: ms(ev.audio_window_end), text, speaker: null } : null;
  }
  if (model === NOVA_3) {
    if (ev.type !== 'Results' || ev.is_final !== true) return null;
    const alt = ev.channel?.alternatives?.[0];
    const text = str(alt?.transcript).trim();
    if (!text) return null;
    const start = Number(ev.start), dur = Number(ev.duration);
    const speakers = new Set((Array.isArray(alt?.words) ? alt.words : []).map((w: any) => w?.speaker).filter(Number.isInteger));
    return {
      start_ms: ms(start),
      end_ms: Number.isFinite(start) && Number.isFinite(dur) ? ms(start + dur) : null,
      text,
      speaker: speakers.size === 1 ? Number([...speakers][0]) : null,
    };
  }
  return null;
}

/**
 * The model's speaker number, in words a founder reads. Nova-3 numbers
 * speakers in the order it hears them; the founder opens the conversation, so
 * 0 is "Me" and 1 is the interviewee. Anything else, or no label, is
 * "Speaker ?" until the founder assigns it.
 */
export function speakerLabel(speaker: number | null, intervieweeName: string | null): string {
  if (speaker === 0) return 'Me';
  if (speaker === 1) return (intervieweeName || '').trim() || 'Interviewee';
  return 'Speaker ?';
}
