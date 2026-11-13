import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, type TestContext } from 'node:test';
import { makeD1 } from './_d1_sqlite.mjs';
import { inspectVentureGitPublisher } from '../src/services/agents/ventureGitInstallation';

const migration = readFileSync(new URL('../sql/migrations/202611122104_5569_venture_git_installations.sql', import.meta.url), 'utf8');
const scope = { tenant_id: 1, company_id: 2, project_id: 3 };
const approvedAt = '2026-11-12 21:00:00';

function fixture(t: TestContext) {
  const { DB, db } = makeD1(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE company_profiles (id INTEGER PRIMARY KEY, archived_at TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, company_id INTEGER, deleted_at TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    INSERT INTO company_profiles (id) VALUES (2), (6);
    INSERT INTO projects (id, company_id) VALUES (3, 2), (4, 2), (7, 6);
    INSERT INTO users (id) VALUES (5);
  `);
  t.after(() => db.close());
  db.exec(migration);
  db.exec(migration);

  function register() {
    return db.prepare(`
      INSERT INTO venture_git_installations (
        tenant_id, company_id, project_id, app_id, installation_id, repository_id,
        repository_full_name, base_ref, approved_at, approved_by_user_id
      ) VALUES (1, 2, 3, 20, 30, 40, 'venture/example', 'refs/heads/main', ?, 5)
      RETURNING uid
    `).get(approvedAt)!.uid as string;
  }

  return { DB, db, register };
}

test('an approved installation resolves metadata and the broker stays disabled', async (t) => {
  const { DB, register } = fixture(t);
  const uid = register();
  const result = await inspectVentureGitPublisher(DB, scope, uid);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'venture_git_publisher_disabled');
  assert.ok('installation' in result);
  assert.deepEqual({ ...result.installation }, {
    uid, ...scope, app_id: 20, installation_id: 30, repository_id: 40,
    repository_full_name: 'venture/example', base_ref: 'refs/heads/main',
    approved_at: approvedAt, approved_by_user_id: 5, revoked_at: null,
  });
});

test('other scopes and invalid references receive the same refusal', async (t) => {
  const { DB, register } = fixture(t);
  const uid = register();
  const missing = { ok: false, code: 'venture_git_installation_not_found' };
  assert.deepEqual(await inspectVentureGitPublisher(DB, { ...scope, tenant_id: 2 }, uid), missing);
  assert.deepEqual(await inspectVentureGitPublisher(DB, { ...scope, project_id: 4 }, uid), missing);
  assert.deepEqual(await inspectVentureGitPublisher(DB, { ...scope, company_id: 6, project_id: 7 }, uid), missing);
  assert.deepEqual(await inspectVentureGitPublisher(DB, scope, 'malformed'), missing);
});

test('archived companies, deleted projects and ownership changes stop resolution', async (t) => {
  const { DB, db, register } = fixture(t);
  const uid = register();
  const missing = { ok: false, code: 'venture_git_installation_not_found' };
  db.prepare('UPDATE company_profiles SET archived_at = ? WHERE id = 2').run(approvedAt);
  assert.deepEqual(await inspectVentureGitPublisher(DB, scope, uid), missing);
  db.exec('UPDATE company_profiles SET archived_at = NULL WHERE id = 2');
  db.prepare('UPDATE projects SET deleted_at = ? WHERE id = 3').run(approvedAt);
  assert.deepEqual(await inspectVentureGitPublisher(DB, scope, uid), missing);
  db.exec('UPDATE projects SET deleted_at = NULL, company_id = 6 WHERE id = 3');
  assert.deepEqual(await inspectVentureGitPublisher(DB, scope, uid), missing);
  assert.deepEqual(await inspectVentureGitPublisher(DB, { ...scope, company_id: 6 }, uid), missing);
});

test('a revoked record is never reused and a missing approval fails closed', async (t) => {
  const { DB, db, register } = fixture(t);
  const original = register();
  assert.throws(register, /UNIQUE constraint failed/);
  db.prepare('UPDATE venture_git_installations SET revoked_at = ? WHERE uid = ?').run(approvedAt, original);
  const replacement = register();
  assert.notEqual(replacement, original);
  db.exec('DELETE FROM users WHERE id = 5');
  assert.equal((await inspectVentureGitPublisher(DB, scope, original)).code, 'venture_git_installation_revoked');
  assert.equal((await inspectVentureGitPublisher(DB, scope, replacement)).code, 'venture_git_approval_missing');
});

test('storage failures stay distinguishable from a missing registration', async (t) => {
  const { DB, db, register } = fixture(t);
  const uid = register();
  db.exec('DROP TABLE venture_git_installations');
  await assert.rejects(inspectVentureGitPublisher(DB, scope, uid), /no such table/);
});
