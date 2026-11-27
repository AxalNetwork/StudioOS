/**
 * D2407 (#2407 part 2) — a founder's own Beehiiv in Grow, against the fake
 * (`_beehiiv_mcp_fake.mjs`), on the Grow world Mercury's tests use
 * (`_mercury_grow_fixture.ts`): real SQL on node:sqlite, the real routes.
 * Every name, id and figure is invented.
 *
 *  1. A sync lands one dated snapshot and the sent posts through the ledger,
 *     every rate a fraction, the channel proposal raised once; no address.
 *  2. A re-sync updates the same rows; a new day is a new snapshot, and
 *     growth is computed when read.
 *  3. A deleted figure or post stays deleted, through a re-sync and through
 *     a disconnect and a new sign-in.
 *  4. A dismissed proposal never returns.
 *  5. Accept is needed to link a channel: nothing is linked before it, and
 *     only the member whose Beehiiv serves the venture decides.
 *  6. Both rate shapes normalise to fractions.
 *  7. An unreadable part keeps the module.
 *  8. The logs carry counts only.
 *  9. Never 0 for a missing figure: it is null with its reason, and is not landed.
 * 10. The feeds list, the connector page and the registry agree.
 * 11. Who: a support session is refused; a teammate deletes but does not sync;
 *     a reader of the venture sees the figures (decision D1); a company
 *     switched off refuses the sync.
 * 12. The Updates rows carry `newsletter: null` with its reason until part 3.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/beehiiv_grow_2407.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cycleGrow from '../src/routes/cycle_grow.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { CONNECTOR_METADATA } from '../src/integrations/registry.ts';
import { CONNECTOR_PAGES } from '../src/integrations/connectorPages.ts';
import { MODULE_LABELS } from '../src/integrations/moduleLabels.ts';
import { BEEHIIV_FEEDS } from '../src/integrations/beehiivFeeds.ts';
import { BEEHIIV_READ_TOOLS } from '../src/services/beehiiv/mcp.ts';
import { normaliseRate } from '../src/services/beehiiv/reads.ts';
import { NEWSLETTER_NOT_LINKED, NEWSLETTER_UNREADABLE, SENTENCES } from '../src/services/beehiiv/grow.ts';
import { ADVISOR, COFOUNDER, FOUNDER, PID, ROLE, growDb } from './_mercury_grow_fixture.ts';
import { BEEHIIV_ISSUER, BEEHIIV_MCP_URL, PERSON, POST_A, POST_B, POST_C, PUB_A, PUB_A_NAME, beehiivFake } from './_beehiiv_mcp_fake.mjs';

const BEE = 51;
const COMPANY = 70;
const M = 'cloudflare-worker/sql/migrations';
const mig = (f: string) => readFileSync(`${M}/${f}`, 'utf8');
const MIGRATION = readdirSync(M).find((f) => /^\d{12}_beehiiv_connector\.sql$/.test(f))!;
const TODAY = new Date().toISOString().slice(0, 10);

async function world() {
  const { db, env } = await growDb();
  db.exec('ALTER TABLE users ADD COLUMN display_name TEXT');
  db.exec(mig('435_connector_companies.sql'));
  db.exec(mig('202611041912_growth_channel_details.sql'));
  // D2407 part 3: PUBLISH's own tables, so a synced post can be tied to the send its draft came from.
  db.exec(mig('642_publish_core.sql'));
  db.exec(mig(MIGRATION));
  db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)').run(COMPANY, FOUNDER);
  const fake = beehiivFake();
  await signedIn(db, env, fake, BEE, FOUNDER);
  db.prepare('INSERT INTO beehiiv_publication_links (uid, integration_id, project_id, publication_id, publication_name, linked_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run('bl-1', BEE, PID, PUB_A, PUB_A_NAME, FOUNDER);
  return { db, env, fake };
}

/** A member's Beehiiv row as a sign-in leaves it: the fake's live access token, encrypted, switched on for the company. */
async function signedIn(db: any, env: any, fake: any, id: number, user: number) {
  const uid = `bee-${id}`;
  const enc = await encryptCredentials(env, uid, { access_token: fake.signedIn(), expires_at: null, scopes: [], issuer: BEEHIIV_ISSUER, client_key: 'fake-client', v: 2, resource: BEEHIIV_MCP_URL } as any);
  db.prepare("INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type, credentials_enc) VALUES (?, ?, ?, 'beehiiv', 'active', 'oauth_mcp', ?)").run(id, uid, user, enc);
  db.prepare('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, 1)').run(id, COMPANY);
}

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);

