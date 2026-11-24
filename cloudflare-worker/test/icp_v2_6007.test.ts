/** D6007 (#6007): the primary ICP (one per venture, logged), firmographics and disqualifiers, and Compare segments. */
import type { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import cycleValidate from '../src/routes/cycle_validate.ts';
import { archiveSegment, segmentDisqualifiers, segmentFirmographics, setPrimarySegment, updateSegment } from '../src/services/validateWriters.ts';
import { RECORD_SPECS } from '../src/services/records/index.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { openSchema } from './_schema_once.mjs';

const KEY = ['fixture', 'key', 'for', 'd6007', 'tests'].join('-');
const roles: Record<number, string> = { 10: 'founder', 20: 'founder', 40: 'partner' };

/** Venture 1 has three segments and one archived; venture 2 has one of its own. All values are invented. */
function fixture() {
  const db = openSchema();
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  for (const [id, role, founder] of [[10, 'founder', 1001], [20, 'founder', 1002], [40, 'partner', null]] as const) {
    u.run(id, role, `User ${id}`, `user${id}@example.test`, founder);
  }
  db.exec("INSERT INTO projects (id, name, founder_id) VALUES (1, 'Project One', 1001), (2, 'Project Two', 1002)");
  db.exec(`INSERT INTO customer_segments (id, project_id, name, name_norm, created_by, who_they_are, job_to_be_done, urgency, value_promised, value_source)
    VALUES (81, 1, 'Fixture ops', 'fixture ops', 10, 'Ops leads at fixture firms', 'Close the month', 'high', 'Close on day 2', 'Fixture interview'),
           (82, 1, 'Fixture finance', 'fixture finance', 10, NULL, NULL, NULL, NULL, NULL),
           (83, 1, 'Fixture owners', 'fixture owners', 10, NULL, NULL, 'low', NULL, NULL),
           (90, 2, 'Other venture', 'other venture', 20, NULL, NULL, NULL, NULL, NULL)`);
  db.exec("INSERT INTO customer_segments (id, project_id, name, name_norm, created_by, archived_at) VALUES (84, 1, 'Fixture archived', 'fixture archived', 10, '2026-11-01 00:00:00')");
  db.exec("INSERT INTO pain_groups (id, project_id, title) VALUES (11, 1, 'Theme One'), (12, 1, 'Theme Two')");
  db.exec("INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES (1, 11, 'slow close', 'Slow close'), (1, 12, 'manual matching', 'Manual matching')");
  const iv = db.prepare('INSERT INTO discovery_interviews (id, project_id, interviewee_name, segment_id, icp_fit, stage, pains_json) VALUES (?, 1, ?, ?, ?, ?, ?)');
  iv.run(31, 'Fixture A', 81, 'strong', null, JSON.stringify(['Slow close', 'Manual matching']));
  iv.run(32, 'Fixture B', 81, 'partial', 'done', JSON.stringify(['Slow close']));
  iv.run(33, 'Fixture C', 81, 'strong', null, JSON.stringify(['Slow close']));
  // Not held yet: never counted, in fit or themes.
  iv.run(34, 'Fixture D', 81, 'strong', 'invited', JSON.stringify(['Manual matching']));
  iv.run(35, 'Fixture E', 82, null, null, JSON.stringify(['Manual matching']));
  return db;
}

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const app = new Hono<any>();
  app.route('/api/cycles', createCycleRecords(RECORD_SPECS));
  app.route('/api/cycles/validate', cycleValidate);
  app.onError((error: Error, c) => c.json({ detail: error.message }, 500));
  const token = await new SignJWT({ user_id: who, role: roles[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(KEY));
  const res = await withThrownResponses(() => app.request(`/api/cycles${path}`, { method, headers: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
  }, body: body === undefined ? undefined : JSON.stringify(body) }, { DB: d1Over(db), JWT_SECRET: KEY, ENVIRONMENT: 'development' } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const primaries = (db: DatabaseSync, project = 1) =>
  (db.prepare('SELECT id FROM customer_segments WHERE project_id = ? AND is_primary = 1 ORDER BY id').all(project) as Array<{ id: number }>).map((r) => r.id);
const logged = (db: DatabaseSync, action: string) =>
  db.prepare("SELECT entity_id, details, actor FROM activity_logs WHERE entity_type = 'validate.ideal-customer-profile' AND action = ? ORDER BY id").all(action) as any[];

test('D6007 the primary ICP is one per venture: setting another clears the first, and each change is logged', async () => {
  const db = fixture();
  try {
    let r = await call(db, 10, 'PUT', '/validate/segments/81/primary?project=1', { primary: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { id: 81, primary: true, previous: null });
    assert.deepEqual(primaries(db), [81]);
    r = await call(db, 10, 'PUT', '/validate/segments/82/primary?project=1', { primary: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.previous, 81);
    assert.deepEqual(primaries(db), [82], 'setting 82 cleared 81 in the same write');
    const set = logged(db, 'segment_primary_set');
    assert.deepEqual(set.map((x) => x.entity_id), ['81', '82']);
    assert.match(set[1].details, /replacing segment 81/);
    assert.equal(set[1].actor, 'user:10');
    // Setting the one that already holds it changes and logs nothing.
    r = await call(db, 10, 'PUT', '/validate/segments/82/primary?project=1', { primary: true });
    assert.equal(r.status, 200);
    assert.equal(logged(db, 'segment_primary_set').length, 2);
    r = await call(db, 10, 'PUT', '/validate/segments/82/primary?project=1', { primary: false });
    assert.equal(r.status, 200);
    assert.deepEqual(primaries(db), []);
    assert.equal(logged(db, 'segment_primary_cleared').length, 1);
    // Venture 2 is untouched by venture 1's writes.
    assert.deepEqual(primaries(db, 2), []);
  } finally { db.close(); }
});

test('D6007 the store itself refuses a second primary on one venture, and archiving clears it', async () => {
  const db = fixture();
  try {
    db.exec('UPDATE customer_segments SET is_primary = 1 WHERE id = 81');
    assert.throws(() => db.exec('UPDATE customer_segments SET is_primary = 1 WHERE id = 83'), /UNIQUE/);
    db.exec('UPDATE customer_segments SET is_primary = 1 WHERE id = 90'); // another venture may hold its own
    await archiveSegment({ DB: d1Over(db) } as any, { projectId: 1, userId: 10, segmentId: 81 });
    assert.deepEqual(primaries(db), [], 'an archived segment is never the primary ICP');
    await assert.rejects(setPrimarySegment({ DB: d1Over(db) } as any, { projectId: 1, userId: 10, segmentId: 84, primary: true }), { status: 404 });
  } finally { db.close(); }
});

test('D6007 the primary route refuses a non-boolean, a reader and another venture’s segment', async () => {
  const db = fixture();
  try {
    assert.equal((await call(db, 10, 'PUT', '/validate/segments/81/primary?project=1', { primary: 'yes' })).status, 400);
    assert.equal((await call(db, 10, 'PUT', '/validate/segments/81/primary?project=1', {})).status, 400);
    assert.equal((await call(db, 40, 'PUT', '/validate/segments/81/primary?project=1', { primary: true })).status, 403);
    assert.equal((await call(db, 20, 'PUT', '/validate/segments/81/primary?project=1', { primary: true })).status, 403);
    assert.equal((await call(db, 10, 'PUT', '/validate/segments/90/primary?project=1', { primary: true })).status, 404);
    assert.deepEqual(primaries(db), []);
  } finally { db.close(); }
});

test('D6007 firmographics and disqualifiers are parsed, kept when not named, and cleared when empty', async () => {
  assert.deepEqual(segmentFirmographics('Company size: 50–200 people\n\n Region : Nordics '), [
    { label: 'Company size', value: '50–200 people' }, { label: 'Region', value: 'Nordics' }]);
  assert.deepEqual(segmentFirmographics([{ label: 'Mode', value: 'Road' }]), [{ label: 'Mode', value: 'Road' }]);
  assert.equal(segmentFirmographics(undefined), undefined);
  assert.equal(segmentFirmographics(''), null);
  assert.throws(() => segmentFirmographics('No colon here'), { status: 400 });
  assert.throws(() => segmentFirmographics(': value only'), { status: 400 });
  assert.throws(() => segmentFirmographics(Array.from({ length: 13 }, (_, i) => `L${i}: v`).join('\n')), { status: 400 });
  assert.deepEqual(segmentDisqualifiers('Under 20 staff\n\nNo road freight\n'), ['Under 20 staff', 'No road freight']);
  assert.equal(segmentDisqualifiers('\n \n'), null);
  const db = fixture();
  try {
    const env = { DB: d1Over(db) } as any;
    await updateSegment(env, { projectId: 1, userId: 10, segmentId: 81, firmographics: 'Region: Nordics', disqualifiers: 'Under 20 staff' });
    await updateSegment(env, { projectId: 1, userId: 10, segmentId: 81, urgency: 'medium' });
    const row = db.prepare('SELECT firmographics_json, disqualifiers_json, urgency FROM customer_segments WHERE id = 81').get() as any;
    assert.deepEqual(JSON.parse(row.firmographics_json), [{ label: 'Region', value: 'Nordics' }]);
    assert.deepEqual(JSON.parse(row.disqualifiers_json), ['Under 20 staff'], 'an edit that does not name them keeps them');
    assert.equal(row.urgency, 'medium');
    await updateSegment(env, { projectId: 1, userId: 10, segmentId: 81, firmographics: '', disqualifiers: '' });
    const cleared = db.prepare('SELECT firmographics_json, disqualifiers_json FROM customer_segments WHERE id = 81').get() as any;
    assert.deepEqual([cleared.firmographics_json, cleared.disqualifiers_json], [null, null]);
  } finally { db.close(); }
});

test('D6007 Compare reads two to four segments in the order asked, stored values only, Not recorded as null', async () => {
  const db = fixture();
  try {
    db.exec(`UPDATE customer_segments SET is_primary = 1, disqualifiers_json = '["Under 20 staff"]',
      firmographics_json = '[{"label":"Region","value":"Nordics"}]' WHERE id = 81`);
    const r = await call(db, 10, 'GET', '/validate/segments/compare?project=1&ids=82,81');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.segments.map((s: any) => s.id), [82, 81], 'columns keep the order asked');
    const [fin, ops] = r.body.segments;
    assert.deepEqual(ops.steps, { who_they_are: 'Ops leads at fixture firms', context: null, job_to_be_done: 'Close the month', urgency: 'high', value_promised: 'Close on day 2' });
    assert.equal(ops.value_source, 'Fixture interview');
    assert.equal(ops.primary, true);
    // Held interviews only: 34 is at Invited and is not counted.
    assert.deepEqual([ops.interviews, ops.strong, ops.partial, ops.none, ops.unrecorded, ops.evidence], [3, 2, 1, 0, 0, 'pattern']);
    assert.deepEqual(ops.top_themes, [{ title: 'Theme One', mentions: 3 }, { title: 'Theme Two', mentions: 1 }]);
    assert.deepEqual(ops.disqualifiers, ['Under 20 staff']);
    assert.deepEqual(ops.firmographics, [{ label: 'Region', value: 'Nordics' }]);
    assert.deepEqual(fin.steps, { who_they_are: null, context: null, job_to_be_done: null, urgency: null, value_promised: null });
    assert.deepEqual([fin.value_source, fin.disqualifiers, fin.firmographics, fin.primary], [null, null, null, false]);
    assert.deepEqual([fin.interviews, fin.unrecorded, fin.evidence], [1, 1, 'anecdote']);
    assert.equal(r.body.can_write, true);
    assert.deepEqual(r.body.missing, []);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity_logs").get().n, 0, 'the read writes nothing');
  } finally { db.close(); }
});

test('D6007 Compare refuses fewer than two or more than four ids, a bad id, and an outsider; it names ids it could not read', async () => {
  const db = fixture();
  try {
    for (const ids of ['81', '81,81', '81,82,83,84,85', '81,abc', '']) {
      assert.equal((await call(db, 10, 'GET', `/validate/segments/compare?project=1&ids=${ids}`)).status, 400, ids);
    }
    assert.equal((await call(db, 20, 'GET', '/validate/segments/compare?project=1&ids=81,82')).status, 403);
    // An archived segment and another venture's are not read: listed as missing.
    const r = await call(db, 10, 'GET', '/validate/segments/compare?project=1&ids=81,84,90');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.segments.map((s: any) => s.id), [81]);
    assert.deepEqual(r.body.missing, [84, 90]);
  } finally { db.close(); }
});

test('D6007 the segment record shows the primary pill, its profile section, set or clear primary, and keeps Export persona', async () => {
  const db = fixture();
  try {
    db.exec(`UPDATE customer_segments SET firmographics_json = '[{"label":"Region","value":"Nordics"}]', disqualifiers_json = '["Under 20 staff"]' WHERE id = 81`);
    const path = '/validate/modules/ideal-customer-profile/records/81?project=1';
    let read = await call(db, 10, 'GET', path);
    assert.equal(read.status, 200);
    const keys = read.body.actions.map((a: any) => a.key);
    assert.ok(keys.includes('set-primary') && !keys.includes('clear-primary'));
    assert.ok(keys.includes('export-persona'), 'Persona export stays');
    assert.equal(read.body.actions.find((a: any) => a.key === 'compare-segments').href, '/validate/ideal-customer-profile?project=1&compare=81');
    assert.ok(!read.body.pills.some((p: any) => /Primary/.test(p.text)));
    const set = await call(db, 10, 'POST', `${path.replace('?', '/actions/set-primary?')}`, {});
    assert.equal(set.status, 200);
    read = await call(db, 10, 'GET', path);
    assert.ok(read.body.pills.some((p: any) => p.text === '★ Primary ICP'));
    assert.ok(read.body.actions.some((a: any) => a.key === 'clear-primary'));
    const profile = read.body.side.find((x: any) => x.key === 'profile');
    assert.equal(profile.title, 'Firmographics and disqualifiers');
    assert.deepEqual(profile.rows.map((x: any) => [x.a, x.b]), [['Region', 'Nordics'], ['Disqualifier', 'Under 20 staff']]);
    // A reader sees the section, without the writer's actions.
    const partner = await call(db, 40, 'GET', path);
    if (partner.status === 200) assert.deepEqual(partner.body.actions, []);
    const edit = read.body.actions.find((a: any) => a.key === 'edit');
    assert.equal(edit.form.fields.find((f: any) => f.key === 'firmographics').value, 'Region: Nordics');
    assert.equal(edit.form.fields.find((f: any) => f.key === 'disqualifiers').value, 'Under 20 staff');
  } finally { db.close(); }
});

test('D6007 the ICP list carries the Primary ICP column and its value', async () => {
  const db = fixture();
  try {
    db.exec('UPDATE customer_segments SET is_primary = 1 WHERE id = 82');
    const r = await call(db, 10, 'GET', '/validate/modules/ideal-customer-profile?project=1');
    assert.equal(r.status, 200);
    assert.equal(r.body.records.cols.at(-1), 'Primary ICP');
    const rows = new Map(r.body.records.rows.map((x: any) => [x.id, x.primary]));
    assert.deepEqual([rows.get(81), rows.get(82), rows.get(83)], [false, true, false]);
    assert.ok(!rows.has(84), 'an archived segment is not listed');
  } finally { db.close(); }
});
