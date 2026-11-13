/**
 * D1442 (#3991) — the Ask panel's Worker part: the quote before Send, the
 * support-session and Explorer refusals on create, quote and ask, and the
 * rail proposals listed by page and by run (migration 694's index).
 *
 * Real SQLite (the AI budget fixture, migration 444's conversations, migration
 * 506's proposals); env.AI is stubbed and counted, so "nothing was run" is an
 * observed fact.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/ask_quote_d1442.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { registerProvider } from '../src/integrations/registry.ts';
import eadwyn, { ASK_REFUSALS } from '../src/routes/eadwyn.ts';
import railProposals from '../src/routes/ai_rail_proposals.ts';
import { listRail, proposeRail } from '../src/services/railProposals.ts';

const EADWYN_SQL = readFileSync(new URL('../sql/migrations/444_eadwyn_conversations.sql', import.meta.url), 'utf8');
const PROPOSALS_SQL = readFileSync(new URL('../sql/migrations/506_ai_rail_proposals.sql', import.meta.url), 'utf8');
const M694 = readFileSync(new URL('../sql/migrations/694_ai_rail_proposals_page_index.sql', import.meta.url), 'utf8');
const SRC = readFileSync(new URL('../src/routes/eadwyn.ts', import.meta.url), 'utf8');
const SECRET = 'd1442-fixture-only-secret-0123456789';
const ME = 2, OTHER = 3, EXPLORER = 7, ADMIN = 1, COMPANY = 41;

// A connector whose reader returns facts, so switching it on makes the run's context longer.
registerProvider({ key: 'stripe', connect: async () => ({ credentials: {} as any }) } as any);

function world() {
  __resetForTest();
  const { DB, db } = aiBudgetFixture();
  db.exec(`
    UPDATE users SET subscription_tier = 'studio' WHERE id IN (${ME}, ${OTHER}, ${EXPLORER});
    UPDATE users SET role = 'exploring' WHERE id = ${EXPLORER};
    CREATE TABLE user_sessions (jti TEXT, user_id INTEGER, revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT);
    CREATE TABLE integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, user_id INTEGER, provider_key TEXT, display_name TEXT,
      status TEXT, auth_type TEXT, credentials_enc TEXT, config_json TEXT, capabilities_json TEXT, scopes_json TEXT,
      external_account_id TEXT, external_account_name TEXT, webhook_secret_enc TEXT,
      last_synced_at TEXT, last_error TEXT, last_error_at TEXT, created_at TEXT, updated_at TEXT
    );
    INSERT INTO integrations (id, uid, user_id, provider_key, status) VALUES (1, 'i1', ${ME}, 'stripe', 'active');
    CREATE TABLE integration_logs (id INTEGER PRIMARY KEY);
    CREATE TABLE integration_waitlist (id INTEGER PRIMARY KEY);
    CREATE TABLE integration_companies (integration_id INTEGER, company_id INTEGER, enabled INTEGER);
    INSERT INTO integration_companies VALUES (1, ${COMPANY}, 1);
    CREATE TABLE user_company_links (user_id INTEGER, company_id INTEGER);
    CREATE TABLE IF NOT EXISTS company_profiles (id INTEGER PRIMARY KEY, archived_at TEXT);
    INSERT INTO user_company_links VALUES (${ME}, ${COMPANY}), (${OTHER}, ${COMPANY}), (${EXPLORER}, ${COMPANY});
    CREATE TABLE project_metrics (id INTEGER PRIMARY KEY, project_id INTEGER, snapshot_date TEXT, mrr REAL, arr REAL, monthly_churn_pct REAL, active_users INTEGER, source TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
  `);
  db.exec(EADWYN_SQL);
  db.exec(PROPOSALS_SQL);
  const calls: string[] = [];
  const env: any = {
    JWT_SECRET: SECRET, DB, ENVIRONMENT: 'development',
    AI: {
      run: async (model: string) => {
        calls.push(model);
        if (/guard/.test(model)) return { response: 'safe' };
        return { response: '{"answer":"Nothing here records that.","send":null}', usage: { prompt_tokens: 40, completion_tokens: 12 } };
      },
    },
  };
  return { env, db, calls };
}

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/eadwyn', eadwyn);
  a.route('/api/ai/rail/proposals', railProposals);
  return a;
}

async function call(w: any, who: number, method: string, path: string, body?: unknown, opts: { support?: boolean } = {}) {
  const role = who === EXPLORER ? 'exploring' : who === ADMIN ? 'admin' : 'founder';
  const jwt = await new SignJWT({ user_id: who, role, ...(opts.support ? { impersonated_by: ADMIN } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const r = await app().request(path, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json', 'x-company-id': String(COMPANY) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, w.env);
  return { status: r.status, json: await r.json().catch(() => null) as any };
}

const usageRows = (db: DatabaseSync) => (db.prepare('SELECT COUNT(*) AS n FROM ai_usage_logs').get() as any).n as number;
const messages = (db: DatabaseSync) => (db.prepare('SELECT COUNT(*) AS n FROM eadwyn_messages').get() as any).n as number;

async function start(w: any, who = ME) {
  const r = await call(w, who, 'POST', '/api/eadwyn/conversations', { workspace: 'Build' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.conversation.uid as string;
}

// 1 ───────────────────────────────────────────────────────────────────────────
test('the quote says the hold before Send, with the model, and runs, holds and writes nothing', async () => {
  // Mutations checked: the quote calling run() instead of quoteRun(); the quote storing the question as a message.
  const w = world();
  const uid = await start(w);
  const before = usageRows(w.db);
  const q = await call(w, ME, 'POST', `/api/eadwyn/conversations/${uid}/quote`, { question: 'What is my MRR?', page: '/build/solution' });
  assert.equal(q.status, 200, JSON.stringify(q.json));
  assert.equal(q.json.ai, true);
  assert.ok(Number.isSafeInteger(q.json.hold_microusd) && q.json.hold_microusd > 0, `a hold of ${q.json.hold_microusd}`);
  assert.equal(typeof q.json.model, 'string');
  assert.ok(q.json.model_label === null || typeof q.json.model_label === 'string');
  assert.equal(usageRows(w.db), before, 'the quote wrote an ai_usage_logs row');
  assert.equal(messages(w.db), 0, 'the quote stored a message');
  assert.deepEqual(w.calls, [], 'the quote reached the model or the guard');

  assert.equal((await call(w, ME, 'POST', `/api/eadwyn/conversations/${uid}/quote`, { question: '  ' })).json.error, 'question_required');
  assert.equal((await call(w, ME, 'POST', `/api/eadwyn/conversations/${uid}/quote`, { question: '  ' })).status, 400);
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('the quote and the ask build their run from one helper, so the hold prices what the ask sends', async () => {
  // Mutations checked: the quote priced on the question alone (no connector data, no file) — the holds stop growing.
  const code = SRC.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.equal((code.match(/systemPrompt:/g) || []).length, 1, 'the run is built in one place');
  const quote = code.slice(code.indexOf("eadwyn.post('/conversations/:uid/quote'"), code.indexOf("eadwyn.post('/conversations/:uid/ask'"));
  const ask = code.slice(code.indexOf("eadwyn.post('/conversations/:uid/ask'"), code.indexOf('// RULE 2 in the route'));
  assert.match(quote, /quoteRun\(c\.env, askRunOptions\(c, user, await askInputs\(/);
  assert.match(ask, /const opts = askRunOptions\(c, user, inputs\)/);
  assert.match(ask, /aiRun\(c\.env, \{ \.\.\.opts, task: opts\.task, surface: page, rail: opts\.rail \}\)/);

  const w = world();
  const uid = await start(w);
  const hold = async (body: Record<string, unknown>) => (await call(w, ME, 'POST', `/api/eadwyn/conversations/${uid}/quote`, body)).json.hold_microusd as number;
  const plain = await hold({ question: 'Summarise my week' });
  const withFile = await hold({ question: 'Summarise my week', file: { name: 'notes.txt', text: 'x'.repeat(6000) } });
  assert.ok(withFile > plain, `an attached file did not raise the hold (${plain} → ${withFile})`);
  // The ask then runs on the same builder, and records one row.
  const before = usageRows(w.db);
  const r = await call(w, ME, 'POST', `/api/eadwyn/conversations/${uid}/ask`, { question: 'Summarise my week' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(usageRows(w.db) > before, 'the ask recorded no usage');
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('a support session gets 403 on create, quote and ask, before anything is read, run or held', async () => {
  // Mutations checked: the impersonation check removed from each of create, quote and ask, in turn.
  const w = world();
  const uid = await start(w);
  const before = usageRows(w.db);
  for (const [method, path, body] of [
    ['POST', '/api/eadwyn/conversations', { workspace: 'Build' }],
    ['POST', `/api/eadwyn/conversations/${uid}/quote`, { question: 'hi' }],
    ['POST', `/api/eadwyn/conversations/${uid}/ask`, { question: 'hi' }],
  ] as const) {
    const r = await call(w, ME, method, path, body, { support: true });
    assert.equal(r.status, 403, `${path}: ${r.status}`);
    assert.equal(r.json.error, 'support_session_refused', path);
    assert.equal(r.json.message, ASK_REFUSALS.support_session_refused);
  }
  assert.equal(usageRows(w.db), before, 'a support session placed a hold');
  assert.deepEqual(w.calls, [], 'a support session reached the model');
  assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM eadwyn_conversations').get() as any).n, 1, 'a support session started a conversation');
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('an Explorer gets 403 no_profile on create, quote and ask', async () => {
  // Mutations checked: the Explorer check removed.
  const w = world();
  const mine = await start(w);
  const r = await call(w, EXPLORER, 'POST', '/api/eadwyn/conversations', { workspace: 'Build' });
  assert.deepEqual([r.status, r.json.error, r.json.message], [403, 'no_profile', ASK_REFUSALS.no_profile]);
  for (const path of [`/api/eadwyn/conversations/${mine}/quote`, `/api/eadwyn/conversations/${mine}/ask`]) {
    const x = await call(w, EXPLORER, 'POST', path, { question: 'hi' });
    assert.deepEqual([x.status, x.json.error], [403, 'no_profile'], path);
  }
  assert.deepEqual(w.calls, []);
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('another member\'s conversation is not found for the quote, as for the ask', async () => {
  // Mutations checked: the quote loading the conversation without `user_id`.
  const w = world();
  const mine = await start(w);
  for (const path of [`/api/eadwyn/conversations/${mine}/quote`, `/api/eadwyn/conversations/${mine}/ask`]) {
    const r = await call(w, OTHER, 'POST', path, { question: 'hi' });
    assert.equal(r.status, 404, path);
  }
  assert.equal((await call(w, ME, 'POST', '/api/eadwyn/conversations/0123456789abcdef0123456789abcdef/quote', { question: 'hi' })).status, 404);
  assert.deepEqual(w.calls, []);
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('GET /api/ai/rail/proposals: by page, by run, never neither, the caller\'s rows only, at most 50', async () => {
  // Mutations checked: `user_id` unbound; the page filter dropped; the run filter dropped; the LIMIT raised; the 400 removed.
  const w = world();
  // The runs the rows name (usage_log_id references ai_usage_logs).
  for (const [id, user] of [[11, ME], [12, ME], [13, ME], [14, OTHER]]) {
    w.db.prepare("INSERT INTO ai_usage_logs (id, user_id, task, model) VALUES (?, ?, 'form_fill', '@cf/x')").run(id, user);
  }
  const p = (userId: number, page: string, option: string, usageLogId: number | null = null) =>
    proposeRail(w.env, { userId, page, option, record: null, kind: 'proposal', payload: { text: 'A line' }, model: '@cf/x', usageLogId });
  await p(ME, 'Founder · Build', 'fill:solution', 11);
  await p(ME, 'Founder · Build', 'fill:mvp', 11);
  await p(ME, 'Founder · Build', 'fill:mvp', 12);
  await p(ME, 'Founder · Raise', 'fill:deck', 13);
  await p(OTHER, 'Founder · Build', 'fill:solution', 14);

  const page = await call(w, ME, 'GET', `/api/ai/rail/proposals?page=${encodeURIComponent('Founder · Build')}`);
  assert.equal(page.status, 200);
  assert.equal(page.json.proposals.length, 3, 'the page lists the caller\'s three rows on it');
  assert.ok(page.json.proposals.every((x: any) => x.rail_page === 'Founder · Build'));

  const run = await call(w, ME, 'GET', `/api/ai/rail/proposals?page=${encodeURIComponent('Founder · Build')}&run=11`);
  assert.deepEqual(run.json.proposals.map((x: any) => x.rail_option).sort(), ['fill:mvp', 'fill:solution'], 'run= narrows to one run');
  const both = await call(w, ME, 'GET', '/api/ai/rail/proposals?option=fill:mvp&run=12');
  assert.equal(both.json.proposals.length, 1, 'an option with a run');

  const none = await call(w, ME, 'GET', '/api/ai/rail/proposals');
  assert.deepEqual([none.status, none.json.error], [400, 'option_or_page_required']);
  assert.equal((await call(w, ME, 'GET', '/api/ai/rail/proposals?page=x&run=-3')).json.error, 'invalid_run');
  assert.equal((await call(w, ME, 'GET', '/api/ai/rail/proposals?option=fill:mvp')).json.proposals.length, 2, 'option alone still works');

  for (let i = 0; i < 60; i += 1) await p(ME, 'Founder · Grow', 'fill:grow');
  assert.equal((await listRail(w.env, ME, { page: 'Founder · Grow' })).length, 50, 'the cap is 50');
  assert.deepEqual(await listRail(w.env, OTHER, { page: 'Founder · Raise' }), [], 'another member\'s page');
  assert.deepEqual(await listRail(w.env, ME, {}), [], 'neither filter lists nothing');
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('migration 694 is additive and applies twice', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(PROPOSALS_SQL);
  db.exec(M694);
  db.exec(M694);
  const idx = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_ai_rail_proposals_user_page'").get() as any;
  assert.match(idx.sql, /\(user_id, rail_page, status, id DESC\)/);
  assert.doesNotMatch(M694, /\b(DROP|DELETE|UPDATE|ALTER)\b/i, 'only an index');
});
