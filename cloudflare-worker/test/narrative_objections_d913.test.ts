/**
 * D913 (#2697, NAR10 and NAR1) — the objections investors raised, read
 * project-wide from Capital relationships' feedback: `GET
 * /api/cycles/raise/narrative/objections`, the module read's
 * `parts.narrative.objections`, and "Answer it" (`POST
 * /narrative/objections/:objection/draft`) on the real AI router with a
 * stubbed model.
 *
 * What it proves: rows whose words differ only in case or spacing are one
 * objection, counted per row and per investor, with the newest non-blank
 * answer; another venture's feedback never shows; no version is needed; a
 * failed read says so on its own; the run is metered under
 * `draft:narrative-objection`, reads every figure masked, drops a sentence
 * with a digit and writes nothing; the refusals. Option A (migration 624):
 * which saved version and section answers an objection is recorded, replaced
 * and cleared, each with a log row that names no objection or investor, and a
 * failed answers read never hides the objections.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/narrative_objections_d913.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cycleRaise from '../src/routes/cycle_raise.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import { groupObjections, objectionKey } from '../src/services/narrative/objections.ts';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { raiseEvidenceTables } from './_raise_evidence_fixture.ts';

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${file}`), 'utf8');
const between = (sql: string, from: string) => { const at = sql.indexOf(from); return sql.slice(at, sql.indexOf(');', at) + 2); };

// ---------------------------------------------------------------------------
// The read and Home's part, over schema_baseline.sql and migrations 442, 459, 463, 544 and 545
// ---------------------------------------------------------------------------

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 110, OTHER = 120, ADMIN = 130;
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [OTHER]: 'founder', [ADMIN]: 'admin' };
const P = 1, PB = 2;

function readFixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of [
    'users', 'projects', 'activity_logs', 'cap_table_scenarios', 'cap_table_holders', 'cap_table_vesting', 'raise_prospects', 'raise_rounds',
    'spinout_deck_overrides', 'pitch_decks', 'pitch_deck_share_tokens', 'deck_share_views', 'data_room_folders', 'data_room_files',
    'dd_cases', 'dd_requests', 'contacts', 'pain_groups', 'hypotheses', 'mvp_features', 'roadmap_okrs',
  ]) db.exec(tableFromBaseline(BASELINE, t));
  const cols = (t: string) => new Set((db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as any[]).map((r) => r.name));
  if (!cols('pitch_deck_share_tokens').has('revoked_at')) db.exec(sqlOf('248_deck_share_revoked_at.sql'));
  db.exec(sqlOf('129_captable_one_canonical_per_project.sql'));
  db.exec(sqlOf('249_project_metrics.sql'));
  db.exec(sqlOf('410_safe_issuances.sql'));
  db.exec(sqlOf('442_raise_cycle_stores.sql'));
  db.exec(sqlOf('459_cycle_activity_convention.sql'));
  db.exec(sqlOf('463_raise_record_stores.sql'));
  db.exec(sqlOf('544_narrative_sections.sql'));
  db.exec(sqlOf('545_narrative_notes.sql'));
  db.exec(sqlOf('761_narrative_read_end.sql')); // D1465: activeReason reads ended_at
  db.exec(sqlOf('624_narrative_objection_answers.sql'));
  raiseEvidenceTables(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001), (${PB}, 'Osprey Works', 1002)`);
  const prospect = db.prepare("INSERT INTO raise_prospects (id, uid, project_id, name, stage) VALUES (?, 'p-' || ?, ?, ?, ?)");
  prospect.run(11, 11, P, 'North Fund', 'contacted');
  prospect.run(12, 12, P, 'South Fund', 'contacted');
  prospect.run(21, 21, PB, 'Elsewhere Fund', 'contacted');
  const fb = db.prepare('INSERT INTO raise_prospect_feedback (prospect_id, objection, answer, created_at) VALUES (?, ?, ?, ?)');
  // "Too small a market" three times from two investors, spelled three ways; the newest answer is blank, so the older one stands.
  fb.run(11, 'Too small a market', 'The wedge opens the mid-market.', '2026-10-01 10:00:00');
  fb.run(12, 'too small  a market', null, '2026-10-05 10:00:00');
  fb.run(12, '  Too Small a Market ', '   ', '2026-10-09 10:00:00');
  fb.run(11, 'Are you too early?', null, '2026-10-03 10:00:00');
  // Another venture's investor said the same thing: never counted here.
  fb.run(21, 'Too small a market', 'Not yours.', '2026-10-10 10:00:00');
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles', createCycleRecords());
app.route('/api/cycles/raise', cycleRaise);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, pid = P) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const sep = path.includes('?') ? '&' : '?';
    const res = await app.request(`/api/cycles${path}${sep}project=${pid}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    const raw = await res.text();
    return { status: res.status, body: raw ? JSON.parse(raw) : null };
  } finally { [console.warn, console.error] = saved; }
}

test('GET /narrative/objections: one objection per wording, counted per row and per investor, the newest answer, never another venture\'s, no version needed', async () => {
  const db = readFixture();
  try {
    const r = await call(db, FOUNDER, 'GET', '/raise/narrative/objections');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.capped, false);
    assert.deepEqual(r.body.objections.map((o: any) => [o.text, o.count, o.prospects, o.last_heard, o.answer]), [
      ['Too Small a Market', 3, 2, '2026-10-09', 'The wedge opens the mid-market.'],
      ['Are you too early?', 1, 1, '2026-10-03', null],
    ]);
    assert.equal(r.body.objections[0].key, await objectionKey('too small a market'));
    assert.match(r.body.objections[1].key, /^[0-9a-f]{16}$/);
    // The other venture reads its own one objection, with its own answer.
    const b = await call(db, OTHER, 'GET', '/raise/narrative/objections', undefined, PB);
    assert.deepEqual(b.body.objections.map((o: any) => [o.count, o.answer]), [[1, 'Not yours.']]);
    // No feedback is an empty list, not a failure.
    db.exec('DELETE FROM raise_prospect_feedback');
    assert.deepEqual((await call(db, FOUNDER, 'GET', '/raise/narrative/objections')).body.objections, []);
    // Not the venture's: refused.
    assert.equal((await call(db, OTHER, 'GET', '/raise/narrative/objections')).status, 403);
  } finally { db.close(); }
});

test('an admin reads the objections only after giving a reason; a failed read says so', async () => {
  const db = readFixture();
  try {
    const before = await call(db, ADMIN, 'GET', '/raise/narrative/objections');
    assert.equal(before.status, 403);
    assert.equal(before.body.code, 'read_reason_required');
    assert.equal((await call(db, ADMIN, 'POST', '/raise/narrative/reads', { reason: 'Reviewing the raise with the founder' })).status, 201);
    assert.equal((await call(db, ADMIN, 'GET', '/raise/narrative/objections')).body.objections.length, 2);
    db.exec('DROP TABLE raise_prospect_feedback');
    const r = await call(db, FOUNDER, 'GET', '/raise/narrative/objections');
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'unreadable');
  } finally { db.close(); }
});

test('parts.narrative.objections: Home reads them with no version saved, and a failed read fails only that part', async () => {
  const db = readFixture();
  try {
    const home = async () => {
      const r = await call(db, FOUNDER, 'GET', '/raise/modules/investor-narrative');
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.parts.narrative;
    };
    const part = await home();
    assert.equal(part.state, 'ok');
    assert.deepEqual(part.versions, [], 'no version saved');
    assert.equal(part.objections.state, 'ok');
    assert.deepEqual(part.objections.items.map((o: any) => [o.text, o.count]), [['Too Small a Market', 3], ['Are you too early?', 1]]);
    db.exec('DROP TABLE raise_prospect_feedback');
    const broken = await home();
    assert.equal(broken.state, 'ok', 'the versions still read');
    assert.deepEqual(broken.objections, { state: 'unreadable' });
  } finally { db.close(); }
});

// ---------------------------------------------------------------------------
// Option A (migration 624): which section answers an objection
// ---------------------------------------------------------------------------

/** The read fixture with saved versions: 7 is this venture's, 8 the other's. */
function answerFixture() {
  const db = readFixture();
  db.exec(`INSERT INTO spinout_deck_overrides (id, project_id, field_key, value, version) VALUES
    (7, ${P}, '__version__', 'seed_fund', 7), (8, ${PB}, '__version__', 'seed_fund', 8)`);
  return db;
}
const answerPath = (key: string) => `/raise/narrative/objections/${key}/answer`;
const logs = (db: DatabaseSync) => db.prepare("SELECT action, details, entity_id FROM activity_logs WHERE action LIKE 'narrative_objection_%' ORDER BY id").all() as any[];

