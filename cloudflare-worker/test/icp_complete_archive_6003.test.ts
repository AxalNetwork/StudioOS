/** D6003 (#6003): complete ICP records, archive without changing fit, reject stale and foreign writes. */
import type { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import cycleValidate from '../src/routes/cycle_validate.ts';
import { archiveSegment, updateSegment } from '../src/services/validateWriters.ts';
import type { RecordContent, RecordRegistry } from '../src/services/records/types.ts';
import { RECORD_SPECS } from '../src/services/records/index.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { openSchema } from './_schema_once.mjs';

const KEY = ['fixture', 'key', 'for', 'd690', 'tests'].join('-');
const P = 1, OTHER_P = 2;
const roles: Record<number, string> = { 10: 'founder', 20: 'founder', 30: 'admin', 40: 'partner', 50: 'investor', 60: 'exploring', 70: 'advisor' };

function fixture() {
  const db = openSchema(); // D5503: current-schema isolated cached file copy.
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, ?)');
  for (const [id, role, founder] of [[10, 'founder', 1001], [20, 'founder', 1002], [30, 'admin', null],
    [40, 'partner', null], [50, 'investor', null], [60, 'exploring', 1001], [70, 'advisor', null]] as const) {
    u.run(id, role, `User ${id}`, `user${id}@example.test`, founder, id === 60 ? 1 : 0);
  }
  db.exec("INSERT INTO projects (id, name, founder_id) VALUES (1, 'Project One', 1001), (2, 'Project Two', 1002)");
  db.exec("INSERT INTO pain_groups (id, project_id, title) VALUES (11, 1, 'Theme One'), (22, 2, 'Theme Two')");
  db.exec("INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (31, 1, 'Fixture Person')");
  return db;
}

