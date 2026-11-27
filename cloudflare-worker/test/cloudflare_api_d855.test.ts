/**
 * D855 §4 row 5 (#3733 part 2) — Cloudflare, read-only, through its REST API.
 *
 *   1. The adapter is `api`, runs seven read tools and nothing else, with the
 *      provider's own connect, disconnect and revoke; connect takes no token.
 *   2. Never MCP: no MCP record for Cloudflare, no Code Mode URL in the code,
 *      and every call goes to `api.cloudflare.com/client/v4` on a fixed path.
 *   3. A grant is held to read scopes: a write or an edit is overreach, and
 *      a grant without the four reads is refused.
 *   4. Identifiers are checked before anything is sent.
 *   5. Builds and events keep named fields only: no environment variable,
 *      build command, author or URL.
 *   6. The Observability query is built here: a Worker's errors, or its
 *      request count, over at most 72 hours.
 *   7. Cloudflare's five-minute block (a 429, or code 971) is `rate_limited`,
 *      with `retry_after` 300 unless Cloudflare says otherwise.
 *   8. Only `services/cloudflare/api.ts` reads Cloudflare for a member.
 *
 * No live provider: every call is answered by the stub below, and any other
 * URL fails the test. Every identifier and every word is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cloudflare_api_d855.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { MCP_PROVIDERS } from '../src/integrations/mcpProviders.ts';
import { getConnectorAdapter } from '../src/integrations/contract.ts';
import { ConnectRefusal, getProviderImpl } from '../src/integrations/registry.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { CLOUDFLARE_TOOLS, SIGN_IN_ONLY, classifyCloudflareError, cloudflareAdapter } from '../src/integrations/providers/cloudflare.ts';
import {
  CLOUDFLARE_API, CLOUDFLARE_BLOCK_SECONDS, CLOUDFLARE_READ_SCOPES, CloudflareError, MAX_HOURS, MAX_LOG_LINES, MAX_LOG_PAGES,
  buildOf, checkGrantedScopes, cloudflareReads, errorOf, errorsQuery, eventOf, requestsQuery,
} from '../src/services/cloudflare/api.ts';

const JWT_SECRET = 'e'.repeat(64); // synthetic fixture key
const ACCOUNT = 'a'.repeat(32);
const TAG = 'b'.repeat(32);
const BUILD = '1a2b3c4d-0000-4000-8000-00000000000a';
const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);

const FIXTURE_BUILD = {
  build_uuid: BUILD,
  status: 'stopped',
  build_outcome: 'fail',
  created_on: '2026-10-31T10:00:00Z',
  modified_on: '2026-10-31T10:05:00Z',
  initializing_on: '2026-10-31T10:00:01Z',
  running_on: '2026-10-31T10:00:05Z',
  stopped_on: '2026-10-31T10:04:00Z',
  trigger: { trigger_uuid: 'x', build_command: 'npm run build -- --token=fixture-secret' },
  build_trigger_metadata: {
    build_trigger_source: 'push_event',
    branch: 'main',
    commit_hash: 'ABCDEF1234567',
    commit_message: 'Fixture change',
    author: 'fixture-author@example.test',
    build_command: 'npm run build -- --token=fixture-secret',
    build_token_uuid: 'fixture-token-uuid',
    environment_variables: { API_KEY: { is_secret: false, value: 'fixture-env-value' } },
    repo_name: 'fixture/app',
  },
};

const FIXTURE_EVENT = {
  dataset: 'cloudflare-workers',
  timestamp: NOW - 60_000,
  source: { exception: { message: 'Fixture failure' } },
  $metadata: {
    id: 'evt-1', service: 'fixture-app', level: 'error', statusCode: 500, trigger: 'GET /checkout',
    error: 'TypeError: fixture', url: 'https://fixture.example/checkout?email=someone@example.test',
  },
};

interface Call { method: string; url: string; body: any; auth: string | null }

/** Cloudflare answering from fixed fixtures; any other host fails the test. */
function stub(answer: (call: Call) => Response | undefined = () => undefined) {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      method: String(init?.method ?? 'GET'), url: url.href,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
    };
    calls.push(call);
    if (url.origin !== 'https://api.cloudflare.com') throw new Error(`unexpected fetch ${url.href}`);
    const given = answer(call);
    if (given) return given;
    const ok = (result: unknown, result_info: unknown = null) => new Response(JSON.stringify({ success: true, errors: [], messages: [], result, result_info }), { status: 200 });
    const p = url.pathname.replace('/client/v4', '');
    if (p === '/accounts') return ok([{ id: ACCOUNT, name: 'Fixture account' }, { id: 'not-an-account', name: 'Dropped' }]);
    if (p === `/accounts/${ACCOUNT}/workers/scripts`) return ok([{ id: 'fixture-app', tag: TAG, modified_on: '2026-10-30T09:00:00Z' }, { id: 'Bad Name', tag: TAG }]);
    if (p === `/accounts/${ACCOUNT}/builds/workers/${TAG}/builds`) return ok([FIXTURE_BUILD, { build_uuid: 'nope' }]);
    if (p === `/accounts/${ACCOUNT}/builds/builds/${BUILD}`) return ok(FIXTURE_BUILD);
    if (p === `/accounts/${ACCOUNT}/builds/builds/${BUILD}/logs`) {
      const cursor = url.searchParams.get('cursor');
      return cursor ? ok({ lines: [[NOW, 'second page']], truncated: false }) : ok({ lines: [[NOW, 'first page'], 'not a line'], cursor: 'c-2', truncated: true });
    }
    if (p === `/accounts/${ACCOUNT}/workers/observability/telemetry/query`) {
      if (call.body?.view === 'calculations') return ok({ calculations: [{ alias: 'requests', calculation: 'count', aggregates: [{ value: 41, count: 41 }, { value: 1, count: 1 }], series: [] }] });
      return ok({ events: { events: [FIXTURE_EVENT, { dataset: 'x' }] } });
    }
    return new Response(JSON.stringify({ success: false, errors: [{ code: 7003, message: 'fixture: no route' }] }), { status: 404 });
  }) as any;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