test('PUT /narrative/objections/:objection/answer records the version and section, replaces it, and the read carries it', async () => {
  const db = answerFixture();
  try {
    const key = await objectionKey('too small a market');
    const before = await call(db, FOUNDER, 'GET', '/raise/narrative/objections');
    assert.equal(before.body.answers, 'ok');
    assert.deepEqual(before.body.objections.map((o: any) => o.answered), [null, null], 'nothing answered yet');
    const r = await call(db, FOUNDER, 'PUT', answerPath(key), { version: 7, section: 'market', how: 'eadwyn' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.objection, r.body.answered.version, r.body.answered.section, r.body.answered.how, r.body.answered.by],
      [key, 7, 'market', 'eadwyn', { id: FOUNDER, name: 'Fay Founder' }]);
    const read = await call(db, FOUNDER, 'GET', '/raise/narrative/objections');
    assert.deepEqual(read.body.objections.map((o: any) => o.answered && [o.answered.version, o.answered.section, o.answered.how]), [[7, 'market', 'eadwyn'], null]);
    // One row per objection: a second answer replaces the first.
    assert.equal((await call(db, FOUNDER, 'PUT', answerPath(key), { version: '7', section: 'competition', how: 'picked' })).status, 200);
    assert.deepEqual(db.prepare('SELECT project_id, version, section_key, how FROM narrative_objection_answers').all().map((x: any) => ({ ...x })),
      [{ project_id: P, version: 7, section_key: 'competition', how: 'picked' }]);
    // The module read carries it too.
    const home = (await call(db, FOUNDER, 'GET', '/raise/modules/investor-narrative')).body.parts.narrative.objections;
    assert.equal(home.answers, 'ok');
    assert.equal(home.items[0].answered.section, 'competition');
    // Each write logged, naming the section and version, never the objection or an investor.
    const rows = logs(db);
    assert.deepEqual(rows.map((x) => [x.action, x.entity_id]), [['narrative_objection_answered', '7'], ['narrative_objection_answered', '7']]);
    assert.match(rows[0].details, /Market, version 7/);
    assert.match(rows[1].details, /Competition, version 7 \(picked by hand\)/);
    for (const x of rows) assert.doesNotMatch(x.details, /small|North|South|\$/i);
  } finally { db.close(); }
});

