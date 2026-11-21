/**
 * D8073 (#8073): deploy provenance — the record a deploy writes, the script
 * that writes it (driven with a fake environment and a fake fetch), and the
 * smoke's verdict on GET /api/public/version.
 *
 *   node --test scripts/lib/deployProvenance.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RECORD_URL, deploymentRecord, summaryLine, versionVerdict, workerVersionId } from './deployProvenance.mjs';
import { run } from '../deploy/record-deployment.mjs';

const SHA = 'c'.repeat(40);
const VID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const ENV = {
  GITHUB_SHA: SHA, GITHUB_RUN_ID: '19544321098', WORKER_VERSION_ID: VID,
  ATTESTATION_URL: 'https://github.com/AxalNetwork/StudioOS/attestations/77',
  WORKER_BUILT_AT: '2026-11-21T18:20:00Z', DEPLOYED_AT: '2026-11-21T18:24:31.512Z',
  DEPLOY_RECORD_TOKEN: 'fake-token-never-printed',
};

test('the Worker version id comes from wrangler output, ND-JSON first', () => {
  const nd = `{"type":"wrangler-session"}\n{"type":"deploy","version_id":"${VID.toUpperCase()}"}\n`;
  assert.equal(workerVersionId({ outputNdjson: nd, log: 'Current Version ID: 11111111-1111-1111-1111-111111111111' }), VID);
  assert.equal(workerVersionId({ log: `Uploaded studioos\nDeployed studioos triggers\nCurrent Version ID: ${VID}\n` }), VID);
  assert.equal(workerVersionId({ outputNdjson: '{"type":"deploy","version_id":"nope"}', log: 'no id here' }), null);
  assert.equal(workerVersionId(), null);
});

test('the record is built from the run environment', () => {
  const r = deploymentRecord(ENV);
  assert.ok(r.ok);
  assert.deepEqual(r.record, {
    sha: SHA, run_id: '19544321098', worker_version_id: VID,
    attestation_url: ENV.ATTESTATION_URL, built_at: ENV.WORKER_BUILT_AT,
    deployed_at: ENV.DEPLOYED_AT, rollback_of: null,
  });
  const fromLog = deploymentRecord({ ...ENV, WORKER_VERSION_ID: '', DEPLOYED_AT: '' }, { versionId: VID, now: () => new Date('2026-11-21T19:00:00Z') });
  assert.equal(fromLog.record.worker_version_id, VID);
  assert.equal(fromLog.record.deployed_at, '2026-11-21T19:00:00.000Z');
  assert.equal(deploymentRecord({ ...ENV, ROLLBACK_OF: '7' }).record.rollback_of, 7);
});

test('each malformed variable is named, never its value', () => {
  const r = deploymentRecord({
    GITHUB_SHA: 'abc', GITHUB_RUN_ID: 'x', ATTESTATION_URL: 'https://evil.example/a/1',
    WORKER_BUILT_AT: 'today', DEPLOYED_AT: 'now', ROLLBACK_OF: '-1',
  });
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 7);
  for (const name of ['GITHUB_SHA', 'GITHUB_RUN_ID', 'Worker version id', 'ATTESTATION_URL', 'WORKER_BUILT_AT', 'DEPLOYED_AT', 'ROLLBACK_OF']) {
    assert.ok(r.problems.some((p) => p.includes(name)), name);
  }
  assert.ok(!r.problems.join(' ').includes('evil.example'));
});

function fakeFetch(answers) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const [status, body] = answers[Math.min(calls.length - 1, answers.length - 1)];
    return { status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}
const quiet = () => {};

test('one run posts the record once, with the token, and appends the summary line', async () => {
  const f = fakeFetch([[201, { created: true, deployment: { id: 12 } }]]);
  const summary = [];
  const logs = [];
  const code = await run({ env: ENV, fetchImpl: f, read: () => '', appendSummary: (l) => summary.push(l), log: (l) => logs.push(l), error: quiet });
  assert.equal(code, 0);
  assert.equal(f.calls.length, 1, 'written once per deploy');
  assert.equal(f.calls[0].url, DEFAULT_RECORD_URL);
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${ENV.DEPLOY_RECORD_TOKEN}`);
  assert.deepEqual(JSON.parse(f.calls[0].init.body), deploymentRecord(ENV).record);
  assert.equal(summary.length, 1);
  assert.deepEqual(summary, logs, 'the summary carries the same line');
  assert.match(summary[0], /recorded \(new, id 12\)/);
  assert.ok(summary[0].includes(VID) && summary[0].includes(SHA.slice(0, 12)));
  assert.ok(!summary.join('').includes(ENV.DEPLOY_RECORD_TOKEN), 'the token is never printed');
});

test('a re-run of the same deploy is not an error', async () => {
  const f = fakeFetch([[200, { created: false, deployment: { id: 12 } }]]);
  const summary = [];
  assert.equal(await run({ env: ENV, fetchImpl: f, read: () => '', appendSummary: (l) => summary.push(l), log: quiet, error: quiet }), 0);
  assert.match(summary[0], /already recorded, id 12/);
});

test('only an integer record id reaches the summary', async () => {
  const f = fakeFetch([[201, { created: true, deployment: { id: '](https://evil.example) <b>x</b>' } }]]);
  const summary = [];
  assert.equal(await run({ env: ENV, fetchImpl: f, read: () => '', appendSummary: (l) => summary.push(l), log: quiet, error: quiet }), 0);
  assert.match(summary[0], /recorded \(new, id \?\)/);
  assert.ok(!summary[0].includes('evil.example'));
});

test('the version id is read from the wrangler deploy log when not given', async () => {
  const f = fakeFetch([[201, { created: true, deployment: { id: 1 } }]]);
  const env = { ...ENV, WORKER_VERSION_ID: '', WRANGLER_DEPLOY_LOG: 'deploy.log' };
  const read = (p) => (p === 'deploy.log' ? `Current Version ID: ${VID}\n` : '');
  assert.equal(await run({ env, fetchImpl: f, read, appendSummary: quiet, log: quiet, error: quiet }), 0);
  assert.equal(JSON.parse(f.calls[0].init.body).worker_version_id, VID);
});

test('nothing is posted without a token or a valid record, and a refusal fails the run', async () => {
  const f = fakeFetch([[201, {}]]);
  const errors = [];
  assert.equal(await run({ env: { ...ENV, DEPLOY_RECORD_TOKEN: '' }, fetchImpl: f, read: () => '', appendSummary: quiet, log: quiet, error: (l) => errors.push(l) }), 1);
  assert.equal(await run({ env: { ...ENV, GITHUB_SHA: 'x' }, fetchImpl: f, read: () => '', appendSummary: quiet, log: quiet, error: (l) => errors.push(l) }), 1);
  assert.equal(f.calls.length, 0);
  const refused = fakeFetch([[401, { error: 'deploy_record_unauthorized' }]]);
  const summary = [];
  assert.equal(await run({ env: ENV, fetchImpl: refused, read: () => '', appendSummary: (l) => summary.push(l), log: quiet, error: (l) => errors.push(l) }), 1);
  assert.equal(summary.length, 0, 'no summary line for a record that was not written');
  assert.ok(errors.some((e) => e.includes('deploy_record_unauthorized')));
  const thrown = async () => { throw new Error('offline'); };
  assert.equal(await run({ env: ENV, fetchImpl: thrown, read: () => '', appendSummary: quiet, log: quiet, error: quiet }), 1);
});

test('summaryLine says when a field was not recorded', () => {
  const line = summaryLine({ ...deploymentRecord(ENV).record, attestation_url: null, built_at: null }, 'new, id 3');
  assert.match(line, /no attestation/);
  assert.match(line, /built not recorded/);
});

test('the smoke passes a served sha, and only the deployed one when it is given', () => {
  const body = JSON.stringify({ sha: SHA, version_id: VID, built_at: null, missing: ['built_at'] });
  assert.deepEqual(versionVerdict(200, body), { ok: true, sha: SHA, reason: null });
  assert.equal(versionVerdict(200, body, SHA.toUpperCase()).ok, true);
  const stale = versionVerdict(200, body, 'd'.repeat(40));
  assert.equal(stale.ok, false);
  assert.match(stale.reason, /is not the deployed sha/);
  assert.match(versionVerdict(200, JSON.stringify({ sha: null })).reason, /no commit sha/);
  assert.match(versionVerdict(404, '{"detail":"Not found"}').reason, /HTTP 404/);
  assert.match(versionVerdict(200, '<html>').reason, /not JSON/);
});
