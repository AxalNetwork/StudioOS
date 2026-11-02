/**
 * D1506 (#3757) — an external image, fetched once through the shared safe
 * fetcher's guard and copied into our own storage, so a deck never points at
 * someone else's server (which could change the picture, or see who opened it).
 *
 * https only; the host must pass `isSafePublicUrl` (no private, loopback,
 * link-local or metadata address) at every redirect hop (at most three, each
 * re-checked); eight seconds; and the body is read to `maxBytes` and no
 * further. The caller sniffs the bytes: the server's content type is not
 * trusted.
 */
import { isSafePublicUrl } from '../webFetch';

export const IMAGE_FETCH_TIMEOUT_MS = 8_000;
export const IMAGE_FETCH_HOPS = 3;

export type ImageFetch = { ok: true; bytes: Uint8Array; url: string } | { ok: false; code: 'unsafe_url' | 'fetch_failed' | 'too_large' | 'too_many_redirects' };

export async function fetchExternalImage(
  raw: string, maxBytes: number, fetcher: typeof fetch = fetch, timeoutMs = IMAGE_FETCH_TIMEOUT_MS,
): Promise<ImageFetch> {
  let url = String(raw ?? '').trim();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= IMAGE_FETCH_HOPS; hop += 1) {
      let u: URL;
      try { u = new URL(url); } catch { return { ok: false, code: 'unsafe_url' }; }
      if (u.protocol !== 'https:' || u.username || u.password || !isSafePublicUrl(u.toString())) return { ok: false, code: 'unsafe_url' };
      let res: Response;
      try {
        res = await fetcher(u.toString(), { redirect: 'manual', signal: ctl.signal, headers: { Accept: 'image/png,image/jpeg,image/webp' } });
      } catch { return { ok: false, code: 'fetch_failed' }; }
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get('location');
        try { await res.body?.cancel(); } catch { /* nothing to release */ }
        if (!next) return { ok: false, code: 'fetch_failed' };
        url = new URL(next, u).toString();
        continue;
      }
      if (!res.ok || !res.body) return { ok: false, code: 'fetch_failed' };
      const declared = Number(res.headers.get('content-length') || 0);
      if (declared > maxBytes) { try { await res.body.cancel(); } catch { /* */ } return { ok: false, code: 'too_large' }; }
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { try { await reader.cancel(); } catch { /* */ } return { ok: false, code: 'too_large' }; }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let at = 0;
      for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
      return { ok: true, bytes, url: u.toString() };
    }
    return { ok: false, code: 'too_many_redirects' };
  } finally {
    clearTimeout(timer);
  }
}
