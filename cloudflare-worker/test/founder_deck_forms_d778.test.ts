/**
 * D778 part 5 (#2103) — the pitch deck's two form fills through the run path:
 * `form:deck` ("Fill from project") and `form:deck-template` ("Use this
 * template"). A run with no rail context names the page and option D771's
 * inventory gives it; a mounted rail's page and the press's option win. A
 * template the model fills is a proposal: no deck version is written until the
 * founder keeps it. D767's fixture (real SQLite through `aiBudgetFixture`), a
 * stubbed, guarded model, made-up data.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/founder_deck_forms_d778.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import decks, { DECK_FORM_RAIL } from '../src/routes/decks.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { getMethod } from '../src/services/decks/methods.ts';
import { FOUNDER_OPTIONS } from '../../frontend/src/lib/railOptions/founder.js';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d778-deck-forms-0123456789';
const FOUNDER = 500;
const PAGE = 'Founder · Raise · Pitch deck';

async function fixture({ deck = true } = {}) {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, founder_id INTEGER, company_id INTEGER, name TEXT, sector TEXT, stage TEXT,
    description TEXT, problem_statement TEXT, solution TEXT);
    CREATE TABLE financial_models (project_id INTEGER, computed_json TEXT, assumptions_json TEXT);
    CREATE TABLE cap_table_holders (project_id INTEGER, name TEXT, shares INTEGER, kind TEXT);
    CREATE TABLE score_snapshots (id INTEGER PRIMARY KEY, project_id INTEGER, total_score REAL, created_at TEXT);
    CREATE TABLE landing_pages (id INTEGER PRIMARY KEY, project_id INTEGER);`);
  f.db.prepare("INSERT INTO projects (id, name, sector, stage, description, problem_statement, solution) VALUES (1, 'Kestrel Labs', 'Logistics', 'Seed', 'Freight ops.', 'Reconciling by hand.', 'An agent.')").run();
  setFixtureAllowance(f.db, 0);
  f.db.prepare("INSERT INTO users(id,email,name,role,subscription_tier) VALUES(?,'founder.d778@example.test','Fay Founder','admin','studio')").run(FOUNDER);
  f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,5000000)').run(FOUNDER);
  f.db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('admin:free',0,0,1)").run();
  const AI = withGuard({
    run: async (_model: string, input: any) => {
      const prompt = (input?.messages || []).map((m: any) => (typeof m?.content === 'string' ? m.content : '')).join('\n');
      const hints = JSON.parse(prompt.match(/Hints:\s*(\[[^\]]+\])/)?.[1] || '[]') as string[];
      return { response: JSON.stringify(Object.fromEntries(hints.map((h) => [h, `AI wrote ${h}`]))), usage: { prompt_tokens: 40, completion_tokens: 20 } };
    },
  });
  const env: any = { DB: f.DB, ENVIRONMENT: 'development', JWT_SECRET, AI };
  const app = new Hono<any>();
  app.route('/api/decks', decks);
  const jwt = await new SignJWT({ user_id: FOUNDER, role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const auth = { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' };
  await app.request('/api/decks/by-project/1', { headers: auth }, env); // creates the deck tables
  if (deck) {
    f.db.prepare(`INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES (10, 1, 1, ?, 'Seed deck', 1, ?)`)
      .run(JSON.stringify([{ title: 'Problem', method_id: 'yc_seed', spec_id: 'problem', fields: [] }]), FOUNDER);
  }
  const call = async (path: string, init: { method?: string; body?: any; headers?: Record<string, string> } = {}) => {
    const res = await app.request(path, {
      method: init.method || 'POST', headers: { ...auth, ...(init.headers || {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const runs = () => (f.db.prepare('SELECT user_id, rail_page, rail_option, record_ref FROM ai_usage_logs WHERE guard_for IS NULL ORDER BY id').all() as any[]).map((r) => ({ ...r }));
  const versions = () => (f.db.prepare('SELECT id, version, is_current FROM pitch_decks WHERE project_id = 1 ORDER BY id').all() as any[]).map((r) => ({ ...r }));
  const proposals = () => (f.db.prepare('SELECT id, base_deck_id, method_id, title FROM pitch_deck_proposals WHERE project_id = 1').all() as any[]).map((r) => ({ ...r }));
  return { ...f, env, call, runs, versions, proposals };
}

function noNetwork() {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  return () => { globalThis.fetch = real; };
}

test('D778: the two deck form fills fall back to the page and options D771\'s inventory gives them', () => {
  const rows = FOUNDER_OPTIONS.filter((o: any) => o.handler === 'form' && o.page === PAGE);
  assert.deepEqual(rows.map((o: any) => o.key).sort(), [DECK_FORM_RAIL.fill, DECK_FORM_RAIL.template].sort());
  assert.equal(DECK_FORM_RAIL.page, PAGE);
});

test('D778: "Use this template" with no rail context runs on the inventoried page and option, and only proposes', async () => {
  // Mutation checked: write the version on apply → a second version and no proposal.
  const f = await fixture();
  const restore = noNetwork();
  try {
    const r = await f.call('/api/decks/apply-method', { body: { project_id: 1, method_id: 'yc_seed' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.proposal?.id, 'the answer is a proposal');
    assert.equal(r.body.deck, undefined, 'and no deck version');
    assert.ok(r.body.proposal.slides.some((s: any) => JSON.stringify(s).includes('AI wrote')), 'the model filled it');
    assert.deepEqual(f.runs(), [{ user_id: FOUNDER, rail_page: PAGE, rail_option: 'form:deck-template', record_ref: 'project:1' }]);
    assert.deepEqual(f.versions(), [{ id: 10, version: 1, is_current: 1 }], 'the current version is untouched');
    assert.deepEqual(f.proposals().map((p) => [p.base_deck_id, p.method_id, p.title]), [[10, 'yc_seed', `Kestrel Labs — ${getMethod('yc_seed')!.label}`]]);
    // Keep is the founder's: only then is a version written.
    const kept = await f.call(`/api/decks/proposals/${r.body.proposal.id}/keep`, { body: {} });
    assert.equal(kept.status, 200, JSON.stringify(kept.body));
    assert.deepEqual(f.versions().map((v) => [v.version, v.is_current]), [[1, 0], [2, 1]]);
    assert.deepEqual(f.proposals(), []);
  } finally { restore(); f.db.close(); }
});

test('D778: a project with no deck yet gets a proposal too, and Keep writes its first version', async () => {
  const f = await fixture({ deck: false });
  const restore = noNetwork();
  try {
    const r = await f.call('/api/decks/apply-method', { body: { project_id: 1, method_id: 'yc_seed' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(f.versions(), [], 'nothing is written before Keep');
    assert.deepEqual(f.proposals().map((p) => p.base_deck_id), [0], 'base 0: there was no version to sit beside');
    await f.call(`/api/decks/proposals/${r.body.proposal.id}/keep`, { body: {} });
    assert.deepEqual(f.versions().map((v) => [v.version, v.is_current]), [[1, 1]]);
  } finally { restore(); f.db.close(); }
});

test('D778: a mounted rail\'s page and the press\'s option win over the fallback, on both fills', async () => {
  // Mutation checked: pass the fixed fallback instead of railFor → the page reads the inventory's.
  const f = await fixture();
  const restore = noNetwork();
  try {
    const press = (option: string) => ({ 'X-Rail-Page': 'raise', 'X-Rail-Option': encodeURIComponent(option) });
    const a = await f.call('/api/decks/apply-method', { body: { project_id: 1, method_id: 'yc_seed' }, headers: press('form:deck-template') });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = await f.call('/api/decks/10/autofill', { body: {}, headers: press('form:deck') });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.deepEqual(f.runs().map((r) => [r.rail_page, r.rail_option, r.record_ref]), [
      ['raise', 'form:deck-template', 'project:1'],
      ['raise', 'form:deck', 'project:1'],
    ], 'the mounted page holds the member\'s Manual switch, so it is the one checked');
    assert.deepEqual(f.versions(), [{ id: 10, version: 1, is_current: 1 }], 'neither fill writes a version');
    assert.equal(f.proposals().length, 1, 'the project keeps one unkept proposal, the latest');
  } finally { restore(); f.db.close(); }
});

test('D778: a browser record label never replaces the project the route scoped', async () => {
  const f = await fixture();
  const restore = noNetwork();
  try {
    await f.call('/api/decks/10/autofill', { body: {}, headers: { 'X-Rail-Record': 'project:999' } });
    assert.deepEqual(f.runs().map((r) => r.record_ref), ['project:1']);
  } finally { restore(); f.db.close(); }
});
