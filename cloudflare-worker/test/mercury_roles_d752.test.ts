/**
 * D752 (#1886) sections 1 and 2 — who sees which Mercury card, in whose words.
 *
 *  - `audienceFor` for every role, on HQ and on a branch, against the table
 *    written here. D884 (#2557, the owner's answer A): an investor is
 *    `personal` on HQ and on a branch; proof of funds stays HQ-only by its use.
 *  - The registry, the uses and the variants agree: `personal_roles`,
 *    `PERSONAL_USES` and `PERSONAL_MERCURY` hold the same roles, and
 *    `personal_hq_only_roles` is exactly the roles whose every use is in
 *    `HQ_ONLY_USES`. Founder and partner keep D713's words, written out here.
 *  - `publicDescriptor` serves the investor's variant and never the audience
 *    fields; `connectorFeeds` goes by role.
 *  - `/connect` answers an investor on a branch 403 before its 404 and before
 *    the provider: nothing reaches Mercury and nothing is stored.
 *  - `personalPolicy` refuses every use in `HQ_ONLY_USES` off HQ with 403
 *    `hq_only`, through the one list: `capital_attestation` as `partner_deals`.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_roles_d752.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { requireAuth } from '../src/auth.ts';
import {
  PERSONAL_MERCURY, audienceFor, connectorFeeds, getDescriptor, personalHqOnlyOffHq, personalMercuryFor, publicDescriptor,
} from '../src/integrations/registry.ts';
import { HQ_ONLY_USES, PERSONAL_USES, personalPolicy } from '../src/services/mercuryPersonal.ts';
import { personalFixture, bank, req, count, TOKEN } from './_mercury_personal_d713.ts';
import { mercuryFedModules } from '../src/integrations/mercuryFeeds.ts';

const mercury = getDescriptor('mercury')!;

// role → [on HQ, on a branch]
const AUDIENCE: Record<string, [string, string]> = {
  admin: ['preview', 'none'], // D879 (#2552): the founder's page, read-only; D710's entity row is gone
  founder: ['personal', 'personal'],
  partner: ['personal', 'personal'],
  investor: ['personal', 'personal'],
  advisor: ['none', 'none'],
  mentor: ['none', 'none'],
  operator: ['none', 'none'],
  service_provider: ['none', 'none'],
  exploring: ['none', 'none'],
};

const D713_DESCRIPTION = 'Your own Mercury account, read-only: import the credits you choose as venture revenue (founders), and match your invoices, payouts and partner-deal settlements to your own bank lines (partners).';
const D713_PERMISSION = 'Read your Mercury account names, last four digits and the transactions you review; it never sends, transfers or requests money.';
// D752 (#1889): the founder's words, now that a founder also reads spending.
const FOUNDER_DESCRIPTION = 'Your own Mercury account, read-only: import the credits you choose as venture revenue, and see each month\'s spending, burn, cash on hand and runway. Only the figures you choose are saved.';
const FOUNDER_PERMISSION = 'Read your Mercury account names, last four digits, available balances and the transactions you review; it never sends, transfers or requests money.';

const sorted = (xs: Iterable<string>) => [...xs].sort();

test('audienceFor: every role on HQ and on a branch, as D752 section 1\'s table says', () => {
  for (const [role, [hq, branch]] of Object.entries(AUDIENCE)) {
    assert.equal(audienceFor(mercury, { role, hq: true }), hq, `${role} on HQ`);
    assert.equal(audienceFor(mercury, { role, hq: false }), branch, `${role} on a branch`);
    // D884: no role is hidden off HQ any more; an HQ-only use is refused by its use (personalPolicy, below).
    assert.equal(personalHqOnlyOffHq(mercury, { role, hq: false }), false, `${role} is never HQ-only off HQ`);
    assert.equal(personalHqOnlyOffHq(mercury, { role, hq: true }), false, `${role} on HQ is never refused as HQ-only`);
  }
  assert.equal(audienceFor(mercury, { role: 'INVESTOR', hq: false }), 'personal', 'the role is compared lower-cased');
});

test('the registry, the uses and the variants agree; the partner keeps D713\'s words and the founder has D752\'s', () => {
  assert.deepEqual(sorted(mercury.personal_roles!), sorted(Object.keys(PERSONAL_USES)));
  assert.deepEqual(sorted(mercury.personal_roles!), sorted(Object.keys(PERSONAL_MERCURY)));
  // D884: the investor's only D752 use is HQ-only, but its D840 sections are not, so the connector is offered everywhere.
  assert.deepEqual(mercury.personal_hq_only_roles ?? [], []);
  assert.ok(PERSONAL_USES.investor.every((u) => HQ_ONLY_USES.includes(u)), 'proof of funds stays an HQ-only use');
  assert.ok(mercuryFedModules('investor').length > 0, 'the investor\'s sections are offered on every host');
  for (const [role, v] of Object.entries(PERSONAL_MERCURY)) {
    assert.equal(v.permissions.length, 1, `${role}: one permission sentence`);
    assert.match(v.permissions[0], /never sends, transfers or requests money/, role);
    assert.ok(v.description.trim() && v.capabilities.length, role);
  }
  assert.equal(PERSONAL_MERCURY.partner.description, D713_DESCRIPTION);
  assert.deepEqual(PERSONAL_MERCURY.partner.capabilities, ['Revenue import', 'Payment matching']);
  assert.deepEqual(PERSONAL_MERCURY.partner.permissions, [D713_PERMISSION]);
  assert.equal(PERSONAL_MERCURY.founder.description, FOUNDER_DESCRIPTION);
  assert.deepEqual(PERSONAL_MERCURY.founder.capabilities, ['Revenue import', 'Payment matching', 'Spending and runway']);
  assert.deepEqual(PERSONAL_MERCURY.founder.permissions, [FOUNDER_PERMISSION]);
  // D840 part 4 (#2349), D884 (#2557): the investor's Deals sections lead; proof of funds is last, on HQ.
  assert.deepEqual(PERSONAL_MERCURY.investor.capabilities, ['Capacity', 'Closing proposals', 'Fund calls, accounting and reporting proposals', 'Proof of funds']);
  assert.equal(personalMercuryFor('advisor'), null);
  assert.equal(personalMercuryFor('Investor'), PERSONAL_MERCURY.investor);
});

test('publicDescriptor serves the investor\'s variant on HQ and never the audience fields; connectorFeeds goes by role', () => {
  const own = publicDescriptor(mercury, { role: 'investor', hq: true }) as any;
  assert.equal(own.description, PERSONAL_MERCURY.investor.description);
  assert.deepEqual(own.capabilities, ['Capacity', 'Closing proposals', 'Fund calls, accounting and reporting proposals', 'Proof of funds']);
  assert.deepEqual(own.permissions, PERSONAL_MERCURY.investor.permissions);
  assert.deepEqual(own.feeds, ['deals_pipeline', 'deals_commit', 'deals_closing', 'fund_calls', 'fund_ledger', 'fund_reporting']);
  assert.equal(own.has_implementation, true);
  for (const field of ['preview_roles', 'personal_roles', 'personal_hq_only_roles']) assert.ok(!(field in own), field);
  const founder = publicDescriptor(mercury, { role: 'founder', hq: false }) as any;
  assert.equal(founder.description, FOUNDER_DESCRIPTION);
  assert.deepEqual(founder.feeds, mercuryFedModules('founder'));
  assert.deepEqual(connectorFeeds('mercury', 'investor'), ['deals_pipeline', 'deals_commit', 'deals_closing', 'fund_calls', 'fund_ledger', 'fund_reporting']);
  assert.deepEqual(connectorFeeds('mercury', 'founder'), mercuryFedModules('founder'));
  assert.ok(connectorFeeds('mercury', 'founder').includes('revenue_and_traction'));
  assert.deepEqual(connectorFeeds('mercury', 'partner'), []);
});

test('D884: /connect takes an investor on a branch to the provider, as on HQ; proof of funds still refuses off HQ (personalPolicy, below)', async () => {
  const { db, env } = await personalFixture();
  const b = bank();
  try {
    const r = await req(env, 30, 'POST', '/api/connectors/connect',
      { provider_key: 'mercury', api_key: TOKEN, config: { confirm_read_only: true } }, { branch: true });
    assert.deepEqual([r.status, r.body.error], [410, 'token_connect_retired'], r.text);
    assert.notEqual(r.body.error, 'purpose_not_allowed');
    assert.equal(b.calls.length, 0, 'D881: a token is never checked against Mercury');
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM integrations WHERE provider_key = 'mercury' AND user_id = 30"), 0);
  } finally { b.restore(); }
});

test('personalPolicy: each HQ-only use is 403 hq_only off HQ and allowed on HQ, through the one list; a use the role does not hold is purpose_not_allowed', async () => {
  const { env } = await personalFixture();
  const app = new Hono<any>();
  app.get('/policy/:use', async (c) => {
    const user = await requireAuth(c);
    return (await personalPolicy(c, user, c.req.param('use') as any)) ?? c.json({ ok: true });
  });
  const ask = async (who: number, role: string, use: string, branch: boolean) => {
    const jwt = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(env.JWT_SECRET));
    const res = await app.request(`/policy/${use}`, { headers: { Authorization: `Bearer ${jwt}` } }, branch ? { ...env, BRANCH_CODE: 'ldn' } : env);
    const body: any = await res.json();
    return [res.status, body.error ?? null];
  };
  assert.deepEqual(await ask(30, 'investor', 'capital_attestation', false), [200, null]);
  assert.deepEqual(await ask(30, 'investor', 'capital_attestation', true), [403, 'hq_only']);
  assert.deepEqual(await ask(20, 'partner', 'partner_deals', true), [403, 'hq_only']);
  assert.deepEqual(await ask(20, 'partner', 'practice_income', true), [200, null], 'a use not in the list works on a branch');
  assert.deepEqual(await ask(10, 'founder', 'capital_attestation', false), [403, 'purpose_not_allowed']);
});
