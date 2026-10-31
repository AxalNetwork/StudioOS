/** #3748 (N3): historical duplicate repair and atomic, stale-base deck saves. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tableFromBaseline } from './_baseline.mjs';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../sql/migrations/713_pitch_decks_unique_version.sql', import.meta.url), 'utf8');

function historicalDecks() {
  const db = new DatabaseSync(':memory:');
  db.exec(tableFromBaseline(baseline, 'pitch_decks')!);
  db.exec('CREATE INDEX idx_decks_project ON pitch_decks(project_id, version)');
  return db;
}

test('713 preserves every payload, keeps the latest id for a duplicate version, and numbers older duplicates above the original maximum', () => {
  const db = historicalDecks();
  try {
    const seed = db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (?, ?, ?, ?, ?, ?)');
    for (const [id, project, version, current] of [[1, 1, 1, 1], [2, 1, 1, 1], [3, 1, 2, 0], [4, 1, 2, 1], [5, 1, 9, 0], [6, 2, 1, 0], [7, 2, 1, 0], [8, 3, 4, 1], [9, 3, 5, 0]]) {
      seed.run(id, project, version, JSON.stringify([{ title: `Saved ${id}` }]), `Deck ${id}`, current);
    }
    const payloads = db.prepare('SELECT id, project_id, slides, title FROM pitch_decks ORDER BY id').all();
    db.exec(migration);
    assert.deepEqual(db.prepare('SELECT id, project_id, slides, title FROM pitch_decks ORDER BY id').all(), payloads);
    assert.deepEqual(db.prepare('SELECT id, version, is_current FROM pitch_decks ORDER BY id').all().map(r => [r.id, r.version, r.is_current]), [
      [1, 10, 0], [2, 1, 0], [3, 11, 0], [4, 2, 0], [5, 12, 1], [6, 2, 0], [7, 3, 1], [8, 4, 0], [9, 5, 1],
    ]);
    assert.deepEqual(db.prepare('SELECT project_id, SUM(is_current) AS n FROM pitch_decks GROUP BY project_id').all().map(r => [r.project_id, r.n]), [[1, 1], [2, 1], [3, 1]]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pitch_decks d WHERE is_current = 1 AND version <> (SELECT MAX(p.version) FROM pitch_decks p WHERE p.project_id = d.project_id)').get()!.n, 0, 'readers using the highest version see the latest saved payload');
    const once = db.prepare('SELECT * FROM pitch_decks ORDER BY id').all();
    db.exec(migration);
    assert.deepEqual(db.prepare('SELECT * FROM pitch_decks ORDER BY id').all(), once, 'replaying the correction changes no saved version');
  } finally { db.close(); }
});

test('713 enforces unique versions within each project and at most one current row, while allowing other projects and historical versions', () => {
  const db = historicalDecks();
  try {
    db.exec(migration);
    db.exec("INSERT INTO pitch_decks (project_id, version, slides, is_current) VALUES (1, 1, '[]', 1), (2, 1, '[]', 1), (1, 2, '[]', 0)");
    assert.throws(() => db.exec("INSERT INTO pitch_decks (project_id, version, slides, is_current) VALUES (1, 1, '[]', 0)"), /UNIQUE constraint failed: pitch_decks.project_id, pitch_decks.version/);
    assert.throws(() => db.exec("INSERT INTO pitch_decks (project_id, version, slides, is_current) VALUES (1, 3, '[]', 1)"), /UNIQUE constraint failed: pitch_decks.project_id/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pitch_decks').get()!.n, 3);
  } finally { db.close(); }
});
