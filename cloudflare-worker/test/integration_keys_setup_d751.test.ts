/**
 * D751 (#1882) — Admin → Integration keys says what to register for every
 * OAuth connector: each managed row's Worker secret names, the callback URL
 * the provider must be given, the member-facing card the key serves and its
 * setup guide; and, read-only, the OAuth clients set only at deploy (Zoom,
 * Google Calendar, Microsoft 365).
 *
 * The harness is `integration_keys_d227.test.ts`'s: real node:sqlite with
 * tables cut from schema_baseline.sql, and `fetch` recorded, so "the read
 * makes no outbound call" is measured. Every client value is a fixture
 * string; none is a credential. Each case names the mutations it was
 * checked against.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/integration_keys_setup_d751.test.ts
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import integrationKeys, { SETUP_GUIDES } from '../src/routes/admin_integration_keys.ts';
import { _clearOauthCredsCache, MANAGED_PROVIDERS, PROVIDER_ENV_VARS } from '../src/services/providerOauthKeys.ts';
import { getDescriptor } from '../src/integrations/registry.ts';
import { redirectUri as githubCallback } from '../src/integrations/providers/github.ts';
import { redirectUri as slackCallback } from '../src/integrations/providers/slack.ts';
import { redirectUri as hubspotCallback } from '../src/integrations/providers/hubspot.ts';
import { redirectUri as calendlyCallback } from '../src/integrations/providers/calendly.ts';
import { redirectUri as cartaCallback } from '../src/integrations/providers/carta.ts';
import { redirectUri as docusignCallback } from '../src/integrations/providers/docusign.ts';
import { redirectUri as stripeCallback } from '../src/integrations/providers/stripe.ts';
import { redirectUri as salesforceCallback } from '../src/integrations/providers/salesforce.ts';
import { redirectUri as zoomCallback } from '../src/services/channels/zoom.ts';
import { linkedinRedirectUri } from '../src/routes/linkedin.ts';
import { preflightOAuthSecrets } from '../src/services/calendar.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 901;
const ADMIN = 902;
const FOUNDER = 903;

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}
const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}
function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'provider_oauth_keys', 'integrations']) db.exec(ddl(t));
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(SUPER, 'admin', 'The Holder', 'holder@example.test');
  u.run(ADMIN, 'admin', 'Plain Admin', 'admin@example.test');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, ?, datetime('now'))");
  s.run(SUPER, 'totp-super', 'totp');
  s.run(ADMIN, 'totp-admin', 'totp');
  s.run(FOUNDER, 'totp-founder', 'totp');
  return db;
}

// Fixture strings only: none is a credential.
const GH = { GITHUB_APP_CLIENT_ID: 'gh-client-id-sentinel', GITHUB_APP_CLIENT_SECRET: 'gh-client-secret-sentinel' };
const ZOOM = { ZOOM_CLIENT_ID: 'zoom-client-id-sentinel', ZOOM_CLIENT_SECRET: 'zoom-client-secret-sentinel', ZOOM_WEBHOOK_SECRET_TOKEN: 'zoom-webhook-sentinel' };
const GCAL = { GOOGLE_CAL_CLIENT_ID: 'gcal-client-id-sentinel', GOOGLE_CAL_CLIENT_SECRET: 'gcal-client-secret-sentinel' };
const MCAL = { MICROSOFT_CAL_CLIENT_ID: 'mcal-client-id-sentinel', MICROSOFT_CAL_CLIENT_SECRET: 'mcal-client-secret-sentinel' };
const envFor = (db: any, extra: Record<string, unknown> = {}) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), ...extra }) as any;

let calls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any) => { calls.push(String(input?.url ?? input)); return new Response('no call expected', { status: 599 }); }) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });
beforeEach(() => { calls = []; _clearOauthCredsCache(); });

async function token(userId: number, jti: string, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role, jti }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const app = new Hono<any>();
app.route('/', integrationKeys);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});
// The list is the Super Admin's since the owner's ruling (2026-10-20).
const SESSION: Record<number, [string, string]> = { [SUPER]: ['totp-super', 'admin'], [ADMIN]: ['totp-admin', 'admin'], [FOUNDER]: ['totp-founder', 'founder'] };
async function list(env: any, as = SUPER) {
  const [jti, role] = SESSION[as];
  const res = await app.request('/', {
    headers: { Authorization: `Bearer ${await token(as, jti, role)}` },
  }, env);
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body, text };
}
const row = (body: any, k: string) => body.providers.find((p: any) => p.provider_key === k);
const NOT_OAUTH = ['crunchbase', 'affinity', 'telegram', 'gcip'];
const REGISTRY_OAUTH = ['github', 'slack', 'hubspot', 'salesforce', 'docusign', 'calendly', 'carta', 'stripe'];
const OWN_CALLBACK: Record<string, (env: any) => string> = {
  github: githubCallback, slack: slackCallback, hubspot: hubspotCallback, calendly: calendlyCallback, carta: cartaCallback,
  docusign: docusignCallback, stripe: stripeCallback, salesforce: salesforceCallback, linkedin: linkedinRedirectUri,
};

// 1 ───────────────────────────────────────────────────────────────────────────
test('every managed row names its Worker secrets; every D227 field and the order stay', async () => {
  // Mutation checked: env_vars read from a second hand-kept map (GitHub missing).
  const r = await list(envFor(freshDb()));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.providers.map((p: any) => p.provider_key), MANAGED_PROVIDERS);
  for (const p of r.body.providers) {
    const names = PROVIDER_ENV_VARS[p.provider_key as keyof typeof PROVIDER_ENV_VARS];
    assert.deepEqual(p.env_vars, [names.id, names.secret], p.provider_key);
    for (const k of ['provider_key', 'source', 'has_keys', 'client_id_preview', 'updated_at', 'updated_by_user_id', 'active_integrations', 'state']) {
      assert.ok(k in p, `${p.provider_key}: ${k}`);
    }
  }
  assert.deepEqual(row(r.body, 'github').env_vars, ['GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET']);
  assert.equal(r.body.db_readable, true);
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('the callback follows OAUTH_CALLBACK_BASE_URL, then APP_URL, then app.axal.vc, and is the provider\'s own', async () => {
  // Mutations checked: the route building GitHub's callback from a literal
  // base; `/api/connectors/oauth/` in the helper; LinkedIn dropped from CALLBACK_URL.
  const db = freshDb();
  const cases: Array<[Record<string, string>, string]> = [
    [{ OAUTH_CALLBACK_BASE_URL: 'https://cb.example.test/', APP_URL: 'https://app.example.test' }, 'https://cb.example.test'],
    [{ APP_URL: 'https://app.example.test' }, 'https://app.example.test'],
    [{}, 'https://app.axal.vc'],
  ];
  for (const [vars, base] of cases) {
    const env = envFor(db, vars);
    const r = await list(env);
    assert.equal(row(r.body, 'github').callback_url, `${base}/api/integrations/oauth/github/callback`, base);
    for (const [k, fn] of Object.entries(OWN_CALLBACK)) assert.equal(row(r.body, k).callback_url, fn(env) || null, `${base}: ${k}`);
    for (const k of NOT_OAUTH) assert.equal(row(r.body, k).callback_url, null, k);
  }
  const over = await list(envFor(db, { LINKEDIN_REDIRECT_URI: 'https://li.example.test/cb' }));
  assert.equal(row(over.body, 'linkedin').callback_url, 'https://li.example.test/cb');
  assert.equal(zoomCallback(envFor(db)), 'https://app.axal.vc/api/integrations/oauth/zoom/callback');
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('connector: the OAuth registry card\'s three facts, LinkedIn\'s first-party card, null for the rest', async () => {
  // Mutations checked: crunchbase given a connector; the whole descriptor spread in.
  const r = await list(envFor(freshDb()));
  for (const k of REGISTRY_OAUTH) {
    const d = getDescriptor(k)!;
    assert.deepEqual(row(r.body, k).connector, { display_name: d.display_name, status: d.status, tier: d.tier }, k);
  }
  assert.deepEqual(row(r.body, 'github').connector, { display_name: 'GitHub', status: 'beta', tier: 'free' });
  assert.equal(row(r.body, 'salesforce').connector.status, 'coming_soon');
  assert.deepEqual(row(r.body, 'linkedin').connector, { display_name: 'LinkedIn', status: 'live', tier: 'free' });
  for (const k of NOT_OAUTH) assert.equal(row(r.body, k).connector, null, k);
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('guide_href points only at a file that exists', async () => {
  // Mutation checked: GitHub's guide at a missing path.
  const r = await list(envFor(freshDb()));
  const blob = 'https://github.com/AxalNetwork/StudioOS/blob/main/';
  for (const [k, path] of Object.entries(SETUP_GUIDES)) assert.ok(existsSync(resolve(process.cwd(), path)), `${k}: ${path} exists`);
  for (const p of r.body.providers) {
    const want = Object.hasOwn(SETUP_GUIDES, p.provider_key) ? blob + SETUP_GUIDES[p.provider_key] : null;
    assert.equal(p.guide_href, want, p.provider_key);
  }
  assert.ok(row(r.body, 'github').guide_href);
  assert.ok(r.body.other_oauth.find((o: any) => o.key === 'zoom').guide_href);
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('other_oauth: Zoom, Google and Microsoft, measured from env, with their names, fallbacks and callbacks', async () => {
  // Mutations checked: microsoft_365 dropped; Zoom read without the trim;
  // Google's fallback names lost.
  const db = freshDb();
  const keys = (b: any) => b.other_oauth.map((o: any) => o.key);
  const get = (b: any, k: string) => b.other_oauth.find((o: any) => o.key === k);
  const none = (await list(envFor(db))).body;
  assert.deepEqual(keys(none), ['zoom', 'google_calendar', 'microsoft_365']);
  for (const o of none.other_oauth) {
    assert.equal(o.configured, false, o.key);
    assert.deepEqual(Object.keys(o).sort(), ['callback_url', 'configured', 'connector', 'env_vars', 'fallback_env_vars', 'guide_href', 'key']);
  }
  assert.deepEqual(get(none, 'zoom').env_vars, ['ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET', 'ZOOM_WEBHOOK_SECRET_TOKEN']);
  assert.equal(get(none, 'zoom').fallback_env_vars, null);
  assert.equal(get(none, 'zoom').callback_url, 'https://app.axal.vc/api/integrations/oauth/zoom/callback');
  assert.deepEqual(get(none, 'zoom').connector, { display_name: 'Zoom', status: getDescriptor('zoom')!.status, tier: getDescriptor('zoom')!.tier });
  assert.equal(get(none, 'google_calendar').callback_url, null, 'no base at all');

  assert.equal(get((await list(envFor(db, ZOOM))).body, 'zoom').configured, true);
  assert.equal(get((await list(envFor(db, { ...ZOOM, ZOOM_CLIENT_ID: '   ' }))).body, 'zoom').configured, false, 'whitespace is unset');

  const base = { OAUTH_CALLBACK_BASE_URL: 'https://cb.example.test' };
  const g = get((await list(envFor(db, { ...base, ...GCAL }))).body, 'google_calendar');
  assert.equal(g.configured, true);
  assert.deepEqual([g.env_vars, g.fallback_env_vars], [['GOOGLE_CAL_CLIENT_ID', 'GOOGLE_CAL_CLIENT_SECRET'], ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']]);
  assert.equal(g.callback_url, 'https://cb.example.test/api/calendar/google/callback');
  const legacy = get((await list(envFor(db, { ...base, GOOGLE_CLIENT_ID: 'legacy-id-sentinel', GOOGLE_CLIENT_SECRET: 'legacy-secret-sentinel' }))).body, 'google_calendar');
  assert.equal(legacy.configured, true, 'the legacy pair counts');
  assert.deepEqual(legacy.env_vars, ['GOOGLE_CAL_CLIENT_ID', 'GOOGLE_CAL_CLIENT_SECRET'], 'and the row still names the canonical pair');
  const ov = get((await list(envFor(db, { ...base, GOOGLE_CALENDAR_REDIRECT_URI: 'https://g.example.test/cb' }))).body, 'google_calendar');
  assert.equal(ov.callback_url, 'https://g.example.test/cb');
  const m = get((await list(envFor(db, { ...base, ...MCAL }))).body, 'microsoft_365');
  assert.deepEqual([m.configured, m.env_vars, m.fallback_env_vars], [true, ['MICROSOFT_CAL_CLIENT_ID', 'MICROSOFT_CAL_CLIENT_SECRET'], ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET']]);
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('no client value leaves: no secret, no full client id, no preview on an env-only row', async () => {
  // Mutation checked: a client_id_preview of Zoom's id on its row.
  const db = freshDb();
  db.prepare("INSERT INTO provider_oauth_keys (provider_key, client_id, client_secret_enc) VALUES ('hubspot', 'hubspot-id-sentinel', 'v1:opaque-sentinel')").run();
  const r = await list(envFor(db, { APP_URL: 'https://app.example.test', ...GH, ...ZOOM, ...GCAL, ...MCAL }));
  assert.equal(r.status, 200);
  for (const v of [GH.GITHUB_APP_CLIENT_SECRET, ZOOM.ZOOM_CLIENT_SECRET, ZOOM.ZOOM_WEBHOOK_SECRET_TOKEN, GCAL.GOOGLE_CAL_CLIENT_SECRET,
    MCAL.MICROSOFT_CAL_CLIENT_SECRET, 'opaque-sentinel', GH.GITHUB_APP_CLIENT_ID, ZOOM.ZOOM_CLIENT_ID, GCAL.GOOGLE_CAL_CLIENT_ID, MCAL.MICROSOFT_CAL_CLIENT_ID]) {
    assert.ok(!r.text.includes(v), `the body never carries ${v}`);
  }
  for (const o of r.body.other_oauth) assert.ok(!('client_id_preview' in o), o.key);
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('access: the Super Admin reads, a plain admin and a founder are refused, and the read audits and calls nothing', async () => {
  // The owner's ruling (2026-10-20): the keys are the Super Admin's alone.
  const db = freshDb();
  assert.equal((await list(envFor(db))).status, 200);
  const a = await list(envFor(db), ADMIN);
  assert.equal(a.status, AUTH_ERROR_STATUSES['Super admin required'] ?? 403, a.text);
  const f = await list(envFor(db), FOUNDER);
  assert.equal(f.status, AUTH_ERROR_STATUSES['Admin required'] ?? 403, f.text);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get() as any).n, 0);
  assert.deepEqual(calls, []);
});

// 8 ───────────────────────────────────────────────────────────────────────────
test('the calendar preflight reports the same canonical names it did', () => {
  // Mutation checked: preflight pushing the fallback names.
  assert.deepEqual(preflightOAuthSecrets({} as any, 'google'), ['JWT_SECRET', 'GOOGLE_CAL_CLIENT_ID', 'GOOGLE_CAL_CLIENT_SECRET', 'PUBLIC_BASE_URL']);
  assert.deepEqual(preflightOAuthSecrets({ JWT_SECRET } as any, 'microsoft'), ['MICROSOFT_CAL_CLIENT_ID', 'MICROSOFT_CAL_CLIENT_SECRET', 'PUBLIC_BASE_URL']);
});
