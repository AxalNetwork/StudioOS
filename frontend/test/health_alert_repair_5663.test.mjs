// D5663: real episode effects exercised against paginated, fault-injected GitHub and Slack fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHealthMonitor, safeHealthFacts } from '../../scripts/health-alert-episodes.mjs';
import { webhookDelivery } from '../../scripts/health-alert-transport.mjs';
import { inspectTap, assessFutureClock } from '../../scripts/lib/futureClockEvidence.mjs';
import { produce } from '../../scripts/future-clock-producer.mjs';
import { ALERT_KINDS } from '../../scripts/lib/githubAlerts.mjs';
const kind = 'future-clock', repo = 'AxalNetwork/StudioOS';
const facts = { days: 7, failedCount: 1, runUrl: `https://github.com/${repo}/actions/runs/42996752605` };
const state = issue => JSON.parse(/<!-- studioos-health:v1 ([^\n]+) -->/.exec(issue.body)[1]);
function fixture(initial = []) {
  let rows = structuredClone(initial), calls = [], sent = [], clock = 10_000, failSaveAfterAck = false;
  let outcome = { state: 'acknowledged', receipt: { transport: 'webhook', status: 200 } };
  const api = async (path, init = {}) => {
    calls.push({ path, ...init }); const body = init.body && JSON.parse(init.body);
    if (init.method === 'POST') { const issue = { ...body, number: Math.max(0, ...rows.map(r => r.number)) + 1, state: 'open', user: { login: 'github-actions[bot]' } }; rows.push(issue); return structuredClone(issue); }
    if (init.method === 'PATCH') {
      if (failSaveAfterAck && body.body.includes('"acknowledged"')) { failSaveAfterAck = false; throw new Error('persist unavailable'); }
      const issue = rows.find(r => r.number === Number(path.split('/').at(-1)));
      for (const key of ['body', 'state', 'labels', 'title']) if (Object.hasOwn(body, key)) issue[key] = body[key];
      return structuredClone(issue);
    }
    const url = new URL(path, 'https://api.github.com'), page = Number(url.searchParams.get('page'));
    let list = rows.filter(r => url.searchParams.get('state') === 'all' || r.state === 'open');
    if (url.searchParams.has('labels')) list = list.filter(r => ['ci', 'observability'].every(n => (r.labels || []).includes(n)));
    return structuredClone(list.slice((page - 1) * 100, page * 100));
  };
  const make = () => createHealthMonitor({ repo, api, now: () => clock, deliver: async value => { sent.push(value); return outcome; } });
  return { api, make, rows, calls, sent, tick: n => clock += n, outcome: v => outcome = v, crashAck: () => failSaveAfterAck = true };
}
const legacy = number => ({ number, title: ALERT_KINDS[kind].title, body: 'Historical episode', state: 'open', labels: [], user: { login: 'github-actions[bot]' } });
test('simultaneous callbacks produce one episode/open and one recovery; unknown and old failure never reopen', async () => {
  const f = fixture(), monitor = f.make();
  await Promise.all([monitor.apply(kind, true, facts, 100), monitor.apply(kind, true, facts, 100)]);
  assert.equal(f.rows.length, 1); assert.equal(f.sent.length, 1); assert.deepEqual(f.rows[0].labels, ['ci', 'observability']);
  assert.deepEqual(JSON.parse(f.calls.find(c => c.method === 'POST').body).labels, ['ci', 'observability']);
  await monitor.apply(kind, null, {}, 101); assert.equal(f.rows[0].state, 'open');
  await Promise.all([monitor.apply(kind, false, facts, 102), monitor.apply(kind, false, facts, 102)]);
  assert.equal(f.rows[0].state, 'closed'); assert.deepEqual(f.sent.map(s => s.phase), ['open', 'recovery']);
  await monitor.apply(kind, true, facts, 101); assert.equal(f.rows.length, 1);
  await monitor.apply(kind, true, facts, 103); assert.equal(f.rows.length, 2); assert.equal(f.sent.length, 3);
});
test('pagination finds old incidents after 100 unrelated issues and adopts/collapses duplicates without replaying open', async () => {
  const f = fixture([...Array.from({ length: 102 }, (_, i) => ({ ...legacy(i + 1), title: 'unrelated' })), legacy(103), legacy(104)]);
  await f.make().apply(kind, true, facts, 100);
  assert.equal(f.rows[102].state, 'open'); assert.equal(f.rows[103].state, 'closed');
  assert.deepEqual(state(f.rows[102]).duplicates, [104]); assert.equal(state(f.rows[103]).duplicateOf, 103);
  assert.equal(f.sent.length, 0); assert.ok(f.calls.some(c => c.path.includes('page=2')));
  assert.equal(state(f.rows[102]).intents[0].state, 'ambiguous');
});
test('429 and 5xx intent survives restart and recovery retains its own evidence', async () => {
  const f = fixture(); f.outcome({ state: 'retry', code: 'rate_limited', retryAfterMs: 5000 });
  await f.make().apply(kind, true, facts, 100); assert.equal(state(f.rows[0]).intents[0].state, 'retry');
  await f.make().apply(kind, true, facts, 100); assert.equal(f.sent.length, 1);
  f.tick(5000); f.outcome({ state: 'retry', code: 'provider_unavailable' }); await f.make().apply(kind, true, facts, 100);
  assert.equal(state(f.rows[0]).intents[0].attempts, 2);
  f.tick(10000); f.outcome({ state: 'acknowledged', receipt: { transport: 'webhook', status: 200 } });
  await f.make().apply(kind, false, { ...facts, runUrl: `https://github.com/${repo}/actions/runs/42996752606` }, 101);
  assert.match(f.sent.at(-2).text, /42996752605/); assert.match(f.sent.at(-1).text, /42996752606/);
  assert.deepEqual(state(f.rows[0]).intents.map(i => i.state), ['acknowledged', 'acknowledged']);
});
test('crash after issue write retries pending; crash after accepted Slack is ambiguous and is never falsely acknowledged', async () => {
  const f = fixture(); let writes = 0;
  const failing = createHealthMonitor({ repo, api: async (...args) => { if (args[1]?.method === 'PATCH' && ++writes === 1) throw new Error('crash'); return f.api(...args); }, deliver: () => { throw new Error('must not reach'); } });
  await assert.rejects(failing.apply(kind, true, facts, 100)); assert.equal(f.rows.length, 1); assert.equal(state(f.rows[0]).intents[0].state, 'pending');
  f.crashAck(); await assert.rejects(f.make().apply(kind, true, facts, 100)); assert.equal(f.sent.length, 1);
  await f.make().apply(kind, true, facts, 100); assert.equal(state(f.rows[0]).intents[0].state, 'ambiguous'); assert.equal(f.sent.length, 1);
});
test('permission failure is visible and cannot emit Slack or infer recovery; unsafe content is excluded', async () => {
  let sent = 0; const monitor = createHealthMonitor({ repo, api: async () => { throw new Error('github_http_401'); }, deliver: () => sent++ });
  await assert.rejects(monitor.apply(kind, false, facts, 100), /401/); assert.equal(sent, 0);
  const value = safeHealthFacts({ title: '<!channel>', failures: { names: ['secret'] }, runUrl: 'https://evil.example/', outcome: '<@U1>', sha: 'bad', pr: 'x' });
  assert.deepEqual(value, {});
  assert.match(safeHealthFacts({ fingerprint: 'suite (worker-1-of-6)/Run actions/setup-node@v6' }).fingerprint, /setup-node at v6/);
  const child = spawnSync(process.execPath, ['scripts/github-alerts.mjs', 'future-clock'], { encoding: 'utf8', env: { ...process.env, GITHUB_REPOSITORY: repo, GITHUB_TOKEN: '' } });
  assert.equal(child.status, 1); assert.match(child.stderr, /no recovery inferred/);
  const preload = 'data:text/javascript,' + encodeURIComponent("globalThis.fetch = async () => new Response('', { status: 401 });");
  const denied = spawnSync(process.execPath, ['--import', preload, 'scripts/github-alerts.mjs', 'future-clock'], { encoding: 'utf8', env: { ...process.env, GITHUB_REPOSITORY: repo, GITHUB_TOKEN: 'fixture-not-a-token', GITHUB_RUN_ID: '42996752605', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'a'.repeat(40) } });
  assert.equal(denied.status, 1); assert.match(denied.stderr, /no recovery inferred/); assert.doesNotMatch(denied.stderr, /fixture-not-a-token/); assert.doesNotMatch(child.stderr, /undefined|Bearer/);
});
test('legacy webhook acknowledges only ok; HTTP200 errors, revoked destination, 429, 5xx and timeout stay explicit', async () => {
  const url = 'https://hooks.slack.com/services/fake/fake/fake';
  const send = response => webhookDelivery({ url, fetchImpl: async () => response })({ text: 'fixture' });
  assert.equal((await send(new Response('ok'))).state, 'acknowledged');
  assert.equal((await send(new Response('{"ok":false}'))).state, 'dead');
  assert.equal((await send(new Response('revoked', { status: 403 }))).state, 'dead');
  assert.deepEqual(await send(new Response('', { status: 429, headers: { 'retry-after': '3' } })), { state: 'retry', code: 'rate_limited', retryAfterMs: 3000 });
  assert.equal((await send(new Response('', { status: 503 }))).state, 'retry');
  assert.equal((await webhookDelivery({ url, fetchImpl: async () => { throw new Error('accepted then timeout'); } })({ text: 'fixture' })).state, 'ambiguous');
});
const tap = fail => `TAP version 13\n${fail ? 'not ok' : 'ok'} 1 - fixture\n1..1\n# tests 1\n# suites 0\n# pass ${fail ? 0 : 1}\n# fail ${fail ? 1 : 0}\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 10\n`;
const sha = 'a'.repeat(40), expected = ['frontend-1-of-2', 'worker-1-of-6'];
const blob = (part, fail = false) => ({ part, tap: tap(fail), manifest: { schema: 1, part, runId: '42996752605', attempt: 1, sha, days: 7, exitCode: fail ? 1 : 0, bytes: Buffer.byteLength(tap(fail)), sha256: createHash('sha256').update(tap(fail)).digest('hex') } });
const evidence = blobs => ({ expected, blobs, runId: '42996752605', attempt: 1, sha, jobs: expected.map(part => ({ name: `future clock (${part})`, status: 'completed', conclusion: 'success', steps: [{ name: 'Run the part 7 days ahead', status: 'completed', conclusion: 'success' }] })) });
test('only complete executed same-attempt TAP recovers; partial verified failure may open but cannot recover', () => {
  const all = expected.map(p => blob(p)); assert.equal(assessFutureClock(evidence(all)).active, false);
  assert.equal(assessFutureClock(evidence([blob(expected[0], true)])).active, true);
  assert.equal(assessFutureClock(evidence([blob(expected[0])])).active, null);
  for (const mutate of [x => x.blobs[0].tap += 'corrupt', x => x.blobs[0].manifest.sha256 = '0'.repeat(64), x => x.blobs[0].manifest.attempt++, x => x.blobs[0].manifest.exitCode = 1, x => x.blobs[0].manifest.sha = 'b'.repeat(40), x => x.jobs[0].steps = [], x => x.jobs[0].conclusion = 'failure', x => x.blobs.push(x.blobs[0])]) {
    const x = evidence(expected.map(p => blob(p))); mutate(x); const result = assessFutureClock(x); assert.equal(result.active, null, JSON.stringify(result)); assert.equal(result.complete, false);
  }
  for (const incomplete of ['', 'not ok 1 - partial', tap(false).replace('1..1\n', ''), tap(false).replace('# fail 0\n', ''), tap(false) + tap(false), tap(false).replace('ok 1', 'ok 2'), tap(false).replace('# skipped 0', '# skipped 1')]) assert.equal(inspectTap(incomplete).state, 'unknown');
  assert.equal(inspectTap(tap(true)).state, 'failure');
});
test('producer records the actual child exit and digest atomically without swallowing clock verification', () => {
  const dir = mkdtempSync(join(tmpdir(), 's38-fc-'));
  try {
    const env = { ...process.env, RUNNER_TEMP: dir, GITHUB_RUN_ID: '42996752605', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: sha, FUTURE_CLOCK_DAYS: '7' };
    const result = produce('frontend-1-of-2', env, (cmd, args, options) => { assert.deepEqual(args, ['scripts/test-drift-parts.mjs', 'frontend-1-of-2', '--plan-file', 'suite-plan.json']); writeFileSync(options.stdio[1], tap(true)); renameSync(join(dir, 'future-clock/future-clock.tap'), join(dir, 'future-clock/original.tap')); writeFileSync(join(dir, 'future-clock/future-clock.tap'), tap(false)); return { status: 1 }; });
    assert.equal(result.exitCode, 1); assert.equal(result.sha256, blob('frontend-1-of-2', true).manifest.sha256);
    assert.equal(JSON.parse(readFileSync(join(dir, 'future-clock/manifest.json'))).runId, '42996752605');
    assert.throws(() => produce('worker-1-of-6', { ...env, FUTURE_CLOCK_DAYS: '0' }), /identity/);
  } finally { rmSync(dir, { recursive: true }); }
});
test('trusted report has explicit token, minimal write permissions and fixed detector serialization; producers remain isolated', () => {
  const wf = readFileSync('.github/workflows/github-alerts.yml', 'utf8'), producers = wf.split('  future-clock-part:\n')[1].split('  future-clock:\n')[0], reporter = wf.split('  future-clock:\n')[1];
  assert.doesNotMatch(producers, /issues: write|SLACK_GITHUB_WEBHOOK|GITHUB_TOKEN/);
  assert.match(reporter, /contents: read\n\s+actions: read\n\s+issues: write/); assert.match(reporter, /GITHUB_TOKEN: \$\{\{ github.token \}\}/);
  assert.doesNotMatch(reporter, /cat .*tap|\|\| true/);
  for (const detector of ['main-red', 'queue', 'future-clock']) assert.ok(wf.includes(`group: github-health-${detector}\n`));
  assert.match(readFileSync('.github/workflows/claude-review.yml', 'utf8'), /group: github-health-review-blocked/);
});