test('DELETE /narrative/objections/:objection/answer clears it, logged; nothing to clear is a 404', async () => {
  const db = answerFixture();
  try {
    const key = await objectionKey('too small a market');
    assert.equal((await call(db, FOUNDER, 'DELETE', answerPath(key))).status, 404, 'not answered yet');
    await call(db, FOUNDER, 'PUT', answerPath(key), { version: 7, section: 'market', how: 'picked' });
    assert.equal((await call(db, OTHER, 'PUT', answerPath(key), { version: 8, section: 'team', how: 'picked' }, PB)).status, 200, 'the other venture\'s same words');
    const r = await call(db, FOUNDER, 'DELETE', answerPath(key));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, { objection: key, answered: null });
    assert.deepEqual(db.prepare('SELECT project_id FROM narrative_objection_answers').all().map((x: any) => x.project_id), [PB], 'only this venture\'s answer is cleared');
    const last = logs(db).at(-1);
    assert.deepEqual([last.action, last.entity_id], ['narrative_objection_unanswered', '7']);
    assert.match(last.details, /Market, version 7/);
    assert.doesNotMatch(last.details, /small|North|South/i);
  } finally { db.close(); }
});

test('the answer write refuses: the objection, the section, the version, how, another venture and an admin', async () => {
  const db = answerFixture();
  try {
    const key = await objectionKey('too small a market');
    const put = (body: unknown, who = FOUNDER, k = key, pid = P) => call(db, who, 'PUT', answerPath(k), body, pid);
    const ok = { version: 7, section: 'market', how: 'picked' };
    assert.equal((await put(ok, FOUNDER, 'not-a-key')).status, 404);
    assert.equal((await put(ok, FOUNDER, '0'.repeat(16))).status, 404, 'no such objection here');
    assert.equal((await put({ ...ok, how: 'typed' })).status, 400);
    assert.equal((await put({ ...ok, section: 'nope' })).status, 404);
    assert.equal((await put({ ...ok, version: 0 })).status, 409, 'version 0 is the live deck');
    assert.equal((await put({ ...ok, version: 8 })).status, 404, 'another venture\'s version');
    assert.equal((await put({ section: 'market', how: 'picked' })).status, 404, 'no version');
    assert.equal((await put(ok, OTHER)).status, 403, 'not the venture\'s');
    // The other venture's own objection with the same words is its own: this one is not found there.
    assert.equal((await put({ ...ok, version: 8 }, OTHER, key, PB)).status, 200);
    assert.deepEqual((await call(db, FOUNDER, 'GET', '/raise/narrative/objections')).body.objections.map((o: any) => o.answered), [null, null], 'another venture\'s answer never reads here');
    assert.equal((await call(db, ADMIN, 'POST', '/raise/narrative/reads', { reason: 'Reviewing the raise with the founder' })).status, 201);
    const admin = await put(ok, ADMIN);
    assert.equal(admin.status, 403);
    assert.equal(admin.body.code, 'admin_read_only');
    assert.equal((await call(db, ADMIN, 'DELETE', answerPath(key))).status, 403);
    assert.deepEqual(db.prepare('SELECT project_id FROM narrative_objection_answers').all().map((x: any) => x.project_id), [PB], 'only the other venture\'s own answer');
  } finally { db.close(); }
});

