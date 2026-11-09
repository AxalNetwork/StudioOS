/**
 * #4610 (Research audit 3/5) — shared documents Open, answerability is one
 * field, and the Ask history is reachable whole.
 *
 * The audit's own instruction: "visibility checks alone do not prove Open
 * works, and small fixtures do not prove pagination." So these drive the real
 * routes through the real router, and the pagination fixtures carry 201 and 205
 * answers rather than three.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/research_shared_history_4610.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import research from '../src/routes/research.ts';
import { AI_LOG_SCHEMA, AI_BUDGET_MIGRATION } from './_ai_budget_fixture.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const app = new Hono().route('/api/research', research);
app.onError((error, c) => c.json({ detail: error.message }, 500));
const SECRET = 'unit-research-shared-history-4610-secret-0123456789';
const sql = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');

const OWNER = 901;      // the founder who owns the document
const ADVISOR = 902;    // the reader a share opens it to
const STRANGER = 903;   // neither
const PROJECT = 71;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = sql('schema_baseline.sql');
  for (const t of ['users', 'projects', 'activity_logs']) {
    const at = baseline.indexOf(`CREATE TABLE ${t} (`);
    db.exec(baseline.slice(at, baseline.indexOf(';', at) + 1));
  }
  db.exec(sql('migrations/213_research_library.sql'));
  db.exec(sql('migrations/218_advisor_client_grants.sql'));
  db.exec(sql('migrations/221_research_ask_sessions.sql'));
  db.exec(sql('migrations/385_research_disposition_collections.sql'));
  db.exec(AI_LOG_SCHEMA + AI_BUDGET_MIGRATION);
  db.exec(`INSERT INTO users (id,email,name,role,founder_id) VALUES
    (${OWNER},'owner@example.test','Owner','founder',${OWNER}),
    (${ADVISOR},'advisor@example.test','Advisor','advisor',NULL),
    (${STRANGER},'stranger@example.test','Stranger','advisor',NULL)`);
  db.exec(`INSERT INTO projects (id,name,founder_id) VALUES (${PROJECT},'Verwood',${OWNER})`);
  // One indexed document, owned by the founder.
  db.exec(`INSERT INTO research_documents (id,uid,owner_user_id,title,r2_key,index_state,indexed_at,chunk_count)
           VALUES (1,'doc-shared',${OWNER},'Teardown','r/1','indexed','2026-11-01 10:00:00',4)`);
  // An active grant over the project, which is what a share hangs off.
  db.exec(`INSERT INTO advisor_client_grants (uid,advisor_user_id,project_id,granted_by_user_id,status,scope_project)
           VALUES ('g-1',${ADVISOR},${PROJECT},${OWNER},'active',1)`);
  const env: any = {
    DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development',
    KEK_R2: 'unit-kek-0123456789abcdef',
    // The signed-download mint writes its jti here; the route never streams.
    SIGNED_URLS: { put: async () => undefined, get: async () => null, delete: async () => undefined },
    FILES: { get: async () => null },
  };
  return { db, env };
}

const share = (f: ReturnType<typeof fixture>, status = 'active') =>
  f.db.exec(`INSERT INTO advisor_client_document_shares (uid,document_id,advisor_user_id,shared_by_user_id,status)
             VALUES ('s-1',1,${ADVISOR},${OWNER},'${status}')`);

async function call(f: ReturnType<typeof fixture>, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: who === OWNER ? 'founder' : 'advisor' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
  const response = await app.request(`/api/research${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env);
  return { status: response.status, body: await response.json() as any };
}

// ---------------------------------------------------------------- shared Open

test('an authorized share recipient can Open a listed document; the owner always can', async () => {
  const f = fixture();
  share(f);
  // The row is listed to the recipient — that part already worked, and is what
  // made the refusal below a dead control rather than a hidden feature.
  const listed = await call(f, ADVISOR, 'GET', '/documents');
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.items.map((i: any) => i.uid), ['doc-shared']);
  assert.equal(listed.body.items[0].source, 'client');

  // AND NOW IT OPENS. This 404'd before: `ownDoc` is `owner_user_id = ?`, so a
  // listed document with an Open button refused every time it was pressed.
  const opened = await call(f, ADVISOR, 'GET', '/documents/doc-shared/download');
  assert.equal(opened.status, 200);
  assert.match(String(opened.body.url), /^\/api\/files\/dl\/[\w.-]+$/);
  assert.equal(opened.body.name, 'Teardown');

  const own = await call(f, OWNER, 'GET', '/documents/doc-shared/download');
  assert.equal(own.status, 200);
});

test('a revoked share, and a reader with none, are refused in the same words as a document that does not exist', async () => {
  const f = fixture();
  share(f, 'revoked');
  // A revoke is a state, never a delete, so `status = 'active'` is the whole
  // of it — and it stops reading the moment it is revoked, which is the same
  // predicate the list uses, so a row that is listed is a row that opens.
  const revoked = await call(f, ADVISOR, 'GET', '/documents/doc-shared/download');
  assert.equal(revoked.status, 404);
  assert.deepEqual((await call(f, ADVISOR, 'GET', '/documents')).body.items, []);

  const stranger = await call(f, STRANGER, 'GET', '/documents/doc-shared/download');
  assert.equal(stranger.status, 404);
  const missing = await call(f, ADVISOR, 'GET', '/documents/no-such-doc/download');
  assert.equal(missing.status, 404);
  // Same body, so the refusal confirms nothing about whose document it is.
  assert.deepEqual(revoked.body, missing.body);
  assert.deepEqual(stranger.body, missing.body);
});

test('a recipient cannot modify an owner\'s document through the read path', async () => {
  const f = fixture();
  share(f);
  // Read authorization is its own lookup, deliberately NOT a flag on `ownDoc`,
  // so there is no argument one write path is away from granting.
  for (const [method, path] of [['PATCH', '/documents/doc-shared'], ['DELETE', '/documents/doc-shared'], ['POST', '/documents/doc-shared/reindex']] as const) {
    const r = await call(f, ADVISOR, method, path, { title: 'Renamed' });
    assert.equal(r.status, 404, `${method} ${path} reached the owner's document`);
  }
  const row = f.db.prepare('SELECT title, index_state FROM research_documents WHERE uid = ?').get('doc-shared') as any;
  assert.equal(row.title, 'Teardown');
  assert.equal(row.index_state, 'indexed');
});

test('opening a client\'s document leaves the founder\'s own record of the read', async () => {
  const f = fixture();
  share(f);
  await call(f, ADVISOR, 'GET', '/documents/doc-shared/download');
  // `open_document` is one of the two actions migration 218 declares and the
  // founder's access-log route already LEFT JOINs the document to name it —
  // and nothing wrote one.
  const log = f.db.prepare(
    `SELECT project_id, advisor_user_id, action, document_id FROM advisor_client_access_log`,
  ).all() as any[];
  assert.equal(log.length, 1);
  // Field-wise: `node:sqlite` hands back null-prototype rows, which deepEqual
  // distinguishes from a plain object literal.
  assert.equal(log[0].project_id, PROJECT);
  assert.equal(log[0].advisor_user_id, ADVISOR);
  assert.equal(log[0].action, 'open_document');
  assert.equal(log[0].document_id, 1);

  // The owner reading their own file is nobody else's business to record.
  await call(f, OWNER, 'GET', '/documents/doc-shared/download');
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM advisor_client_access_log').get() as any).n, 1);
});

// ------------------------------------------------------------- answerability

test('Library and Ask read one answerability field, and a share is readable without being answerable', async () => {
  const f = fixture();
  share(f);
  // The recipient's own library: one row, indexed, from a client.
  const theirs = await call(f, ADVISOR, 'GET', '/documents');
  const row = theirs.body.items[0];
  assert.equal(row.index_state, 'indexed');
  // CURRENT POLICY, UNCHANGED: readable, not indexed into their Ask namespace.
  assert.equal(row.in_ask, false);
  assert.equal(row.read_only, true);
  // AND THE COUNT AGREES WITH THE ROW. `indexed` counted index state over
  // every item including shares, so this said "1 answerable" above a row
  // labelled "Indexed in their library, not yours" — the header pill and the
  // row contradicting each other about one document.
  assert.equal(theirs.body.answerable, 0, 'an indexed share is counted answerable again');
  assert.equal(theirs.body.not_answerable, 1);
  // `indexed` stays, and stays true of index state, which is a different question.
  assert.equal(theirs.body.indexed, 1);

  // An account holding only shares has zero answerable documents.
  assert.equal(theirs.body.items.filter((i: any) => i.in_ask).length, 0);

  // The owner's own copy of the same document IS answerable, by the same field.
  const mine = await call(f, OWNER, 'GET', '/documents');
  assert.equal(mine.body.items[0].in_ask, true);
  assert.equal(mine.body.answerable, 1);
  assert.equal(mine.body.not_answerable, 0);
});

// --------------------------------------------------------------- Ask history

/** `n` answers in one session, oldest first, so ids ascend with the questions. */
function history(f: ReturnType<typeof fixture>, n: number, opts: { saved?: number[]; discarded?: number[]; cost?: number } = {}) {
  f.db.exec(`INSERT INTO research_ask_sessions (id,uid,owner_user_id) VALUES (1,'s-1',${OWNER})`);
  const saved = new Set(opts.saved || []);
  const discarded = new Set(opts.discarded || []);
  const insert = f.db.prepare(
    `INSERT INTO research_ask_answers (uid,session_id,owner_user_id,question,answer,reason,saved,discarded,cost_micro_usd)
     VALUES (?,1,${OWNER},?,?,'answered',?,?,?)`,
  );
  for (let i = 1; i <= n; i += 1) {
    insert.run(`a-${i}`, `Question ${i}?`, `Answer ${i}`, saved.has(i) ? 1 : 0, discarded.has(i) ? 1 : 0, opts.cost ?? 1000);
  }
}

