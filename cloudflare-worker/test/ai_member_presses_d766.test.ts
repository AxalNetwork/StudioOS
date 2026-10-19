// D766 (#2094) PR 1 — the member presses that called env.AI.run directly now
// go through the router: Legal & Capital (the document's suggestions, the
// diligence summary, the spin-out's equity split), Pipeline (the decision gate)
// and Network Effects (the syndicate's recommendations, the marketplace match).
// Each run is the pressing member's: held, guarded and charged, and logged with
// D765's page, option and record. The switch answers 403, a budget stop 402 in
// the budget's words, and a model that could not be reached keeps the route's
// non-AI path. The AI's equity split is a proposal (D720 §9), and its document
// suggestions sit beside the document, never in it. Real SQLite
// (`_ai_budget_fixture.mjs`); env.AI is stubbed with the guard stub. Each case
// names the mutations it was checked against.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/ai_member_presses_d766.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { ROUTE, ASSIST_OFF_MESSAGE, budgetRefusalMessage, __resetForTest } from '../src/services/aiRouter.ts';
import legalcap from '../src/routes/legalcap.ts';
import pipeline from '../src/routes/pipeline.ts';
import networkfx from '../src/routes/networkfx.ts';

const RAIL_PREFS = readFileSync(new URL('../sql/migrations/465_ai_rail_preferences.sql', import.meta.url), 'utf8');
const MEMBER = 2;

function makeAI(handler: (model: string, payload: any) => any) {
  const calls: Array<{ model: string; payload: any }> = [];
  return { calls, async run(model: string, payload: any) { calls.push({ model, payload }); return handler(model, payload); } };
}
const reply = (text: string) => ({ response: text, usage: { prompt_tokens: 40, completion_tokens: 12 } });

