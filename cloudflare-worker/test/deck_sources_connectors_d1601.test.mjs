/**
 * D1601 (#3880) — the deck source adapters for PostHog (`product`), HubSpot
 * (`pipeline`) and Linear (`shipping`).
 *
 * The database is the baseline plus every numbered migration above the
 * cutoff, schema only, as deck_sources_d896.test.ts builds one. HubSpot is a
 * fake on `api.hubapi.com` and Linear's read-only server the shared MCP fake;
 * no test reaches a real host. Every person, venture and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_sources_connectors_d1601.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckSources from '../src/routes/deck_sources.ts';
import { DECK_SOURCES, SHIPPING_PAGES, productReads, readSources, shippingCounts } from '../src/services/decks/sources.ts';
import { CHART_SERIES, readSeries } from '../src/services/decks/chartSeries.ts';
import { CUSTOMERS, OPEN_DEALS, READ_PROPERTIES } from '../src/services/decks/hubspotCounts.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { MCP_PROVIDERS } from '../src/integrations/mcpProviders.ts';
import { LINEAR_MCP_URL, LINEAR_READ_TOOLS, openLinearReads } from '../src/services/linear/reads.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { notesFake } from './_mcp_fake.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const FOUNDER = 10, COFOUNDER = 11, P = 1, COMPANY = 77;
const HUBSPOT_ID = 21, LINEAR_ID = 22, POSTHOG_ID = 23;
const TODAY = '2026-10-31';
const NEW_KEYS = ['grow.activation_rate', 'grow.retention_w4', 'grow.wau', 'grow.open_deals', 'grow.pipeline_value', 'grow.crm_customers', 'build.shipped_90d', 'build.cycle_velocity'];

const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all().map((r) => r.sql);
})();

const env = (db) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const add = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  add.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  add.run(COFOUNDER, 'founder', 'Cy Cofounder', 'cy@example.test', 1003);
  db.exec(`INSERT INTO projects (id, name, founder_id, company_id) VALUES (${P}, 'Kestrel Labs', 1001, ${COMPANY})`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${P}, ${COFOUNDER}, 'cofounder', 'accepted')`);
  db.exec(`INSERT INTO user_company_links (uid, company_id, user_id) VALUES ('ucl1', ${COMPANY}, ${FOUNDER}), ('ucl2', ${COMPANY}, ${COFOUNDER})`);
  return db;
}

/** One of the founder's connections, switched on for the venture's company unless `off`. */
async function connect(db, id, provider, creds, { off = false, auth = 'oauth' } = {}) {
  const uid = `int-${provider}-0001`;
  db.prepare('INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type, credentials_enc) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, uid, FOUNDER, provider, 'active', auth, await encryptCredentials(env(db), uid, creds));
  if (!off) db.prepare('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, 1)').run(id, COMPANY);
}

// ── HubSpot, faked ───────────────────────────────────────────────────────

/** HubSpot's CRM search: `totals` per filter, open deals' amounts paged by `after`. Records every body. */
function hubspotFake({ open = 7, customers = 3, amounts = [1000, 2500.5, null, 400], page = 2, status = 200, hang = false } = {}) {
  const bodies = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    assert.equal(u.hostname, 'api.hubapi.com', 'only HubSpot is called');
    if (hang) return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const body = JSON.parse(init.body);
    bodies.push({ path: u.pathname, body });
    if (status !== 200) return new Response('{"message":"fixture failure"}', { status });
    const filter = body.filterGroups[0].filters[0];
    if (u.pathname.endsWith('/companies/search')) return Response.json({ total: customers, results: [{ id: '1' }] });
    if (body.properties[0] === 'hs_object_id') return Response.json({ total: open, results: [{ id: '1' }] });
    const from = Number(body.after ?? 0);
    const results = amounts.slice(from, from + page).map((a, i) => ({ id: String(from + i), properties: { amount: a == null ? null : String(a) } }));
    return Response.json({ total: open, results, ...(from + page < amounts.length ? { paging: { next: { after: String(from + page) } } } : {}), filter });
  };
  return { fetch, bodies };
}

// ── Linear, faked ────────────────────────────────────────────────────────

