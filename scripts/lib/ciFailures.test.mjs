/** D5502: identity, missing evidence, archive, cancellation and real runner exit regressions. */
/** D5502: exact-base failure evidence regression cases. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identity, compareEvidence, failureReport, renderEvidence } from './ciFailures.mjs';
const sha = 'a'.repeat(40), other = 'b'.repeat(40);
const failure = (name = 'refund is idempotent', part = 'worker-1-of-6') => ({ file: 'cloudflare-worker/test/refund.test.ts', test: name, part });
const report = (failures, extra = {}) => ({ version: 1, testedSha: sha, status: 1, complete: true, files: ['cloudflare-worker/test/refund.test.ts'], failures, ...extra });
test('same test across different shards inherits only from the tested base', () => {
  assert.equal(identity(failure()), identity(failure(undefined, 'worker-6-of-6')));
  assert.equal(compareEvidence({ current: [report([failure()])], base: [report([failure(undefined, 'worker-6-of-6')])], baseSha: sha }).verdict, 'inherited_main_failure');
  assert.equal(compareEvidence({ current: [report([failure()])], base: [report([failure()], { testedSha: other })], baseSha: sha }).verdict, 'main_health_unknown');
});
test('different tests in the same shard are independent; mixed retains both', () => {
  const r = compareEvidence({ current: [report([failure(), failure('new defect')])], base: [report([failure()])], baseSha: sha });
  assert.equal(r.verdict, 'pr_failure'); assert.equal(r.shared.length, 1); assert.equal(r.own.length, 1);
});
test('missing, truncated, incomplete or cancelled base evidence is unknown', () => {
  for (const base of [[], [report([], { complete: false })], [report([], { files: [] })], [report([], { status: 'cancelled' })]]) {
    assert.equal(compareEvidence({ current: [report([failure()])], base, baseSha: sha }).verdict, 'main_health_unknown');
  }
});
test('invalid paths, control text and oversized failures never enter public reports', () => {
  const r = failureReport({ failures: [failure('bad\n::error::x'), { file: '../private', test: 'bad' }, ...Array.from({ length: 210 }, () => failure())] });
  assert.ok(r.failures.length <= 200); assert.ok(r.failures.every(f => !f.file.includes('..') && !f.test.includes('\n')));
  assert.ok(!renderEvidence({ verdict: 'main_health_unknown', shared: [], own: [], unknown: r.failures }).includes('\n::error'));
});

import { deflateRawSync, crc32 } from 'node:zlib';
import { readFailureArchive, collectEvidence, boundedBody } from './ciFailureCollector.mjs';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runPart, partsOf } from '../test-drift-parts.mjs';
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.from(e.data ?? '');
    const method = e.method ?? 8;
    const body = method === 8 ? deflateRawSync(data) : data;
    const name = Buffer.from(e.name, 'utf8');
    const localName = Buffer.from(e.localName ?? e.name, 'utf8');
    const crc = e.crc ?? (crc32(data) >>> 0);
    const size = e.size ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(localName.length, 26);
    locals.push(local, localName, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    const mode = e.mode ?? (e.name.endsWith('/') ? 0o040755 : 0o100644);
    central.writeUInt32LE(((mode << 16) | (e.name.endsWith("/") ? 0x10 : 0)) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + localName.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
const archive = rows => zip([{ name: 'failures.json', data: JSON.stringify(rows) }]);
test('archive refuses corruption, traversal, multiple files, oversize and malformed JSON', () => {
  assert.deepEqual(readFailureArchive(archive([])), []);
  assert.throws(() => readFailureArchive(zip([{ name: 'failures.json', data: JSON.stringify(['x'.repeat(2100000)]) }])));
  for (const buf of [Buffer.from('truncated'), zip([{ name: '../failures.json', data: '[]' }]), zip([{ name: 'failures.json', data: 'x' }]), zip([{ name: 'failures.json', crc: 42, data: '[]' }]), zip([{ name: 'failures.json', size: 3000000, data: '[]' }])]) assert.throws(() => readFailureArchive(buf));
});
function fixture({ baseReport = report([failure()]), currentReport = report([failure()]), failArtifacts = false, jobs = null, attempt = 1 } = {}) {
  const run = { id: 10, head_sha: other, workflow_id: 5, run_attempt: attempt };
  const base = { id: 20, head_sha: sha, workflow_id: 5, run_attempt: 1, head_branch: 'main', event: 'push', conclusion: 'failure' };
  const artifact = r => ({ id: r.id, name: `ci-failures-worker-1-of-6-attempt-${r.run_attempt}`, workflow_run: { id: r.id, head_sha: r.head_sha }, size_in_bytes: 50 });
  return { runId: 10, baseSha: sha,
    api: async path => {
      if (path === '/actions/runs/10') return run;
      if (path.includes('/jobs?')) return { jobs: jobs || [{ name: 'suite (worker-1-of-6)', conclusion: 'failure' }] };
      if (path.includes('/artifacts?')) { if (failArtifacts) throw new Error('offline'); return { artifacts: [artifact(path.includes('/10/') ? run : base)] }; }
      if (path.startsWith('/actions/workflows/5/runs?')) { assert.ok(path.includes(`head_sha=${sha}`)); return { workflow_runs: [base] }; }
      throw new Error('unexpected API request');
    },
    download: async path => archive([{ ...(path.includes('/10/') ? currentReport : baseReport), testedSha: path.includes('/10/') ? other : baseReport.testedSha, runId: path.includes('/10/') ? '10' : '20', attempt: path.includes('/10/') ? String(attempt) : '1', part: 'worker-1-of-6' }]),
  };
}
test('collector reads exact base and propagates missing API/artifact evidence as unknown', async () => {
  assert.equal((await collectEvidence(fixture())).verdict, 'inherited_main_failure');
  assert.equal((await collectEvidence(fixture({ baseReport: report([failure()], { testedSha: other }) }))).verdict, 'main_health_unknown');
  const missing = await collectEvidence(fixture({ failArtifacts: true }));
  assert.equal(missing.verdict, 'main_health_unknown'); assert.ok(missing.warnings.length);
  assert.equal((await collectEvidence(fixture({ baseReport: report([]) }))).verdict, 'pr_failure');
});
test('failed setup and cancelled legs cannot disappear behind an inherited test', async () => {
  const jobs = [{ name: 'suite (worker-1-of-6)', conclusion: 'failure' }, { name: 'suite (worker-2-of-6)', conclusion: 'cancelled' }];
  const result = await collectEvidence(fixture({ jobs }));
  assert.equal(result.verdict, 'main_health_unknown'); assert.equal(result.shared.length, 1); assert.equal(result.unknown.length, 1);
  const infra = await collectEvidence(fixture({ jobs: [{ name: 'worker', conclusion: 'failure', steps: [{ name: 'Install worker', conclusion: 'failure' }] }] }));
  assert.equal(infra.verdict, 'infra_failure'); assert.equal(infra.infraFingerprint, 'worker/Install worker');
});
test('download cap applies while streaming, before JSON parsing', async () => {
  await assert.rejects(() => boundedBody(new Response('x'.repeat(2100000))), /too large/);
});
test('real node reporter preserves exit code, test identity, coverage and bounded safe repro on every event', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'ci5502-'));
  const file = 'refund.test.mjs';
  try {
    writeFileSync(resolve(dir, file), "import { test } from 'node:test'; import assert from 'node:assert/strict'; test('refund is idempotent', () => assert.equal(1, 2));");
    for (const event of ['pull_request', 'merge_group', 'push']) {
      const lines = [];
      const status = runPart({ commands: [`node --test ${file}`], env: { GITHUB_EVENT_NAME: event, CI_FAILURE_DIR: dir, GITHUB_SHA: other, GITHUB_RUN_ID: '10', GITHUB_RUN_ATTEMPT: '1', CI_FAILURE_PART: 'rest' }, root: process.cwd(), sh: cmd => { const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; const r = spawnSync('sh', ['-c', cmd], { encoding: 'utf8', env, cwd: dir }); assert.notEqual(r.status, 0, r.stdout + r.stderr); return r; }, flakyList: () => [], changedFiles: () => [], log: line => lines.push(line), error() {} });
      assert.equal(status, 1);
      const rows = JSON.parse(readFileSync(resolve(dir, 'failures.json'), 'utf8'));
      assert.equal(rows[0].complete, true); assert.equal(rows[0].failures[0].file, file); assert.equal(rows[0].failures[0].test, 'refund is idempotent'); assert.ok(rows[0].failures[0].repro.startsWith('npm run build && node'));
      if (event === 'merge_group') assert.ok(lines.some(l => l.startsWith('::error title=ci-failure-id::') && l.includes('refund is idempotent')));
    }
    const status = runPart({ commands: ['npm run nonexistent'], env: { CI_FAILURE_DIR: dir }, sh: () => ({ status: 7 }), log() {}, error() {} });
    assert.equal(status, 7); assert.equal(JSON.parse(readFileSync(resolve(dir, 'failures.json'), 'utf8'))[0].complete, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
import reporter from './ciFailureReporter.mjs';
async function reported(events) { const rows = []; for await (const line of reporter((async function* () { yield* events; })())) rows.push(JSON.parse(line)); return rows; }
test('reporter marks nested, cancelled, truncated titles and overflow incomplete; assertion values are absent', async () => {
  const event = { type: 'test:fail', data: { file: 'scripts/lib/refund.test.mjs', name: 'refund', nesting: 0, details: { type: 'test', error: { code: 'ERR_ASSERTION', message: 'private-value', actual: 'private-value' } } } };
  const rows = await reported([event]); assert.equal(rows.at(-1).complete, true); assert.ok(!JSON.stringify(rows).includes('private-value'));
  for (const events of [[{ ...event, data: { ...event.data, nesting: 1 } }], [event, { type: 'test:summary', data: { counts: { cancelled: 1 } } }], [{ ...event, data: { ...event.data, name: 'x'.repeat(241) } }], Array.from({ length: 201 }, () => event)]) {
    assert.equal((await reported(events)).at(-1).complete, false);
  }
});
test('public rendering neutralizes markdown, tokens and forged links, and is bounded', () => {
  const r = failureReport({ failures: [failure('[click](https://evil.test) `x`\n::error:: sk-secretvalue')], complete: true });
  assert.equal(r.complete, false); assert.ok(!JSON.stringify(r).includes('sk-secretvalue'));
  const output = renderEvidence({ verdict: 'main_health_unknown', own: [], shared: [], unknown: [{ ...r.failures[0], jobUrl: 'https://evil.test' }] });
  assert.ok(!output.includes('[click]')); assert.ok(!output.includes('Job: https://evil'));
  assert.ok(renderEvidence({ verdict: 'main_health_unknown', own: [], shared: [], unknown: Array(1000).fill(r.failures[0]) }).length <= 20000);
});
test('wrong attempt and missing run identity cannot provide inherited evidence', async () => {
  const f = fixture(); const api = f.api;
  f.api = async path => { const data = await api(path); return path.includes('/10/artifacts?') ? { artifacts: data.artifacts.map(a => ({ ...a, name: 'ci-failures-worker-1-of-6-attempt-2' })) } : data; };
  assert.equal((await collectEvidence(f)).verdict, 'main_health_unknown');
});
test('an API failure on a later inventory page is unknown, never a partial inherited verdict', async () => {
  const f = fixture(); const api = f.api;
  f.api = async path => {
    if (path.includes('/20/artifacts?') && path.includes('page=1')) return { artifacts: Array(100).fill({ name: 'other' }) };
    if (path.includes('/20/artifacts?')) throw new Error('page 2 failed');
    return api(path);
  };
  const result = await collectEvidence(f); assert.equal(result.verdict, 'main_health_unknown'); assert.ok(result.warnings.some(w => w.includes('Exact-base')));
});
import { artifactForDigest, digestClients } from '../ci-digest.mjs';
test('digest evidence maps setup to its real job and preserves a supplied artifact when collection fails', () => {
  const previous = { headSha: sha, failures: [{ job: 'worker (typecheck)', id: 'legacy', excerpt: 'preserved' }] };
  assert.equal(artifactForDigest(null, sha, previous), previous);
  const artifact = artifactForDigest({ shared: [], own: [], unknown: [{ kind: 'step', job: 'worker (typecheck)', part: 'Not recorded', test: 'Install worker' }] }, sha);
  assert.equal(artifact.failures[0].job, 'worker (typecheck)');
});
test('artifact reads have a separate bounded budget from digest publication', async () => {
  const { api, evidenceApi } = digestClients({ repo: 'AxalNetwork/StudioOS', token: 'fixture', maxRequests: 2, fetcher: async () => new Response('{}') });
  await evidenceApi('GET', 'one'); await evidenceApi('GET', 'two');
  await assert.rejects(() => evidenceApi('GET', 'three'), /cap/);
  await api('GET', 'comments'); await api('POST', 'comment', { body: 'fixture' });
});
test('successful non-test commands add no incomplete test report', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'ci5502-command-'));
  try {
    assert.equal(runPart({ commands: ['npm run guard'], env: { CI_FAILURE_DIR: dir }, sh: () => ({ status: 0 }), log() {}, error() {} }), 0);
    assert.throws(() => readFileSync(resolve(dir, 'failures.json')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('collector accepts every real planned part name, excluding no shard when counts change', async () => {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const part of partsOf(scripts)) {
    const f = fixture(), api = f.api;
    f.api = async path => {
      const data = await api(path);
      return data.artifacts ? { artifacts: data.artifacts.map(a => ({ ...a, name: `ci-failures-${part.name}-attempt-1` })) } : data;
    };
    assert.equal((await collectEvidence(f)).verdict, 'inherited_main_failure', part.name);
  }
});
test('missing exact-base run remains unknown rather than falling back to another ancestor', async () => {
  const f = fixture(), api = f.api;
  f.api = async path => path.startsWith('/actions/workflows/') ? { workflow_runs: [] } : api(path);
  const result = await collectEvidence(f);
  assert.equal(result.verdict, 'main_health_unknown');
  assert.ok(result.warnings.some(w => w.includes('No completed main run')));
});
