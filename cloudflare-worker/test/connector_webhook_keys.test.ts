/**
 * The shared connector receiver, `POST /webhook/:provider/:uid` on both the
 * `/api/integrations` and `/api/connectors` mounts.
 *
 * A delivery is processed only for an ACTIVE connection whose provider has a
 * `webhook` handler and whose row stores a signing key, so every delivery it
 * acts on is checked against that key. HubSpot is the one provider that needs
 * no per-connection key: its handler checks HubSpot's v3 signature against the
 * app's client secret and throws on anything else. Every other case gets the
 * answer an unknown uid gets, before the body is read, with no handler run,
 * no outbound fetch and no log row.
 *
 * Calendly's handler then fetches only `https://api.calendly.com/
 * scheduled_events/<id>` (and that event's invitees), and its calendar
 * upsert rewrites a row only for the member who already holds it.
 *
 * The route, the registry, the column cipher and the real Calendly and
 * HubSpot providers run against a real SQLite database; only `fetch` is
 * replaced, so the test sees every outbound call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import integrations from '../src/routes/integrations.ts';
import { ensureIntegrationsSchema, registerProvider, getProviderImpl } from '../src/integrations/registry.ts';
import { encryptCredentials, encryptWebhookSecret } from '../src/integrations/secrets.ts';
import '../src/integrations/providers/calendly.ts';
import '../src/integrations/providers/hubspot.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';

const JWT_SECRET = 'k'.repeat(64); // synthetic fixture key
const HUBSPOT_SECRET = 'hubspot-fixture-client-secret';
const SIGNING_KEY = 'calendly-fixture-signing-key';
const PAT = 'calendly-fixture-pat';
const CL = 'https://api.calendly.com';
const MOUNTS = ['/api/integrations', '/api/connectors'];

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
/** The `calendar_events` block of migration 018, lifted as text so the table cannot drift. */
function calendarEventsDdl(): string {
  const src = read('cloudflare-worker/sql/migrations/018_calendly_integration.sql');
  const i = src.indexOf('CREATE TABLE IF NOT EXISTS calendar_events (');
  assert.ok(i >= 0);
  return src.slice(i, src.indexOf(');', i) + 2);
}
const companiesDdl = read('cloudflare-worker/sql/migrations/435_connector_companies.sql');

const app = new Hono<any>();
app.route('/api/connectors', integrations);
app.route('/api/integrations', integrations);

/** Stand-in Stripe and DocuSign handlers that only count calls, registered in place of the real ones (this file does not load them). */
const handlerCalls: Record<string, number> = { stripe: 0, docusign: 0 };
for (const key of ['stripe', 'docusign']) {
  registerProvider({
    key,
    async connect() { return { credentials: {}, scopes: [] }; },
    async verifyWebhook() { return true; },
    async webhook() { handlerCalls[key]++; return { summary: `${key} handled` }; },
  });
}

