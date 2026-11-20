// D6788: board-resolution persistence, record/action permissions and Calendar's shared obligation on real SQLite.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import compliance from '../src/routes/compliance.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const dbs: DatabaseSync[] = [];
afterEach(() => { while (dbs.length) dbs.pop()!.close(); });
const SECRET = 'synthetic-board-resolution-fixture';
const ROOT = '/api/cycles/grow/modules/durable-company-building/records';
function world() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }); dbs.push(db); loadSchema(db); db.exec('PRAGMA foreign_keys = ON');
  for (const id of [10, 11, 12, 20]) {
    db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(id, `Founder ${id}`, `f${id}@example.test`);
    db.prepare("INSERT INTO users (id, uid, role, name, email, founder_id, is_active, subscription_tier, subscription_status) VALUES (?, ?, 'founder', ?, ?, ?, 1, 'studio', 'active')")
      .run(id, `u${id}`, `Person ${id}`, `u${id}@example.test`, id);
  }
  db.exec("INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'company-one', 'Synthetic One'), (2, 'company-two', 'Synthetic Two')");
  db.exec("INSERT INTO user_company_links (uid, user_id, company_id, role_in_company, is_primary_admin) VALUES ('link10', 10, 1, 'Founder', 1), ('link20', 20, 2, 'Founder', 1)");
  db.exec("INSERT INTO projects (id, name, founder_id, company_id) VALUES (1, 'Venture One', 10, 1), (2, 'Venture Two', 20, 2)");
  db.exec("INSERT INTO project_members (project_id, user_id, role, status) VALUES (1, 11, 'cofounder', 'accepted'), (1, 12, 'advisor', 'accepted')");
  db.exec(`INSERT INTO compliance_events (id, project_id, jurisdiction, event_type, title, due_date, kind, recurrence, created_by_user_id) VALUES
    (51, 1, 'Unspecified', 'board_meeting', 'Board meeting', '2026-11-30', 'governance', 'quarterly', 10),
    (52, 2, 'Unspecified', 'board_meeting', 'Foreign board', '2026-11-30', 'governance', 'quarterly', 20),
    (53, 1, 'Unspecified', 'other', 'Insurance', '2026-12-01', 'compliance', 'one_time', 10)`);
  const app = new Hono<any>(); app.route('/api/cycles', createCycleRecords()); app.route('/api/compliance', compliance);
  app.onError((error, c) => c.json({ detail: String(error.message) }, 500));
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  return { db, app, env };
}
type W = ReturnType<typeof world>;
async function call(w: W, method: string, path: string, body?: unknown, who = 10) {
  const jwt = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await withThrownResponses(() => w.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) }, w.env));
  return { status: res.status, body: await res.json() as any };
}
const read = (w: W, who = 10, id = 51, project = 1) => call(w, 'GET', `${ROOT}/${id}?project=${project}`, undefined, who);
const held = (w: W, body: unknown, who = 10, id = 51, project = 1) => call(w, 'POST', `${ROOT}/${id}/actions/mark-held?project=${project}`, body, who);
const section = (r: any) => r.body.main.find((s: any) => s.key === 'resolutions');
const snapshot = (w: W) => JSON.stringify(['compliance_events', 'obligation_occurrences', 'board_resolutions', 'activity_logs'].map(t => w.db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()));

test('6788: migration links each full resolution to its held meeting, actor and passed date; record is newest meeting first with explicit none', async () => {
  const w = world();
  const initial = await read(w);
  assert.equal(section(initial).empty, 'None recorded');
  const fields = initial.body.actions.find((a: any) => a.key === 'mark-held').form.fields;
  assert.equal(fields.find((f: any) => f.key === 'resolutions').input, 'textarea');
  assert.equal(fields.find((f: any) => f.key === 'resolutions').max, 40019);
  assert.equal(fields.find((f: any) => f.key === 'cite_minutes').value, 'no');
  assert.equal(fields.find((f: any) => f.key === 'resolutions_passed_on').input, 'date');
  let r = await held(w, { held_on: '2026-10-30', resolutions: 'Approve the hiring plan\nApprove the budget', resolutions_passed_on: '2026-10-29' });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.record.resolutions_recorded, 2);
  const rows = w.db.prepare('SELECT * FROM board_resolutions ORDER BY id').all() as any[];
  const occurrence = w.db.prepare('SELECT uid FROM obligation_occurrences').get() as any;
  assert.deepEqual(rows.map(r => [r.event_id, r.occurrence_uid, r.held_on, r.text, r.passed_on, r.recorded_by, r.minutes_file_key]), [
    [51, occurrence.uid, '2026-10-30', 'Approve the hiring plan', '2026-10-29', 10, null],
    [51, occurrence.uid, '2026-10-30', 'Approve the budget', '2026-10-29', 10, null],
  ]);
  assert.ok(rows.every(r => r.recorded_at));
  assert.equal((await held(w, { held_on: '2026-11-30', resolutions: [] })).status, 200);
  r = await read(w);
  assert.deepEqual(section(r).rows[0], { a: 'Meeting held 2026-11-30', b: 'None recorded' });
  assert.equal(section(r).rows.length, 3);
  assert.match(section(r).rows[1].b, /Held 2026-10-30 · Passed 2026-10-29 · Recorded by Person 10/);
  assert.deepEqual(section(r).rows.slice(1).map((r: any) => r.a).sort(), ['Approve the budget', 'Approve the hiring plan']);
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE user_id = 10 AND action = 'grow_obligation_held'").get()?.n, 2);
});

