/**
 * Pull-request preview Worker — the script behind wrangler.pr-preview.toml.
 *
 * Two jobs, and only the two `run_worker_first` prefixes reach it; everything
 * else is answered by the assets binding before any code runs — the SPA shell
 * for pages and deep links, with `docs/_headers` applied.
 *
 *   - `/assets/*`: exactly what cloudflare-worker/src/index.ts does on
 *     production — serve the real file, and when the single-page-application
 *     fallback would answer a MISSING hashed asset with `index.html`, return a
 *     plain 404 instead. Otherwise a stale tab from a previous push would
 *     execute HTML as a JS module and go blank — the `?__reboot=` watchdog
 *     loop the retired Pages mirror's `_worker.js` guarded against the same
 *     way.
 *   - `/api/*`: a JSON 404. There is no API on a preview (no bindings, no
 *     data), and the SPA's fetches should see a clean 404 rather than the
 *     shell.
 *
 * No bindings beyond the assets binding, no environment, no data. The preview
 * is deployed on every push to the pull request and deleted when it closes
 * (.github/workflows/pr-preview.yml).
 */
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) {
      return new Response(
        JSON.stringify({ error: 'No API on a pull-request preview: this Worker serves the SPA build only.' }),
        { status: 404, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
      );
    }
    const res = await env.ASSETS.fetch(request);
    if (/text\/html/i.test(res.headers.get('content-type') || '')) {
      return new Response('Asset not found\n', {
        status: 404,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }
    return res;
  },
};
