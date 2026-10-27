/**
 * D884 (#2557) — an investor's own Mercury, on HQ or in a branch.
 *
 * D1243 (#3256) retired D884's Deals › Pipeline read (the capacity beside the
 * intended cheques) with the Pipeline zone; its route, its feed and its tests
 * left together. What stays:
 *   - the registry's investor feeds are `MERCURY_FEEDS`' investor modules;
 *   - an investor has the connector and its page on HQ and in a branch, never
 *     the entity's; proof of funds stays HQ-only by its use.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_investor_mcp_d884.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { createMercuryInvestor } from '../src/routes/mercury_investor.ts';
import { INVESTOR_LANDS, MERCURY_FEEDS, mercuryFedModules } from '../src/integrations/mercuryFeeds.ts';
import { PERSONAL_MERCURY, audienceFor, connectorFeeds, getDescriptor, publicDescriptor } from '../src/integrations/registry.ts';
import { pageDescriptor } from '../src/integrations/connectorPages.ts';
import { HQ_ONLY_USES, PERSONAL_USES } from '../src/services/mercuryPersonal.ts';
import { INVESTOR, envFor, freshDb, tokenFor } from './_mercury_fixture.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

test('D1243: GET /api/mercury/investor/pipeline is gone with the Pipeline zone, and nothing in the Worker serves it', async () => {
  // Mutation checked: the route restored in mercury_investor.ts → the 404 assertion fails.
  const app = new Hono<any>();
  app.route('/api/mercury/investor', createMercuryInvestor({ open: async () => { throw new Error('no Mercury is opened'); }, today: () => '2026-10-15' }));
  const res = await app.request('/api/mercury/investor/pipeline', {
    headers: { Authorization: `Bearer ${await tokenFor(INVESTOR)}` },
  }, envFor(freshDb()));
  assert.equal(res.status, 404);
  assert.doesNotMatch(read('cloudflare-worker/src/routes/mercury_investor.ts'), /app\.get\('\/pipeline'/);
  assert.doesNotMatch(read('cloudflare-worker/src/services/mercury/investorFeeds.ts'), /pipelineFigures|intendedCheques/);
});

test('the investor catalogue is MERCURY_FEEDS: the registry\'s investor feeds are its investor modules, and Pipeline is not among them (D1243)', () => {
  assert.deepEqual(PERSONAL_MERCURY.investor.feeds, mercuryFedModules('investor'));
  assert.deepEqual(connectorFeeds('mercury', 'investor'), mercuryFedModules('investor'));
  assert.ok(!mercuryFedModules('investor').includes('deals_pipeline'), 'the retired Pipeline feed is back');
  assert.equal(INVESTOR_LANDS.investor_pipeline, undefined);
  assert.deepEqual(Object.values(INVESTOR_LANDS).filter((v) => !['statement', 'fact', 'proposal'].includes(v)), [], 'no land is "shown" any more');
});

test('availability A: an investor has their own Mercury and its page on HQ and in a branch, never the entity\'s; proof of funds stays HQ-only by its use', () => {
  // Mutation checked: `personal_hq_only_roles: ['investor']` restored → the branch audience is 'none' and the page is null.
  const mercury = getDescriptor('mercury')!;
  const investorPage = pageDescriptor(mercury, { role: 'investor', hq: true });
  for (const hq of [true, false]) {
    assert.equal(audienceFor(mercury, { role: 'investor', hq }), 'personal', `investor, hq=${hq}`);
    const page = pageDescriptor(mercury, { role: 'investor', hq });
    assert.ok(page, `the investor page, hq=${hq}`);
    assert.equal(page!.tagline, investorPage!.tagline);
    assert.ok(!/entity|entities|Axal VC's own|holdings/i.test(JSON.stringify(page)), 'no Axal entity data on the investor page');
  }
  assert.ok(PERSONAL_USES.investor.length > 0 && PERSONAL_USES.investor.every((u) => HQ_ONLY_USES.includes(u)), 'every investor proof-of-funds use is HQ-only');
  assert.ok(HQ_ONLY_USES.includes('capital_attestation'));
});

test('PR 2: the investor card links each section it fills, Deals first, all from MERCURY_FEEDS; a partner card links none', () => {
  // Mutation checked: used_by back to [] for the investor → the first deepEqual fails; pulls not filtered by module → the pulls deepEqual fails.
  const mercury = getDescriptor('mercury')!;
  for (const hq of [true, false]) {
    const card: any = publicDescriptor(mercury, { role: 'investor', hq, venture: false });
    assert.deepEqual(card.used_by, [
      { label: 'Deals · Commit', href: '/deals/commit' },
      { label: 'Deals · Closing', href: '/deals/closing' },
      { label: 'Fund · Calls', href: '/funds/calls' },
      { label: 'Fund · Accounting', href: '/funds/ledger' },
      { label: 'Fund · Reporting', href: '/funds/reporting' },
    ], `hq=${hq}`);
    assert.deepEqual(card.pulls, MERCURY_FEEDS.filter((f) => f.role === 'investor' && f.module).map((f) => ({ what: f.what, module: f.module })));
    assert.deepEqual(card.used_by.map((u: any) => u.href.split('/').pop()), card.feeds.map((m: string) => m.split('_')[1]),
      'one link per fed section, in the same order');
  }
  const partner: any = publicDescriptor(mercury, { role: 'partner', hq: true, venture: false });
  assert.deepEqual([partner.used_by, partner.pulls], [[], []]);
});

test('PR 2: the investor page signs in with Mercury only, says what it reads, leads with Deals and lists proof of funds last', () => {
  // Mutation checked: the Deals paragraph without its lead → the order assertion fails; a token line put back → the token assertion fails.
  const page = pageDescriptor(getDescriptor('mercury')!, { role: 'investor', hq: false, venture: false } as any)!;
  assert.deepEqual(page.sign_in, { kind: 'mcp', label: 'Sign in with Mercury', key_help_href: null });
  const [reads, deals, fund] = page.long_description;
  assert.match(reads, /names, kinds and last four digits/);
  assert.match(reads, /A balance is shown to you alone/);
  assert.match(deals, /^Deals first\. Deals › Commit .* Deals › Closing /);
  assert.ok(!/Pipeline/.test(deals), 'the retired Pipeline read is still promised');
  assert.match(fund, /^Then Fund › Calls, Accounting and Reporting/);
  assert.match(fund, /proof of funds: Axal’s admins see only a dated statement .* never a balance\.$/);
  assert.ok(!/token/i.test(JSON.stringify(page.long_description)), 'no token is offered to a member (D881)');
});
