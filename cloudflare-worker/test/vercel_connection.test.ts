import test from 'node:test';
import assert from 'node:assert/strict';
import { vercelClient, exchangeVercelCode } from '../src/services/vercel/api.ts';
import { fakeVercel } from './_vercel_api_fake.mjs';
const auth = { access_token: 'fixture_vercel_token', configuration_id: 'icfg_fixture', team_id: 'team_fixture' };
test('Vercel fake refuses every unapproved non-GET', async () => {
  const f = fakeVercel();
  for (const method of ['POST', 'DELETE', 'PATCH', 'PUT']) await assert.rejects(f.fetch('https://api.vercel.com/v10/projects', { method }), /method_refused/);
});
test('typed client reads every planned endpoint with team scope and refuses redirects', async () => {
  const f = fakeVercel(); globalThis.fetch = f.fetch as typeof fetch;
  const c = vercelClient(auth);
  await c.installation(); await c.projects(); await c.project('prj_fixture'); await c.deployments('prj_fixture'); await c.deployment('dpl_fixture');
  await c.promotionAliases('prj_fixture'); await c.deploymentAliases('dpl_fixture'); await c.projectDomains('prj_fixture'); await c.domainConfig('fixture.example'); await c.domains();
  await c.deploymentEvents('dpl_fixture'); await c.runtimeLogs('prj_fixture', 'dpl_fixture'); await c.analyticsCount('prj_fixture'); await c.analyticsAggregate('prj_fixture');
  assert.equal(f.calls.length, 14); assert.ok(f.calls.every(x => x.method === 'GET' && x.teamId === 'team_fixture' && x.redirect === 'error'));
});
test('OAuth exchange and uninstall are the only account writes', async () => {
  const f = fakeVercel({ allowAccountWrites: true }); globalThis.fetch = f.fetch as typeof fetch;
  assert.deepEqual(await exchangeVercelCode('fixture_client', 'fixture_secret', 'fixture_code', 'https://app.example/callback'), auth);
  await vercelClient(auth).uninstall(); assert.deepEqual(f.calls.map(x => x.method), ['POST', 'DELETE']);
});
test('429 is a static error, exposes reset metadata, never echoes a body or token', async () => {
  globalThis.fetch = (async () => new Response('fixture_secret', { status: 429, headers: { 'x-ratelimit-reset': '1792886460', 'x-ratelimit-remaining': '0' } })) as typeof fetch;
  const seen: any[] = [];
  await assert.rejects(vercelClient(auth, { onRateLimit: x => seen.push(x) }).projects(), (e: any) => e.message === 'vercel_rate_limited' && e.reset === 1792886460 && !JSON.stringify(e).includes('fixture_secret'));
  assert.equal(seen[0].remaining, 0);
});
