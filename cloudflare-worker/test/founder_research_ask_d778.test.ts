/**
 * D778 part 11 (#2103) — Research's two Ask presses through the run path:
 * `ask:research` (the founder's Research desk) and `ask:library` (Ask). Both
 * press `POST /api/research/ask`. With no rail context the run names the page
 * and option the founder inventory gives Ask, where before it named the
 * workspace key `research`; a mounted rail's page and the press's option win,
 * so the desk logs `ask:research` and another profile's Ask logs its own key;
 * the record is the thread the answer is written to, never the browser's label.
 *
 * The D549 fixture: the Library and Ask migrations, the AI log, a stubbed,
 * guarded model and a stubbed vector index.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/founder_research_ask_d778.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import research, { ASK_OPTION, ASK_PAGE } from '../src/routes/research.ts';
import { FOUNDER_OPTIONS } from '../../frontend/src/lib/railOptions/founder.js';
import { AI_LOG_SCHEMA, AI_BUDGET_MIGRATION } from './_ai_budget_fixture.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { guardSafe } from './_guard_stub.mjs';

const app = new Hono().route('/api/research', research);
app.onError((error, c) => c.json({ detail: error.message }, 500));
const SECRET = 'unit-research-ask-d778-secret-0123456789012345';
const OWNER = 701;
const sql = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = sql('schema_baseline.sql');
  for (const t of ['users', 'projects', 'activity_logs']) db.exec(baseline.match(new RegExp(`CREATE TABLE ${t} \\([\\s\\S]*?;`))![0]);
  db.exec(sql('migrations/213_research_library.sql'));
  db.exec(sql('migrations/221_research_ask_sessions.sql'));
  db.exec(sql('migrations/385_research_disposition_collections.sql'));
  db.exec(`INSERT INTO users (id,email,name,role) VALUES (${OWNER},'owner@example.test','Owner','founder')`);
  db.exec(`INSERT INTO research_documents (id,uid,owner_user_id,title,r2_key,index_state) VALUES (1,'own-doc',${OWNER},'Interview','r/own','indexed')`);
  db.exec(`INSERT INTO research_ask_sessions (id,uid,owner_user_id) VALUES (1,'own-session',${OWNER})`);
  db.exec(AI_LOG_SCHEMA + AI_BUDGET_MIGRATION);
  const env: any = {
    DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development',
    AI: { run: guardSafe(async (model: string) => (model.includes('bge') ? { data: [Array(768).fill(0.01)] } : { response: 'The interviews show a recurring need [1].' })) },
    VECTORIZE: { query: async () => ({ matches: [{ id: 'research_doc:1:0', score: 0.9, metadata: { type: 'research_doc', entity_id: 1, owner_user_id: OWNER, title: 'Interview', snippet: 'Recurring need', chunk: 0 } }] }) },
  };
  return { db, env };
}
async function ask(f: ReturnType<typeof fixture>, body: unknown, headers: Record<string, string> = {}) {
  const token = await new SignJWT({ user_id: OWNER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const r = await app.request('/api/research/ask', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  }, f.env);
  return { status: r.status, body: await r.json() as any };
}
/** The answered run's own usage row: the question's model, not the embedding or the guard. */
const askRuns = (f: ReturnType<typeof fixture>) => (f.db.prepare(
  "SELECT user_id, rail_page, rail_option, record_ref FROM ai_usage_logs WHERE task = 'research_ask' AND guard_for IS NULL ORDER BY id",
).all() as any[]).map((r) => ({ ...r }));

test('D778: Ask falls back to the page and option the founder inventory gives it, and the desk has its own', () => {
  const ask = FOUNDER_OPTIONS.find((o: any) => o.key === ASK_OPTION);
  assert.equal(ask?.page, ASK_PAGE);
  const desk = FOUNDER_OPTIONS.find((o: any) => o.key === 'ask:research');
  assert.equal(desk?.page, 'Founder · Research', 'the desk sends its own option; the fallback is Ask\'s');
});

