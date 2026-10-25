/** No test may accidentally contact Google or use a provider write. OAuth transport is stubbed too. */
export function googleWorkspaceFake(files = {}) {
  const calls = [];
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input)); const method = init.method || 'GET';
    calls.push({ host: url.hostname, path: url.pathname, method });
    if (url.href === 'https://oauth2.googleapis.com/token' && method === 'POST') return Response.json({ access_token: 'browser-must-never-see-server-access', refresh_token: 'server-refresh-only', scope: files.oauthScope, token_type: 'Bearer' });
    if (url.href === 'https://oauth2.googleapis.com/revoke' && method === 'POST') return Response.json({});
    if (method !== 'GET') throw new Error('provider_write_refused');
    if (url.href.startsWith('https://www.googleapis.com/oauth2/v2/userinfo')) return Response.json({ id: 'google-member', email: 'founder@example.test', verified_email: true });
    const m = /^\/drive\/v3\/files\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (url.hostname === 'www.googleapis.com' && /\/export$/.test(url.pathname)) return new Response('%PDF synthetic');
    if (url.searchParams.get('alt') === 'media' && m) return new Response('synthetic file');
    if (url.hostname === 'docs.googleapis.com' && /^\/v1\/documents\/[A-Za-z0-9_-]+$/.test(url.pathname)) return Response.json({ body: { content: [] } });
    if (url.hostname === 'slides.googleapis.com' && /^\/v1\/presentations\/[A-Za-z0-9_-]+$/.test(url.pathname)) return Response.json({ slides: [] });
    if (url.hostname === 'forms.googleapis.com' && /\/responses$/.test(url.pathname)) return Response.json({ responses: [] });
    if (url.hostname === 'www.googleapis.com' && m) return files[m[1]] ? Response.json({ id: m[1], ...files[m[1]] }) : Response.json({ error: 'raw-private-provider-body' }, { status: 403 });
    if (url.hostname === 'sheets.googleapis.com' && /^\/v4\/spreadsheets\/[A-Za-z0-9_-]+\/values\//.test(url.pathname)) return Response.json({ values: [['Date','Count'], ['2026-10-25',12], ['2026-10-26',13], ['4'], ['5'], ['6']] });
    if (url.hostname === 'forms.googleapis.com' && /^\/v1\/forms\/[A-Za-z0-9_-]+$/.test(url.pathname)) return Response.json({ items: [{ title: 'Would you pay?', questionItem: { question: { questionId: 'q1' } } }] });
    throw new Error('unexpected_provider_read');
  };
  return { fetcher, calls };
}
