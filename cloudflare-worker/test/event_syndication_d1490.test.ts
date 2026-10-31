/**
 * D1490 (#3904) — event syndication, Part A: the core. Over the migrated
 * schema (migration 710 included), the real routes, and a fake adapter
 * (`_syndication_fake.ts`): Part A ships none. Every person, event and
 * account below is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/event_syndication_d1490.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { fakeAdapter } from './_syndication_fake.ts';
import events from '../src/routes/events.ts';
import adminEvents from '../src/routes/admin_events.ts';
import eventSyndication, { REGISTRATIONS_NOT_RECORDED } from '../src/routes/event_syndication.ts';
import adminEventSyndication from '../src/routes/admin_event_syndication.ts';
import { ChannelError, clearSyndicationChannelsForTest, SYNDICATION_CHANNELS } from '../src/services/eventSyndication/channels.ts';
import { DEFAULT_SETTINGS, eligibility, SKIP } from '../src/services/eventSyndication/eligibility.ts';
import { contentHash } from '../src/services/eventSyndication/content.ts';
import { markSyndicationDead, runSyndicationJob } from '../src/services/eventSyndication/jobs.ts';
import { encryptChannelCredentials } from '../src/integrations/secrets.ts';

test.after(() => removeMigratedDatabases());

const SECRET = 'synthetic-event-syndication-secret-'.repeat(2);
const SUPER = 1, ADMIN = 2, HOST = 3, OTHER = 4, INVESTOR = 5;
const EVENT = 10;
const FUTURE = '2099-03-01T18:00:00Z';
const SECRET_KEY = 'luma-secret-key-made-up-123456';

async function fixture({ adapters = true } = {}) {
  clearSyndicationChannelsForTest();
  const luma = adapters ? fakeAdapter('luma') : null;
  const linkedin = adapters ? fakeAdapter('linkedin', { capability: 'posts_link', updates: false, cancels: false }) : null;
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users (id, name, email, role, is_active) VALUES
      (${SUPER}, 'Sue Made-up', 'sue@example.test', 'admin', 1), (${ADMIN}, 'Abe Made-up', 'abe@example.test', 'admin', 1),
      (${HOST}, 'Hana Made-up', 'hana@example.test', 'founder', 1), (${OTHER}, 'Otto Made-up', 'otto@example.test', 'founder', 1),
      (${INVESTOR}, 'Ivy Made-up', 'ivy@example.test', 'investor', 1);
    INSERT INTO super_admins (user_id) VALUES (${SUPER});
    INSERT INTO user_sessions (user_id, jti, factor, assurance_level) VALUES
      (${SUPER}, 'jti-${SUPER}', 'totp', 'totp'), (${ADMIN}, 'jti-${ADMIN}', 'totp', 'totp'),
      (${HOST}, 'jti-${HOST}', 'password', 'password'), (${OTHER}, 'jti-${OTHER}', 'password', 'password'), (${INVESTOR}, 'jti-${INVESTOR}', 'password', 'password');
    INSERT INTO events (id, slug, host_user_id, type, title, summary, description, starts_at, visibility, status, created_at)
      VALUES (${EVENT}, 'founders-evening', ${HOST}, 'meetup', 'Founders evening', 'Drinks and demos', 'A long description.',
              '${FUTURE}', 'public', 'pending_review', '2026-10-01T00:00:00Z');
  `);
  const env: any = {
    DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc',
    RATE_LIMITS: (() => { const m = new Map<string, string>(); return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } }; })(),
  };
  const app = new Hono<any>()
    .route('/api/admin/event-syndication', adminEventSyndication)
    .route('/api/admin/events', adminEvents)
    .route('/api/events', eventSyndication)
    .route('/api/events', events);
  async function call(who: number | null, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (who) headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, jti: `jti-${who}` }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
    const res = await app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, text };
  }
  async function account(channel: string, extra: Record<string, unknown> = {}) {
    const uid = `acc-${channel}-${Math.random().toString(36).slice(2, 8)}`;
    const enc = await encryptChannelCredentials(env, uid, { api_key: SECRET_KEY });
    const cols = { uid, channel, owner_kind: 'hq', owner_user_id: null, external_account_id: `ext-acc-${channel}`, display_name: `Axal on ${channel}`,
      credentials_enc: enc, connected_by: SUPER, ...extra };
    db.prepare(`INSERT INTO event_channel_accounts (${Object.keys(cols).join(', ')}) VALUES (${Object.keys(cols).map(() => '?').join(', ')})`).run(...(Object.values(cols) as any[]));
    return uid;
  }
  /** Every queued syndication job, run once, oldest first. A throw is a failed run the queue would retry. */
  async function drain() {
    const jobs = db.prepare("SELECT id, payload FROM queue_jobs WHERE job_type = 'event_syndication' AND status = 'pending' ORDER BY id").all() as any[];
    for (const j of jobs) {
      db.prepare("UPDATE queue_jobs SET status = 'completed' WHERE id = ?").run(j.id);
      try { await runSyndicationJob(env, JSON.parse(j.payload)); } catch { /* the queue's retry */ }
    }
    return jobs.map((j) => JSON.parse(j.payload));
  }
  const rows = () => db.prepare('SELECT * FROM event_syndications ORDER BY id').all() as any[];
  const logs = () => db.prepare('SELECT * FROM event_syndication_log ORDER BY id').all() as any[];
  const queued = () => db.prepare("SELECT payload FROM queue_jobs WHERE job_type = 'event_syndication' AND status = 'pending' ORDER BY id").all().map((r: any) => JSON.parse(r.payload));
  const ev = () => db.prepare('SELECT * FROM events WHERE id = ?').get(EVENT) as any;
  return { db, env, call, account, drain, rows, logs, queued, ev, luma, linkedin };
}
type F = Awaited<ReturnType<typeof fixture>>;

