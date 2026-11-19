/**
 * #3725 (owner answer B): the Eventbrite syndication adapter against a mocked Eventbrite API, switched off
 * until the owner's app secrets exist. No request leaves the machine: `globalThis.fetch` is replaced.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/eventbrite_syndication_3725.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { clearSyndicationChannelsForTest, syndicationChannel, type ListingInput } from '../src/services/eventSyndication/channels.ts';
import { ChannelError } from '../src/services/eventSyndication/channelError.ts';
import { eventbriteAdapter as eb, eventbriteBody, eventbriteEnabled, eventbriteUtc, TITLE_LIMIT } from '../src/services/eventSyndication/eventbrite.ts';
import { runSyndicationJob } from '../src/services/eventSyndication/jobs.ts';
import { encryptChannelCredentials } from '../src/integrations/secrets.ts';

test.after(() => removeMigratedDatabases());

const TOKEN = 'eb-token-made-up-0123456789';
const ON = { EVENTBRITE_CLIENT_ID: 'client-made-up', EVENTBRITE_CLIENT_SECRET: 'secret-made-up-abcdef' } as any;
const LINK = 'https://axal.vc/events/founders-evening?utm_source=eventbrite&utm_medium=event_syndication';

type Call = { url: string; method: string; body: any; auth: string | null };
/** Replace fetch with a scripted Eventbrite. `routes` maps "METHOD path-fragment" to a response. */
function mockEventbrite(routes: Record<string, { status?: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any = {}) => {
    const method = init.method || 'GET';
    const ct = init.headers?.['Content-Type'] || '';
    calls.push({ url: String(url), method, auth: init.headers?.Authorization ?? null,
      body: init.body == null ? null : ct.includes('json') ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(init.body)) });
    const key = Object.keys(routes).find((k) => { const [m, frag] = k.split(' '); return m === method && String(url).includes(frag); });
    if (!key) return new Response(JSON.stringify({ error: 'NOT_MOCKED' }), { status: 404 });
    const r = routes[key];
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: r.headers });
  }) as any;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const input = (over: Partial<ListingInput['event']> = {}, overrides: ListingInput['overrides'] = {}): ListingInput => ({
  event: { id: 10, slug: 'founders-evening', title: 'Founders evening <& demos>', summary: 'Drinks', description: 'A long description.',
    cover_url: 'https://axal.vc/c.png', starts_at: '2099-03-01T18:00:00Z', ends_at: '2099-03-01T21:00:00Z', timezone: 'Europe/London',
    location_kind: 'in_person', location_text: '1 Made-up Street, London', location_url: null, price_cents: null, currency: null, type: 'meetup', ...over },
  link: LINK, overrides, credentials: { access_token: TOKEN, organization_id: '555' },
  account: { external_account_id: '555', display_name: 'Axal (made up)' },
});

test('switched off without both app secrets: every caller sees no Eventbrite adapter', () => {
  clearSyndicationChannelsForTest();
  for (const env of [{}, { EVENTBRITE_CLIENT_ID: 'x' }, { EVENTBRITE_CLIENT_SECRET: 'y' }, { EVENTBRITE_CLIENT_ID: '', EVENTBRITE_CLIENT_SECRET: 'y' }]) {
    assert.equal(eventbriteEnabled(env as any), false, JSON.stringify(env));
    assert.equal(syndicationChannel('eventbrite', env as any), null, JSON.stringify(env));
  }
  assert.equal(syndicationChannel('eventbrite', ON), eb, 'on once both secrets exist');
  assert.equal(eb.verified_on, null, 'not verified against the live API');
  assert.equal(eb.imports_registrations, false, 'Axal is the only ticket ledger; no attendee is read');
});

