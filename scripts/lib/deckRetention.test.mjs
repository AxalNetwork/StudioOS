/**
 * D1508 (#3759): the deck retention inventory check.
 *
 *   node --test scripts/lib/deckRetention.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { deckRetentionProblems, deckTables, inventoryNames } from './deckRetention.mjs';

const f = (number, sql) => ({ name: `${number}_x.sql`, number, sql });
const doc = (...names) => ['| Store | Holds |', '|---|---|', ...names.map((n) => `| \`${n}\` | x |`)].join('\n');

test('the schema is replayed: create, rename and drop, in order, comments ignored', () => {
  const t = deckTables([
    f(0, 'CREATE TABLE pitch_decks (id INTEGER);\nCREATE TABLE users (id INTEGER);'),
    f(500, 'CREATE TABLE IF NOT EXISTS deck_exports_new (id INTEGER);\nDROP TABLE deck_exports;\nALTER TABLE deck_exports_new RENAME TO deck_exports;'),
    f(501, 'CREATE TABLE deck_temp (id INTEGER);\nDROP TABLE IF EXISTS deck_temp;'),
    f(502, '-- CREATE TABLE deck_commented (id INTEGER);'),
  ]);
  assert.deepEqual([...t.keys()].sort(), ['deck_exports', 'pitch_decks'], 'users is not a deck store; the temp, the renamed-away and the commented table are gone');
});

test('a deck store with no row fails, and a row for a table that is gone fails', () => {
  const files = [f(0, 'CREATE TABLE pitch_decks (id INTEGER);\nCREATE TABLE deck_notes (id INTEGER);')];
  assert.deepEqual(deckRetentionProblems(files, doc('pitch_decks', 'deck_notes')), []);
  assert.deepEqual(deckRetentionProblems(files, doc('pitch_decks')), ['deck_notes is a deck store with no row in DATA_RETENTION.md']);
  assert.deepEqual(deckRetentionProblems(files, doc('pitch_decks', 'deck_notes', 'deck_gone')), ['DATA_RETENTION.md lists deck_gone, which no migration leaves in place']);
  assert.deepEqual([...inventoryNames('text `deck_notes` in prose\n| `deck_x` | y |')], ['deck_x'], 'only a row\'s first column counts');
});

test('a deck table from migration 722 on must cascade from its parent', () => {
  const ok = f(800, 'CREATE TABLE deck_new_store (id INTEGER, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE);');
  const bad = f(801, 'CREATE TABLE deck_loose (id INTEGER, project_id INTEGER REFERENCES projects(id));');
  const old = f(700, 'CREATE TABLE deck_older (id INTEGER, project_id INTEGER REFERENCES projects(id));');
  assert.deepEqual(deckRetentionProblems([ok, bad, old], doc('deck_new_store', 'deck_loose', 'deck_older')), ['deck_loose (migration 801) has no ON DELETE CASCADE']);
  const known = f(745, 'CREATE TABLE deck_grants (id INTEGER, deck_id INTEGER REFERENCES pitch_decks(id));');
  assert.deepEqual(deckRetentionProblems([known], doc('deck_grants')), [], 'the two made before this check are on record');
});

test('the real schema and inventory agree', async () => {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync('node', [fileURLToPath(new URL('../check-deck-retention.mjs', import.meta.url))], { encoding: 'utf8' });
  assert.match(out, /^✓ check-deck-retention: \d+ deck stores/);
});
