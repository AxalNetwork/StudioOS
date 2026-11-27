/** Real signed HTTP requests, real migration SQL, no providers or production. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac } from 'node:crypto';
import { Hono } from 'hono';
import mailLink from '../src/routes/mail_link.ts';
import newsletter from '../src/routes/newsletter.ts';
import testingMail from '../src/routes/testing_mail.ts';
import { mailLinkSignature } from '../src/middleware/mailLink.ts';
import { readPreferencesToken } from '../src/services/newsletter.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const baseline = read('cloudflare-worker/sql/schema_baseline.sql');
// Random per run: synthetic credentials never committed as secret-looking literals.
const secret = crypto.randomUUID();
const newsletterKey = crypto.randomUUID();
const prefix = '/api/mail-link';
function harness() {
  const db = new DatabaseSync(':memory:');
  for (const name of ['users', 'user_profile_ext', 'events', 'event_registrations', 'insight_subscriptions', 'activity_logs', 'rate_limit_logs']) {
    db.exec(stripForeignKeys(tableFromBaseline(baseline, name)));
  }
  db.exec(read('cloudflare-worker/sql/migrations/515_newsletter_lists.sql'));
  db.exec(stripForeignKeys(read('cloudflare-worker/sql/migrations/516_product_testing.sql')));
  db.exec(read('cloudflare-worker/sql/migrations/517_mail_link.sql'));
  const kv = new Map<string, string>();
  const puts: { key: string; ttl: number }[] = [];
  const env: any = { ENVIRONMENT: 'production', MAIL_LINK_SECRET: secret, NEWSLETTER_TOKEN_KEY: newsletterKey,
    DB: d1Over(db), APP_URL: 'https://example.test', RATE_LIMITS: {
      get: async (key: string) => kv.get(key) || null,
      put: async (key: string, value: string, opts: any) => { kv.set(key, value); puts.push({ key, ttl: opts.expirationTtl }); },
    } };
  const app = new Hono<any>();
  app.route(prefix, mailLink);
  app.route('/api', newsletter);
  app.route('/api/testing/mail', testingMail);
  let tick = 0;
  const startTimestamp = Math.floor(Date.now() / 1000);
  const context = { waitUntil: (_p: Promise<unknown>) => {}, passThroughOnException() {} };
  const raw = (path: string, init: RequestInit = {}) => app.request(`https://example.test${path}`, init, env, context as any);
  async function signed(path: string, method = 'GET', input?: unknown, overrides: { timestamp?: string; signature?: string; signedPath?: string; signedMethod?: string; signedBody?: string } = {}) {
    const body = input === undefined ? '' : JSON.stringify(input);
    const timestamp = overrides.timestamp ?? String(startTimestamp - tick++);
    const signature = overrides.signature ?? await mailLinkSignature(secret, overrides.signedMethod || method, overrides.signedPath || path, timestamp, overrides.signedBody ?? body);
    return raw(path, { method, headers: { 'X-Axal-Link-Timestamp': timestamp, 'X-Axal-Link-Signature': signature, 'Content-Type': 'application/json' }, ...(body ? { body } : {}) });
  }
  function subscriber(id: number, opts: { status?: string; topic?: string; enabled?: number; user?: number; consent?: boolean } = {}) {
    db.prepare(`INSERT INTO newsletter_subscribers (id, uid, email, user_id, status, source, consented_at)
      VALUES (?, ?, ?, ?, ?, 'website', ?)`).run(id, id.toString(16).padStart(32, '0'), `person${id}@example.test`, opts.user || null, opts.status || 'confirmed', opts.consent === false ? null : '2026-10-20');
    db.prepare('INSERT INTO newsletter_subscriber_topics (subscriber_id, topic, enabled) VALUES (?, ?, ?)').run(id, opts.topic || 'brief', opts.enabled ?? 1);
  }
  const events = (input: unknown) => signed(`${prefix}/events`, 'POST', input);
  const event = (type = 'unsubscribe', audience?: string, message_id = 'message-1') => ({ type, email: 'PERSON1@EXAMPLE.TEST', at: '2026-10-20T12:00:00Z', ...(audience ? { audience } : {}), message_id });
  return { db, app, env, kv, puts, raw, signed, subscriber, events, event };
}
const recipients = `${prefix}/audiences/topic:brief/recipients`;

test('D811 signature: good, bad, old, future, missing; path/query/method/body are bound', async t => {
  const clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  const h = harness();
  assert.deepEqual(await (await h.signed(`${prefix}/health`)).json(), { ok: true, version: '1' });
  const timestamp = String(Math.floor(Date.now() / 1000) - 40);
  const vector = createHmac('sha256', secret).update(`GET\n${prefix}/health\n${timestamp}\n${createHash('sha256').update('').digest('hex')}`).digest('hex');
  assert.equal((await h.signed(`${prefix}/health`, 'GET', undefined, { timestamp, signature: vector })).status, 200);
  for (const overrides of [
    { signature: '0'.repeat(64) },
    { timestamp: String(Math.floor(Date.now() / 1000) - 301) },
    { timestamp: String(Math.floor(Date.now() / 1000) + 301) },
    { timestamp: '0' + String(Math.floor(Date.now() / 1000)) },
    { signedPath: `${prefix}/audiences` },
    { signedPath: `${prefix}/health?cursor=x` },
    { signedMethod: 'POST' },
    { signedBody: 'changed' },
  ]) assert.equal((await h.signed(`${prefix}/health`, 'GET', undefined, overrides)).status, 401);
  assert.equal((await h.raw(`${prefix}/health`)).status, 401);
  assert.equal((await h.signed(`${prefix}/events`, 'POST', [h.event()], { signedBody: '[]' })).status, 401);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM mail_link_events').get()!.n, 0);
  h.db.close();
});

test('D811 replay: KV TTL, sequential and concurrent replay; failures deny', async () => {
  const h = harness();
  const timestamp = String(Math.floor(Date.now() / 1000));
  assert.equal((await h.signed(`${prefix}/health`, 'GET', undefined, { timestamp })).status, 200);
  assert.equal((await h.signed(`${prefix}/health`, 'GET', undefined, { timestamp })).status, 409);
  assert.equal(h.puts.find(p => p.key.startsWith('mail-link:nonce:'))!.ttl, 600);
  assert.ok(Number(h.db.prepare('SELECT expires_at FROM mail_link_nonces').get()!.expires_at) - Number(timestamp) >= 600);
  assert.ok(Number(h.db.prepare('SELECT expires_at FROM mail_link_nonces').get()!.expires_at) - Number(timestamp) <= 601);
  // Simulate KV propagation lag: D1 must still serialize the claim.
  h.env.RATE_LIMITS.get = async () => null;
  const simultaneous = await Promise.all([0, 1].map(() => h.signed(`${prefix}/health`, 'GET', undefined, { timestamp: String(Number(timestamp) - 1) })));
  assert.deepEqual(simultaneous.map(r => r.status).sort(), [200, 409]);
  h.env.RATE_LIMITS.get = async () => { throw new Error('unavailable'); };
  assert.equal((await h.signed(`${prefix}/health`)).status, 503);
  h.env.RATE_LIMITS.get = async () => null;
  h.env.RATE_LIMITS.put = async (key: string) => { if (key.startsWith('mail-link:nonce:')) throw new Error('nonce unavailable'); };
  assert.equal((await h.signed(`${prefix}/health`, 'GET', undefined, { timestamp: String(Number(timestamp) - 20) })).status, 503);
  h.db.close();
});

test('D811 disabled: every path/method stays 404 before rate store or cookies', async () => {
  const h = harness();
  delete h.env.MAIL_LINK_SECRET;
  h.env.RATE_LIMITS.get = async () => { throw new Error('not reached'); };
  for (const path of ['/health', '/audiences', '/audiences/topic:brief/recipients', '/events', '/unknown']) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
      assert.equal((await h.raw(prefix + path, { method, headers: { Cookie: 'studioos_auth=ambient' } })).status, 404);
    }
  }
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM mail_link_nonces').get()!.n, 0);
  h.db.close();
});

test('D811 own rate bucket caps signed reads and fails closed', async t => {
  const clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  const h = harness();
  const window = Math.floor(Date.now() / 60000);
  h.kv.set(`rl:i:unknown:mail_link:${window}`, '120');
  assert.equal((await h.signed(`${prefix}/health`)).status, 429);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM mail_link_nonces').get()!.n, 0);
  h.kv.clear();
  assert.equal((await h.signed(`${prefix}/health`)).status, 200);
  h.env.RATE_LIMITS.get = async () => { throw new Error('unavailable'); };
  assert.equal((await h.signed(`${prefix}/health`)).status, 503);
  h.db.close();
});

test('D811 live counts and recipients exclude pending, unsubscribed, off, unconsented and every suppression', async () => {
  const h = harness();
  h.subscriber(1); h.subscriber(2, { status: 'pending' }); h.subscriber(3, { status: 'unsubscribed' });
  h.subscriber(4, { enabled: 0 }); h.subscriber(5, { consent: false });
  for (const [id, reason] of [[6, 'unsubscribe'], [7, 'bounce'], [8, 'complaint']] as const) {
    h.subscriber(id); h.db.prepare('INSERT INTO email_suppressions(email,reason) VALUES (?,?)').run(`person${id}@example.test`, reason);
  }
  const listing = await (await h.signed(`${prefix}/audiences`)).json() as any;
  assert.equal(listing.items.find((a: any) => a.key === 'topic:brief').count, 1);
  const page = await (await h.signed(recipients)).json() as any;
  assert.deepEqual(page.recipients.map((r: any) => r.email), ['person1@example.test']);
  assert.equal(page.next_cursor, null);
  assert.equal((await h.signed(recipients)).headers.get('Cache-Control'), 'no-store');
  assert.equal(page.recipients[0].first_name, null);
  assert.equal(page.recipients[0].company, null);
  const prefs = new URL(page.recipients[0].preferences_url);
  assert.deepEqual(await readPreferencesToken(newsletterKey, prefs.searchParams.get('token')), { uid: '1'.padStart(32, '0'), version: 1 });
  assert.equal(new URL(page.recipients[0].unsubscribe_url).searchParams.get('topic'), 'brief');
  assert.equal(page.recipients[0].one_click_url, page.recipients[0].unsubscribe_url);
  // Test the emitted URL against D810, not just its spelling.
  assert.equal((await h.raw(new URL(page.recipients[0].one_click_url).pathname + new URL(page.recipients[0].one_click_url).search, { method: 'POST' })).status, 200);
  assert.equal((await (await h.signed(recipients)).json() as any).recipients.length, 0);
  h.db.close();
});

test('D811 keyset pages have 500 recipients, stable continuation, cursor audience binding', async () => {
  const h = harness();
  for (let i = 1; i <= 1001; i++) h.subscriber(i);
  const one = await (await h.signed(recipients)).json() as any;
  assert.equal(one.recipients.length, 500); assert.ok(one.next_cursor);
  const two = await (await h.signed(`${recipients}?cursor=${encodeURIComponent(one.next_cursor)}`)).json() as any;
  assert.equal(two.recipients.length, 500); assert.ok(two.next_cursor);
  const three = await (await h.signed(`${recipients}?cursor=${encodeURIComponent(two.next_cursor)}`)).json() as any;
  assert.equal(three.recipients.length, 1); assert.equal(three.next_cursor, null);
  const all = [...one.recipients, ...two.recipients, ...three.recipients].map(r => r.email);
  assert.equal(new Set(all).size, 1001);
  assert.equal((await h.signed(`${prefix}/audiences/topic:events/recipients?cursor=${encodeURIComponent(one.next_cursor)}`)).status, 400);
  assert.equal((await h.signed(`${recipients}?cursor=broken`)).status, 400);
  assert.equal((await h.signed(`${prefix}/audiences/arbitrary/recipients`)).status, 400);
  assert.deepEqual(h.db.prepare('SELECT count FROM mail_link_reads ORDER BY id').all().map(r => r.count), [500, 500, 1]);
  h.db.close();
});

test('D811 role and event segments require their own opted-in consent; no inactive or mismatched account export', async () => {
  const h = harness();
  h.db.exec(`INSERT INTO users(id,email,name,role) VALUES (1,'person1@example.test','Fay Founder','founder'),(2,'person2@example.test','Ivy Investor','investor'),(3,'changed@example.test','Changed','founder');
    INSERT INTO user_profile_ext(user_id,organization) VALUES(1,'Example Studio');
    INSERT INTO events(id,slug,title,starts_at) VALUES(1,'demo','Demo','2026-10-20');
    INSERT INTO event_registrations(event_id,user_id,email) VALUES(1,1,'person1@example.test');`);
  h.subscriber(1, { user: 1 }); h.subscriber(2, { user: 2, topic: 'partner_letter' }); h.subscriber(3, { user: 3 });
  h.subscriber(4); // A public subscriber is never a founder merely because it opted in.
  const get = async (key: string) => (await (await h.signed(`${prefix}/audiences/${key}/recipients`)).json() as any).recipients;
  const founders = await get('members:founder:brief');
  assert.deepEqual(founders.map((r: any) => [r.email, r.first_name, r.last_name, r.company]), [['person1@example.test', 'Fay', 'Founder', 'Example Studio']]);
  assert.deepEqual((await get('investors_lps')).map((r: any) => r.email), ['person2@example.test']);
  assert.deepEqual((await get('topic:partner_letter')).map((r: any) => r.email), ['person2@example.test']);
  assert.equal((await get('event:1')).length, 0, 'registration alone is not consent');
  h.db.exec(`INSERT INTO newsletter_subscriber_topics(subscriber_id,topic,enabled) VALUES(1,'events',1)`);
  assert.equal((await get('event:1')).length, 1);
  h.db.exec(`UPDATE event_registrations SET status='confirmed'`);
  assert.equal((await get('event:1')).length, 1, 'host-confirmed guests retain their explicit events consent');
  h.db.exec(`UPDATE event_registrations SET status='cancelled'`);
  assert.equal((await get('event:1')).length, 0);
  h.db.exec("UPDATE users SET role='founder' WHERE id=2");
  assert.equal((await get('topic:partner_letter')).length, 0, 'stale investor consent does not bypass the current role');
  h.db.exec('UPDATE users SET is_active=0 WHERE id=1');
  assert.equal((await get('members:founder:brief')).length, 0);
  h.db.close();
});

test('D811 feedback: topic unsubscribe leaves other topics on; all suppresses and mirrors insights', async () => {
  const h = harness(); h.subscriber(1);
  h.db.exec(`INSERT INTO users(id,email,name) VALUES(1,'person1@example.test','One');
    UPDATE newsletter_subscribers SET user_id=1;
    INSERT INTO newsletter_subscriber_topics(subscriber_id,topic,enabled) VALUES(1,'events',1),(1,'insights',1);
    INSERT INTO insight_subscriptions(user_id,is_subscribed) VALUES(1,1)`);
  assert.deepEqual(await (await h.events([h.event('unsubscribe', 'topic:brief')])).json(), { ok: true, accepted: 1 });
  assert.deepEqual(h.db.prepare('SELECT topic,enabled FROM newsletter_subscriber_topics ORDER BY topic').all().map(r => [r.topic,r.enabled]), [['brief',0],['events',1],['insights',1]]);
  assert.equal(h.db.prepare('SELECT status FROM newsletter_subscribers').get()!.status, 'confirmed');
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM email_suppressions').get()!.n, 0);
  assert.equal((await h.events([h.event('unsubscribe', undefined, 'all')])).status, 200);
  assert.equal(h.db.prepare('SELECT status FROM newsletter_subscribers').get()!.status, 'unsubscribed');
  assert.equal(h.db.prepare('SELECT SUM(enabled) n FROM newsletter_subscriber_topics').get()!.n, 0);
  assert.equal(h.db.prepare('SELECT is_subscribed FROM insight_subscriptions').get()!.is_subscribed, 0);
  assert.deepEqual({ ...h.db.prepare('SELECT email,reason,source FROM email_suppressions').get() }, { email: 'person1@example.test', reason: 'unsubscribe', source: 'mail-link' });
  h.db.close();
});

test('D811 feedback: duplicate events never reapply, including resubscription and concurrent delivery', async () => {
  const h = harness(); h.subscriber(1);
  const input = [h.event()];
  assert.equal((await (await h.events(input)).json() as any).accepted, 1);
  h.db.exec(`UPDATE newsletter_subscribers SET status='confirmed'; UPDATE newsletter_subscriber_topics SET enabled=1; DELETE FROM email_suppressions`);
  assert.equal((await (await h.events(input)).json() as any).accepted, 0);
  assert.equal(h.db.prepare('SELECT status FROM newsletter_subscribers').get()!.status, 'confirmed');
  assert.equal(h.db.prepare('SELECT enabled FROM newsletter_subscriber_topics').get()!.enabled, 1);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM email_suppressions').get()!.n, 0);
  const both = await Promise.all([h.events([h.event('bounce')]), h.events([h.event('bounce')])]);
  assert.deepEqual((await Promise.all(both.map(r => r.json())) as any[]).map(r => r.accepted).sort(), [0,1]);
  assert.equal((await (await h.events([h.event('complaint')])).json() as any).accepted, 1);
  assert.deepEqual(h.db.prepare('SELECT reason FROM email_suppressions ORDER BY reason').all().map(r => r.reason), ['bounce','complaint']);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM activity_logs').get()!.n, 3);
  assert.equal((await (await h.events([h.event('complaint', undefined, 'message-2')])).json() as any).accepted, 1);
  assert.equal((await (await h.events([{ ...h.event('complaint'), email: 'other@example.test' }])).json() as any).accepted, 1);
  h.db.close();
});

test('D811 event validation is atomic, bounded at 500, and failures roll back receipts', async () => {
  const h = harness(); h.subscriber(1);
  for (const input of [[], Array(501).fill(h.event()), [h.event(), { ...h.event(), type: 'unknown' }], [{ ...h.event(), email: 'bad' }], [{ ...h.event(), at: 'bad' }], [{ ...h.event(), audience: 'members:founder:partner_letter' }]]) {
    assert.equal((await h.events(input)).status, 400);
  }
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM mail_link_events').get()!.n, 0);
  h.db.exec('DROP TABLE activity_logs');
  assert.equal((await h.events([h.event()])).status, 503);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM mail_link_events').get()!.n, 0);
  assert.equal(h.db.prepare('SELECT status FROM newsletter_subscribers').get()!.status, 'confirmed');
  h.db.exec(stripForeignKeys(tableFromBaseline(baseline, 'activity_logs')));
  const batch = Array.from({ length: 500 }, (_, i) => ({ ...h.event('bounce'), email: `bounce${i}@example.test` }));
  assert.equal((await (await h.events(batch)).json() as any).accepted, 500);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM email_suppressions').get()!.n, 500);
  h.db.close();
});

test('D811 privacy: reads and actor logs never record addresses or signed URLs; unreadable fails closed', async () => {
  const h = harness(); h.subscriber(1);
  assert.equal((await h.signed(recipients)).status, 200);
  assert.equal((await h.events([h.event('complaint')])).status, 200);
  const logs = JSON.stringify({ reads: h.db.prepare('SELECT * FROM mail_link_reads').all(), activity: h.db.prepare('SELECT * FROM activity_logs').all(), events: h.db.prepare('SELECT * FROM mail_link_events').all() });
  assert.doesNotMatch(logs, /example\.test|token=|X-Axal|PERSON1/);
  assert.equal(h.db.prepare('SELECT actor FROM activity_logs').get()!.actor, 'service:axal-mail');
  delete h.env.NEWSLETTER_TOKEN_KEY;
  assert.equal((await h.signed(recipients)).status, 503);
  h.env.NEWSLETTER_TOKEN_KEY = newsletterKey;
  h.db.exec('DROP TABLE mail_link_reads');
  assert.equal((await h.signed(recipients)).status, 503, 'no export without its read log');
  h.db.exec('DROP TABLE email_suppressions');
  assert.equal((await h.signed(recipients)).status, 503);
  assert.equal((await h.signed(`${prefix}/audiences`)).status, 503);
  h.db.close();
});

test('D811 bounded raw bodies reject large and invalid UTF-8 requests', async () => {
  const h = harness();
  assert.equal((await h.signed(`${prefix}/events`, 'POST', 'x'.repeat(262145))).status, 413);
  assert.equal((await h.raw(`${prefix}/events`, { method: 'POST', body: new Uint8Array([255]), headers: { 'X-Axal-Link-Timestamp': String(Math.floor(Date.now()/1000)), 'X-Axal-Link-Signature': '0'.repeat(64) } })).status, 400);
  h.db.close();
});


test('D811 service mount precedes browser CORS and carries security headers', () => {
  const source = read('cloudflare-worker/src/index.ts');
  const mount = source.indexOf("app.route('/api/mail-link', mailLinkRoutes)");
  assert.ok(mount > 0);
  assert.ok(mount < source.indexOf('  cors({'));
  assert.ok(source.indexOf("app.use('/api/mail-link/*', securityHeadersMiddleware())") < mount);
  const fetchSource = source.slice(source.indexOf('fetch: async (request: Request'));
  const ownEntry = fetchSource.indexOf("if (pathname === '/api/mail-link' || pathname.startsWith('/api/mail-link/')");
  assert.ok(ownEntry > 0);
  assert.ok(ownEntry < fetchSource.indexOf('assertJwtSecretStrength(env)'));
  assert.ok(ownEntry < fetchSource.indexOf('requiresBlockingRoleSchemaBootstrap(pathname, request.method)'));
});

test('D811 real Worker entry: disabled preflights are 404; health bypasses unrelated secret/bootstrap work', async () => {
  const { default: worker } = await import('../src/index.ts');
  const ctx: any = { waitUntil() {}, passThroughOnException() {} };
  for (const method of ['GET', 'POST', 'OPTIONS']) {
    const response = await worker.fetch(new Request(`https://example.test${prefix}/health`, {
      method, headers: { Origin: 'https://axal.vc', 'Access-Control-Request-Method': 'POST' },
    }), {} as any, ctx);
    assert.equal(response.status, 404);
  }
  const h = harness();
  const timestamp = String(Math.floor(Date.now()/1000));
  const signature = await mailLinkSignature(secret, 'GET', `${prefix}/health`, timestamp, '');
  const response = await worker.fetch(new Request(`https://example.test${prefix}/health`, {
    headers: { 'X-Axal-Link-Timestamp': timestamp, 'X-Axal-Link-Signature': signature, Cookie: 'studioos_auth=ambient' },
  }), h.env, ctx);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, version: '1' });
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  h.db.close();
});


test('D811 first idempotency tuple wins even when repeated in one batch with conflicting audiences', async () => {
  const h = harness(); h.subscriber(1);
  h.db.exec("INSERT INTO newsletter_subscriber_topics(subscriber_id,topic,enabled) VALUES(1,'events',1)");
  assert.equal((await (await h.events([h.event('unsubscribe', 'topic:brief'), h.event('unsubscribe', 'topic:events')])).json() as any).accepted, 1);
  assert.deepEqual(h.db.prepare('SELECT topic,enabled FROM newsletter_subscriber_topics ORDER BY topic').all().map(r => [r.topic,r.enabled]), [['brief',0],['events',1]]);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM activity_logs').get()!.n, 1);
  h.db.close();
});


test('D811 replay remains refused at the inclusive future-timestamp/nonce-expiry boundary', async t => {
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  const h = harness();
  const timestamp = String(Math.floor(clock / 1000) + 300);
  assert.equal((await h.signed(`${prefix}/health`, 'GET', undefined, { timestamp })).status, 200);
  clock += 600000;
  h.kv.clear(); // KV nonce has expired, but the timestamp is valid this second.
  assert.equal((await h.signed(`${prefix}/health`, 'GET', undefined, { timestamp })).status, 409);
  clock += 1000;
  assert.equal((await h.signed(`${prefix}/health`, 'GET', undefined, { timestamp })).status, 401);
  assert.equal((await h.signed(`${prefix}/health`, 'GET', undefined, { timestamp: String(Math.floor(clock/1000)) })).status, 200);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM mail_link_nonces').get()!.n, 1, 'expired claims are eventually removed');
  h.db.close();
});

const P1 = 'a'.repeat(32), P2 = 'b'.repeat(32);
function seedTesters(h: ReturnType<typeof harness>, total = 1) {
  h.db.exec(`INSERT INTO users(id,email,name,role) VALUES(10000,'host@example.test','Host','admin')`);
  h.db.prepare(`INSERT INTO testing_programmes(id,uid,owner_kind,created_by,product_name,places,status)
    VALUES(1,?,'hq',10000,'Example product',1000,'testing'),(2,?,'hq',10000,'Another product',1000,'closed')`).run(P1,P2);
  for (let i = 1; i <= total; i++) {
    h.db.prepare('INSERT INTO users(id,email,name) VALUES(?,?,?)').run(i,`tester${i}@example.test`,`Tester ${i}`);
    h.db.prepare(`INSERT INTO testing_applications(id,uid,programme_id,user_id,status,consent_email_at,consent_version)
      VALUES(?,?,1,?,'picked','2026-10-20','d812-1')`).run(i,(i+100).toString(16).padStart(32,'0'),i);
  }
}
const testerPath = `${prefix}/audiences/testers:${P1}/recipients`;
const local = (url: string) => new URL(url).pathname + new URL(url).search;

test('D811 programme consent exports picked testers without newsletter subscription and omits every ineligible case', async () => {
  const h = harness(); seedTesters(h,8);
  h.db.exec(`UPDATE testing_applications SET status='applied' WHERE id=2;
    UPDATE testing_applications SET consent_email_at=NULL,consent_version=NULL WHERE id=3;
    UPDATE testing_applications SET status='withdrawn' WHERE id=4;
    UPDATE users SET is_active=0 WHERE id=5;
    UPDATE testing_applications SET mail_enabled=0 WHERE id=6;
    INSERT INTO email_suppressions(email,reason) VALUES('tester7@example.test','bounce');
    INSERT INTO newsletter_subscribers(uid,email,status,source) VALUES('unsubscribed','tester8@example.test','unsubscribed','website');`);
  const list = await (await h.signed(`${prefix}/audiences`)).json() as any;
  assert.equal(list.items.find((x: any) => x.key === `testers:${P1}`).count,1);
  const page = await (await h.signed(testerPath)).json() as any;
  assert.deepEqual(page.recipients.map((x: any) => x.email),['tester1@example.test']);
  assert.equal(h.db.prepare("SELECT COUNT(*) n FROM newsletter_subscribers WHERE email='tester1@example.test'").get()!.n,0);
  assert.deepEqual(Object.keys(page.recipients[0]).sort(), ['email','first_name','last_name','company','unsubscribe_url','preferences_url','one_click_url'].sort());
  assert.equal(page.recipients[0].first_name,'Tester'); assert.equal(page.recipients[0].last_name,'1');
  h.db.exec("UPDATE testing_programmes SET status='submitted' WHERE id=1");
  assert.equal((await (await h.signed(testerPath)).json() as any).recipients.length,0);
  h.db.close();
});

test('D811 tester one-click and preferences are programme-only; GET never unsubscribes; tokens are scoped and retired on re-opt-in', async () => {
  const h = harness(); seedTesters(h);
  h.subscriber(1,{ user:1 });
  h.db.exec(`UPDATE newsletter_subscribers SET email='tester1@example.test';
    INSERT INTO testing_applications(uid,programme_id,user_id,status,consent_email_at,consent_version)
    VALUES('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',2,1,'picked','2026-10-20','d812-1');`);
  const recipient = (await (await h.signed(testerPath)).json() as any).recipients[0];
  const prefs = await (await h.raw(local(recipient.preferences_url))).json() as any;
  assert.equal(prefs.email_enabled,true); assert.equal(prefs.delivery_blocked,false);
  assert.equal(prefs.programme.uid,P1);
  const token = new URL(recipient.preferences_url).searchParams.get('token')!;
  assert.equal(await readPreferencesToken(newsletterKey,token),null, 'newsletter and programme tokens have separate domains');
  assert.equal((await h.raw(`/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`,{ method:'POST' })).status,403);
  assert.equal((await h.raw('/api/testing/mail/preferences?token=forged')).status,403);
  assert.equal((await h.raw(local(recipient.unsubscribe_url))).status,200);
  assert.equal(h.db.prepare('SELECT mail_enabled FROM testing_applications WHERE id=1').get()!.mail_enabled,1);
  const response = await h.raw(local(recipient.one_click_url),{ method:'POST',headers:{Cookie:'studioos_auth=ambient','Content-Type':'application/x-www-form-urlencoded'},body:'List-Unsubscribe=One-Click' });
  assert.equal(response.status,200);
  assert.deepEqual(h.db.prepare('SELECT mail_enabled FROM testing_applications ORDER BY id').all().map(x=>x.mail_enabled),[0,1]);
  assert.equal(h.db.prepare('SELECT enabled FROM newsletter_subscriber_topics').get()!.enabled,1);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM email_suppressions').get()!.n,0);
  assert.equal((await h.raw(local(recipient.one_click_url),{method:'POST'})).status,200);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM testing_events').get()!.n,1, 'an unchanged preference creates no fictitious audit');
  assert.equal((await (await h.signed(testerPath)).json() as any).recipients.length,0);
  const saved = await h.raw(local(recipient.preferences_url),{ method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:true}) });
  assert.equal(saved.status,200);
  const fresh = await saved.json() as any;
  assert.equal(fresh.email_enabled,true); assert.notEqual(fresh.preferences_url,recipient.preferences_url);
  assert.equal((await h.raw(local(recipient.one_click_url),{method:'POST'})).status,403);
  assert.equal((await h.raw(local(fresh.preferences_url))).status,200);
  assert.equal(h.db.prepare('SELECT consent_version FROM testing_applications WHERE id=1').get()!.consent_version,'d812-1');
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM testing_events').get()!.n,2);
  assert.equal(h.db.prepare("SELECT actor FROM activity_logs ORDER BY id DESC LIMIT 1").get()!.actor,'signed:testing-mail');
  assert.doesNotMatch(JSON.stringify({ activity:h.db.prepare('SELECT * FROM activity_logs').all(),testing:h.db.prepare('SELECT * FROM testing_events').all() }), /tester1@example\.test|token=/);
  h.db.exec("UPDATE users SET email='changed@example.test' WHERE id=1");
  assert.equal((await h.raw(local(fresh.preferences_url))).status,403);
  h.db.close();
});

test('D811 tester event unsubscribe is scoped and idempotent; global opt-out and complaints exclude testers', async () => {
  const h = harness(); seedTesters(h);
  h.subscriber(1,{user:1});
  h.db.exec(`UPDATE newsletter_subscribers SET email='tester1@example.test';
    INSERT INTO testing_applications(uid,programme_id,user_id,status,consent_email_at,consent_version)
    VALUES('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',2,1,'picked','2026-10-20','d812-1');`);
  const payload=[{...h.event('unsubscribe',`testers:${P1}`),email:'tester1@example.test'}];
  assert.equal((await (await h.events(payload)).json() as any).accepted,1);
  assert.deepEqual(h.db.prepare('SELECT mail_enabled FROM testing_applications ORDER BY id').all().map(x=>x.mail_enabled),[0,1]);
  assert.equal(h.db.prepare('SELECT enabled FROM newsletter_subscriber_topics').get()!.enabled,1);
  assert.equal(h.db.prepare('SELECT status FROM newsletter_subscribers').get()!.status,'confirmed');
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM email_suppressions').get()!.n,0);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM testing_events').get()!.n,1);
  h.db.exec('UPDATE testing_applications SET mail_enabled=1 WHERE id=1');
  assert.equal((await (await h.events(payload)).json() as any).accepted,0);
  assert.equal(h.db.prepare('SELECT mail_enabled FROM testing_applications WHERE id=1').get()!.mail_enabled,1);
  assert.equal((await h.events([{...h.event('complaint',`testers:${P1}`),email:'tester1@example.test'}])).status,200);
  assert.equal((await (await h.signed(testerPath)).json() as any).recipients.length,0);
  assert.equal((await h.events([{...h.event('unsubscribe',undefined,'global'),email:'tester1@example.test'}])).status,200);
  assert.deepEqual(h.db.prepare('SELECT mail_enabled FROM testing_applications ORDER BY id').all().map(x=>x.mail_enabled),[0,0]);
  h.db.close();
});

test('D811 tester paging is 500 rows and programme-bound; names are escaped in existing signed-link form pattern', async () => {
  const h = harness(); seedTesters(h,501);
  const one = await (await h.signed(testerPath)).json() as any;
  assert.equal(one.recipients.length,500); assert.ok(one.next_cursor);
  const two = await (await h.signed(`${testerPath}?cursor=${encodeURIComponent(one.next_cursor)}`)).json() as any;
  assert.equal(two.recipients.length,1); assert.equal(two.next_cursor,null);
  assert.equal(new Set([...one.recipients,...two.recipients].map(x=>x.email)).size,501);
  assert.equal((await h.signed(`${prefix}/audiences/testers:${P2}/recipients?cursor=${encodeURIComponent(one.next_cursor)}`)).status,400);
  h.db.prepare('UPDATE testing_programmes SET product_name=? WHERE id=1').run('<script>unsafe</script>');
  const html = await h.raw(local(one.recipients[0].preferences_url),{headers:{Accept:'text/html'}});
  assert.equal(html.status,200); assert.equal(html.headers.get('Cache-Control'),'no-store');
  const markup = await html.text(); assert.doesNotMatch(markup, /<script\b/i); assert.match(markup,/&lt;script&gt;/);
  assert.match(markup, /name="enabled" value="false"/);
  const form = await h.raw(local(one.recipients[0].preferences_url),{ method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'text/html'},body:'enabled=false' });
  assert.equal(form.status,200); assert.match(await form.text(), /Unsubscribed/);
  h.db.close();
});

test('D811 programme public guards: key, forged scope, revoked eligibility, rate bucket and unreadable suppression', async t => {
  const clock=Date.now(); t.mock.method(Date,'now',()=>clock);
  const h=harness();seedTesters(h);
  const recipient=(await (await h.signed(testerPath)).json() as any).recipients[0];
  const path=local(recipient.preferences_url);
  delete h.env.NEWSLETTER_TOKEN_KEY;
  assert.equal((await h.raw(path)).status,503);
  h.env.NEWSLETTER_TOKEN_KEY=newsletterKey;
  const token=new URL(recipient.preferences_url).searchParams.get('token')!;
  assert.equal((await h.raw(`/api/testing/mail/preferences?token=${encodeURIComponent(token.replace(/.$/,'z'))}`)).status,403);
  assert.equal((await h.raw(path,{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);
  h.db.exec("UPDATE testing_applications SET mail_enabled=0,status='withdrawn'");
  assert.equal((await h.raw(path,{method:'PUT',headers:{'Content-Type':'application/json'},body:'{"enabled":true}'})).status,403);
  h.db.exec("UPDATE testing_applications SET status='picked',programme_id=2");
  assert.equal((await h.raw(path)).status,403, 'token is bound to its programme');
  h.db.exec("UPDATE testing_applications SET programme_id=1; UPDATE users SET is_active=0 WHERE id=1");
  assert.equal((await h.raw(path)).status,403);
  h.db.exec('UPDATE users SET is_active=1 WHERE id=1');
  const window=Math.floor(clock/60000);
  h.kv.set(`rl:i:unknown:testing_mail_public:${window}`,'30');
  assert.equal((await h.raw(path)).status,429);
  h.kv.clear();
  h.db.exec('DROP TABLE email_suppressions');
  assert.equal((await h.raw(path)).status,503);
  h.db.close();
});

test('D811 public programme writes roll back on missing audit and never resurrect retired links during a race', async () => {
  const h=harness();seedTesters(h);
  const recipient=(await (await h.signed(testerPath)).json() as any).recipients[0];
  h.db.exec('DROP TABLE activity_logs');
  assert.equal((await h.raw(local(recipient.one_click_url),{method:'POST'})).status,503);
  assert.equal(h.db.prepare('SELECT mail_enabled FROM testing_applications').get()!.mail_enabled,1);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM testing_events').get()!.n,0);
  h.db.exec(stripForeignKeys(tableFromBaseline(baseline,'activity_logs')));
  // A concurrent opt-in retires the request's token after its initial read.
  const realBatch=h.env.DB.batch.bind(h.env.DB);
  h.env.DB.batch=async (statements: any[])=>{
    h.db.exec('UPDATE testing_applications SET mail_token_version=mail_token_version+1');
    return realBatch(statements);
  };
  assert.equal((await h.raw(local(recipient.one_click_url),{method:'POST'})).status,409);
  assert.equal(h.db.prepare('SELECT mail_enabled FROM testing_applications').get()!.mail_enabled,1);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM activity_logs').get()!.n,0);
  h.db.close();
});

test('D811 real Worker programme links ignore session cookies, require their own token, and preserve other testing gates', async () => {
  const {default:worker}=await import('../src/index.ts');
  const h=harness();seedTesters(h);
  const recipient=(await (await h.signed(testerPath)).json() as any).recipients[0];
  delete h.env.MAIL_LINK_SECRET;
  const ctx:any={waitUntil(){},passThroughOnException(){}};
  const response=await worker.fetch(new Request(recipient.preferences_url,{headers:{Cookie:'studioos_auth=ambient'}}),h.env,ctx);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
  const unsubscribe=await worker.fetch(new Request(recipient.one_click_url,{method:'POST',headers:{Cookie:'studioos_auth=ambient'}}),h.env,ctx);
  assert.equal(unsubscribe.status,200);
  assert.equal(h.db.prepare('SELECT mail_enabled FROM testing_applications').get()!.mail_enabled,0);
  const ordinary=await worker.fetch(new Request('https://example.test/api/testing/programmes'),{ENVIRONMENT:'production'} as any,ctx);
  assert.equal(ordinary.status,503,'ordinary testing routes keep the global secret/bootstrap preconditions');
  h.db.close();
});


test('D811 opt-in races cannot refresh a retired token or bypass current eligibility', async () => {
  for (const race of ['version','eligibility','email']) {
    const h=harness();seedTesters(h);
    const recipient=(await (await h.signed(testerPath)).json() as any).recipients[0];
    if (race!=='version') h.db.exec('UPDATE testing_applications SET mail_enabled=0');
    const real=h.env.DB.batch.bind(h.env.DB);
    h.env.DB.batch=async (statements:any[])=>{
      if (race==='version') h.db.exec('UPDATE testing_applications SET mail_token_version=mail_token_version+1');
      if (race==='eligibility') h.db.exec("UPDATE testing_applications SET status='withdrawn'");
      if (race==='email') h.db.exec("UPDATE users SET email='changed@example.test' WHERE id=1");
      return real(statements);
    };
    const response=await h.raw(local(recipient.preferences_url),{method:'PUT',headers:{'Content-Type':'application/json'},body:'{"enabled":true}'});
    assert.equal(response.status,409,race);
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM activity_logs').get()!.n,0);
    assert.equal(h.db.prepare('SELECT mail_enabled FROM testing_applications').get()!.mail_enabled,race==='version'?1:0);
    h.db.close();
  }
});

test('D811 event guests without a separate registration email match their own account, never every member', async () => {
  const h=harness();
  h.db.exec(`INSERT INTO users(id,email,name) VALUES(1,'person1@example.test','One'),(2,'person2@example.test','Two'),(3,'person3@example.test','Three');
    INSERT INTO events(id,slug,title,starts_at) VALUES(1,'demo','Demo','2026-10-20');
    INSERT INTO event_registrations(event_id,user_id,email) VALUES(1,1,NULL),(1,2,NULL);`);
  h.subscriber(1,{user:1,topic:'events'});h.subscriber(2,{topic:'events'});h.subscriber(3,{user:3,topic:'events'});
  const page=await (await h.signed(`${prefix}/audiences/event:1/recipients`)).json() as any;
  assert.deepEqual(page.recipients.map((r:any)=>r.email),['person1@example.test','person2@example.test']);
  const list=await (await h.signed(`${prefix}/audiences`)).json() as any;
  assert.equal(list.items.find((a:any)=>a.key==='event:1').count,2);
  h.db.exec("UPDATE users SET email='new@example.test' WHERE id=2");
  const changed=await (await h.signed(`${prefix}/audiences/event:1/recipients`)).json() as any;
  assert.deepEqual(changed.recipients.map((r:any)=>r.email),['person1@example.test']);
  const changedList=await (await h.signed(`${prefix}/audiences`)).json() as any;
  assert.equal(changedList.items.find((a:any)=>a.key==='event:1').count,1);
  h.db.close();
});

test('D811 review: one-click opt-outs survive mailbox bursts and KV outages; preferences keep their limit', async t => {
  const clock=Date.now();t.mock.method(Date,'now',()=>clock);
  const h=harness();seedTesters(h);
  const r=(await (await h.signed(testerPath)).json() as any).recipients[0];
  const window=Math.floor(clock/60000);
  for (const name of ['testing_mail_public','ip','writes']) h.kv.set(`rl:i:unknown:${name}:${window}`,'999999');
  assert.equal((await h.raw(local(r.one_click_url),{method:'POST'})).status,200);
  assert.equal((await h.raw(local(r.preferences_url))).status,429);
  h.env.RATE_LIMITS.get=async()=>{throw new Error('KV unavailable');};
  assert.equal((await h.raw(local(r.one_click_url),{method:'PUT'})).status,200);
  assert.equal((await h.raw('/api/testing/mail/unsubscribe?token=forged',{method:'POST'})).status,403);
  assert.equal((await h.raw(local(r.unsubscribe_url))).status,503);
  assert.equal(h.db.prepare('SELECT mail_enabled FROM testing_applications').get()!.mail_enabled,0);
  h.db.close();
});

test('D811 review: listing a large catalogue uses a bounded query count and batches read logs', async () => {
  const h=harness();seedTesters(h);
  for(let i=1;i<=1100;i++) h.db.prepare('INSERT INTO events(id,slug,title,starts_at) VALUES(?,?,?,?)').run(i,`event-${i}`,`Event ${i}`,'2026-10-20');
  let queries=0;const real=h.env.DB.prepare.bind(h.env.DB);
  h.env.DB.prepare=(sql:string)=>{queries++;return real(sql);};
  const response=await h.signed(`${prefix}/audiences`);
  assert.equal(response.status,200);
  const body=await response.json() as any;
  assert.ok(body.items.length>1100,'the fix preserves the full catalogue');
  assert.equal(body.items.find((a:any)=>a.key===`testers:${P1}`).count,1);
  assert.ok(queries<=12,`catalogue query budget exceeded: ${queries}`);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM mail_link_reads').get()!.n,body.items.length);
  h.db.close();
});

test('D811 review: feedback batch audit lookup uses its claim index', () => {
  const h=harness();
  const plan=h.db.prepare('EXPLAIN QUERY PLAN SELECT uid FROM mail_link_events WHERE claim_uid=?').all('batch');
  assert.ok(plan.some(r=>/USING (?:COVERING )?INDEX idx_mail_link_events_claim/.test(String(r.detail))));
  h.db.close();
});
