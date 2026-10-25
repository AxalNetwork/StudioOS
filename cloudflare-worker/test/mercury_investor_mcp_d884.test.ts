/**
 * D884 (#2557) — Deals › Pipeline: the investor's capacity beside the cheques
 * they intend on the live deals in their pipeline, on HQ or in a branch.
 *
 *   - the capacity is the stored fact Deals › Commit wrote; Pipeline opens no
 *     Mercury session and writes nothing;
 *   - only the investor's own commitments count, not withdrawn, on deals not
 *     yet funded or rejected; an amount that cannot be read is counted apart,
 *     never as 0;
 *   - no capacity fact reads null capacity and null headroom, never 0;
 *   - founders, admins and support sessions are refused before anything is read;
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
import { tableFromBaseline } from './_baseline.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { createMercuryInvestor, type OpenInvestorMercury } from '../src/routes/mercury_investor.ts';
import { INVESTOR_LANDS, MERCURY_FEEDS, mercuryFedModules } from '../src/integrations/mercuryFeeds.ts';
import { PERSONAL_MERCURY, audienceFor, connectorFeeds, getDescriptor, publicDescriptor } from '../src/integrations/registry.ts';
import { pageDescriptor } from '../src/integrations/connectorPages.ts';
import { HQ_ONLY_USES, PERSONAL_USES } from '../src/services/mercuryPersonal.ts';
import { PIPELINE_DEAL_STATUSES } from '../src/services/mercury/investorFeeds.ts';
import { ADMIN, FOUNDER, INVESTOR, FUND_ADMIN, envFor, freshDb, rows, tokenFor } from './_mercury_fixture.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const migration = (f: string) => read(`cloudflare-worker/sql/migrations/${f}`);
const noFks = (sql: string) => sql.replace(/\s+REFERENCES\s+"?\w+"?\s*\([^)]*\)(\s+ON\s+(DELETE|UPDATE)\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))*/gi, '');
const OTHER_INVESTOR = FUND_ADMIN;

