/**
 * Migration 213 replays, and the two columns that must never read as zero.
 *
 * The migration ships AHEAD of nothing — `routes/research.ts` lands with it —
 * but it is still applied by the runner on deploy, and that runner aborts on
 * the first failing statement and takes every later migration with it. So the
 * file is executed here against real SQLite rather than eyeballed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const MIGRATION = readFileSync(
  new URL('../sql/migrations/213_research_library.sql', import.meta.url), 'utf8');

/** Just enough of the referenced tables for the FK to resolve. */
function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, role TEXT);`);
  db.exec(MIGRATION);
  return db;
}

const cols = (db: any, table: string) =>
  db.prepare(`PRAGMA table_info(${table})`).all().map((r: any) => r.name);

test('the migration applies, and applies twice', () => {
  const db = freshDb();
  // Every statement is IF NOT EXISTS, so a re-run must be a no-op rather than
  // a "table already exists" that aborts the whole runner.
  db.exec(MIGRATION);
  assert.ok(cols(db, 'research_documents').includes('owner_user_id'));
});

test('it carries exactly the columns the routes read, and no text copy', () => {
  const db = freshDb();
  const c = cols(db, 'research_documents');
  for (const needed of [
    'id', 'uid', 'owner_user_id', 'title', 'kind', 'r2_key', 'content_type',
    'size_bytes', 'index_state', 'index_note', 'chunk_count', 'indexed_at',
    'created_at', 'updated_at',
  ]) {
    assert.ok(c.includes(needed), `research_documents is missing ${needed}`);
  }
  // A third copy of the document's text in D1 would disagree with the R2
  // object and the vectors the first time any of them changed.
  for (const banned of ['text', 'markdown', 'body', 'content', 'extracted_text']) {
    assert.ok(!c.includes(banned),
      `research_documents.${banned} stores a copy of the document — the file and its vectors are the source`);
  }
  // Sharing is not in this table, and its absence is the scope boundary.
  for (const banned of ['shared_with', 'shared_with_user_id', 'advisor_id', 'visibility']) {
    assert.ok(!c.includes(banned),
      `research_documents.${banned} implies a founder can share a document, which no grant type allows yet`);
  }
});

test('chunk_count and indexed_at default to NULL, never 0 or a timestamp', () => {
  // THE FAILURE THIS PINS. A `DEFAULT 0` on chunk_count would mean every
  // freshly uploaded document claims "indexed into zero chunks" — which is a
  // different fact from "not indexed yet", and would also make the delete
  // path skip its loop and orphan the vectors it should remove. A
  // `DEFAULT CURRENT_TIMESTAMP` on indexed_at would claim Ask can read a file
  // it has never seen.
  const db = freshDb();
  db.exec(`INSERT INTO users (id, email, role) VALUES (1, 'a@example.test', 'advisor')`);
  db.exec(`INSERT INTO research_documents (uid, owner_user_id, title, r2_key)
           VALUES ('u1', 1, 'Doc', 'research/1/u1.pdf')`);
  const row: any = db.prepare(`SELECT * FROM research_documents WHERE uid = 'u1'`).get();
  assert.equal(row.chunk_count, null, 'chunk_count defaulted to a number — "not indexed" now reads as "indexed, empty"');
  assert.equal(row.indexed_at, null, 'indexed_at defaulted to a time — the file claims to be readable by Ask');
  assert.equal(row.index_state, 'pending', 'a new document must start pending, not indexed');
});

test('a document belongs to a user and goes when they do', () => {
  const db = freshDb();
  db.exec(`PRAGMA foreign_keys = ON`);
  db.exec(`INSERT INTO users (id, email, role) VALUES (1, 'a@example.test', 'advisor')`);
  db.exec(`INSERT INTO research_documents (uid, owner_user_id, title, r2_key)
           VALUES ('u1', 1, 'Doc', 'research/1/u1.pdf')`);
  db.exec(`DELETE FROM users WHERE id = 1`);
  const n: any = db.prepare(`SELECT COUNT(*) AS n FROM research_documents`).get();
  assert.equal(n.n, 0, 'a deleted account left its documents behind');
});

test('the migration names no real email address', () => {
  // Same rule the other migrations in this series follow: prose in a file that
  // ships to production must not carry anybody's address.
  assert.ok(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(MIGRATION),
    'the migration contains an email address');
});
