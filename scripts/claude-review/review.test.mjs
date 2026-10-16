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
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { anthropicClient, classifyError, githubClient, main, safePath } from './review.mjs';

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
      this.messages = { create: async () => ({}), countTokens: async () => ({ input_tokens: 1 }) };
      this.beta = { messages: { create: async () => ({}) } };
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
      this.messages = { create: async () => { seen.push('messages'); return {}; }, countTokens: async (p) => { seen.push(Object.keys(p).sort().join(',')); return { input_tokens: 1 }; } };
      this.beta = { messages: { create: async () => { seen.push('beta'); return {}; } } };
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