function harness() {
  const db = freshDb();
  for (const t of ['commitments', 'deals', 'integrations', 'projects']) db.exec(noFks(tableFromBaseline(BASELINE, t)));
  db.exec(migration('445_connector_fed_items.sql'));
  db.exec(noFks(migration('522_mercury_investor_feeds.sql')));
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (5, 'Fixture Venture', ${FOUNDER})`);
  // One deal per status the board knows.
  db.exec(`INSERT INTO deals (id, project_id, status) VALUES (1, 5, 'applied'), (2, 5, 'scored'), (3, 5, 'active'), (4, 5, 'funded'), (6, 5, 'rejected')`);
  db.exec(`INSERT INTO commitments (id, deal_id, investor_user_id, amount, status) VALUES
    (11, 1, ${INVESTOR}, 10000, 'pending'),
    (12, 3, ${INVESTOR}, 15000.5, 'confirmed'),
    (13, 3, ${INVESTOR}, 2500, 'pending'),
    (14, 2, ${INVESTOR}, 9000, 'withdrawn'),
    (15, 4, ${INVESTOR}, 50000, 'confirmed'),
    (16, 6, ${INVESTOR}, 70000, 'pending'),
    (17, 2, ${INVESTOR}, 0, 'pending'),
    (18, 3, ${OTHER_INVESTOR}, 99000, 'pending')`);
  const opened: number[] = [];
  const open: OpenInvestorMercury = async (_c, user) => { opened.push(Number(user.id)); throw new Error('Pipeline must not open Mercury'); };
  const app = new Hono<any>();
  app.route('/api/mercury/investor', createMercuryInvestor({ open, today: () => '2026-10-15' }));
  app.onError((err: any, c) => {
    if (err instanceof Response) return err;
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  const env = envFor(db);
  async function get(as: number, opts: { impersonated?: boolean; branch?: string } = {}) {
    const res = await app.request('/api/mercury/investor/pipeline', {
      headers: { Authorization: `Bearer ${await tokenFor(as, { impersonated: opts.impersonated })}` },
    }, opts.branch ? { ...env, BRANCH_CODE: opts.branch } : env);
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text), text };
  }
  const capacity = (user: number, cents: number) => db.exec(
    `INSERT INTO mercury_investor_capacity (user_id, integration_id, available_cents, account_last_fours, as_of) VALUES (${user}, 70, ${cents}, '["1357"]', '2026-10-15')`,
  );
  return { db, get, opened, capacity };
}

test('Pipeline: capacity beside the cheques intended on live deals; withdrawn, funded and rejected are left out; an amount of 0 is counted apart', async () => {
  // Mutation checked: dropping `c.status <> 'withdrawn'` → total 3,650,050; 'funded' in PIPELINE_DEAL_STATUSES → 8,650,050; a 0 amount counted as a cheque → unrecorded 0, commitments 4.
  const h = harness();
  h.capacity(INVESTOR, 5000000);
  const r = await h.get(INVESTOR);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.intended, { total_cents: 2750050, deals: 2, commitments: 3, unrecorded: 1 });
  assert.deepEqual(r.body.capacity, { ...r.body.capacity, available_cents: 5000000, account_last_fours: ['1357'], as_of: '2026-10-15' });
  assert.equal(r.body.headroom_cents, 2249950);
  assert.deepEqual([...PIPELINE_DEAL_STATUSES], ['applied', 'scored', 'active']);
  assert.deepEqual(h.opened, [], 'Pipeline opens no Mercury session');
});

test('Pipeline: over capacity is a negative headroom; no capacity fact is null, never 0', async () => {
  const h = harness();
  h.capacity(INVESTOR, 1000000);
  assert.equal((await h.get(INVESTOR)).body.headroom_cents, 1000000 - 2750050);
  const none = await h.get(OTHER_INVESTOR);
  assert.equal(none.status, 200);
  assert.deepEqual(none.body, { capacity: null, intended: { total_cents: 9900000, deals: 1, commitments: 1, unrecorded: 0 }, headroom_cents: null });
});

test('Pipeline: an investor in a branch reads it; founder, admin and a support session are refused; nothing is written', async () => {
  // Mutation checked: policy() restored to refuse a branch → the branch read is 403.
  const h = harness();
  h.capacity(INVESTOR, 5000000);
  const before = JSON.stringify([rows(h.db, 'SELECT * FROM mercury_investor_capacity'), rows(h.db, 'SELECT * FROM connector_fed_items'), rows(h.db, 'SELECT * FROM commitments')]);
  assert.equal((await h.get(INVESTOR, { branch: 'lon' })).status, 200);
  for (const as of [FOUNDER, ADMIN]) {
    const r = await h.get(as);
    assert.equal(r.status, 403, String(as));
    assert.equal(r.body.error, 'purpose_not_allowed');
    assert.ok(!r.text.includes('5000000'));
  }
  const support = await h.get(INVESTOR, { impersonated: true });
  assert.equal(support.status, 403);
  assert.equal(support.body.error, 'support_session_refused');
  const after = JSON.stringify([rows(h.db, 'SELECT * FROM mercury_investor_capacity'), rows(h.db, 'SELECT * FROM connector_fed_items'), rows(h.db, 'SELECT * FROM commitments')]);
  assert.equal(after, before, 'a Pipeline read writes nothing');
});

test('the investor catalogue is MERCURY_FEEDS: the registry\'s investor feeds are its investor modules, Pipeline among them as shown', () => {
  // Mutation checked: the investor variant's feeds hand-listed without deals_pipeline → this fails.
  assert.deepEqual(PERSONAL_MERCURY.investor.feeds, mercuryFedModules('investor'));
  assert.deepEqual(connectorFeeds('mercury', 'investor'), mercuryFedModules('investor'));
  assert.ok(mercuryFedModules('investor').includes('deals_pipeline'));
  assert.equal(INVESTOR_LANDS.investor_pipeline, 'shown');
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
      { label: 'Deals · Pipeline', href: '/deals/pipeline' },
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
  assert.match(deals, /^Deals first\. Deals › Pipeline .* Deals › Commit .* Deals › Closing /);
  assert.match(fund, /^Then Fund › Calls, Accounting and Reporting/);
  assert.match(fund, /proof of funds: Axal’s admins see only a dated statement .* never a balance\.$/);
  assert.ok(!/token/i.test(JSON.stringify(page.long_description)), 'no token is offered to a member (D881)');
});