/** Every SQL text the route prepares, so a test can say which tables were never read. */
const prepared: string[] = [];
function recording(db: DatabaseSync) {
  const d1 = d1Over(db) as any;
  return new Proxy(d1, { get(target, key) {
    if (key === 'prepare') return (sql: string) => { prepared.push(sql); return target.prepare(sql); };
    const value = target[key];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

const spec = {
  read: 'read' as const, write: 'write' as const, store: 'pain_groups' as const,
  async record(_ctx: unknown, id: string): Promise<RecordContent> { return {
    title: `Theme ${id}`, sub: 'A discovered problem', pills: [], facts: [
      { label: 'Severity', value: null, reason: 'No severity recorded' },
      { label: 'Mentions', value: 0 },
      { label: 'Trend', value: null, reason: 'No timeline recorded' },
      { label: 'First heard', value: null, reason: 'No date recorded' },
    ],
  }; },
  sections: [
    { key: 'public', title: 'Public', async read() { return { rows: [{ a: 'Public fact' }] }; } },
    { key: 'writer', title: 'Writer', gate: 'write' as const, async read() { return { rows: [{ a: 'Private fact' }] }; } },
  ],
  async actions() { return [{ key: 'edit', label: 'Edit', kind: 'write' as const,
    async execute() { return { ok: true }; } }]; },
  async formOptions(_ctx: unknown, query: Record<string, string>) { return query; },
};
// Customer research's fixture reads its real store, so its record ids are interviews.
const registry: RecordRegistry = { validate: { 'problem-discovery': spec,
  'customer-research': { ...spec, store: 'discovery_interviews', formOptions: undefined } } };

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown,
  activeRegistry: RecordRegistry = registry) {
  const app = new Hono<any>();
  app.route('/api/cycles', createCycleRecords(activeRegistry));
  app.route('/api/cycles/validate', cycleValidate);
  app.onError((error: Error, c) => c.json({ detail: error.message }, 500));
  const token = await new SignJWT({ user_id: who, role: roles[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(KEY));
  const res = await withThrownResponses(() => app.request(`/api/cycles${path}`, { method, headers: {
    Authorization: `Bearer ${token}`,
    ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
  }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) },
  { DB: recording(db), JWT_SECRET: KEY, ENVIRONMENT: 'development' } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}


test('D6003 archive is confirmed, logged and removes only the active segment, keeping interview history and fit', async () => {
  const db = fixture();
  try {
    db.exec("INSERT INTO customer_segments (id, project_id, name, name_norm, created_by) VALUES (81, 1, 'Operators', 'operators', 10), (82, 2, 'Other venture', 'other venture', 20)");
    db.exec("UPDATE discovery_interviews SET segment_id = 81, icp_fit = 'strong' WHERE id = 31");
    const path = '/validate/modules/ideal-customer-profile/records/81?project=1';
    const read = await call(db, 10, 'GET', path, undefined, RECORD_SPECS);
    assert.equal(read.status, 200);
    const archive = read.body.actions.find((a: any) => a.key === 'archive');
    assert.equal(archive.confirm.cta, 'Archive');
    const denied = await call(db, 40, 'POST', '/validate/modules/ideal-customer-profile/records/81/actions/archive?project=1', {}, RECORD_SPECS);
    assert.equal(denied.status, 403);
    const foreign = await call(db, 10, 'POST', '/validate/modules/ideal-customer-profile/records/82/actions/archive?project=1', {}, RECORD_SPECS);
    assert.equal(foreign.status, 404);
    const archived = await call(db, 10, 'POST', '/validate/modules/ideal-customer-profile/records/81/actions/archive?project=1', {}, RECORD_SPECS);
    assert.equal(archived.status, 200);
    assert.ok(db.prepare('SELECT archived_at FROM customer_segments WHERE id = 81').get()?.archived_at);
    assert.deepEqual({ ...db.prepare('SELECT segment_id, icp_fit FROM discovery_interviews WHERE id = 31').get() }, { segment_id: 81, icp_fit: 'strong' });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'segment_archived'").get()?.n, 1);
    assert.equal((await call(db, 10, 'GET', path, undefined, RECORD_SPECS)).status, 404);
    assert.equal((await call(db, 10, 'GET', path.replace('?project=', '/activity?project='), undefined, RECORD_SPECS)).status, 404);
    assert.equal((await call(db, 10, 'POST', '/validate/segments?project=1', { name: 'Operators' }, RECORD_SPECS)).status, 409);
    assert.equal((await call(db, 10, 'PATCH', path, { context: 'stale' }, RECORD_SPECS)).status, 404);
    const list = await call(db, 10, 'GET', '/validate/modules/ideal-customer-profile?project=1', undefined, RECORD_SPECS);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.records.rows, []);
    assert.equal(list.body.card.state, 'empty');
    assert.equal(list.body.card.series, null);
    const opts = await call(db, 10, 'GET', '/validate/modules/customer-research/form-options?project=1', undefined, RECORD_SPECS);
    assert.equal(opts.status, 200);
    assert.ok(!JSON.stringify(opts.body).includes('Operators'));
  } finally { db.close(); }
});


test('D6003 ICP read offers the four real sorts and only evidence the store can return', async () => {
  const db = fixture();
  try {
    db.exec("INSERT INTO customer_segments (id, project_id, name, name_norm, created_by) VALUES (81, 1, 'Zulu', 'zulu', 10), (83, 1, 'Alpha', 'alpha', 10)");
    db.exec("UPDATE discovery_interviews SET segment_id = 81, icp_fit = 'strong', done_at = '2026-11-01' WHERE id = 31");
    const read = async (sort: string) => (await call(db, 10, 'GET', `/validate/modules/ideal-customer-profile?project=1&sort=${sort}`, undefined, RECORD_SPECS)).body.records;
    const evidence = await read('evidence');
    assert.deepEqual(evidence.sorts.map((s: any) => s.key), ['evidence', 'name', 'strong', 'interviews']);
    assert.deepEqual(evidence.filters.find((f: any) => f.key === 'evidence').options.map((o: any) => o.value), ['anecdote', 'pattern', 'not_recorded']);
    assert.deepEqual((await read('name')).rows.map((r: any) => r.segment), ['Alpha', 'Zulu']);
    for (const sort of ['evidence', 'strong', 'interviews']) assert.deepEqual((await read(sort)).rows.map((r: any) => r.segment), ['Zulu', 'Alpha']);
  } finally { db.close(); }
});


test('D6003 concurrent archive attempts produce one state change and one audit record', async () => {
  const db = fixture();
  try {
    db.exec("INSERT INTO customer_segments (id, project_id, name, name_norm, created_by) VALUES (88, 1, 'Concurrent segment', 'concurrent segment', 10)");
    const input = { projectId: 1, userId: 10, segmentId: 88 };
    const results = await Promise.allSettled([archiveSegment({ DB: d1Over(db) } as any, input), archiveSegment({ DB: d1Over(db) } as any, input)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'segment_archived'").get()?.n, 1);
  } finally { db.close(); }
});

test('D6003 an edit losing a race to archive refuses without a phantom edit audit', async () => {
  const db = fixture();
  try {
    db.exec("INSERT INTO customer_segments (id, project_id, name, name_norm, context, created_by) VALUES (89, 1, 'Archived during edit', 'archived during edit', 'Original context', 10)");
    const d1 = d1Over(db) as any;
    let archived = false;
    const DB = new Proxy(d1, { get(target, key) {
      if (key === 'prepare') return (sql: string) => {
        if (/^\s*UPDATE customer_segments\s+SET name/.test(sql)) {
          db.exec('UPDATE customer_segments SET archived_at = CURRENT_TIMESTAMP WHERE id = 89');
          archived = true;
        }
        return target.prepare(sql);
      };
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    await assert.rejects(updateSegment({ DB } as any, { projectId: 1, userId: 10, segmentId: 89, context: 'Stale change' }),
      (error: any) => error.status === 404);
    assert.equal(archived, true);
    assert.equal(db.prepare('SELECT context FROM customer_segments WHERE id = 89').get()?.context, 'Original context');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'segment_edited'").get()?.n, 0);
  } finally { db.close(); }
});

test('D6003 renaming onto an archived name explains the conflict without changing names or history', async () => {
  const db = fixture();
  try {
    db.exec("INSERT INTO customer_segments (id, project_id, name, name_norm, created_by) VALUES (81, 1, 'Operators', 'operators', 10), (83, 1, 'Active segment', 'active segment', 10), (84, 1, 'Existing active', 'existing active', 10)");
    const archive = await call(db, 10, 'POST', '/validate/modules/ideal-customer-profile/records/81/actions/archive?project=1', {}, RECORD_SPECS);
    assert.equal(archive.status, 200);
    const list = await call(db, 10, 'GET', '/validate/modules/ideal-customer-profile?project=1&sort=name', undefined, RECORD_SPECS);
    assert.deepEqual(list.body.records.rows.map((r: any) => r.segment), ['Active segment', 'Existing active']);
    const edit = '/validate/modules/ideal-customer-profile/records/83/actions/edit?project=1';
    const archivedClash = await call(db, 10, 'POST', edit, { name: 'Operators' }, RECORD_SPECS);
    assert.equal(archivedClash.status, 409);
    assert.equal(archivedClash.body.detail, 'This segment name is archived. Choose another name.');
    const activeClash = await call(db, 10, 'POST', edit, { name: 'Existing active' }, RECORD_SPECS);
    assert.equal(activeClash.status, 409);
    assert.equal(activeClash.body.detail, 'Another segment already has that name');
    assert.equal(db.prepare('SELECT name FROM customer_segments WHERE id = 83').get()?.name, 'Active segment');
    assert.equal(db.prepare('SELECT name_norm FROM customer_segments WHERE id = 81').get()?.name_norm, 'operators');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'segment_edited'").get()?.n, 0);
  } finally { db.close(); }
});
