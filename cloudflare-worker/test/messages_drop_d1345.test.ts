/** D1345 phase 2: guarded removal, after the retirement Worker is deployed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const sqlRoot = new URL('../sql/', import.meta.url);
const migration = readFileSync(new URL('migrations/650_retire_messages.sql', sqlRoot), 'utf8');
const oldTables = ['message_threads', 'messages', 'message_thread_participants', 'message_attachments'];
function beforeDrop() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(new URL('schema_baseline.sql', sqlRoot), 'utf8'));
  for (const name of readdirSync(new URL('migrations/', sqlRoot)).filter((n) => migrationNumber(n) > BASELINE_CUTOFF && migrationNumber(n) < 650).sort(compareMigrations)) {
    db.exec(readFileSync(new URL('migrations/' + name, sqlRoot), 'utf8'));
  }
  return db;
}
const hasTable = (db: DatabaseSync, table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);

test('empty migrated stores disappear, including the assertion helper', () => {
  const db = beforeDrop();
  try {
    for (const table of oldTables) assert.ok(hasTable(db, table), table);
    db.exec(migration);
    for (const table of [...oldTables, 'd1345_messages_empty_guard']) assert.equal(hasTable(db, table), false, table);
    assert.ok(hasTable(db, 'mail_drafts'), 'Email drafts survive');
  } finally { db.close(); }
});

for (const occupied of oldTables) test(`any row in ${occupied} prevents every DROP`, () => {
  const db = beforeDrop();
  try {
    // Minimal fixture tables preserve each production table's identity; the guard must count all four.
    db.exec(`DROP TABLE ${occupied}; CREATE TABLE ${occupied}(id INTEGER); INSERT INTO ${occupied} VALUES(1)`);
    assert.throws(() => db.exec(migration), /CHECK constraint failed/);
    for (const table of oldTables) assert.ok(hasTable(db, table), table);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${occupied}`).get()!.n, 1);
  } finally { db.close(); }
});

