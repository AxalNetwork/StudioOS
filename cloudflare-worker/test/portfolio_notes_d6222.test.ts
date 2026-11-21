/**
 * D6222 (#6222) — an investor's private notes on a portfolio company
 * (`/api/portfolio-notes`, routes/portfolio_notes.ts, over migration
 * 202611171211_6222_investor_company_notes.sql), on real SQLite over the
 * baseline and every later migration.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/portfolio_notes_d6222.test.ts
 *
 * Who: INV_A is owed reports by the company (a reporting duty), INV_H holds it
 * through a confirmed commitment and is owed nothing, INV_B is owed reports by
 * the same company, the FOUNDER runs it, STRANGER holds and is owed nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import notes, { NOTE_REFUSALS } from '../src/routes/portfolio_notes.ts';
import { loadSchema } from './_schema_once.mjs';

const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const out = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END").all() as any[]).map((x) => x.sql as string);
  db.close();
  return out;
})();
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-d6222';

const app = new Hono<any>();
app.route('/api/portfolio-notes', notes);

const ADMIN = 1, FOUNDER = 3, INV_A = 6, INV_B = 7, INV_H = 8, STRANGER = 9;
const ROLE: Record<number, string> = { 1: 'admin', 3: 'founder', 6: 'investor', 7: 'investor', 8: 'investor', 9: 'investor' };
const CO = '/api/portfolio-notes/companies/proj-seven';

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  DDL.forEach((s) => db.exec(s));
  db.exec(`
    INSERT INTO founders (id, name, email) VALUES (31, 'Fay Founder', 'fay@example.test');
    INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES
      (1, 'admin', 'Ada Admin', 'ada@example.test', NULL, 1), (3, 'founder', 'Fay Founder', 'fay@example.test', 31, 1),
      (6, 'investor', 'Ivy Alpha', 'ivy@example.test', NULL, 1), (7, 'investor', 'Ben Beta', 'ben@example.test', NULL, 1),
      (8, 'investor', 'Hal Holder', 'hal@example.test', NULL, 1), (9, 'investor', 'Sam Stranger', 'sam@example.test', NULL, 1);
    INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'proj-seven', 'Fixture Robotics', 31), (8, 'proj-eight', 'Other Venture', 31);
    INSERT INTO reporting_duties (id, uid, closing_id, closing_line_id, closing_line_uid, project_id, holder_user_id, kind, cadence, due_days,
        source_document, source_clause, source_kind, starts_on) VALUES
      (1, 'duty-a', 1, 11, 'ln-a', 7, 6, 'quarterly_kpi', 'quarterly', 45, 'voting_rights', '§1.1(b)', 'closing_template', '2026-01-01'),
      (2, 'duty-b', 1, 12, 'ln-b', 7, 7, 'quarterly_kpi', 'quarterly', 45, 'voting_rights', '§1.1(b)', 'closing_template', '2026-01-01');
    -- INV_H holds proj-seven (a dealroom and a confirmed commitment); STRANGER is in the room with only a pending one.
    INSERT INTO deals (id, uid, project_id, status, currency) VALUES (70, 'deal-seven', 7, 'active', 'USD');
    INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (8, 70), (9, 70);
    INSERT INTO commitments (id, uid, deal_id, investor_user_id, amount, status) VALUES (1, 'c-h', 70, 8, 100, 'confirmed'), (2, 'c-s', 70, 9, 100, 'pending');
    -- Two reports the company sent INV_A, one it sent only INV_B, one still a draft.
    INSERT INTO portfolio_updates (id, uid, project_id, author_user_id, title, status, kind, sent_at) VALUES
      (1, 'rep-q2', 7, 3, 'Q2', 'submitted', 'report', '2026-08-18 10:00:00'),
      (2, 'rep-q3', 7, 3, 'Q3', 'submitted', 'report', '2026-11-10 10:00:00'),
      (3, 'rep-b', 7, 3, 'Q3 B', 'submitted', 'report', '2026-11-10 10:00:00'),
      (4, 'rep-draft', 7, 3, 'Q4', 'draft', 'report', NULL);
    INSERT INTO update_recipients (update_id, audience, user_id) VALUES (1, 'investor', 6), (2, 'investor', 6), (3, 'investor', 7), (4, 'investor', 6);
  `);
  return db;
}

const envOf = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) }) as any;
async function token(user: number, extra: Record<string, unknown> = {}) {
  return new SignJWT({ user_id: user, role: ROLE[user], ...extra }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
async function call(env: any, method: string, path: string, as: number, body?: unknown, claims: Record<string, unknown> = {}) {
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${await token(as, claims)}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}
const rows = (db: DatabaseSync) => JSON.parse(JSON.stringify(db.prepare('SELECT author_user_id, project_id, body, source, from_report_uid, to_report_uid FROM investor_company_notes ORDER BY id').all()));

test('the migration: one table keyed by author and company, the source both-or-neither, the body 1–10,000 characters', () => {
  const db = freshDb();
  const cols = (db.prepare("SELECT name, \"notnull\" AS nn FROM pragma_table_info('investor_company_notes')").all() as any[]).map((c) => `${c.name}:${c.nn}`);
  assert.deepEqual(cols, ['id:0', 'uid:1', 'author_user_id:1', 'project_id:1', 'body:1', 'source:0', 'from_report_uid:0', 'to_report_uid:0', 'created_at:1', 'updated_at:1']);
  const ins = (body: string, source: string | null, from: string | null, to: string | null) =>
    db.prepare('INSERT INTO investor_company_notes (author_user_id, project_id, body, source, from_report_uid, to_report_uid) VALUES (6, 7, ?, ?, ?, ?)').run(body, source, from, to);
  ins('fine', null, null, null);
  ins('from what changed', 'what_changed', 'a', 'b');
  assert.throws(() => ins('one report only', 'what_changed', 'a', null), /CHECK/);
  assert.throws(() => ins('reports with no source', null, 'a', 'b'), /CHECK/);
  assert.throws(() => ins('other source', 'chat', null, null), /CHECK/);
  assert.throws(() => ins('   ', null, null, null), /CHECK/);
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_investor_company_notes_author'").get();
  assert.ok(idx, 'the author index exists');
});

test('an investor owed reports writes, reads, edits and deletes only their own notes; dates come back from the stored row', async () => {
  const db = freshDb(); const env = envOf(db);
  const made = await call(env, 'POST', CO, INV_A, { body: '  Q3 looked slow on hiring.  ' });
  assert.equal(made.status, 201, made.text);
  assert.equal(made.body.note.body, 'Q3 looked slow on hiring.');
  assert.equal(made.body.note.source, null);
  assert.match(made.body.note.created_at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(made.body.note.edited, false);
  assert.ok(!('author_user_id' in made.body.note), 'no note names a user');

  const list = await call(env, 'GET', CO, INV_A);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.items.map((n: any) => n.body), ['Q3 looked slow on hiring.']);
  assert.equal(list.body.can_write, true);

  // Another investor owed reports by the same company sees none of it, and cannot touch it.
  const other = await call(env, 'GET', CO, INV_B);
  assert.equal(other.status, 200);
  assert.deepEqual(other.body.items, [], 'another investor reads only their own (none)');
  const uid = made.body.note.uid;
  assert.equal((await call(env, 'PUT', `/api/portfolio-notes/${uid}`, INV_B, { body: 'hijack' })).status, 404);
  assert.equal((await call(env, 'DELETE', `/api/portfolio-notes/${uid}`, INV_B)).status, 404);
  // The founder of the company, and an admin who holds nothing, get 404 on the company's notes and on the note.
  assert.equal((await call(env, 'GET', CO, FOUNDER)).status, 404);
  assert.equal((await call(env, 'PUT', `/api/portfolio-notes/${uid}`, FOUNDER, { body: 'x' })).status, 404);
  assert.equal((await call(env, 'GET', CO, ADMIN)).status, 404);
  assert.equal((await call(env, 'DELETE', `/api/portfolio-notes/${uid}`, ADMIN)).status, 404);
  assert.equal(rows(db)[0].body, 'Q3 looked slow on hiring.', 'nobody else changed it');

  const edited = await call(env, 'PUT', `/api/portfolio-notes/${uid}`, INV_A, { body: 'Hiring picked up in October.' });
  assert.equal(edited.status, 200, edited.text);
  assert.equal(edited.body.note.body, 'Hiring picked up in October.');
  assert.equal(edited.body.note.created_at, made.body.note.created_at);
  assert.equal((await call(env, 'PUT', `/api/portfolio-notes/${uid}`, INV_A, { body: '   ' })).body.error, 'invalid_note');

  const gone = await call(env, 'DELETE', `/api/portfolio-notes/${uid}`, INV_A);
  assert.equal(gone.status, 200);
  assert.deepEqual(rows(db), []);
  assert.equal((await call(env, 'DELETE', `/api/portfolio-notes/${uid}`, INV_A)).status, 404);
});

test('a holder owed nothing may keep notes; a non-holder owed nothing, and a founder, cannot write one', async () => {
  const db = freshDb(); const env = envOf(db);
  const held = await call(env, 'POST', CO, INV_H, { body: 'Held through the round.' });
  assert.equal(held.status, 201, held.text);
  const stranger = await call(env, 'POST', CO, STRANGER, { body: 'Not mine to write.' });
  assert.equal(stranger.status, 404);
  assert.equal(stranger.body.error, 'not_found');
  assert.equal(stranger.body.message, NOTE_REFUSALS.not_found);
  assert.equal((await call(env, 'POST', CO, FOUNDER, { body: 'Founder note' })).status, 404);
  // INV_A is owed reports by proj-seven only.
  assert.equal((await call(env, 'POST', '/api/portfolio-notes/companies/proj-eight', INV_A, { body: 'Elsewhere' })).status, 404);
  assert.equal((await call(env, 'POST', '/api/portfolio-notes/companies/no-such', INV_A, { body: 'Nowhere' })).status, 404);
  assert.deepEqual(rows(db).map((n: any) => n.author_user_id), [INV_H]);
});

test('saved from What changed: the two reports must be ones this company sent the caller', async () => {
  const db = freshDb(); const env = envOf(db);
  const ok = await call(env, 'POST', CO, INV_A, { body: 'MRR 31,200 → 44,100', source: 'what_changed', from_report_uid: 'rep-q2', to_report_uid: 'rep-q3' });
  assert.equal(ok.status, 201, ok.text);
  assert.deepEqual(ok.body.note.source, { kind: 'what_changed', from_report_uid: 'rep-q2', to_report_uid: 'rep-q3' });
  // A report sent only to another investor, or one never sent, is not the caller's.
  const theirs = await call(env, 'POST', CO, INV_A, { body: 'x', source: 'what_changed', from_report_uid: 'rep-q2', to_report_uid: 'rep-b' });
  assert.equal(theirs.status, 409);
  assert.equal(theirs.body.error, 'source_not_received');
  const draft = await call(env, 'POST', CO, INV_A, { body: 'x', source: 'what_changed', from_report_uid: 'rep-q2', to_report_uid: 'rep-draft' });
  assert.equal(draft.status, 409);
  const half = await call(env, 'POST', CO, INV_A, { body: 'x', source: 'what_changed', from_report_uid: 'rep-q2' });
  assert.equal(half.body.error, 'invalid_source');
  assert.equal(rows(db).length, 1);
});

test('a support session reads the investor’s notes and writes nothing', async () => {
  const db = freshDb(); const env = envOf(db);
  const made = await call(env, 'POST', CO, INV_A, { body: 'Mine.' });
  const support = { impersonated_by: ADMIN };
  const list = await call(env, 'GET', CO, INV_A, undefined, support);
  assert.equal(list.status, 200);
  assert.equal(list.body.can_write, false);
  assert.equal(list.body.write_refusal, NOTE_REFUSALS.support_session_refused);
  const add = await call(env, 'POST', CO, INV_A, { body: 'From support' }, support);
  assert.equal(add.status, 403);
  assert.equal(add.body.error, 'support_session_refused');
  assert.equal((await call(env, 'PUT', `/api/portfolio-notes/${made.body.note.uid}`, INV_A, { body: 'x' }, support)).status, 403);
  assert.equal((await call(env, 'DELETE', `/api/portfolio-notes/${made.body.note.uid}`, INV_A, undefined, support)).status, 403);
  assert.deepEqual(rows(db).map((n: any) => n.body), ['Mine.']);
});

test('a failed read is a 503 with a sentence, never an empty list', async () => {
  const db = freshDb();
  db.exec('DROP TABLE investor_company_notes');
  const res = await call(envOf(db), 'GET', CO, INV_A);
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'notes_unreadable');
  assert.equal(res.body.message, NOTE_REFUSALS.notes_unreadable);
  assert.ok(!/no such table/i.test(res.text), 'the database error is not sent');
});
