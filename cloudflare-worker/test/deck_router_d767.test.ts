/**
 * D767 (#2096) PR 2 — the deck draft and the slide fill run through the
 * router's `run()`: Workers AI, held, guarded and charged to the founder who
 * pressed, with Raise › Pitch deck's page and option on the usage row. Neither
 * reaches OpenAI.
 *
 *  - A fill makes one `rail_vision` run and writes one usage row naming the
 *    founder, `/raise/pitch` (surface and rail page), the option and the
 *    project; its answer fills the AI-only fields.
 *  - The draft does the same with option `deck_draft`.
 *  - A refused run (no funds) charges nothing and leaves the AI fields as
 *    placeholders, as a missing key did; the fill still answers.
 *  - Source pins: no `api.openai.com` and no `OPENAI_API_KEY` in either path.
 *
 * `env.AI` is stubbed; `fetch` throws if anything reaches the network.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_router_d767.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { autofillDeck } from '../src/services/decks/autofill.ts';
import { getMethod } from '../src/services/decks/methods.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import decks from '../src/routes/decks.ts';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const JWT_SECRET = 'unit-test-jwt-secret-d767-router-0123456789';
const PROJECT = {
  id: 1, founder_id: null, company_id: null, name: 'Acme AI', sector: 'B2B SaaS', stage: 'Seed',
  description: 'Agentic CRM.', problem_statement: 'Data entry.', solution: 'An agent.',
};

function fixture({ funded = true } = {}) {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.exec('ALTER TABLE users ADD COLUMN founder_id INTEGER; ALTER TABLE activity_logs ADD COLUMN project_id INTEGER; ALTER TABLE activity_logs ADD COLUMN entity_type TEXT; ALTER TABLE activity_logs ADD COLUMN entity_id TEXT;');
  f.db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, founder_id INTEGER, company_id INTEGER, name TEXT, sector TEXT, stage TEXT,
    description TEXT, problem_statement TEXT, solution TEXT);
    CREATE TABLE financial_models (project_id INTEGER, computed_json TEXT, assumptions_json TEXT);
    CREATE TABLE cap_table_holders (project_id INTEGER, name TEXT, shares INTEGER, kind TEXT);
    CREATE TABLE score_snapshots (id INTEGER PRIMARY KEY, project_id INTEGER, total_score REAL, created_at TEXT);
    CREATE TABLE landing_pages (id INTEGER PRIMARY KEY, project_id INTEGER);`);
  f.db.prepare('INSERT INTO projects (id, name, sector, stage, description, problem_statement, solution) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(PROJECT.id, PROJECT.name, PROJECT.sector, PROJECT.stage, PROJECT.description, PROJECT.problem_statement, PROJECT.solution);
  setFixtureAllowance(f.db, 0); // D783: no plan, and no tokens
  if (funded) f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)').run();
  const calls: Array<{ model: string; prompt: string }> = [];
  const AI = withGuard({
    run: async (model: string, input: any) => {
      const prompt = (input?.messages || []).map((m: any) => (typeof m?.content === 'string' ? m.content : '')).join('\n');
      calls.push({ model, prompt });
      const hints = JSON.parse(prompt.match(/Hints:\s*(\[[^\]]+\])/)?.[1] || '[]') as string[];
      const response = hints.length
        ? JSON.stringify(Object.fromEntries(hints.map((h) => [h, `AI wrote ${h}`])))
        : JSON.stringify({ slides: [{ title: 'Problem', subtitle: 'Pain', body: 'AI drafted this.', bullets: ['one', 'two'] }, { title: 'Ask', body: 'Invented 18–24 month runway', bullets: ['Invented 24+ months'] }, ...['The Ask', 'Ask & Use of Funds', 'ask'].map(title => ({ title, body: 'Invented 18–24 month runway', bullets: ['Invented 24+ months'] }))] });
      return { response, usage: { prompt_tokens: 40, completion_tokens: 20 } };
    },
  });
  const env: any = { DB: f.DB, ENVIRONMENT: 'development', JWT_SECRET, AI };
  // The run's own rows; the guard's (`guard_for` set) are D763's to test.
  const rows = () => (f.db.prepare('SELECT user_id, task, surface, rail_page, rail_option, record_ref, charged_microusd FROM ai_usage_logs WHERE guard_for IS NULL ORDER BY id').all() as any[]).map((r) => ({ ...r }));
  return { ...f, env, calls, rows };
}

function noNetwork() {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  return () => { globalThis.fetch = real; };
}

const ROW = (option: string) => ({ user_id: 2, task: 'rail_vision', surface: '/raise/pitch', rail_page: '/raise/pitch', rail_option: option, record_ref: 'project:1' });

test('a fill is one router run, charged to the founder, with the page and the option on its one usage row', async () => {
  const f = fixture();
  const restore = noNetwork();
  try {
    const method = getMethod('yc_seed')!;
    const filled = await autofillDeck(f.env, method, 1, { userId: 2, railOption: 'fill_from_project', projectId: 1 });
    const rows = f.rows();
    assert.equal(rows.length, 1, 'one usage row for the fill');
    const { charged_microusd, ...who } = rows[0];
    assert.deepEqual(who, ROW('fill_from_project'));
    assert.ok(charged_microusd > 0, 'the founder is charged for the run');
    assert.equal(f.calls.filter((c) => !/llama-guard/.test(c.model)).length, 1, 'one model call');
    const guarded = f.db.prepare('SELECT COUNT(*) AS n FROM ai_usage_logs WHERE guard_for IS NOT NULL').get() as any;
    assert.ok(guarded.n >= 1, 'the run is guarded (D763 writes the guard\'s row)');
    const values = JSON.stringify(filled.slides);
    assert.match(values, /AI wrote /, 'the run\'s answer fills the AI-only fields');
  } finally { restore(); f.db.close(); }
});

test('a refused run (nothing to charge it to) charges nothing and leaves the AI fields as placeholders', async () => {
  const f = fixture({ funded: false });
  const restore = noNetwork();
  try {
    const filled = await autofillDeck(f.env, getMethod('yc_seed')!, 1, { userId: 2, railOption: 'fill_from_project', projectId: 1 });
    assert.equal(filled.slides.length, getMethod('yc_seed')!.slides.length, 'the fill still answers');
    assert.doesNotMatch(JSON.stringify(filled.slides), /AI wrote /);
    assert.equal(f.calls.filter((c) => !/llama-guard/.test(c.model)).length, 0, 'no model call');
    assert.ok(f.rows().every((r) => !r.charged_microusd), 'nothing charged');
  } finally { restore(); f.db.close(); }
});

test('with no founder to charge, the fill makes no run at all', async () => {
  const f = fixture();
  const restore = noNetwork();
  try {
    await autofillDeck(f.env, getMethod('yc_seed')!, 1);
    assert.equal(f.calls.length, 0);
    assert.equal(f.rows().length, 0);
  } finally { restore(); f.db.close(); }
});

test('the deck draft is one router run with option deck_draft', async () => {
  const f = fixture();
  f.db.prepare("INSERT INTO users(id,email,name,role,subscription_tier) VALUES(500,'owner.d767@example.test','Owner','founder','studio')").run();
  f.db.exec('UPDATE users SET founder_id = 500 WHERE id = 500; UPDATE projects SET founder_id = 500 WHERE id = 1');
  const restore = noNetwork();
  try {
    const app = new Hono<any>();
    app.route('/api/decks', decks);
    // The venture owner passes the project and studio-tier gates; the run is charged to them.
    f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(500,5000000)').run();
    f.db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('founder:free',0,0,1)").run();
    const jwt = await new SignJWT({ user_id: 500, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));
    const res = await app.request('/api/decks/generate', {
      method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify({ project_id: 1 }),
    }, f.env);
    const text = await res.text();
    assert.ok(res.status < 300, `${res.status} ${text}`);
    const rows = f.rows();
    assert.equal(rows.length, 1, `one usage row: ${JSON.stringify(rows)}`);
    const { charged_microusd, ...who } = rows[0];
    assert.deepEqual(who, { ...ROW('deck_draft'), user_id: 500 });
    assert.match(text, /AI drafted this\./, 'the draft uses the run\'s answer');
    assert.match(text, /Runway: Not recorded/);
    assert.doesNotMatch(text, /Invented|18–24|24\+/);
  } finally { restore(); f.db.close(); }
});

test('"Fill from project" through its route is one run with D771\'s page and option form:deck (D778 part 5), charged to who pressed', async () => {
  const f = fixture();
  f.db.prepare("INSERT INTO users(id,email,name,role,subscription_tier) VALUES(500,'owner.d767@example.test','Owner','founder','studio')").run();
  f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(500,5000000)').run();
  f.db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('founder:free',0,0,1)").run();
  f.db.exec('UPDATE users SET founder_id = 500 WHERE id = 500; UPDATE projects SET founder_id = 500 WHERE id = 1');
  const restore = noNetwork();
  try {
    const app = new Hono<any>();
    app.route('/api/decks', decks);
    const jwt = await new SignJWT({ user_id: 500, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));
    const headers = { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' };
    // A deck on the yc_seed template (its slides carry the method stamp the fill reads).
    await app.request('/api/decks/by-project/1', { headers }, f.env); // creates the deck tables
    f.db.prepare(`INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES (10, 1, 1, ?, 'Seed deck', 1, 500)`)
      .run(JSON.stringify([{ title: 'Problem', method_id: 'yc_seed', spec_id: 'problem', fields: [] }]));
    const res = await app.request('/api/decks/10/autofill', { method: 'POST', headers, body: '{}' }, f.env);
    assert.equal(res.status, 200, await res.text());
    const rows = f.rows();
    assert.equal(rows.length, 1, `one usage row: ${JSON.stringify(rows)}`);
    const { charged_microusd, ...who } = rows[0];
    assert.deepEqual(who, { ...ROW('form:deck'), rail_page: 'Founder · Raise · Pitch deck', user_id: 500 });
  } finally { restore(); f.db.close(); }
});

test('both runs use Raise › Pitch deck\'s row in D764\'s matrix', () => {
  const matrix = JSON.parse(readFileSync(resolve(ROOT, 'cloudflare-worker/src/services/ai/railMatrix.json'), 'utf8'));
  const row = matrix.rows.find((r: any) => r.pageKey === 'Founder · Raise · Pitch deck');
  assert.ok(row, 'the matrix has the page\'s row');
  assert.deepEqual([row.kind, row.routeTask], ['vision', 'rail_vision']);
  for (const f of ['cloudflare-worker/src/routes/decks.ts', 'cloudflare-worker/src/services/decks/autofill.ts']) {
    const src = readFileSync(resolve(ROOT, f), 'utf8');
    assert.equal((src.match(new RegExp(`task: '${row.routeTask}'`, 'g')) || []).length, 1, `${f} runs the row's task`);
    assert.doesNotMatch(src, /task: 'dd_synthesis'/, f);
  }
});

test('neither path reaches OpenAI', () => {
  const autofill = readFileSync(resolve(ROOT, 'cloudflare-worker/src/services/decks/autofill.ts'), 'utf8');
  assert.doesNotMatch(autofill, /api\.openai\.com|OPENAI_API_KEY/);
  const route = readFileSync(resolve(ROOT, 'cloudflare-worker/src/routes/decks.ts'), 'utf8');
  const draft = route.slice(route.indexOf('async function aiSlides('), route.indexOf('function enforceTen('));
  assert.ok(draft.length > 100);
  assert.doesNotMatch(draft, /api\.openai\.com|OPENAI_API_KEY/);
  assert.match(draft, /aiRouterRun\(env, \{\s*task: 'rail_vision'/);
});