// ── 1. The adapter ───────────────────────────────────────────────────────

test('1. the adapter is api, runs seven reads and nothing else, with the provider\'s own connect, disconnect and revoke', () => {
  assert.equal(getConnectorAdapter('cloudflare'), cloudflareAdapter);
  const impl = getProviderImpl('cloudflare')!;
  assert.equal(cloudflareAdapter.pattern, 'api');
  assert.equal(cloudflareAdapter.connect, impl.connect);
  assert.equal(cloudflareAdapter.disconnect, impl.disconnect);
  assert.equal(cloudflareAdapter.revoke, impl.revokeGranted);
  assert.deepEqual(CLOUDFLARE_TOOLS.map((t) => t.name),
    ['list_accounts', 'list_workers', 'list_builds', 'get_build', 'get_build_logs', 'worker_errors', 'worker_requests']);
  assert.ok(Object.isFrozen(CLOUDFLARE_TOOLS));
  for (const t of CLOUDFLARE_TOOLS) {
    assert.equal(t.access, 'read', t.name);
    assert.equal(t.input_schema.additionalProperties, false, t.name);
    for (const field of Object.keys(t.input_schema.properties)) {
      assert.ok(['account', 'worker', 'build', 'script', 'hours', 'limit'].includes(field), `${t.name} takes no ${field}`);
    }
  }
});

test('1. connect takes no token: a member is told to sign in, a support session is refused', async () => {
  const app = new Hono<any>();
  app.post('/connect', async (c) => {
    try { await getProviderImpl('cloudflare')!.connect(c, { id: 1 } as any, { api_key: 'fixture-pasted-token' } as any); return c.json({ connected: true }); }
    catch (e) { const r = e as ConnectRefusal; return c.json({ status: r.status, code: r.code, sentence: r.sentence }); }
  });
  const env = { JWT_SECRET } as any;
  const s = stub();
  try {
    const plain = await (await app.request('/connect', { method: 'POST' }, env)).json();
    assert.deepEqual(plain, { status: 410, code: 'sign_in_only', sentence: SIGN_IN_ONLY });
    const jwt = await new SignJWT({ user_id: 1, impersonated_by: 9 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));
    const support = await (await app.request('/connect', { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } }, env)).json();
    assert.equal(support.status, 403);
    assert.equal(support.code, 'support_session_refused');
    assert.equal(s.calls.length, 0, 'nothing reaches Cloudflare');
  } finally { s.restore(); }
});