test('D778: an Ask with no rail context names the inventory\'s page and option, and the record is its thread', async () => {
  // Mutations checked: the old `research` fallback; the record dropped.
  const f = fixture();
  const r = await ask(f, { question: 'What need recurs?', session_uid: 'own-session' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.reason, 'answered');
  assert.deepEqual(askRuns(f), [{ user_id: OWNER, rail_page: ASK_PAGE, rail_option: ASK_OPTION, record_ref: 'research_ask_session:own-session' }]);
});

test('D778: the press\'s page and option win; the browser\'s record label never does', async () => {
  // Mutations checked: a fixed context instead of railFor; the browser's record winning.
  const f = fixture();
  const press = (page: string, option: string) => ({ 'X-Rail-Page': encodeURIComponent(page), 'X-Rail-Option': encodeURIComponent(option), 'X-Rail-Record': 'project:999' });
  await ask(f, { question: 'From the desk', session_uid: 'own-session' }, press('Founder · Research', 'ask:research'));
  await ask(f, { question: 'From the advisor\'s Ask', session_uid: 'own-session' }, press('Advisor · Research · Ask', 'ask:library'));
  assert.deepEqual(askRuns(f).map((r) => [r.rail_page, r.rail_option, r.record_ref]), [
    ['Founder · Research', 'ask:research', 'research_ask_session:own-session'],
    ['Advisor · Research · Ask', 'ask:library', 'research_ask_session:own-session'],
  ]);
});

test('D778: an answer is stored unsaved, and nothing else is written before the member saves it', async () => {
  const f = fixture();
  await ask(f, { question: 'What need recurs?', session_uid: 'own-session' });
  const answers = (f.db.prepare('SELECT saved, owner_user_id FROM research_ask_answers').all() as any[]).map((r) => ({ ...r }));
  assert.deepEqual(answers, [{ saved: 0, owner_user_id: OWNER }], 'the answer waits for the member\'s Save');
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM research_documents').get() as any).n, 1, 'no document is written');
});

test('#3938: Ask retrieves, ranks, then writes — the reranker\'s order is the order the answer reads and cites', async () => {
  // Mutation checked: the ranking ignored (the index's order stands) → the prompt lists "Pricing" first.
  const f = fixture();
  f.db.exec(`INSERT INTO research_documents (id,uid,owner_user_id,title,r2_key,index_state) VALUES (2,'own-doc-2',${OWNER},'Churn','r/own2','indexed')`);
  const seen: Array<{ model: string; input: any }> = [];
  f.env.AI = { run: guardSafe(async (model: string, input: any) => {
    seen.push({ model, input });
    if (model === '@cf/baai/bge-reranker-base') return { response: [{ id: 1, score: 0.97 }, { id: 0, score: 0.12 }] };
    if (model.includes('bge')) return { data: [Array(768).fill(0.01)] };
    return { response: 'Churn is the answer [1].' };
  }) };
  f.env.VECTORIZE = { query: async () => ({ matches: [
    { id: 'research_doc:1:0', score: 0.9, metadata: { type: 'research_doc', entity_id: 1, owner_user_id: OWNER, title: 'Pricing', snippet: 'Price talk', chunk: 0 } },
    { id: 'research_doc:2:0', score: 0.8, metadata: { type: 'research_doc', entity_id: 2, owner_user_id: OWNER, title: 'Churn', snippet: 'Why users leave', chunk: 0 } },
  ] }) };
  const r = await ask(f, { question: 'Why do users leave?', session_uid: 'own-session' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rerank = seen.find((s) => s.model === '@cf/baai/bge-reranker-base');
  assert.ok(rerank, 'the reranker ran between retrieval and the answer');
  assert.equal(rerank!.input.query, 'Why do users leave?');
  const answer = seen.find((s) => !s.model.includes('bge') && !/guard/.test(s.model));
  const prompt = JSON.stringify(answer!.input);
  assert.ok(prompt.indexOf('[1] Churn') >= 0 && prompt.indexOf('[2] Pricing') > prompt.indexOf('[1] Churn'), 'the best-ranked source is [1]');
  assert.equal(r.body.citations[0].document_uid, 'own-doc-2', 'the citations follow the ranking');
});
