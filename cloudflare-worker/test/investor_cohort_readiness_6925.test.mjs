import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migration = (name) => readFileSync(new URL('../sql/migrations/' + name, import.meta.url), 'utf8');
const correction = migration('202611161338_6925_investor_cohort_readiness.sql');

test('the build-status correction preserves member access and any different HQ or studio decision', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE learning_programs (id INTEGER PRIMARY KEY); CREATE TABLE learning_enrollments (program_id, user_id, enrolled_by, enrolled_at, status, updated_at);');
    for (const name of ['560_program_registry.sql', '561_program_proposals.sql', '202611082300_programs_member_access_modules_4873.sql']) {
      db.exec(migration(name));
    }
    const snapshot = () => db.prepare('SELECT key, status, purpose, member_access, licence_uid, modules FROM programs ORDER BY key').all();
    const original = snapshot();
    const purpose = 'Give verified investors access to venture summaries and weekly progress for one assigned Lab cohort after they sign its NDA.';
    db.exec(correction);
    assert.deepEqual(snapshot(), original.map((r) => r.key === 'investor-cohorts' ? Object.assign(r, { status: 'partly_built', purpose }) : r));
    assert.equal(db.prepare('SELECT changes() AS n').get().n, 1);
    db.exec(correction);
    assert.equal(db.prepare('SELECT changes() AS n').get().n, 0);
    const change = db.prepare("UPDATE programs SET status = ?, member_access = ?, licence_uid = ? WHERE key = 'investor-cohorts'");
    // Preserve a later HQ status, an independently edited access setting (including unknown),
    // and a studio-specific decision. The correction cannot open or close any of these.
    for (const values of [['live', 'not_open', null], ['not_built', 'assigned', null], ['not_built', null, null], ['not_built', 'not_open', 'one-studio']]) {
      change.run(...values);
      const saved = snapshot();
      db.exec(correction);
      assert.equal(db.prepare('SELECT changes() AS n').get().n, 0);
      assert.deepEqual(snapshot(), saved);
    }
    change.run('not_built', 'not_open', null);
    db.exec("UPDATE programs SET purpose = 'Locally approved purpose.' WHERE key = 'investor-cohorts'");
    db.exec(correction);
    const edited = snapshot().find((r) => r.key === 'investor-cohorts');
    assert.equal(edited.status, 'partly_built');
    assert.equal(edited.purpose, 'Locally approved purpose.');
  } finally {
    db.close();
  }
});
