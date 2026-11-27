/**
 * D882 (#2555) — Grow and Raise read the founder's own Mercury through its
 * MCP sign-in, and the connector declares exactly what the code feeds.
 * Against part 1's fake MCP server; real SQL on node:sqlite; nothing reaches
 * the network. Every id, name and amount is invented.
 *
 *  1. One declaration: the Raise and Grow entries of `MERCURY_FEEDS` name
 *     the modules the syncs land in, and the tools they call.
 *  2. Every founder use works on a signed-in (MCP) connection: Grow's five
 *     modules, Raise's seven, and D713's and D752's revenue import, spend
 *     and raise receipts.
 *  3. A pasted token, no connection, or a rejected sign-in: Grow and Raise
 *     say "Connect Mercury" with the Connectors page, never an empty figure,
 *     and only the founder gets the link.
 *  4. No member path reads an Axal entity's Mercury (D710's tables).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_grow_raise_mcp_d882.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MERCURY_FEEDS, GROW_FEED_KINDS } from '../src/integrations/mercuryFeeds.ts';
import { RAISE_PART_FOR } from '../src/services/mercury/raiseFeeds.ts';
import { GROW_FEED_SLUGS, growFromMercury, FOUNDER_MERCURY_SENTENCES } from '../src/services/mercury/growFeeds.ts';
import { CONNECT_MERCURY_HREF, MEMBER_MERCURY_SENTENCES, memberMercury } from '../src/services/mercury/memberConnection.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { CONNECTOR_METADATA, connectorFeeds } from '../src/integrations/registry.ts';
import { signedInFake, FAKE_ACC_A, fakeTx } from './_mercury_mcp_fake.mjs';
import { fixture, call as raiseCall, sync, mod, accept, withFake } from './_mercury_raise_fixture.ts';
import {
  TODAY, PID, INTEGRATION, FOUNDER, COFOUNDER, viewers, growDb, growFake, call as growCall, signedInRow,
} from './_mercury_grow_fixture.ts';
import { personalFixture, req } from './_mercury_personal_d713.ts';

/** D710's entity store: HQ fund administration only. A member path never names one of these tables. */
const ENTITY_TABLES = /\b(mercury_entity_connections|mercury_accounts|mercury_transactions|mercury_balance_snapshots|mercury_matches|mercury_sync_runs|mercury_not_ours)\b/;

/** Every SQL string the database is asked to prepare, so a test can say none named an entity table. */
function recordSql(env: any): string[] {
  const seen: string[] = [];
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql: string) => { seen.push(sql); return prepare(sql); };
  return seen;
}
/** D840's Grow (part 3) or Raise (part 2) entries; D752's `raise_receipts` matches a wire and lands in no module. */
const feedsOf = (prefix: string) => MERCURY_FEEDS.filter((f) => f.role === 'founder' && f.decision === 'D840' && f.key.startsWith(prefix));
const modulesOf = (prefix: string) => [...new Set(feedsOf(prefix).map((f) => f.module as string))].sort();
const toolsOf = (prefix: string) => [...new Set(feedsOf(prefix).flatMap((f) => [...f.tools]))].sort();
const slugToModule = (s: string) => s.replace(/-/g, '_');

// ───────────────────────────────────────────── 1. one declaration

test('1. Raise: the modules a full sync and every Accept land in, and the tools it calls, are the raise_ feeds\' own', async () => {
  // Mutations checked: a raise_ feed's module renamed; a tool dropped from a raise_ feed; a module dropped from RAISE_PART_FOR.
  const f = await fixture();
  const seen = recordSql(f.env);
  await withFake(f, async () => {
    assert.equal((await sync(f.env)).status, 200);
    // A SAFE lands only on a cap table with a founder on it (D840 part 2).
    assert.equal((await raiseCall(f.env, '/api/cycles/raise/holders?project=101', 1, 'POST', { name: 'One', group: 'founders', instrument: 'common', shares: 1000000 })).status, 201);
    for (const p of f.all("SELECT id, kind, source_key FROM mercury_raise_proposals WHERE status = 'pending' ORDER BY id")) {
      const r = await accept(f.env, p.id, p.kind === 'fund_mapping' ? { section: 'product' } : undefined);
      // The fixture's August statement has no link, so it has no bytes to store (D840 part 2).
      assert.equal(r.status, p.source_key === 'stmt-2026-08' ? 404 : 200, `${p.kind} ${p.source_key}: ${r.text}`);
    }
  });
  const landed = [...new Set(f.all('SELECT DISTINCT module FROM connector_fed_items WHERE integration_id = 41').map((r: any) => r.module))].sort();
  assert.deepEqual(landed, modulesOf('raise_'));
  assert.deepEqual(Object.keys(RAISE_PART_FOR).map(slugToModule).sort(), modulesOf('raise_'));
  assert.deepEqual([...new Set(f.fake.toolCalls())].sort(), toolsOf('raise_'));
  assert.ok(!seen.some((s) => ENTITY_TABLES.test(s)), 'no entity table was read');
});