const LINEAR = MCP_PROVIDERS.linear;
const linearTools = () => LINEAR_READ_TOOLS.map((name) => ({ name, inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }));
const uuid = (n) => `1a2b3c4d-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Linear's `/readonly` server answering `list_issues` with `issues`, `perPage` at a time by cursor. */
function linearFake(issues, { perPage = 50, cursorless = false } = {}) {
  const args = [];
  const fake = notesFake({
    era: 'modern', hosts: { mcp: 'mcp.linear.app', auth: 'mcp.linear.app' }, resource: LINEAR_MCP_URL, path: '/mcp/readonly',
    tools: linearTools(), scope: 'read',
    answer: (tool, a) => {
      args.push({ tool, args: a });
      const from = Number(a.cursor ?? 0);
      const slice = issues.slice(from, from + perPage);
      const more = from + perPage < issues.length;
      return { issues: slice, ...(cursorless ? {} : more ? { pageInfo: { hasNextPage: true, endCursor: String(from + perPage) } } : { pageInfo: { hasNextPage: false } }) };
    },
  });
  return { ...fake, args };
}

/** `n` completed issues, `recent` of them in the last 28 days; each carries fields a deck must never keep. */
function completed(n, recent) {
  return Array.from({ length: n }, (_, i) => ({
    id: uuid(i + 1), identifier: `FIX-${i + 1}`, title: `Fixture issue ${i + 1}`,
    completedAt: i < recent ? '2026-10-20T10:00:00.000Z' : '2026-09-01T10:00:00.000Z',
    assignee: { name: 'Fixture person', email: 'person@example.test' },
  }));
}

async function linearConnect(db, fake) {
  await connect(db, LINEAR_ID, 'linear', {
    access_token: fake.signedIn(), client_key: 'mcp_client:linear:fixture', resource: LINEAR_MCP_URL,
    scopes: ['read'], expires_at: Date.now() + 3_600_000,
  }, { auth: 'oauth_mcp' });
}

/** One fetch for both fakes, as production has one `fetch`. */
const both = (hs, ln) => async (url, init) => (new URL(url).hostname === 'api.hubapi.com' ? hs.fetch(url, init) : ln.fetch(url, init));
const founderCtx = (db, fetcher, extra = {}) => ({ env: env(db), projectId: P, today: TODAY, mercury: null, connectors: { fetcher, ...extra } });
const byKey = (items) => new Map(items.map((i) => [i.source_key, i]));

// ── Tests ────────────────────────────────────────────────────────────────

test('PostHog: a stored fact is recorded as Connector · Measured with its date; no fact is not recorded, never 0', async () => {
  const facts = [{ key: 'activation_rate', value: 41.5, as_of: '2026-10-27', ref: 'fact:9' }, { key: 'wau', value: null, as_of: '2026-10-27', ref: 'fact:10' }];
  const reads = productReads(facts);
  assert.deepEqual(reads['grow.activation_rate'], { value: 41.5, as_of: '2026-10-27', origin: 'connector', record_ref: 'posthog:fact:9' });
  assert.equal(reads['grow.wau'], undefined, 'a fact with no value leaves its slot not recorded');
  assert.deepEqual(productReads([]), {}, 'no fact, no slot: never a 0');

  // Linked, but no feed stores a fact yet (#3731): every product slot is not recorded, and so is the series.
  const db = fixture();
  await connect(db, POSTHOG_ID, 'posthog', { access_token: 'fixture' }, { auth: 'oauth_mcp' });
  db.exec(`INSERT INTO posthog_project_links (uid, integration_id, project_id, posthog_project_id, linked_by) VALUES ('l1', ${POSTHOG_ID}, ${P}, '4242', ${FOUNDER})`);
  const m = byKey((await readSources(founderCtx(db, hubspotFake().fetch))).items);
  for (const k of ['grow.activation_rate', 'grow.retention_w4', 'grow.wau']) {
    assert.equal(m.get(k).state, 'not_recorded', k);
    assert.equal(m.get(k).value, null, k);
    assert.equal(m.get(k).module, 'Connectors › PostHog', k);
  }
  const s = await readSeries(env(db), P, 'grow.wau.weekly');
  assert.equal(s.state, 'not_recorded');
  assert.deepEqual(s.points, []);
  assert.ok(CHART_SERIES.some((d) => d.key === 'grow.wau.weekly' && d.cadence === 'weekly' && d.unit === 'count' && d.module === 'Connectors › PostHog'));
});

test('HubSpot: the search totals fill the pipeline slots as Connector · Measured, dated today', async () => {
  const db = fixture();
  await connect(db, HUBSPOT_ID, 'hubspot', { access_token: 'pat-fixture', is_private_app: true });
  const hs = hubspotFake({ open: 7, customers: 3, amounts: [1000, 2500.5, null, 400, ''], page: 2 });
  const m = byKey((await readSources(founderCtx(db, hs.fetch))).items);
  const open = m.get('grow.open_deals');
  assert.equal(open.state, 'recorded');
  assert.equal(open.value, 7, 'the total, not the length of the one result asked for');
  assert.equal(open.source, 'Connector');
  assert.equal(open.grade, 'Measured');
  assert.equal(open.as_of, TODAY);
  assert.equal(open.record_ref, `hubspot:${HUBSPOT_ID}:open_deals`);
  assert.equal(m.get('grow.pipeline_value').value, 3900.5, 'every page of open deals is summed; a deal with no amount adds nothing');
  assert.equal(m.get('grow.pipeline_value').unit, 'usd');
  assert.equal(m.get('grow.crm_customers').value, 3);
  assert.equal(hs.bodies.filter((b) => b.body.properties[0] === 'amount').length, 3, 'three pages of amounts');
});

test('HubSpot: every request asks for one counting property and filters on two flags; no person-level field is ever named', async () => {
  const db = fixture();
  await connect(db, HUBSPOT_ID, 'hubspot', { access_token: 'pat-fixture', is_private_app: true });
  const hs = hubspotFake();
  await readSources(founderCtx(db, hs.fetch));
  assert.ok(hs.bodies.length >= 3);
  const PERSON = /email|name|owner|phone|firstname|lastname|contact|address/i;
  for (const { path, body } of hs.bodies) {
    assert.match(path, /^\/crm\/v3\/objects\/(deals|companies)\/search$/, 'a CRM search, nothing else');
    assert.equal(body.properties.length, 1, 'one property, never the defaults');
    assert.ok(READ_PROPERTIES.includes(body.properties[0]), body.properties[0]);
    for (const f of body.filterGroups.flatMap((g) => g.filters)) {
      assert.ok([OPEN_DEALS.propertyName, CUSTOMERS.propertyName].includes(f.propertyName), f.propertyName);
      assert.doesNotMatch(f.propertyName, PERSON);
    }
    assert.deepEqual(Object.keys(body).filter((k) => k !== 'after').sort(), ['filterGroups', 'limit', 'properties'], 'nothing else is asked for');
    assert.doesNotMatch(body.properties[0], PERSON);
  }
  const counts = hs.bodies.filter((b) => b.body.properties[0] === 'hs_object_id');
  assert.ok(counts.every((b) => b.body.limit === 1), 'a count asks for one row and reads only `total`');
});

test('HubSpot failing or past the deadline marks only its three slots unreadable; the other adapters still answer', async () => {
  for (const hs of [hubspotFake({ status: 500 }), hubspotFake({ hang: true })]) {
    const db = fixture();
    await connect(db, HUBSPOT_ID, 'hubspot', { access_token: 'pat-fixture', is_private_app: true });
    db.exec(`INSERT INTO competitor_tracking (uid, project_id, name_norm, updated_at) VALUES ('t1', ${P}, 'rival a', '2026-10-06')`);
    const started = Date.now();
    const { items, coverage } = await readSources(founderCtx(db, hs.fetch, { deadlineMs: 80 }));
    assert.ok(Date.now() - started < 2000, 'the deadline ends the read');
    const m = byKey(items);
    for (const k of ['grow.open_deals', 'grow.pipeline_value', 'grow.crm_customers']) assert.equal(m.get(k).state, 'unreadable', k);
    assert.equal(coverage.unreadable, 3, 'one failure blanks one adapter, not every source');
    assert.equal(m.get('validate.competitors').state, 'recorded', 'another adapter still answers');
    assert.ok(!JSON.stringify(items).includes('fixture failure'), 'HubSpot\'s words never reach an item');
  }
});

test('a connection not switched on for the venture\'s company, or not connected, is not recorded, not unreadable', async () => {
  const db = fixture();
  await connect(db, HUBSPOT_ID, 'hubspot', { access_token: 'pat-fixture', is_private_app: true }, { off: true });
  const hs = hubspotFake();
  const m = byKey((await readSources(founderCtx(db, hs.fetch))).items);
  for (const k of ['grow.open_deals', 'grow.pipeline_value', 'grow.crm_customers', 'build.shipped_90d', 'build.cycle_velocity']) {
    assert.equal(m.get(k).state, 'not_recorded', k);
    assert.equal(m.get(k).value, null, k);
  }
  assert.equal(hs.bodies.length, 0, 'a connection switched off is never called');
});

test('Linear: 120 completed issues over three pages are all counted; the 4-week mean is per week; only ids and dates are kept', async () => {
  const db = fixture();
  const ln = linearFake(completed(120, 18), { perPage: 50 });
  await linearConnect(db, ln);
  const m = byKey((await readSources(founderCtx(db, both(hubspotFake(), ln)))).items);
  const shipped = m.get('build.shipped_90d');
  assert.equal(shipped.state, 'recorded');
  assert.equal(shipped.value, 120, 'every page, not the first');
  assert.equal(shipped.source, 'Connector');
  assert.equal(shipped.grade, 'Measured');
  assert.equal(shipped.record_ref, `linear:${LINEAR_ID}:shipped_90d`);
  assert.equal(m.get('build.cycle_velocity').value, 4.5, '18 in 28 days is 4.5 a week');
  const calls = ln.args.filter((a) => a.tool === 'list_issues');
  assert.equal(calls.length, 3);
  for (const c of calls) {
    assert.equal(c.args.state, 'completed');
    assert.equal(c.args.updatedAt, '-P90D');
    assert.equal(c.args.limit, 50);
  }
  assert.ok(ln.args.every((a) => a.tool === 'list_issues'), 'no other tool');
  const text = JSON.stringify([...m.values()]);
  assert.ok(!/Fixture issue|Fixture person|person@example\.test|FIX-1\b/.test(text), 'no title, assignee or email reaches an item');
  // The read itself keeps an id and a date, nothing else.
  const reads = await openLinearReads({ accessToken: ln.signedIn(), fetcher: ln.fetch, resource: LINEAR_MCP_URL, scopes: ['read'], refresh: async () => null });
  const page = await reads.listCompleted({ days: 90 });
  assert.equal(page.issues.length, 50);
  for (const i of page.issues) assert.deepEqual(Object.keys(i).sort(), ['completed_at', 'id']);
  assert.deepEqual([page.next, page.done], ['50', false]);
});

test('Linear: past ten pages, or a full page with no cursor, the count is a floor marked :capped', async () => {
  const many = completed(SHIPPING_PAGES * 50 + 20, 0);
  let got = await shippingCountsOf(many, { perPage: 50 });
  assert.equal(got.shipped, 500);
  assert.equal(got.capped, true);
  got = await shippingCountsOf(completed(50, 0), { perPage: 50, cursorless: true });
  assert.equal(got.capped, true, 'a full page that names no next page may hide more');
  got = await shippingCountsOf(completed(30, 0), { perPage: 50, cursorless: true });
  assert.equal(got.capped, false, 'a short page is the last');

  const db = fixture();
  const ln = linearFake(many, { perPage: 50 });
  await linearConnect(db, ln);
  const m = byKey((await readSources(founderCtx(db, both(hubspotFake(), ln)))).items);
  assert.equal(m.get('build.shipped_90d').record_ref, `linear:${LINEAR_ID}:shipped_90d:capped`);
  assert.equal(m.get('build.shipped_90d').value, 500);
});

/** `shippingCounts` over an in-memory list, `perPage` at a time. */
function shippingCountsOf(issues, opts) {
  const pages = [];
  for (let i = 0; i < Math.max(issues.length, 1); i += opts.perPage) pages.push(issues.slice(i, i + opts.perPage));
  return shippingCounts({
    async listCompleted({ cursor }) {
      const n = cursor == null ? 0 : Number(cursor);
      const slice = pages[n] ?? [];
      const more = n + 1 < pages.length;
      return {
        issues: slice.map((x) => ({ id: x.id, completed_at: x.completedAt })),
        next: opts.cursorless || !more ? null : String(n + 1),
        done: opts.cursorless ? slice.length < opts.perPage : !more,
      };
    },
  }, TODAY);
}

// ── The route ────────────────────────────────────────────────────────────

const app = new Hono();
app.route('/api/decks', deckSources);
app.onError((err, c) => c.json({ detail: String(err?.message || '') }, 500));

async function get(db, who) {
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(`/api/decks/sources?project_id=${P}`, { headers: { Authorization: `Bearer ${token}` } }, env(db)));
    return { status: res.status, body: await res.json() };
  } finally { [console.warn, console.error] = saved; }
}

test('a cofounder reads the venture, but its HubSpot and Linear are withheld and left out of the count', async () => {
  const db = fixture();
  await connect(db, HUBSPOT_ID, 'hubspot', { access_token: 'pat-fixture', is_private_app: true });
  const { status, body } = await get(db, COFOUNDER);
  assert.equal(status, 200);
  const m = byKey(body.items);
  for (const k of ['grow.open_deals', 'grow.pipeline_value', 'grow.crm_customers', 'build.shipped_90d', 'build.cycle_velocity']) {
    assert.equal(m.get(k).state, 'withheld', k);
    assert.equal(m.get(k).value, null, k);
  }
  assert.equal(m.get('grow.wau').state, 'not_recorded', 'PostHog\'s stored facts are the venture\'s, not withheld');
  const slots = DECK_SOURCES.flatMap((a) => a.slots.filter((s) => !s.optional)).length;
  assert.equal(body.coverage.slots, slots - 4 - 5, 'the bank and the founder\'s two tools are not slots for this reader');
});

test('coverage: the three adapters add exactly eight slots, and the route lists them with no change', async () => {
  const ids = DECK_SOURCES.map((a) => a.id);
  for (const id of ['product', 'pipeline', 'shipping']) assert.ok(ids.includes(id), id);
  const added = DECK_SOURCES.filter((a) => ['product', 'pipeline', 'shipping'].includes(a.id)).flatMap((a) => a.slots.map((s) => s.key));
  assert.deepEqual(added.sort(), [...NEW_KEYS].sort());
  assert.equal(new Set(DECK_SOURCES.flatMap((a) => a.slots.map((s) => s.key))).size, DECK_SOURCES.flatMap((a) => a.slots).length, 'no key twice');
  const area = Object.fromEntries(DECK_SOURCES.map((a) => [a.id, a.area]));
  assert.deepEqual([area.product, area.pipeline, area.shipping], ['grow', 'grow', 'build']);
  const db = fixture();
  const { status, body } = await get(db, FOUNDER);
  assert.equal(status, 200);
  const m = byKey(body.items);
  for (const k of NEW_KEYS) assert.ok(m.has(k), k);
  for (const k of NEW_KEYS) assert.notEqual(m.get(k).value, 0, `${k} is never 0 when nothing was read`);
});

test('the source tree: counts only, bound SQL, and one Linear session path', () => {
  const src = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const code = (p) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const counts = code('cloudflare-worker/src/services/decks/hubspotCounts.ts');
  assert.doesNotMatch(counts, /console\.(log|warn|error)/, 'nothing HubSpot sent is logged');
  assert.doesNotMatch(counts, /contacts|dealname|hubspot_owner_id|email/i);
  const sources = src('cloudflare-worker/src/services/decks/sources.ts');
  assert.doesNotMatch(sources, /\$\{[^}]*\}[^`]*\b(FROM|WHERE)\b/, 'no interpolated SQL');
  assert.match(sources, /linearReadsFor\(/, 'Linear is read through its one reads module');
  assert.doesNotMatch(sources, /openMcpSession/);
});