test('all records stay reachable past 201 answers, and the newest is on the first page', async () => {
  const f = fixture();
  history(f, 201);
  // THE AUDIT'S OWN FIXTURE. It executed the old SQL on 201 answers: the
  // session read returned 1–200 and omitted 201 — the newest exchange, the one
  // the reader had just been given.
  const first = await call(f, OWNER, 'GET', '/ask/sessions?scope=session');
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 200);
  assert.equal(first.body.has_more, true);
  assert.ok(first.body.next_cursor);
  // The thread reads oldest-first on screen while being paged newest-first, so
  // the NEWEST answer is on the first page — and at its end.
  assert.equal(first.body.order, 'asc');
  assert.equal(first.body.items[first.body.items.length - 1].question, 'Question 201?');

  // And the 201st record, the one that used to be unreachable, is reachable.
  const second = await call(f, OWNER, 'GET', `/ask/sessions?scope=session&cursor=${encodeURIComponent(first.body.next_cursor)}`);
  assert.equal(second.body.items.length, 1);
  assert.equal(second.body.items[0].question, 'Question 1?');
  assert.equal(second.body.has_more, false);
  assert.equal(second.body.next_cursor, null);

  // Every one of the 201, exactly once, across the two pages.
  const walked = [...second.body.items, ...first.body.items].map((i: any) => i.question);
  assert.equal(walked.length, 201);
  assert.equal(new Set(walked).size, 201);
});