test('6788: JSON entries preserve individual passed dates and full multiline text; equal dates have stable meeting ordering', async () => {
  const w = world();
  const text = 'Approved paragraph one.\nApproved paragraph two.';
  assert.equal((await held(w, { held_on: '2026-10-30', resolutions: [{ text, passed_on: '2026-10-28' }, { text: 'Second resolution' }] })).status, 200);
  const rows = w.db.prepare('SELECT text, passed_on FROM board_resolutions ORDER BY id').all();
  assert.deepEqual(rows.map((r: any) => [r.text, r.passed_on]), [[text, '2026-10-28'], ['Second resolution', '2026-10-30']]);
  assert.equal((await held(w, { held_on: '2026-10-30' })).status, 200);
  assert.equal(section(await read(w)).rows[0].b, 'None recorded');
});

test('6788: advisor reads but cannot mark held; cofounder writes; foreign project or obligation never leaks or changes rows', async () => {
  const w = world();
  assert.equal((await held(w, { held_on: '2026-10-30', resolutions: 'Team resolution' }, 11)).status, 200);
  const advisor = await read(w, 12);
  assert.equal(advisor.status, 200); assert.ok(section(advisor).rows.some((r: any) => r.a === 'Team resolution'));
  assert.deepEqual(advisor.body.actions, []);
  const before = snapshot(w);
  assert.equal((await held(w, { held_on: '2026-11-30', resolutions: 'Forbidden' }, 12)).status, 403);
  assert.equal((await read(w, 20)).status, 403);
  assert.equal((await held(w, { held_on: '2026-11-30', resolutions: 'Forbidden' }, 20)).status, 403);
  assert.equal((await read(w, 10, 52)).status, 404);
  assert.equal((await held(w, { held_on: '2026-11-30', resolutions: 'Forbidden' }, 10, 52)).status, 404);
  assert.equal(snapshot(w), before);
});

test('6788: Calendar and Grow edit the same obligation without changing resolution or meeting history', async () => {
  const w = world();
  await held(w, { held_on: '2026-10-30', resolutions: 'Retain this resolution' });
  const history = JSON.stringify(['board_resolutions', 'obligation_occurrences'].map(t => w.db.prepare(`SELECT * FROM ${t}`).all()));
  const calendar = await call(w, 'PATCH', '/api/compliance/events/51', { title: 'Calendar edited title', due_date: '2027-04-01' });
  assert.equal(calendar.status, 200, JSON.stringify(calendar.body));
  const grow = await call(w, 'PATCH', `${ROOT}/51?project=1`, { title: 'Grow edited title', due_at: '2027-05-01', kind: 'risk', repeats: 'quarterly', status: 'upcoming' });
  assert.equal(grow.status, 200, JSON.stringify(grow.body));
  assert.equal(JSON.stringify(['board_resolutions', 'obligation_occurrences'].map(t => w.db.prepare(`SELECT * FROM ${t}`).all())), history);
  const r = await read(w); assert.equal(r.body.title, 'Grow edited title'); assert.equal(section(r).rows[0].a, 'Retain this resolution');
});

test('6788: invalid text, counts, dates, citation and non-board submissions refuse before any write or upload', async () => {
  const w = world(), before = snapshot(w);
  for (const body of [
    { resolutions: [ { text: '' } ] }, { resolutions: [ { text: 4 } ] }, { resolutions: {} }, { resolutions: ['x'.repeat(2001)] },
    { resolutions: Array(21).fill('Resolution') }, { resolutions: [{ text: 'R', passed_on: '2026-02-30' }] },
    { resolutions: 'R', resolutions_passed_on: 'invalid' }, { resolutions: 'R', cite_minutes: 'yes' }, { resolutions: 'R', cite_minutes: 'maybe' },
  ]) {
    const no = await held(w, { held_on: '2026-10-30', ...body });
    assert.equal(no.status, 400, JSON.stringify(no.body)); assert.equal(snapshot(w), before);
  }
  assert.equal((await held(w, { held_on: '2026-10-30', resolutions: 'R' }, 10, 53)).status, 400);
  assert.equal(snapshot(w), before);
});