test('a failed answers read leaves every objection unanswered-unknown, never hides the objections', async () => {
  const db = answerFixture();
  try {
    db.exec('DROP TABLE narrative_objection_answers');
    const r = await call(db, FOUNDER, 'GET', '/raise/narrative/objections');
    assert.equal(r.status, 200);
    assert.equal(r.body.answers, 'unreadable');
    assert.deepEqual(r.body.objections.map((o: any) => [o.count, o.answered]), [[3, null], [1, null]]);
    const home = (await call(db, FOUNDER, 'GET', '/raise/modules/investor-narrative')).body.parts.narrative.objections;
    assert.deepEqual([home.state, home.answers], ['ok', 'unreadable']);
  } finally { db.close(); }
});

test('groupObjections and objectionKey, alone', async () => {
  assert.equal(await objectionKey('Why  NOW?'), await objectionKey(' why now? '));
  assert.notEqual(await objectionKey('Why now?'), await objectionKey('Why not?'));
  const g = await groupObjections([
    { objection: 'B', answer: null, prospect_id: 1, created_at: '2026-10-02 00:00:00' },
    { objection: 'a', answer: 'newest', prospect_id: 1, created_at: '2026-10-02 00:00:00' },
    { objection: 'A', answer: 'older', prospect_id: 1, created_at: '2026-10-01 00:00:00' },
    { objection: '   ', answer: 'no words', prospect_id: 2, created_at: null },
  ]);
  assert.deepEqual(g.map((o) => [o.text, o.count, o.prospects, o.answer]), [['a', 2, 1, 'newest'], ['B', 1, 1, null]], 'a blank objection is no objection; ties by their words');
});

// ---------------------------------------------------------------------------
// "Answer it", on the real AI router with a stubbed model
// ---------------------------------------------------------------------------

const PAGE = 'Founder · Raise · Investor narrative';
const OPTION = 'draft:narrative-objection';
const GOOD = { text: 'The first customers are mid-market finance teams. Each one widens the market we serve.' };

