/**
 * `GET /api/public/status` — the rows the public /status page draws.
 *
 * Pins:
 *   - with production's bindings every row is operational, so the page reads
 *     "All systems operational" (File storage once probed `env.R2`, which no
 *     wrangler.toml has ever bound; the bucket is `FILES`, so the row sat at
 *     "unknown" and the page rolled up to "Degraded");
 *   - the five rows added after it (search, jobs, published pages, backups,
 *     rendering) read their own bindings the same way;
 *   - a missing binding still reads honestly: "unknown" for AI and files,
 *     "down" for a store /api/health reports;
 *   - no row name carries a platform part ("(D1)", "(KV)", "Workers AI");
 *   - an incident tagged with the old technical word ("R2") still paints the
 *     row it names, and only that row.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/public_status_services.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from './_d1_sqlite.mjs';
import publicRoutes from '../src/routes/public.ts';
import { REGISTRY } from '../src/integrations/registry.ts';
import { MCP_PROVIDERS } from '../src/integrations/mcpProviders.ts';

const BOUND = {
  TOKENS: {}, RATE_LIMITS: {}, PIPELINE_ROOM: {}, ONBOARDING_CHAT: {}, AI: {}, FILES: {},
  VECTORIZE: {}, JOB_QUEUE: {}, PUBLICATIONS: {}, BACKUPS: {}, BROWSER: {},
};

type Row = { name: string; status: string; uptime_pct: number | null; monitoring?: string; availability?: string; note?: string; history: Array<{ day: string; status: string }> };

async function status(extra: Record<string, unknown>, seed = '') {
  const realFetch = globalThis.fetch;
  // The route asks its own /api/health first; with no Worker behind it the
  // probe falls back to the bindings it was given, as it does when that hop fails.
  globalThis.fetch = (async () => { throw new Error('no network in tests'); }) as typeof fetch;
  try {
    const env = { ...makeD1('SELECT 1;', ''), ...extra };
    if (seed) {
      await publicRoutes.request('/status', {}, env);
      env.db.exec(seed);
    }
    const res = await publicRoutes.request('/status', {}, env);
    assert.equal(res.status, 200);
    return (await res.json()) as { services: Row[] };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("production's bindings read operational on every row, File storage included", async () => {
  const { services } = await status(BOUND);
  assert.deepEqual(services.filter((s) => !s.monitoring).map((s) => [s.name, s.status]), [
    ['API and database', 'operational'],
    ['Sign-in sessions', 'operational'],
    ['Rate limiting', 'operational'],
    ['Live updates', 'operational'],
    ['Onboarding chat', 'operational'],
    ['AI scoring', 'operational'],
    ['File storage', 'operational'],
    ['Search', 'operational'],
    ['Background jobs', 'operational'],
    ['Published pages', 'operational'],
    ['Backups', 'operational'],
    ['Document rendering', 'operational'],
  ]);
  for (const s of services.filter((row) => !row.monitoring)) assert.equal(s.uptime_pct, 100, `${s.name} with no incident is at 100%`);
});

test('a missing binding is reported, not hidden', async () => {
  const { services } = await status({ ...BOUND, FILES: undefined, TOKENS: undefined });
  const by = Object.fromEntries(services.filter((s) => !s.monitoring).map((s) => [s.name, s.status]));
  assert.equal(by['File storage'], 'unknown');
  assert.equal(by['Sign-in sessions'], 'down');
});

test('no row name carries a platform part, and the match keys never leave the Worker', async () => {
  const { services } = await status(BOUND);
  for (const s of services) {
    assert.doesNotMatch(s.name, /\(|D1|KV|\bDO\b|R2|Workers AI|Durable/, s.name);
    assert.equal('match' in s, false, `${s.name} sends no match key`);
  }
});

test('an incident tagged with the old technical word still paints the row it names', async () => {
  const seed = `INSERT INTO status_incidents (title, status, severity, affected_services, created_at)
    VALUES ('Uploads slow', 'investigating', 'minor', '["R2"]', datetime('now'));`;
  const { services } = await status(BOUND, seed);
  const today = new Date().toISOString().slice(0, 10);
  for (const s of services) {
    const cell = s.history.find((h) => h.day === today);
    assert.equal(cell?.status, s.name === 'File storage' ? 'degraded' : s.monitoring ? 'unknown' : 'operational', s.name);
  }
});


test('MCP clients and connector coverage follow the shipping registries without inventing provider health', async () => {
  const { services } = await status(BOUND);
  const rows = services.filter((row) => row.monitoring === 'not_monitored');
  const expected = ['MCP server', 'Member API keys', 'MCP clients', 'Custom MCP clients',
    ...Object.values(MCP_PROVIDERS).map((provider) => `${REGISTRY.find((entry) => entry.key === provider.key)?.display_name ?? provider.key} MCP client`),
    ...REGISTRY.filter((provider) => provider.status !== 'coming_soon').map((provider) => `${provider.display_name} connector`),
    'WhatsApp messaging', 'Telegram messaging', 'Google Meet transcripts', 'Email delivery', 'Payments'];
  assert.deepEqual(rows.map((row) => row.name).sort(), expected.sort());
  assert.equal(new Set(services.map((row) => row.name)).size, services.length);
  for (const row of rows) {
    assert.equal(row.status, 'unknown', row.name);
    assert.equal(row.uptime_pct, null, row.name);
    assert.equal(row.history.length, 90, row.name);
    assert.ok(row.history.every((cell) => cell.status === 'unknown'), row.name);
    assert.match(row.note!, /Live service health is not monitored here/);
    assert.ok(row.availability, row.name);
  }
  const raw = JSON.stringify(rows);
  assert.doesNotMatch(raw, /https?:|access_token|refresh_token|client_secret|credentials|integration_uid/);
});

test('availability reports exact deployment flags without upgrading unknown health', async () => {
  const flags = { MCP_SERVER_ENABLED: 'true', OAUTH_KV: {}, API_KEYS_ENABLED: 'true', CUSTOM_MCP_ENABLED: ' TRUE ',
    WHATSAPP_CHANNEL: 'on', TELEGRAM_CHANNEL: 'off', MEET_TRANSCRIPTS_ENABLED: ' ON ',
    GMAIL_CLIENT_ID: 'fixture', GMAIL_CLIENT_SECRET: 'fixture', GMAIL_REFRESH_TOKEN: 'fixture', STRIPE_SECRET_KEY: 'fixture' };
  const { services } = await status({ ...BOUND, ...flags });
  const by = Object.fromEntries(services.map((row) => [row.name, row]));
  for (const name of ['MCP server', 'Member API keys', 'Custom MCP clients', 'WhatsApp messaging', 'Google Meet transcripts']) {
    assert.equal(by[name].availability, 'Enabled', name);
    assert.equal(by[name].status, 'unknown', name);
  }
  assert.equal(by['Telegram messaging'].availability, 'Not enabled');
  assert.equal(by['Email delivery'].availability, 'Configured');
  assert.equal(by.Payments.availability, 'Configured');
  const fallback = Object.fromEntries((await status(BOUND)).services.map((row) => [row.name, row.availability]));
  for (const name of ['MCP server', 'Member API keys', 'Custom MCP clients', 'Google Meet transcripts']) assert.equal(fallback[name], 'Not enabled', name);
  for (const name of ['WhatsApp messaging', 'Telegram messaging']) assert.equal(fallback[name], 'Limited rollout', name);
  for (const name of ['Email delivery', 'Payments']) assert.equal(fallback[name], 'Not configured', name);
  const noOauth = (await status({ ...BOUND, MCP_SERVER_ENABLED: 'true' })).services.find((row) => row.name === 'MCP server');
  assert.equal(noOauth?.availability, 'Not enabled');
});

test('a provider incident affects its MCP client, connector and current state without inventing uptime', async () => {
  const seed = `INSERT INTO status_incidents (title, status, severity, affected_services, created_at)
    VALUES ('Provider unavailable', 'investigating', 'critical', '["mercury"]', datetime('now'));`;
  const { services } = await status(BOUND, seed);
  const today = new Date().toISOString().slice(0, 10);
  for (const row of services) {
    const affected = row.name === 'Mercury MCP client' || row.name === 'Mercury connector';
    assert.equal(row.history.find((cell) => cell.day === today)?.status, affected ? 'down' : row.monitoring ? 'unknown' : 'operational', row.name);
    assert.equal(row.status, affected ? 'down' : row.monitoring ? 'unknown' : 'operational', row.name);
    if (row.monitoring) assert.equal(row.uptime_pct, null);
  }
});

test('registry keys remain incident aliases when their display names differ', async () => {
  const seed = `INSERT INTO status_incidents (title, status, severity, affected_services, created_at)
    VALUES ('Calendar delayed', 'investigating', 'minor', '["google_calendar"]', datetime('now'));`;
  const { services } = await status(BOUND, seed);
  const calendar = services.find((row) => row.name === 'Google Calendar connector')!;
  assert.equal(calendar.status, 'degraded');
  assert.equal(calendar.history.at(-1)?.status, 'degraded');
  assert.equal(calendar.uptime_pct, null);
});


test('a resolved incident remains historical without keeping an unmonitored provider down', async () => {
  const seed = `INSERT INTO status_incidents (title, status, severity, affected_services, created_at, resolved_at)
    VALUES ('Recovered provider', 'resolved', 'critical', '["mercury"]', datetime('now'), datetime('now'));`;
  const { services } = await status(BOUND, seed);
  const row = services.find((service) => service.name === 'Mercury MCP client')!;
  assert.equal(row.status, 'unknown');
  assert.equal(row.history.at(-1)?.status, 'down');
  assert.equal(row.uptime_pct, null);
});