test('6788: a next-date clash rolls back occurrence, resolutions, schedule and activity', async () => {
  const w = world();
  w.db.exec("INSERT INTO compliance_events (project_id, jurisdiction, event_type, title, due_date, kind, recurrence) VALUES (1, 'Unspecified', 'board_meeting', 'Clashing board', '2027-02-28', 'governance', 'quarterly')");
  const before = snapshot(w);
  const no = await held(w, { held_on: '2026-11-30', resolutions: 'Must not survive the failed meeting' });
  assert.equal(no.status, 409, JSON.stringify(no.body)); assert.equal(snapshot(w), before);
});

test('6788: migration requires existing occurrence/event references and nonempty text', () => {
  const w = world();
  w.db.exec("INSERT INTO obligation_occurrences (uid, event_id, held_on, created_by) VALUES ('held-one', 51, '2026-10-30', 10)");
  const insert = w.db.prepare("INSERT INTO board_resolutions (uid, event_id, occurrence_uid, held_on, text, passed_on, recorded_by) VALUES (?, ?, 'held-one', ?, 'Synthetic resolution', '2026-10-30', 10)");
  assert.throws(() => insert.run('missing-event', 9999, '2026-10-30'), /FOREIGN KEY/);
  assert.throws(() => w.db.prepare("INSERT INTO board_resolutions (uid, event_id, occurrence_uid, held_on, text, passed_on, recorded_by) VALUES ('missing-occurrence', 51, 'unknown', '2026-10-30', 'R', '2026-10-30', 10)").run(), /FOREIGN KEY/);
  assert.throws(() => w.db.prepare("INSERT INTO board_resolutions (uid, event_id, occurrence_uid, held_on, text, passed_on, recorded_by) VALUES ('empty-text', 51, 'held-one', '2026-10-30', '', '2026-10-30', 10)").run(), /CHECK/);
  assert.doesNotThrow(() => insert.run('right', 51, '2026-10-30'));
});

test('6788: explicit minutes citation is copied from the same uploaded meeting only; response never contains object keys', async () => {
  const w = world();
  const puts: string[] = []; w.env.FILES = { put: async (key: string) => { puts.push(key); }, delete: async () => {} };
  const form = new FormData(); form.set('held_on', '2026-10-30'); form.set('resolutions', 'Approve the synthetic plan'); form.set('cite_minutes', 'yes');
  form.set('minutes', new File(['synthetic pdf'], 'minutes.pdf', { type: 'application/pdf' }));
  const r = await held(w, form);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(puts.length, 1);
  const res = w.db.prepare('SELECT minutes_file_key FROM board_resolutions').get() as any;
  assert.equal(res.minutes_file_key, puts[0]);
  const record = await read(w); assert.equal(JSON.stringify(record.body).includes(puts[0]), false);
  assert.equal(section(record).rows[0].action.key, 'open-minutes');
  assert.equal(section(record).rows[0].c, 'Minutes cited');
  const advisor = await read(w, 12);
  assert.ok(section(advisor).rows.every((row: any) => row.action === undefined));
  assert.equal(section(advisor).rows[0].c, 'Minutes cited');
  assert.deepEqual(advisor.body.actions, []);
  assert.equal(section(record).rows[0].action.body.occurrence, w.db.prepare('SELECT id FROM obligation_occurrences').get()?.id);
  form.set('held_on', '2026-11-30'); form.set('cite_minutes', 'no');
  assert.equal((await held(w, form)).status, 200);
  assert.equal(w.db.prepare('SELECT minutes_file_key FROM board_resolutions ORDER BY id DESC LIMIT 1').get()?.minutes_file_key, null, 'uploading minutes alone does not cite them');
  // Export only the synthetic payload for frontend integration/browser fixtures when explicitly requested.
  if (process.env.BOARD_RESOLUTION_FIXTURE_OUT) writeFileSync(process.env.BOARD_RESOLUTION_FIXTURE_OUT, JSON.stringify(record.body));
});

test('6788: an unavailable resolution store fails the record read rather than claiming none', async () => {
  const w = world(); w.db.exec('DROP TABLE board_resolutions');
  const r = await read(w); assert.equal(r.status, 500);
  assert.equal(r.body.main, undefined); assert.equal(r.body.rows, undefined);
});