/** The host ticks the accounts, then an admin approves. */
async function selectAndApprove(f: F, accounts: string[]) {
  const put = await f.call(HOST, 'PUT', `/api/events/${EVENT}/syndication`, { channels: accounts.map((account_uid) => ({ account_uid, on: true })) });
  assert.equal(put.status, 200, put.text);
  const approve = await f.call(ADMIN, 'POST', `/api/admin/events/${EVENT}/approve`, {});
  assert.equal(approve.status, 200, approve.text);
}

// ───────────────────────────────────────────────────────────── eligibility ──

test('eligibility: each event and account condition skips with its own sentence', () => {
  const ok = { visibility: 'public', status: 'published', admin_published: 1, starts_at: FUTURE, host_user_id: HOST };
  const hq = { status: 'active', owner_kind: 'hq', owner_user_id: null };
  const check = (e: any, a: any = hq, role = 'founder', s: any = DEFAULT_SETTINGS) => eligibility({ ...ok, ...e }, a, role, s);
  assert.deepEqual(check({}), { ok: true });
  assert.deepEqual(check({ visibility: 'private' }), { ok: false, reason: SKIP.private });
  assert.deepEqual(check({ visibility: 'unlisted' }), { ok: false, reason: 'Private event' }, 'unlisted is link-only');
  for (const status of ['pending_review', 'rejected', 'cancelled', 'draft']) assert.deepEqual(check({ status }), { ok: false, reason: 'Not approved for the public calendar' }, status);
  assert.deepEqual(check({ admin_published: 0 }), { ok: false, reason: 'Not approved for the public calendar' }, 'the admin gate');
  assert.deepEqual(check({ starts_at: '2020-01-01T00:00:00Z' }), { ok: false, reason: 'Event has started' });
  assert.deepEqual(check({}, hq, 'founder', { ...DEFAULT_SETTINGS, hosts: 'admins' }), { ok: false, reason: 'Host not allowed by HQ settings' }, 'a non-admin host under hosts=admins');
  assert.deepEqual(check({}, hq, 'admin', { ...DEFAULT_SETTINGS, hosts: 'admins' }), { ok: true });
  assert.deepEqual(check({}, { ...hq, status: 'expired' }), { ok: false, reason: 'Account expired' });
  const own = { status: 'active', owner_kind: 'host', owner_user_id: HOST };
  assert.deepEqual(check({}, own), { ok: false, reason: SKIP.host }, 'a host account under host_accounts=false');
  assert.deepEqual(check({}, own, 'founder', { ...DEFAULT_SETTINGS, host_accounts: true }), { ok: true });
  assert.deepEqual(check({}, { ...own, owner_user_id: OTHER }, 'founder', { ...DEFAULT_SETTINGS, host_accounts: true }), { ok: false, reason: SKIP.host }, 'another host\'s account');
});