test('TAP completeness accepts actual Node output for both green and assertion failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 's38-real-tap-'));
  try {
    const file = join(dir, 'fixture.test.mjs');
    for (const fail of [false, true]) {
      writeFileSync(file, `import test from 'node:test'; import assert from 'node:assert/strict'; test('fixture', () => assert.equal(${fail ? 1 : 2}, 2));`);
      const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
      const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { encoding: 'utf8', env });
      assert.equal(child.status, fail ? 1 : 0);
      assert.equal(inspectTap(child.stdout).state, fail ? 'failure' : 'green');
    }
  } finally { rmSync(dir, { recursive: true }); }
});

test('a queue response without count or oldest evidence cannot mutate its episode', () => {
  const issue = { number: 7, title: ALERT_KINDS.queue.title, state: 'open', body: '', labels: [], user: { login: 'github-actions[bot]' } };
  for (const queue of [{ workflow_runs: [] }, { total_count: 1, workflow_runs: [] }]) {
    const code = "const {issue, queue} = JSON.parse(process.env.S38_QUEUE_FIXTURE); globalThis.fetch = async (url, init={}) => { if (init.method && init.method !== 'GET') { console.log('UNEXPECTED_MUTATION'); return Response.json(issue); } return Response.json(String(url).includes('/issues?') ? [issue] : queue); };";
    const preload = 'data:text/javascript,' + encodeURIComponent(code);
    const result = spawnSync(process.execPath, ['--import', preload, 'scripts/github-alerts.mjs', 'queue'], { encoding: 'utf8', env: { ...process.env, GITHUB_REPOSITORY: repo, GITHUB_TOKEN: 'fixture', S38_QUEUE_FIXTURE: JSON.stringify({issue, queue}) } });
    assert.equal(result.status, 1); assert.match(result.stderr, /no recovery inferred/); assert.doesNotMatch(result.stdout, /UNEXPECTED_MUTATION/);
  }
});