// ── 2. Never MCP ─────────────────────────────────────────────────────────

const srcFiles = () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
  walk('cloudflare-worker/src');
  return files;
};
/** A file's code without its comments. */
const codeOf = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Read whole DNS-shaped tokens, then compare parsed hostnames at label boundaries.
// The guard also covers a bare hostname constant, not only a complete URL.
const hostsIn = (text: string) => (text.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi) ?? [])
  .flatMap(host => {
    try { return [new URL(`https://${host}`).hostname]; }
    catch { return []; } // Dotted code expressions and version numbers are not hosts.
  });
const underHost = (host: string, root: string) => host === root || host.endsWith(`.${root}`);

test('2. hostname guards recognize the host and its subdomains without matching lookalikes', () => {
  for (const host of ['cloudflare.com', 'api.cloudflare.com', 'CLOUDFLARE.COM']) {
    assert.equal(hostsIn(`https://${host}/fixture`).some(value => underHost(value, 'cloudflare.com')), true);
  }
  for (const host of ['notcloudflare.com', 'cloudflare.com.example.invalid', 'cloudflare-com.example.invalid']) {
    assert.equal(hostsIn(`https://${host}/fixture`).some(value => underHost(value, 'cloudflare.com')), false);
  }
  assert.deepEqual(hostsIn('999.999.999'), []);
  assert.equal(hostsIn('const endpointHost = "mcp.cloudflare.com";').some(host => underHost(host, 'mcp.cloudflare.com')), true);
  assert.equal(hostsIn('https://observability.mcp.cloudflare.com/mcp').some(host => underHost(host, 'mcp.cloudflare.com')), true);
  assert.equal(hostsIn('https://mcp.cloudflare.com.example.invalid/mcp').some(host => underHost(host, 'mcp.cloudflare.com')), false);
});

