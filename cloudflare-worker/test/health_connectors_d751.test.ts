/**
 * D751 T9 (#1921) — `GET /api/health` reports each catalogue OAuth connector's
 * readiness as `connectors_oauth: { <key>: true | false | null }`: keys and
 * booleans only, never an env var name, a value or a client id.
 *
 * Through the real Worker entry, on real SQLite.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/health_connectors_d751.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.ts';
import { REGISTRY, getProviderImpl } from '../src/integrations/registry.ts';
import { _clearOauthCredsCache, PROVIDER_ENV_VARS } from '../src/services/providerOauthKeys.ts';
import { ZOOM_CLIENT_ENV_VARS } from '../src/services/channels/zoom.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';

const FIXTURE_ID = 'Iv1.d751-health-fixture-id';
const FIXTURE_SECRET = 'd751-health-fixture-secret';
const GH = { GITHUB_APP_CLIENT_ID: FIXTURE_ID, GITHUB_APP_CLIENT_SECRET: FIXTURE_SECRET };
const OFFERED = ['calendly', 'carta', 'docusign', 'github', 'hubspot', 'slack', 'stripe', 'zoom'];
const ctx: any = { waitUntil() {}, passThroughOnException() {} };

function fixture(opts: { env?: Record<string, string>; unreadable?: boolean } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE provider_oauth_keys (provider_key TEXT PRIMARY KEY, client_id TEXT NOT NULL, client_secret_enc TEXT NOT NULL,
    created_by_user_id INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_by_user_id INTEGER, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  const real = d1Over(db);
  const DB = {
    ...real,
    prepare(sql: string) {
      if (opts.unreadable && /provider_oauth_keys/.test(sql)) throw new Error('D1_ERROR: fixture read failure');
      return real.prepare(sql);
    },
    batch: (...a: any[]) => (real as any).batch(...a),
  };
  return { DB, JWT_SECRET: 'z'.repeat(64), ENVIRONMENT: 'development', RATE_LIMITS: memKV(), TOKENS: memKV(), ...(opts.env || {}) } as any;
}

async function health(env: any) {
  const s = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await worker.fetch(new Request('https://axal.vc/api/health'), env, ctx);
    assert.equal(res.status, 200);
    const text = await res.text();
    return { text, body: JSON.parse(text) };
  } finally { [console.warn, console.error] = s; }
}

/** Every string anywhere in a JSON value: keys and values alike. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); strings(x, out); }
  return out;
}

test.beforeEach(() => _clearOauthCredsCache());

test('D751 T9: GitHub set and Slack unset read github true, slack false', async () => {
  const { body } = await health(fixture({ env: GH }));
  const block = body.connectors_oauth;
  assert.equal(block.github, true);
  assert.equal(block.slack, false);
  for (const k of OFFERED.filter((k) => k !== 'github')) assert.equal(block[k], false, k);
  // Beside github_sync, which keeps its own flags.
  assert.deepEqual(Object.keys(body.github_sync).sort(), ['repo', 'token', 'webhook_secret']);
});

test('D751 T9: a failed readiness read gives null, and the route still answers', async () => {
  const { body } = await health(fixture({ env: GH, unreadable: true }));
  const block = body.connectors_oauth;
  assert.equal(block.github, true, 'an env-set client needs no read');
  for (const k of ['calendly', 'carta', 'docusign', 'hubspot', 'slack', 'stripe']) assert.equal(block[k], null, k);
  assert.equal(block.zoom, false, "Zoom's readiness is its env secrets only");
  assert.equal(body.status, 'ok');
});

test('D751 T9: the key set is the catalogue offer: oauth2, implemented, not coming soon', async () => {
  const { body } = await health(fixture());
  const keys = Object.keys(body.connectors_oauth).sort();
  const catalogue = REGISTRY.filter((p) => p.auth_type === 'oauth2' && p.status !== 'coming_soon' && getProviderImpl(p.key)).map((p) => p.key).sort();
  assert.deepEqual(keys, catalogue);
  assert.deepEqual(keys, OFFERED);
  assert.ok(!keys.includes('salesforce') && !keys.includes('figma'), 'coming soon is left out');
  assert.ok(!keys.includes('google_calendar') && !keys.includes('crunchbase'), 'no implementation or not oauth2 is left out');
  for (const v of Object.values(body.connectors_oauth)) assert.ok(v === true || v === false || v === null, String(v));
});

test('D751 T9: the JSON carries no env var name and no fixture secret or client id', async () => {
  const names = [...Object.values(PROVIDER_ENV_VARS).flatMap((v) => [v.id, v.secret]), ...ZOOM_CLIENT_ENV_VARS];
  const slack = { SLACK_CLIENT_ID: 'slack-fixture-id', SLACK_CLIENT_SECRET: 'slack-fixture-secret' };
  const { text, body } = await health(fixture({ env: { ...GH, ...slack } }));
  assert.equal(body.connectors_oauth.slack, true);
  const all = strings(body);
  for (const secret of [FIXTURE_ID, FIXTURE_SECRET, ...Object.values(slack)]) {
    assert.ok(!text.includes(secret), `no ${secret}`);
  }
  for (const name of names) assert.ok(!all.some((s) => s.includes(name)), `no ${name}`);
  assert.ok(!all.some((s) => /_CLIENT_|_SECRET/.test(s)), 'no env-var-shaped string');
});
