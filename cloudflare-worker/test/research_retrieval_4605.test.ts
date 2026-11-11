/**
 * D4605 (#4605) — Ask reads whole passages, a search that could not run is not
 * a search that found nothing, and the document row decides what Ask may
 * answer from.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/research_retrieval_4605.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import research, { withinBudget, citationOf, CITATION_PASSAGE_CHARS } from '../src/routes/research.ts';
import { embedAndUpsertById, capBytes, indexRevision, PASSAGE_MAX_BYTES } from '../src/services/vectorize.ts';
import { AI_LOG_SCHEMA, AI_BUDGET_MIGRATION } from './_ai_budget_fixture.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { guardSafe } from './_guard_stub.mjs';

const app = new Hono().route('/api/research', research);
app.onError((error, c) => c.json({ detail: error.message }, 500));
const SECRET = 'unit-research-retrieval-4605-secret-0123456789';
const OWNER = 801;
const sql = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');

// A 683-character passage whose answer sits past the 280-character preview,
// the audit's own shape.
const LEAD = 'Our customer interviews covered onboarding, billing and support. '.repeat(9);
const FACT = 'The recurring need named by every interviewee was same-day invoice reconciliation.';
const PASSAGE = (LEAD + FACT).slice(0, 683);
const REV = '2026-11-07 10:00:00.000';

function fixture(state = 'indexed', indexedAt: string | null = REV) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = sql('schema_baseline.sql');
  // A plain string slice of each table's CREATE, not a RegExp built from its name.
  for (const t of ['users', 'projects', 'activity_logs']) {
    const at = baseline.indexOf(`CREATE TABLE ${t} (`);
    db.exec(baseline.slice(at, baseline.indexOf(';', at) + 1));
  }
  db.exec(sql('migrations/213_research_library.sql'));
  db.exec(sql('migrations/221_research_ask_sessions.sql'));
  db.exec(sql('migrations/385_research_disposition_collections.sql'));
  db.exec(`INSERT INTO users (id,email,name,role) VALUES (${OWNER},'owner@example.test','Owner','founder')`);
  db.prepare(`INSERT INTO research_documents (id,uid,owner_user_id,title,r2_key,index_state,indexed_at,chunk_count) VALUES (1,'doc-1',?,'Interviews','r/1',?,?,1)`).run(OWNER, state, indexedAt);
  db.exec(`INSERT INTO research_ask_sessions (id,uid,owner_user_id) VALUES (1,'s-1',${OWNER})`);
  db.exec(AI_LOG_SCHEMA + AI_BUDGET_MIGRATION);
  const prompts: string[] = [];
  const env: any = {
    DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development',
    AI: {
      run: guardSafe(async (model: string, input: any) => {
        if (model.includes('bge')) return { data: [Array(768).fill(0.01)] };
        prompts.push(JSON.stringify(input));
        return { response: 'Same-day invoice reconciliation [1].' };
      }),
    },
    VECTORIZE: { query: async () => ({ matches: [match()] }) },
  };
  return { db, env, prompts };
}
function match(meta: Record<string, unknown> = {}, id = 'research_doc:1:0') {
  return {
    id, score: 0.9,
    metadata: { type: 'research_doc', entity_id: 1, owner_user_id: OWNER, title: 'Interviews', snippet: PASSAGE.slice(0, 280), passage: PASSAGE, revision: REV, page: 4, chunk: 0, ...meta },
  };
}
async function call(f: ReturnType<typeof fixture>, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: OWNER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const r = await app.request(`/api/research${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  }, f.env);
  return { status: r.status, body: await r.json() as any };
}
const ask = (f: ReturnType<typeof fixture>, question = 'What need recurs?') => call(f, 'POST', '/ask', { question, session_uid: 's-1' });
const stored = (f: ReturnType<typeof fixture>) => (f.db.prepare('SELECT reason, citations FROM research_ask_answers ORDER BY id').all() as any[]).map((r) => r.reason);

test('the whole passage reaches the model, past the preview, and the citation names its revision, chunk and page', async () => {
  const f = fixture();
  assert.ok(PASSAGE.indexOf(FACT.slice(0, 40)) > 280, 'the fixture puts the fact beyond the preview');
  const r = await ask(f);
  assert.equal(r.body.reason, 'answered', JSON.stringify(r.body));
  // Mutation checked: the prompt built from `snippet` again → the fact is not in it.
  assert.ok(f.prompts.some((p) => p.includes('same-day invoice')), 'the model never saw the passage past its preview');
  assert.deepEqual(
    (({ document_uid, revision, chunk, page }) => ({ document_uid, revision, chunk, page }))(r.body.citations[0]),
    { document_uid: 'doc-1', revision: REV, chunk: 0, page: 4 },
  );
});

for (const [label, patch, failure] of [
  ['no index binding', (env: any) => { delete env.VECTORIZE; }, 'unavailable'],
  ['the embedding fails', (env: any) => { const run = env.AI.run; env.AI.run = async (m: string, i: any, o: any) => (m.includes('bge') ? { data: [] } : run(m, i, o)); }, 'embedding_failed'],
  ['the query throws', (env: any) => { env.VECTORIZE.query = async () => { throw new Error('vectorize down'); }; }, 'query_failed'],
] as const) {
  test(`${label}: Ask records retrieval_unavailable, retryable, never no_source`, async () => {
    const f = fixture();
    patch(f.env);
    const errors: unknown[][] = []; const old = console.error; console.error = (...a: unknown[]) => errors.push(a);
    let r;
    try { r = await ask(f, 'A private question about churn'); } finally { console.error = old; }
    // Mutation checked: searchSemantic's empty list again → this reads no_source.
    assert.deepEqual([r.status, r.body.reason, r.body.retryable, r.body.failure], [200, 'retrieval_unavailable', true, failure]);
    assert.deepEqual(stored(f), ['retrieval_unavailable']);
    // Diagnostics name the operation and never the question or a passage.
    assert.ok(errors.length > 0, 'the failure is logged');
    assert.ok(!JSON.stringify(errors).includes('private question'), 'the question text was logged');
    const history = await call(f, 'GET', '/ask/sessions?session=s-1');
    assert.deepEqual([history.body.totals.retrieval_unavailable, history.body.totals.no_source], [1, 0]);
  });
}

test('a search that ran and found nothing is still no_source', async () => {
  const f = fixture();
  f.env.VECTORIZE.query = async () => ({ matches: [] });
  const r = await ask(f);
  assert.equal(r.body.reason, 'no_source');
  assert.deepEqual(stored(f), ['no_source']);
});

test('the document row decides: removed, re-indexing and stale-revision passages contribute nothing', async () => {
  // Removed: the row is gone, the vector is not (deletion is best effort).
  const gone = fixture();
  gone.db.exec('DELETE FROM research_documents');
  assert.equal((await ask(gone)).body.reason, 'no_source');
  // Being re-indexed: pending until the new run finishes.
  const pending = fixture('pending');
  assert.equal((await ask(pending)).body.reason, 'no_source');
  // A vector an earlier run left: its revision is not the document's.
  const stale = fixture('indexed', '2026-11-07 11:00:00.000');
  // Mutation checked: drop the revision comparison → this answers from the stale passage.
  assert.equal((await ask(stale)).body.reason, 'no_source');
  // A partially indexed document still answers from what was written.
  const partial = fixture('partial');
  assert.equal((await ask(partial)).body.reason, 'answered');
  // A vector from before revisions reads its preview, for a document indexed before them.
  const legacy = fixture();
  legacy.env.VECTORIZE.query = async () => ({ matches: [match({ passage: undefined, revision: undefined, page: undefined })] });
  const r = await ask(legacy);
  assert.equal(r.body.reason, 'answered');
  assert.equal(r.body.citations[0].revision, null);
});

test('the source budget keeps the best passages whole and always the first', () => {
  const p = (n: number, len: number) => ({ hit: { title: `T${n}`, score: 0.9 } as any, document_uid: `d${n}`, revision: null, text: 'x'.repeat(len), full: true });
  assert.deepEqual(withinBudget([p(1, 9000), p(2, 9000), p(3, 100)], 16000).map((k) => k.document_uid), ['d1']);
  assert.equal(withinBudget([p(1, 20000)], 16000)[0].text.length, 16000, 'one over-long passage is trimmed, never dropped');
  assert.deepEqual(withinBudget([p(1, 100), p(2, 100)]).map((k) => k.document_uid), ['d1', 'd2']);
});

test('capBytes keeps a passage whole under the metadata cap, and cuts only past it', () => {
  assert.equal(capBytes(PASSAGE), PASSAGE);
  const wide = 'é'.repeat(5000); // 10,000 bytes
  const cut = capBytes(wide);
  assert.ok(new TextEncoder().encode(cut).length <= PASSAGE_MAX_BYTES);
  assert.ok(cut.length >= PASSAGE_MAX_BYTES / 2 - 1);
  assert.equal(indexRevision(new Date('2026-11-07T10:00:00.123Z')), '2026-11-07 10:00:00.123');
});

/** The indexer over real SQLite and recording fakes (`research_indexing.test.ts`'s shape). */
function indexEnv(body: string, failChunk: number | null = null) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, role TEXT);`);
  db.exec(sql('migrations/213_research_library.sql'));
  db.exec(`INSERT INTO users (id, email, role) VALUES (1, 'a@example.test', 'advisor')`);
  db.prepare(`INSERT INTO research_documents (uid, owner_user_id, title, r2_key, content_type) VALUES ('u1', 1, 'Doc', 'research/1/u1.md', 'text/markdown')`).run();
  const id = (db.prepare(`SELECT id FROM research_documents WHERE uid='u1'`).get() as any).id;
  const upserted: any[] = [];
  const spans: number[] = [];
  const env: any = {
    DB: d1Over(db),
    FILES: { get: async () => ({ arrayBuffer: async () => new TextEncoder().encode(body).buffer }) },
    AI: { run: async () => ({ data: [Array.from({ length: 768 }, () => 0.02)] }) },
    VECTORIZE: {
      upsert: async (vs: any[]) => {
        // What the row says while the run is still writing.
        spans.push((db.prepare('SELECT chunk_count FROM research_documents WHERE id = ?').get(id) as any).chunk_count);
        if (vs.some((v) => v.metadata.chunk === failChunk)) throw new Error('synthetic upsert failure');
        upserted.push(...vs);
      },
      deleteByIds: async () => {},
      query: async () => ({ matches: [] }),
    },
  };
  return { env, db, id, upserted, spans };
}

test('indexing stores each whole chunk beside its preview, stamped with the run that becomes indexed_at', async () => {
  const { env, db, id, upserted } = indexEnv(`# One\n\n${PASSAGE}\n\n\n# Two\n\nbeta`);
  assert.equal(await embedAndUpsertById(env, 'research_doc' as any, id), true);
  const row: any = db.prepare('SELECT * FROM research_documents WHERE id = ?').get(id);
  assert.equal(row.index_state, 'indexed');
  const first = upserted.find((v) => v.metadata.chunk === 0);
  assert.ok(first.metadata.passage.includes('same-day invoice'), 'the whole chunk is stored');
  assert.ok(first.metadata.snippet.length <= 280, 'the preview stays short');
  assert.ok(upserted.every((v) => v.metadata.revision === row.indexed_at), 'every vector carries the run that is now indexed_at');
});