test('1b. Grow: its five slugs are the grow_ feeds\' modules, and one sync calls exactly their tools', async (t) => {
  // Mutations checked: a grow_ feed's tool list widened; a Grow slug dropped; GROW_FEED_KINDS losing a module.
  assert.deepEqual(GROW_FEED_SLUGS.map(slugToModule).sort(), modulesOf('grow_'));
  assert.deepEqual(Object.keys(GROW_FEED_KINDS).sort(), modulesOf('grow_'));
  const { db, env } = await growDb();
  const seen = recordSql(env);
  const s = growFake();
  await signedInRow(db, env, s);
  const off = s.fake.install();
  t.after(off);
  const r = await growCall(env, FOUNDER, 'POST', '/api/cycles/grow/mercury/sync', { project: PID });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const tools = [...new Set(s.fake.calls.filter((c: any) => c.tool).map((c: any) => c.tool))].sort();
  assert.deepEqual(tools, toolsOf('grow_'));
  assert.ok(!seen.some((q) => ENTITY_TABLES.test(q)), 'no entity table was read');
});

test('1c. the founder\'s connector page declares exactly the modules the Grow and Raise syncs land in, and Revenue and traction for D713\'s import', async (t) => {
  // Mutations checked: a module added to PERSONAL_MERCURY.founder.feeds that nothing lands in; a Grow landing moved to an undeclared module.
  const raise = await fixture();
  await withFake(raise, async () => {
    assert.equal((await sync(raise.env)).status, 200);
    assert.equal((await raiseCall(raise.env, '/api/cycles/raise/holders?project=101', 1, 'POST', { name: 'One', group: 'founders', instrument: 'common', shares: 1000000 })).status, 201);
    for (const p of raise.all("SELECT id, kind, source_key FROM mercury_raise_proposals WHERE status = 'pending' ORDER BY id")) {
      await accept(raise.env, p.id, p.kind === 'fund_mapping' ? { section: 'product' } : undefined);
    }
  });
  const { db, env } = await growDb();
  const s = growFake();
  await signedInRow(db, env, s);
  const off = s.fake.install();
  t.after(off);
  assert.equal((await growCall(env, FOUNDER, 'POST', '/api/cycles/grow/mercury/sync', { project: PID })).status, 200);
  // Partner network lands on the founder's Accept.
  for (const { id } of db.prepare("SELECT id FROM mercury_partner_proposals WHERE state = 'pending'").all() as any[]) {
    assert.equal((await growCall(env, FOUNDER, 'POST', `/api/cycles/grow/mercury/partner-proposals/${id}/accept`, { project: PID })).status, 200);
  }
  const landed = new Set<string>([
    ...raise.all('SELECT DISTINCT module FROM connector_fed_items').map((r: any) => r.module),
    ...(db.prepare('SELECT DISTINCT module FROM connector_fed_items').all() as any[]).map((r) => r.module),
    // D713's revenue import lands each picked credit in Revenue and traction (`revenue_mercury_import_d713.test.ts`).
    ...MERCURY_FEEDS.filter((f) => f.role === 'founder' && f.key === 'venture_revenue').map((f) => f.module as string),
  ]);
  assert.deepEqual([...connectorFeeds('mercury', 'founder')].sort(), [...landed].sort());
  // D879 (C1, #2552): the catalogue row declares the same Grow and Raise modules.
  assert.deepEqual([...CONNECTOR_METADATA.mercury.feeds].sort(), [...landed].sort());
});

