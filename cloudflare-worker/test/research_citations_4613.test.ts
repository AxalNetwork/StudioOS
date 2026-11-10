/**
 * D4613 (#4613) — an Ask answer's bracketed references are checked against
 * the sources it was given, cited and retrieved-but-uncited passages are
 * marked apart on the answer and in history, and the same catalogue add
 * writes one shortlist row however often it is sent.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/research_citations_4613.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import research from '../src/routes/research.ts';
import { citedNumbers, referenceCheck, markCited } from '../src/services/researchCitations.ts';
import { AI_LOG_SCHEMA, AI_BUDGET_MIGRATION } from './_ai_budget_fixture.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { guardSafe } from './_guard_stub.mjs';

const app = new Hono().route('/api/research', research);
app.onError((error, c) => c.json({ detail: error.message }, 500));
const SECRET = 'unit-research-citations-4613-secret-0123456789';
const OWNER = 811;
const OTHER = 812;
const REV = '2026-11-09 10:00:00.000';
const sql = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');

function fixture(modelAnswer = 'Same-day reconciliation [1].') {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = sql('schema_baseline.sql');
  for (const t of ['users', 'projects', 'activity_logs']) {
    const at = baseline.indexOf(`CREATE TABLE ${t} (`);
    db.exec(baseline.slice(at, baseline.indexOf(';', at) + 1));
  }
  db.exec(sql('migrations/213_research_library.sql'));
  db.exec(sql('migrations/216_research_funds.sql'));
  db.exec(sql('migrations/221_research_ask_sessions.sql'));
  db.exec(sql('migrations/385_research_disposition_collections.sql'));
  db.exec(sql('migrations/202611092035_research_fund_catalogue_uid.sql'));
  db.exec(`INSERT INTO users (id,email,name,role) VALUES (${OWNER},'owner@example.test','Owner','founder'), (${OTHER},'other@example.test','Other','founder')`);
  db.prepare(`INSERT INTO research_documents (id,uid,owner_user_id,title,r2_key,index_state,indexed_at,chunk_count) VALUES (1,'doc-1',?,'Interviews','r/1','indexed',?,2)`).run(OWNER, REV);
  db.exec(`INSERT INTO research_ask_sessions (id,uid,owner_user_id) VALUES (1,'s-1',${OWNER})`);
  db.exec(AI_LOG_SCHEMA + AI_BUDGET_MIGRATION);
  const env: any = {
    DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development',
    AI: {
      run: guardSafe(async (model: string) => {
        if (model.includes('bge')) return { data: [Array(768).fill(0.01)] };
        // The reranker keeps the index's order; the answer is the fixture's.
        if (model.includes('rerank')) return { response: [{ id: 0, score: 0.9 }, { id: 1, score: 0.8 }] };
        return { response: modelAnswer };
      }),
    },
    VECTORIZE: { query: async () => ({ matches: [match(0), match(1)] }) },
  };
  return { db, env };
}
function match(chunk: number) {
  const passage = chunk === 0 ? 'Every interviewee named same-day invoice reconciliation.' : 'Billing questions came up twice.';
  return {
    id: `research_doc:1:${chunk}`, score: 0.9 - chunk * 0.05,
    metadata: { type: 'research_doc', entity_id: 1, owner_user_id: OWNER, title: 'Interviews', snippet: passage, passage, revision: REV, page: chunk + 1, chunk },
  };
}
async function call(f: ReturnType<typeof fixture>, method: string, path: string, body?: unknown, userId = OWNER) {
  const token = await new SignJWT({ user_id: userId, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const r = await app.request(`/api/research${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  }, f.env);
  return { status: r.status, body: await r.json() as any };
}
const ask = (f: ReturnType<typeof fixture>) => call(f, 'POST', '/ask', { question: 'What need recurs?', session_uid: 's-1' });

test('citedNumbers reads bracketed numbers, lists and short ranges, and nothing else', () => {
  assert.deepEqual(citedNumbers('A [1], B [2][3], C [1, 4] and D [5-7].'), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(citedNumbers('See [the memo](https://x.test) and [note].'), []);
  assert.deepEqual(citedNumbers(null), []);
  // A huge "range" is not expanded into hundreds of references: its ends count.
  assert.deepEqual(citedNumbers('[2-400]'), [2, 400]);
});

test('referenceCheck: resolved, invalid, none cited, no answer; and never claims support', () => {
  const sources = [{ n: 1 }, { n: 2 }];
  assert.deepEqual(referenceCheck('X [1].', sources), { status: 'resolved', cited: [1], invalid: [], uncited: [2], claim_support: 'not_verified' });
  // Mutation checked: treat every bracketed number as cited → [3] reads as resolved.
  assert.deepEqual(referenceCheck('X [1] and Y [3].', sources), { status: 'invalid_refs', cited: [1], invalid: [3], uncited: [2], claim_support: 'not_verified' });
  assert.equal(referenceCheck('No references at all.', sources).status, 'none_cited');
  assert.equal(referenceCheck('[0] is not a source.', sources).status, 'invalid_refs');
  assert.deepEqual(referenceCheck(null, sources), { status: 'no_answer', cited: [], invalid: [], uncited: [1, 2], claim_support: 'not_verified' });
  // A citation stored without its number is numbered by its place.
  assert.deepEqual(markCited('Y [2].', [{ title: 'a' }, { title: 'b' }]).map((c) => c.cited), [false, true]);
});

test('an answer that cites [1] marks source 1 cited and source 2 retrieved, on the answer and in history', async () => {
  const f = fixture('Same-day reconciliation [1].');
  const r = await ask(f);
  assert.equal(r.body.reason, 'answered', JSON.stringify(r.body));
  // Mutation checked: return the unmarked citations → `cited` is undefined on both.
  assert.deepEqual(r.body.citations.map((c: any) => [c.n, c.cited]), [[1, true], [2, false]]);
  assert.equal(r.body.reference_check.status, 'resolved');
  assert.equal(r.body.reference_check.claim_support, 'not_verified');
  // The stored row is unchanged in shape: the mark is derived on every read.
  const stored = JSON.parse((f.db.prepare('SELECT citations FROM research_ask_answers').get() as any).citations);
  assert.equal(stored[0].cited, undefined);
  const history = await call(f, 'GET', '/ask/sessions?session=s-1');
  // Mutation checked: drop markCited from answerDto → history loses the split.
  assert.deepEqual(history.body.items[0].citations.map((c: any) => c.cited), [true, false]);
  assert.deepEqual(history.body.items[0].reference_check.uncited, [2]);
});

test('an answer that cites a number it was never given is flagged invalid, never resolved', async () => {
  const f = fixture('Reconciliation [1], and pricing [7].');
  const r = await ask(f);
  assert.deepEqual([r.body.reference_check.status, r.body.reference_check.invalid], ['invalid_refs', [7]]);
  const history = await call(f, 'GET', '/ask/sessions?session=s-1');
  assert.equal(history.body.items[0].reference_check.status, 'invalid_refs');
});

test('a malformed stored citation list reads as no citations, with the check still present', async () => {
  const f = fixture();
  await ask(f);
  f.db.exec(`UPDATE research_ask_answers SET citations = '{not json'`);
  const history = await call(f, 'GET', '/ask/sessions?session=s-1');
  assert.deepEqual(history.body.items[0].citations, []);
  assert.equal(history.body.items[0].reference_check.status, 'invalid_refs', 'a [1] with no sources is not resolved');
});

const funds = (f: ReturnType<typeof fixture>, owner = OWNER) =>
  (f.db.prepare('SELECT name, catalogue_uid FROM research_funds WHERE owner_user_id = ? ORDER BY id').all(owner) as any[]).map((r) => [r.name, r.catalogue_uid]);

test('the same catalogue add, sent twice, writes one row and answers the second with it', async () => {
  const f = fixture();
  const body = { name: 'Northwind Ventures II', source_url: 'https://northwind.test', catalogue_uid: 'northwindventuresii' };
  const first = await call(f, 'POST', '/funds', body);
  const second = await call(f, 'POST', '/funds', body);
  assert.deepEqual([first.status, first.body.existing], [201, false]);
  // Mutation checked: a plain INSERT again → 201 and two rows.
  assert.deepEqual([second.status, second.body.existing, second.body.uid], [200, true, first.body.uid]);
  assert.deepEqual(funds(f), [['Northwind Ventures II', 'northwindventuresii']]);
  // Concurrent repeats settle on the same single row.
  const burst = await Promise.all([1, 2, 3].map(() => call(f, 'POST', '/funds', body)));
  assert.ok(burst.every((r) => r.body.uid === first.body.uid));
  assert.equal(funds(f).length, 1);
});

test('hand-written funds stay distinct, even with the same name, and other members keep their own row', async () => {
  const f = fixture();
  await call(f, 'POST', '/funds', { name: 'Northwind Ventures II', catalogue_uid: 'northwindventuresii' });
  const manual1 = await call(f, 'POST', '/funds', { name: 'Northwind Ventures II', note: 'my own entry' });
  const manual2 = await call(f, 'POST', '/funds', { name: 'Northwind Ventures II' });
  assert.deepEqual([manual1.status, manual2.status], [201, 201]);
  assert.equal(funds(f).length, 3);
  const theirs = await call(f, 'POST', '/funds', { name: 'Northwind Ventures II', catalogue_uid: 'northwindventuresii' }, OTHER);
  assert.deepEqual([theirs.status, theirs.body.existing], [201, false]);
  assert.deepEqual(funds(f, OTHER), [['Northwind Ventures II', 'northwindventuresii']]);
});

test('a catalogue uid outside the allowed characters is refused before it reaches SQL', async () => {
  const f = fixture();
  const r = await call(f, 'POST', '/funds', { name: 'X', catalogue_uid: "x' OR 1=1 --" });
  assert.deepEqual([r.status, r.body.detail], [400, 'catalogue_uid_invalid']);
  assert.equal(funds(f).length, 0);
});