// ─────────────────────────────────────────────────────────────── approve ──

test('approve moves only selected rows to pending, queues one post each, and the job posts with the link back', async () => {
  const f = await fixture();
  const luma = await f.account('luma');
  const linkedin = await f.account('linkedin');
  const google = await f.account('google_business');
  // A row already skipped (its account went away) is not moved by the approval.
  await f.call(HOST, 'PUT', `/api/events/${EVENT}/syndication`, { channels: [{ account_uid: google, on: true }] });
  f.db.prepare("UPDATE event_syndications SET status = 'skipped', skip_reason = 'Account expired'").run();
  await selectAndApprove(f, [luma, linkedin]);
  assert.deepEqual(f.rows().map((r) => [r.channel, r.status]), [['google_business', 'skipped'], ['luma', 'pending'], ['linkedin', 'pending']]);
  assert.equal(f.queued().length, 2);
  assert.ok(f.queued().every((p: any) => p.action === 'post'));
  await f.drain();
  const [, a, b] = f.rows();
  assert.deepEqual([a.status, a.sync_state, a.external_url, a.attempts], ['posted', 'in_sync', 'https://listing.example.test/luma/1', 1]);
  assert.equal(b.status, 'posted');
  assert.equal(f.luma!.calls[0].link, 'https://axal.vc/events/founders-evening?utm_source=luma&utm_medium=event_syndication');
  assert.deepEqual(f.luma!.calls[0].credentials, { api_key: SECRET_KEY }, 'the job decrypts the account\'s credentials');
  assert.deepEqual(f.logs().filter((l) => l.action === 'post').map((l) => [l.channel, l.outcome, l.actor_user_id]), [['luma', 'ok', null], ['linkedin', 'ok', null]]);
  // A second approve is refused and queues nothing.
  const again = await f.call(ADMIN, 'POST', `/api/admin/events/${EVENT}/approve`, {});
  assert.deepEqual([again.status, again.body.error], [409, 'not_waiting']);
  assert.equal(f.queued().length, 0);
  // D917 still holds with syndication rows present.
  assert.equal(f.ev().changed_after_approval_at, null);
  assert.equal(f.ev().admin_published, 1);
});

test('the job re-checks at run time: cancelled while queued never posts; a repeated message calls the adapter once', async () => {
  const f = await fixture();
  const luma = await f.account('luma');
  await selectAndApprove(f, [luma]);
  const [payload] = f.queued();
  f.db.prepare("UPDATE events SET status = 'cancelled', admin_published = 0 WHERE id = ?").run(EVENT);
  await f.drain();
  assert.equal(f.rows()[0].status, 'cancelled');
  assert.equal(f.luma!.calls.filter((c) => c.op === 'create').length, 0, 'no adapter call');

  const g = await fixture();
  const acc = await g.account('luma');
  await selectAndApprove(g, [acc]);
  const [p] = g.queued();
  await runSyndicationJob(g.env, p);
  await runSyndicationJob(g.env, p);
  assert.equal(g.luma!.calls.filter((c) => c.op === 'create').length, 1, 'the second delivery is a no-op');
  void payload;
});

