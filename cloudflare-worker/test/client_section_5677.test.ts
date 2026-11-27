/** Bounded, untrusted diagnostic attribution. Exercise the public handler as well as the resolver. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientSectionHint as hint } from '../src/util/clientSection.ts';
import { memKV } from './_mem_kv.mjs';

test('all eight audiences and the most specific destination', () => {
  const cases = [
    ['super_admin', '/admin/funds', 'superadmin', 'funds-oversight'],
    ['admin', '/admin/fund-admin', 'admin', 'fund-admin'],
    ['branch_admin', '/branch/contracts', 'admin', 'contracts'],
    ['founder', '/build/prototype-mvp', 'founder', 'build'],
    ['investor', '/spinout-lab/investor-workspace', 'investor', 'axal-vc-fund'],
    ['partner', '/delivery/projects/123', 'partner', 'delivery'],
    ['advisor', '/expertise', 'advisor', 'expertise'],
    ['exploring', '/exploring', 'explorer', 'studio'],
    ['exploring', '/email', 'explorer', 'email'],
    ['investor', '/portfolio', 'investor', 'portfolio'],
    ['investor', '/account/portfolio', 'all', 'portfolio'],
  ];
  for (const [shell, path, profile, section] of cases) assert.deepEqual(hint(path, { shell }), { profile, section }, path);
  assert.deepEqual(hint('/admin/programs', { shell: 'super_admin' }), { profile: 'superadmin', section: 'programs' });
  assert.deepEqual(hint('/admin/programs', { shell: 'admin' }), { profile: 'admin', section: 'programs' });
  assert.equal(hint('/admin/programs', { shell: 'branch_admin' }), null);
  assert.equal(hint('/branch/contracts', { shell: 'super_admin' }), null);
  assert.equal(hint('/spinout-lab/investor-workspace', { shell: 'exploring' }), null);
});

test('the section map covers each of the 81 planned destinations', () => {
  const shared = [['/studio', 'studio'], ['/spinout-lab', 'spin-out-lab'], ['/trust/me', 'trust'],
    ['/research', 'research'], ['/network', 'network']];
  const matrix: Record<string, string[][]> = {
    super_admin: [['/hq', 'home'], ['/admin/licences', 'licences'], ['/admin/programs', 'programs'],
      ['/admin/funds', 'funds-oversight'], ['/admin/fund-admin', 'fund-admin'], ['/admin/contracts', 'contracts'],
      ['/admin/hq-team', 'team'], ['/admin/revenue', 'revenue'], ['/admin/content', 'content'],
      ['/admin/platform', 'platform'], ['/hq/ai-agents', 'ai-agents'], ['/admin/integration-keys', 'integration-keys'],
      ['/admin/hq-support', 'support'], ['/admin/security', 'security'], ['/account', 'settings']],
    admin: [['/studio', 'studio'], ['/admin/accounts', 'accounts'], ['/admin/approvals', 'approvals'],
      ['/admin/programs', 'programs'], ['/admin/community', 'community'], ['/admin/contracts', 'contracts'],
      ['/admin/fund-admin', 'fund-admin'], ['/admin/insights', 'insights'], ['/admin/my-licence', 'licences']],
    founder: [...shared, ['/validate', 'validate'], ['/build', 'build'], ['/raise', 'raise'], ['/grow', 'grow'], ['/profile', 'profile']],
    investor: [...shared, ['/deals', 'deals'], ['/spinout-lab/investor-workspace', 'axal-vc-fund'], ['/funds', 'fund'],
      ['/portfolio', 'portfolio'], ['/due-diligence', 'due-diligence']],
    partner: [...shared, ['/pipeline', 'pipeline'], ['/delivery', 'delivery'], ['/offers', 'offers'], ['/due-diligence', 'due-diligence']],
    advisor: [...shared, ['/practice', 'practice'], ['/cohorts', 'cohorts'], ['/expertise', 'expertise'], ['/due-diligence', 'due-diligence']],
    exploring: [['/exploring', 'studio'], ['/spinout-lab', 'spin-out-lab'], ['/email', 'email']],
    all: [['/account', 'account'], ['/account/usage', 'usage'], ['/account/connectors', 'connectors'], ['/trust/me', 'trust-center'],
      ['/account/portfolio', 'portfolio'], ['/account/billing', 'billing'], ['/perks', 'perks'], ['/calendar', 'calendar'],
      ['/my/events', 'events'], ['/learning', 'learning'], ['/help', 'help-center'], ['/pricing', 'pricing'],
      ['/c/example', 'companies'], ['/p/example', 'projects'], ['/account/licences', 'licences'], ['/influencer', 'influencer']],
  };
  const destinations = new Set<string>();
  for (const [shell, rows] of Object.entries(matrix)) {
    const profile = shell === 'super_admin' ? 'superadmin' : shell === 'exploring' ? 'explorer' : shell;
    for (const [path, section] of rows) {
      assert.deepEqual(hint(path, { shell, sidebar: true }), { profile, section }, path);
      destinations.add(profile + '/' + section);
    }
  }
  assert.equal(destinations.size, 81);
});

test('licence union, active shell and explicit shared-link origin', () => {
  assert.deepEqual(hint('/deals/42', { shell: 'founder', licences: ['founder', 'investor'] }), { profile: 'investor', section: 'deals' });
  assert.equal(hint('/deals/42', { shell: 'founder' }), null);
  assert.equal(hint('/due-diligence', { shell: 'founder', licences: ['advisor', 'partner'] }), null);
  assert.deepEqual(hint('/due-diligence', { shell: 'advisor', licences: ['advisor', 'partner'] }), { profile: 'advisor', section: 'due-diligence' });
  assert.deepEqual(hint('/account', { shell: 'super_admin', sidebar: true }), { profile: 'superadmin', section: 'settings' });
  assert.deepEqual(hint('/account', { shell: 'super_admin' }), { profile: 'all', section: 'account' });
  assert.deepEqual(hint('/trust/me', { shell: 'investor', sidebar: true }), { profile: 'investor', section: 'trust' });
  assert.deepEqual(hint('/trust/me', { shell: 'investor' }), { profile: 'all', section: 'trust-center' });
});

test('company and project detail never copy identifiers into the hint', () => {
  for (const [path, section] of [
    ['/c/private-co/settings', 'companies'], ['/c/private-co/p/private-project', 'projects'],
    ['/account/companies/company-uid/settings/compliance', 'companies'],
    ['/account/portfolio/company-uid/settings/projects/317?token=something', 'projects'],
    ['/projects/317/work', 'projects'], ['/account/portfolio/funds', 'portfolio'],
  ]) assert.deepEqual(hint(path, {}), { profile: 'all', section });
  assert.deepEqual(hint('/account/portfolio', {}, 'portfolio:create-project'), { profile: 'all', section: 'projects' });
  assert.deepEqual(hint('/account/portfolio', {}, 'portfolio:create-company'), { profile: 'all', section: 'companies' });
  assert.deepEqual(hint('/account/portfolio', {}, 'anonymous private value'), { profile: 'all', section: 'portfolio' });
});

test('no guessed roles, raw values or delivery target for unknown, public or malformed contexts', () => {
  for (const path of ['/admin/security', '/studio', '/raise/board', '/projects/invitations/accept', '/api/tickets', '/auth/reset/private', '/unmapped', '//external.test/account', null]) {
    assert.equal(hint(path, { shell: 'private identifier', licences: ['super_admin'], section: 'security' }), null);
  }
  assert.equal(hint('/researcher', { shell: 'founder' }), null);
  assert.equal(hint('/hq/unknown-tool', { shell: 'super_admin' }), null);
  assert.deepEqual(hint('/account/connectors/any', undefined), { profile: 'all', section: 'connectors' });
});

test('anonymous beacon reaches the mounted production handler, including a legacy body', async t => {
  const worker = (await import('../src/index.ts')).default;
  const { reportError } = await import('../../frontend/src/lib/log.js');
  const entries: Record<string, unknown>[] = [];
  t.mock.method(console, 'error', (tag: string, value: string) => {
    if (tag === '[client-error]') entries.push(JSON.parse(value));
  });
  const env = { JWT_SECRET: 'synthetic-only-client-section-jwt'.repeat(2), SCORING_HMAC_SECRET: 'synthetic-only-scoring'.repeat(3),
    APP_URL: 'https://example.test', RATE_LIMITS: memKV(), ENVIRONMENT: 'development' };
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil(p: Promise<unknown>) { pending.push(p); } };
  const post = (body: string) => worker.fetch(new Request('https://example.test/api/client-error', {
    method: 'POST', body, headers: { 'Content-Type': 'application/json' },
  }), env as any, ctx as any);
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { pathname: '/deals/42' } } });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
      querySelector: () => ({ dataset: { errorShell: 'founder', errorLicences: 'founder investor arbitrary-value' } }),
    } });
    let arrival: Promise<Response> | undefined;
    t.mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
      assert.equal(url, '/api/client-error');
      assert.equal(init.credentials, 'omit');
      const payload = JSON.parse(String(init.body));
      assert.deepEqual(payload.sectionContext, { shell: 'founder', licences: ['founder', 'investor'], sidebar: false });
      arrival = post(String(init.body));
      return arrival;
    });
    reportError('Deals:load', new Error('Synthetic failure'));
    assert.equal((await arrival)?.status, 204);
    assert.deepEqual(entries.at(-1)?.client_section_hint, { profile: 'investor', section: 'deals' });
    assert.equal((await post(JSON.stringify({ scope: 'Old:load', path: '/studio' }))).status, 204);
    assert.equal(entries.at(-1)?.client_section_hint, null);
    assert.equal(entries.at(-1)?.scope, 'Old:load');
    assert.equal((await post('not-json')).status, 204);
    assert.equal(entries.length, 2);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document');
    await Promise.allSettled(pending);
  }
});
