/**
 * D684 (#1602): one deadline for the provider's headers AND JSON body.
 * Aborting a POST cannot prove it was not accepted; adapters classify a lost
 * send response as send_unknown, and outbound.ts retains its pending claim.
 * withDeadline also bounds providers/mocks that ignore AbortSignal, and
 * consumes a late rejection without extending the request.
 *
 * D756 (#1896): `boundedDownload`, one deadline over a file's headers AND its
 * streamed body, with a running byte count that stops the read above
 * `maxBytes` — for every provider's media (Telegram now, WhatsApp in D754
 * W3). `sniffAudioContainer` names the container from the file's own first
 * bytes; `channelAudio.ts` decides whether it is admitted. Neither logs, and
 * nothing either returns carries the URL: a file URL can hold a token.
 */
import { DeadlineExceeded, withDeadline } from '../../util/deadline';

export const PROVIDER_CALL_MS = 10_000;

/** One file download, headers and body: three JSON calls' worth, for at most 5 MB. */
export const PROVIDER_DOWNLOAD_MS = 30_000;

export async function providerJson(url: string, init: RequestInit = {}): Promise<{ res: Response; data: any }> {
  const controller = new AbortController();
  try {
    return await withDeadline((async () => {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const data = await res.json().catch(() => null);
      return { res, data };
    })(), PROVIDER_CALL_MS, 'channel-provider');
  } finally {
    controller.abort();
  }
}

export type AudioContainer = 'ogg' | 'mpeg' | 'wav' | 'mp4' | 'webm' | 'unknown';

export type Download =
  | { ok: true; bytes: Uint8Array; container: AudioContainer }
  | { ok: false; code: 'bad_url' | 'http' | 'too_large' | 'empty_file' | 'timeout' | 'network'; status: number };

const ascii = (bytes: Uint8Array, at: number, text: string) =>
  bytes.length >= at + text.length && [...text].every((ch, i) => bytes[at + i] === ch.charCodeAt(0));

/**
 * The container a file's first bytes name. An MPEG audio frame sync is 0xFF
 * then a byte whose top three bits are set and whose layer bits are not 00,
 * so ADTS AAC (layer 00) is not MPEG. Fewer than four bytes are 'unknown'.
 */
export function sniffAudioContainer(bytes: Uint8Array): AudioContainer {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) return 'unknown';
  if (ascii(bytes, 0, 'OggS')) return 'ogg';
  if (ascii(bytes, 0, 'ID3')) return 'mpeg';
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0) return 'mpeg';
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE')) return 'wav';
  if (ascii(bytes, 4, 'ftyp')) return 'mp4';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  return 'unknown';
}

/**
 * Fetch a file under one deadline and a byte cap. Never throws; a refusal is
 * a code with the HTTP status (0 when there was none). Only `https:` URLs.
 */
export async function boundedDownload(
  url: string, opts: { maxBytes: number; deadlineMs?: number; init?: RequestInit },
): Promise<Download> {
  let parsed: URL | null = null;
  try { parsed = new URL(url); } catch { parsed = null; }
  if (!parsed || parsed.protocol !== 'https:') return { ok: false, code: 'bad_url', status: 0 };
  const controller = new AbortController();
  try {
    return await withDeadline((async (): Promise<Download> => {
      const res = await fetch(url, { ...(opts.init ?? {}), signal: controller.signal });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return { ok: false, code: 'http', status: res.status };
      }
      if (Number(res.headers.get('content-length') || 0) > opts.maxBytes) {
        await res.body?.cancel().catch(() => {});
        return { ok: false, code: 'too_large', status: res.status };
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      const reader = res.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > opts.maxBytes) {
            await reader.cancel().catch(() => {});
            return { ok: false, code: 'too_large', status: res.status };
          }
          chunks.push(value);
        }
      }
      if (!total) return { ok: false, code: 'empty_file', status: res.status };
      const bytes = new Uint8Array(total);
      let at = 0;
      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
      return { ok: true, bytes, container: sniffAudioContainer(bytes) };
    })(), opts.deadlineMs ?? PROVIDER_DOWNLOAD_MS, 'channel-download');
  } catch (e) {
    return { ok: false, code: e instanceof DeadlineExceeded ? 'timeout' : 'network', status: 0 };
  } finally {
    controller.abort();
  }
}
