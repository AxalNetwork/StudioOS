/**
 * D4873 (#4873, part 2) — member access and modules are registry facts of their own.
 *
 * Real SQLite over the real schema and the real migration (202611082300). The backfill derives member access
 * from what the registry already records; the reads carry both facts beside each row, or say they were not
 * read; PATCH sets member access, refuses a value outside the list and audits it; a program New program adds
 * is not open and has no modules.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/programs_member_access_modules_4873.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import {
  EXTRAS_UNREAD, ProgramError, extrasView, insertProgramStatements, programDetail, registryExtras, updateProgram,
} from '../src/services/programRegistry.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../sql/migrations');
const ACTOR = { id: 1, email: 'super@example.test' };

function full(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = OFF');
  return db;
}
const envOf = (db: DatabaseSync) => ({ DB: d1Over(db) } as any);
const row = (db: DatabaseSync, key: string) => db.prepare('SELECT member_access, modules FROM programs WHERE key = ?').get(key) as any;

test('the backfill derives member access from what the registry records, and seeds modules only where a screen exists', () => {
  const db = full();
  // Learning's who said it outright; a not-built or proposed program has nothing to join.
  assert.equal(row(db, 'learning').member_access, 'not_open');
  assert.equal(row(db, 'investor-cohorts').member_access, 'not_open');
  assert.equal(row(db, 'ai-native-venture').member_access, 'not_open');
  // Otherwise the join method names it.
  assert.equal(row(db, 'refer-and-earn').member_access, 'open');
  assert.equal(row(db, 'perks').member_access, 'open');
  assert.equal(row(db, 'spinout-lab').member_access, 'apply');
  assert.equal(row(db, 'mentor-cohorts').member_access, 'assigned');
  assert.equal(row(db, 'referral-partners').member_access, 'invite');
  assert.equal(row(db, 'influencer').member_access, 'apply');
  assert.deepEqual(JSON.parse(row(db, 'perks').modules), ['perk_queue']);
  assert.deepEqual(JSON.parse(row(db, 'spinout-lab').modules), ['applications', 'cohorts', 'hosts']);
  assert.deepEqual(JSON.parse(row(db, 'ai-native-venture').modules), []);
});

test('a join method the backfill does not know stays Not recorded, never a guess', () => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db, { below: 560 });
  db.exec(readFileSync(resolve(MIGRATIONS, '560_program_registry.sql'), 'utf8'));
  db.exec(readFileSync(resolve(MIGRATIONS, '561_program_proposals.sql'), 'utf8'));
  db.exec("UPDATE programs SET join_method = 'Ask the studio' WHERE key = 'perks'");
  db.exec("UPDATE programs SET join_method = NULL WHERE key = 'refer-and-earn'");
  db.exec(readFileSync(resolve(MIGRATIONS, '202611082300_programs_member_access_modules_4873.sql'), 'utf8'));
  assert.equal(row(db, 'perks').member_access, null);
  assert.equal(row(db, 'refer-and-earn').member_access, null);
  assert.equal(row(db, 'spinout-lab').member_access, 'apply');
});

test('the program read carries member access and modules beside the row', async () => {
  const db = full();
  const d: any = await programDetail(envOf(db), 'perks', true);
  assert.equal(d.program.member_access, 'open');
  assert.deepEqual(d.program.modules, ['perk_queue']);
  assert.equal(d.program.extras, undefined);
});

test('a database the migration has not reached reads the row, and says the two facts were not read', async () => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db, { below: 560 });
  db.exec(readFileSync(resolve(MIGRATIONS, '560_program_registry.sql'), 'utf8'));
  db.exec(readFileSync(resolve(MIGRATIONS, '561_program_proposals.sql'), 'utf8'));
  db.exec(readFileSync(resolve(MIGRATIONS, '202611072010_program_approved_specs.sql'), 'utf8'));
  const extras = await registryExtras(envOf(db));
  assert.equal(extras.available, false);
  const view = extrasView(extras, 'perks') as any;
  assert.deepEqual(view, { extras: { available: false, reason: EXTRAS_UNREAD } });
  assert.equal('member_access' in view, false, 'never a null that would read as Not recorded');
  const d: any = await programDetail(envOf(db), 'perks', true);
  assert.equal(d.program.name, 'Perks');
  assert.equal(d.program.extras.available, false);
});

test('PATCH sets member access, clears it with null, refuses a word outside the list, and audits the field', async () => {
  const db = full();
  const env = envOf(db);
  const v: any = await updateProgram(env, 'learning', { member_access: 'invite' }, ACTOR);
  assert.equal(v.member_access, 'invite');
  assert.equal(row(db, 'learning').member_access, 'invite');
  const audit = db.prepare("SELECT filters_json AS details FROM admin_audit_log WHERE action = 'program.registry.update' ORDER BY id DESC LIMIT 1").get() as any;
  assert.match(String(audit.details), /member_access/);

  await updateProgram(env, 'learning', { member_access: null }, ACTOR);
  assert.equal(row(db, 'learning').member_access, null);

  await assert.rejects(updateProgram(env, 'learning', { member_access: 'everyone' }, ACTOR),
    (e: unknown) => e instanceof ProgramError && e.code === 'bad_member_access');
  assert.equal(row(db, 'learning').member_access, null, 'a refused value writes nothing');

  // A request that does not name member access leaves it alone.
  await updateProgram(env, 'perks', { purpose: 'Partner offers.' }, ACTOR);
  assert.equal(row(db, 'perks').member_access, 'open');
});

test('a program New program adds is not open to members and has no modules', async () => {
  const db = full();
  const env = envOf(db);
  await env.DB.batch(insertProgramStatements(env, {
    key: 'climate-circle', grp: 'Ventures', name: 'Climate circle', purpose: null, who: null, join_method: 'By application',
    licence_uid: null, sections: [],
  }, ACTOR.id));
  assert.equal(row(db, 'climate-circle').member_access, 'not_open');
  assert.equal(row(db, 'climate-circle').modules, '[]');
});
