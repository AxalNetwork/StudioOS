/**
 * D898 (#2676), PD8c — a video block's link, checked before it is placed.
 *
 * The founder pastes a YouTube, Vimeo or Loom link (Loom: D1545, #3788). `videoOf` (slideModel.ts) reads
 * it without a fetch; this module then asks the provider's own oEmbed endpoint
 * whether the video exists and is embeddable, and takes its title.
 *
 * WHAT IT FETCHES, and nothing else. Two fixed URLs, built here from the parsed
 * video id, never from the founder's text: `https://www.youtube.com/oembed`,
 * `https://vimeo.com/api/oembed.json` and `https://www.loom.com/v1/oembed`. Redirects are refused, so a
 * provider's answer cannot send the Worker anywhere else. The poster is a URL
 * on the provider's own image host (`i.ytimg.com`, `*.vimeocdn.com`, `cdn.loom.com`), passed
 * through the slide image guard; the Worker never fetches it.
 *
 * Its answer is one of:
 *   ok          the video exists: { provider, video_id, url, title, poster_url }
 *   refused     not a YouTube, Vimeo or Loom link
 *   not_found   the provider says there is no such public video
 *   unreadable  the provider could not be asked (timeout, network, its error)
 */
import { videoOf } from './slideModel';

export type VideoCheck =
  | { state: 'ok'; provider: 'youtube' | 'vimeo' | 'loom'; video_id: string; url: string; title: string | null; poster_url: string | null }
  | { state: 'refused' | 'not_found' | 'unreadable' };

const TIMEOUT_MS = 5000;

export async function checkVideoLink(
  raw: unknown,
  imageGuard: (u: string | null | undefined) => string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<VideoCheck> {
  const vid = videoOf(raw);
  if (!vid) return { state: 'refused' };
  const endpoint = vid.provider === 'youtube'
    ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(vid.url)}`
    : vid.provider === 'loom'
      ? `https://www.loom.com/v1/oembed?url=${encodeURIComponent(vid.url)}`
      : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(vid.url)}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(endpoint, { redirect: 'error', signal: ctl.signal, headers: { Accept: 'application/json' } });
  } catch {
    return { state: 'unreadable' };
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404 || res.status === 401 || res.status === 403) return { state: 'not_found' };
  if (!res.ok) return { state: 'unreadable' };
  let body: any;
  try { body = await res.json(); } catch { return { state: 'unreadable' }; }
  const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : null;
  let poster: string | null = null;
  if (vid.provider === 'youtube') {
    poster = imageGuard(`https://i.ytimg.com/vi/${vid.video_id}/hqdefault.jpg`);
  } else if (typeof body?.thumbnail_url === 'string') {
    // Each provider's poster comes from its own image host only.
    const p = imageGuard(body.thumbnail_url);
    const host = vid.provider === 'loom' ? (h: string) => h === 'cdn.loom.com' : (h: string) => h.endsWith('.vimeocdn.com');
    try { if (p && host(new URL(p).hostname.toLowerCase())) poster = p; } catch { /* no poster */ }
  }
  return { state: 'ok', ...vid, title, poster_url: poster };
}