test('connect: the authorize URL carries the client and the signed state; the exchange needs exactly one organisation', async () => {
  const url = new URL(eb.authorizeUrl!(ON, 'nonce.sig', 'https://axal.vc/api/admin/event-syndication/oauth/eventbrite/callback'));
  assert.equal(url.origin + url.pathname, 'https://www.eventbrite.com/oauth/authorize');
  assert.deepEqual([url.searchParams.get('client_id'), url.searchParams.get('state'), url.searchParams.get('response_type')], ['client-made-up', 'nonce.sig', 'code']);
  let m = mockEventbrite({ 'POST /oauth/token': { body: { access_token: TOKEN } }, 'GET /users/me/organizations/': { body: { organizations: [{ id: '555', name: 'Axal' }] } } });
  try {
    const got = await eb.exchangeCode!(ON, 'code-1', 'https://axal.vc/cb');
    assert.deepEqual(got, { external_account_id: '555', display_name: 'Axal', credentials: { access_token: TOKEN, organization_id: '555' }, scopes: [], expires_at: null });
    assert.deepEqual(m.calls[0].body, { grant_type: 'authorization_code', client_id: 'client-made-up', client_secret: 'secret-made-up-abcdef', code: 'code-1', redirect_uri: 'https://axal.vc/cb' });
    assert.equal(m.calls[1].auth, `Bearer ${TOKEN}`);
  } finally { m.restore(); }
  m = mockEventbrite({ 'POST /oauth/token': { body: { access_token: TOKEN } }, 'GET /users/me/organizations/': { body: { organizations: [{ id: '1' }, { id: '2' }] } } });
  try {
    await assert.rejects(eb.exchangeCode!(ON, 'c', 'https://axal.vc/cb'), (e: any) => e instanceof ChannelError && e.status === 409 && /2 organisations/.test(e.message));
  } finally { m.restore(); }
});

test('create: an externally ticketed draft linking to Axal, then Eventbrite\'s own publish endpoint', async () => {
  const m = mockEventbrite({ 'POST /organizations/555/events/': { body: { id: '9001', url: 'https://www.eventbrite.com/e/9001' } }, 'POST /events/9001/publish/': { body: { published: true } } });
  try {
    const r = await eb.create(ON, input());
    assert.deepEqual(r, { external_id: '9001', external_url: 'https://www.eventbrite.com/e/9001' });
    assert.deepEqual(m.calls.map((c) => [c.method, new URL(c.url).pathname]), [['POST', '/v3/organizations/555/events/'], ['POST', '/v3/events/9001/publish/']]);
    const e = m.calls[0].body.event;
    assert.equal(e.name.html, 'Founders evening &lt;&amp; demos&gt;', 'escaped');
    assert.deepEqual([e.start.utc, e.end.utc, e.start.timezone], ['2099-03-01T18:00:00Z', '2099-03-01T21:00:00Z', 'Europe/London']);
    assert.deepEqual([e.is_externally_ticketed, e.external_ticketing.external_url, e.external_ticketing.ticketing_provider_name, e.external_ticketing.is_free], [true, LINK, 'Axal', true]);
    assert.match(e.description.html, /Register on Axal: https:\/\/axal\.vc\/events\/founders-evening/);
    assert.ok(m.calls.every((c) => c.auth === `Bearer ${TOKEN}`));
  } finally { m.restore(); }
});

test('update and cancel use the stored Eventbrite id; an unreadable id never reaches the network', async () => {
  const m = mockEventbrite({ 'POST /events/9001/cancel/': { body: {} }, 'POST /events/9001/': { body: { id: '9001', url: 'https://www.eventbrite.com/e/9001' } } });
  try {
    await eb.update(ON, { ...input({ title: 'New title' }), external_id: '9001' });
    await eb.cancel(ON, { ...input(), external_id: '9001' });
    assert.deepEqual(m.calls.map((c) => new URL(c.url).pathname), ['/v3/events/9001/', '/v3/events/9001/cancel/']);
    assert.equal(m.calls[0].body.event.name.html, 'New title');
    await assert.rejects(eb.cancel(ON, { ...input(), external_id: '../users/me' }), /not readable/);
    assert.equal(m.calls.length, 2);
  } finally { m.restore(); }
});

test('a refusal is a ChannelError with the platform\'s sentence and status; a 429 carries Retry-After; no token in the text', async () => {
  const m = mockEventbrite({
    'POST /organizations/555/events/': { status: 429, body: { error: 'HIT_RATE_LIMIT', error_description: 'Too many requests' }, headers: { 'retry-after': '120' } },
  });
  try {
    await assert.rejects(eb.create(ON, input()), (e: any) => e instanceof ChannelError && e.status === 429 && e.retryAfter === '120' && /Too many requests/.test(e.message) && !e.message.includes(TOKEN));
  } finally { m.restore(); }
  await assert.rejects(eb.create(ON, { ...input(), credentials: null }), (e: any) => e instanceof ChannelError && e.status === 401);
});

