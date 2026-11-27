/** D4489 (#4489) — campaign plans on real SQLite and the mounted Grow routes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import calendar, { plannedTime } from '../src/routes/grow_calendar.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const BASELINE = readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = 1; const COFOUNDER = 2; const ADVISOR = 3; const PARTNER = 4; const ADMIN = 5; const OTHER = 6;
const PA = 7; const PB = 8;

const newer = readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n)).filter((n) => migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations);

/** The baseline plus every post-cutoff migration, restored between tests. */
let pristine: DatabaseSync | undefined;
// Build every migration once; a savepoint restores the exact pristine database before each sequential test.
function build(): DatabaseSync {
  if (pristine) { pristine.exec('ROLLBACK TO campaign_fixture'); return pristine; }
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(BASELINE);
  for (const name of newer) {
    db.exec(readFileSync(resolve(M, name), 'utf8'));
  }
  db.exec('SAVEPOINT campaign_fixture');
  pristine = db;
  return db;
}

function seed(db: DatabaseSync) {
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Founder A', 'fa@example.test'), (20, 'Founder B', 'fb@example.test');`);
  const u = db.prepare('INSERT INTO users (id, email, name, role, founder_id) VALUES (?, ?, ?, ?, ?)');
  u.run(FOUNDER, 'founder@example.test', 'Fay Founder', 'founder', 10);
  u.run(COFOUNDER, 'cofounder@example.test', 'Cal Cofounder', 'founder', null);
  u.run(ADVISOR, 'advisor@example.test', 'Ada Advisor', 'founder', null);
  u.run(PARTNER, 'partner@example.test', 'Pat Partner', 'partner', null);
  u.run(ADMIN, 'admin@example.test', 'Ari Admin', 'admin', null);
  u.run(OTHER, 'other@example.test', 'Oli Other', 'founder', 20);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${PA}, 'Kestrel Labs', 10), (${PB}, 'Heron Works', 20);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (${PA}, ${COFOUNDER}, 'cofounder', 'accepted'), (${PA}, ${ADVISOR}, 'advisor', 'accepted');
    INSERT INTO roadmap_okrs (id, project_id, objective) VALUES (1, ${PA}, 'CSV export'), (2, ${PB}, 'Heron item');
    INSERT OR IGNORE INTO research_countries (code, name, region) VALUES ('ES', 'Spain', 'Europe');`);
}

function fixture() {
  const db = build();
  seed(db);
  return { db, env: { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any };
}

const app = new Hono<any>();
app.route('/api/grow/calendar', calendar);
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [COFOUNDER]: 'founder', [ADVISOR]: 'founder', [PARTNER]: 'partner', [ADMIN]: 'admin', [OTHER]: 'founder' };

async function call(f: { env: any }, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), f.env, { waitUntil() {}, passThroughOnException() {} } as any);
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) as any }; } catch { throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`); }
}

function pieces(f: any) {
  f.db.exec(`INSERT INTO content_calendar_items (id, uid, project_id, title, planned_on) VALUES
    (1, 'first', 7, 'First', '2026-11-01'), (2, 'last', 7, 'Last', '2026-11-30'),
    (3, 'before', 7, 'Before', '2026-10-31'), (4, 'other', 8, 'Other', '2026-11-15');
    INSERT INTO grow_campaigns (id, uid, project_id, name, goal) VALUES (1, 'campaign-a', 7, 'Campaign', 'awareness');
    INSERT INTO grow_campaign_items (campaign_id, kind, ref_id) VALUES (1, 'content_item', 1);`);
}
const path = '/api/grow/calendar?project=7&from=2026-11-01&to=2026-11-30';
test('inclusive range excludes other ventures and dates outside the range', async () => {
  const f = fixture(); pieces(f);
  const r = await call(f, FOUNDER, 'GET', path);
  assert.equal(r.status, 200); assert.equal(r.body.can_edit, true); assert.deepEqual(r.body.pieces.map((p: any) => p.uid), ['first', 'last']);
  assert.equal((await call(f, OTHER, 'GET', path)).status, 403);
});
test('campaign filter uses existing links and includes the campaign metadata', async () => {
  const f = fixture(); pieces(f);
  const r = await call(f, FOUNDER, 'GET', path + '&campaign=campaign-a');
  assert.deepEqual(r.body.pieces.map((p: any) => p.uid), ['first']);
  assert.equal(r.body.pieces[0].campaigns[0].name, 'Campaign');
  assert.deepEqual((await call(f, FOUNDER, 'GET', path + '&campaign=missing')).body.pieces, []);
});
test('time validation, persisted nullable time, audit and Notion ownership', async () => {
  for (const t of ['00:00', '23:59', null]) assert.equal(plannedTime(t), t);
  for (const t of ['', '24:00', '9:00', '12:60', 900, undefined]) assert.throws(() => plannedTime(t));
  const f = fixture(); pieces(f);
  const url = '/api/grow/calendar/pieces/first/time?project=7';
  assert.equal((await call(f, FOUNDER, 'PUT', url, { planned_at_time: '24:00' })).status, 400);
  assert.equal((await call(f, FOUNDER, 'PUT', url, { planned_at_time: '09:00' })).status, 200);
  assert.equal(f.db.prepare("SELECT planned_at_time FROM content_calendar_items WHERE uid='first'").get()?.planned_at_time, '09:00');
  assert.equal((await call(f, FOUNDER, 'PUT', url, { planned_at_time: null })).status, 200);
  assert.equal(f.db.prepare("SELECT planned_at_time FROM content_calendar_items WHERE uid='first'").get()?.planned_at_time, null);
  assert.equal((await call(f, OTHER, 'PUT', url, { planned_at_time: '10:00' })).status, 403);
  assert.equal((await call(f, FOUNDER, 'PUT', url.replace('first', 'other'), { planned_at_time: '10:00' })).status, 404);
  f.db.exec("UPDATE content_calendar_items SET source='notion' WHERE uid='first'");
  assert.equal((await call(f, FOUNDER, 'PUT', url, { planned_at_time: '10:00' })).status, 409);
  assert.equal((await call(f, FOUNDER, 'GET', path)).body.pieces[0].status, 'planned');
});
test('malformed and reversed dates are refused', async () => {
  const f = fixture();
  assert.equal((await call(f, FOUNDER, 'GET', path.replace('2026-11-01', '2026-02-30'))).status, 400);
  assert.equal((await call(f, FOUNDER, 'GET', path.replace('2026-11-01', '2026-12-01'))).status, 400);
});