/** One request, with Beehiiv answered by the fake; `support` signs it as a support session. */
async function call(env: any, fake: any, who: number, method: string, path: string, body?: unknown, support = false) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who], ...(support ? { impersonated_by: 3 } : {}) }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
  const real = globalThis.fetch;
  globalThis.fetch = fake.fetch as any;
  try {
    const res = await app.fetch(new Request(`http://t${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env, { waitUntil() {}, passThroughOnException() {} } as any);
    return { status: res.status, body: await res.json() as any };
  } finally { globalThis.fetch = real; }
}

const sync = (env: any, fake: any, who = FOUNDER) => call(env, fake, who, 'POST', '/api/cycles/grow/beehiiv/sync', { project: PID });
const read = (env: any, fake: any, slug: string, who = FOUNDER) => call(env, fake, who, 'GET', `/api/cycles/grow/modules/${slug}?project=${PID}`);
const facts = (db: any) => db.prepare('SELECT id, kind, module, period, count, value FROM beehiiv_grow_facts ORDER BY kind, period').all() as any[];
const posts = (db: any) => db.prepare('SELECT id, post_external_id, recipients, unique_opens, open_rate, unique_clicks, click_rate FROM beehiiv_post_stats ORDER BY post_external_id').all() as any[];
const link = (db: any) => db.prepare('SELECT * FROM beehiiv_publication_links WHERE project_id = ?').get(PID) as any;

test('1. a sync lands one dated snapshot and the sent posts through the ledger, every rate a fraction, the proposal raised once', async () => {
  const { db, env, fake } = await world();
  const out = await sync(env, fake);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.deepEqual(out.body.counts, { facts: 5, missing: 0, posts: 3, kept_deleted: 0, proposals: 1, partial: false });
  assert.deepEqual(facts(db).map((f) => [f.kind, f.module, f.period, f.count, f.value]), [
    ['click_rate_avg', 'distribution', TODAY, null, 0.061],
    ['open_rate_avg', 'distribution', TODAY, null, 0.482],
    ['subscribers_active', 'revenue_and_traction', TODAY, 1284, null],
    ['subscribers_free', 'distribution', TODAY, 1188, null],
    ['subscribers_premium', 'revenue_and_traction', TODAY, 96, null],
  ]);
  assert.deepEqual(posts(db).map((p) => [p.post_external_id, p.recipients, p.open_rate, p.click_rate]), [
    [POST_B, 1198, 0.46, 0.09], [POST_A, 1240, 0.51, 0.07], [POST_C, 200, 0.005, 0],
  ], 'a post with no figures in the list is read on its own');
  assert.equal(fake.args.filter((a: any) => a.tool === 'get_post_stats').length, 1, 'only the post that needed it');
  const ledger = db.prepare("SELECT local_table, COUNT(*) AS n FROM connector_fed_items WHERE integration_id = ? GROUP BY local_table ORDER BY local_table").all(BEE) as any[];
  assert.deepEqual(ledger.map((l) => [l.local_table, l.n]), [['beehiiv_grow_facts', 5], ['beehiiv_post_stats', 3]]);
  assert.equal(link(db).channel_state, 'pending');
  const everything = JSON.stringify([db.prepare('SELECT * FROM beehiiv_grow_facts').all(), db.prepare('SELECT * FROM beehiiv_post_stats').all(), db.prepare('SELECT * FROM connector_fed_items').all()]);
  assert.ok(!everything.includes(PERSON), 'no subscriber\'s address is stored');
  assert.ok(!JSON.stringify((await read(env, fake, 'distribution')).body).includes(PERSON));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM project_metrics WHERE source = 'beehiiv'").get().n, 0, 'never written as a metric');
});

test('2. a re-sync updates the same rows; a new day is a new snapshot, and growth is computed when read', async () => {
  const { db, env, fake } = await world();
  await sync(env, fake);
  const before = facts(db);
  fake.data.stats[PUB_A].data.stats.active_subscriptions = 1300;
  fake.data.posts[PUB_A].data[0].stats.email.recipients = 1250;
  const again = await sync(env, fake);
  assert.deepEqual([again.body.counts.facts, again.body.counts.posts, again.body.counts.proposals], [5, 3, 0], 'updated, and the proposal raised only once');
  const after = facts(db);
  assert.deepEqual(after.map((f) => f.id), before.map((f) => f.id), 'the same rows');
  assert.equal(after.find((f) => f.kind === 'subscribers_active').count, 1300);
  assert.equal(posts(db).find((p) => p.post_external_id === POST_A).recipients, 1250);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM connector_fed_items').get().n, 8, 'no ledger row is duplicated');
  // An earlier day's snapshot: the read computes the change, nothing stores it.
  db.prepare("INSERT INTO beehiiv_grow_facts (integration_id, project_id, publication_id, module, kind, period, count, as_of) VALUES (?, ?, ?, 'revenue_and_traction', 'subscribers_active', '2026-10-01', 1200, '2026-10-01')").run(BEE, PID, PUB_A);
  const r = await read(env, fake, 'revenue-and-traction');
  const active = r.body.parts.from_beehiiv.figures.find((f: any) => f.kind === 'subscribers_active');
  assert.deepEqual([active.count, active.change], [1300, { since: '2026-10-01', delta: 100 }]);
  assert.equal(active.source, `From Beehiiv, as of ${TODAY}`);
});

test('3. a deleted figure or post stays deleted, through a re-sync and through a disconnect and a new sign-in', async () => {
  const { db, env, fake } = await world();
  await sync(env, fake);
  const free = facts(db).find((f) => f.kind === 'subscribers_free');
  const postA = posts(db).find((p) => p.post_external_id === POST_A);
  assert.equal((await call(env, fake, FOUNDER, 'DELETE', `/api/cycles/grow/beehiiv/facts/${free.id}?project=${PID}`)).status, 200);
  assert.equal((await call(env, fake, FOUNDER, 'DELETE', `/api/cycles/grow/beehiiv/posts/${postA.id}?project=${PID}`)).status, 200);
  const again = await sync(env, fake);
  assert.equal(again.body.counts.kept_deleted, 2);
  assert.equal(facts(db).some((f) => f.kind === 'subscribers_free'), false, 'the figure is not re-created');
  assert.equal(posts(db).some((p) => p.post_external_id === POST_A), false, 'the post is not re-created');
  const missing = await call(env, fake, FOUNDER, 'DELETE', `/api/cycles/grow/beehiiv/facts/${free.id}?project=${PID}`);
  assert.deepEqual([missing.status, missing.body.error], [404, 'fact_not_found']);

  // Disconnect and sign in again: a new connection, a new link, the same venture.
  db.prepare('DELETE FROM beehiiv_publication_links WHERE integration_id = ?').run(BEE);
  db.prepare('DELETE FROM integrations WHERE id = ?').run(BEE);
  await signedIn(db, env, fake, BEE + 1, FOUNDER);
  db.prepare('INSERT INTO beehiiv_publication_links (uid, integration_id, project_id, publication_id, publication_name, linked_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run('bl-2', BEE + 1, PID, PUB_A, PUB_A_NAME, FOUNDER);
  const fresh = await sync(env, fake);
  assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
  assert.equal(fresh.body.counts.kept_deleted, 2, 'the new connection finds the earlier deletion');
  assert.equal(facts(db).some((f) => f.kind === 'subscribers_free'), false);
  assert.equal(posts(db).some((p) => p.post_external_id === POST_A), false);
  assert.equal(facts(db).length, 4, 'the other figures were updated, not duplicated');
});

test('4. a dismissed proposal never returns', async () => {
  const { db, env, fake } = await world();
  await sync(env, fake);
  let part = (await read(env, fake, 'distribution')).body.parts.from_beehiiv;
  assert.deepEqual([part.proposal.state, part.proposal.can_decide, part.proposal.sentence], ['pending', true, `Track ${PUB_A_NAME} as a Distribution channel?`]);
  const d = await call(env, fake, FOUNDER, 'POST', '/api/cycles/grow/beehiiv/channel-proposal/dismiss', { project: PID });
  assert.deepEqual([d.status, d.body.state], [200, 'dismissed']);
  for (let i = 0; i < 2; i++) assert.equal((await sync(env, fake)).body.counts.proposals, 0);
  assert.equal(link(db).channel_state, 'dismissed');
  part = (await read(env, fake, 'distribution')).body.parts.from_beehiiv;
  assert.equal(part.proposal, null);
  const channels = db.prepare('SELECT COUNT(*) AS n FROM growth_channels').get().n;
  const late = await call(env, fake, FOUNDER, 'POST', '/api/cycles/grow/beehiiv/channel-proposal/accept', { project: PID, utm_source: 'late-accept' });
  assert.deepEqual([late.status, late.body.error], [409, 'proposal_decided']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM growth_channels').get().n, channels, 'a refused Accept creates no channel');
});

test('5. Accept is needed to link a channel; only the member whose Beehiiv serves the venture decides', async () => {
  const { db, env, fake } = await world();
  const channels = () => db.prepare('SELECT COUNT(*) AS n FROM growth_channels WHERE project_id = ?').get(PID).n;
  const none = await call(env, fake, FOUNDER, 'POST', '/api/cycles/grow/beehiiv/channel-proposal/accept', { project: PID });
  assert.deepEqual([none.status, none.body.error], [404, 'proposal_not_found'], 'nothing to accept before a sync raises it');
  const n = channels();
  await sync(env, fake);
  await sync(env, fake);
  assert.equal(channels(), n, 'a sync never creates or links a channel');
  assert.equal(link(db).growth_channel_id, null);
  const teammate = await call(env, fake, COFOUNDER, 'POST', '/api/cycles/grow/beehiiv/channel-proposal/accept', { project: PID });
  assert.deepEqual([teammate.status, teammate.body.error], [403, 'not_your_beehiiv']);
  const unknown = await call(env, fake, FOUNDER, 'POST', '/api/cycles/grow/beehiiv/channel-proposal/accept', { project: PID, growth_channel_uid: 'ch-none' });
  assert.deepEqual([unknown.status, unknown.body.error], [404, 'unknown_channel']);
  const ok = await call(env, fake, FOUNDER, 'POST', '/api/cycles/grow/beehiiv/channel-proposal/accept', { project: PID, utm_source: 'northwind-letter' });
  assert.deepEqual([ok.status, ok.body.state], [200, 'accepted'], JSON.stringify(ok.body));
  assert.equal(channels(), n + 1, 'Accept created one channel');
  const ch = db.prepare('SELECT id, uid, name, utm_source, kind FROM growth_channels WHERE id = ?').get(link(db).growth_channel_id);
  assert.deepEqual([ch.name, ch.utm_source, ch.kind], [PUB_A_NAME, 'northwind-letter', 'newsletter']);
  assert.equal(link(db).decided_by, FOUNDER);
  const part = (await read(env, fake, 'distribution')).body.parts.from_beehiiv;
  assert.deepEqual(part.proposal, { state: 'accepted', can_decide: false, sentence: null, channel: { uid: ch.uid, name: PUB_A_NAME } });
  const twice = await call(env, fake, FOUNDER, 'POST', '/api/cycles/grow/beehiiv/channel-proposal/accept', { project: PID, growth_channel_uid: 'ch-google' });
  assert.deepEqual([twice.status, twice.body.error], [409, 'proposal_decided']);
  // An existing channel, named by uid, is linked as it is.
  db.prepare("UPDATE beehiiv_publication_links SET channel_state = 'pending', growth_channel_id = NULL WHERE project_id = ?").run(PID);
  await call(env, fake, FOUNDER, 'POST', '/api/cycles/grow/beehiiv/channel-proposal/accept', { project: PID, growth_channel_uid: 'ch-google' });
  assert.equal(db.prepare('SELECT uid FROM growth_channels WHERE id = ?').get(link(db).growth_channel_id).uid, 'ch-google');
  assert.equal(channels(), n + 1, 'no second channel');
});

test('6. both rate shapes normalise to fractions', () => {
  const cases: Array<[unknown, number | null, number | null, number | null]> = [
    [45, null, null, 0.45], [0.45, null, null, 0.45], ['45%', null, null, 0.45], ['0.45', null, null, 0.45], [48.2, null, null, 0.482],
    [100, null, null, 1], [1, null, null, 1], [0, null, null, 0],
    [0.5, 1, 200, 0.005], [0.5, 100, 200, 0.5], [null, 87, 1240, 0.070161], [undefined, null, null, null],
    [150, null, null, null], [-1, null, null, null], ['abc', null, null, null], [Number.NaN, null, null, null], [null, 5, 0, null],
  ];
  for (const [raw, part, whole, want] of cases) assert.equal(normaliseRate(raw, part, whole), want, `${String(raw)} with ${part}/${whole}`);
});

test('7. an unreadable part keeps the module, and a module Beehiiv does not feed carries none', async () => {
  const { db, env, fake } = await world();
  db.exec('DROP TABLE beehiiv_grow_facts');
  for (const slug of ['distribution', 'revenue-and-traction']) {
    const r = await read(env, fake, slug);
    assert.equal(r.status, 200, slug);
    assert.deepEqual(r.body.parts.from_beehiiv, { state: 'unreadable', reason: SENTENCES.unreadable }, slug);
    assert.ok(r.body.records, `${slug} still has its records`);
  }
  const other = await read(env, fake, 'market-expansion');
  assert.equal(other.body.parts?.from_beehiiv, undefined);
});

test('8. the logs carry counts only', async () => {
  const { db, env, fake } = await world();
  await sync(env, fake);
  await call(env, fake, FOUNDER, 'POST', '/api/cycles/grow/beehiiv/channel-proposal/dismiss', { project: PID });
  const id = facts(db)[0].id;
  await call(env, fake, FOUNDER, 'DELETE', `/api/cycles/grow/beehiiv/facts/${id}?project=${PID}`);
  const logs = db.prepare("SELECT action, details FROM activity_logs WHERE action LIKE 'grow_beehiiv_%' ORDER BY id").all() as any[];
  assert.deepEqual(logs.map((l) => l.action), ['grow_beehiiv_synced', 'grow_beehiiv_channel_dismissed', 'grow_beehiiv_fact_deleted']);
  assert.equal(logs[0].details, 'Grow synced from Beehiiv: 5 figures, 3 posts, 0 kept deleted');
  for (const l of logs) assert.doesNotMatch(l.details, /Northwind|Letter|October|hiring|pub_|post_|1284|1188|0\.482|reader-fixture/, `${l.action}: no name, id or figure`);
});

test('9. never 0 for a missing figure: it is null with its reason and is not landed; each state says why', async () => {
  const { db, env, fake } = await world();
  const r0 = (await read(env, fake, 'distribution')).body.parts.from_beehiiv;
  assert.deepEqual([r0.state, r0.reason, r0.can_sync], ['not_recorded', SENTENCES.not_synced, true]);
  delete fake.data.stats[PUB_A].data.stats.active_premium_subscriptions;
  const out = await sync(env, fake);
  assert.deepEqual([out.body.counts.facts, out.body.counts.missing], [4, 1]);
  assert.equal(facts(db).some((f) => f.kind === 'subscribers_premium'), false, 'a missing figure is not landed');
  const rev = (await read(env, fake, 'revenue-and-traction')).body.parts.from_beehiiv;
  assert.deepEqual(rev.figures.map((f: any) => f.kind), ['subscribers_active', 'subscribers_premium'], 'Revenue and traction shows subscribers only, never money');
  const premium = rev.figures.find((f: any) => f.kind === 'subscribers_premium');
  assert.deepEqual([premium.count, premium.value, premium.reason], [null, null, 'Not recorded: Beehiiv has given no premium subscribers yet']);
  assert.equal(rev.note, SENTENCES.not_revenue);
  assert.equal(rev.posts, undefined);
  const dist = (await read(env, fake, 'distribution')).body.parts.from_beehiiv;
  const tiny = dist.posts.find((p: any) => p.post_external_id === POST_C);
  assert.deepEqual([tiny.unique_clicks, tiny.click_rate, tiny.click_reason], [0, 0, null], 'a measured zero stays zero');
  db.prepare('UPDATE beehiiv_post_stats SET click_rate = NULL, recipients = NULL WHERE post_external_id = ?').run(POST_C);
  const unmeasured = (await read(env, fake, 'distribution')).body.parts.from_beehiiv.posts.find((p: any) => p.post_external_id === POST_C);
  assert.deepEqual([unmeasured.click_rate, unmeasured.click_reason, unmeasured.recipients, unmeasured.recipients_reason],
    [null, 'Not recorded: Beehiiv gave no figure for this post', null, 'Not recorded: Beehiiv gave no recipients for this post']);
  db.exec('DELETE FROM beehiiv_publication_links; DELETE FROM beehiiv_grow_facts; DELETE FROM beehiiv_post_stats;');
  const unlinked = (await read(env, fake, 'distribution')).body.parts.from_beehiiv;
  assert.deepEqual([unlinked.state, unlinked.reason, unlinked.connect_href, unlinked.can_sync], ['not_linked', SENTENCES.not_linked, '/account/connectors/beehiiv', false]);
  assert.doesNotMatch(JSON.stringify(unlinked), /"count":0|"value":0/);
});

test('10. the feeds list, the connector page and the registry agree', () => {
  const built = BEEHIIV_FEEDS.filter((f) => f.built);
  const meta = CONNECTOR_METADATA.beehiiv;
  assert.deepEqual(meta.pulls, built.map((f) => ({ what: f.what, module: f.module })));
  assert.deepEqual(meta.feeds, [...new Set(built.map((f) => f.module))]);
  assert.deepEqual([...meta.feeds].sort(), ['distribution', 'revenue_and_traction']);
  for (const f of BEEHIIV_FEEDS.filter((x) => !x.built)) assert.ok(!meta.pulls.some((p) => p.what === f.what), `${f.key} waits, so the registry does not claim it`);
  for (const f of BEEHIIV_FEEDS) {
    assert.ok(Object.hasOwn(MODULE_LABELS, f.module), `${f.key}: ${f.module} has a label`);
    for (const t of f.tools) assert.ok(BEEHIIV_READ_TOOLS.includes(t), `${f.key}: ${t} is a read tool`);
  }
  const page = CONNECTOR_PAGES.beehiiv as any;
  const lands = new Set(page.tools.map((t: any) => t.lands_in).filter(Boolean));
  assert.deepEqual([...lands].sort(), [...meta.feeds].sort(), 'the page lands exactly where the registry feeds');
  const used = new Set([...BEEHIIV_FEEDS.flatMap((f) => f.tools)]);
  for (const t of BEEHIIV_READ_TOOLS) assert.ok(used.has(t), `${t} feeds something`);
  assert.equal(MODULE_LABELS.grow_updates, 'Grow · Updates');
});

test('11. who: a support session is refused; a teammate deletes but does not sync; a reader sees the figures; a company switched off refuses', async () => {
  const { db, env, fake } = await world();
  const n = fake.calls.length;
  for (const [method, path, body] of [
    ['POST', '/api/cycles/grow/beehiiv/sync', { project: PID }],
    ['POST', '/api/cycles/grow/beehiiv/channel-proposal/accept', { project: PID }],
    ['POST', '/api/cycles/grow/beehiiv/channel-proposal/dismiss', { project: PID }],
    ['DELETE', `/api/cycles/grow/beehiiv/facts/1?project=${PID}`, undefined],
  ] as const) {
    const r = await call(env, fake, FOUNDER, method, path, body, true);
    assert.deepEqual([r.status, r.body.error], [403, 'support_session_refused'], path);
  }
  assert.equal(fake.calls.length, n, 'nothing reached Beehiiv');
  const teammate = await sync(env, fake, COFOUNDER);
  assert.deepEqual([teammate.status, teammate.body.error], [403, 'not_your_beehiiv']);
  await sync(env, fake);
  const theirs = (await read(env, fake, 'distribution', COFOUNDER)).body.parts.from_beehiiv;
  assert.deepEqual([theirs.state, theirs.can_sync, theirs.can_delete, theirs.proposal.can_decide], ['ok', false, true, false]);
  const id = facts(db)[0].id;
  assert.equal((await call(env, fake, COFOUNDER, 'DELETE', `/api/cycles/grow/beehiiv/facts/${id}?project=${PID}`)).status, 200, 'a writer on the venture deletes');
  const reader = await read(env, fake, 'distribution', ADVISOR);
  assert.equal(reader.status, 200);
  assert.equal(reader.body.parts.from_beehiiv.state, 'ok', 'decision D1: anyone who may read the module reads the figures');
  assert.equal(reader.body.parts.from_beehiiv.can_delete, false, 'an advisor reads only');
  const advisorDelete = await call(env, fake, ADVISOR, 'DELETE', `/api/cycles/grow/beehiiv/facts/${facts(db)[0].id}?project=${PID}`);
  assert.equal(advisorDelete.status, 403);
  db.prepare('UPDATE integration_companies SET enabled = 0 WHERE integration_id = ?').run(BEE);
  const off = await sync(env, fake);
  assert.deepEqual([off.status, off.body.error], [409, 'company_not_enabled']);
  db.prepare("UPDATE integrations SET status = 'error' WHERE id = ?").run(BEE);
  const broken = await sync(env, fake);
  assert.deepEqual([broken.status, broken.body.error], [409, 'beehiiv_not_connected']);
  fake.state.status = null;
});

test('12. an update never drafted to Beehiiv carries newsletter: null with its reason, never 0', async () => {
  const { db, env, fake } = await world();
  db.prepare("INSERT INTO portfolio_updates (uid, project_id, author_user_id, title, status, sent_at) VALUES ('up-1', ?, ?, '[October update]', 'submitted', '2026-10-20 10:00:00')").run(PID, FOUNDER);
  const r = await read(env, fake, 'durable-company-building');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = r.body.parts.updates.find((u: any) => u.uid === 'up-1');
  assert.ok(row, 'the sent update is listed');
  assert.ok(Object.hasOwn(row, 'newsletter') && row.newsletter === null);
  assert.equal(r.body.parts.newsletter_reason, NEWSLETTER_NOT_LINKED);
});

/** A sent update drafted to Beehiiv through PUBLISH: its draft names the update, its send names the post the draft became. */
function draftedUpdate(db: any, update: string, post: string, status = 'sent') {
  const u = db.prepare("INSERT INTO portfolio_updates (uid, project_id, author_user_id, title, status, sent_at) VALUES (?, ?, ?, '[October update]', 'submitted', '2026-10-20 10:00:00') RETURNING id").get(update, PID, FOUNDER);
  const d = db.prepare("INSERT INTO publish_drafts (uid, project_id, module, source_refs_json, author_user_id, body_json) VALUES (?, ?, 'updates', ?, ?, '{}') RETURNING id")
    .get(`d-${update}`, PID, JSON.stringify([{ ref: `portfolio_updates:${update}`, store: 'portfolio_updates' }, { ref: `portfolio_updates:${update}#arr`, store: 'portfolio_updates' }]), FOUNDER);
  db.prepare(`INSERT INTO publish_sends (uid, draft_id, project_id, module, provider_key, destination_label, idempotency_key, envelope_json, envelope_hash, confirmed_by, status, external_post_id)
    VALUES (?, ?, ?, 'updates', 'beehiiv', ?, ?, '{}', 'h', ?, ?, ?)`).run(`s-${update}`, d.id, PID, PUB_A_NAME, `key-${update}`, FOUNDER, status, post);
  return u.id;
}

test('13. D2407 part 3: a sent update drafted to Beehiiv shows its post\'s figures once synced; another venture\'s send never ties', async () => {
  const { db, env, fake } = await world();
  draftedUpdate(db, 'up-drafted', POST_A);
  // Another venture's send naming the same post id is never tied to this venture's post.
  db.prepare("INSERT INTO projects (id, uid, name) VALUES (999, 'p-other', 'Other')").run();
  const od = db.prepare("INSERT INTO publish_drafts (uid, project_id, module, source_refs_json, author_user_id, body_json) VALUES ('d-other', 999, 'updates', '[]', ?, '{}') RETURNING id").get(FOUNDER);
  db.prepare(`INSERT INTO publish_sends (uid, draft_id, project_id, module, provider_key, destination_label, idempotency_key, envelope_json, envelope_hash, confirmed_by, status, external_post_id)
    VALUES ('s-other', ?, 999, 'updates', 'beehiiv', 'x', 'key-other', '{}', 'h', ?, 'sent', ?)`).run(od.id, FOUNDER, POST_A);

  // Before a sync: nothing is tied, so the row says why.
  let r = await read(env, fake, 'durable-company-building');
  assert.equal(r.body.parts.updates.find((u: any) => u.uid === 'up-drafted').newsletter, null);
  assert.equal(r.body.parts.newsletter_reason, NEWSLETTER_NOT_LINKED);

  assert.equal((await sync(env, fake)).status, 200);
  const tied = db.prepare('SELECT b.publish_send_id, s.uid FROM beehiiv_post_stats b JOIN publish_sends s ON s.id = b.publish_send_id WHERE b.post_external_id = ?').get(POST_A);
  assert.equal(tied?.uid, 's-up-drafted', 'the post is tied to this venture\'s send, not the other venture\'s');
  r = await read(env, fake, 'durable-company-building');
  const row = r.body.parts.updates.find((u: any) => u.uid === 'up-drafted');
  assert.deepEqual(row.newsletter, { recipients: 1240, open_rate: 0.51, click_rate: 0.07, as_of: TODAY });

  // A post with no figures stays null field by field, never 0.
  draftedUpdate(db, 'up-bare', POST_C);
  db.prepare('UPDATE beehiiv_post_stats SET recipients = NULL, click_rate = NULL WHERE post_external_id = ?').run(POST_C);
  db.prepare('UPDATE beehiiv_post_stats SET publish_send_id = (SELECT id FROM publish_sends WHERE uid = ?) WHERE post_external_id = ?').run('s-up-bare', POST_C);
  r = await read(env, fake, 'durable-company-building');
  const bare = r.body.parts.updates.find((u: any) => u.uid === 'up-bare').newsletter;
  assert.equal(bare.recipients, null);
  assert.equal(bare.click_rate, null);

  // A deleted post's figures leave the row; a re-sync never brings them back.
  const postRow = db.prepare('SELECT id FROM beehiiv_post_stats WHERE post_external_id = ?').get(POST_A);
  assert.equal((await call(env, fake, FOUNDER, 'DELETE', `/api/cycles/grow/beehiiv/posts/${postRow.id}?project=${PID}`)).status, 200);
  await sync(env, fake);
  r = await read(env, fake, 'durable-company-building');
  assert.equal(r.body.parts.updates.find((u: any) => u.uid === 'up-drafted').newsletter, null);

  // An unreadable store is Unreadable, never "not recorded".
  db.exec('DROP TABLE publish_drafts');
  r = await read(env, fake, 'durable-company-building');
  assert.equal(r.body.parts.newsletter_reason, NEWSLETTER_UNREADABLE);
});