// ───────────────────────────────────────────── 2. every feed on a sign-in

test('2. Grow: every module reads its figures from the signed-in sync, with where they came from', async (t) => {
  // Mutations checked: a module's part left not_recorded after a sync; the connection read from the viewer instead of the founder.
  const { db, env } = await growDb();
  const s = growFake();
  await signedInRow(db, env, s);
  const off = s.fake.install();
  t.after(off);
  assert.equal((await growCall(env, FOUNDER, 'POST', '/api/cycles/grow/mercury/sync', { project: PID })).status, 200);
  for (const slug of GROW_FEED_SLUGS) {
    const part: any = await growFromMercury(env, PID, slug, viewers.founder, TODAY);
    assert.equal(part.state, 'ok', slug);
    assert.equal(part.connection.state, 'connected', slug);
    assert.equal(part.connection.connect_href, null, slug);
    assert.equal(part.can_sync, true, slug);
    if (slug !== 'partner-network') assert.match(String(part.source), /^From Mercury, as of /, slug);
    const mate: any = await growFromMercury(env, PID, slug, viewers.cofounder, TODAY);
    assert.equal(mate.state, 'ok', `${slug} for the cofounder`);
    assert.equal(mate.can_sync, false, `${slug}: only the founder syncs`);
  }
});

test('2b. Raise: every module carries its Mercury part from the signed-in sync', async () => {
  // Mutations checked: the part dropped for a connected founder; a connected founder told to connect.
  const f = await fixture();
  await withFake(f, async () => { assert.equal((await sync(f.env)).status, 200); });
  for (const slug of Object.keys(RAISE_PART_FOR)) {
    const part = (await mod(f.env, slug)).parts?.mercury;
    assert.ok(part, slug);
    assert.equal(part.integration_uid, 'mc-one', slug);
    assert.equal(part.connection.state, 'connected', slug);
    assert.equal(part.connection.connect_href, null, slug);
    assert.ok(!['not_connected', 'sign_in_required', 'reconnect', 'unreadable'].includes(part.state), `${slug}: ${part.state}`);
  }
});

test('2c. D713 and D752 on a sign-in: the revenue import, spend and runway, and raise receipts read through MCP only', async (t) => {
  // Mutations checked: bankReaderFor reading a sign-in row as a token; a use refusing an oauth_mcp row.
  const { db, env } = await personalFixture();
  const seen = recordSql(env);
  const { fake, accessToken } = signedInFake();
  const posted = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  fake.state.data.transactions = [
    { id: fakeTx(1), accountId: FAKE_ACC_A, amount: 1200, kind: 'externalTransfer', status: 'sent', counterpartyName: 'Customer Co', createdAt: posted(20), postedAt: posted(20) },
    { id: fakeTx(2), accountId: FAKE_ACC_A, amount: -400, kind: 'debitCardTransaction', status: 'sent', counterpartyName: 'Cloud Host', createdAt: posted(40), postedAt: posted(40) },
  ];
  const creds = await encryptCredentials(env, 'mp-mcp-10', { access_token: accessToken, token_type: 'Bearer', expires_at: null, scopes: ['read', 'offline_access'], issuer: 'https://mcp.mercury.com', client_key: 'fixture-client' } as any);
  db.prepare(`INSERT INTO integrations (uid, user_id, provider_key, display_name, status, auth_type, credentials_enc, config_json, external_account_id, external_account_name)
    VALUES ('mp-mcp-10', 10, 'mercury', 'Mercury', 'active', 'oauth_mcp', ?, '{"read_only":"confirmed"}', 'org-mcp-own', 'Own Venture Inc')`).run(creds);
  const off = fake.install();
  t.after(off);
  const other: string[] = [];
  const pass = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.hostname !== 'mcp.mercury.com') other.push(u.hostname);
    return pass(input, init);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = pass; });
  for (const [use, path] of [
    ['venture_revenue', '/api/revenue/projects/1/mercury-credits'],
    ['venture_spend', '/api/revenue/projects/1/mercury-spend'],
    ['raise_receipts', '/api/mercury/personal/matches?target=raise'],
  ] as const) {
    const before = fake.toolCalls().length;
    const r = await req(env, 10, 'GET', path);
    assert.equal(r.status, 200, `${use}: ${r.text}`);
    assert.ok(fake.toolCalls().length > before, `${use} read through Mercury's MCP tools`);
    assert.ok(MERCURY_FEEDS.some((f) => f.key === use && f.role === 'founder'), `${use} is declared`);
  }
  assert.deepEqual(other, [], 'no request left for any host but Mercury\'s MCP server');
  assert.ok(!seen.some((q) => ENTITY_TABLES.test(q) && !/^\s*SELECT 1 AS held FROM mercury_accounts/.test(q)), 'no entity table was read');
});

