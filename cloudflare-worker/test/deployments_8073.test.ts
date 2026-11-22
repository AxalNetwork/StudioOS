/**
 * D8073 (#8073): the deploy provenance record and the served version.
 *
 * The real routers over the full migrated schema. Pinned:
 *   - POST /api/internal/deployments refuses with no secret configured (503)
 *     and with a missing or wrong token (401), and stores nothing;
 *   - a bad body is refused (400) with the field it got wrong, and stores
 *     nothing;
 *   - a good record is written once: a re-post of the same deploy answers the
 *     row already there, and a re-post that disagrees with it is refused (409);
 *   - rollback_of must name a recorded deploy;
 *   - GET /api/public/version answers from the bindings with no D1 read, and
 *     names each field the deploy did not stamp.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deployments_8073.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';

import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import internal, { mount, parseDeployment } from '../src/routes/internal_deployments.ts';
import publicRoutes, { versionBody } from '../src/routes/public.ts';

const TOKEN = 'deploy-record-test-token-0123456789abcdef';
const SHA = 'a'.repeat(40);
const VID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const record = (extra: Record<string, unknown> = {}) => ({
  sha: SHA, run_id: '19544321098', worker_version_id: VID,
  attestation_url: 'https://github.com/AxalNetwork/StudioOS/attestations/1234567',
  built_at: '2026-11-21T18:20:00Z', deployed_at: '2026-11-21T18:24:31.512Z', ...extra,
});

function fresh() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  return db;
}

const app = new Hono<any>();
app.route(mount.path, internal);
app.route('/api/public', publicRoutes);

async function post(db: any, body: unknown, o: { token?: string | null; secret?: string | null } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = o.token === undefined ? TOKEN : o.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  const env: any = { ENVIRONMENT: 'development', DB: d1Over(db) };
  if (o.secret !== null) env.DEPLOY_RECORD_TOKEN = o.secret ?? TOKEN;
  const res = await app.request('/api/internal/deployments', {
    method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body),
  }, env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const rows = (db: any) => Number((db.prepare('SELECT COUNT(*) AS n FROM deployments').get() as any).n);

test('the record is mounted at /api/internal', () => {
  assert.equal(mount.path, '/api/internal');
});

test('the record refuses until configured, and refuses a missing or wrong token', async () => {
  const db = fresh();
  const unset = await post(db, record(), { secret: null });
  assert.deepEqual([unset.status, unset.body.error], [503, 'deploy_record_not_configured']);
  assert.equal((await post(db, record(), { secret: '' })).status, 503, 'an empty secret is not configured');
  const none = await post(db, record(), { token: null });
  assert.deepEqual([none.status, none.body.error], [401, 'deploy_record_unauthorized']);
  assert.equal((await post(db, record(), { token: `${TOKEN}x` })).status, 401, 'a longer token');
  assert.equal((await post(db, record(), { token: TOKEN.replace(/.$/, 'X') })).status, 401, 'a same-length wrong token');
  assert.equal(rows(db), 0, 'nothing stored');
});

test('a bad body is refused with the field it got wrong, and stores nothing', async () => {
  const db = fresh();
  const cases: [unknown, string][] = [
    ['not json', 'JSON object'],
    [record({ sha: 'abc123' }), '`sha`'],
    [record({ run_id: '12a' }), '`run_id`'],
    [record({ worker_version_id: 'v1' }), '`worker_version_id`'],
    [record({ attestation_url: 'https://evil.example/attestations/1' }), '`attestation_url`'],
    [record({ attestation_url: 'https://github.com/someone/else/attestations/1' }), '`attestation_url`'],
    [record({ attestation_url: 'https://github.com/AxalNetwork/StudioOS/attestations/1@evil.example' }), '`attestation_url`'],
    [record({ built_at: '21/11/2026' }), '`built_at`'],
    [record({ deployed_at: null }), '`deployed_at`'],
    [record({ rollback_of: 0 }), '`rollback_of`'],
  ];
  for (const [body, field] of cases) {
    const res = await post(db, body);
    assert.equal(res.status, 400, field);
    assert.equal(res.body.error, 'deployment_invalid', field);
    assert.ok(res.body.message.includes(field), `${field}: ${res.body.message}`);
  }
  assert.equal((await post(db, 'x'.repeat(5000))).status, 413);
  assert.equal(rows(db), 0);
});

test('a deploy is recorded once; a disagreeing re-post is refused', async () => {
  const db = fresh();
  const first = await post(db, record());
  assert.equal(first.status, 201);
  assert.equal(first.body.created, true);
  assert.equal(first.body.deployment.sha, SHA);
  assert.equal(first.body.deployment.worker_version_id, VID);
  assert.equal(first.body.deployment.attestation_url, 'https://github.com/AxalNetwork/StudioOS/attestations/1234567');
  const again = await post(db, record());
  assert.deepEqual([again.status, again.body.created, again.body.deployment.id], [200, false, first.body.deployment.id]);
  assert.equal(rows(db), 1, 'written once per deploy');
  const clash = await post(db, record({ sha: 'b'.repeat(40) }));
  assert.deepEqual([clash.status, clash.body.error], [409, 'deployment_conflict']);
  assert.ok(clash.body.message.includes('sha'));
  assert.equal(rows(db), 1);
  const next = await post(db, record({ run_id: '19544321099', worker_version_id: VID.replace(/0$/, '1') }));
  assert.equal(next.status, 201);
  assert.equal(rows(db), 2, 'another deploy is another row');
});

test('rollback_of must name a recorded deploy', async () => {
  const db = fresh();
  const first = await post(db, record());
  const missing = await post(db, record({ run_id: '2', rollback_of: 999 }));
  assert.deepEqual([missing.status, missing.body.error], [422, 'rollback_target_unknown']);
  const ok = await post(db, record({ run_id: '2', rollback_of: first.body.deployment.id }));
  assert.equal(ok.status, 201);
  assert.equal(ok.body.deployment.rollback_of, first.body.deployment.id);
});

test('parseDeployment lower-cases the sha and version id and takes a numeric run id', () => {
  const p = parseDeployment(record({ sha: SHA.toUpperCase(), run_id: 42, worker_version_id: VID.toUpperCase(), attestation_url: '' }));
  assert.ok(p.ok);
  if (p.ok) assert.deepEqual([p.value.sha, p.value.run_id, p.value.worker_version_id, p.value.attestation_url], [SHA, '42', VID, null]);
});

test('GET /api/public/version answers from the bindings, with no D1 read', async () => {
  const noDb = new Proxy({}, { get() { throw new Error('D1 was read'); } });
  const env: any = {
    DB: noDb, WORKER_DEPLOY_VERSION: SHA.toUpperCase(), WORKER_BUILT_AT: '2026-11-21T18:20:00Z',
    CF_VERSION_METADATA: { id: VID, tag: '', timestamp: '2026-11-21T18:24:00Z' },
  };
  const res = await app.request('/api/public/version', {}, env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await res.json(), { sha: SHA, version_id: VID, built_at: '2026-11-21T18:20:00Z', missing: [] });
});

test('an unstamped field is null and named, never a guess', () => {
  assert.deepEqual(versionBody({}), { sha: null, version_id: null, built_at: null, missing: ['sha', 'version_id', 'built_at'] });
  assert.deepEqual(versionBody({ WORKER_DEPLOY_VERSION: 'main', CF_VERSION_METADATA: { id: 'x' }, WORKER_BUILT_AT: 'yesterday' }).missing,
    ['sha', 'version_id', 'built_at']);
  assert.equal(versionBody({ WORKER_DEPLOY_VERSION: SHA }).sha, SHA);
});