test('a hook\'s failure never fails the approval', async () => {
  const f = await fixture();
  f.db.exec('DROP TABLE event_syndications');
  const r = await f.call(ADMIN, 'POST', `/api/admin/events/${EVENT}/approve`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(f.ev().status, 'published');
  assert.deepEqual(f.logs().map((l) => [l.action, l.outcome]), [['post', 'failed']], 'the failure is logged');
});

// ───────────────────────────────────────────────────────── edits (PATCH) ──

test('an edit to any sent field queues an update; a no-op does not; an admin\'s edit does; a link channel is unsupported', async () => {
  const f = await fixture();
  const luma = await f.account('luma');
  const linkedin = await f.account('linkedin');
  await selectAndApprove(f, [luma, linkedin]);
  await f.drain();
  // The description is outside D917's list.
  assert.equal((await f.call(HOST, 'PATCH', `/api/events/${EVENT}`, { description: 'A new description.' })).status, 200);
  assert.deepEqual(f.queued().map((p: any) => p.action), ['update']);
  const [l, li] = f.rows();
  assert.deepEqual([l.sync_state, li.sync_state], ['pending', 'unsupported']);
  await f.drain();
  assert.equal(f.rows()[0].sync_state, 'in_sync');
  assert.equal(f.luma!.calls.filter((c) => c.op === 'update').length, 1);
  // The same values again: nothing queued.
  await f.call(HOST, 'PATCH', `/api/events/${EVENT}`, { description: 'A new description.' });
  assert.equal(f.queued().length, 0, 'a no-op PATCH queues nothing');
  // A cover change by an admin.
  await f.call(ADMIN, 'PATCH', `/api/events/${EVENT}`, { cover_url: 'https://images.example.test/cover.png' });
  assert.deepEqual(f.queued().map((p: any) => p.action), ['update'], 'an admin\'s edit updates too');
  const before = await contentHash(f.ev());
  assert.notEqual(before, await contentHash({ ...f.ev(), summary: 'Changed' }), 'the summary is hashed');
});

// ──────────────────────────────────────────────────── cancel, unpublish ──

test('both cancels and unpublish propagate: posted rows are cancelled or withdrawn, the rest closed, a link channel unsupported', async () => {
  for (const [who, path, action, closed] of [
    [HOST, `/api/events/${EVENT}/cancel`, 'cancel', 'cancelled'],
    [ADMIN, `/api/admin/events/${EVENT}/cancel`, 'cancel', 'cancelled'],
    [ADMIN, `/api/admin/events/${EVENT}/unpublish`, 'withdraw', 'withdrawn'],
  ] as const) {
    const f = await fixture();
    const luma = await f.account('luma');
    const linkedin = await f.account('linkedin');
    const eventbrite = await f.account('eventbrite');
    await selectAndApprove(f, [luma, linkedin]);
    await f.drain();
    // Eventbrite ticked after the post ran: no adapter, so it fails and stays unposted.
    await f.call(HOST, 'PUT', `/api/events/${EVENT}/syndication`, { channels: [{ account_uid: eventbrite, on: true }] });
    await f.drain();
    const r = await f.call(who, 'POST', path, {});
    assert.equal(r.status, 200, `${path}: ${r.text}`);
    assert.deepEqual(f.queued().map((p: any) => p.action), [action], path);
    const byChannel = Object.fromEntries(f.rows().map((x) => [x.channel, x]));
    assert.deepEqual([byChannel.luma.status, byChannel.luma.sync_state], ['posted', 'pending'], path);
    assert.deepEqual([byChannel.linkedin.status, byChannel.linkedin.sync_state], ['posted', 'unsupported'], `${path}: a posts_link channel`);
    assert.equal(byChannel.eventbrite.status, closed, `${path}: not yet posted`);
    await f.drain();
    assert.equal(Object.fromEntries(f.rows().map((x) => [x.channel, x])).luma.status, closed);
    assert.equal(f.luma!.calls.filter((c) => c.op === 'cancel').length, 1);
  }
});

// ──────────────────────────────────────────────────── failures and retry ──

test('a platform refusal reads failed with its trimmed reason, without the key; a 429 names its time; retry only from failed', async () => {
  // The platform echoes the key bare, and a bearer token of its own.
  let failure: Error | null = new ChannelError(`Rejected: description too long for ${SECRET_KEY}. Bearer abcdef0123456789xyz ${'x'.repeat(700)}`, 422);
  const f = await fixture();
  clearSyndicationChannelsForTest();
  fakeAdapter('luma', { failWith: () => failure });
  const luma = await f.account('luma');
  await selectAndApprove(f, [luma]);
  const [p] = f.queued();
  for (let i = 0; i < 3; i++) { try { await runSyndicationJob(f.env, p); } catch { /* retried */ } }
  const row = f.rows()[0];
  assert.equal(row.status, 'failed', 'the third failed run marks it failed');
  assert.ok(row.last_error.length <= 500);
  assert.match(row.last_error, /^Rejected: description too long/);
  assert.ok(!JSON.stringify(f.rows()).includes(SECRET_KEY) && !JSON.stringify(f.logs()).includes(SECRET_KEY), 'no key in the row or the log');
  assert.ok(!JSON.stringify(f.logs()).includes('abcdef0123456789xyz'), 'no bearer token either');
  assert.match(row.last_error, /\[redacted\]/);
  assert.equal(f.logs().filter((l) => l.outcome === 'failed').length, 3);

  failure = new ChannelError('Too many requests', 429, '14:05 UTC');
  const retry = await f.call(HOST, 'POST', `/api/events/${EVENT}/syndication/${row.uid}/retry`, {});
  assert.equal(retry.status, 200, retry.text);
  assert.equal(retry.body.row.status, 'pending');
  await f.drain();
  assert.equal(f.rows()[0].last_error, 'Rate limited by Luma; retry after 14:05 UTC');
  assert.equal(f.rows()[0].status, 'pending', 'still retrying');
  const notFailed = await f.call(HOST, 'POST', `/api/events/${EVENT}/syndication/${row.uid}/retry`, {});
  assert.deepEqual([notFailed.status, notFailed.body.error], [409, 'not_failed']);

  // The dead-letter end marks it failed, keeping the reason.
  await markSyndicationDead(f.env, { syndication_uid: row.uid, action: 'post' });
  assert.deepEqual([f.rows()[0].status, f.rows()[0].last_error], ['failed', 'Rate limited by Luma; retry after 14:05 UTC']);
  // A retry for an event that has since started is refused with its reason.
  f.db.prepare("UPDATE events SET starts_at = '2020-01-01T00:00:00Z' WHERE id = ?").run(EVENT);
  const late = await f.call(HOST, 'POST', `/api/events/${EVENT}/syndication/${row.uid}/retry`, {});
  assert.deepEqual([late.status, late.body.error, late.body.message], [409, 'not_eligible', 'Event has started']);
});

// ────────────────────────────────────────────────────── per-event routes ──

test('per-event routes: a non-manager gets 404 on each; registrations are null with "Not recorded", never 0', async () => {
  const f = await fixture();
  const luma = await f.account('luma');
  const paths: Array<[string, string, unknown?]> = [
    ['GET', `/api/events/${EVENT}/syndication`], ['PUT', `/api/events/${EVENT}/syndication`, { channels: [] }],
    ['POST', `/api/events/${EVENT}/syndication/preview`, { account_uid: luma }],
    ['POST', `/api/events/${EVENT}/syndication/x/retry`, {}], ['POST', `/api/events/${EVENT}/syndication/x/withdraw`, {}],
  ];
  for (const [method, path, body] of paths) {
    for (const who of [OTHER, INVESTOR]) assert.equal((await f.call(who, method, path, body)).status, 404, `${who} ${method} ${path}`);
    assert.equal((await f.call(HOST, method, `/api/events/999/${path.split('/').slice(4).join('/')}`, body)).status, 404, 'no such event');
  }
  const read = await f.call(HOST, 'GET', `/api/events/${EVENT}/syndication`);
  assert.equal(read.status, 200);
  assert.deepEqual([read.body.eligible, read.body.reason], [false, 'Not approved for the public calendar']);
  const [row] = read.body.rows;
  assert.deepEqual([row.channel, row.account_uid, row.capability, row.on, row.status, row.registrations, row.registrations_reason],
    ['luma', luma, 'creates_events', false, null, null, REGISTRATIONS_NOT_RECORDED]);
  assert.match(REGISTRATIONS_NOT_RECORDED, /^Not recorded/);
  assert.equal((await f.call(ADMIN, 'GET', `/api/events/${EVENT}/syndication`)).status, 200, 'an admin manages it too');
  const preview = await f.call(HOST, 'POST', `/api/events/${EVENT}/syndication/preview`, { account_uid: luma, overrides: { title: 'Short title' } });
  assert.deepEqual([preview.status, preview.body.title, preview.body.capability], [200, 'Short title', 'creates_events']);
  assert.equal(f.luma!.calls.length, 0, 'a preview sends nothing');
});

test('PUT: over-limit overrides and a non-https ticket link are 400; another host\'s account is 404; a posted row is withdrawn, not unticked', async () => {
  const f = await fixture();
  const luma = await f.account('luma');
  const theirs = await f.account('eventbrite', { owner_kind: 'host', owner_user_id: OTHER });
  const put = (channels: unknown) => f.call(HOST, 'PUT', `/api/events/${EVENT}/syndication`, { channels });
  for (const overrides of [{ title: 'x'.repeat(61) }, { description: 'y'.repeat(301) }, { ticket_url: 'http://tickets.example.test' }, { ticket_url: 'javascript:alert(1)' }, { colour: 'red' }]) {
    const r = await put([{ account_uid: luma, on: true, overrides }]);
    assert.deepEqual([r.status, r.body.error], [400, 'invalid_overrides'], JSON.stringify(overrides));
  }
  assert.equal(f.rows().length, 0, 'nothing written on a refusal');
  assert.deepEqual([(await put([{ account_uid: theirs, on: true }])).status], [404]);
  const ok = await put([{ account_uid: luma, on: true, overrides: { title: 'Evening', ticket_url: 'https://axal.vc/events/founders-evening' } }]);
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual([ok.body.rows[0].on, ok.body.rows[0].status], [true, 'selected']);
  await f.call(ADMIN, 'POST', `/api/admin/events/${EVENT}/approve`, {});
  await f.drain();
  assert.equal(f.luma!.calls[0].title, 'Evening', 'the override is what posts');
  const off = await put([{ account_uid: luma, on: false }]);
  assert.deepEqual([off.status, off.body.error], [409, 'already_posted']);
  const w = await f.call(HOST, 'POST', `/api/events/${EVENT}/syndication/${f.rows()[0].uid}/withdraw`, {});
  assert.equal(w.status, 200, w.text);
  await f.drain();
  assert.equal(f.rows()[0].status, 'withdrawn');
  const again = await f.call(HOST, 'POST', `/api/events/${EVENT}/syndication/${f.rows()[0].uid}/withdraw`, {});
  assert.deepEqual([again.status, again.body.error], [409, 'not_posted']);
});

// ──────────────────────────────────────────────────────────── HQ routes ──

test('HQ routes: channels need a Super Admin; connect and disconnect too; a branch is hq_only; no adapter is not ready', async () => {
  const f = await fixture({ adapters: false });
  assert.equal(SYNDICATION_CHANNELS.length, 0, 'Part A ships no adapter');
  const list = await f.call(SUPER, 'GET', '/api/admin/event-syndication/channels');
  assert.equal(list.status, 200, list.text);
  assert.deepEqual(list.body.channels.map((c: any) => [c.channel, c.capability, c.adapter_ready, c.account]),
    [['luma', null, false, null], ['eventbrite', null, false, null], ['google_business', null, false, null], ['linkedin', null, false, null], ['facebook', null, false, null]]);
  assert.deepEqual([(await f.call(ADMIN, 'GET', '/api/admin/event-syndication/channels')).body.error], ['super_admin_required']);
  assert.equal((await f.call(HOST, 'GET', '/api/admin/event-syndication/channels')).status, 403);
  assert.equal((await f.call(null, 'GET', '/api/admin/event-syndication/channels')).status, 401);
  const notReady = await f.call(SUPER, 'POST', '/api/admin/event-syndication/channels/luma/connect', { api_key: 'k' });
  assert.deepEqual([notReady.status, notReady.body.error], [409, 'adapter_not_ready']);
  assert.deepEqual((await f.call(SUPER, 'POST', '/api/admin/event-syndication/channels/myspace/connect', {})).body.error, 'unknown_channel');
  assert.equal((await f.call(ADMIN, 'POST', '/api/admin/event-syndication/channels/luma/connect', {})).status, 403, 'a plain admin');
  const acc = await f.account('luma');
  assert.equal((await f.call(ADMIN, 'POST', `/api/admin/event-syndication/channels/${acc}/disconnect`, {})).status, 403, 'a plain admin cannot disconnect');
  f.env.BRANCH_CODE = 'nyc';
  assert.deepEqual((await f.call(SUPER, 'GET', '/api/admin/event-syndication/channels')).body.error, 'hq_only');
  assert.deepEqual((await f.call(ADMIN, 'GET', '/api/admin/event-syndication/log')).body.error, 'hq_only');
});

test('connect, PATCH and disconnect: credentials are stored encrypted and appear in no response and no log row', async () => {
  const f = await fixture();
  const bad = await f.call(SUPER, 'POST', '/api/admin/event-syndication/channels/luma/connect', { api_key: 'bad-key-0000' });
  assert.deepEqual([bad.status, bad.body.error], [502, 'channel_refused']);
  assert.ok(!bad.text.includes('bad-key-0000'), 'the refused key is not echoed');
  assert.match(bad.body.upstream, /^Luma refused the key \[redacted\] for this calendar\.$/, 'the Super Admin reads the platform\'s sentence');
  const ok = await f.call(SUPER, 'POST', '/api/admin/event-syndication/channels/luma/connect', { api_key: SECRET_KEY });
  assert.equal(ok.status, 201, ok.text);
  assert.deepEqual([ok.body.account.display_name, ok.body.account.status, ok.body.account.connected_by_name], ['Axal events (made up)', 'active', 'Sue Made-up']);
  const stored = f.db.prepare('SELECT credentials_enc FROM event_channel_accounts WHERE uid = ?').get(ok.body.account.uid) as any;
  assert.ok(stored.credentials_enc && !stored.credentials_enc.includes(SECRET_KEY), 'encrypted at rest');
  assert.deepEqual((await f.call(SUPER, 'POST', '/api/admin/event-syndication/channels/luma/connect', { api_key: SECRET_KEY })).body.error, 'already_connected');
  const patched = await f.call(SUPER, 'PATCH', `/api/admin/event-syndication/channels/${ok.body.account.uid}`, { default_on: true });
  assert.equal(patched.body.account.default_on, true);
  const list = await f.call(SUPER, 'GET', '/api/admin/event-syndication/channels');
  const read = await f.call(HOST, 'GET', `/api/events/${EVENT}/syndication`);
  assert.equal(read.body.rows[0].on, true, 'default on suggests it for a new event');
  const off = await f.call(SUPER, 'POST', `/api/admin/event-syndication/channels/${ok.body.account.uid}/disconnect`, {});
  assert.equal(off.body.account.status, 'disconnected');
  assert.equal((f.db.prepare('SELECT credentials_enc FROM event_channel_accounts WHERE uid = ?').get(ok.body.account.uid) as any).credentials_enc, null, 'credentials removed');
  const log = await f.call(ADMIN, 'GET', '/api/admin/event-syndication/log');
  assert.equal(log.status, 200);
  assert.deepEqual(log.body.rows.map((r: any) => [r.action, r.outcome]), [['disconnect', 'ok'], ['connect', 'ok'], ['connect', 'failed']]);
  for (const r of [bad, ok, patched, list, read, off, log]) {
    assert.ok(!r.text.includes('credentials_enc'), 'no response names credentials_enc');
    assert.ok(!r.text.includes(SECRET_KEY) && !r.text.includes(stored.credentials_enc), 'no response carries the key or its ciphertext');
  }
  assert.ok(!JSON.stringify(f.logs()).includes(SECRET_KEY) && !JSON.stringify(f.logs()).includes('bad-key-0000'), 'no log row carries a key');
});

test('settings: HQ admins read, the write bar saves; an unknown type or channel is 400; hosts=admins skips a founder\'s event', async () => {
  const f = await fixture();
  assert.deepEqual((await f.call(ADMIN, 'GET', '/api/admin/event-syndication/settings')).body.settings, DEFAULT_SETTINGS);
  for (const bad of [{ hosts: 'everyone' }, { default_channels_by_type: { rave: ['luma'] } }, { default_channels_by_type: { meetup: ['myspace'] } }, { host_accounts: 'yes' }]) {
    const r = await f.call(SUPER, 'PUT', '/api/admin/event-syndication/settings', bad);
    assert.deepEqual([r.status, r.body.error], [400, 'invalid_settings'], JSON.stringify(bad));
  }
  assert.equal((await f.call(ADMIN, 'PUT', '/api/admin/event-syndication/settings', { hosts: 'admins' })).status, 403);
  const saved = await f.call(SUPER, 'PUT', '/api/admin/event-syndication/settings', { hosts: 'admins', default_channels_by_type: { meetup: ['luma'] } });
  assert.equal(saved.status, 200, saved.text);
  const luma = await f.account('luma');
  const read = await f.call(HOST, 'GET', `/api/events/${EVENT}/syndication`);
  assert.equal(read.body.rows[0].on, true, 'the type default suggests it');
  await selectAndApprove(f, [luma]);
  await f.drain();
  assert.deepEqual([f.rows()[0].status, f.rows()[0].skip_reason], ['skipped', 'Host not allowed by HQ settings']);
  assert.equal(f.luma!.calls.length, 0);
  const log = await f.call(ADMIN, 'GET', `/api/admin/event-syndication/log?event=${EVENT}&outcome=skipped`);
  assert.deepEqual(log.body.rows.map((r: any) => [r.action, r.detail, r.event.title, r.actor_name]), [['skip', 'Host not allowed by HQ settings', 'Founders evening', null]]);
  assert.equal((await f.call(ADMIN, 'GET', '/api/admin/event-syndication/log?outcome=maybe')).body.error, 'bad_filter');
});

// ───────────────────────────────────────────────────────────── the walk ──

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

test('no `.publish(` under services/eventSyndication; no source file registers a fake channel; GET /channels selects no credentials', () => {
  const root = new URL('../src/', import.meta.url).pathname;
  for (const file of walk(join(root, 'services/eventSyndication'))) assert.doesNotMatch(readFileSync(file, 'utf8'), /\.publish\(/, file);
  for (const file of walk(root)) {
    if (file.endsWith('services/eventSyndication/channels.ts')) continue;
    assert.doesNotMatch(readFileSync(file, 'utf8'), /registerSyndicationChannel\(/, file);
  }
  const hq = readFileSync(join(root, 'routes/admin_event_syndication.ts'), 'utf8');
  for (const sql of hq.match(/SELECT[\s\S]*?FROM event_channel_accounts/g) ?? []) assert.doesNotMatch(sql, /credentials_enc|a\.\*|SELECT \*/, 'a read never selects credentials');
});