function world(ai: any, { balance = 5_000_000 } = {}) {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.exec(RAIL_PREFS);
  f.db.exec(`CREATE TABLE projects(id INTEGER PRIMARY KEY, name TEXT, sector TEXT, stage TEXT, problem_statement TEXT, solution TEXT, score REAL, founder_id INTEGER, company_id INTEGER);
             INSERT INTO projects(id,name,sector,stage) VALUES(7,'Harbour','logistics','mvp');`);
  f.db.prepare("UPDATE users SET role = 'partner' WHERE id = ?").run(MEMBER);
  f.db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('partner',0,0,1)").run();
  f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,?)').run(MEMBER, balance);
  // What the guard was asked to check, as the guard stub hands it its input.
  const guarded: string[] = [];
  const env: any = { DB: f.DB, AI: withGuard(ai, (input: unknown) => { guarded.push(JSON.stringify(input)); return 'safe'; }), JWT_SECRET: 'd766-fixture-only-secret', ENVIRONMENT: 'development' };
  return { f, env, guarded };
}
function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/legalcap', legalcap);
  a.route('/api/pipeline', pipeline);
  a.route('/api/networkfx', networkfx);
  return a;
}
async function call(w: any, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const jwt = await new SignJWT({ user_id: MEMBER }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
/** The router's rows (Llama Guard's own rows aside). */
const rows = (w: any) => w.f.db.prepare('SELECT user_id, task, surface, rail_page, rail_option, record_ref, charged_microusd FROM ai_usage_logs WHERE guard_for IS NULL ORDER BY id').all().map((r: any) => ({ ...r }));
const modelCalls = (ai: any) => ai.calls;

// 1 ───────────────────────────────────────────────────────────────────────────
test('marketplace match: the member\'s run on rail_match, with the browser\'s page and its option, charged to the member', async () => {
  // Mutations checked: userId 0 passed (a system run); the rail dropped; the surface dropped; the guard handed the profiles.
  const ai = makeAI(() => reply('{"recommendations":[]}'));
  const w = world(ai);
  const r = await call(w, 'POST', '/api/networkfx/marketplace/match', { need: 'A logistics operator' }, { 'X-Rail-Page': encodeURIComponent('Founder · Network') });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(modelCalls(ai).map((c: any) => c.model), [ROUTE.rail_match.model]);
  const [row] = rows(w);
  assert.equal(row.user_id, MEMBER);
  assert.equal(row.task, 'rail_match');
  assert.equal(row.surface, '/network-effects');
  assert.deepEqual([row.rail_page, row.rail_option, row.record_ref], ['Founder · Network', 'match:marketplace', null]);
  assert.ok(row.charged_microusd > 0, 'the member who pressed was charged');
  const { guarded } = w;
  assert.ok(guarded.some((p: string) => p.includes('A logistics operator')), 'the guard read the need');
  assert.ok(!guarded.some((p: string) => p.includes('Available profiles')), 'and not the other members\' profiles');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('the switch: a page turned off answers 403 in its words, with no model called and nothing held', async () => {
  // Mutations checked: refuseRun answering assist_off as a fallback; the route ignoring `refused`.
  const ai = makeAI(() => reply('x'));
  const w = world(ai);
  w.f.db.prepare("INSERT INTO ai_rail_preferences(uid,user_id,section,task,mode) VALUES('off',?,'network-effects','','manual')").run(MEMBER);
  const r = await call(w, 'POST', '/api/networkfx/marketplace/match', { need: 'A designer' });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'assist_off');
  assert.equal(r.body.message, ASSIST_OFF_MESSAGE);
  assert.deepEqual(ai.calls, []);
  assert.equal(w.f.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n, 0);
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('a budget stop answers 402 in the budget\'s words; a model that cannot be reached keeps the gate\'s rule-based recommendation', async () => {
  // Mutations checked: the budget refusal treated as a model failure; a model failure answered as a refusal.
  const broke = world(makeAI(() => reply('x')), { balance: 0 });
  const r = await call(broke, 'POST', '/api/pipeline/decision-gate/review', { deal_id: 7 });
  assert.equal(r.status, 402, JSON.stringify(r.body));
  assert.equal(r.body.message, budgetRefusalMessage(r.body.error));
  assert.equal(broke.f.db.prepare('SELECT COUNT(*) AS n FROM decision_gates').get().n, 0, 'no gate was opened');

  const down = makeAI(() => { throw new Error('5007: model unavailable'); });
  const w = world(down);
  const ok = await call(w, 'POST', '/api/pipeline/decision-gate/review', { deal_id: 7 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const gate = w.f.db.prepare('SELECT status, ai_recommendation, ai_explanation FROM decision_gates').get();
  assert.equal(gate.status, 'pending', 'a gate is a recommendation for a person to decide');
  assert.match(gate.ai_explanation, /^Rule-based: traction score 0\/100/);
  assert.deepEqual(rows(w).map((x: any) => [x.task, x.rail_option, x.record_ref, x.surface]), [['rail_reason', 'review:decision-gate', 'deal:7', '/pipeline']]);
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('legal documents: the AI\'s suggestions are kept beside the document, never written into its text', async () => {
  // Mutations checked: the suggestions appended to the body again; the record dropped from the rail.
  const ai = makeAI(() => reply('- Add a pro-rata side letter.'));
  const w = world(ai);
  const r = await call(w, 'POST', '/api/legalcap/legal/generate', { deal_id: 7, type: 'SAFE' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const doc = JSON.parse(w.f.db.prepare('SELECT content FROM legal_documents').get().content);
  assert.equal(doc.suggestions, '- Add a pro-rata side letter.');
  assert.doesNotMatch(doc.body, /pro-rata side letter|AI-Generated Suggestions/);
  assert.equal(doc.model, ROUTE.rail_legal.model);
  assert.deepEqual(rows(w).map((x: any) => [x.task, x.rail_page, x.rail_option, x.record_ref]), [['rail_legal', 'legal-capital', 'draft:legal/SAFE', 'deal:7']]);
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('the spin-out\'s equity split: asked of the AI it is a proposal and nothing is written; Save posts it back and writes it', async () => {
  // Mutations checked: the proposal written to the subsidiary; Save refused after a proposal.
  const ai = makeAI(() => reply('{"studio_pct":15,"founders_pct":70,"option_pool_pct":13,"advisors_pct":2}'));
  const w = world(ai);
  w.f.db.exec(`CREATE TABLE IF NOT EXISTS subsidiaries(id INTEGER PRIMARY KEY, deal_id INTEGER, spinout_status TEXT, equity_allocation_json TEXT, equity_allocated TEXT, updated_at TEXT);
               INSERT INTO subsidiaries(id,deal_id,spinout_status) VALUES(3,7,'ip_transferred');`);
  const proposed = await call(w, 'POST', '/api/legalcap/spinout/equity-allocate', { deal_id: 7 });
  assert.equal(proposed.status, 200, JSON.stringify(proposed.body));
  assert.equal(proposed.body.proposal, true);
  assert.deepEqual(proposed.body.allocation, { studio_pct: 15, founders_pct: 70, option_pool_pct: 13, advisors_pct: 2 });
  const before = w.f.db.prepare('SELECT spinout_status, equity_allocation_json FROM subsidiaries').get();
  assert.deepEqual({ ...before }, { spinout_status: 'ip_transferred', equity_allocation_json: null }, 'the proposal wrote nothing');
  assert.deepEqual(rows(w).map((x: any) => [x.task, x.rail_option]), [['rail_numbers', 'propose:spinout/equity']]);

  const saved = await call(w, 'POST', '/api/legalcap/spinout/equity-allocate', { deal_id: 7, allocation: proposed.body.allocation, proposed: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.spinout_status, 'equity_allocated');
  assert.equal(w.f.db.prepare('SELECT spinout_status FROM subsidiaries').get().spinout_status, 'equity_allocated');
  assert.equal(modelCalls(ai).length, 1, 'Save runs no model');
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('no member route calls env.AI.run directly any more; the wizard\'s AI press saves nothing', () => {
  // Mutations checked: a route reverted to env.AI.run; the wizard reloading over the proposal.
  for (const f of ['legalcap', 'pipeline', 'networkfx']) {
    const src = readFileSync(`cloudflare-worker/src/routes/${f}.ts`, 'utf8');
    assert.doesNotMatch(src, /\benv\.AI\.run\(/, `${f}.ts still calls env.AI.run`);
    assert.match(src, /rail: railFor\(c, \{ page: '[a-z-]+', option/, `${f}.ts passes no rail context`);
  }
  const wizard = readFileSync('frontend/src/components/SpinoutWizard.jsx', 'utf8');
  const askAI = wizard.slice(wizard.indexOf('const askAI'), wizard.indexOf('const saveEquity'));
  assert.doesNotMatch(askAI, /reload\(\)/, 'reloading would draw the saved split over the proposal');
  assert.match(wizard, /api\.spinoutEquity\(\{ deal_id: deal\.id, allocation, proposed: aiRecommended \}\)/);
});
