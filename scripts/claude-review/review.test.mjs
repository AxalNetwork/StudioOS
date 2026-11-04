/**
 * The effectful half of the advisory review, against the real SDK's error
 * classes and with no network: how an API failure is classified, that the
 * client is not built until it is used, that a path cannot leave the pull
 * request checkout, and that `main` reports a disabled or unconfigured review
 * without crashing and without printing the key.
 *
 * Needs this folder's own dependency: `npm ci --prefix scripts/claude-review`,
 * then `node --test scripts/claude-review/review.test.mjs`. The workflow's
 * `selftest` job runs it on every pull request; the pure rules are tested in
 * `../lib/claudeReview.test.mjs`, which the full suite runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { WorkloadIdentityError } from '@anthropic-ai/sdk/lib/credentials/types';
import { GithubIdentityError, LEDGER_MAX_PAGES, OIDC_AUDIENCE, openaiClient, openaiFetch, anthropicClient, classifyError, clientFor, errorDetail, fallbacksFor, githubClient, kimiClient, kimiFetch, githubIdentityToken, listMonthRecords, main, safePath } from './review.mjs';

const headers = new Headers({ 'request-id': 'req_test' });
const gen = (status) => Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message: 'm' } }, 'm', headers);

test('each SDK error class maps to the kind the runner explains', () => {
  const cases = [[400, 'bad_request'], [401, 'authentication'], [403, 'permission'], [404, 'not_found'], [429, 'rate_limit'], [500, 'server'], [529, 'overloaded'], [402, 'billing'], [418, 'unknown']];
  for (const [status, kind] of cases) {
    const e = classifyError(gen(status));
    assert.equal(e.kind, kind, `HTTP ${status}`);
    assert.equal(e.status, status);
  }
  assert.equal(classifyError(new Anthropic.APIConnectionTimeoutError()).kind, 'timeout');
  assert.equal(classifyError(new Anthropic.APIConnectionError({ message: 'down' })).kind, 'connection');
  assert.equal(classifyError(new Error('boom')).kind, 'unknown');
  assert.equal(classifyError(gen(401)).requestId, 'req_test');
});

test('the client is built on first use, so a run that never calls the API never constructs it', async () => {
  let built = 0;
  class CountingSdk {
    constructor() {
      built += 1;
      this.messages = { stream: (...args) => ({ finalMessage: () => this.messages.create(...args) }), create: async () => ({}), countTokens: async () => ({ input_tokens: 1 }) };
      this.beta = { messages: { stream: (...args) => ({ finalMessage: () => this.beta.messages.create(...args) }), create: async () => ({}) } };
    }
  }
  Object.assign(CountingSdk, Anthropic);
  const client = anthropicClient({ apiKey: undefined, maxRetries: 0, timeoutSeconds: 30, sdk: CountingSdk });
  assert.equal(built, 0, 'a disabled or unconfigured run builds no client');
  await client.countTokens({ model: 'm', system: 's', messages: [] });
  await client.create({ model: 'm' });
  assert.equal(built, 1, 'built once, then reused');
});

test('a request carrying betas goes to the beta endpoint, any other to the standard one', async () => {
  const seen = [];
  class FakeSdk {
    constructor() {
      this.messages = { stream: (...args) => ({ finalMessage: () => this.messages.create(...args) }), create: async () => { seen.push('messages'); return {}; }, countTokens: async (p) => { seen.push(Object.keys(p).sort().join(',')); return { input_tokens: 1 }; } };
      this.beta = { messages: { stream: (...args) => ({ finalMessage: () => this.beta.messages.create(...args) }), create: async () => { seen.push('beta'); return {}; } } };
    }
  }
  Object.assign(FakeSdk, Anthropic);
  const client = anthropicClient({ apiKey: 'k', maxRetries: 0, timeoutSeconds: 30, sdk: FakeSdk });
  await client.create({ model: 'm', betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  await client.create({ model: 'm' });
  await client.countTokens({ model: 'm', system: 's', messages: [], output_config: {} });
  assert.deepEqual(seen, ['beta', 'messages', 'messages,model,system']);
});

test('a path from the diff cannot leave the pull request checkout', () => {
  const root = '/work/pr';
  assert.equal(safePath(root, 'frontend/src/a.js'), '/work/pr/frontend/src/a.js');
  for (const bad of ['../secrets', '/etc/passwd', 'a/../../b', '', 'a\0b', '.']) assert.equal(safePath(root, bad), null, bad);
});

function sandbox(envOver) {
  const dir = mkdtempSync(join(tmpdir(), 'claude-review-'));
  const event = join(dir, 'event.json');
  writeFileSync(event, JSON.stringify({ pull_request: { number: 1, state: 'open', base: { sha: 'b'.repeat(40) }, head: { sha: 'a'.repeat(40), repo: { full_name: 'o/r' } }, user: { login: 'u' } } }));
  const summary = join(dir, 'summary.md');
  const output = join(dir, 'output.txt');
  writeFileSync(summary, '');
  writeFileSync(output, '');
  return {
    env: { GITHUB_EVENT_PATH: event, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output, GITHUB_REPOSITORY: 'o/r', CLAUDE_REVIEW_PR_DIR: dir, CLAUDE_REVIEW_OUT_DIR: join(dir, 'out'), ...envOver },
    read: () => ({ summary: readFileSync(summary, 'utf8'), output: readFileSync(output, 'utf8') }),
  };
}

test('main: a disabled review writes its summary and outputs and exits 0', async () => {
  const s = sandbox({ CLAUDE_REVIEW_ENABLED: 'false' });
  assert.equal(await main(s.env), 0);
  const { summary, output } = s.read();
  assert.match(summary, /\*\*Outcome:\*\* disabled/);
  assert.match(output, /^outcome=disabled\nrecord_name=\n$/);
});

test('main: an enabled review with no key is a configuration error, never a crash, and never prints a key', async () => {
  const s = sandbox({ CLAUDE_REVIEW_ENABLED: 'true', ANTHROPIC_MODEL: 'claude-sonnet-5-5', ANTHROPIC_API_KEY: '' });
  assert.equal(await main(s.env), 0);
  assert.match(s.read().summary, /configuration\\_error/);
  const k = sandbox({ CLAUDE_REVIEW_ENABLED: 'true', ANTHROPIC_API_KEY: 'sk-ant-should-not-appear', CLAUDE_REVIEW_FAIL_ON_ERROR: 'true' });
  assert.equal(await main(k.env), 1, 'with fail-on-error a configuration error fails the step');
  assert.doesNotMatch(k.read().summary, /sk-ant-should-not-appear/);
});

test('the ledger reads every page whatever order the API lists in, and says when the cap cut it off', async () => {
  const saved = globalThis.fetch;
  const rec = (month, n) => ({ name: `claude-review_v1_${month}_pr${n}_${'a'.repeat(16)}_ok_1000`, created_at: `${month}-0${(n % 9) + 1}T00:00:00Z`, expired: false });
  const pages = [
    [...Array.from({ length: 99 }, () => ({ name: 'other', created_at: '2026-08-01T00:00:00Z' })), rec('2026-09', 1)],
    [rec('2026-10', 2), rec('2026-10', 3)],
  ];
  const seen = [];
  globalThis.fetch = async (url) => {
    const page = Number(new URL(url).searchParams.get('page'));
    seen.push(page);
    return new Response(JSON.stringify({ artifacts: pages[page - 1] || [] }), { status: 200 });
  };
  try {
    const gh = githubClient({ apiUrl: 'https://api.example', token: 't', repository: 'o/r' });
    const listing = await gh.listArtifacts('2026-10-01T00:00:00Z');
    assert.deepEqual(seen, [1, 2], 'an older-first first page does not stop the listing');
    assert.equal(listing.complete, true);
    assert.deepEqual(listing.artifacts.map((a) => a.name.slice(17, 24)), ['2026-10', '2026-10']);
    seen.length = 0;
    globalThis.fetch = async () => new Response(JSON.stringify({ artifacts: Array.from({ length: 100 }, () => rec('2026-10', 4)) }), { status: 200 });
    assert.equal((await gh.listArtifacts('2026-10-01T00:00:00Z')).complete, false, 'stopped by the page cap is incomplete');
  } finally {
    globalThis.fetch = saved;
  }
});

// #4281: with more than 3,000 artifacts in the repository (3,272 on
// 2026-11-03), the cap alone cut every listing off, and every review was
// refused as "spend unreadable". The listing is in id order, newest first,
// with created_at drifting up to ~47 minutes from it (measured); it now ends
// a day past the month's start.
test('the ledger ends an id-ordered listing a day past the month\'s start, whatever created_at drifts', async () => {
  // Mutation checked: the early stop dropped → 60 pages read, cut off, incomplete;
  // the stop at the month's start itself (no day of margin) → the record whose
  // upload began before a later artifact's is missed.
  const since = '2026-11-01T00:00:00Z';
  const start = Date.parse('2026-11-03T12:00:00Z');
  // 60 pages, ids descending, one artifact every 10 minutes, created_at jittered by up to 45 minutes.
  const pages = Array.from({ length: 60 }, (_, p) => Array.from({ length: 100 }, (_, i) => {
    const n = p * 100 + i;
    const jitter = ((n * 37) % 91 - 45) * 60_000;
    const iso = new Date(start - n * 10 * 60_000 + jitter).toISOString().replace('.000', '');
    return { id: 1_000_000 - n, name: 'routing-docs', created_at: iso };
  }));
  // Two records: one early in the listing, one just after the month's start, behind an October artifact in id order.
  pages[0][3] = { id: pages[0][3].id, name: `claude-review_v1_2026-11_pr1_${'b'.repeat(16)}_ok_250000`, created_at: '2026-11-03T11:30:00Z' };
  // The page after the first October artifact: a stop at the month's start itself would never read it.
  const late = pages.findIndex((pg) => pg.some((a) => a.created_at < since)) + 1;
  pages[late][0] = { id: pages[late][0].id, name: `claude-review_v1_2026-11_pr2_${'c'.repeat(16)}_ok_300000`, created_at: '2026-11-01T00:20:00Z' };
  const seen = [];
  const listing = await listMonthRecords(async (page) => { seen.push(page); return { artifacts: pages[page - 1] }; }, since);
  assert.equal(listing.complete, true, 'the month is read in full, so the budget can be applied');
  assert.ok(seen.length < pages.length, `it stops early (read ${seen.length} of ${pages.length} pages)`);
  assert.deepEqual(listing.artifacts.map((a) => a.name.slice(25, 28)).sort(), ['pr1', 'pr2'], 'a record behind an older artifact in id order is still counted');
  assert.ok(pages.length > LEDGER_MAX_PAGES, 'more artifacts than the cap would ever read');
});

test('the ledger treats a reply with no artifact list as an error, never as the end of the month', async () => {
  // Mutation checked: the throw dropped → an error reply reads as a complete month with no spend.
  await assert.rejects(listMonthRecords(async () => ({ message: 'API rate limit exceeded' }), '2026-11-01T00:00:00Z'), /no artifact list/);
});

test('the ledger does not trust an order it has not seen: ids out of order read on to the cap', async () => {
  // Mutation checked: the id order check dropped → this listing stops at page 1 and calls itself complete.
  const since = '2026-11-01T00:00:00Z';
  const page1 = [{ id: 5, name: 'x', created_at: '2026-10-01T00:00:00Z' }, ...Array.from({ length: 99 }, (_, i) => ({ id: 10 + i, name: 'y', created_at: '2026-11-02T00:00:00Z' }))];
  const seen = [];
  const full = (p) => Array.from({ length: 100 }, (_, i) => ({ id: 100_000 - p * 100 - i, name: 'z', created_at: '2026-11-02T00:00:00Z' }));
  const listing = await listMonthRecords(async (page) => { seen.push(page); return { artifacts: page === 1 ? page1 : full(page) }; }, since);
  assert.equal(seen.length, LEDGER_MAX_PAGES, 'read on to the cap');
  assert.equal(listing.complete, false, 'and a listing the cap cut off is still incomplete, so the budget refuses');
});

test('a federation failure, from GitHub or from the exchange, is classified as such wherever it is wrapped', () => {
  const ex = new WorkloadIdentityError('Token exchange failed with status 401', 401, null, 'req_fed');
  assert.deepEqual([classifyError(ex).kind, classifyError(ex).status, classifyError(ex).requestId], ['federation', 401, 'req_fed']);
  const wrapped = new Anthropic.APIConnectionError({ message: 'auth', cause: ex });
  assert.equal(classifyError(wrapped).kind, 'federation', 'the SDK may wrap the exchange error');
  assert.equal(classifyError(new GithubIdentityError('no token')).kind, 'federation');
});

test('GitHub\'s identity token is fetched fresh, for the Anthropic audience, and a job without id-token cannot get one', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push([String(url), init.headers.Authorization]);
    return new Response(JSON.stringify({ value: `jwt-${seen.length}` }), { status: 200 });
  };
  const get = githubIdentityToken({ ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.example/req?api-version=2.0', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'rt' }, fetchImpl);
  assert.equal(await get(), 'jwt-1');
  assert.equal(await get(), 'jwt-2', 'a new token per exchange, never cached here');
  const u = new URL(seen[0][0]);
  assert.equal(u.searchParams.get('audience'), OIDC_AUDIENCE);
  assert.equal(u.searchParams.get('api-version'), '2.0');
  assert.equal(seen[0][1], 'bearer rt');
  await assert.rejects(githubIdentityToken({}, fetchImpl)(), (e) => e instanceof GithubIdentityError && /id-token: write/.test(e.message));
  const denied = githubIdentityToken({ ACTIONS_ID_TOKEN_REQUEST_URL: 'https://t.example/', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'rt' }, async () => new Response('no', { status: 403 }));
  await assert.rejects(denied(), (e) => e instanceof GithubIdentityError && /HTTP 403/.test(e.message));
});

test('under federation the client gets the exchange as its credentials and no API key, even with one in the environment', async () => {
  const made = [];
  class RecordingSdk {
    constructor(opts) {
      made.push(opts);
      this.messages = { stream: (...args) => ({ finalMessage: () => this.messages.create(...args) }), create: async () => ({}), countTokens: async () => ({ input_tokens: 1 }) };
      this.beta = { messages: { stream: (...args) => ({ finalMessage: () => this.beta.messages.create(...args) }), create: async () => ({}) } };
    }
  }
  Object.assign(RecordingSdk, Anthropic);
  const providers = [];
  const makeProvider = (cfg) => { providers.push(cfg); return async () => ({ token: 't', expiresAt: null }); };
  const identityToken = async () => 'jwt';
  const federation = { ruleId: 'fdrl_x', organizationId: 'org', serviceAccountId: 'svac_x', workspaceId: 'wrkspc_x' };
  const client = anthropicClient({ apiKey: 'sk-ant-in-env', federation, identityToken, maxRetries: 1, timeoutSeconds: 60, sdk: RecordingSdk, makeProvider });
  await client.create({ model: 'm' });
  assert.equal(made.length, 1);
  assert.equal(made[0].apiKey, null, 'an API key would outrank the federation credentials');
  assert.equal(made[0].authToken, null);
  assert.equal(typeof made[0].credentials, 'function');
  assert.deepEqual({ ...providers[0], fetch: undefined }, {
    identityTokenProvider: identityToken, federationRuleId: 'fdrl_x', organizationId: 'org', serviceAccountId: 'svac_x', workspaceId: 'wrkspc_x',
    baseURL: 'https://api.anthropic.com', fetch: undefined,
  });
  const keyed = anthropicClient({ apiKey: 'k', federation: null, maxRetries: 1, timeoutSeconds: 60, sdk: RecordingSdk, makeProvider });
  await keyed.create({ model: 'm' });
  assert.equal(made[1].apiKey, 'k');
  assert.equal(made[1].credentials, undefined);
  assert.equal(providers.length, 1, 'no exchange is set up for an API-key client');
});


test('the real SDK exchange sends the request the Console documents, with the GitHub token as the assertion', async () => {
  const { oidcFederationProvider } = await import('@anthropic-ai/sdk/lib/credentials/oidc-federation');
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ access_token: 'at', token_type: 'Bearer', expires_in: 600 }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const provider = oidcFederationProvider({
    identityTokenProvider: async () => 'github-jwt',
    federationRuleId: 'fdrl_01BkFJFKoPa1oFPY5ioQaCYp', organizationId: 'a984f1f6-6fd8-48ed-80d0-5d6d62f99ae4',
    serviceAccountId: 'svac_015m8nLD3vLGGRKzXxDZ3NTg', workspaceId: 'wrkspc_016CY9bjf724orWVvJzkJzde',
    baseURL: 'https://api.anthropic.com', fetch: fetchImpl,
  });
  await provider();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.anthropic.com/v1/oauth/token');
  assert.equal(sent[0].body.grant_type, 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.equal(sent[0].body.assertion, 'github-jwt');
  assert.equal(sent[0].body.federation_rule_id, 'fdrl_01BkFJFKoPa1oFPY5ioQaCYp');
  assert.equal(sent[0].body.organization_id, 'a984f1f6-6fd8-48ed-80d0-5d6d62f99ae4');
  assert.equal(sent[0].body.service_account_id, 'svac_015m8nLD3vLGGRKzXxDZ3NTg');
  assert.equal(sent[0].body.workspace_id, 'wrkspc_016CY9bjf724orWVvJzkJzde');
});

test('the run\'s client follows the repository variables: federation when its rule is set, else the key', async () => {
  const made = [];
  class RecordingSdk {
    constructor(opts) { made.push(opts); this.messages = { stream: (...args) => ({ finalMessage: () => this.messages.create(...args) }), create: async () => ({}) }; this.beta = { messages: { stream: (...args) => ({ finalMessage: () => this.beta.messages.create(...args) }), create: async () => ({}) } }; }
  }
  Object.assign(RecordingSdk, Anthropic);
  const makeProvider = (cfg) => Object.assign(async () => ({ token: 't' }), { cfg });
  const fed = { ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_01BkFJFKoPa1oFPY5ioQaCYp', ANTHROPIC_ORGANIZATION_ID: 'a984f1f6-6fd8-48ed-80d0-5d6d62f99ae4', ANTHROPIC_API_KEY: 'sk-ant-also-set', CLAUDE_REVIEW_MAX_RETRIES: '1' };
  await clientFor(fed, { sdk: RecordingSdk, makeProvider }).create({ model: 'm' });
  assert.equal(made[0].apiKey, null);
  assert.equal(made[0].credentials.cfg.federationRuleId, 'fdrl_01BkFJFKoPa1oFPY5ioQaCYp');
  assert.equal(made[0].maxRetries, 0);
  await clientFor({ ANTHROPIC_API_KEY: 'k' }, { sdk: RecordingSdk, makeProvider }).create({ model: 'm' });
  assert.equal(made[1].apiKey, 'k');
  assert.equal(made[1].credentials, undefined);
});


test('an API error carries what the API said, with anything credential-shaped removed', () => {
  const e = classifyError(Anthropic.APIError.generate(404, { type: 'error', error: { type: 'not_found_error', message: 'model: claude-x' } }, 'm', headers));
  assert.equal(e.detail, 'not_found_error: model: claude-x');
  const leaky = new Error('key sk-ant-api03-abcDEF_12 and Bearer tok.en.value and eyJhbGciOi.eyJzdWIiOi.c2ln\nend');
  assert.equal(errorDetail(leaky, null), 'key [redacted] and Bearer [redacted] and [redacted] end');
  assert.equal(errorDetail(new Error('x'.repeat(900)), null).length, 400);
  const fed = new WorkloadIdentityError('Token exchange failed with status 401: no rule matched', 401, '{}', 'req_x');
  const c = classifyError(new Anthropic.APIConnectionError({ message: 'wrapped', cause: fed }));
  assert.deepEqual([c.kind, c.status, c.requestId], ['federation', 401, 'req_x']);
  assert.equal(c.detail, 'Token exchange failed with status 401: no rule matched');
});

// A pull request checkout with a base and a head commit, so `main` gets as far
// as the API call with nothing faked but the network.
function checkout(dir) {
  const run = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  run('init', '-q');
  run('config', 'user.email', 't@example.test');
  run('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.js'), 'export const a = 1;\n');
  run('add', 'a.js');
  run('commit', '-q', '-m', 'base');
  const base = run('rev-parse', 'HEAD');
  writeFileSync(join(dir, 'a.js'), 'export const a = 2;\n');
  run('commit', '-q', '-am', 'head');
  return { base, head: run('rev-parse', 'HEAD') };
}

test('main: a refused token exchange is named in the log, a warning and the summary, and spends nothing', async () => {
  const s = sandbox({});
  const dir = s.env.CLAUDE_REVIEW_PR_DIR;
  const { base, head } = checkout(dir);
  writeFileSync(s.env.GITHUB_EVENT_PATH, JSON.stringify({ pull_request: { number: 7, state: 'open', title: 't', body: '', base: { sha: base, ref: 'main', repo: { full_name: 'o/r' } }, head: { sha: head, repo: { full_name: 'o/r' } }, user: { login: 'u' } } }));
  // A JWT-shaped test value, joined at runtime so no secret scanner reads one in this file.
  const jwt = ['eyJhbGciOiJSUzI1NiJ9', 'eyJzdWIiOiJyZXBvIn0', 'c2lnbmF0dXJl'].join('.');
  const savedFetch = globalThis.fetch;
  const savedWrite = process.stdout.write;
  const out = [];
  globalThis.fetch = async (url) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u.includes('/compare/')) return new Response(JSON.stringify({ merge_base_commit: { sha: base } }), { status: 200 });
    if (u.includes('/actions/artifacts')) return new Response(JSON.stringify({ artifacts: [] }), { status: 200 });
    if (u.includes('oidc')) return new Response(JSON.stringify({ value: jwt }), { status: 200 });
    if (u.endsWith('/v1/oauth/token')) {
      return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: `no federation rule matches subject repo:o/r:pull_request (assertion ${jwt})` } }), { status: 401, headers: { 'Request-Id': 'req_fed' } });
    }
    throw new Error(`unexpected request ${u}`);
  };
  process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
  let code;
  try {
    code = await main({
      ...s.env, GITHUB_API_URL: 'https://api.example', GITHUB_TOKEN: 'gh',
      CLAUDE_REVIEW_ENABLED: 'true', ANTHROPIC_MODEL: 'claude-sonnet-5-5', ANTHROPIC_API_KEY: '', CLAUDE_REVIEW_MAX_RETRIES: '0',
      ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_01BkFJFKoPa1oFPY5ioQaCYp', ANTHROPIC_ORGANIZATION_ID: 'a984f1f6-6fd8-48ed-80d0-5d6d62f99ae4',
      ANTHROPIC_SERVICE_ACCOUNT_ID: 'svac_015m8nLD3vLGGRKzXxDZ3NTg', ANTHROPIC_WORKSPACE_ID: 'wrkspc_016CY9bjf724orWVvJzkJzde',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.example/oidc?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'rt',
    });
  } finally {
    globalThis.fetch = savedFetch;
    process.stdout.write = savedWrite;
  }
  assert.equal(code, 0, 'advisory: an API error does not fail the step');
  const log = out.join('');
  const last = log.trim().split('\n').pop();
  assert.match(last, /^claude-review: api_error — GitHub's identity token could not be exchanged/);
  assert.match(last, /The API said: Token exchange failed with status 401 \(request-id req_fed\): .*no federation rule matches subject repo:o\/r:pull_request/);
  assert.match(log, /^::warning title=Claude review%3A api_error::.*Token exchange failed with status 401/m);
  assert.doesNotMatch(log, /eyJ/, 'the identity token never reaches the log');
  assert.match(s.read().summary, /The API said: Token exchange failed with status 401/);
  const record = JSON.parse(readFileSync(join(s.env.CLAUDE_REVIEW_OUT_DIR, 'record.json'), 'utf8'));
  assert.deepEqual([record.status, record.usd, record.error_kind, record.http_status], ['err', 0, 'federation', 401]);
  assert.match(record.error_detail, /no federation rule matches/);
  assert.doesNotMatch(JSON.stringify(record), /eyJ/);
});

test('main: an outcome whose reason can quote the pull request or the model keeps it out of the log', async () => {
  const s = sandbox({ CLAUDE_REVIEW_ENABLED: 'true', ANTHROPIC_MODEL: 'claude-sonnet-5-5', ANTHROPIC_API_KEY: 'k', GITHUB_API_URL: 'https://api.example' });
  const savedFetch = globalThis.fetch;
  const savedWrite = process.stdout.write;
  const out = [];
  globalThis.fetch = async () => new Response('{}', { status: 500 });
  process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
  try {
    await main(s.env);
  } finally {
    globalThis.fetch = savedFetch;
    process.stdout.write = savedWrite;
  }
  assert.equal(out.join(''), 'claude-review: diff_error\n');
  assert.match(s.read().summary, /diff could not be computed/);
});

test('the fallback chain: one client per configured step, built only when used, on its own key and endpoint', async () => {
  const built = [];
  class FakeSdk {
    constructor(opts) {
      built.push(opts);
      this.messages = { stream: (...args) => ({ finalMessage: () => this.messages.create(...args) }), create: async (p) => { if (p.model === 'gone') throw new Anthropic.NotFoundError(404, { error: { message: 'model gone' } }, 'model gone', new Headers()); return { ok: true }; } };
    }
  }
  for (const k of ['APIError', 'AuthenticationError', 'PermissionDeniedError', 'NotFoundError', 'RateLimitError', 'BadRequestError', 'APIConnectionTimeoutError', 'APIConnectionError', 'InternalServerError']) FakeSdk[k] = Anthropic[k];
  const env = { CLAUDE_REVIEW_ENABLED: 'true', ANTHROPIC_MODEL: 'claude-sonnet-5-5', ANTHROPIC_API_KEY: 'a', CLAUDE_REVIEW_MAX_RETRIES: '1' };
  assert.deepEqual(fallbacksFor(env), {}, 'no fallback key, no chain');
  assert.deepEqual(fallbacksFor({ ...env, KIMI_API_KEY: 'k', ANTHROPIC_API_KEY_2: 'b', CLAUDE_REVIEW_CREDIT_FALLBACK: 'off' }), {});
  const chain = fallbacksFor({ ...env, ANTHROPIC_API_KEY_2: 'sk-ant-second', KIMI_API_KEY: 'sk-kimi-key' }, { anthropic: { sdk: FakeSdk }, kimi: { sdk: FakeSdk } });
  assert.deepEqual(Object.keys(chain), ['claude2', 'kimi']);
  assert.equal(built.length, 0, 'nothing built until a review needs it');
  await chain.claude2.create({ model: 'claude-sonnet-5-5' });
  assert.equal(built[0].apiKey, 'sk-ant-second');
  assert.equal(built[0].baseURL, undefined, 'a Claude account goes to Anthropic');
  await chain.kimi.create({ model: 'kimi-k2-turbo-preview' });
  await chain.kimi.create({ model: 'kimi-k2-turbo-preview' });
  assert.equal(built.length, 2, 'each client built once');
  assert.deepEqual([built[1].apiKey, built[1].baseURL, built[1].maxRetries], ['sk-kimi-key', 'https://api.moonshot.ai/anthropic', 0]);
  await assert.rejects(chain.kimi.create({ model: 'gone' }), (e) => e.kind === 'not_found' && e.status === 404);
  assert.equal(built[1].authToken, null, 'no ANTHROPIC_AUTH_TOKEN reaches Moonshot');
  assert.equal(typeof built[1].fetch, 'function');
});

test('the Kimi fetch forwards only the request\'s own headers', async () => {
  let seen;
  const f = kimiFetch(async (url, init) => { seen = init.headers; return new Response('{}'); });
  await f('https://api.moonshot.ai/anthropic/v1/messages', { method: 'POST', headers: { 'x-api-key': 'k', 'content-type': 'application/json', 'anthropic-version': '2023-06-01', authorization: 'Bearer anthropic-token', 'x-custom': 'secret', 'x-stainless-retry-count': '0' } });
  assert.deepEqual([...seen.keys()].sort(), ['anthropic-version', 'content-type', 'x-api-key', 'x-stainless-retry-count']);
});

test('an error detail never carries a Kimi-style key', () => {
  assert.equal(errorDetail(new Error('bad key sk-AbCdEfGhIjKlMnOpQrStUv rejected'), null), 'bad key [redacted] rejected');
});


test('D4433: streaming returns final usage, forwards attempt options and classifies a mid-stream failure', async () => {
  const seen = [];
  const message = { content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 12, output_tokens: 8 } };
  class StreamSdk {
    constructor(options) {
      assert.equal(options.maxRetries, 0, 'runner owns retries');
      this.messages = { stream: (p, opts) => {
        seen.push({ p, opts });
        return { finalMessage: async () => { if (p.model === 'timeout') throw new Anthropic.APIConnectionTimeoutError(); return message; } };
      } };
      this.beta = { messages: this.messages };
    }
  }
  Object.setPrototypeOf(StreamSdk, Anthropic);
  const options = { timeout: 1234, signal: AbortSignal.timeout(2000), maxRetries: 0 };
  for (const client of [kimiClient({ apiKey: 'test', baseURL: 'https://example.test', maxRetries: 2, timeoutSeconds: 30, sdk: StreamSdk }), anthropicClient({ apiKey: 'test', maxRetries: 2, timeoutSeconds: 30, sdk: StreamSdk })]) {
    assert.equal(await client.create({ model: 'ok' }, options), message);
    assert.equal(seen.at(-1).opts, options);
    await assert.rejects(client.create({ model: 'timeout' }, options), e => e.kind === 'timeout');
  }
});


test('D4433 item 8: each fallback client receives only its own optional workspace header', async () => {
  const built = [];
  class WorkspaceSdk {
    constructor(opts) { built.push(opts); this.messages = { stream: () => ({ finalMessage: async () => ({}) }) }; }
  }
  const env = { ANTHROPIC_API_KEY_2: 'second', ANTHROPIC_API_KEY_3: 'third', ANTHROPIC_WORKSPACE_ID: 'wrkspc_MAIN0000', ANTHROPIC_WORKSPACE_ID_2: 'wrkspc_22222222', ANTHROPIC_WORKSPACE_ID_3: 'wrkspc_33333333', KIMI_API_KEY: 'kimi' };
  const clients = fallbacksFor(env, { anthropic: { sdk: WorkspaceSdk }, kimi: { sdk: WorkspaceSdk } });
  for (const id of ['claude2', 'claude3', 'kimi']) await clients[id].create({ model: 'test' });
  assert.equal(built[0].defaultHeaders['anthropic-workspace-id'], 'wrkspc_22222222');
  assert.equal(built[1].defaultHeaders['anthropic-workspace-id'], 'wrkspc_33333333');
  assert.equal(built[2].defaultHeaders, undefined, 'Kimi receives no Claude workspace header');
  assert.ok(!JSON.stringify(built).includes('MAIN0000'), 'main federation workspace is never reused');
  const unset = fallbacksFor({ ...env, ANTHROPIC_WORKSPACE_ID_2: '' }, { anthropic: { sdk: WorkspaceSdk } });
  await unset.claude2.create({ model: 'test' });
  assert.equal(built.at(-1).defaultHeaders['anthropic-workspace-id'], null, 'unset suppresses ambient workspace headers');
});

test('D4433 item 8: real SDK requests cannot inherit an ambient workspace from another account', async () => {
  const savedFetch = globalThis.fetch;
  const savedHeaders = process.env.ANTHROPIC_CUSTOM_HEADERS;
  const seen = [];
  process.env.ANTHROPIC_CUSTOM_HEADERS = 'Anthropic-Workspace-Id: wrkspc_AMBIENT0';
  globalThis.fetch = async (url, init) => {
    seen.push(new Headers(init.headers).get('anthropic-workspace-id'));
    return new Response(JSON.stringify({ input_tokens: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const clients = fallbacksFor({ ANTHROPIC_API_KEY_2: 'test-second', ANTHROPIC_API_KEY_3: 'test-third', ANTHROPIC_WORKSPACE_ID_2: 'wrkspc_22222222', ANTHROPIC_WORKSPACE_ID_3: 'wrkspc_33333333' });
    const p = { model: 'test-model', system: 's', messages: [] };
    await clients.claude2.countTokens(p);
    await clients.claude3.countTokens(p);
    const unset = fallbacksFor({ ANTHROPIC_API_KEY_2: 'test-second' });
    await unset.claude2.countTokens(p);
    assert.deepEqual(seen, ['wrkspc_22222222', 'wrkspc_33333333', null]);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedHeaders === undefined) delete process.env.ANTHROPIC_CUSTOM_HEADERS;
    else process.env.ANTHROPIC_CUSTOM_HEADERS = savedHeaders;
  }
});

test('D4443: fake SDK streams strict Responses output and maps cached usage once', async () => {
  const built = [], sent = [];
  class FakeOpenAI {
    constructor(options) {
      built.push(options);
      this.responses = { create: async function* (p, opts) {
        sent.push({ p, opts });
        yield { type: 'response.output_text.delta', delta: 'partial' };
        if (p.model === 'quota') throw new OpenAI.RateLimitError(429, { code: 'insufficient_quota', message: 'quota' }, 'quota', new Headers());
        if (p.model === 'timeout') throw new OpenAI.APIConnectionTimeoutError();
        if (p.model === 'failed') { yield { type: 'response.failed', response: { error: { code: 'insufficient_quota', message: 'no quota' } } }; return; }
        if (p.model === 'disconnected') return;
        yield { type: p.model === 'cut' ? 'response.incomplete' : 'response.completed', response: {
          status: p.model === 'cut' ? 'incomplete' : 'completed',
          output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: p.model === 'refuse' ? [{ type: 'refusal', refusal: 'no' }] : [{ type: 'output_text', text: '{"ok":true}' }] }],
          usage: { input_tokens: 100, output_tokens: 40, input_tokens_details: { cached_tokens: 60 } },
        } };
      } };
    }
  }
  Object.setPrototypeOf(FakeOpenAI, OpenAI);
  const client = openaiClient({ apiKey: 'unit-key', baseURL: 'https://api.example/v1', timeoutSeconds: 30, sdk: FakeOpenAI });
  assert.equal(built.length, 0);
  const opts = { timeout: 2000, maxRetries: 0 };
  const message = await client.create({ model: 'gpt-5.3-codex', system: 'system', messages: [{ role: 'user', content: 'diff' }], max_tokens: 1024 }, opts);
  assert.deepEqual(message.usage, { input_tokens: 40, output_tokens: 40, cache_read_input_tokens: 60, cache_creation_input_tokens: 0 });
  assert.deepEqual(message.content, [{ type: 'text', text: '{"ok":true}' }]);
  assert.equal(sent[0].p.stream, true);
  assert.equal(sent[0].p.store, false);
  assert.equal(sent[0].p.text.format.strict, true);
  assert.equal(sent[0].p.max_output_tokens, 1024);
  assert.equal(sent[0].p.instructions, 'system');
  assert.equal(sent[0].opts, opts);
  assert.equal(built[0].maxRetries, 0);
  assert.equal(built[0].organization, null);
  assert.equal(built[0].project, null);
  for (const [model, kind] of [['quota', 'billing'], ['failed', 'billing'], ['timeout', 'timeout'], ['disconnected', 'timeout']]) await assert.rejects(client.create({ model }), e => e.kind === kind);
  assert.equal((await client.create({ model: 'refuse' })).stop_reason, 'refusal');
  assert.equal((await client.create({ model: 'cut' })).stop_reason, 'max_tokens');
});

test('D4443: OpenAI fetch sends only allowlisted headers and its own key', async () => {
  let seen;
  const f = openaiFetch(async (url, init) => { seen = init.headers; return new Response('{}'); }, 'own-key');
  await f('https://api.example/v1/responses', { headers: { authorization: 'Bearer another-provider', 'x-api-key': 'another-key', 'openai-organization': 'ambient-org', 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'x-custom': 'hidden', 'x-stainless-retry-count': '0' } });
  assert.deepEqual([...seen.keys()].sort(), ['authorization', 'content-type', 'x-stainless-retry-count']);
  assert.equal(seen.get('authorization'), 'Bearer own-key');
});

test('D4443: OpenAI keys are redacted from classified errors', () => {
  const key = 'sk-' + 'proj-abcdefghijklmnopqrstuvwx';
  const error = new OpenAI.AuthenticationError(401, { message: `Incorrect API key ${key}` }, `Incorrect API key ${key}`, new Headers());
  const result = classifyError(error, OpenAI);
  assert.equal(result.kind, 'authentication');
  assert.match(result.detail, /redacted/);
  assert.ok(!result.detail.includes(key));
});

test('D4443: the OpenAI fallback uses a lazy separate official client', async () => {
  const built = [];
  class FakeOpenAI {
    constructor(opts) { built.push(opts); this.responses = { create: async function* () { yield { type: 'response.completed', response: { status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1 } } }; } }; }
  }
  const chain = fallbacksFor({ OPENAI_API_KEY: 'unit', OPENAI_MODEL: 'gpt-5.3-codex' }, { openai: { sdk: FakeOpenAI } });
  assert.deepEqual(Object.keys(chain), ['openai']);
  assert.equal(built.length, 0);
  await chain.openai.create({ model: 'gpt-5.3-codex' });
  assert.equal(built.length, 1);
  assert.equal(built[0].baseURL, 'https://api.openai.com/v1');
  assert.equal(built[0].apiKey, 'unit');
});
