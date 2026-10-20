import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import decks from '../src/routes/decks.ts';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest } from '../src/services/aiRouter.ts';

const PAGE = 'Founder · Raise · Pitch deck';
const OUTPUT = { one_liner: 'Dispatch together', elevator_pitch: 'Coordinate local shipments.', positioning_lines: ['One shared dispatch screen'] };
async function fixture({ funded = true, verdict = 'safe', broken = false } = {}) {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.exec(readFileSync(new URL('../sql/migrations/465_ai_rail_preferences.sql', import.meta.url), 'utf8'));
  f.db.exec(`ALTER TABLE users ADD COLUMN founder_id INTEGER;
    UPDATE users SET founder_id=20, subscription_tier='studio' WHERE id=2;
    CREATE TABLE projects(id INTEGER PRIMARY KEY, founder_id INTEGER, company_id INTEGER, name TEXT, description TEXT);
    INSERT INTO projects VALUES(1,20,NULL,'Harbour','Coordinates local shipments'),(2,30,NULL,'Other','Private');
    CREATE TABLE pitch_decks(id INTEGER PRIMARY KEY, slides TEXT);
    INSERT INTO pitch_decks VALUES(1,'Founder copy');`);
  setFixtureAllowance(f.db, 0);
  if (funded) f.db.exec('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)');
  const calls: string[] = [];
  const env: any = { DB: f.DB, JWT_SECRET: 'p'.repeat(64), ENVIRONMENT: 'development', AI: withGuard({ run: async (model: string) => {
    calls.push(model); if (broken) throw new Error('stub failure');
    return { response: JSON.stringify(OUTPUT), usage: { prompt_tokens: 30, completion_tokens: 20 } };
  } }, verdict) };
  const jwt = await new SignJWT({ user_id: 2 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
  const app = new Hono(); app.route('/api/decks', decks);
  const post = (projectId = 1, headers = {}) => app.request('/api/decks/positioning', { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ project_id: projectId }) }, env);
  const snapshot = () => JSON.stringify([f.db.prepare('SELECT * FROM projects').all(), f.db.prepare('SELECT * FROM pitch_decks').all()]);
  return { ...f, post, calls, snapshot };
}

test('draft:positioning uses a guarded, charged run with canonical context and leaves business rows untouched', async () => {
  const f = await fixture(); const before = f.snapshot();
  try {
    const r = await f.post(); const b: any = await r.json();
    assert.equal(r.status, 200);
    assert.equal(b.one_liner, OUTPUT.one_liner);
    const rows: any[] = f.db.prepare('SELECT user_id,task,rail_page,rail_option,record_ref,charged_microusd FROM ai_usage_logs WHERE guard_for IS NULL').all();
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].user_id, rows[0].task, rows[0].rail_page, rows[0].rail_option, rows[0].record_ref], [2, 'rail_write', PAGE, 'draft:positioning', 'project:1']);
    assert.ok(rows[0].charged_microusd > 0);
    assert.ok((f.db.prepare('SELECT COUNT(*) AS n FROM ai_usage_logs WHERE guard_for IS NOT NULL').get() as any).n > 0);
    assert.equal(f.snapshot(), before);
  } finally { f.db.close(); }
});

for (const page of [PAGE, 'raise']) test(`Manual on ${page} prevents the run`, async () => {
  const f = await fixture(); const before = f.snapshot();
  try {
    f.db.prepare("INSERT INTO ai_rail_preferences(uid,user_id,section,task,mode) VALUES('off',2,?,'','manual')").run(page.toLowerCase());
    const r = await f.post(1, { 'X-Rail-Page': encodeURIComponent(page), 'X-Rail-Option': 'draft:positioning', 'X-Rail-Record': 'project:999' });
    assert.equal(r.status, 403);
    assert.equal((await r.json() as any).error, 'assist_off');
    assert.deepEqual(f.calls, []);
    assert.equal(f.snapshot(), before);
  } finally { f.db.close(); }
});

for (const [config, status] of [[{ funded: false }, 402], [{ verdict: 'unsafe\nS1' }, 422], [{ broken: true }, 503]] as Array<[{ funded?: boolean; verdict?: string; broken?: boolean }, number]>) test(`refused positioning answers ${status} without a draft or business write`, async () => {
  const f = await fixture(config); const before = f.snapshot();
  try {
    const r = await f.post(); const b: any = await r.json();
    assert.equal(r.status, status);
    assert.equal(b.one_liner, undefined);
    assert.equal(f.snapshot(), before);
    if (config.funded === false || config.verdict) assert.deepEqual(f.calls, []);
  } finally { f.db.close(); }
});

test('another founder’s project is refused before any model call', async () => {
  const f = await fixture();
  try { assert.equal((await f.post(2)).status, 403); assert.deepEqual(f.calls, []); }
  finally { f.db.close(); }
});


test('a successful run preserves the mounted page and uses the scoped project record', async () => {
  const f = await fixture();
  try {
    const r = await f.post(1, { 'X-Rail-Page': 'raise', 'X-Rail-Option': 'draft:positioning', 'X-Rail-Record': 'project:999' });
    assert.equal(r.status, 200);
    const row: any = f.db.prepare('SELECT rail_page,record_ref FROM ai_usage_logs WHERE guard_for IS NULL').get();
    assert.deepEqual({ ...row }, { rail_page: 'raise', record_ref: 'project:1' });
  } finally { f.db.close(); }
});