async function draftFixture({ answer = GOOD as unknown, balance = 5000000 } = {}) {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.exec(sqlOf('465_ai_rail_preferences.sql'));
  f.db.exec(sqlOf('506_ai_rail_proposals.sql'));
  f.db.exec(`ALTER TABLE users ADD COLUMN founder_id INTEGER;
    UPDATE users SET founder_id = 20, subscription_tier = 'studio', name = 'Fay Founder' WHERE id = 2;
    ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
    ALTER TABLE activity_logs ADD COLUMN entity_type TEXT;
    ALTER TABLE activity_logs ADD COLUMN entity_id TEXT;
    ALTER TABLE activity_logs ADD COLUMN created_at TEXT DEFAULT (datetime('now'));
    CREATE TABLE projects (id INTEGER PRIMARY KEY, founder_id INTEGER, company_id INTEGER, name TEXT, solution TEXT);
    INSERT INTO projects VALUES (1, 20, NULL, 'Kestrel Labs', NULL);
    CREATE TABLE project_members (project_id INTEGER, user_id INTEGER, role TEXT, status TEXT);
    CREATE TABLE raise_prospects (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, name TEXT);
    INSERT INTO raise_prospects VALUES (11, 1, 'North Fund');`);
  f.db.exec(`CREATE TABLE spinout_deck_overrides (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, field_key TEXT NOT NULL, value TEXT,
    updated_by INTEGER, updated_at TEXT DEFAULT (datetime('now')), version INTEGER NOT NULL DEFAULT 0, investor_type TEXT, deck_version INTEGER,
    UNIQUE (project_id, version, field_key))`);
  const m463 = sqlOf('463_raise_record_stores.sql');
  f.db.exec(between(m463, 'CREATE TABLE IF NOT EXISTS raise_prospect_feedback'));
  f.db.exec(between(m463, 'CREATE TABLE IF NOT EXISTS narrative_version_meta'));
  f.db.exec(sqlOf('544_narrative_sections.sql'));
  // Version 2, for a seed fund: its Market words hold a figure, and so do the objection and the founder's answer.
  f.db.exec(`INSERT INTO spinout_deck_overrides (project_id, field_key, value, version, investor_type) VALUES
      (1, '__version__', 'seed_fund', 2, 'seed_fund'),
      (1, 'market.assumptions', 'A $4bn market of 30,000 finance teams.', 2, 'seed_fund');
    INSERT INTO narrative_version_meta (project_id, version, start_from, created_by) VALUES (1, 2, 'blank', 2);
    INSERT INTO raise_prospect_feedback (prospect_id, objection, answer) VALUES
      (11, 'Too small a market under $1bn', 'We reach 12,000 more teams through the wedge.');`);
  setFixtureAllowance(f.db, 0);
  if (balance) f.db.exec(`INSERT INTO ai_topup_accounts(user_id, balance_microusd) VALUES (2, ${balance})`);
  const prompts: string[] = [];
  const env: any = {
    DB: f.DB, JWT_SECRET: 'p'.repeat(64), ENVIRONMENT: 'development',
    AI: withGuard({ run: async (_model: string, input: any) => {
      prompts.push(JSON.stringify(input?.messages ?? input));
      return { response: typeof answer === 'string' ? answer : JSON.stringify(answer), usage: { prompt_tokens: 30, completion_tokens: 20 } };
    } }),
  };
  const jwt = async (id: number) => new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
  const draftApp = new Hono(); draftApp.route('/api/cycles/raise', cycleRaise);
  const post = async (path: string, body?: unknown, { who = 2 } = {}) => {
    const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
    try {
      const r = await draftApp.request(`/api/cycles/raise${path}?project=1`, {
        method: 'POST', headers: { Authorization: `Bearer ${await jwt(who)}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }, env);
      const raw = await r.text();
      return { status: r.status, body: raw ? JSON.parse(raw) : null };
    } finally { [console.warn, console.error] = saved; }
  };
  const count = (t: string) => Number((f.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n);
  const usage = () => f.db.prepare('SELECT task, rail_option FROM ai_usage_logs ORDER BY id').all() as any[];
  const key = await objectionKey('Too small a market under $1bn');
  return { ...f, post, prompts, count, usage, key, path: `/narrative/objections/${key}/draft` };
}

test('"Answer it" is metered under draft:narrative-objection, writes nothing, and no figure reaches the model', async () => {
  const f = await draftFixture();
  try {
    const feedback = f.db.prepare('SELECT objection, answer FROM raise_prospect_feedback').all();
    const r = await f.post(f.path, { version: 2, section: 'market' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.version, r.body.section, r.body.objection, r.body.text, r.body.removed], [2, 'market', f.key, GOOD.text, 0]);
    const prompt = f.prompts.at(-1)!;
    assert.match(prompt, /Section: Market/);
    assert.match(prompt, /Objection investors raised: Too small a market under \[figure\]/);
    assert.match(prompt, /The founder's own answer to it: We reach \[figure\] more teams through the wedge/);
    assert.match(prompt, /The founder's words now: A \[figure\] market of \[figure\] finance teams/);
    assert.match(prompt, /Audience: Seed fund/);
    assert.doesNotMatch(prompt, /\$1bn|12,000|\$4bn|30,000/, 'no recorded figure reaches the model');
    assert.ok(f.usage().some((u) => u.rail_option === OPTION), 'logged under its own option');
    // Writes nothing: no section, binding or proposal row, and the feedback is as it was.
    assert.deepEqual([f.count('narrative_sections'), f.count('narrative_bindings'), f.count('ai_rail_proposals')], [0, 0, 0]);
    assert.deepEqual(f.db.prepare('SELECT objection, answer FROM raise_prospect_feedback').all(), feedback);
    // The page's unsaved words are what is answered in.
    await f.post(f.path, { version: 2, section: 'market', words: 'Every team in 40 countries.' });
    assert.match(f.prompts.at(-1)!, /The founder's words now: Every team in \[figure\] countries/);
  } finally { f.db.close(); }
});

test('"Answer it": a sentence with a digit is dropped and counted; all dropped is a 422', async () => {
  let f = await draftFixture({ answer: { text: 'The market is wide. It grows 30% a year. Each team widens it.' } });
  try {
    const r = await f.post(f.path, { version: 2, section: 'market' });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.text, r.body.removed], ['The market is wide. Each team widens it.', 1]);
  } finally { f.db.close(); }
  f = await draftFixture({ answer: { text: 'Up 30%. Worth $4bn.' } });
  try {
    const r = await f.post(f.path, { version: 2, section: 'market' });
    assert.equal(r.status, 422);
    assert.deepEqual([r.body.code, r.body.removed], ['nothing_kept', 2]);
  } finally { f.db.close(); }
});

test('"Answer it" refusals: the objection, the section, the version, the switch, the purse and who asks', async () => {
  let f = await draftFixture();
  try {
    assert.equal((await f.post('/narrative/objections/not-a-key/draft', { version: 2, section: 'market' })).status, 404);
    assert.equal((await f.post(`/narrative/objections/${'0'.repeat(16)}/draft`, { version: 2, section: 'market' })).status, 404, 'no such objection here');
    assert.equal((await f.post(f.path, { version: 2 })).status, 400, 'a section is chosen');
    assert.equal((await f.post(f.path, { version: 2, section: 'nope' })).status, 404);
    assert.equal((await f.post(f.path, { version: 0, section: 'market' })).status, 409, 'version 0 is the live deck');
    assert.equal((await f.post(f.path, { section: 'market' })).status, 404, 'no version');
    assert.equal((await f.post(f.path, { version: 2, section: 'market' }, { who: 3 })).status, 403, 'not the venture\'s');
    const admin = await f.post(f.path, { version: 2, section: 'market' }, { who: 1 });
    assert.equal(admin.status, 403);
    assert.equal(admin.body.code ?? admin.body.error, 'admin_read_only');
    assert.equal(f.prompts.length, 0, 'no run for any refusal');
    f.db.prepare("INSERT INTO ai_rail_preferences (uid, user_id, section, task, mode) VALUES ('pref-1', 2, ?, '', 'manual')").run(PAGE.toLowerCase());
    const off = await f.post(f.path, { version: 2, section: 'market' });
    assert.equal(off.status, 403);
    assert.equal(off.body.error, 'assist_off');
    assert.equal(f.prompts.length, 0);
  } finally { f.db.close(); }
  f = await draftFixture({ balance: 0 });
  try {
    assert.equal((await f.post(f.path, { version: 2, section: 'market' })).status, 402);
    assert.equal(f.prompts.length, 0, 'nothing is run, nothing charged');
  } finally { f.db.close(); }
});
