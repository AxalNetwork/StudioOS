/**
 * D886 B2 (#2580): the call's audio as D872's WAV parts.
 *
 * `encodeWav` writes the same canonical 44-byte header as the browser's
 * uploader (`frontend/src/lib/recordingUpload.js`), so the Worker's
 * `isUploadWav` admits a bot chunk exactly as it admits an uploaded part.
 * `Chunker` cuts the stream into parts of `CHUNK_SAMPLES` as frames arrive.
 */
import { CHUNK_SAMPLES, SAMPLE_RATE, WAV_HEADER_BYTES } from './constants.ts';

/** PCM samples as a WAV: 16 kHz, mono, 16-bit, canonical header. */
export function encodeWav(samples: Int16Array, sampleRate: number = SAMPLE_RATE): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(WAV_HEADER_BYTES + samples.length * 2);
  const v = new DataView(out.buffer);
  const tag = (at: number, s: string) => { for (let i = 0; i < 4; i += 1) out[at + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); tag(8, 'WAVE');
  tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) v.setInt16(WAV_HEADER_BYTES + i * 2, samples[i], true);
  return out;
}

/** Float samples in [-1, 1] at any rate, as 16 kHz 16-bit PCM. For adapters whose source is a browser. */
export function toPcm16k(input: Float32Array, inputRate: number): Int16Array {
  const ratio = inputRate / SAMPLE_RATE;
  const count = Math.floor(input.length / ratio);
  const out = new Int16Array(count);
  for (let i = 0; i < count; i += 1) {
    const at = i * ratio;
    const lo = Math.floor(at);
    const hi = Math.min(lo + 1, input.length - 1);
    const x = Math.max(-1, Math.min(1, input[lo] + (input[hi] - input[lo]) * (at - lo)));
    out[i] = x < 0 ? Math.round(x * 0x8000) : Math.round(x * 0x7fff);
  }
  return out;
}

export interface Chunk {
  readonly seq: number;
  /** Where the chunk starts on the recording's audio timeline. */
  readonly start_ms: number;
  readonly wav: Uint8Array<ArrayBuffer>;
}

/** Collects frames and hands out whole chunks, numbered from 0. */
export class Chunker {
  private readonly size: number;
  private buf: Int16Array;
  private fill = 0;
  private seq = 0;
  private emitted = 0;

  constructor(size: number = CHUNK_SAMPLES) {
    this.size = size;
    this.buf = new Int16Array(size);
  }

  /** Add samples; returns the chunks they completed. */
  push(samples: Int16Array): Chunk[] {
    const done: Chunk[] = [];
    let at = 0;
    while (at < samples.length) {
      const take = Math.min(this.size - this.fill, samples.length - at);
      this.buf.set(samples.subarray(at, at + take), this.fill);
      this.fill += take;
      at += take;
      if (this.fill === this.size) done.push(this.cut());
    }
    return done;
  }

  /** The partial chunk at the end of the call, or null when nothing is held. */
  flush(): Chunk | null {
    return this.fill > 0 ? this.cut() : null;
  }

  private cut(): Chunk {
    const chunk = { seq: this.seq, start_ms: Math.round((this.emitted / SAMPLE_RATE) * 1000), wav: encodeWav(this.buf.subarray(0, this.fill)) };
    this.seq += 1;
    this.emitted += this.fill;
    this.fill = 0;
    this.buf = new Int16Array(this.size);
    return chunk;
  }
}
