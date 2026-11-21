// #6252 (D6252, owner's Q1 answer A): the brief's Accept keeps it as a fund note; the fund page reads the newest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import router, { FUND_DRAFT_DEPS, FUND_DRAFT_SENTENCES, NOTE_MAX, matchNoteSources } from '../src/routes/fund_drafts.ts';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const tables = ['users', 'vc_funds', 'limited_partners', 'portfolio_positions', 'legal_documents', 'fund_report_periods', 'activity_logs', 'user_company_links', 'fund_distributions'];
const schema = tables.map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n')
  + `CREATE TABLE IF NOT EXISTS company_profiles (id INTEGER PRIMARY KEY, archived_at TEXT);
     CREATE TABLE IF NOT EXISTS fund_capital_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, fund_id INTEGER NOT NULL, call_number INTEGER NOT NULL,
       amount_cents INTEGER NOT NULL, purpose TEXT, due_date TEXT, residual_cents INTEGER NOT NULL DEFAULT 0, line_count INTEGER NOT NULL DEFAULT 1,
       issued_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));`;
const secret = 'd6252-local-fixture-signing-secret';

async function fixture() {
  const { DB, db } = makeD1(schema + readFileSync(new URL('../sql/migrations/202611152331_6252_fund_notes.sql', import.meta.url), 'utf8'));
  const insert = db.prepare("INSERT INTO users(id,name,email,role,investor_tier,investor_subscription_status) VALUES(?,?,?,?,?,'active')");
  for (const [uid, name, role, tier] of [[1, 'Admin', 'admin', 'free'], [2, 'GP', 'investor', 'institutional'], [3, 'LP', 'investor', 'free'], [4, 'Other', 'investor', 'institutional']]) insert.run(uid, name, `${name}@example.test`, role, tier);
  db.exec(`INSERT INTO vc_funds(id,name,gp_user_id,gp_name,gp_entity,fund_size_cents,fund_admin,status,vintage_year) VALUES
     (10,'Fund A',2,'Recorded GP','GP entity',1000000000,'Recorded administrator','investing',2026);
   INSERT INTO vc_funds(id,name,gp_user_id,status) VALUES(20,'Fund B',4,'');
   INSERT INTO limited_partners(fund_id,user_id,email,commitment_amount) VALUES(10,3,'lp@example.test',50000);
   INSERT INTO fund_report_periods(id,fund_id,period,period_start,period_end,notes,status) VALUES
     (100,10,'Q2 2026','2026-04-01','2026-06-30','{}','draft'),
     (101,10,'Q1 2026','2026-01-01','2026-03-31','{}','issued'),
     (102,10,'Q3 2026','','','{}','draft'),
     (103,10,'Q4 2026','2026-10-01','2026-12-31','{}','draft');
   INSERT INTO fund_capital_calls(fund_id,call_number,amount_cents,purpose,due_date,created_at) VALUES
     (10,1,25000000,'Seed follow-ons','2026-05-30','2026-05-02 10:00:00'),
     (10,2,999,'Outside the period',NULL,'2026-07-02 10:00:00');
   INSERT INTO fund_distributions(fund_id,lp_id,amount_cents,distribution_type,status,distributed_at) VALUES
     (10,1,1000000,'exit_proceeds','paid','2026-06-15'),(10,2,500000,'exit_proceeds','paid','2026-06-15'),
     (10,1,777,'exit_proceeds','pending','2026-06-16');`);
  const env = { DB, JWT_SECRET: secret, ENVIRONMENT: 'development' } as any;
  const calls: any[] = [];
  FUND_DRAFT_DEPS.run = (async (_env: any, opts: any) => { calls.push(opts); return { ok: true, output: 'Fund A is investing [1].', usage: { model: 'test-model', est_cost_usd: 0.002 } }; }) as any;
  async function request(path: string, user = 2, body: any = { page: '/funds/10' }, method = 'POST') {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (user) headers.Authorization = `Bearer ${await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret))}`;
    const response = await router.request(path, method === 'GET' ? { method, headers } : { method, headers, body: JSON.stringify(body) }, env);
    return { status: response.status, body: await response.json() as any };
  }
  const writes = () => db.prepare('SELECT (SELECT COUNT(*) FROM activity_logs) AS logs, (SELECT group_concat(notes) FROM fund_report_periods) AS notes').get();
  return { db, env, calls, request, writes };
}


async function draftedBrief(f: any) {
  const r = await f.request('/10/drafts/brief');
  assert.equal(r.status, 200);
  return r.body.draft;
}
const notes = (f: any) => f.db.prepare('SELECT fund_id, author_user_id, kind, body, sources_json FROM fund_notes ORDER BY id').all();