test('the body and the preview: end defaulted with a warning, the address described, the title cut to Eventbrite\'s limit', () => {
  const b = eventbriteBody(input({ ends_at: null, location_kind: 'online', location_text: null, price_cents: 2500, currency: 'gbp' }));
  assert.equal(b.event.end && (b.event.end as any).utc, '2099-03-01T19:00:00Z');
  assert.match(b.warnings.join(), /no end time/);
  assert.deepEqual([b.event.online_event, b.event.currency, (b.event.external_ticketing as any).is_free, (b.event.external_ticketing as any).minimum_ticket_price.value], [true, 'GBP', false, 2500]);
  const p = eb.preview(input({ title: 'x'.repeat(TITLE_LIMIT + 10) }));
  assert.equal(p.title.length, TITLE_LIMIT);
  assert.match(p.warnings.join(), /address is in the description/);
  assert.match(p.warnings.join(), new RegExp(`stop at ${TITLE_LIMIT}`));
  assert.match(p.text, /Register on Axal/);
  assert.equal(eventbriteUtc('2099-03-01 18:00:00'), '2099-03-01T18:00:00Z');
});

test('end to end through the job: switched off it sends nothing; switched on it posts once and stores the Eventbrite id', async () => {
  clearSyndicationChannelsForTest();
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users (id, name, email, role, is_active) VALUES (1, 'Sue Made-up', 'sue@example.test', 'admin', 1), (3, 'Hana Made-up', 'hana@example.test', 'founder', 1);
    INSERT INTO events (id, slug, host_user_id, type, title, summary, description, starts_at, ends_at, visibility, status, admin_published, created_at)
      VALUES (10, 'founders-evening', 3, 'meetup', 'Founders evening', 'Drinks', 'A long description.', '2099-03-01T18:00:00Z', '2099-03-01T21:00:00Z', 'public', 'published', 1, '2026-10-01T00:00:00Z');
  `);
  const base: any = { DB: d1Over(db), JWT_SECRET: 'synthetic-eventbrite-secret-'.repeat(2), APP_URL: 'https://axal.vc' };
  const enc = await encryptChannelCredentials(base, 'acc-eb', { access_token: TOKEN, organization_id: '555' });
  db.prepare(`INSERT INTO event_channel_accounts (uid, channel, owner_kind, external_account_id, display_name, credentials_enc, connected_by, status)
              VALUES ('acc-eb', 'eventbrite', 'hq', '555', 'Axal', ?, 1, 'active')`).run(enc);
  const acc = db.prepare("SELECT id FROM event_channel_accounts WHERE uid = 'acc-eb'").get() as any;
  db.prepare("INSERT INTO event_syndications (uid, event_id, account_id, channel, status) VALUES ('syn-1', 10, ?, 'eventbrite', 'pending')").run(acc.id);
  const row = () => ({ ...(db.prepare("SELECT status, external_id, external_url, last_error FROM event_syndications WHERE uid = 'syn-1'").get() as any) });

  const m = mockEventbrite({ 'POST /organizations/555/events/': { body: { id: '9001', url: 'https://www.eventbrite.com/e/9001' } }, 'POST /events/9001/publish/': { body: {} } });
  try {
    await runSyndicationJob(base, { syndication_uid: 'syn-1', action: 'post' }).catch(() => {});
    assert.equal(m.calls.length, 0, 'switched off: nothing sent');
    assert.equal(row().status, 'failed', 'a listing run while the channel is off fails with a reason, as any channel without an adapter');
    assert.match(row().last_error, /no adapter yet/);
    // The owner adds the app; HQ selects the listing again.
    db.prepare("UPDATE event_syndications SET status = 'pending', attempts = 0, last_error = NULL WHERE uid = 'syn-1'").run();
    await runSyndicationJob({ ...base, ...ON }, { syndication_uid: 'syn-1', action: 'post' });
    assert.deepEqual(row(), { status: 'posted', external_id: '9001', external_url: 'https://www.eventbrite.com/e/9001', last_error: null });
    await runSyndicationJob({ ...base, ...ON }, { syndication_uid: 'syn-1', action: 'post' });
    assert.equal(m.calls.filter((c) => c.url.includes('/organizations/555/events/')).length, 1, 'a repeated message posts nothing more');
    const logged = db.prepare('SELECT detail FROM event_syndication_log').all().map((r: any) => String(r.detail ?? '')).join(' ');
    assert.ok(!logged.includes(TOKEN), 'no token in the log');
  } finally { m.restore(); }
});