test('some chunks written and some not is partial, says how much, and still names every id for removal', async () => {
  const { env, db, id, spans } = indexEnv('# One\n\nalpha\n\n\n# Two\n\nbeta\n\n\n# Three\n\ngamma', 1);
  assert.equal(await embedAndUpsertById(env, 'research_doc' as any, id), false);
  const row: any = db.prepare('SELECT * FROM research_documents WHERE id = ?').get(id);
  // Mutation checked: any chunk written → 'indexed' again, as before.
  assert.equal(row.index_state, 'partial');
  assert.match(row.index_note, /2 of 3 passages were indexed/);
  assert.equal(row.chunk_count, 3, 'every id this run may have written');
  // Recorded before the first write, so an interrupted run leaves them nameable.
  assert.deepEqual([...new Set(spans)], [3]);
});

// D3701 (Research v2, RS-07): a citation carries its exact passage, so the
// answer can show it without the page re-reading the index.
test('D3701: the answer and the stored row carry each citation\'s passage, past the preview', async () => {
  const f = fixture();
  const r = await ask(f);
  assert.equal(r.body.reason, 'answered');
  const c = r.body.citations[0];
  // Mutation checked: `passage` dropped from citationOf → undefined here.
  assert.equal(c.passage, PASSAGE.slice(0, CITATION_PASSAGE_CHARS));
  assert.equal(c.passage_truncated, PASSAGE.length > CITATION_PASSAGE_CHARS);
  const row = f.db.prepare('SELECT citations FROM research_ask_answers ORDER BY id DESC LIMIT 1').get() as any;
  assert.equal(JSON.parse(row.citations)[0].passage, c.passage, 'the stored answer keeps the passage for history');
  const history = await call(f, 'GET', '/ask/sessions?session=s-1');
  assert.equal(history.body.items.at(-1).citations[0].passage, c.passage);
});