test('producer refuses a missing planner contract before starting any test child', () => {
  const dir = mkdtempSync(join(tmpdir(), 's38-plan-contract-'));
  try {
    const hook = `import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module'; cp.spawnSync=()=>{console.log('UNEXPECTED_CHILD');return {status:0}};syncBuiltinESMExports();`;
    const result = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(hook), 'scripts/future-clock-producer.mjs', 'frontend-1-of-2'], { encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: dir, GITHUB_RUN_ID: '42996752605', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: sha, FUTURE_CLOCK_DAYS: '7' } });
    assert.equal(result.status, 1); assert.doesNotMatch(result.stdout, /UNEXPECTED_CHILD/); assert.match(result.stderr, /producer evidence unavailable/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('complete TAP can prove a failure even when a different test did not execute; partial evidence never recovers', () => {
  const partial = blob(expected[0], true);
  partial.tap = 'TAP version 13\nnot ok 1 - failed\nok 2 - unavailable # SKIP\n1..2\n# tests 2\n# suites 0\n# pass 0\n# fail 1\n# cancelled 0\n# skipped 1\n# todo 0\n# duration_ms 10\n';
  partial.manifest.bytes = Buffer.byteLength(partial.tap); partial.manifest.sha256 = createHash('sha256').update(partial.tap).digest('hex');
  const result = assessFutureClock(evidence([partial, blob(expected[1])])); assert.equal(result.active, true); assert.equal(result.failed, 1); assert.equal(result.complete, false); assert.equal(result.state, 'incomplete');
  for (const exitCode of [-1, 256]) { const invalid = blob(expected[0], true); invalid.manifest.exitCode = exitCode; assert.equal(assessFutureClock(evidence([invalid, blob(expected[1])])).active, null); }
});