async function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, email TEXT);
    CREATE TABLE company_profiles(id INTEGER PRIMARY KEY);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    INSERT INTO users VALUES (1, 'founder', 'first@example.test'), (2, 'founder', 'second@example.test');
    INSERT INTO company_profiles VALUES (10);
    INSERT INTO user_company_links VALUES (1, 10), (2, 10);`);
  db.exec(calendarEventsDdl());
  const env = {
    DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', RATE_LIMITS: memKV(),
    HUBSPOT_CLIENT_ID: 'hubspot-fixture-id', HUBSPOT_CLIENT_SECRET: HUBSPOT_SECRET,
  } as any;
  await ensureIntegrationsSchema(env);
  db.exec(companiesDdl);
  return { db, env };
}

let nextId = 100;
/** One connection row, with real encrypted credentials and (optionally) a real encrypted signing key. */
async function connection(db: DatabaseSync, env: any, opts: {
  provider: string; user?: number; status?: string; key?: string | null; company?: boolean;
}) {
  const id = nextId++;
  const uid = `${opts.provider}${id}`.padEnd(32, '0');
  const creds = await encryptCredentials(env, uid, {
    access_token: PAT, token_type: 'Bearer', auth_method: 'pat',
    user_uri: `${CL}/users/U${opts.user ?? 1}`, organization_uri: `${CL}/organizations/O1`,
  } as any);
  const secret = opts.key ? await encryptWebhookSecret(env, uid, opts.key) : null;
  db.prepare(`INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type, credentials_enc, webhook_secret_enc)
    VALUES (?, ?, ?, ?, ?, 'api_key', ?, ?)`).run(id, uid, opts.user ?? 1, opts.provider, opts.status ?? 'active', creds, secret);
  if (opts.company) db.prepare('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, 10, 1)').run(id);
  return { id, uid };
}

async function hmacHex(key: string, message: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function calendlySignature(body: string, key = SIGNING_KEY) {
  const t = String(Math.floor(Date.now() / 1000));
  return `t=${t},v1=${await hmacHex(key, `${t}.${body}`)}`;
}

/** Every outbound call the worker makes, answered from `routes` (URL → JSON body). */
function stubFetch(routes: Record<string, unknown> = {}) {
  const calls: { url: string; auth: string | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, auth: new Headers(init.headers || {}).get('authorization') });
    if (url in routes) return new Response(JSON.stringify(routes[url]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

async function post(env: any, path: string, body: string, headers: Record<string, string> = {}) {
  const res = await app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body }, env);
  return { status: res.status, body: await res.json() as any };
}

const count = (db: DatabaseSync, table: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n);

const invitee = (uri: string) => JSON.stringify({ event: 'invitee.created', payload: { event: uri, uri: `${uri}/invitees/I1` } });
function eventResource(uri: string, name = 'Intro call') {
  return { resource: { uri, name, status: 'active', start_time: '2026-11-02T09:00:00Z', end_time: '2026-11-02T09:30:00Z', location: { type: 'zoom', join_url: 'https://zoom.example/j/1' } } };
}

test('on both mounts, a Calendly, Stripe or DocuSign connection with no signing key gets the unknown-uid answer, and nothing runs, fetches or logs', async () => {
  const { db, env } = await fixture();
  const rows = {
    calendly: await connection(db, env, { provider: 'calendly', key: null }),
    stripe: await connection(db, env, { provider: 'stripe', key: null, company: true }),
    docusign: await connection(db, env, { provider: 'docusign', key: null }),
  };
  const body = invitee(`${CL}/scheduled_events/EV1`);
  const net = stubFetch({ [`${CL}/scheduled_events/EV1`]: eventResource(`${CL}/scheduled_events/EV1`) });
  try {
    for (const mount of MOUNTS) {
      for (const [provider, row] of Object.entries(rows)) {
        const unknown = await post(env, `${mount}/webhook/${provider}/${'f'.repeat(32)}`, body);
        assert.deepEqual(unknown, { status: 404, body: { error: 'not_found' } });
        const keyless = await post(env, `${mount}/webhook/${provider}/${row.uid}`, body, {
          'Calendly-Webhook-Signature': await calendlySignature(body),
          'Stripe-Signature': 't=1,v1=00',
          'X-DocuSign-Signature-1': 'AAAA',
        });
        assert.deepEqual(keyless, unknown, `${mount} ${provider}: a keyless row answers like an unknown uid`);
      }
    }
    assert.deepEqual(handlerCalls, { stripe: 0, docusign: 0 }, 'no handler ran');
    assert.deepEqual(net.calls, [], 'no outbound fetch was made');
    assert.equal(count(db, 'integration_logs'), 0, 'nothing was logged');
    assert.equal(count(db, 'calendar_events'), 0, 'nothing was written to the calendar');
  } finally { net.restore(); db.close(); }
});

test('an inactive connection is refused even with a stored key and a correct signature', async () => {
  const { db, env } = await fixture();
  const body = invitee(`${CL}/scheduled_events/EV1`);
  const net = stubFetch({ [`${CL}/scheduled_events/EV1`]: eventResource(`${CL}/scheduled_events/EV1`) });
  try {
    for (const status of ['error', 'disconnected', 'paused']) {
      const row = await connection(db, env, { provider: 'calendly', key: SIGNING_KEY, status, user: nextId });
      for (const mount of MOUNTS) {
        const res = await post(env, `${mount}/webhook/calendly/${row.uid}`, body, { 'Calendly-Webhook-Signature': await calendlySignature(body) });
        assert.deepEqual(res, { status: 404, body: { error: 'not_found' } }, `${mount} status=${status}`);
      }
    }
    assert.deepEqual(net.calls, []);
    assert.equal(count(db, 'integration_logs'), 0);
    assert.equal(count(db, 'calendar_events'), 0);
  } finally { net.restore(); db.close(); }
});

test('a provider with no webhook handler gets the same answer, keyed or not, and its payload is not logged', async () => {
  const { db, env } = await fixture();
  assert.equal(getProviderImpl('salesforce'), null, 'fixture assumes no salesforce handler is loaded');
  registerProvider({ key: 'carta', async connect() { return { credentials: {}, scopes: [] }; } });
  const keyed = await connection(db, env, { provider: 'salesforce', key: 'salesforce-fixture-key', company: true });
  const keyless = await connection(db, env, { provider: 'carta', key: null, company: true });
  const body = JSON.stringify({ note: 'payload' });
  const signature = `sha256=${await hmacHex('salesforce-fixture-key', body)}`;
  try {
    for (const mount of MOUNTS) {
      assert.deepEqual(await post(env, `${mount}/webhook/salesforce/${keyed.uid}`, body, { 'X-Axal-Signature': signature }),
        { status: 404, body: { error: 'not_found' } });
      assert.deepEqual(await post(env, `${mount}/webhook/carta/${keyless.uid}`, body),
        { status: 404, body: { error: 'not_found' } });
    }
    assert.equal(count(db, 'integration_logs'), 0);
  } finally { db.close(); }
});

test('a correctly signed Calendly delivery to an active, keyed connection is fetched from api.calendly.com and stored', async () => {
  const { db, env } = await fixture();
  const row = await connection(db, env, { provider: 'calendly', key: SIGNING_KEY });
  const uri = `${CL}/scheduled_events/0b6f2e1c-7d1a-4c3e-9a55-2f1e8b7c6d5a`;
  const net = stubFetch({
    [uri]: eventResource(uri),
    [`${uri}/invitees?count=1`]: { collection: [{ uri: `${uri}/invitees/I1`, email: 'guest@example.test', name: 'Guest', status: 'active' }] },
  });
  try {
    for (const mount of MOUNTS) {
      const body = invitee(uri);
      const res = await post(env, `${mount}/webhook/calendly/${row.uid}`, body, { 'Calendly-Webhook-Signature': await calendlySignature(body) });
      assert.deepEqual(res, { status: 200, body: { ok: true } }, mount);
    }
    assert.deepEqual(net.calls.map((c) => c.url), [uri, `${uri}/invitees?count=1`, uri, `${uri}/invitees?count=1`]);
    assert.ok(net.calls.every((c) => c.auth === `Bearer ${PAT}`));
    const stored = db.prepare('SELECT user_id, external_uri, title, invitee_email FROM calendar_events').all() as any[];
    assert.deepEqual(stored.map((r) => ({ ...r })), [{ user_id: 1, external_uri: uri, title: 'Intro call', invitee_email: 'guest@example.test' }]);
    const logs = db.prepare('SELECT status, payload_json FROM integration_logs').all() as any[];
    assert.deepEqual(logs.map((r) => ({ ...r })), [{ status: 'ok', payload_json: null }, { status: 'ok', payload_json: null }]);

    const unsigned = await post(env, `/api/connectors/webhook/calendly/${row.uid}`, invitee(uri));
    assert.equal(unsigned.status, 401, 'a keyed row still refuses a delivery with no valid signature');
  } finally { net.restore(); db.close(); }
});

test('a signed Calendly delivery whose event URI is not an api.calendly.com scheduled event is skipped with no fetch', async () => {
  const { db, env } = await fixture();
  const row = await connection(db, env, { provider: 'calendly', key: SIGNING_KEY });
  const net = stubFetch();
  const elsewhere = [
    'https://elsewhere.example/scheduled_events/EV1',
    'https://api.calendly.com.elsewhere.example/scheduled_events/EV1',
    'https://api.calendly.com@elsewhere.example/scheduled_events/EV1',
    'https://api.calendly.com:8443/scheduled_events/EV1',
    'http://api.calendly.com/scheduled_events/EV1',
    '.elsewhere.example/scheduled_events/EV1',
    '@elsewhere.example/scheduled_events/EV1',
    '//elsewhere.example/scheduled_events/EV1',
    `${CL}/users/me`,
    `${CL}/scheduled_events`,
    `${CL}/scheduled_events/EV1/invitees`,
    `${CL}/scheduled_events/../users/me`,
    `${CL}/scheduled_events/EV1%2F..%2F..%2Fusers%2Fme`,
  ];
  try {
    for (const uri of elsewhere) {
      const body = invitee(uri);
      const res = await post(env, `/api/integrations/webhook/calendly/${row.uid}`, body, { 'Calendly-Webhook-Signature': await calendlySignature(body) });
      assert.deepEqual(res, { status: 200, body: { ok: true } }, uri);
    }
    assert.deepEqual(net.calls, [], 'no outbound fetch was made');
    assert.equal(count(db, 'calendar_events'), 0);
    const summaries = (db.prepare('SELECT response_summary FROM integration_logs').all() as any[]).map((r) => r.response_summary);
    assert.equal(summaries.length, elsewhere.length);
    assert.ok(summaries.every((s) => s.startsWith('skipped ')), summaries.join(' | '));
  } finally { net.restore(); db.close(); }
});

test('the invitee fetch takes only a scheduled-event URI, even from a Calendly response', async () => {
  const { db, env } = await fixture();
  const row = await connection(db, env, { provider: 'calendly', key: SIGNING_KEY });
  const asked = `${CL}/scheduled_events/EV2`;
  for (const returned of ['https://elsewhere.example/scheduled_events/EV2', `${CL}/users/me`]) {
    const net = stubFetch({ [asked]: eventResource(returned) });
    try {
      const body = invitee(asked);
      const res = await post(env, `/api/connectors/webhook/calendly/${row.uid}`, body, { 'Calendly-Webhook-Signature': await calendlySignature(body) });
      assert.equal(res.status, 200);
      assert.deepEqual(net.calls.map((c) => c.url), [asked], `${returned}: only the event itself was fetched`);
    } finally { net.restore(); }
  }
  db.close();
});

test('Calendly API calls never leave api.calendly.com, even when a response names a next page elsewhere', async () => {
  const { db, env } = await fixture();
  const { id } = await connection(db, env, { provider: 'calendly', key: SIGNING_KEY });
  const row = db.prepare('SELECT * FROM integrations WHERE id = ?').get(id) as any;
  const net = stubFetch();
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input);
    net.calls.push({ url, auth: new Headers(init.headers || {}).get('authorization') });
    return new Response(JSON.stringify({ collection: [], pagination: { next_page: '@elsewhere.example/scheduled_events?page=2' } }), { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(getProviderImpl('calendly')!.sync!({ env } as any, { id: 1 } as any, row), /calendly_path_invalid/);
    assert.equal(net.calls.length, 1, 'only the first page was fetched');
    assert.ok(net.calls[0].url.startsWith(`${CL}/scheduled_events?`));
  } finally { net.restore(); db.close(); }
});

test("a Calendly upsert naming another member's event URI leaves that member's row unchanged; the owner's own row still updates", async () => {
  const { db, env } = await fixture();
  const shared = `${CL}/scheduled_events/SHARED1`;
  const own = `${CL}/scheduled_events/OWN1`;
  const seed = db.prepare(`INSERT INTO calendar_events (uid, user_id, source, external_uri, external_id, title, start_at, end_at, status, raw_json)
    VALUES (?, ?, 'calendly', ?, ?, ?, '2026-11-01T09:00:00Z', '2026-11-01T09:30:00Z', 'scheduled', '{}')`);
  seed.run('cl_SHARED1', 2, shared, 'SHARED1', "Second member's meeting");
  seed.run('cl_OWN1', 1, own, 'OWN1', 'Before');
  const row = await connection(db, env, { provider: 'calendly', key: SIGNING_KEY, user: 1 });
  const net = stubFetch({ [shared]: eventResource(shared, 'Rewritten'), [own]: eventResource(own, 'After') });
  try {
    for (const uri of [shared, own]) {
      const body = invitee(uri);
      const res = await post(env, `/api/integrations/webhook/calendly/${row.uid}`, body, { 'Calendly-Webhook-Signature': await calendlySignature(body) });
      assert.equal(res.status, 200, uri);
    }
    const rows = (db.prepare('SELECT user_id, external_uri, title, start_at, raw_json FROM calendar_events ORDER BY id').all() as any[]).map((r) => ({ ...r }));
    assert.deepEqual(rows[0], { user_id: 2, external_uri: shared, title: "Second member's meeting", start_at: '2026-11-01T09:00:00Z', raw_json: '{}' });
    assert.equal(rows[1].user_id, 1);
    assert.equal(rows[1].title, 'After');
    assert.equal(rows.length, 2, 'no second row was made for the shared URI');
  } finally { net.restore(); db.close(); }
});

test('HubSpot keeps its path: a connection with no stored key reaches the handler, which verifies its own v3 signature', async () => {
  const { db, env } = await fixture();
  const row = await connection(db, env, { provider: 'hubspot', key: null, company: true });
  const body = JSON.stringify([{ subscriptionType: 'contact.creation', objectId: 7 }]);
  for (const mount of MOUNTS) {
    const path = `${mount}/webhook/hubspot/${row.uid}`;
    const unsigned = await post(env, path, body);
    assert.equal(unsigned.status, 500, `${mount}: the handler ran and refused an unsigned delivery`);
    assert.equal(unsigned.body.error, 'webhook_failed');

    const ts = String(Date.now());
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(HUBSPOT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`POST${'http://localhost' + path}${body}${ts}`));
    const signed = await post(env, path, body, {
      'X-HubSpot-Request-Timestamp': ts,
      'X-HubSpot-Signature-V3': btoa(String.fromCharCode(...new Uint8Array(mac))),
    });
    assert.deepEqual(signed, { status: 200, body: { ok: true } }, `${mount}: a signed delivery is processed`);
  }
  const summaries = (db.prepare('SELECT status, response_summary FROM integration_logs ORDER BY id').all() as any[]).map((r) => `${r.status}:${r.response_summary}`);
  assert.deepEqual(summaries, [
    'error:webhook_signature_missing', 'ok:events=1 handled=1',
    'error:webhook_signature_missing', 'ok:events=1 handled=1',
  ]);
  db.close();
});