test('counts and spend cover the whole scope and do not move when the page does', async () => {
  const f = fixture();
  history(f, 205, { saved: [1, 2, 3, 204], discarded: [5, 6], cost: 2000 });
  const page1 = await call(f, OWNER, 'GET', '/ask/sessions?scope=all&limit=10');
  assert.equal(page1.body.items.length, 10);
  // 205 × 2000 micro-dollars = $0.41, and it is the SCOPE's spend, not the
  // page's. `askTotals` over the slice said 10 asked and $0.02.
  assert.equal(page1.body.totals.asked, 205);
  assert.equal(page1.body.totals.saved, 4);
  assert.equal(page1.body.totals.discarded, 2);
  assert.equal(page1.body.totals.cost_usd, 0.41);
  // The page's own figures are still available, under a name that says so.
  assert.equal(page1.body.page_totals.asked, 10);
  assert.equal(page1.body.page_size, 10);

  // PAGE TWO, SAME TOTALS. This is the criterion in one assertion.
  const page2 = await call(f, OWNER, 'GET', `/ask/sessions?scope=all&limit=10&cursor=${encodeURIComponent(page1.body.next_cursor)}`);
  assert.deepEqual(page2.body.totals, page1.body.totals);
  assert.notDeepEqual(page2.body.items[0], page1.body.items[0]);
});

