/**
 * D911 (#2695) — Eadwyn's positioning proposal for the Investor narrative,
 * behind `/api/cycles/raise/narrative/positioning/*`, on real SQLite with the
 * real AI router and a stubbed model.
 *
 * What it proves: no figure enters the run (a figure-bearing record is held
 * back from the prompt) and no figure leaves it (a field with a digit is
 * dropped before it is stored); each kept field is one `ai_rail_proposals`
 * row; Accept writes the field with Eadwyn as its source and Discard keeps
 * nothing, each logging one `raise.investor-narrative` row with no words and
 * no figure; and the plan gate is today's `studio`.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/narrative_positioning_d911.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cycleRaise from '../src/routes/cycle_raise.ts';
import { reachWords, screenAnswer } from '../src/services/narrative/positioningDraft.ts';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest } from '../src/services/aiRouter.ts';

const PAGE = 'Founder · Raise · Investor narrative';
const OPTION = 'draft:narrative-positioning';
const mig = (f: string) => readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8');

const GOOD = {
  one_liner: 'Month-end close for teams with no time to spare.',
  elevator: 'Kestrel closes the books for small finance teams. It matches accounts and explains each difference.',
  lines: ['Close the books without the spreadsheet', 'Trusted by 40 finance teams', 'Every difference explained before you ask'],
  category: 'Close management software',
  wedge: 'Finance teams too small for an enterprise suite, 2x faster',
};

async function fixture({ tier = 'studio', answer = GOOD as unknown, broken = false } = {}) {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.exec(mig('465_ai_rail_preferences.sql'));
  f.db.exec(mig('506_ai_rail_proposals.sql'));
  f.db.exec(`ALTER TABLE users ADD COLUMN founder_id INTEGER;
    UPDATE users SET founder_id = 20, subscription_tier = '${tier}' WHERE id = 2;
    UPDATE users SET founder_id = 30 WHERE id = 3;
    ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
    ALTER TABLE activity_logs ADD COLUMN entity_type TEXT;
    ALTER TABLE activity_logs ADD COLUMN entity_id TEXT;
    ALTER TABLE activity_logs ADD COLUMN created_at TEXT DEFAULT (datetime('now'));
    CREATE TABLE projects (id INTEGER PRIMARY KEY, founder_id INTEGER, company_id INTEGER, name TEXT, solution TEXT);
    INSERT INTO projects VALUES (1, 20, NULL, 'Kestrel Labs', 'A close tool that matches every account and explains each difference.'),
                                (2, 99, NULL, 'Osprey Works', 'Private');
    CREATE TABLE project_members (project_id INTEGER, user_id INTEGER, role TEXT, status TEXT);
    INSERT INTO project_members VALUES (1, 7, 'cofounder', 'accepted'), (1, 8, 'advisor', 'accepted'), (1, 9, 'cofounder', 'invited');
    CREATE TABLE customer_segments (id INTEGER PRIMARY KEY, project_id INTEGER, name TEXT, archived_at TEXT);
    INSERT INTO customer_segments (project_id, name, archived_at) VALUES
      (1, 'Finance teams of one to five', NULL), (1, 'Agency bookkeepers', NULL),
      (1, 'Teams under 50 people paying $400', NULL), (1, 'Archived segment', '2026-01-01');
    CREATE TABLE competitor_analyses (id INTEGER PRIMARY KEY, project_id INTEGER);
    CREATE TABLE competitor_candidates (id TEXT PRIMARY KEY, analysis_id INTEGER, name TEXT, category TEXT, created_at TEXT);
    CREATE TABLE competitor_tracking (project_id INTEGER, name_norm TEXT, stopped_at TEXT);
    INSERT INTO competitor_analyses VALUES (1, 1);
    INSERT INTO competitor_candidates VALUES ('c1', 1, 'Spreadsheets', 'direct', '2026-10-01'), ('c2', 1, 'Enterprise close suites', 'direct', '2026-10-02'),
                                             ('c3', 1, 'Dropped Co', 'direct', '2026-10-03');
    INSERT INTO competitor_tracking VALUES (1, 'dropped co', '2026-10-10');`);
  f.db.exec(mig('544_narrative_sections.sql'));
  setFixtureAllowance(f.db, 0);
  f.db.exec('INSERT INTO ai_topup_accounts(user_id, balance_microusd) VALUES (2, 5000000)');
  const prompts: string[] = [];
  const env: any = {
    DB: f.DB, JWT_SECRET: 'p'.repeat(64), ENVIRONMENT: 'development',
    AI: withGuard({ run: async (_model: string, input: any) => {
      if (broken) throw new Error('stub failure');
      prompts.push(JSON.stringify(input?.messages ?? input));
      return { response: typeof answer === 'string' ? answer : JSON.stringify(answer), usage: { prompt_tokens: 30, completion_tokens: 20 } };
    } }),
  };
  const jwt = async (id: number) => new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
  const app = new Hono(); app.route('/api/cycles/raise', cycleRaise);
  const call = async (method: string, path: string, body?: unknown, { who = 2, project = 1 } = {}) => {
    const sep = path.includes('?') ? '&' : '?';
    const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
    try {
      const r = await app.request(`/api/cycles/raise${path}${sep}project=${project}`, {
        method, headers: { Authorization: `Bearer ${await jwt(who)}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }, env);
      const raw = await r.text();
      return { status: r.status, body: raw ? JSON.parse(raw) : null };
    } finally { [console.warn, console.error] = saved; }
  };
  const logs = () => f.db.prepare("SELECT action, details FROM activity_logs WHERE entity_type = 'raise.investor-narrative' ORDER BY id").all() as any[];
  const positioning = () => f.db.prepare('SELECT version, kind, position, text, source_kind, source_ref FROM narrative_positioning ORDER BY kind, position').all() as any[];
  return { ...f, call, prompts, logs, positioning };
}

test('the material: qualitative only, counts as words, and any record with a digit held back', async () => {
  const f = await fixture();
  try {
    const r = await f.call('POST', '/narrative/positioning/draft');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const prompt = f.prompts.find((p) => p.includes('Write investor positioning'))!;
    assert.ok(prompt, 'the run was made');
    assert.match(prompt, /Finance teams of one to five/);
    assert.match(prompt, /Spreadsheets/);
    assert.match(prompt, /Cofounder/);
    assert.match(prompt, /Advisor/);
    assert.doesNotMatch(prompt, /Teams under 50 people|\$400/, 'a figure-bearing segment never reaches the model');
    assert.doesNotMatch(prompt, /Archived segment|Dropped Co/, 'archived and stopped names are not read');
    assert.doesNotMatch(prompt, /Member \d|member\d+@/, 'no person is named');
    // Every digit in the prompt is in its fixed text, never in the material.
    const material = prompt.split('Return ONLY valid JSON')[0];
    assert.doesNotMatch(material, /[0-9]/, 'no digit in what was read');
    assert.equal(r.body.withheld, 1);
    assert.ok(r.body.read_from.includes('Validate › Segments'));
    assert.ok(!r.body.read_from.includes('Validate › Pain themes'), 'an unreadable part is not claimed as read');
  } finally { f.db.close(); }
});

test('the answer: a field with a digit is dropped before it is stored, and each kept field is one proposal', async () => {
  const f = await fixture();
  try {
    const r = await f.call('POST', '/narrative/positioning/draft');
    assert.equal(r.status, 200);
    assert.equal(r.body.removed, 2, 'the line with 40 and the wedge with 2x');
    const kinds = r.body.proposals.map((p: any) => `${p.kind}:${p.position}`);
    assert.deepEqual(kinds, ['one_liner:0', 'elevator:0', 'line:0', 'line:1', 'category:0']);
    for (const p of r.body.proposals) assert.doesNotMatch(p.text, /[0-9]/);
    const rows = f.db.prepare('SELECT rail_page, rail_option, record_ref, kind, status, payload_json FROM ai_rail_proposals ORDER BY created_at').all() as any[];
    assert.equal(rows.length, 5);
    for (const row of rows) {
      assert.deepEqual([row.rail_page, row.rail_option, row.record_ref, row.kind, row.status], [PAGE, OPTION, 'project:1', 'proposal', 'proposed']);
      assert.doesNotMatch(JSON.parse(row.payload_json).text, /[0-9]/);
    }
    assert.deepEqual(f.positioning(), [], 'a run writes no positioning');
    assert.deepEqual(f.logs(), [], 'a run is not a narrative write');
    const usage = f.db.prepare('SELECT task, rail_page, rail_option, record_ref, surface FROM ai_usage_logs WHERE guard_for IS NULL').all() as any[];
    assert.deepEqual({ ...usage[0] }, { task: 'rail_write', rail_page: PAGE, rail_option: OPTION, record_ref: 'project:1', surface: '/raise/investor-narrative' });
    // The page's read lists them, and a new run withdraws what the last one left open.
    const g = await f.call('GET', '/narrative/positioning/draft');
    assert.equal(g.body.proposals.items.length, 5);
    assert.deepEqual(g.body.segments, { state: 'ok', items: ['Finance teams of one to five', 'Agency bookkeepers'] });
    assert.deepEqual(g.body.competitors, { state: 'ok', items: ['Spreadsheets', 'Enterprise close suites'] });
    await f.call('POST', '/narrative/positioning/draft');
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM ai_rail_proposals WHERE status = 'withdrawn'").get() as any).n, 5);
    assert.equal((await f.call('GET', '/narrative/positioning/draft')).body.proposals.items.length, 5);
  } finally { f.db.close(); }
});

test('Accept writes the field with Eadwyn as its source; Discard keeps nothing; each logs one row with no words', async () => {
  const f = await fixture();
  try {
    const { body } = await f.call('POST', '/narrative/positioning/draft');
    const [one, elevator] = body.proposals;
    const a = await f.call('POST', `/narrative/positioning/proposals/${one.uid}`, { decision: 'accept' });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.deepEqual(f.positioning().map((p) => ({ ...p })), [{ version: null, kind: 'one_liner', position: 0, text: GOOD.one_liner, source_kind: 'eadwyn', source_ref: `ai_rail_proposals:${one.uid}` }]);
    const d = await f.call('POST', `/narrative/positioning/proposals/${elevator.uid}`, { decision: 'discard' });
    assert.equal(d.status, 200);
    assert.equal(f.positioning().length, 1, 'Discard writes no positioning');
    const logs = f.logs();
    assert.deepEqual(logs.map((l) => l.action), ['narrative_positioning_saved', 'narrative_positioning_discarded']);
    for (const l of logs) {
      assert.doesNotMatch(l.details, /Month-end|Kestrel closes/, 'a log row never holds the words');
      assert.doesNotMatch(l.details, /[0-9]{2,}/, 'nor a figure');
    }
    // One at a time, once.
    assert.equal((await f.call('POST', `/narrative/positioning/proposals/${one.uid}`, { decision: 'discard' })).status, 409);
    assert.equal((await f.call('POST', `/narrative/positioning/proposals/${one.uid}`, { decision: 'all' })).status, 400);
    const st = f.db.prepare('SELECT uid, status FROM ai_rail_proposals WHERE uid IN (?, ?)').all(one.uid, elevator.uid) as any[];
    assert.deepEqual(Object.fromEntries(st.map((r) => [r.uid, r.status])), { [one.uid]: 'accepted', [elevator.uid]: 'discarded' });
  } finally { f.db.close(); }
});

test('another venture, another member and an unknown proposal are refused; Accept still refuses a digit', async () => {
  const f = await fixture();
  try {
    const { body } = await f.call('POST', '/narrative/positioning/draft');
    const uid = body.proposals[0].uid;
    assert.equal((await f.call('POST', '/narrative/positioning/draft', undefined, { project: 2 })).status, 403);
    assert.equal((await f.call('GET', '/narrative/positioning/draft', undefined, { who: 3 })).status, 403);
    assert.equal((await f.call('POST', `/narrative/positioning/proposals/${uid}`, { decision: 'accept' }, { project: 2 })).status, 403);
    assert.equal((await f.call('POST', '/narrative/positioning/proposals/00000000-0000-0000-0000-000000000000', { decision: 'accept' })).status, 404);
    // A row tampered to hold a figure is still refused by the store on Accept.
    f.db.prepare("UPDATE ai_rail_proposals SET payload_json = json_set(payload_json, '$.text', 'Now 3x faster') WHERE uid = ?").run(uid);
    const a = await f.call('POST', `/narrative/positioning/proposals/${uid}`, { decision: 'accept' });
    assert.equal(a.status, 400);
    assert.match(a.body.detail, /carries no number/);
    assert.deepEqual(f.positioning(), []);
  } finally { f.db.close(); }
});

test('the plan gate is today\'s studio; nothing to read, a version 0 target and a failed model answer say so', async () => {
  let f = await fixture({ tier: 'free' });
  try {
    const r = await f.call('POST', '/narrative/positioning/draft');
    assert.equal(r.status, 402);
    assert.equal(f.prompts.length, 0, 'no run below the plan');
  } finally { f.db.close(); }
  f = await fixture();
  try {
    assert.equal((await f.call('POST', '/narrative/positioning/draft?version=0')).status, 409, 'version 0 is the live deck');
    // Team roles alone are not enough to propose from.
    f.db.exec('DELETE FROM customer_segments; DELETE FROM competitor_candidates; UPDATE projects SET solution = NULL');
    const r = await f.call('POST', '/narrative/positioning/draft');
    assert.equal(r.status, 422);
    assert.equal(r.body.code, 'nothing_to_read');
    assert.equal(f.prompts.length, 0);
  } finally { f.db.close(); }
  f = await fixture({ broken: true });
  try {
    const r = await f.call('POST', '/narrative/positioning/draft');
    assert.equal(r.status, 503);
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM ai_rail_proposals').get() as any).n, 0);
  } finally { f.db.close(); }
});

test('the pure parts: reach in words, and the screen', () => {
  assert.equal(reachWords(6, 10), 'raised in most interviews');
  assert.equal(reachWords(3, 10), 'raised in many interviews');
  assert.equal(reachWords(2, 10), 'raised in a few interviews');
  assert.equal(reachWords(1, 10), 'raised in one interview');
  assert.equal(reachWords(0, 10), 'not raised yet');
  const s = screenAnswer({ one_liner: 'Twenty percent faster', elevator: 'Up 20%', lines: ['A', '', 'Three 3', 'B'], category: 5 });
  assert.deepEqual(s.fields.map((x) => `${x.kind}:${x.position}:${x.text}`), ['one_liner:0:Twenty percent faster', 'line:0:A', 'line:1:B']);
  assert.equal(s.removed, 2);
  assert.deepEqual(screenAnswer('not json').fields, []);
  assert.equal(screenAnswer({ one_liner: 'x '.repeat(300) }).fields[0].text.length <= 200, true);
});