test('2. no MCP record for Cloudflare, no Code Mode URL in the code, and only the REST base', () => {
  assert.equal(Object.hasOwn(MCP_PROVIDERS, 'cloudflare'), false);
  for (const [key, rec] of Object.entries(MCP_PROVIDERS)) {
    assert.equal(hostsIn(JSON.stringify(rec)).some(host => underHost(host, 'cloudflare.com')), false, `${key} names no Cloudflare host`);
  }
  for (const f of srcFiles()) assert.equal(hostsIn(codeOf(f)).some(host => underHost(host, 'mcp.cloudflare.com')), false, `${f} calls no Cloudflare MCP server`);
  assert.equal(CLOUDFLARE_API, 'https://api.cloudflare.com/client/v4');
  assert.equal(/\bexecute\(/.test(codeOf('cloudflare-worker/src/services/cloudflare/api.ts')), false);
});

// ── 3. The grant ─────────────────────────────────────────────────────────

test('3. a grant is held to read scopes', () => {
  assert.ok(Object.isFrozen(CLOUDFLARE_READ_SCOPES));
  for (const s of CLOUDFLARE_READ_SCOPES) assert.ok(s === 'offline_access' || s.endsWith(':read'), s);
  const reads = 'account:read workers:read workers_builds:read workers_observability:read';
  assert.deepEqual(checkGrantedScopes(`user:read ${reads} offline_access`),
    { ok: true, scopes: ['account:read', 'offline_access', 'user:read', 'workers:read', 'workers_builds:read', 'workers_observability:read'] });
  assert.deepEqual(checkGrantedScopes(`${reads} workers:write`), { ok: false, error: 'scope_overreach', extra: ['workers:write'] });
  assert.deepEqual(checkGrantedScopes(`${reads} workers_builds:edit`), { ok: false, error: 'scope_overreach', extra: ['workers_builds:edit'] });
  assert.deepEqual(checkGrantedScopes('account:read workers:read workers_builds:read'), { ok: false, error: 'scope_insufficient', extra: [] });
  assert.equal(checkGrantedScopes(null).ok, false);
});

// ── 4. Identifiers ───────────────────────────────────────────────────────

test('4. identifiers are checked before anything is sent', async () => {
  const s = stub();
  try {
    const reads = cloudflareReads('fixture-token', () => NOW);
    for (const attempt of [
      () => reads.listWorkers('../user/tokens'),
      () => reads.listBuilds(ACCOUNT, 'fixture-app'),
      () => reads.getBuild(ACCOUNT, `${BUILD}/../../x`),
      () => reads.getBuildLogs('A'.repeat(32), BUILD),
      () => reads.workerErrors(ACCOUNT, 'Fixture App'),
    ]) {
      await assert.rejects(attempt(), (e: unknown) => e instanceof CloudflareError && e.code === 'bad_id');
    }
    assert.equal(s.calls.length, 0);
  } finally { s.restore(); }
});

// ── 5. Named fields only ─────────────────────────────────────────────────

test('5. the reads keep named fields only, on fixed paths, with the member\'s token', async () => {
  const s = stub();
  try {
    const reads = cloudflareReads('fixture-token', () => NOW);
    assert.deepEqual(await reads.listAccounts(), [{ id: ACCOUNT, name: 'Fixture account' }]);
    assert.deepEqual(await reads.listWorkers(ACCOUNT), [{ name: 'fixture-app', tag: TAG, modified_at: '2026-10-30T09:00:00.000Z' }]);
    const builds = await reads.listBuilds(ACCOUNT, TAG, 5);
    assert.equal(builds.length, 1);
    assert.deepEqual(builds[0], {
      id: BUILD, status: 'stopped', outcome: 'fail', created_at: '2026-10-31T10:00:00.000Z', started_at: '2026-10-31T10:00:05.000Z',
      stopped_at: '2026-10-31T10:04:00.000Z', branch: 'main', commit: 'abcdef1234567', commit_message: 'Fixture change',
      repository: 'fixture/app', source: 'push_event',
    });
    const text = JSON.stringify([builds, await reads.getBuild(ACCOUNT, BUILD), await reads.workerErrors(ACCOUNT, 'fixture-app')]);
    for (const leak of ['fixture-env-value', 'fixture-secret', 'fixture-author', 'fixture-token-uuid', 'someone@example.test', 'fixture.example']) {
      assert.equal(text.includes(leak), false, `${leak} is never kept`);
    }
    assert.deepEqual(await reads.getBuildLogs(ACCOUNT, BUILD), {
      lines: [{ at: new Date(NOW).toISOString(), text: 'first page' }, { at: new Date(NOW).toISOString(), text: 'second page' }], truncated: false,
    });
    for (const c of s.calls) {
      assert.ok(c.url.startsWith('https://api.cloudflare.com/client/v4/accounts'), c.url);
      assert.equal(c.auth, 'Bearer fixture-token');
    }
    assert.ok(s.calls.some((c) => c.url.endsWith(`/builds/workers/${TAG}/builds?page=1&per_page=5`)));
    assert.ok(s.calls.some((c) => c.url.endsWith(`/builds/builds/${BUILD}/logs?cursor=c-2`)));
  } finally { s.restore(); }
});

test('5. a build log stops at its line cap and says it is truncated', async () => {
  const many = Array.from({ length: MAX_LOG_LINES + 5 }, (_, i) => [NOW, `line ${i}`]);
  const s = stub((c) => (c.url.includes('/logs') ? new Response(JSON.stringify({ success: true, result: { lines: many, cursor: 'c-2', truncated: true } })) : undefined));
  try {
    const out = await cloudflareReads('fixture-token').getBuildLogs(ACCOUNT, BUILD);
    assert.equal(out.lines.length, MAX_LOG_LINES);
    assert.equal(out.truncated, true);
  } finally { s.restore(); }
});

test('5. a log page with a cursor that is not truncated is the last page', async () => {
  const s = stub((c) => (c.url.includes('/logs') ? new Response(JSON.stringify({ success: true, result: { lines: [[NOW, 'only page']], cursor: 'c-2', truncated: false } })) : undefined));
  try {
    const out = await cloudflareReads('fixture-token').getBuildLogs(ACCOUNT, BUILD);
    assert.deepEqual(out, { lines: [{ at: new Date(NOW).toISOString(), text: 'only page' }], truncated: false });
    assert.equal(s.calls.length, 1);
  } finally { s.restore(); }
});

test('5. a valid log cursor continues when the optional truncated flag is absent', async () => {
  const s = stub((c) => {
    if (!c.url.includes('/logs')) return undefined;
    const next = new URL(c.url).searchParams.get('cursor');
    return new Response(JSON.stringify({ success: true, result: next
      ? { lines: [[NOW, 'last page']] }
      : { lines: [[NOW, 'first page']], cursor: 'c-2' } }));
  });
  try {
    const out = await cloudflareReads('fixture-token').getBuildLogs(ACCOUNT, BUILD);
    assert.deepEqual(out, { lines: [{ at: new Date(NOW).toISOString(), text: 'first page' }, { at: new Date(NOW).toISOString(), text: 'last page' }], truncated: false });
    assert.equal(s.calls.length, 2);
    assert.equal(new URL(s.calls[1].url).searchParams.get('cursor'), 'c-2');
  } finally { s.restore(); }
});

test('5. cursor-only pagination retains the page cap and reports an incomplete read', async () => {
  let page = 0;
  const s = stub((c) => (c.url.includes('/logs') ? new Response(JSON.stringify({ success: true, result: { lines: [[NOW, `page ${++page}`]], cursor: `c-${page + 1}` } })) : undefined));
  try {
    const out = await cloudflareReads('fixture-token').getBuildLogs(ACCOUNT, BUILD);
    assert.equal(s.calls.length, MAX_LOG_PAGES);
    assert.equal(out.lines.length, MAX_LOG_PAGES);
    assert.equal(out.truncated, true);
  } finally { s.restore(); }
});

test('5. an unusable log cursor preserves the provider truncation notice without another request', async () => {
  const s = stub((c) => (c.url.includes('/logs') ? new Response(JSON.stringify({ success: true, result: { lines: [[NOW, 'partial page']], cursor: '../invalid', truncated: true } })) : undefined));
  try {
    const out = await cloudflareReads('fixture-token').getBuildLogs(ACCOUNT, BUILD);
    assert.equal(out.lines.length, 1);
    assert.equal(out.truncated, true);
    assert.equal(s.calls.length, 1);
  } finally { s.restore(); }
});

test('5. an event keeps its time, level, status, trigger and error, never its URL', () => {
  assert.deepEqual(eventOf(FIXTURE_EVENT), {
    at: new Date(NOW - 60_000).toISOString(), level: 'error', status_code: 500, trigger: 'GET /checkout', error: 'TypeError: fixture',
  });
  assert.equal(eventOf({ dataset: 'x' }), null);
  assert.equal(buildOf({ build_uuid: 'nope' }), null);
});

// ── 6. The Observability query ───────────────────────────────────────────

test('6. the Observability queries are built here, for one Worker, over at most 72 hours', async () => {
  const q = errorsQuery('fixture-app', 500, NOW) as any;
  assert.equal(q.view, 'events');
  assert.deepEqual(q.parameters.filters.map((f: any) => [f.key, f.operation, f.value]),
    [['$metadata.service', 'eq', 'fixture-app'], ['$metadata.error', 'exists', undefined]]);
  assert.deepEqual(q.timeframe, { from: NOW - MAX_HOURS * 3_600_000, to: NOW });
  assert.equal((errorsQuery('fixture-app', 0, NOW) as any).timeframe.from, NOW - 3_600_000);
  const r = requestsQuery('fixture-app', 24, NOW) as any;
  assert.equal(r.view, 'calculations');
  assert.deepEqual(r.parameters.calculations, [{ operator: 'count', alias: 'requests' }]);
  assert.throws(() => errorsQuery('Bad Name', 1, NOW), (e: unknown) => e instanceof CloudflareError && e.code === 'bad_id');

  const s = stub();
  try {
    assert.deepEqual(await cloudflareReads('fixture-token', () => NOW).workerRequests(ACCOUNT, 'fixture-app', 6), { requests: 42, hours: 6 });
    const sent = s.calls.find((c) => c.method === 'POST')!;
    assert.ok(sent.url.endsWith(`/accounts/${ACCOUNT}/workers/observability/telemetry/query`));
    assert.deepEqual(sent.body.timeframe, { from: NOW - 6 * 3_600_000, to: NOW });
  } finally { s.restore(); }
});

// ── 7. Limits ────────────────────────────────────────────────────────────

test('7. Cloudflare\'s five-minute block is rate_limited, from the status or code 971, never a message', async () => {
  const a = errorOf(429, [], null);
  assert.equal(a.code, 'rate_limited');
  assert.equal(a.retry_after, CLOUDFLARE_BLOCK_SECONDS);
  assert.equal(CLOUDFLARE_BLOCK_SECONDS, 300);
  assert.equal(errorOf(429, [], '120').retry_after, 120);
  assert.equal(errorOf(400, [971], null).code, 'rate_limited');
  assert.equal(classifyCloudflareError(errorOf(400, [971], null)), 'rate_limited', 'code 971 is the block whatever its status');
  assert.equal(errorOf(403, [], null).code, 'unauthorized');
  assert.equal(errorOf(500, [], null).code, 'api_failed');

  const s = stub((c) => (c.url.endsWith('/accounts?per_page=50')
    ? new Response(JSON.stringify({ success: false, errors: [{ code: 971, message: 'fixture: Please wait' }] }), { status: 429 })
    : undefined));
  try {
    await assert.rejects(cloudflareReads('fixture-token').listAccounts(), (e: unknown) => {
      assert.ok(e instanceof CloudflareError);
      assert.equal(e.code, 'rate_limited');
      assert.equal(e.message.includes('Please wait'), false, 'no provider text');
      assert.equal(classifyCloudflareError(e), 'rate_limited');
      return true;
    });
  } finally { s.restore(); }

  assert.equal(classifyCloudflareError(new CloudflareError('unauthorized', 401)), 'auth');
  assert.equal(classifyCloudflareError(new CloudflareError('bad_id', 400)), 'invalid_input');
  assert.equal(classifyCloudflareError(new CloudflareError('network_error')), 'provider_down');
  assert.equal(classifyCloudflareError(new CloudflareError('api_failed', 503)), 'provider_down');
  assert.equal(classifyCloudflareError(new CloudflareError('not_found', 404)), 'not_found');
});

test('7. execute runs a read on the connection\'s own token, refuses an unknown tool or field, and a blocked token is degraded', async () => {
  const env = { JWT_SECRET, ENVIRONMENT: 'development' } as any;
  const uid = 'd855-cloudflare-1';
  const row = { id: 1, uid, provider_key: 'cloudflare', auth_type: 'oauth2', credentials_enc: await encryptCredentials(env, uid, { access_token: 'fixture-stored-token' }) } as any;
  const ctx = { env, row };
  await assert.rejects(cloudflareAdapter.execute('execute', {}, ctx), (e: unknown) => classifyCloudflareError(e) === 'not_found');
  await assert.rejects(cloudflareAdapter.execute('list_workers', { account: ACCOUNT, path: '/user/tokens' }, ctx), (e: unknown) => classifyCloudflareError(e) === 'invalid_input');
  await assert.rejects(cloudflareAdapter.execute('list_accounts', {}, { env, row: { ...row, provider_key: 'vercel' } }), (e: unknown) => classifyCloudflareError(e) === 'auth');

  let s = stub();
  try {
    const out = await cloudflareAdapter.execute('list_workers', { account: ACCOUNT }, ctx);
    assert.deepEqual(out.usage, { units: 1, provider_cost_microusd: null });
    assert.equal((out.result as any[])[0].name, 'fixture-app');
    assert.equal(s.calls[0].auth, 'Bearer fixture-stored-token');
    assert.deepEqual(await cloudflareAdapter.health(ctx), { state: 'ok', error_category: null });
  } finally { s.restore(); }

  s = stub(() => new Response(JSON.stringify({ success: false, errors: [{ code: 971 }] }), { status: 429 }));
  try {
    assert.deepEqual(await cloudflareAdapter.health(ctx), { state: 'degraded', error_category: 'rate_limited' });
  } finally { s.restore(); }
});

// ── 8. One door ──────────────────────────────────────────────────────────

test('8. only services/cloudflare/api.ts calls the Cloudflare API for a member', () => {
  const calling = srcFiles().filter((f) => /cloudflareReads\(|CLOUDFLARE_API\b/.test(codeOf(f)));
  assert.deepEqual(calling.sort(), ['cloudflare-worker/src/integrations/providers/cloudflare.ts', 'cloudflare-worker/src/services/cloudflare/api.ts']);
  const provider = codeOf('cloudflare-worker/src/integrations/providers/cloudflare.ts');
  assert.equal(/\bfetch\(/.test(provider), false, 'the provider never fetches itself');
});