test('each scope reads its own records, and Archived is no longer a filter over one window', async () => {
  const f = fixture();
  history(f, 205, { saved: [10, 20], discarded: [1, 2, 3] });
  const saved = await call(f, OWNER, 'GET', '/ask/sessions?scope=saved');
  assert.equal(saved.body.totals.asked, 2);
  assert.deepEqual(saved.body.items.map((i: any) => i.question).sort(), ['Question 10?', 'Question 20?']);

  // ARCHIVED IS A SERVER SCOPE. It was `scope=all` plus a client-side
  // predicate, so these three — the OLDEST answers, well past the newest 200 —
  // were in no page the Archived tab could reach.
  const archived = await call(f, OWNER, 'GET', '/ask/sessions?scope=discarded');
  assert.equal(archived.body.totals.asked, 3);
  assert.deepEqual(archived.body.items.map((i: any) => i.question), ['Question 3?', 'Question 2?', 'Question 1?']);
  assert.equal(archived.body.order, 'desc');
  for (const item of archived.body.items) assert.equal(item.disposition, 'discarded');
});

test('existing history is served even with no answerable document left', async () => {
  const f = fixture();
  history(f, 3);
  // The last document goes, or its index fails. Either way the answers already
  // given are a record and remain readable.
  f.db.exec("UPDATE research_documents SET index_state = 'failed' WHERE uid = 'doc-shared'");
  const docs = await call(f, OWNER, 'GET', '/documents');
  assert.equal(docs.body.answerable, 0);
  const thread = await call(f, OWNER, 'GET', '/ask/sessions?scope=all');
  assert.equal(thread.status, 200);
  assert.equal(thread.body.totals.asked, 3);
  assert.equal(thread.body.items.length, 3);
});

test('a malformed cursor is refused rather than silently restarting at the newest page', async () => {
  const f = fixture();
  history(f, 5);
  for (const bad of ['not-a-cursor', 'YWJj', '%%%']) {
    const r = await call(f, OWNER, 'GET', `/ask/sessions?scope=all&cursor=${encodeURIComponent(bad)}`);
    assert.equal(r.status, 400, bad);
  }
  // A reader with no session is not an error and not a failed read: zero is
  // the true answer for a scope that is genuinely empty.
  const empty = fixture();
  const none = await call(empty, OWNER, 'GET', '/ask/sessions?scope=session');
  assert.equal(none.status, 200);
  assert.equal(none.body.session, null);
  assert.deepEqual(none.body.items, []);
  assert.equal(none.body.totals.asked, 0);
});

test('another reader\'s history is in no scope, no page and no total', async () => {
  const f = fixture();
  history(f, 205);
  for (const scope of ['session', 'all', 'saved', 'discarded']) {
    const r = await call(f, ADVISOR, 'GET', `/ask/sessions?scope=${scope}`);
    assert.equal(r.status, 200, scope);
    assert.deepEqual(r.body.items, [], scope);
    assert.equal(r.body.totals.asked, 0, scope);
    assert.equal(r.body.totals.cost_usd, 0, scope);
  }
});