// ───────────────────────────────────────────── 3. the connection states

test('3. Grow: no connection, a pasted token and a rejected sign-in say Connect Mercury to the founder; a teammate gets the sentence', async () => {
  // Mutations checked: the link given to a teammate; a token row read as connected; an errored row read as not connected; a figure in a connect part.
  const { db, env } = await growDb();
  const states: Array<[string, () => void]> = [
    ['sign_in_required', () => db.prepare("UPDATE integrations SET auth_type = 'api_key' WHERE id = ?").run(INTEGRATION)],
    ['reconnect', () => db.prepare("UPDATE integrations SET auth_type = 'oauth_mcp', status = 'error' WHERE id = ?").run(INTEGRATION)],
    ['not_connected', () => db.prepare('DELETE FROM integrations WHERE id = ?').run(INTEGRATION)],
  ];
  for (const [state, set] of states) {
    set();
    for (const slug of GROW_FEED_SLUGS) {
      const own: any = await growFromMercury(env, PID, slug, viewers.founder, TODAY);
      assert.deepEqual(Object.keys(own).sort(), ['can_sync', 'connection', 'reason', 'state'], `${state}/${slug}: no figure`);
      assert.equal(own.state, state, slug);
      assert.equal(own.can_sync, false);
      assert.equal(own.connection.connect_href, CONNECT_MERCURY_HREF);
      assert.equal(own.connection.connect_label, 'Connect Mercury');
      assert.equal(own.reason, (MEMBER_MERCURY_SENTENCES as any)[state]);
      const mate: any = await growFromMercury(env, PID, slug, viewers.cofounder, TODAY);
      assert.equal(mate.state, state);
      assert.equal(mate.connection.connect_href, null, 'the founder\'s bank account is not the teammate\'s to connect');
      assert.equal(mate.reason, (FOUNDER_MERCURY_SENTENCES as any)[state]);
    }
  }
  // Someone outside the company still reads only that the figures are the team's.
  const outside: any = await growFromMercury(env, PID, 'durable-company-building', viewers.advisor, TODAY);
  assert.equal(outside.state, 'team_only');
  assert.equal(outside.connection, undefined);
});

test('3b. Grow: a pasted token is told to sign in, at the sync and on the page; figures already landed stay with the link beside them', async (t) => {
  // Mutations checked: a token row offered Sync; the landed figures hidden once the connection is a token.
  const { db, env } = await growDb();
  const s = growFake();
  await signedInRow(db, env, s);
  const off = s.fake.install();
  t.after(off);
  assert.equal((await growCall(env, FOUNDER, 'POST', '/api/cycles/grow/mercury/sync', { project: PID })).status, 200);
  db.prepare("UPDATE integrations SET auth_type = 'api_key' WHERE id = ?").run(INTEGRATION);
  const refused = await growCall(env, FOUNDER, 'POST', '/api/cycles/grow/mercury/sync', { project: PID });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'mercury_sign_in_required');
  const part: any = await growFromMercury(env, PID, 'durable-company-building', viewers.founder, TODAY);
  assert.equal(part.state, 'ok', 'what landed is still shown');
  assert.equal(part.can_sync, false);
  assert.equal(part.connection.state, 'sign_in_required');
  assert.equal(part.connection.connect_href, CONNECT_MERCURY_HREF);
});

