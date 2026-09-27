/**
 * D424 — Eadwyn's mark on the Validate board's claims, from `fill_provenance`.
 *
 * The accept path has written a provenance row for every hypothesis taken from
 * the proposal band since migration 246, and the board never read one back:
 * the market page was the only reader. `claimFills` is the board's reader, and
 * three things about it fail quietly in the direction that looks finished:
 *
 *   · a mark over a claim the founder has since rewritten — "Eadwyn" over
 *     their own sentence;
 *   · a mark borrowed from another venture's claim with the same row id
 *     space — provenance is keyed by table and row, not by project;
 *   · a failed read folded into "no marks" — every claim then reads as typed
 *     by hand.
 *
 * The rows are written by `recordFill`, the accept path's own writer, over
 * real SQLite, so `edited` is derived the way production derives it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeD1 } from './_d1_sqlite.mjs';
import { recordFill } from '../src/services/fills/provenance.ts';
import { claimFills } from '../src/routes/founder_validate.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

// `fill_provenance` itself is created by `ensureFillProvenanceSchema`, the
// runtime copy of migration 246, on the first write; its two foreign keys
// need their parents to exist.
const SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY);
  CREATE TABLE validate_proposals (id INTEGER PRIMARY KEY);
  CREATE TABLE hypotheses (
    id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, code TEXT,
    claim TEXT NOT NULL, sort_order INTEGER DEFAULT 0, retired_at TEXT
  );`;
const SEED = `
  INSERT INTO users (id) VALUES (42);
  INSERT INTO hypotheses (id, project_id, claim) VALUES
    (1, 7, 'Procurement blocks a trial'),
    (2, 7, 'Founders rewrote this one'),
    (3, 7, 'Edited before accepting'),
    (4, 7, 'Typed by hand'),
    (5, 8, 'Another venture''s claim'),
    (6, 7, 'Filled twice, second text kept');`;

const fill = (env: any, rowId: number, proposed: string, written: string, model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast') =>
  recordFill(env, {
    target: { table: 'hypotheses', rowId, column: 'claim' },
    proposalId: null, fillClass: 'synthesis', proposedValue: proposed, writtenValue: written,
    citation: null, model, task: 'validate_draft_hypotheses', decidedBy: 42,
  } as any);

async function board() {
  const env: any = makeD1(SCHEMA, SEED);
  await fill(env, 1, 'Procurement blocks a trial', 'Procurement blocks a trial');
  await fill(env, 2, 'The original drafted text', 'The original drafted text');
  await env.DB.prepare(`UPDATE hypotheses SET claim = 'Founders rewrote this one' WHERE id = 2`).run();
  await fill(env, 3, 'Drafted wording', 'Edited before accepting');
  await fill(env, 5, "Another venture's claim", "Another venture's claim");
  await fill(env, 6, 'First text', 'First text', '@cf/old');
  await fill(env, 6, 'Filled twice, second text kept', 'Filled twice, second text kept', '@cf/new');
  const items = (await env.DB.prepare('SELECT * FROM hypotheses WHERE project_id = ?').bind(7).all()).results;
  return { env, items, marks: await claimFills(env, 7, items) };
}

test('a claim that still says what Eadwyn wrote carries the mark, with its model', async () => {
  const { marks } = await board();
  assert.deepEqual(marks.get(1), {
    edited: false, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', fill_class: 'synthesis',
  });
});

test('a claim the founder rewrote by hand is theirs, and carries no mark', async () => {
  const { marks } = await board();
  assert.equal(marks.has(2), false, 'the mark survived a hand rewrite — "Eadwyn" over the founder\'s sentence');
});

test('a proposal corrected before accepting says so', async () => {
  const { marks } = await board();
  assert.equal(marks.get(3)?.edited, true);
});

test('a claim typed by hand has no mark', async () => {
  const { marks } = await board();
  assert.equal(marks.has(4), false);
});

test('another venture\'s provenance never reaches this board', async () => {
  // EVERY claim in the table is handed over, project 8's included, so the only
  // thing keeping venture 8's mark off venture 7's board is the query's own
  // project scope — which is what this pins.
  const { env } = await board();
  const every = (await env.DB.prepare('SELECT * FROM hypotheses').all()).results;
  const marks = await claimFills(env, 7, every);
  assert.equal(marks.has(5), false, 'provenance crossed ventures');
  assert.deepEqual([...marks.keys()].sort(), [1, 3, 6]);
});

test('the newest provenance row is the one that speaks for a claim', async () => {
  const { marks } = await board();
  assert.equal(marks.get(6)?.model, '@cf/new', 'an older fill spoke over the newer one');
});

test('a failed read throws, and the board reports it rather than an unmarked board', async () => {
  const env: any = { DB: { prepare() { throw new Error('D1 unavailable'); }, exec: async () => { throw new Error('D1 unavailable'); } } };
  await assert.rejects(() => claimFills(env, 7, []));
  // The caller's half: a rejection sets `fills_recorded: false`, it is never
  // swallowed into an empty map that would read as "every claim typed by hand".
  const route = readFileSync(resolve(HERE, '../src/routes/founder_validate.ts'), 'utf8');
  const at = route.indexOf('const fills = await claimFills(env, projectId, items)');
  assert.ok(at > 0, 'the board no longer reads claim provenance');
  assert.match(route.slice(at, at + 200), /\.catch\(\(\) => \{\s*fillsRecorded = false;/,
    'a failed provenance read is folded into "no marks"');
  assert.match(route, /fills_recorded: fillsRecorded,/, 'the board does not report whether provenance was read');
  assert.match(route, /h\.filled = fills\.get\(Number\(h\.id\)\) \?\? null;/, 'the claims do not carry their mark');
});
