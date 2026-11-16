/**
 * D5925 (#5925): the licence detail's `sync` carries what the branch reports it
 * holds, read from the branch, separate from the answer to HQ's last push. A
 * branch that cannot be read is unreadable, never the last pushed revision.
 *
 * The branch side is the real `branchHealth` over SQLite; HQ reads it through
 * the real `branchRead` with the branch's `health` as the binding's method.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_branch_report_5925.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { branchHealth } from '../src/rpc/branchOps.ts';
import { licenceBranchReport, REPORT_REASONS } from '../src/services/licenceBranchReport.ts';
import { syncSummary } from '../src/services/licenceSyncView.ts';
import { LICENCE_RESPONSE_FIELDS } from '../../frontend/src/lib/licenceContracts.js';

const LICENCE = 'lic_5925';

function branchDb({ columns = true, revision = 7, copyState = 'complete' }: { columns?: boolean; revision?: number | null; copyState?: string | null } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE branch_licence (id INTEGER PRIMARY KEY CHECK (id = 1), licence_uid TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', pushed_at TEXT NOT NULL ${columns ? ', hq_revision INTEGER, copy_state TEXT' : ''})`);
  if (columns) db.prepare("INSERT INTO branch_licence (id, licence_uid, pushed_at, hq_revision, copy_state) VALUES (1, ?, '2026-11-14T08:00:00.000Z', ?, ?)").run(LICENCE, revision, copyState);
  else db.prepare("INSERT INTO branch_licence (id, licence_uid, pushed_at) VALUES (1, ?, '2026-11-14T08:00:00.000Z')").run(LICENCE);
  return { DB: d1Over(db), BRANCH_CODE: 'fr', BRANCH_NAME: 'Axal VC France', BRANCH_TERRITORY: 'FR' } as any;
}
function hqEnv(binding: any, { deployment = true, pushed = 9 }: { deployment?: boolean; pushed?: number | null } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE licence_deployments (licence_uid TEXT NOT NULL UNIQUE, code TEXT NOT NULL UNIQUE);
    CREATE TABLE licence_sync_state (licence_id INTEGER PRIMARY KEY, hq_revision INTEGER NOT NULL DEFAULT 0, branch_revision INTEGER, last_success_at TEXT);
    CREATE TABLE licence_push_pending (licence_id INTEGER PRIMARY KEY, revision INTEGER, failure_code TEXT, attempts INTEGER, last_attempt_at TEXT);
    CREATE TABLE licence_termination_ops (licence_id INTEGER PRIMARY KEY);`);
  if (deployment) db.prepare("INSERT INTO licence_deployments (licence_uid, code) VALUES (?, 'fr')").run(LICENCE);
  db.prepare("INSERT INTO licence_sync_state (licence_id, hq_revision, branch_revision, last_success_at) VALUES (1, 9, ?, '2026-11-14T07:00:00Z')").run(pushed);
  return { DB: d1Over(db), ...(binding ? { BRANCH_FR: binding } : {}) } as any;
}

test('the branch’s health answers the revision its own copy holds, and whether the copy is complete', async () => {
  const h = await branchHealth(branchDb({ revision: 7, copyState: 'partial' })) as any;
  assert.equal(h.licence_revision, 7);
  assert.equal(h.licence_copy_state, 'partial');
  assert.equal(h.licence_pushed_at, '2026-11-14T08:00:00.000Z');
  // A branch whose table predates the columns still answers, with no revision (and never throws).
  const old = await branchHealth(branchDb({ columns: false })) as any;
  assert.equal(old.licence_revision, null);
  assert.equal(old.licence_copy_state, null);
  assert.equal(old.licence_status, 'active');
});

test('sync carries the branch’s own report beside, and separate from, the push answer', async () => {
  const branch = branchDb({ revision: 7 });
  const env = hqEnv({ health: () => branchHealth(branch) }, { pushed: 9 });
  const sync = await syncSummary(env, 1, LICENCE);
  assert.equal(sync.branch_revision, 9, 'the push answer is unchanged');
  assert.equal(sync.branch_report.state, 'reported');
  assert.equal(sync.branch_report.revision, 7, 'the branch says 7, whatever the push answer recorded');
  assert.equal(sync.branch_report.copy_state, 'complete');
  assert.equal(sync.branch_report.applied_at, '2026-11-14T08:00:00.000Z');
  assert.match(String(sync.branch_report.reported_at), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(sync.branch_report.reason, null);
});

test('a branch that cannot be reached is unreadable, never the last pushed revision', async () => {
  const env = hqEnv({ health: async () => { throw new Error('connection reset'); } }, { pushed: 9 });
  const sync = await syncSummary(env, 1, LICENCE);
  assert.equal(sync.branch_report.state, 'unreadable');
  assert.equal(sync.branch_report.revision, null);
  assert.equal(sync.branch_report.reported_at, null);
  assert.match(String(sync.branch_report.reason), /connection reset/);
  assert.equal(sync.branch_revision, 9, 'still the push answer, labelled as such');
});

test('an older build that does not report its revision is named, not believed', async () => {
  const env = hqEnv({ health: async () => ({ ok: true, db_ok: true, licence_status: 'active', licence_pushed_at: '2026-11-01T00:00:00Z', deploy_version: null, branch: 'fr', as_of: '2026-11-14T09:00:00Z' }) });
  const r = await licenceBranchReport(env, LICENCE);
  assert.deepEqual(r, { state: 'older_build', revision: null, copy_state: null, applied_at: null, reported_at: '2026-11-14T09:00:00Z', reason: REPORT_REASONS.older_build });
});

test('no deployment row, or no binding, is not_deployed; a branch with no numbered copy says so', async () => {
  assert.equal((await licenceBranchReport(hqEnv(null, { deployment: false }), LICENCE)).state, 'not_deployed');
  const unbound = await licenceBranchReport(hqEnv(null), LICENCE);
  assert.equal(unbound.state, 'not_deployed'); assert.equal(unbound.revision, null);
  const none = await licenceBranchReport(hqEnv({ health: () => branchHealth(branchDb({ revision: null, copyState: null })) }), LICENCE);
  assert.equal(none.state, 'reported'); assert.equal(none.revision, null); assert.equal(none.reason, REPORT_REASONS.no_copy);
});

test('the SPA contract lists the new keys', async () => {
  const env = hqEnv({ health: () => branchHealth(branchDb()) });
  const sync = await syncSummary(env, 1, LICENCE);
  assert.deepEqual(Object.keys(sync).sort(), [...LICENCE_RESPONSE_FIELDS.sync].sort());
  assert.deepEqual(Object.keys(sync.branch_report).sort(), [...LICENCE_RESPONSE_FIELDS.syncBranchReport].sort());
});
