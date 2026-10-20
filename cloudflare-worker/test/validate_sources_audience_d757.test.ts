/**
 * D757 §2.1, §2.11, §2.12 (#1922) — Zoom, Meet transcripts, WhatsApp and
 * Telegram are founder-facing: listed and connectable only by a member who can
 * hold a venture (`canHoldValidateSource`). Zoom's row says what uses it, which
 * Validate modules it suggests into, and how far Zoom has approved the app.
 *
 * No provider is called: `globalThis.fetch` throws. Routes run on a real
 * `node:sqlite` database through `d1Over`, signed in with a fixture JWT, as
 * connector_readiness_d751.test.ts and channels_messaging_d684.test.ts do.
 * Each case names the mutations it was checked against.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/validate_sources_audience_d757.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import integrations from '../src/routes/integrations.ts';
import channels from '../src/routes/channels.ts';
import * as registry from '../src/integrations/registry.ts';
import { MODULE_HREFS, MODULE_LABELS, moduleHref } from '../src/integrations/moduleLabels.ts';
import { MODULES } from '../src/services/cycleValidate.ts';
import { canHoldValidateSource } from '../src/routes/_founder_validate_helpers.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import '../src/services/channels/zoom.ts';

const { CONNECTOR_METADATA, getDescriptor, pageDescriptor, publicDescriptor, zoomDistribution } = registry as any;

const JWT_SECRET = 'v'.repeat(64); // synthetic fixture key
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const ZOOM_ENV = { ZOOM_CLIENT_ID: 'zoom-d757-id', ZOOM_CLIENT_SECRET: 'zoom-d757-secret', ZOOM_WEBHOOK_SECRET_TOKEN: 'zoom-d757-token' };
const CHANNEL_ENV = {
  TELEGRAM_CHANNEL_BOT_TOKEN: '123456:tg-d757', TELEGRAM_CHANNEL_BOT_USERNAME: 'axal_d757_bot', TELEGRAM_CHANNEL_WEBHOOK_SECRET: 'tg_d757',
  WHATSAPP_APP_ID: '424242', WHATSAPP_APP_SECRET: 'wa-d757', WHATSAPP_VERIFY_TOKEN: 'verify-d757', WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: '777888',
  GOOGLE_CLIENT_ID: 'g-d757', GOOGLE_CLIENT_SECRET: 'g-d757-secret',
  // #1892's rollout, on: the venture check is what these cases hold.
  TELEGRAM_CHANNEL: 'on', WHATSAPP_CHANNEL: 'on',
  // D754 way B: Axal's own number, set up.
  WHATSAPP_AXAL_ACCESS_TOKEN: 'wa-axal-d757', WHATSAPP_AXAL_PHONE_NUMBER_ID: '5550001', WHATSAPP_AXAL_WABA_ID: '5550002', WHATSAPP_AXAL_DISPLAY_NUMBER: '+1 555 0001',
};

// id → [role, founder_id, spinout_lab_active]
const PEOPLE: Record<string, [number, string, number | null, number]> = {
  admin: [1, 'admin', null, 0],
  founder: [2, 'founder', 20, 0],
  investor: [3, 'investor', null, 0],
  advisor: [4, 'advisor', null, 0],
  partner: [5, 'partner', null, 0],
  exploring: [6, 'exploring', null, 0],
  lab: [7, 'exploring', 70, 1],
  lab_unlinked: [8, 'exploring', null, 1],
};
const VENTURE = ['admin', 'founder', 'lab'];
const NOT_VENTURE = Object.keys(PEOPLE).filter((k) => !VENTURE.includes(k));
// The connectors routes' own role gate (`ensureRole`) refuses `exploring` before
// any audience is read, so a Lab founder reaches Zoom only once that gate admits
// them; these are the people the connectors cases can ask.
const CONNECTORS_VENTURE = ['admin', 'founder'];
const CONNECTORS_NOT_VENTURE = ['investor', 'advisor', 'partner'];

globalThis.fetch = (async () => { throw new Error('no provider may be called'); }) as any;

function fixture(extraEnv: Record<string, string> = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, name TEXT, email TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER DEFAULT 0,
      subscription_tier TEXT DEFAULT 'studio', founder_id INTEGER, spinout_lab_active INTEGER DEFAULT 0, deletion_requested_at TEXT);
    CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY);
    CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE company_profiles(id INTEGER PRIMARY KEY);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE projects(id INTEGER PRIMARY KEY, company_id INTEGER, founder_id INTEGER, deleted_at TEXT);
    CREATE TABLE activity_logs(id INTEGER PRIMARY KEY, user_id INTEGER, actor TEXT, action TEXT, details TEXT, project_id INTEGER);
    CREATE TABLE integrations(id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE, user_id INTEGER, provider_key TEXT, status TEXT DEFAULT 'active', auth_type TEXT,
      display_name TEXT, credentials_enc TEXT, webhook_secret_enc TEXT, config_json TEXT, capabilities_json TEXT, scopes_json TEXT,
      external_account_id TEXT, external_account_name TEXT, last_synced_at TEXT, last_error TEXT, last_error_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, provider_key));
    CREATE TABLE integration_logs(id INTEGER PRIMARY KEY, integration_id INTEGER, user_id INTEGER, provider_key TEXT, direction TEXT,
      event_type TEXT, status TEXT, http_status INTEGER, request_summary TEXT, response_summary TEXT, external_id TEXT,
      payload_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integration_waitlist(id INTEGER PRIMARY KEY, user_id INTEGER, provider_key TEXT, notes TEXT, notified_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, provider_key));
    CREATE TABLE provider_oauth_keys (provider_key TEXT PRIMARY KEY, client_id TEXT NOT NULL, client_secret_enc TEXT NOT NULL,
      created_by_user_id INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_by_user_id INTEGER, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE google_oauth_tokens(user_id INTEGER, scope TEXT); CREATE TABLE microsoft_oauth_tokens(user_id INTEGER);
    INSERT INTO company_profiles VALUES (10);`);
  for (const [i, role, founderId, lab] of Object.values(PEOPLE)) {
    db.prepare('INSERT INTO users(id, role, name, email, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, ?, ?)')
      .run(i, role, `User ${i}`, `u${i}@example.test`, founderId, lab);
    db.prepare('INSERT INTO user_company_links VALUES (?, 10)').run(i);
  }
  db.exec(mig('435_connector_companies.sql'));
  db.exec(tableFromBaseline(BASELINE, 'oauth_state_tokens'));
  // The channel chain `_whatsapp_axal_fixture.ts` applies, then way B's links.
  db.exec(`CREATE TABLE founders (id INTEGER PRIMARY KEY, user_id INTEGER);
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, interviewee_name TEXT NOT NULL, interviewee_role TEXT,
      interview_date TEXT, notes TEXT, hypotheses_json TEXT, pains_json TEXT, icp_fit TEXT,
      transcript TEXT, transcribed_at TEXT, transcribed_by_model TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  for (const t of ['waitlist_signups', 'metric_targets', 'competitor_analyses', 'competitor_candidates',
    'competitor_sources', 'competitor_signals']) db.exec(tableFromBaseline(BASELINE, t));
  for (const m of ['106_pain_groups.sql', '211_founder_validate_evidence.sql', '214_validate_proposals.sql',
    '246_fills_the_blanks_everywhere.sql', '438_interview_sessions.sql', '439_validate_proposals_structuring.sql',
    '440_validate_cycle_stores.sql', '446_interview_structure_receipts.sql', '447_assistant_interviews.sql',
    '449_interview_channels.sql', '450_channel_events_delete_kind.sql', '451_channel_review_fixes.sql',
    '452_record_session_setup.sql', '454_channel_voice_failures.sql', '458_channel_link_consent.sql',
    '488_channel_consents.sql', '492_whatsapp_sender_links.sql', '504_whatsapp_link_settings.sql']) db.exec(mig(m));
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', ...ZOOM_ENV, ...CHANNEL_ENV, ...extraEnv } as any;
  const states = () => (db.prepare('SELECT COUNT(*) AS n FROM oauth_state_tokens').get() as any).n as number;
  return { db, env, states };
}

const app = new Hono<any>();
app.route('/api/connectors', integrations);
app.route('/api/integrations', integrations);
app.route('/api/channels', channels);
app.onError((e: any, c) => {
  const st = AUTH_ERROR_STATUSES[e?.message ?? ''];
  return st ? c.json({ detail: e.message }, st) : c.json({ error: e.message }, 500);
});

async function call(env: any, who: string, method: string, path: string, body?: unknown) {
  const [id, role] = PEOPLE[who];
  const token = await new SignJWT({ user_id: id, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'X-Company-Id': '10', 'Content-Type': 'application/json' };
  const res = await withThrownResponses(() => app.request(path, { method, headers, redirect: 'manual', ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env));
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const userOf = (who: string) => { const [id, role, founder_id, spinout_lab_active] = PEOPLE[who]; return { id, role, founder_id, spinout_lab_active } as any; };

// 1 ───────────────────────────────────────────────────────────────────────────
test('canHoldValidateSource: admin, founder and a Lab member with a founder_id; nobody else', () => {
  // Mutations checked: reading the role only (the Lab case fails); dropping the
  // founder_id test (lab_unlinked passes); dropping `admin` (admin fails).
  for (const who of VENTURE) assert.equal(canHoldValidateSource(userOf(who)), true, who);
  for (const who of NOT_VENTURE) assert.equal(canHoldValidateSource(userOf(who)), false, who);
  assert.equal(canHoldValidateSource({ role: 'investor', founder_id: 9, spinout_lab_active: 0 } as any), false, 'a founder_id alone is not the Lab');
  assert.equal(canHoldValidateSource({ role: 'Founder', founder_id: null } as any), true, 'the role is read case-blind');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('Zoom is listed, paged and startable only for a venture viewer; a refused start writes no state', async () => {
  // Mutations checked: no `audience_rule` on zoom (investors see it); the start
  // check moved after `issueOauthState` (a state row is left); no start check
  // (the start answers 200); `/available` filter dropped (zoom listed).
  const f = fixture();
  for (const who of ['exploring', 'lab', 'lab_unlinked']) {
    assert.equal((await call(f.env, who, 'GET', '/api/connectors/oauth/zoom/start')).status, 403, `${who}: ensureRole, unchanged`);
  }
  for (const who of CONNECTORS_NOT_VENTURE) {
    const avail = await call(f.env, who, 'GET', '/api/connectors/available');
    assert.equal(avail.status, 200, who);
    assert.equal(avail.body.items.some((p: any) => p.key === 'zoom'), false, `${who}: /available`);
    const page = await call(f.env, who, 'GET', '/api/connectors/directory/zoom');
    assert.deepEqual([page.status, page.body.error], [404, 'unknown_provider'], `${who}: /directory/zoom`);
    for (const mount of ['/api/connectors', '/api/integrations']) {
      const s = await call(f.env, who, 'GET', `${mount}/oauth/zoom/start`);
      assert.deepEqual([s.status, s.body.error], [404, 'unknown_provider'], `${who}: ${mount} start`);
      const cb = await call(f.env, who, 'GET', `${mount}/oauth/zoom/callback?code=c&state=s`);
      assert.deepEqual([cb.status, cb.body.error], [404, 'unknown_provider'], `${who}: ${mount} callback`);
    }
    assert.equal(f.states(), 0, `${who}: no oauth state was written`);
  }
  for (const who of CONNECTORS_VENTURE) {
    const avail = await call(f.env, who, 'GET', '/api/connectors/available');
    assert.equal(avail.body.items.some((p: any) => p.key === 'zoom'), true, `${who}: /available`);
    const page = await call(f.env, who, 'GET', '/api/connectors/directory/zoom');
    assert.equal(page.status, 200, `${who}: /directory/zoom`);
    const before = f.states();
    const s = await call(f.env, who, 'GET', '/api/connectors/oauth/zoom/start');
    assert.equal(s.status, 200, `${who}: start ${JSON.stringify(s.body).slice(0, 200)}`);
    assert.equal(f.states(), before + 1, `${who}: the start wrote its state`);
    // Past the audience, a bad state is the state check's refusal, not ours.
    const cb = await call(f.env, who, 'GET', '/api/connectors/oauth/zoom/callback?code=c&state=s');
    assert.deepEqual([cb.status, cb.body.error], [400, 'invalid_or_expired_state'], `${who}: callback`);
  }
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('Zoom\'s page is null for a non-venture viewer, as its audience is', () => {
  // Mutation checked: `pageDescriptor` ignoring `audience_rule` (an investor gets the page).
  const z = getDescriptor('zoom');
  assert.equal(pageDescriptor(z, { role: 'investor', hq: true, venture: false }), null);
  assert.equal(pageDescriptor(z, { role: 'exploring', hq: true, venture: false }), null);
  assert.equal(pageDescriptor(z, { role: 'founder', hq: true, venture: true })?.key, 'zoom');
});

// 3b ──────────────────────────────────────────────────────────────────────────
test('the venture rule touches no other provider', async () => {
  // Mutation checked: `audienceFor` answering `none` for every non-venture
  // viewer whatever the rule (the investor's list shrinks to Mercury-less nothing).
  const f = fixture();
  const keysFor = async (who: string) => (await call(f.env, who, 'GET', '/api/connectors/available')).body.items.map((p: any) => p.key).filter((k: string) => k !== 'mercury');
  const founder = await keysFor('founder');
  for (const who of CONNECTORS_NOT_VENTURE) assert.deepEqual(await keysFor(who), founder.filter((k: string) => k !== 'zoom'), who);
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('an existing Zoom connection keeps Disconnect for a member who can no longer connect it', async () => {
  // Mutation checked: an audience check added to DELETE /:uid (404).
  const f = fixture();
  f.db.prepare("INSERT INTO integrations(uid, user_id, provider_key, auth_type) VALUES ('zoom-inv', 3, 'zoom', 'oauth2')").run();
  const r = await call(f.env, 'investor', 'DELETE', '/api/connectors/zoom-inv');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM integrations WHERE uid = 'zoom-inv'").get() as any).n, 0);
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('channels: a non-venture member is offered no channel and cannot link or connect one; a venture member is', async () => {
  // Mutations checked: the list filter dropped (an investor sees Telegram);
  // `venture(` swapped back to `member(` on /telegram/link (an investor gets a code).
  const f = fixture();
  for (const who of NOT_VENTURE) {
    const list = await call(f.env, who, 'GET', '/api/channels');
    assert.equal(list.status, 200, who);
    assert.deepEqual(list.body.providers, [], `${who}: no channel offered`);
    for (const [method, path, body] of [
      ['POST', '/api/channels/telegram/link', undefined],
      ['GET', '/api/channels/telegram/link', undefined],
      ['POST', '/api/channels/telegram/link/abc/confirm', undefined],
      ['POST', '/api/channels/whatsapp/connect', { code: 'X', waba_id: '1', phone_number_id: '2' }],
      // D754 way B's link-code routes (#1937).
      ['POST', '/api/channels/whatsapp/link', undefined],
      ['GET', '/api/channels/whatsapp/link', undefined],
      ['POST', '/api/channels/whatsapp/link/abc/confirm', undefined],
    ] as const) {
      const r = await call(f.env, who, method, path, body);
      assert.deepEqual([r.status, r.body.code], [404, 'unknown_provider'], `${who}: ${method} ${path}`);
    }
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM channel_link_codes').get() as any).n, 0, `${who}: no link code`);
  }
  // The channel pages on the connectors directory (D753 C1) follow the same rule.
  // Mutation checked: no venture check on the channel branch of /directory/:key.
  for (const who of CONNECTORS_NOT_VENTURE) for (const k of ['whatsapp', 'telegram']) {
    const r = await call(f.env, who, 'GET', `/api/connectors/directory/${k}`);
    assert.deepEqual([r.status, r.body.error], [404, 'unknown_provider'], `${who}: /directory/${k}`);
  }
  for (const who of CONNECTORS_VENTURE) for (const k of ['whatsapp', 'telegram']) {
    assert.equal((await call(f.env, who, 'GET', `/api/connectors/directory/${k}`)).status, 200, `${who}: /directory/${k}`);
  }
  for (const who of VENTURE) {
    const list = await call(f.env, who, 'GET', '/api/channels');
    const offered = list.body.providers.map((p: any) => p.provider).sort();
    for (const k of ['google_meet', 'telegram', 'whatsapp']) assert.ok(offered.includes(k), `${who}: ${k}`);
    const link = await call(f.env, who, 'POST', '/api/channels/telegram/link');
    assert.equal(link.status, 200, `${who}: ${JSON.stringify(link.body)}`);
  }
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('channels: an investor with an existing Telegram connection still sees it and can disconnect it', async () => {
  // Mutation checked: `venture(` on DELETE /:provider (404).
  const f = fixture();
  f.db.prepare("INSERT INTO integrations(uid, user_id, provider_key, auth_type, external_account_name, config_json) VALUES ('tg-inv', 3, 'telegram', 'webhook', '@inv', '{}')").run();
  const list = await call(f.env, 'investor', 'GET', '/api/channels');
  assert.equal(list.body.connections.telegram?.status, 'active');
  const r = await call(f.env, 'investor', 'DELETE', '/api/channels/telegram');
  assert.deepEqual([r.status, r.body.disconnected], [200, true]);
  assert.equal((f.db.prepare("SELECT status FROM integrations WHERE uid = 'tg-inv'").get() as any).status, 'disconnected');
  // D754 way B: their WhatsApp linked through Axal's number unlinks too.
  // Mutation checked: `venture(` on DELETE /whatsapp/link (404).
  f.db.prepare("INSERT INTO integrations(uid, user_id, provider_key, auth_type, external_account_id) VALUES ('wal-inv', 3, 'whatsapp_link', 'webhook', 'hmac-inv')").run();
  const un = await call(f.env, 'investor', 'DELETE', '/api/channels/whatsapp/link');
  assert.deepEqual([un.status, un.body?.unlinked], [200, true], JSON.stringify(un.body));
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('Zoom\'s metadata: used_by, suggests and feeds, passed through publicDescriptor and onto its page', async () => {
  // Mutations checked: dropping `used_by`; reordering `suggests`; `feeds` gaining a suggestion.
  const used = [{ label: 'Validate › Record a session', href: '/validate/record' }];
  const suggests = ['problem_discovery', 'customer_research', 'ideal_customer_profile', 'market_intelligence', 'demand_signals', 'experiments'];
  assert.deepEqual(CONNECTOR_METADATA.zoom.used_by, used);
  assert.deepEqual(CONNECTOR_METADATA.zoom.suggests, suggests);
  assert.deepEqual(CONNECTOR_METADATA.zoom.feeds, ['customer_research']);
  const d = publicDescriptor(getDescriptor('zoom'), { role: 'founder', hq: true, venture: true });
  assert.deepEqual([d.used_by, d.suggests, d.feeds], [used, suggests, ['customer_research']]);
  const page = await call(fixture().env, 'founder', 'GET', '/api/connectors/directory/zoom');
  assert.deepEqual([page.body.connector.used_by, page.body.connector.suggests], [used, suggests]);
  for (const key of Object.keys(CONNECTOR_METADATA).filter((k) => k !== 'zoom')) {
    assert.ok(!('used_by' in CONNECTOR_METADATA[key]) && !('suggests' in CONNECTOR_METADATA[key]), key);
  }
});

// 8 ───────────────────────────────────────────────────────────────────────────
test('Zoom\'s distribution reads ZOOM_APP_AUDIENCE trimmed and lower-cased; anything else is own_account', async () => {
  // Mutations checked: an unknown value reading as `public`; no trim (`'BETA '` fails);
  // no lower-case; the field on every provider (github carries it).
  const cases: Array<[unknown, string]> = [[undefined, 'own_account'], ['', 'own_account'], ['BETA ', 'beta'], ['public', 'public'],
    ['Public', 'public'], ['everyone', 'own_account'], ['own_account', 'own_account'], [7, 'own_account']];
  for (const [raw, want] of cases) assert.equal(zoomDistribution(raw), want, String(raw));
  const z = getDescriptor('zoom');
  const viewer = { role: 'founder', hq: true, venture: true };
  for (const [raw, want] of cases.slice(0, 4)) {
    assert.equal(publicDescriptor(z, viewer, raw === undefined ? {} : { ZOOM_APP_AUDIENCE: raw }).distribution, want, String(raw));
  }
  assert.equal(publicDescriptor(z, viewer).distribution, 'own_account', 'no env at all');
  assert.ok(!('distribution' in publicDescriptor(getDescriptor('github'), viewer, { ZOOM_APP_AUDIENCE: 'public' })), 'only Zoom');
  const f = fixture({ ZOOM_APP_AUDIENCE: ' Beta' });
  const row = (await call(f.env, 'founder', 'GET', '/api/connectors/available')).body.items.find((p: any) => p.key === 'zoom');
  assert.equal(row.distribution, 'beta', 'the route passes its env');
});

// 9 ───────────────────────────────────────────────────────────────────────────
test('the five Validate module keys have labels and doors, and each door is a cycleValidate slug', () => {
  // Mutations checked: a label differing from MODULES' name; a door to `/validate/demand`.
  const slugs = new Map<string, string>(MODULES.map((m) => [m.slug, m.name]));
  for (const key of ['problem_discovery', 'ideal_customer_profile', 'demand_signals', 'experiments', 'verdict', 'customer_research', 'market_intelligence']) {
    const href = moduleHref(key);
    assert.ok(href && Object.hasOwn(MODULE_HREFS, key), key);
    const slug = href!.replace(/^\/validate\//, '');
    assert.equal(href, `/validate/${slug}`, key);
    assert.ok(slugs.has(slug), `${key}: ${slug} is a Validate module`);
    assert.equal(MODULE_LABELS[key], slugs.get(slug), `${key}: label is the module's name`);
  }
  for (const s of CONNECTOR_METADATA.zoom.suggests) assert.ok(MODULE_LABELS[s] && moduleHref(s), `zoom suggests ${s}`);
});
