/** Fictional, in-process API. Non-GET rejected unless explicitly auth/uninstall. */
export function fakeVercel({ scopes = ['read:project', 'read:deployment', 'read:domain'], projects = [{ id: 'prj_fixture', name: 'fixture-web', framework: 'nextjs' }], teamId = 'team_fixture', status = 200, allowAccountWrites = false } = {}) {
  const calls = [];
  const json = (body, s = 200) => new Response(JSON.stringify(body), { status: s, headers: { 'content-type': 'application/json' } });
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input)); const method = init.method || 'GET';
    calls.push({ method, path: url.pathname, teamId: url.searchParams.get('teamId'), redirect: init.redirect });
    if (url.origin !== 'https://api.vercel.com') throw new Error('fake_vercel_wrong_host');
    if (method !== 'GET') {
      if (allowAccountWrites && method === 'POST' && url.pathname === '/v2/oauth/access_token') return json({ access_token: 'fixture_vercel_token', configuration_id: 'icfg_fixture', team_id: teamId });
      if (allowAccountWrites && method === 'DELETE' && url.pathname === '/v1/integrations/configuration/icfg_fixture') return new Response(null, { status: 204 });
      throw new Error('fake_vercel_method_refused');
    }
    if (status !== 200) return json({ error: { message: 'fixture_secret_must_never_escape' } }, status);
    if (url.pathname === '/v1/integrations/configuration/icfg_fixture') return json({ id: 'icfg_fixture', scopes, teamId, projectSelection: 'all' });
    if (url.pathname === '/v10/projects') return json({ projects, pagination: { next: null } });
    if (/^\/v9\/projects\/[^/]+$/.test(url.pathname)) return json(projects.find(p => p.id === url.pathname.split('/').pop()) || {});
    if (/^\/v9\/projects\/[^/]+\/domains$/.test(url.pathname)) return json({ domains: [{ name: 'fixture.example', verified: true }] });
    if (url.pathname === '/v7/deployments') return json({ deployments: [{ uid: 'dpl_fixture', readyState: 'READY', target: 'production', createdAt: 1792886400000 }] });
    if (/^\/v13\/deployments\/[^/]+$/.test(url.pathname)) return json({ id: 'dpl_fixture', readyState: 'READY' });
    if (/\/aliases$/.test(url.pathname)) return json({ aliases: [{ alias: 'fixture.example' }] });
    if (/^\/v6\/domains\/[^/]+\/config$/.test(url.pathname)) return json({ misconfigured: false });
    if (url.pathname === '/v5/domains') return json({ domains: [{ name: 'fixture.example' }] });
    if (/\/events$/.test(url.pathname)) return json([]);
    if (/\/runtime-logs$/.test(url.pathname) || url.pathname.startsWith('/v1/query/web-analytics/visits/')) return json({});
    throw new Error('fake_vercel_unknown_endpoint');
  };
  return { fetch: fetcher, calls };
}
