/**
 * D618 (#1315) — a graded edit after a journal outcome stamps
 * edited_after_outcome_at. An edit before the outcome, a tags-only change,
 * and an unchanged value do not. The list and the entry read return it.
 *
 * The table is the baseline shape plus migration 415.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/journal_edited_after_outcome_d618.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import journal from '../src/routes/journal.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const OWNER = 1;
const THESIS = 'The round is led by a fund we know.';

const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
function tableDdl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  if (at < 0) throw new Error(`${name} is missing from schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, email TEXT NOT NULL, name TEXT, role TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
  )`);
  db.exec(tableDdl('decision_journal_entries'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/415_journal_edited_after_outcome.sql', 'utf8'));
  db.prepare(`INSERT INTO users (id, email, name, role) VALUES (1, 'ivy@axal.test', 'Ivy', 'investor')`).run();
  return db;
}

function addEntry(db: DatabaseSync, uid: string) {
  db.prepare(
    `INSERT INTO decision_journal_entries (uid, owner_user_id, decision, conviction, thesis, outcome_status)
     VALUES (?, ?, 'defer', 3, ?, 'pending')`,
  ).run(uid, OWNER, THESIS);
}

const app = new Hono();
app.route('/api/journal', journal as any);

async function call(db: DatabaseSync, method: string, path: string, body?: unknown) {
  const tok = await new SignJWT({ user_id: OWNER, role: 'investor' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.fetch(new Request(`http://x${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}

const stampOf = (db: DatabaseSync, uid: string) =>
  (db.prepare('SELECT edited_after_outcome_at FROM decision_journal_entries WHERE uid = ?').get(uid) as any).edited_after_outcome_at;

test('D618: an edit before the outcome leaves the mark null, and both reads say so', async () => {
  const db = freshDb();
  addEntry(db, 'j-before');
  const edited = await call(db, 'PUT', '/api/journal/j-before', { thesis: 'The round is led by a fund we do not know.' });
  assert.equal(edited.status, 200, edited.text);
  assert.equal(edited.body.edited_after_outcome_at, null);
  assert.equal(stampOf(db, 'j-before'), null);

  const one = await call(db, 'GET', '/api/journal/j-before');
  assert.equal(one.status, 200, one.text);
  assert.equal(one.body.edited_after_outcome_at, null);
  const list = await call(db, 'GET', '/api/journal');
  assert.equal(list.status, 200, list.text);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].edited_after_outcome_at, null);
});

test('D618: an edit after the outcome stamps it, and an unchanged value does not move the stamp', async () => {
  const db = freshDb();
  addEntry(db, 'j-after');
  const outcome = await call(db, 'POST', '/api/journal/j-after/outcome', { outcome_status: 'hit' });
  assert.equal(outcome.status, 200, outcome.text);
  assert.ok(outcome.body.outcome_recorded_at);
  assert.equal(stampOf(db, 'j-after'), null);

  const edited = await call(db, 'PUT', '/api/journal/j-after', { thesis: 'The round is led by a fund we do not know.' });
  assert.equal(edited.status, 200, edited.text);
  const stamped = edited.body.edited_after_outcome_at;
  assert.equal(typeof stamped, 'string');
  assert.equal(stampOf(db, 'j-after'), stamped);

  const one = await call(db, 'GET', '/api/journal/j-after');
  assert.equal(one.body.edited_after_outcome_at, stamped);
  const list = await call(db, 'GET', '/api/journal');
  assert.equal(list.body.items[0].edited_after_outcome_at, stamped);

  const again = await call(db, 'PUT', '/api/journal/j-after', { thesis: 'The round is led by a fund we do not know.' });
  assert.equal(again.status, 200, again.text);
  assert.equal(again.body.edited_after_outcome_at, stamped);
  assert.equal(stampOf(db, 'j-after'), stamped);
});

test('D618: tags alone do not stamp, and each other graded field does', async () => {
  const db = freshDb();
  addEntry(db, 'j-tags');
  const outcome = await call(db, 'POST', '/api/journal/j-tags/outcome', { outcome_status: 'miss' });
  assert.equal(outcome.status, 200, outcome.text);
  const tags = await call(db, 'PUT', '/api/journal/j-tags', { tags: ['fintech'] });
  assert.equal(tags.status, 200, tags.text);
  assert.equal(tags.body.edited_after_outcome_at, null);
  assert.deepEqual(tags.body.tags, ['fintech']);

  const fields: Array<Record<string, unknown>> = [
    { key_risks: 'One customer is most of the revenue.' },
    { expected_outcome: 'A priced round within a year.' },
    { decision: 'pass' },
    { conviction: 5 },
    { expected_multiple: 2.5 },
    { expected_timeline_months: 18 },
  ];
  for (const body of fields) {
    db.prepare(`UPDATE decision_journal_entries SET edited_after_outcome_at = NULL WHERE uid = 'j-tags'`).run();
    const r = await call(db, 'PUT', '/api/journal/j-tags', body);
    assert.equal(r.status, 200, JSON.stringify(body) + r.text);
    assert.equal(typeof r.body.edited_after_outcome_at, 'string', JSON.stringify(body));
  }
});
