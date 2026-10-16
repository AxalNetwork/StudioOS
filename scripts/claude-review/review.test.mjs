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
import { anthropicClient, classifyError, main, safePath } from './review.mjs';

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

test('the client is built on first use, so a missing key is the runner\'s error to report, not a crash', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const client = anthropicClient({ apiKey: undefined, maxRetries: 0, timeoutSeconds: 30 });
    assert.equal(typeof client.create, 'function');
    await assert.rejects(client.create({ model: 'm', max_tokens: 1, messages: [] }), (e) => typeof e.kind === 'string');
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
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
