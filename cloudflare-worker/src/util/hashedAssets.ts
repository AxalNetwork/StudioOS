/**
 * D9168 (#9168): the answer for a hashed `/assets/*` file, which the Worker serves first (`run_worker_first`) from
 * the assets binding. A hashed name never changes content, so a 200 or 304 leaves as `public, max-age=31536000,
 * immutable` and a page load stops revalidating every preloaded chunk through the Worker. A miss, including the
 * SPA fallback's index.html for a hash this deploy no longer holds (Task #37), is a plain 404 with `no-store`, so
 * the boot watchdog and the stale-chunk reload can move a stale tab onto the current build.
 */
export const IMMUTABLE_ASSET_CACHE = 'public, max-age=31536000, immutable';

export function serveHashedAsset(assetRes: Response): Response {
  const ctype = assetRes.headers.get('content-type') || '';
  if (/text\/html/i.test(ctype) || assetRes.status === 404) {
    return new Response('Asset not found\n', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  if (assetRes.status !== 200 && assetRes.status !== 304) return assetRes;
  const headers = new Headers(assetRes.headers);
  headers.set('cache-control', IMMUTABLE_ASSET_CACHE);
  return new Response(assetRes.body, { status: assetRes.status, statusText: assetRes.statusText, headers });
}
