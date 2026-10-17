/**
 * D691 #1696, tests 1 and 2: real production-shaped obligations and a source
 * guard against the obsolete migration-034 columns. No production access.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cycleGrow from '../src/routes/cycle_grow.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { sqlStrings } from '../../scripts/check-sqlite-dialect.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const SECRET = 'd691-only-test-jwt-secret-0123456789';
const OWNER = 691;
const PROJECT = 691;

function freshDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  const migrations = resolve(SQL, 'migrations');
  for (const name of readdirSync(migrations).filter((name) => /^\d+_.*\.sql$/.test(name))
    .filter((name) => migrationNumber(name) > BASELINE_CUTOFF).sort()) {
    db.exec(readFileSync(resolve(migrations, name), 'utf8'));
  }
  return db;
}

test('1: Grow obligations save and read on a full fresh build with foreign keys enabled', async (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(OWNER, 'Example founder', 'founder@d691.example');
  db.prepare("INSERT INTO users (id, name, email, role, founder_id) VALUES (?, ?, ?, 'founder', ?)")
    .run(OWNER, 'Example founder', 'founder@d691.example', OWNER);
  db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?, ?, ?)').run(PROJECT, 'Example orchard', OWNER);
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  app.route('/api/cycles/grow', cycleGrow);
  const token = await new SignJWT({ user_id: OWNER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await app.fetch(new Request('http://test/api/cycles/grow' + path, {
      method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify({ project: PROJECT, ...body as object }),
    }), env, { waitUntil() {}, passThroughOnException() {} } as any);
    return { status: response.status, body: await response.json() as any };
  };
  const due = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const add = await call('POST', '/obligations', { title: 'Example board', kind: 'governance', due_at: due });
  assert.equal(add.status, 201);
  const row = () => db.prepare('SELECT * FROM compliance_events WHERE id = ?').get(add.body.id) as any;
  assert.deepEqual([row().due_date, row().completion_status, row().recurrence, row().event_type, row().source,
    row().kind, row().jurisdiction, row().entity_id, row().created_by_user_id, row().created_by],
    [due, 'pending', 'one_time', 'board_meeting', 'manual', 'governance', 'Unspecified', null, OWNER, OWNER]);
  const read = () => call('GET', '/modules/durable-company-building?project=' + PROJECT);
  const module = await read();
  assert.deepEqual(module.body.records.rows.find((r: any) => r.id === add.body.id),
    { id: add.body.id, title: 'Example board', kind: 'governance', due_at: due, owner_name: null, status: 'scheduled' });
  assert.ok(module.body.card.series.calendar.some((event: any) => event.title === 'Example board' && event.due === due));
  const patch = (body: unknown) => call('PATCH', '/obligations/' + add.body.id, body);
  for (const [status, completion] of [['done', 'completed'], ['snoozed', 'snoozed'], ['overdue', 'pending'],
    ['scheduled', 'pending'], ['upcoming', 'pending']]) {
    assert.equal((await patch({ status })).status, 200);
    assert.equal(row().completion_status, completion, status);
    assert.equal(row().completed_by_user_id, status === 'done' ? OWNER : null);
    if (status === 'done') assert.match(row().completed_at, /^\d{4}-\d{2}-\d{2}T/);
    else assert.equal(row().completed_at, null);
    assert.equal((await read()).body.records.rows.find((r: any) => r.id === add.body.id).status,
      status === 'done' ? 'done' : status === 'snoozed' ? 'snoozed' : 'scheduled');
  }
  db.prepare("UPDATE compliance_events SET reminders_sent_json = '[14]' WHERE id = ?").run(add.body.id);
  await patch({ owner_name: 'Example owner' });
  assert.equal(row().reminders_sent_json, '[14]', 'changing only the owner preserves sent reminders');
  await patch({ due_at: '2020-01-01' });
  assert.equal(row().reminders_sent_json, '[]');
  assert.deepEqual([(await read()).body.records.rows[0].due_at, (await read()).body.records.rows[0].status], ['2020-01-01', 'overdue']);
  const mappings = [['compliance', 'other'], ['risk', 'risk'], ['culture', 'culture'], ['tax', 'franchise_tax'], ['other', 'other']];
  for (const [index, [kind, eventType]] of mappings.entries()) {
    const date = '2099-01-' + String(index + 1).padStart(2, '0');
    const result = await call('POST', '/obligations', { title: 'Example ' + kind, kind, due_at: date });
    assert.equal(result.status, 201);
    assert.equal((db.prepare('SELECT event_type FROM compliance_events WHERE id = ?').get(result.body.id) as any).event_type, eventType);
  }
  db.prepare("INSERT INTO entities (id, name, entity_type, jurisdiction) VALUES (691, 'Example entity', 'project', 'Example jurisdiction')").run();
  db.prepare('UPDATE projects SET entity_id = 691 WHERE id = ?').run(PROJECT);
  const linked = await call('POST', '/obligations', { title: 'Linked example', kind: 'governance', due_at: due });
  assert.equal(linked.status, 201);
  const linkedRow = db.prepare('SELECT entity_id, jurisdiction FROM compliance_events WHERE id = ?').get(linked.body.id) as any;
  assert.deepEqual([linkedRow.entity_id, linkedRow.jurisdiction], [691, 'Example jurisdiction']);
  const duplicate = await call('POST', '/obligations', { title: 'Duplicate', kind: 'governance', due_at: due });
  assert.deepEqual([duplicate.status, duplicate.body.detail], [409, 'Another governance obligation is already due on ' + due + '. Pick another date.']);
  const collision = await patch({ due_at: due });
  assert.deepEqual([collision.status, collision.body.detail], [409, duplicate.body.detail]);
  const missing = await call('POST', '/obligations', { title: 'Undated', kind: 'compliance' });
  assert.deepEqual([missing.status, missing.body.detail], [400, 'An obligation has a due date.']);
  const missingEdit = await patch({ due_at: null });
  assert.deepEqual([missingEdit.status, missingEdit.body.detail], [400, missing.body.detail]);
  for (const [index, eventType] of ['annual_report', 'franchise_tax', 'registered_agent', 'other', 'board_meeting'].entries()) {
    db.prepare("INSERT INTO compliance_events (project_id, jurisdiction, event_type, title, due_date) VALUES (?, 'Unspecified', ?, ?, ?)")
      .run(PROJECT, eventType, 'Seeded ' + eventType, new Date(Date.now() + (20 + index) * 86_400_000).toISOString().slice(0, 10));
  }
  const seededRead = await read();
  const seeded = seededRead.body.records.rows.filter((r: any) => r.title.startsWith('Seeded'));
  assert.deepEqual(seededRead.body.card.series.calendar.filter((event: any) => event.title.startsWith('Seeded')).map((event: any) => event.title),
    ['Seeded annual_report', 'Seeded franchise_tax', 'Seeded registered_agent', 'Seeded other', 'Seeded board_meeting']);
  assert.deepEqual(seeded.map((r: any) => [r.kind, r.status]), [
    ['compliance', 'upcoming'], ['compliance', 'upcoming'], ['compliance', 'upcoming'], ['compliance', 'upcoming'], ['governance', 'scheduled'],
  ]);
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

test('2: no compliance_events SQL uses migration 034 due_at or bare status, including aliases', () => {
  const root = resolve(here, '../src');
  const violations: string[] = [];
  for (const path of sourceFiles(root)) {
    for (const { body, line } of sqlStrings(readFileSync(path, 'utf8'))) {
      if (/\bcompliance_events\b/i.test(body) && /\b(?:due_at|status)\b/i.test(body)) {
        violations.push(relative(root, path) + ':' + line);
      }
    }
  }
  assert.deepEqual(violations, [], 'Use baseline columns in SQL; translate the API keys in TypeScript.');
});