test('D6252 Accept keeps the brief as one fund note with its own cited records, and changes no fund record', async () => {
  const f = await fixture();
  const fundBefore = f.db.prepare('SELECT * FROM vc_funds WHERE id = 10').get();
  const draft = await draftedBrief(f);
  const kept = await f.request('/10/notes/brief', 2, { body: `  ${draft.body}  `, sources: draft.sources });
  assert.equal(kept.status, 201);
  assert.equal(kept.body.note.body, draft.body);
  assert.deepEqual(kept.body.note.sources, draft.sources);
  assert.equal(kept.body.note.author.id, 2);
  const rows = notes(f) as any[];
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0], sources_json: JSON.parse(rows[0].sources_json) }, { fund_id: 10, author_user_id: 2, kind: 'brief', body: draft.body, sources_json: draft.sources });
  assert.deepEqual(f.db.prepare('SELECT * FROM vc_funds WHERE id = 10').get(), fundBefore, 'no fund record changes');
});

test('D6252 the fund page reads the newest kept brief, with its author and date; none kept is null', async () => {
  const f = await fixture();
  assert.deepEqual((await f.request('/10/notes/brief', 2, null, 'GET')).body, { note: null });
  const draft = await draftedBrief(f);
  await f.request('/10/notes/brief', 2, { body: 'First brief [1].', sources: draft.sources.slice(0, 1) });
  f.db.exec("UPDATE fund_notes SET created_at = '2026-11-01 09:00:00'");
  await f.request('/10/notes/brief', 1, { body: 'Second brief [1].', sources: draft.sources.slice(0, 1) });
  const read = await f.request('/10/notes/brief', 2, null, 'GET');
  assert.equal(read.status, 200);
  assert.equal(read.body.note.body, 'Second brief [1].');
  assert.equal(read.body.note.author.name, 'Admin');
  assert.ok(read.body.note.created_at);
  assert.deepEqual(read.body.note.sources, draft.sources.slice(0, 1));
  assert.equal((await f.request('/10/notes/brief', 1, null, 'GET')).body.note.body, 'Second brief [1].', 'an admin who manages it reads the same note');
});

test('D6252 who cannot manage the fund is refused both ways, before anything is written', async () => {
  const f = await fixture();
  const draft = await draftedBrief(f);
  const statuses = [];
  for (const [path, user] of [['/10/notes/brief', 3], ['/10/notes/brief', 4], ['/10/notes/brief', 0], ['/20/notes/brief', 2]] as const) {
    statuses.push((await f.request(path, user, { body: draft.body, sources: draft.sources })).status);
    statuses.push((await f.request(path, user, null, 'GET')).status);
  }
  assert.deepEqual(statuses, [402, 402, 404, 404, 401, 401, 404, 404]);
  assert.equal((notes(f) as any[]).length, 0);
});

test('D6252 an empty, overlong or foreign-sourced brief is refused in the Worker\'s words and nothing is kept', async () => {
  const f = await fixture();
  const draft = await draftedBrief(f);
  const cases: Array<[any, number, string]> = [
    [{ body: '   ', sources: draft.sources }, 422, FUND_DRAFT_SENTENCES.note_empty],
    [{ sources: draft.sources }, 422, FUND_DRAFT_SENTENCES.note_empty],
    [{ body: 'x'.repeat(NOTE_MAX + 1), sources: draft.sources }, 422, FUND_DRAFT_SENTENCES.note_long],
    [{ body: draft.body, sources: [{ n: 1, kind: 'fund', ref: 'fund:20:status', label: 'Status: elsewhere', date: null }] }, 422, FUND_DRAFT_SENTENCES.note_sources],
    [{ body: draft.body, sources: [{ ...draft.sources[0], n: 9 }] }, 422, FUND_DRAFT_SENTENCES.note_sources],
    [{ body: draft.body, sources: 'all of them' }, 422, FUND_DRAFT_SENTENCES.note_sources],
  ];
  for (const [body, status, message] of cases) {
    const r = await f.request('/10/notes/brief', 2, body);
    assert.equal(r.status, status, JSON.stringify(body).slice(0, 60));
    assert.equal(r.body.message ?? r.body.error, message);
  }
  assert.equal((notes(f) as any[]).length, 0);
  assert.equal(f.calls.length, 1, 'keeping a brief never calls the model');
});

test('D6252 matchNoteSources keeps the server\'s own record for each cited source', () => {
  const current = [{ n: 1, kind: 'fund', ref: 'fund:10:status', label: 'Status: investing', date: null }];
  assert.deepEqual(matchNoteSources([{ n: 1, kind: 'fund', ref: 'fund:10:status', label: 'tampered label', date: '1999-01-01' }], current), current);
  assert.deepEqual(matchNoteSources([], current), []);
  assert.equal(matchNoteSources(Array.from({ length: 51 }, () => current[0]), current), null);
});
