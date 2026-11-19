/**
 * D6872 (#6872) — Grow › Company stores a compliance obligation and an other
 * obligation as two event types, on the baseline plus every migration. Every
 * venture and deadline below is invented.
 *
 *   1  both kinds can be added on the same day, and each reads back its own kind
 *      in Grow's list, its record and Calendar → Compliance's read;
 *   2  the kind filter and the due strip count them apart;
 *   3  the duplicate guard still refuses a second of the same kind that day;
 *   4  a kind-less `other` row (Calendar, or older) reads as compliance, as before;
 *   5  the migration moves Grow's old compliance rows, and leaves a clash where it is;
 *   6  Calendar's own create records the kind, and completing a repeating
 *      deadline rolls its kind forward with it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/obligation_event_types_6872.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleGrow from '../src/routes/cycle_grow.ts';
import compliance from '../src/routes/compliance.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import { obligationKind } from '../src/services/growWriters.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(resolve(here, '../sql/migrations/202611161117_6872_obligation_event_types.sql'), 'utf8');
const JWT_SECRET = ['fixture', 'key', 'for', 'd6872', 'obligation', 'types'].join('-');
const FOUNDER = 10;
const A = 1;

function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = ON');
  db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(FOUNDER, 'Ana Wren', 'f10@example.test');
  db.prepare("INSERT INTO users (id, role, name, email, founder_id, is_active, subscription_tier) VALUES (?, 'founder', ?, ?, ?, 1, 'studio')")
    .run(FOUNDER, 'Ana Wren', 'u10@example.test', FOUNDER);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${A}, 'Harbour Lantern', ${FOUNDER})`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);
app.route('/api/cycles', createCycleRecords());
app.route('/api/compliance', compliance);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: DatabaseSync, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const add = (db: DatabaseSync, title: string, kind: string, due_at: string) =>
  call(db, 'POST', '/api/cycles/grow/obligations', { project: A, title, kind, due_at });
const list = (db: DatabaseSync, qs = '') => call(db, 'GET', `/api/cycles/grow/modules/durable-company-building?project=${A}${qs}`);
const rec = (db: DatabaseSync, id: number) => call(db, 'GET', `/api/cycles/grow/modules/durable-company-building/records/${id}?project=${A}`);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10); // clock-ok: relative
const stored = (db: DatabaseSync) => Object.fromEntries((db.prepare('SELECT title, event_type, kind FROM compliance_events ORDER BY id').all() as any[])
  .map((r) => [r.title, `${r.event_type}/${r.kind}`]));

test('1: a compliance and an other obligation fall on the same day; each reads back its own kind everywhere', async () => {
  const db = fixture();
  const due = day(10);
  const c = await add(db, 'Renew the trading licence', 'compliance', due);
  const o = await add(db, 'Move the registered office', 'other', due);
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(o.status, 201, JSON.stringify(o.body));
  assert.deepEqual(stored(db), { 'Renew the trading licence': 'compliance/compliance', 'Move the registered office': 'other/other' });

  const kinds = Object.fromEntries((await list(db)).body.records.rows.map((r: any) => [r.title, r.kind]));
  assert.deepEqual(kinds, { 'Renew the trading licence': 'compliance', 'Move the registered office': 'other' });
  const fact = async (id: number) => (await rec(db, id)).body.facts.find((f: any) => f.k === 'Kind' || f.label === 'Kind');
  assert.match(JSON.stringify(await fact(c.body.id)), /Compliance/);
  assert.match(JSON.stringify(await fact(o.body.id)), /Other/);

  const cal = (await call(db, 'GET', `/api/compliance/events?project_id=${A}`)).body;
  const rows = (Array.isArray(cal) ? cal : cal.events || cal.items || []) as any[];
  const types = Object.fromEntries(rows.map((r) => [r.title, r.event_type]));
  assert.deepEqual(types, { 'Renew the trading licence': 'compliance', 'Move the registered office': 'other' });
});

test('2: the kind filter and the due strip count the two kinds apart', async () => {
  const db = fixture();
  await add(db, 'Renew the trading licence', 'compliance', day(5));
  await add(db, 'Move the registered office', 'other', day(5));
  await add(db, 'File the data-protection return', 'compliance', day(60));
  const all = (await list(db)).body;
  assert.deepEqual(all.parts.due_counts, { overdue: 0, next_30: 2, next_90: 1, later: 0, none: 0 });
  const only = async (kind: string) => (await list(db, `&filter=${encodeURIComponent(`kind:${kind}`)}`)).body.records.rows.map((r: any) => r.title).sort();
  assert.deepEqual(await only('compliance'), ['File the data-protection return', 'Renew the trading licence']);
  assert.deepEqual(await only('other'), ['Move the registered office']);
});

test('3: the duplicate guard still refuses a second obligation of the same kind on the same day', async () => {
  const db = fixture();
  assert.equal((await add(db, 'Renew the trading licence', 'compliance', day(5))).status, 201);
  const again = await add(db, 'Renew the licence again', 'compliance', day(5));
  assert.equal(again.status, 409);
  assert.match(JSON.stringify(again.body), /compliance obligation is already due/);
  assert.equal((await add(db, 'Move the registered office', 'other', day(5))).status, 201);
  assert.equal((await add(db, 'Another other', 'other', day(5))).status, 409);
});

test('4: a kind-less row keeps reading as it did; a stored kind always wins', () => {
  assert.equal(obligationKind({ event_type: 'other', kind: null }), 'compliance');
  assert.equal(obligationKind({ event_type: 'compliance', kind: null }), 'compliance');
  assert.equal(obligationKind({ event_type: 'other', kind: 'other' }), 'other');
  assert.equal(obligationKind({ event_type: 'board_meeting', kind: null }), 'governance');
  assert.equal(obligationKind({ event_type: 'annual_report', kind: null }), 'compliance');
});

test('5: the migration moves Grow\'s old compliance rows to their own type; a clash and a kind-less row stay put', () => {
  const db = fixture();
  const ins = db.prepare("INSERT INTO compliance_events (project_id, jurisdiction, event_type, title, due_date, kind) VALUES (?, 'Unspecified', ?, ?, ?, ?)");
  ins.run(A, 'other', 'Old Grow compliance', '2026-12-01', 'compliance');
  ins.run(A, 'other', 'Old Calendar other', '2026-12-02', null);
  ins.run(A, 'other', 'Old Grow other', '2026-12-03', 'other');
  ins.run(A, 'other', 'Old clashing compliance', '2026-12-04', 'compliance');
  ins.run(A, 'compliance', 'New compliance that day', '2026-12-04', 'compliance');
  db.exec(MIGRATION);
  db.exec(MIGRATION); // twice is the same as once
  assert.deepEqual(stored(db), {
    'Old Grow compliance': 'compliance/compliance',
    'Old Calendar other': 'other/null',
    'Old Grow other': 'other/other',
    'Old clashing compliance': 'other/compliance',
    'New compliance that day': 'compliance/compliance',
  });
});

test('6: Calendar\'s create records the kind; completing a repeating deadline rolls the kind forward', async () => {
  const db = fixture();
  const made = await call(db, 'POST', '/api/compliance/events', { project_id: A, event_type: 'other', title: 'Renew the domain', due_date: '2026-12-10', recurrence: 'annual' });
  assert.ok(made.status < 300, JSON.stringify(made.body));
  assert.equal(stored(db)['Renew the domain'], 'other/other');
  const filing = await call(db, 'POST', '/api/compliance/events', { project_id: A, event_type: 'annual_report', title: 'Annual report', due_date: '2026-12-10' });
  assert.ok(filing.status < 300);
  assert.equal(stored(db)['Annual report'], 'annual_report/null');

  const g = await add(db, 'Quarterly licence check', 'compliance', '2026-12-15');
  db.prepare("UPDATE compliance_events SET recurrence = 'quarterly' WHERE id = ?").run(g.body.id);
  const done = await call(db, 'PATCH', `/api/compliance/events/${g.body.id}`, { completion_status: 'completed' });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const next = db.prepare("SELECT event_type, kind FROM compliance_events WHERE title = 'Quarterly licence check' AND id <> ?").get(g.body.id) as any;
  assert.deepEqual({ ...next }, { event_type: 'compliance', kind: 'compliance' });
});
