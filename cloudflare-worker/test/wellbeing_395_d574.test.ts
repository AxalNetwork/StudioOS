/**
 * D574 part 3 — migration 395: the weekly check-in's support and decisions
 * scores and its one-per-week rule, and the resource library's kind, topic,
 * draft state and edit date.
 *
 * The tables are the baseline's DDL with migration 395 applied from disk, so
 * a migration that would not apply fails here first. The real router runs on
 * node:sqlite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import wellbeing, { resourceFields } from '../src/routes/wellbeing.ts';
import { weekSpan, validateDailyBody } from '../src/routes/wellbeing.helpers.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MEMBER = 1, ADMIN = 2;
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const M395 = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/395_wellbeing_weekly_and_library.sql'), 'utf8');
const ddl = (name: string) => {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is not in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
};

function setup() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, email TEXT, name TEXT,
             is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, subscription_tier TEXT, subscription_status TEXT);
           CREATE TABLE branch_licence (id INTEGER PRIMARY KEY, status TEXT);`);
  db.exec(ddl('wellbeing_daily_pulses'));
  db.exec(ddl('wellbeing_resources'));
  db.exec(M395);
  db.prepare(`INSERT INTO users (id, role, email) VALUES (?, 'founder', 'm@example.test'), (?, 'admin', 'a@example.test')`).run(MEMBER, ADMIN);
  return db;
}
const envOf = (db: any, over: Record<string, unknown> = {}) =>
  ({ JWT_SECRET, AXAL_ENCRYPTION_SECRET: 'k'.repeat(48), ENVIRONMENT: 'development', DB: d1Over(db), ...over }) as any;
async function call(e: any, method: string, path: string, who: number, body?: unknown) {
  const tok = await new SignJWT({ user_id: who, role: who === ADMIN ? 'admin' : 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await wellbeing.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, e);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, er = console.error, i = console.info;
  console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = er; console.info = i; }
};

test('migration 395 applies to the baseline tables and leaves every older resource published', () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(ddl('wellbeing_daily_pulses'));
  db.exec(ddl('wellbeing_resources'));
  db.prepare(`INSERT INTO wellbeing_resources (uid, category, name) VALUES ('old', 'reading', 'An older row')`).run();
  db.exec(M395);
  const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((c) => c.name);
  for (const c of ['support_enc', 'decisions_enc', 'support_plain', 'decisions_plain']) assert.ok(cols('wellbeing_daily_pulses').includes(c), c);
  for (const c of ['kind', 'topic', 'status', 'edited_at', 'file_key', 'file_type', 'file_size']) assert.ok(cols('wellbeing_resources').includes(c), c);
  assert.equal((db.prepare(`SELECT status FROM wellbeing_resources WHERE uid = 'old'`).get() as any).status, 'published');
  assert.doesNotMatch(M395, /CREATE UNIQUE INDEX/, 'the week is a rule in the route: a unique index would refuse rows from the daily era');
});

test('support and decisions are stored encrypted and read back', async () => {
  const db = setup(); const e = envOf(db);
  assert.deepEqual(validateDailyBody({ support: 6 }).ok, false);
  const r = await quiet(() => call(e, 'POST', '/checkins', MEMBER, { stress: 2, support: 4, decisions: 3, day: '2026-10-05' }));
  assert.equal(r.status, 201);
  assert.equal(r.body.support, 4);
  assert.equal(r.body.decisions, 3);
  assert.equal(r.body.stored_encrypted, true);
  const row = db.prepare('SELECT support_enc, support_plain, decisions_enc FROM wellbeing_daily_pulses').get() as any;
  assert.ok(row.support_enc && row.decisions_enc, 'stored encrypted');
  assert.equal(row.support_plain, null, 'never in the clear when the cipher works');
  const read = await quiet(() => call(e, 'GET', '/checkins', MEMBER));
  assert.equal(read.body.checkins[0].support, 4);
  assert.equal(read.body.checkins[0].decisions, 3);
});

test('one check-in per week: a second save that week replaces the first, and a new week starts a new one', async () => {
  assert.deepEqual(weekSpan('2026-10-07'), { start: '2026-10-05', end: '2026-10-11' });
  assert.deepEqual(weekSpan('2026-10-11'), { start: '2026-10-05', end: '2026-10-11' }, 'Sunday closes the week');
  const db = setup(); const e = envOf(db);
  const first = await quiet(() => call(e, 'POST', '/checkins', MEMBER, { stress: 2, day: '2026-10-05' }));
  assert.equal(first.body.replaced, false);
  assert.equal(first.body.week_start, '2026-10-05');
  const second = await quiet(() => call(e, 'POST', '/checkins', MEMBER, { stress: 4, support: 5, day: '2026-10-08' }));
  assert.equal(second.status, 201, 'a second save is never refused');
  assert.equal(second.body.replaced, true);
  assert.equal(second.body.day, '2026-10-05', 'it replaces the week\'s row on its own day');
  const rows = db.prepare('SELECT day FROM wellbeing_daily_pulses ORDER BY day').all().map((r: any) => r.day);
  assert.deepEqual(rows, ['2026-10-05']);
  const next = await quiet(() => call(e, 'POST', '/checkins', MEMBER, { stress: 3, day: '2026-10-12' }));
  assert.equal(next.body.replaced, false);
  assert.deepEqual(db.prepare('SELECT day FROM wellbeing_daily_pulses ORDER BY day').all().map((r: any) => r.day), ['2026-10-05', '2026-10-12']);
  // Another member's week is their own.
  db.prepare(`INSERT INTO users (id, role, email) VALUES (3, 'founder', 'x@example.test')`).run();
  const other = await quiet(() => call(e, 'POST', '/checkins', 3, { stress: 1, day: '2026-10-06' }));
  assert.equal(other.body.replaced, false);
});

test('a week left with several daily rows has its latest replaced, and the rest kept as history', async () => {
  const db = setup(); const e = envOf(db);
  for (const day of ['2026-09-28', '2026-09-30']) await quiet(() => call(e, 'POST', '/checkins', MEMBER, { mood: 3, day }));
  // The second save above already folded into the first; make the daily era's shape by hand.
  db.prepare(`INSERT INTO wellbeing_daily_pulses (uid, user_id, day, mood_plain) VALUES ('legacy', ?, '2026-10-01', 2)`).run(MEMBER);
  const r = await quiet(() => call(e, 'POST', '/checkins', MEMBER, { mood: 5, day: '2026-10-02' }));
  assert.equal(r.body.day, '2026-10-01', 'the latest row of the week is the one replaced');
  assert.deepEqual(db.prepare('SELECT day FROM wellbeing_daily_pulses ORDER BY day').all().map((x: any) => x.day), ['2026-09-28', '2026-10-01']);
});

test('the library: kind, topic and state are checked; a draft is the admins\' alone; an edit is dated', async () => {
  assert.equal(resourceFields({ category: 'reading', name: 'x', kind: 'podcast' }, false).ok, false);
  assert.equal(resourceFields({ category: 'reading', name: 'x', topic: 't'.repeat(61) }, false).ok, false);
  assert.equal(resourceFields({ category: 'reading', name: 'x', url: 'javascript:alert(1)' }, false).ok, false);
  assert.equal(resourceFields({ status: 'archived' }, true).ok, false);
  assert.deepEqual((resourceFields({ topic: '  Sleep ' }, true) as any).set, { topic: 'Sleep' });

  const db = setup(); const e = envOf(db);
  const draft = await quiet(() => call(e, 'POST', '/resources', ADMIN, { category: 'reading', name: 'Sleep basics', kind: 'article', topic: 'Sleep', status: 'draft', url: 'https://example.test/sleep' }));
  assert.equal(draft.status, 200);
  assert.deepEqual([draft.body.kind, draft.body.topic, draft.body.status, draft.body.edited_at], ['article', 'Sleep', 'draft', null]);
  const asMember = await quiet(() => call(e, 'GET', '/resources', MEMBER));
  assert.ok(!asMember.body.resources.some((r: any) => r.name === 'Sleep basics'), 'a member read a draft');
  const asAdmin = await quiet(() => call(e, 'GET', '/resources', ADMIN));
  assert.ok(asAdmin.body.resources.some((r: any) => r.name === 'Sleep basics' && r.status === 'draft'));
  const seeded = asMember.body.resources[0];
  assert.equal(seeded.status, 'published');
  assert.equal(seeded.kind, null, 'an older row has no kind: not recorded, never guessed');

  const bad = await quiet(() => call(e, 'PATCH', `/resources/${draft.body.id}`, ADMIN, { kind: 'podcast' }));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_kind');
  assert.equal((await quiet(() => call(e, 'PATCH', `/resources/${draft.body.id}`, MEMBER, { status: 'published' }))).status, 403);
  assert.equal((await quiet(() => call(e, 'PATCH', '/resources/99999', ADMIN, { topic: 'x' }))).body.error, 'resource_not_found');
  const pub = await quiet(() => call(e, 'PATCH', `/resources/${draft.body.id}`, ADMIN, { status: 'published', topic: 'Rest' }));
  assert.equal(pub.status, 200);
  assert.deepEqual([pub.body.status, pub.body.topic, pub.body.name, pub.body.kind], ['published', 'Rest', 'Sleep basics', 'article'], 'a field left out keeps its value');
  assert.match(String(pub.body.edited_at), /^\d{4}-\d{2}-\d{2}T/);
  assert.ok((await quiet(() => call(e, 'GET', '/resources', MEMBER))).body.resources.some((r: any) => r.name === 'Sleep basics'));
});

test('on a suspended branch, publishing an edit waits, and taking a row back to draft does not', async () => {
  const db = setup();
  db.prepare(`INSERT INTO branch_licence (id, status) VALUES (1, 'suspended')`).run();
  const id = (db.prepare(`INSERT INTO wellbeing_resources (uid, category, name, status) VALUES ('r', 'reading', 'Live', 'published') RETURNING id`).get() as any).id;
  const e = envOf(db, { BRANCH_CODE: 'lis' });
  const edit = await quiet(() => call(e, 'PATCH', `/resources/${id}`, ADMIN, { name: 'Renamed' }));
  assert.notEqual(edit.status, 200);
  assert.equal((db.prepare('SELECT name FROM wellbeing_resources WHERE id = ?').get(id) as any).name, 'Live');
  const down = await quiet(() => call(e, 'PATCH', `/resources/${id}`, ADMIN, { status: 'draft' }));
  assert.equal(down.status, 200);
  assert.equal(down.body.status, 'draft');
});
