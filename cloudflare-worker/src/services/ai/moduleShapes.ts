/** #3626: bounded specialist inputs and model-specific wire formats.
 * Decisions and labels are observations/proposals; this module takes no action.
 */
import type { Units } from './shapes';

export type DecisionQuestion = { type: 'noul' | 'choice' | 'score'; instructions: string; criteria?: Record<string, string> | string[] };
export type SpecialistInput =
  | { operation: 'decision'; questions: Record<string, DecisionQuestion> }
  | { operation: 'sentiment' }
  | { operation: 'image_labels' }
  | { operation: 'turn'; pcm16: string };

const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const short = (x: unknown, n: number): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= n;
const identifier = (x: string) => /^[A-Za-z0-9_.-]{1,32}$/.test(x) && !['__proto__', 'constructor', 'prototype'].includes(x);

export function questionsValid(value: unknown): value is Record<string, DecisionQuestion> {
  if (!plain(value) || Object.keys(value).length < 1 || Object.keys(value).length > 8) return false;
  return Object.entries(value).every(([id, q]) => {
    if (!identifier(id) || !plain(q) || !short(q.instructions, 512)) return false;
    if (Object.keys(q).some(k => !['type', 'instructions', 'criteria'].includes(k))) return false;
    if (q.type === 'noul') return q.criteria === undefined;
    if (q.type === 'score') return Array.isArray(q.criteria) && q.criteria.length >= 2 && q.criteria.length <= 8 && q.criteria.every(x => short(x, 100));
    return q.type === 'choice' && plain(q.criteria) && Object.keys(q.criteria).length >= 2 && Object.keys(q.criteria).length <= 8
      && Object.entries(q.criteria).every(([k, v]) => identifier(k) && short(v, 100));
  });
}

/** Raw 16 kHz, mono, signed little-endian PCM16. Duration is measured, never supplied. */
export function pcmBytes(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || value.length < 4 || value.length > 342_000 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
  try {
    const b = Uint8Array.from(atob(value), x => x.charCodeAt(0));
    return b.length > 0 && b.length <= 256_000 && b.length % 2 === 0 ? b : null;
  } catch { return null; }
}
export const pcmMinutes = (pcm: Uint8Array): number => pcm.byteLength / (16_000 * 2 * 60);

export function pcmWave(pcm: Uint8Array): Uint8Array {
  const b = new Uint8Array(44 + pcm.byteLength), v = new DataView(b.buffer);
  const word = (at: number, s: string) => { for (let i = 0; i < s.length; i++) b[at + i] = s.charCodeAt(i); };
  word(0, 'RIFF'); v.setUint32(4, b.length - 8, true); word(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16_000, true); v.setUint32(28, 32_000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  word(36, 'data'); v.setUint32(40, pcm.length, true); b.set(pcm, 44); return b;
}

export function specialistRefusal(s: SpecialistInput, text: string, images?: string[]): string | null {
  if (s.operation === 'decision') return questionsValid(s.questions) && short(text, 24_000) && !images?.length ? null : 'A decision needs text and one to eight typed questions.';
  if (s.operation === 'sentiment') return short(text, 512) && new TextEncoder().encode(text).byteLength <= 512 && !images?.length ? null : 'Sentiment reads a short English feedback excerpt (up to 512 UTF-8 bytes).';
  if (s.operation === 'image_labels') return images?.length === 1 ? null : 'Image labels need one image.';
  if (s.operation === 'turn') return pcmBytes(s.pcm16) && !images?.length ? null : 'Turn detection needs a bounded PCM16 audio excerpt.';
  return 'Unknown analysis operation.';
}

export function specialistRequest(model: string, s: SpecialistInput, text: string, images?: string[]): unknown {
  if (s.operation === 'decision') return { model: model.split('/').at(-1), state: text, questions: s.questions };
  if (s.operation === 'sentiment') return { text };
  if (s.operation === 'image_labels') return { image: Array.from(Uint8Array.from(atob(images![0].split(',')[1]), x => x.charCodeAt(0))) };
  const pcm = pcmBytes(s.pcm16)!;
  const source = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const floats = new Uint8Array(pcm.length * 2), target = new DataView(floats.buffer);
  for (let i = 0; i < pcm.length / 2; i++) target.setFloat32(i * 4, source.getInt16(i * 2, true) / 32768, true);
  let binary = ''; for (const b of floats) binary += String.fromCharCode(b);
  return { audio: btoa(binary), dtype: 'float32' };
}

const probability = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
function finiteTree(value: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true;
  return (Array.isArray(value) ? value.length <= 64 && value.every(x => finiteTree(x, depth + 1))
    : plain(value) && Object.entries(value).length <= 64 && Object.values(value).every(x => finiteTree(x, depth + 1)));
}

export function specialistOutput(raw: unknown, s: SpecialistInput, text: string): { output: string; units: Units } | null {
  const r = raw as Record<string, any> | null;
  let answer: unknown;
  let units: Units;
  if (s.operation === 'decision') {
    if (!plain(r?.answers) || !finiteTree(r.answers) || Object.keys(r.answers).sort().join('|') !== Object.keys(s.questions).sort().join('|')) return null;
    if (Object.entries(s.questions).some(([key, q]) => q.type === 'noul' && !probability(r.answers[key]))) return null;
    answer = r.answers;
    const input = r.usage?.input_tokens ?? r.usage?.prompt_tokens;
    units = { tokens_in: typeof input === 'number' && Number.isSafeInteger(input) && input > 0 ? input : new TextEncoder().encode(text + JSON.stringify(s.questions)).byteLength, tokens_out: 0 };
  } else if (s.operation === 'turn') {
    if (typeof r?.is_complete !== 'boolean' || !probability(r.probability)) return null;
    answer = { is_complete: r.is_complete, probability: r.probability };
    units = { audio_minutes: pcmMinutes(pcmBytes(s.pcm16)!) };
  } else {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > (s.operation === 'image_labels' ? 1000 : 64) || !raw.every(x => plain(x) && short(x.label, 200) && probability(x.score))) return null;
    const labels = s.operation === 'image_labels' ? [...raw].sort((a, b) => b.score - a.score).slice(0, 5) : raw;
    answer = labels.map(x => ({ label: x.label, score: x.score }));
    units = s.operation === 'image_labels' ? { images: 1 } : { tokens_in: new TextEncoder().encode(text).byteLength, tokens_out: 0 };
  }
  const output = JSON.stringify(answer);
  return output.length <= 8_192 ? { output, units } : null;
}