test('3c. Raise: no connection, a pasted token and a rejected sign-in, for the founder only', async () => {
  // Mutations checked: no part when unconnected; the part shown to another founder; a token row read as connected.
  const f = await fixture();
  f.db.prepare("UPDATE integrations SET auth_type = 'api_key' WHERE id = 41").run();
  const token = (await mod(f.env, 'fundraising-readiness')).parts?.mercury;
  assert.equal(token.connection.state, 'sign_in_required');
  assert.equal(token.connection.connect_href, CONNECT_MERCURY_HREF);
  const refused = await sync(f.env);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'mercury_sign_in_required');
  f.db.prepare("UPDATE integrations SET auth_type = 'oauth_mcp', status = 'error' WHERE id = 41").run();
  const rejected = (await mod(f.env, 'use-of-funds')).parts?.mercury;
  assert.deepEqual([rejected.state, rejected.connection.connect_href], ['reconnect', CONNECT_MERCURY_HREF]);
  assert.deepEqual(Object.keys(rejected).sort(), ['connection', 'reason', 'state']);
  f.db.prepare('DELETE FROM integrations WHERE id = 41').run();
  const none = (await mod(f.env, 'data-room')).parts?.mercury;
  assert.equal(none.state, 'not_connected');
  assert.equal(none.reason, MEMBER_MERCURY_SENTENCES.not_connected);
  // Another founder reading this venture gets no part at all.
  assert.equal((await mod(f.env, 'data-room', 2)).parts?.mercury, undefined);
});

test('3d. memberMercury: the member\'s own row only, and never a credential', async () => {
  // Mutations checked: another member's row counted; a revoked row read as connected.
  const { db, env } = await growDb();
  const seen = recordSql(env);
  assert.equal((await memberMercury(env, FOUNDER)).state, 'connected');
  db.prepare("UPDATE integrations SET status = 'revoked' WHERE id = ?").run(INTEGRATION);
  assert.equal((await memberMercury(env, FOUNDER)).state, 'not_connected');
  db.prepare("INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type) VALUES (91, 'theirs', ?, 'mercury', 'active', 'oauth_mcp')").run(COFOUNDER + 100);
  assert.equal((await memberMercury(env, COFOUNDER)).state, 'not_connected');
  assert.equal((await memberMercury(env, null)).state, 'not_connected');
  assert.ok(seen.every((q) => !/credentials_enc/.test(q)), 'no credential is read');
});

// ───────────────────────────────────────────── 4. no entity read on a member path

const SRC = 'cloudflare-worker/src';
const MEMBER_FEED_FILES = ['services/mercury/growFeeds.ts', 'services/mercury/growPresence.ts', 'services/mercury/raiseFeeds.ts', 'services/mercury/raiseAccess.ts',
  'services/mercury/memberConnection.ts', 'services/mercury/connection.ts', 'services/mercury/reads.ts', 'services/mercurySpend.ts', 'services/mercuryPersonal.ts',
  'routes/cycle_grow.ts', 'routes/cycle_raise.ts', 'routes/mercury_personal.ts', 'integrations/mercuryFeeds.ts'];

test('4. the Grow and Raise feed code names no entity table and imports no entity store', () => {
  // Mutations checked: growFeeds reading mercury_accounts; raiseFeeds importing ./store or ./sync.
  const code = (f: string) => readFileSync(join(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const f of MEMBER_FEED_FILES) {
    const s = code(f);
    // D713's decision 3 (refusing to connect an Axal organization) lives in providers/mercury.ts, outside these files.
    assert.doesNotMatch(s, ENTITY_TABLES, f);
    assert.doesNotMatch(s, /from\s+['"][^'"]*mercury\/(store|sync|match|notOurs|access)['"]/, f);
    assert.doesNotMatch(s, /from\s+['"]\.\/(store|sync|match|notOurs|access)['"]/, f);
  }
  // Every file named exists, so the list cannot silently go stale.
  for (const f of MEMBER_FEED_FILES) assert.ok(statSync(join(SRC, f)).isFile(), f);
  // And every service under services/mercury/ that a member route reaches is on the list.
  const memberish = readdirSync(join(SRC, 'services/mercury')).filter((n) => /^(grow|raise|member)/.test(n)).map((n) => relative(SRC, join(SRC, 'services/mercury', n)));
  for (const f of memberish) assert.ok(MEMBER_FEED_FILES.includes(f), `${f} is checked`);
});
