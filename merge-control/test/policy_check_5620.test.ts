/** D5620: one bundled classifier, an injected policy_version and a fail-closed evaluate({base, head}). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { classify as sharedClassify } from '../src/lib/classify.mjs';
import { classify, POLICY_VERSION, readPolicyVersion } from '../src/policy.ts';
import { COMPARE_FILE_CAP, evaluate } from '../src/policyCheck.ts';
import { comparePath, githubClient } from '../src/github.ts';
import type { Env, GithubApi } from '../src/types.ts';

const base = 'a'.repeat(40), head = 'b'.repeat(40);
const hunk = (...lines: string[]) => ['@@ -1 +1 @@', ...lines].join('\n');
const entry = (filename: string, status = 'modified', extra: Record<string, unknown> = {}) =>
  ({ filename, status, patch: hunk('-old', '+new'), ...extra });
const compare = (files: unknown[]): GithubApi => async (method, path) => {
  assert.equal(method, 'GET');
  assert.equal(path, `compare/${base}...${head}`);
  return { status: 'ahead', files };
};
const run = (api: GithubApi, timeoutMs?: number) => evaluate({ base, head }, { api, ...(timeoutMs ? { timeoutMs } : {}) });
const never = (result: { conclusion: string; tier: string }, label: string) => {
  assert.equal(result.conclusion, 'action_required', label);
  assert.equal(result.tier, 'T2', label);
};

test('policy.ts bundles the one classifier that scripts/merge-policy.mjs re-exports', () => {
  assert.equal(classify, sharedClassify);
  const script = readFileSync('scripts/merge-policy.mjs', 'utf8');
  assert.match(script, /^import \{ classify \} from '\.\.\/merge-control\/src\/lib\/classify\.mjs';$/m);
  assert.match(script, /^export \{ classify \};$/m);
  // The script keeps only its Git adapter: no second copy of any rule.
  assert.doesNotMatch(script, /function (?:classify|pathPolicy|changedLines)\b|\bconst (?:SENSITIVE|TEST|ORDINARY|LEAF_UI)\b/);
  const shared = readFileSync('merge-control/src/lib/classify.mjs', 'utf8');
  assert.doesNotMatch(shared, /^\s*import\b|\brequire\(|\bfetch\(|anthropic|openai/im);
  const policy = readFileSync('merge-control/src/policy.ts', 'utf8');
  assert.doesNotMatch(policy, /\bfetch\(|anthropic|openai|env\.AI\b/i);
});

test('policy_version is the injected commit and a build without it is refused', async () => {
  assert.equal(POLICY_VERSION, (globalThis as { MERGE_CONTROL_POLICY_VERSION?: string }).MERGE_CONTROL_POLICY_VERSION);
  for (const value of [undefined, '', 'main', 'unknown', 'a'.repeat(39), 'A'.repeat(40), 123]) {
    assert.throws(() => readPolicyVersion(value), /build refused/, String(value));
  }
  const globals = globalThis as { MERGE_CONTROL_POLICY_VERSION?: string };
  const saved = globals.MERGE_CONTROL_POLICY_VERSION;
  delete globals.MERGE_CONTROL_POLICY_VERSION;
  try {
    await assert.rejects(import('../src/policy.ts?unset'), /build refused/);
  } finally { globals.MERGE_CONTROL_POLICY_VERSION = saved; }
  const deploy = readFileSync('.github/workflows/merge-control-deploy.yml', 'utf8');
  assert.match(deploy, /--define "MERGE_CONTROL_POLICY_VERSION:\\"\$GITHUB_SHA\\""/);
  assert.match(deploy, /\^\[a-f0-9\]\{40\}\$/);
  assert.doesNotMatch(readFileSync('wrangler.merge-control.toml', 'utf8'), /MERGE_CONTROL_POLICY_VERSION/);
});

test('T0 and T1 compare lists pass and carry policy_version', async () => {
  const t0 = await run(compare([entry('documentation/operations/guide.md'), entry('frontend/src/components/Button.jsx')]));
  assert.deepEqual([t0.conclusion, t0.tier, t0.policy_version, t0.base, t0.head], ['success', 'T0', POLICY_VERSION, base, head]);
  const t1 = await run(compare([entry('documentation/guide.md'), entry('frontend/src/pages/Example.jsx')]));
  assert.deepEqual([t1.conclusion, t1.tier], ['success', 'T1']);
  const added = await run(compare([entry('frontend/test/new.test.mjs', 'added', { patch: hunk('+test("x", () => {});') })]));
  assert.equal(added.conclusion, 'success');
});

test('a migration diff, a deleted or renamed test and a weakened test are not passing', async () => {
  const cases: [unknown[], RegExp][] = [
    [[entry('documentation/guide.md'), entry('cloudflare-worker/sql/migrations/202611140000_5989_example.sql', 'added')], /protected path: cloudflare-worker\/sql\//],
    [[entry('frontend/test/example.test.mjs', 'removed')], /Test deleted or renamed/],
    [[entry('documentation/example.md', 'renamed', { previous_filename: 'frontend/test/example.test.mjs' })], /Test deleted or renamed/],
    [[entry('frontend/test/example.test.mjs', 'modified', { patch: hunk('-assert.equal(got, want);') })], /assertion count dropped/],
    [[entry('frontend/test/example.test.mjs', 'added', { patch: hunk("+test.skip('x', () => {});") })], /skip, todo or only/],
  ];
  for (const [files, reason] of cases) {
    const result = await run(compare(files));
    never(result, String(reason));
    assert.match(result.reasons.join('\n'), reason);
  }
});

test('a list at the 300-file cap, a missing patch and a malformed response are never success', async () => {
  const docs = (n: number) => Array.from({ length: n }, (_, i) => entry(`documentation/page-${i}.md`));
  assert.equal(COMPARE_FILE_CAP, 300);
  assert.equal((await run(compare(docs(299)))).conclusion, 'success');
  const capped = await run(compare(docs(300)));
  never(capped, 'cap');
  assert.match(capped.reasons.join('\n'), /300-file cap/);
  never(await run(compare(docs(301))), 'over cap');
  for (const patch of [undefined, '', null]) {
    const result = await run(compare([entry('documentation/guide.md'), { ...entry('documentation/blob.png', 'added'), patch }]));
    never(result, `patch ${String(patch)}`);
    assert.match(result.reasons.join('\n'), /no patch in the compare response: documentation\/blob\.png/);
  }
  for (const response of [null, {}, { files: 'x' }, { files: [null] }, { files: [{ status: 'modified', patch: hunk('+x') }] },
    { files: [entry('documentation/guide.md', 'changed')] }, { files: [entry('documentation/guide.md', 'unchanged')] },
    { files: [entry('documentation/guide.md', 'renamed')] }, { files: [] }]) {
    never(await run(async () => response), JSON.stringify(response));
  }
});

test('API errors, exceptions, timeouts and bad input never return success', async () => {
  const notFound = await run(async () => { throw Object.assign(new Error('GitHub HTTP 404'), { status: 404 }); });
  never(notFound, '404');
  assert.match(notFound.reasons.join('\n'), /GitHub compare unavailable \(HTTP 404\)/);
  never(await run(async () => { throw new TypeError('network'); }), 'network');
  never(await run((() => { throw new Error('sync'); }) as unknown as GithubApi), 'sync throw');
  const stalled = await run(() => new Promise(() => {}), 20);
  never(stalled, 'timeout');
  assert.match(stalled.reasons.join('\n'), /exceeded 20 ms/);
  const late = await run(() => new Promise((done) => setTimeout(() => done({ files: [entry('documentation/guide.md')] }), 60)), 20);
  never(late, 'late success');
  const poisoned = { files: [{ get filename() { throw new Error('poisoned'); } }] };
  never(await run(async () => poisoned), 'getter throws');
  let calls = 0;
  const counting: GithubApi = async () => { calls++; return { files: [entry('documentation/guide.md')] }; };
  for (const input of [{ base: 'main', head }, { base, head: 'b'.repeat(39) }, { base: base.toUpperCase(), head }]) {
    never(await evaluate(input, { api: counting }), JSON.stringify(input));
  }
  never(await evaluate(undefined as unknown as { base: string; head: string }, { api: counting }), 'no input');
  for (const timeoutMs of [0, -1, Number.NaN, 1.5, 60_000]) never(await run(counting, timeoutMs || -1), `timeout ${timeoutMs}`);
  never(await evaluate({ base, head }, undefined as unknown as { api: GithubApi }), 'no options');
  assert.equal(calls, 0);
});

test('the installation client allows only the exact three-dot compare path and bounds each request', async () => {
  assert.equal(comparePath(base, head), `compare/${base}...${head}`);
  assert.throws(() => comparePath('main', head), /full commit SHAs/);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const env = { REPOSITORY: 'AxalNetwork/StudioOS', GITHUB_APP_ID: '1', GITHUB_INSTALLATION_ID: '2',
    GITHUB_APP_PRIVATE_KEY: privateKey.export({ format: 'pem', type: 'pkcs1' }).toString() } as Env;
  const urls: string[] = [];
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/access_tokens')) return Response.json({ token: 'test-installation-token' });
    urls.push(String(url));
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json({ files: [entry('documentation/guide.md')] });
  };
  const api = await githubClient(env, fetcher as typeof fetch);
  const result = await evaluate({ base, head }, { api });
  assert.equal(result.conclusion, 'success');
  assert.deepEqual(urls, [`https://api.github.com/repos/AxalNetwork/StudioOS/compare/${base}...${head}`]);
  for (const path of [`compare/${base}..${head}`, `compare/${base}...${head}/../x`, `compare/main...${head}`, '../x']) {
    await assert.rejects(api('GET', path), /invalid path/, path);
  }
  const failing = await githubClient(env, (async (url: string | URL | Request) =>
    String(url).endsWith('/access_tokens') ? Response.json({ token: 't' }) : new Response('gone', { status: 502 })) as typeof fetch);
  never(await evaluate({ base, head }, { api: failing }), '502');
});
