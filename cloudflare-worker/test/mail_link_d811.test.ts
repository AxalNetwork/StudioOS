/** Real signed HTTP requests, real migration SQL, no providers or production. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac } from 'node:crypto';
import { Hono } from 'hono';
import mailLink from '../src/routes/mail_link.ts';
import newsletter from '../src/routes/newsletter.ts';
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

test('D811 incomplete tester consent contract is explicit, never a zero count', async () => {
  const h = harness();
  assert.equal((await h.signed(`${prefix}/audiences/testers:programme/recipients`)).status, 503);
  const list = await (await h.signed(`${prefix}/audiences`)).json() as any;
  assert.match(list.unavailable[0].reason, /Programme-scoped unsubscribe/);
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
  const ownEntry = fetchSource.indexOf("if (pathname === '/api/mail-link' || pathname.startsWith('/api/mail-link/'))");
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
