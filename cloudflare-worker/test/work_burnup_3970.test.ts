// D1614 W2 (#3970): a project's burn-up, derived from scope_task_events.
// Real SQLite with migrations 712, 727 and 762; authenticated Hono for the
// route. The derivation cases write rows and events with chosen timestamps,
// so day and time-zone edges are exact; one case drives W1's own routes, so
// the burn-up reads the events W1 really writes. Each case names the
// mutations it was checked against.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/work_burnup_3970.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { addColumnsFrom, stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import engine, { agentEngineEnabled } from '../src/routes/agent_engine.ts';
import { workBoardRoutes } from '../src/routes/work_board.ts';
import { localDay, projectBurnup, BURN_MAX_DAYS } from '../src/services/agents/workBurnup.ts';
import { loadScope } from '../src/services/agents/teams.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const baseline = sql('schema_baseline.sql');
const secret = 'fixture'.repeat(12);
const OWNER = 10, MEMBER = 11, STRANGER = 13;
const NOW = new Date('2026-11-10T12:00:00Z');

function world() {
  const { DB, db } = makeD1(['users', 'company_profiles', 'user_company_links', 'projects', 'roadmap_okrs'].map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n') + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'));
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  db.exec(sql('migrations/712_team_agents.sql'));
  db.exec(stripForeignKeys(sql('migrations/727_scope_goals_and_tasks.sql')));
  db.exec(sql('migrations/762_scope_task_work_board.sql'));
  db.exec('CREATE TABLE project_members (id INTEGER PRIMARY KEY,project_id INTEGER,user_id INTEGER,role TEXT,status TEXT,created_at TEXT,updated_at TEXT)');
  db.exec("CREATE TABLE user_settings (user_id INTEGER PRIMARY KEY, timezone TEXT DEFAULT 'UTC')");
  for (const [id, name, founder] of [[OWNER, 'Pat Owner', 100], [MEMBER, 'Max Member', 101], [STRANGER, 'Sam Stranger', 103]] as const) {
    db.prepare("INSERT INTO users (id,uid,email,name,role,founder_id,subscription_tier,subscription_status) VALUES (?,?,?,?,'founder',?,'growth','active')").run(id, `u-${id}`, `fixture-${id}@example.test`, name, founder);
  }
  db.exec("INSERT INTO company_profiles (id,uid,company_name) VALUES (1,'co-one','Company One')");
  db.exec("INSERT INTO user_company_links (uid,user_id,company_id,role_in_company) VALUES ('link-owner',10,1,'Founder')");
  db.exec("INSERT INTO projects (id,uid,name,founder_id,company_id) VALUES (7,'p-seven','Project Seven',100,1),(8,'p-eight','Project Eight',100,NULL)");
  db.exec("INSERT INTO project_members (project_id,user_id,role,status) VALUES (7,11,'advisor','accepted')");
  const env: any = { DB, JWT_SECRET: secret, ENVIRONMENT: 'development', AGENT_ENGINE: 'on', TEAM_AGENTS_ENABLED: 'true' };
  const app = new Hono(); app.route('/api/teams', workBoardRoutes(agentEngineEnabled)); app.route('/api/teams', engine);
  return { DB, db, env, app };
}
type W = ReturnType<typeof world>;
async function call(w: W, who: number | null, method: string, path: string, b?: unknown) {
  const token = who === null ? null : await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const r = await w.app.request(`/api/teams${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }, w.env);
  const text = await r.text();
  let body: any = null; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

let n = 0;
/** One project item and its event trail, at chosen UTC instants. */
function item(w: W, o: { created: string; type?: string; assignee?: 'person' | 'agent' | 'none'; events?: Array<[string, string, Record<string, unknown>]>; project?: number }) {
  n++;
  const last = [...(o.events ?? [])].reverse();
  const status = (last.find(([, k, d]) => k === 'status' || 'to_status' in d)?.[2] as any);
  const st = status ? (status.to ?? status.to_status) : 'open';
  const reason = status?.close_reason ?? null;
  const assignee = o.assignee ?? 'none';
  const row = w.db.prepare(`INSERT INTO scope_tasks (uid, scope_kind, project_id, task_number, title, status, assignee_kind, assignee_user_id, assignee_agent_id, type, created_at)
    VALUES (?, 'project', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(`t${n}`.padEnd(32, '0'), o.project ?? 7, n, `Item ${n}`, st, assignee,
    assignee === 'person' ? MEMBER : null, null, o.type ?? 'task', o.created.replace('T', ' ').replace('Z', ''));
  const id = Number(row.lastInsertRowid);
  if (reason) w.db.prepare("UPDATE scope_tasks SET board_column = 'done', close_reason = ?, duplicate_of = ? WHERE id = ?").run(reason, reason === 'duplicate' ? id : null, id);
  const ev = w.db.prepare('INSERT INTO scope_task_events (task_id, kind, detail_json, created_at) VALUES (?, ?, ?, ?)');
  ev.run(id, 'created', JSON.stringify({ column: 'backlog' }), o.created.replace('T', ' ').replace('Z', ''));
  for (const [at, kind, d] of o.events ?? []) ev.run(id, kind, JSON.stringify(d), at.replace('T', ' ').replace('Z', ''));
  return id;
}
const burn = async (w: W, q: Record<string, string | null> = {}, tz = 'UTC', now = NOW) =>
  projectBurnup(w.env, (await loadScope(w.env, 'project', '7')) as any, q, tz, now);
const day = (s: any, d: string) => s.series.find((p: any) => p.day === d);

test('W2: gates, flags and project only; a company path has no route and an unknown project is 404', async () => {
  // Mutations checked: the read gate removed → the stranger reads; the path widened to /:scope/:id → the company read answers 200.
  const w = world();
  try {
    assert.equal((await call(w, null, 'GET', '/project/7/work/burnup')).status, 401);
    assert.equal((await call(w, STRANGER, 'GET', '/project/7/work/burnup')).status, 403);
    assert.equal((await call(w, MEMBER, 'GET', '/project/7/work/burnup')).status, 200, 'an advisor reads');
    assert.equal((await call(w, OWNER, 'GET', '/company/co-one/work/burnup')).status, 404);
    assert.equal((await call(w, OWNER, 'GET', '/project/999/work/burnup')).status, 404);
    for (const env of [{ AGENT_ENGINE: 'off' }, { TEAM_AGENTS_ENABLED: 'false' }]) {
      Object.assign(w.env, env);
      const r = await call(w, OWNER, 'GET', '/project/7/work/burnup');
      assert.deepEqual([r.status, r.body.error], [404, 'agent_engine_off']);
      Object.assign(w.env, { AGENT_ENGINE: 'on', TEAM_AGENTS_ENABLED: 'true' });
    }
    const bad = await call(w, OWNER, 'GET', '/project/7/work/burnup?range=1y');
    assert.deepEqual([bad.status, bad.body.error], [400, 'invalid_range']);
  } finally { w.db.close(); }
});

test('W2: an empty project is { available: false }, never a series of zeros; days before the first item are not recorded', async () => {
  // Mutation checked: the empty project answered with zero points → the first assert fails.
  const w = world();
  try {
    const empty = await burn(w);
    assert.equal(empty.available, false);
    assert.ok(!('series' in empty));
    item(w, { created: '2026-11-05T09:00:00Z' });
    const s: any = await burn(w);
    assert.equal(s.available, true);
    assert.equal(s.series.length, 14);
    assert.deepEqual(day(s, '2026-11-04'), { day: '2026-11-04', available: false });
    assert.equal(day(s, '2026-11-05').scope, 1);
  } finally { w.db.close(); }
});

test('W2: created, completed, reopened, closed as not planned or duplicate — each day is the end-of-day state', async () => {
  // Mutations checked: not planned kept in scope → day 6's scope reads 2; reopen ignored → day 4 still completed.
  const w = world();
  try {
    item(w, { created: '2026-11-01T10:00:00Z', events: [
      ['2026-11-03T10:00:00Z', 'status', { from: 'open', to: 'done' }],
      ['2026-11-04T10:00:00Z', 'status', { from: 'done', to: 'open' }],
      ['2026-11-06T10:00:00Z', 'moved', { to_status: 'cancelled', close_reason: 'not_planned' }],
    ] });
    item(w, { created: '2026-11-02T10:00:00Z', events: [['2026-11-05T10:00:00Z', 'moved', { to_status: 'cancelled', close_reason: 'duplicate' }]] });
    const s: any = await burn(w, { from: '2026-11-01', to: '2026-11-07' });
    const pick = (d: string) => { const p = day(s, d); return [p.scope, p.completed, p.open, p.not_planned, p.duplicate]; };
    assert.deepEqual(pick('2026-11-01'), [1, 0, 1, 0, 0]);
    assert.deepEqual(pick('2026-11-02'), [2, 0, 2, 0, 0]);
    assert.deepEqual(pick('2026-11-03'), [2, 1, 1, 0, 0]);
    assert.deepEqual(pick('2026-11-04'), [2, 0, 2, 0, 0], 'reopened');
    assert.deepEqual(pick('2026-11-05'), [1, 0, 1, 0, 1], 'a duplicate leaves the scope');
    assert.deepEqual(pick('2026-11-06'), [0, 0, 0, 1, 1], 'not planned leaves the scope');
    assert.deepEqual(pick('2026-11-07'), [0, 0, 0, 1, 1]);
  } finally { w.db.close(); }
});

test('W2: completed is split by the assignee kind at completion; a reassignment after it does not move the credit', async () => {
  // Mutation checked: crediting the current assignee kind → the agent item reads as person.
  const w = world();
  try {
    item(w, { created: '2026-11-01T10:00:00Z', assignee: 'person', events: [['2026-11-02T10:00:00Z', 'status', { to: 'done' }]] });
    item(w, { created: '2026-11-01T10:00:00Z', assignee: 'person', events: [
      ['2026-11-01T11:00:00Z', 'assigned', { assignee_kind: 'agent' }],
      ['2026-11-02T10:00:00Z', 'status', { to: 'done' }],
      ['2026-11-03T10:00:00Z', 'assigned', { assignee_kind: 'person' }],
    ] });
    item(w, { created: '2026-11-01T10:00:00Z', events: [['2026-11-02T10:00:00Z', 'status', { to: 'done' }]] });
    const s: any = await burn(w, { from: '2026-11-01', to: '2026-11-03' });
    assert.deepEqual(day(s, '2026-11-02').completed_by, { person: 1, agent: 1, none: 1 });
    assert.deepEqual(day(s, '2026-11-03').completed_by, { person: 1, agent: 1, none: 1 }, 'the credit stays where it was earned');
    assert.equal(day(s, '2026-11-03').completed, 3);
  } finally { w.db.close(); }
});

test('W2: days are the member\'s; an event at 23:30 UTC is the next day in Tokyo and the same day in UTC', async () => {
  // Mutation checked: bucketing by the UTC date → the Tokyo series counts it on 11-01.
  const w = world();
  try {
    item(w, { created: '2026-11-01T23:30:00Z' });
    const utc: any = await burn(w, { from: '2026-11-01', to: '2026-11-02' }, 'UTC');
    const tokyo: any = await burn(w, { from: '2026-11-01', to: '2026-11-02' }, 'Asia/Tokyo');
    assert.equal(day(utc, '2026-11-01').scope, 1);
    assert.deepEqual(day(tokyo, '2026-11-01'), { day: '2026-11-01', available: false });
    assert.equal(day(tokyo, '2026-11-02').scope, 1);
    assert.equal(localDay(new Date('2026-11-01T23:30:00Z'), 'America/Los_Angeles'), '2026-11-01');
    // The route reads the member's own zone.
    w.db.prepare("INSERT INTO user_settings (user_id, timezone) VALUES (?, 'Asia/Tokyo')").run(OWNER);
    const r = await call(w, OWNER, 'GET', '/project/7/work/burnup?from=2026-11-01&to=2026-11-02');
    assert.equal(r.body.range.time_zone, 'Asia/Tokyo');
    assert.deepEqual(r.body.series[0], { day: '2026-11-01', available: false });
    w.db.prepare("UPDATE user_settings SET timezone = 'Not/AZone' WHERE user_id = ?").run(OWNER);
    assert.equal((await call(w, OWNER, 'GET', '/project/7/work/burnup?from=2026-11-01&to=2026-11-02')).body.range.time_zone, 'UTC');
  } finally { w.db.close(); }
});

test('W2: the range: 2w, 1m and 3m end today; max starts at the first item; a custom range is bounded; events after it are not read', async () => {
  // Mutation checked: the events read unbounded (the upper bound moved past `to`) → the bound assert fails.
  const w = world();
  try {
    item(w, { created: '2026-09-01T10:00:00Z', events: [['2026-11-09T10:00:00Z', 'status', { to: 'done' }]] });
    for (const [range, days] of [['2w', 14], ['1m', 30], ['3m', 90]] as const) {
      const s: any = await burn(w, { range });
      assert.equal(s.series.length, days, range);
      assert.equal(s.range.to, '2026-11-10');
    }
    const max: any = await burn(w, { range: 'max' });
    assert.equal(max.range.from, '2026-09-01');
    const custom: any = await burn(w, { from: '2026-11-01', to: '2026-11-05' });
    assert.equal(custom.series.length, 5);
    assert.equal(day(custom, '2026-11-05').completed, 0, 'a later event is outside the range');
    // The read itself is bounded: events are fetched only before two days past `to` (every time zone's end of `to`).
    const binds: unknown[][] = [];
    const prepare = w.env.DB.prepare.bind(w.env.DB);
    w.env.DB.prepare = (q: string) => {
      const st = prepare(q);
      if (/FROM scope_task_events e/.test(q)) { const bind = st.bind.bind(st); st.bind = (...a: unknown[]) => { binds.push(a); return bind(...a); }; }
      return st;
    };
    await burn(w, { from: '2026-11-01', to: '2026-11-05' });
    assert.deepEqual(binds.map((b) => b[1]), ['2026-11-07 00:00:00']);
    w.env.DB.prepare = prepare;
    await assert.rejects(burn(w, { from: '2026-11-05', to: '2026-11-01' }), (e: any) => e.code === 'invalid_range');
    await assert.rejects(burn(w, { from: '2026-11-05' }), (e: any) => e.code === 'invalid_range');
    await assert.rejects(burn(w, { from: '2020-01-01', to: '2026-11-01' }), (e: any) => e.code === 'invalid_range');
    await assert.rejects(burn(w, { from: '2026-02-30', to: '2026-03-01' }), (e: any) => e.code === 'invalid_range');
    assert.equal(BURN_MAX_DAYS, 730);
    // Another project's items never count.
    item(w, { created: '2026-11-01T10:00:00Z', project: 8 });
    assert.equal(day(await burn(w, { from: '2026-11-01', to: '2026-11-01' }), '2026-11-01').scope, 1);
  } finally { w.db.close(); }
});

test('W2: filter= keeps only the items the board filter keeps', async () => {
  const w = world();
  try {
    item(w, { created: '2026-11-01T10:00:00Z', type: 'bug' });
    item(w, { created: '2026-11-01T10:00:00Z', type: 'task' });
    assert.equal(day(await burn(w, { from: '2026-11-01', to: '2026-11-01', filter: 'type:bug' }), '2026-11-01').scope, 1);
    assert.equal(day(await burn(w, { from: '2026-11-01', to: '2026-11-01' }), '2026-11-01').scope, 2);
  } finally { w.db.close(); }
});

test('W2: the events W1 really writes — create, close completed, reopen, close as duplicate — through the routes', async () => {
  const w = world();
  try {
    const a = (await call(w, OWNER, 'POST', '/project/7/tasks', { title: 'Ship it' })).body.task;
    const b = (await call(w, OWNER, 'POST', '/project/7/tasks', { title: 'Ship it again' })).body.task;
    assert.equal((await call(w, OWNER, 'PATCH', `/tasks/${a.uid}`, { state: 'closed', close_reason: 'completed' })).status, 200);
    const today = localDay(new Date(), 'UTC');
    let r = await call(w, OWNER, 'GET', `/project/7/work/burnup?from=${today}&to=${today}`);
    assert.deepEqual([r.body.series[0].scope, r.body.series[0].completed, r.body.series[0].open], [2, 1, 1]);
    assert.equal((await call(w, OWNER, 'PATCH', `/tasks/${a.uid}`, { state: 'open' })).status, 200);
    assert.equal((await call(w, OWNER, 'PATCH', `/tasks/${b.uid}`, { state: 'closed', close_reason: 'duplicate', duplicate_of: a.uid })).status, 200);
    r = await call(w, OWNER, 'GET', `/project/7/work/burnup?from=${today}&to=${today}`);
    const p = r.body.series[0];
    assert.deepEqual([p.scope, p.completed, p.open, p.not_planned, p.duplicate], [1, 0, 1, 0, 1]);
    assert.ok(!JSON.stringify(r.body).includes('@example.test'));
  } finally { w.db.close(); }
});
