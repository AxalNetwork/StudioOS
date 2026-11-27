// D8688 (#8688) — the role qualification, run as a test: the five role scenarios (Admin on a branch's
// test territory, Founder, Investor, Advisor, Operating Partner) and the pending-review control, through
// the real Worker on migrated local SQLite, each with its second synthetic tenant. Every API step of
// every role passes; no request leaves the process; nothing in the matrix names an address, link or
// token; and the fixture refuses a database that is not an isolated one. The matrix CLI
// (`scripts/qualification/role-matrix.mjs`) runs the same scenarios and writes the table.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/role_qualification_8688.test.ts
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { runQualification, guard, type Row } from './_role_qualification_8688.ts';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { ROLES, STEPS, rowResult, unpublishable, syntheticEmail } from '../../scripts/lib/roleQualification.mjs';

after(removeMigratedDatabases);

const failing = (row: Row) => STEPS.filter((s) => row.steps[s]?.result !== 'pass').map((s) => `${s}: ${row.steps[s]?.evidence}`);

test('every role completes start, draft, reload, next action and the second-tenant check through the real Worker', async () => {
  const run = await runQualification();
  const byRole = new Map(run.rows.map((r) => [r.intended_role, r]));
  // Mutation checked: requireOwnCohort's assignment lookup dropped → Advisor's scope step fails here;
  // linkedIds' ownedRow check dropped → Founder's scope step fails; fundListRow always 'gp' → Investor's reload fails;
  // branch B given branch A's signing key → Admin's scope step fails.
  for (const role of ROLES) {
    const row = byRole.get(role);
    assert.ok(row, `${role} has no row`);
    assert.equal(rowResult(row.steps), 'pass', `${role}: ${failing(row).join(' | ')}`);
    assert.equal(row.preview_only, false, `${role} is an actual-role result, not a preview`);
  }
  // The session's own role, read back through /api/auth/me, is the intended one.
  assert.deepEqual(ROLES.map((r) => byRole.get(r)!.authenticated_role.split(' ')[0]), ['admin', 'founder', 'investor', 'advisor', 'partner']);
  // The control: a pending member reads its own state and reaches nothing; it has no draft to save.
  const pending = run.rows.find((r) => r.id === 'pending')!;
  assert.deepEqual(STEPS.map((s) => pending.steps[s].result), ['pass', 'missing', 'missing', 'pass', 'pass']);
  assert.equal(pending.authenticated_role, 'exploring');
  assert.equal(run.outside_requests, 0, 'a scenario attempted a request outside the process');
  assert.deepEqual(unpublishable(run.rows), [], 'the matrix carries an address, a link or a token-like value');
});

test('the fixture refuses a production environment and a database holding a non-synthetic account', () => {
  const db = migratedDatabase();
  try {
    assert.doesNotThrow(() => guard(db, 'development'));
    // Mutation checked: targetRefusals' production branch removed → this stops throwing.
    assert.throws(() => guard(db, 'production'), /production_environment/);
    assert.throws(() => guard(db, ''), /environment_unset/);
    db.prepare("INSERT INTO users (name, email, role, is_active) VALUES ('Synthetic', ?, 'founder', 1)").run(syntheticEmail('control'));
    assert.doesNotThrow(() => guard(db, 'development'), 'a synthetic account is allowed');
    // Not an address at all: anything outside the synthetic domain counts as a real account.
    db.prepare("INSERT INTO users (name, email, role, is_active) VALUES ('Imported', 'imported-member-row', 'founder', 1)").run();
    assert.throws(() => guard(db, 'development'), /non_synthetic_accounts/);
  } finally { db.close(); }
});