test('D3701: an empty passage is null, a short one is whole, a long one is cut and says so', () => {
  const p = (text: string) => ({ hit: { title: 'T', score: 0.9, chunk: 2, page: null } as any, document_uid: 'd', revision: null, text, full: true });
  const blank = citationOf(p('  '), 'd');
  assert.deepEqual([blank.passage, blank.passage_truncated], [null, false]);
  assert.deepEqual([citationOf(p(' Short. '), 'd').passage, citationOf(p('Short.'), 'd').passage_truncated], ['Short.', false]);
  const long = citationOf(p('y'.repeat(CITATION_PASSAGE_CHARS + 1)), 'd');
  // Mutation checked: no slice → the whole text is stored.
  assert.deepEqual([long.passage.length, long.passage_truncated], [CITATION_PASSAGE_CHARS, true]);
});

// D3701 part 4 (RS-11): a run the router refuses before it runs is answered
// in the shared refusal's words (402 for a budget stop) and stored as nothing.
test('D3701: a refused run is 402 in the budget\'s words, not model_unavailable, and nothing is stored', async () => {
  const f = fixture();
  // Retrieval's embedding is a system call (userId 0, `services/vectorize.ts`),
  // so it is not charged to the member. The switch turns on once it has run:
  // the budget is gone by the time the answer is to be written.
  let retrieved = false;
  const run = f.env.AI.run;
  f.env.AI.run = async (m: string, i: any, o: any) => { if (m.includes('bge')) retrieved = true; return run(m, i, o); };
  f.env.AI_SPEND = { get: async (key: string) => (retrieved && key.startsWith('ai_killswitch:') ? '1' : null), put: async () => {} };
  const r = await ask(f);
  // Mutation checked: the `refused` branch removed → 200 with reason model_unavailable.
  assert.equal(r.status, 402, JSON.stringify(r.body));
  assert.equal(r.body.error, 'kill_switch');
  assert.match(r.body.message, /Add tokens/);
  assert.ok(typeof r.body.message === 'string' && r.body.message.length > 0);
  assert.deepEqual(stored(f), [], 'a run that never started is not an answer');
  assert.equal(f.prompts.length, 0, 'the model was never called');
});

test('D3701: a model that runs and fails is still model_unavailable, with its passages', async () => {
  const f = fixture();
  const run = f.env.AI.run;
  f.env.AI.run = async (m: string, i: any, o: any) => { if (m.includes('bge') || m.includes('guard')) return run(m, i, o); throw new Error('model down'); };
  const old = console.error; console.error = () => {};
  let r;
  try { r = await ask(f); } finally { console.error = old; }
  assert.equal(r.status, 200);
  assert.equal(r.body.reason, 'model_unavailable');
  assert.deepEqual(stored(f), ['model_unavailable']);
});
