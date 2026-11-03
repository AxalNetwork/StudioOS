/**
 * D4270 (#4270, D4254 P2c): the founder's written answers to the likely
 * questions, the questions the founder adds, and the Rehearsals list's
 * figures. Synthetic data, the mounted Worker routes and the real migrated
 * schema (202611031500 included); no model runs and `fetch` throws.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_qa_written_4270.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, copyFileSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckQaRoutes, { TYPED_MAX, WRITTEN_MAX, withWritten, type WrittenRow } from '../src/routes/deck_qa.ts';
import deckRehearsals from '../src/routes/deck_rehearsals.ts';
import decks from '../src/routes/decks.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { loadSchema } from './_schema_once.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'deck-qa-4270-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
loadSchema(schema); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = 'synthetic-4270-only-not-a-real-credential'.repeat(2);

const FOUNDER = 2, ADMIN = 1, OTHER = 3;
const SLIDES = [
  { uid: 'c-title', title: 'Synthetic', spec_id: 'new:title', blocks: [] },
  { uid: 'c-problem', title: 'Problem', spec_id: 'new:problem', blocks: [{ id: 'p1', kind: 'text', text: 'Teams lose days to closing.' }] },
  { uid: 'c-market', title: 'Market', spec_id: 'new:market', blocks: [{ id: 'm1', kind: 'text', text: 'A large market.' }] },
];

async function fixture() {
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid] of [[ADMIN, 'admin', null], [FOUNDER, 'founder', 100], [OTHER, 'founder', 300]] as const) insert.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  db.exec("INSERT INTO projects(id,name,founder_id,stage) VALUES (1,'Synthetic venture',100,'seed')");
  db.exec("INSERT INTO projects(id,name,founder_id,stage) VALUES (2,'Other venture',300,'seed')");
  db.prepare("INSERT INTO pitch_decks (id, project_id, version, slides, is_current, audience) VALUES (7, 1, 3, ?, 1, 'seed_fund')").run(JSON.stringify(SLIDES));
  db.prepare("INSERT INTO pitch_decks (id, project_id, version, slides, is_current, audience) VALUES (8, 2, 1, ?, 1, 'seed_fund')").run(JSON.stringify(SLIDES));
  const iv = db.prepare("INSERT INTO discovery_interviews (project_id, interviewee_name, stage, done_at) VALUES (1, ?, 'done', ?)");
  iv.run('Synthetic interviewee A', '2026-10-01'); iv.run('Synthetic interviewee B', '2026-10-02'); iv.run('Synthetic interviewee C', '2026-10-03');
  db.prepare("INSERT INTO raise_prospects (id, uid, project_id, name, stage) VALUES (11, 'p-11', 1, 'Synthetic Fund North', 'contacted')").run();
  db.prepare("INSERT INTO raise_prospect_feedback (prospect_id, objection, answer, created_at) VALUES (11, 'Is this problem real?', null, '2026-10-05 10:00:00')").run();
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckQaRoutes).route('/api/decks', deckRehearsals).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  return { db, app, env, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, method: string, path: string, json?: unknown, claims: Record<string, unknown> = {}) {
  const jwt = await new SignJWT({ user_id: who, ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await f.app.request(path, {
      method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: json === undefined ? undefined : JSON.stringify(json),
    }, f.env);
    const raw = await res.text();
    return { status: res.status, body: raw ? JSON.parse(raw) : null };
  } finally { [console.warn, console.error] = saved; }
}
const qa = (f: F, who = FOUNDER) => call(f, who, 'GET', '/api/decks/7/qa');
const put = (f: F, key: string, body: unknown, who = FOUNDER, claims = {}) => call(f, who, 'PUT', `/api/decks/7/qa/answers/${key}`, body, claims);
const rows = (f: F) => f.db.prepare('SELECT question_key, answer, source FROM deck_qa_written ORDER BY created_at, uid').all() as any[];

test('withWritten: typed questions after the ranked ones, answered by a written or a kept answer, and the count', () => {
  // Mutation checked: `answered` read from the written answer only → the kept one reads unanswered; typed questions dropped → total 3.
  const row = (key: string, answer: string | null, text: string | null = null): WrittenRow => ({
    uid: `u-${key}`, question_key: key, question_text: text, card_ref: null, answer, source: 'typed', deck_id: 7, version: 3, updated_by: 2, name: 'Synthetic member 2', updated_at: '2026-11-03 10:00:00',
  });
  const ranked = [
    { key: 'objection-aaaaaaaaaaaaaaaa', rank: 1, kept: null },
    { key: 'finding-bbbbbbbbbbbbbbbb', rank: 2, kept: { text: 'kept' } },
    { key: 'finding-cccccccccccccccc', rank: 3, kept: null },
  ];
  const written = new Map([
    ['objection-aaaaaaaaaaaaaaaa', row('objection-aaaaaaaaaaaaaaaa', 'We ran interviews.')],
    ['typed-0000000000000001', row('typed-0000000000000001', null, 'Why now?')],
    ['typed-0000000000000002', row('typed-0000000000000002', 'Because of the rules change.', 'What changed?')],
    ['finding-cccccccccccccccc', row('finding-cccccccccccccccc', '   ')],
  ]);
  const r = withWritten(ranked, written);
  assert.deepEqual(r.questions.map((q: any) => [q.key, q.rank, q.answered]), [
    ['objection-aaaaaaaaaaaaaaaa', 1, true], ['finding-bbbbbbbbbbbbbbbb', 2, true], ['finding-cccccccccccccccc', 3, false],
    ['typed-0000000000000001', 4, false], ['typed-0000000000000002', 5, true],
  ]);
  assert.deepEqual([r.answered_count, r.total], [3, 5], '"3 of 5 answered"');
  assert.equal((r.questions[3] as any).kind, 'typed');
  assert.equal((r.questions[3] as any).question, 'Why now?');
  assert.equal((r.questions[2] as any).written, null, 'blank words are no answer');
  assert.deepEqual((r.questions[0] as any).written.by, { id: 2, name: 'Synthetic member 2' });
});

test('a written answer: saved by the founder, read back answered, counted; Ask is kept only for the bound draft unchanged', async () => {
  // Mutation checked: the draft comparison skipped → the edited text is kept as 'ask'; the upsert left as INSERT → the second save 500s.
  const f = await fixture();
  try {
    let r = await qa(f);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.reads.written, 'ok');
    assert.equal(r.body.answered_count, 0);
    assert.equal(r.body.total, r.body.questions.length);
    assert.ok(r.body.questions.every((q: any) => q.written === null && q.answered === false));
    const problem = r.body.questions[0];
    assert.equal(problem.answer.state, 'bound', 'the first question has a bound draft for Ask to place');
    const draft = problem.answer.text as string;

    // Ask placed the draft and the founder saved it unchanged.
    let w = await put(f, problem.key, { answer: draft, source: 'ask' });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    assert.deepEqual([w.body.written.text, w.body.written.source, w.body.written.version], [draft, 'ask', 3]);
    assert.equal(w.body.written.by.name, 'Synthetic member 2', 'a person by name');
    assert.equal(JSON.stringify(w.body).includes('@'), false, 'never an email');

    // An edit to the placed text is the founder's own: claiming Ask is refused, saving as typed is kept.
    w = await put(f, problem.key, { answer: `${draft} We are booking more.`, source: 'ask' });
    assert.deepEqual([w.status, w.body.error], [422, 'not_the_draft']);
    w = await put(f, problem.key, { answer: `${draft} We are booking more.` });
    assert.deepEqual([w.status, w.body.written.source], [200, 'typed']);
    assert.equal(rows(f).length, 1, 'one row per question: a second save replaces the first');

    r = await qa(f);
    const again = r.body.questions.find((q: any) => q.key === problem.key);
    assert.deepEqual([again.answered, again.written.source], [true, 'typed']);
    assert.equal(again.answer.text, draft, '`answer` stays the bound draft');
    assert.equal(r.body.answered_count, 1);

    // Refusals: no words, too many, an unknown question, a key that is not a question's.
    assert.deepEqual([(await put(f, problem.key, { answer: '   ' })).status, (await put(f, problem.key, { answer: 'x'.repeat(WRITTEN_MAX + 1) })).status], [400, 400]);
    assert.equal((await put(f, problem.key, { answer: 'ok', source: 'model' })).status, 400);
    const missing = await put(f, 'finding-ffffffffffffffff', { answer: 'Words' });
    assert.deepEqual([missing.status, missing.body.error], [404, 'question_not_found']);
    assert.equal((await put(f, 'not-a-key', { answer: 'Words' })).status, 400);

    // DELETE removes the written answer; the question stays, unanswered.
    const del = await call(f, FOUNDER, 'DELETE', `/api/decks/7/qa/answers/${problem.key}`);
    assert.deepEqual([del.status, del.body.written], [200, null]);
    assert.equal((await call(f, FOUNDER, 'DELETE', `/api/decks/7/qa/answers/${problem.key}`)).status, 404);
    r = await qa(f);
    assert.equal(r.body.questions.find((q: any) => q.key === problem.key).answered, false);
  } finally { f.close(); }
});

test('a typed question: added by hand after the ranked ones, answered as typed only, removed whole; at most TYPED_MAX', async () => {
  // Mutation checked: the typed-question cap removed → the 41st is admitted; Ask allowed on a typed question → 200.
  const f = await fixture();
  try {
    const before = (await qa(f)).body.total;
    const add = await call(f, FOUNDER, 'POST', '/api/decks/7/qa/answers', { question: 'Why now?', card: 'market' });
    assert.equal(add.status, 201, JSON.stringify(add.body));
    const key = add.body.question.key;
    assert.match(key, /^typed-[0-9a-f]{16}$/);
    assert.deepEqual([add.body.question.kind, add.body.question.cards, add.body.question.answered], ['typed', ['market'], false]);
    let r = await qa(f);
    assert.equal(r.body.total, before + 1);
    assert.equal(r.body.questions.at(-1).key, key, 'typed questions come after the ranked ones');

    assert.deepEqual([(await put(f, key, { answer: 'Rules changed this year.', source: 'ask' })).status], [422]);
    const w = await put(f, key, { answer: 'Rules changed this year.' });
    assert.deepEqual([w.status, w.body.written.source], [200, 'typed']);
    r = await qa(f);
    assert.equal(r.body.questions.at(-1).answered, true);

    assert.equal((await call(f, FOUNDER, 'POST', '/api/decks/7/qa/answers', { question: '  ' })).status, 400);
    assert.equal((await call(f, FOUNDER, 'POST', '/api/decks/7/qa/answers', { question: 'Q', card: 'Market!' })).status, 400);
    assert.equal((await put(f, 'typed-0123456789abcdef', { answer: 'Words' })).status, 404, 'a typed key that is not this venture\'s');

    assert.equal((await call(f, FOUNDER, 'DELETE', `/api/decks/7/qa/answers/${key}`)).status, 200);
    assert.equal((await qa(f)).body.total, before, 'a typed question is removed whole');

    const ins = f.db.prepare("INSERT INTO deck_qa_written (uid, project_id, question_key, question_text, source) VALUES (?, 1, ?, 'Synthetic question', 'typed')");
    for (let i = 0; i < TYPED_MAX; i += 1) ins.run(`uid-cap-${i}`, `typed-${i.toString(16).padStart(16, '0')}`);
    const over = await call(f, FOUNDER, 'POST', '/api/decks/7/qa/answers', { question: 'One more?' });
    assert.deepEqual([over.status, over.body.error], [409, 'too_many_questions']);
  } finally { f.close(); }
});

test('tenancy: another venture\'s founder neither reads nor writes; an HQ admin reads and does not write; a support session does neither', async () => {
  // Mutation checked: founderDeck's founder check removed → the admin's PUT is 200; the GET gate left founder-only → the admin's read is 403.
  const f = await fixture();
  try {
    const key = (await qa(f)).body.questions[0].key;
    assert.equal((await put(f, key, { answer: 'Ours' })).status, 200);

    const other = await qa(f, OTHER);
    assert.ok([403, 404].includes(other.status), String(other.status));
    assert.equal(JSON.stringify(other.body).includes('Ours'), false);
    for (const [m, p, b] of [['PUT', `/api/decks/7/qa/answers/${key}`, { answer: 'Theirs' }], ['POST', '/api/decks/7/qa/answers', { question: 'Theirs?' }], ['DELETE', `/api/decks/7/qa/answers/${key}`, undefined]] as const) {
      const r = await call(f, OTHER, m, p, b);
      assert.ok([403, 404].includes(r.status), `${m} by another venture's founder: ${r.status}`);
    }
    // The other founder's own deck holds none of this venture's answers.
    const theirs = await call(f, OTHER, 'GET', '/api/decks/8/qa');
    assert.equal(theirs.status, 200, JSON.stringify(theirs.body));
    assert.equal(theirs.body.answered_count, 0);

    const admin = await qa(f, ADMIN);
    assert.equal(admin.status, 200, JSON.stringify(admin.body));
    assert.equal(admin.body.questions.find((q: any) => q.key === key).written.text, 'Ours', 'an HQ admin reads the answers');
    const adminPut = await put(f, key, { answer: 'HQ words' }, ADMIN);
    assert.deepEqual([adminPut.status, adminPut.body.error], [403, 'founder_only']);
    assert.equal((await call(f, ADMIN, 'POST', '/api/decks/7/qa/answers', { question: 'HQ?' })).status, 403);

    const support = { impersonated_by: ADMIN };
    assert.equal((await call(f, FOUNDER, 'GET', '/api/decks/7/qa', undefined, support)).status, 403);
    assert.equal((await put(f, key, { answer: 'As support' }, FOUNDER, support)).status, 403);
    assert.deepEqual(rows(f).map((r) => r.answer), ['Ours'], 'nothing a refused call sent was written');
  } finally { f.close(); }
});

test('the founder\'s alone: no share, export or public read selects the written answers', () => {
  // Mutation checked: a share route that SELECTs deck_qa_written → this scan names it.
  const src = fileURLToPath(new URL('../src/', import.meta.url));
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|js|mjs)$/.test(name) && readFileSync(p, 'utf8').includes('deck_qa_written')) hits.push(p.slice(src.length));
    }
  };
  walk(src);
  assert.deepEqual(hits.sort(), ['routes/deck_qa.ts'], 'only the founder-gated likely-questions routes read or write the table');
});

test('the Rehearsals list carries each run\'s words a minute, fillers, cards over budget and notes covered, null without a report', async () => {
  // Mutation checked: cards_over counted from every card → 3; a run without a report reading 0 → the nulls fail.
  const f = await fixture();
  try {
    const report = {
      pitch_seconds: 180, duration_ms: 200_000, over_ms: 20_000, time_line: '3:20 of 3:00',
      cards: [
        { card: 1, title: 'Synthetic', time_ms: 50_000, budget_ms: 60_000, over: false },
        { card: 2, title: 'Problem', time_ms: 90_000, budget_ms: 60_000, over: true },
        { card: 3, title: 'Market', time_ms: 60_000, budget_ms: 60_000, over: false },
      ],
      totals: { words: 480, wpm: 144, fillers: 7, pauses: 3, notes_total: 12, notes_covered: 10 }, figures: [], questions: null,
    };
    const ins = f.db.prepare('INSERT INTO deck_rehearsals (uid, deck_id, project_id, user_id, pitch_seconds, duration_ms, status, report_json, created_at) VALUES (?, 7, 1, ?, 180, ?, ?, ?, ?)');
    ins.run('00000000-0000-4000-8000-000000000001', FOUNDER, 200_000, 'reported', JSON.stringify(report), '2026-11-02 10:00:00');
    ins.run('00000000-0000-4000-8000-000000000002', FOUNDER, 5_000, 'failed', null, '2026-11-01 10:00:00');
    const r = await call(f, FOUNDER, 'GET', '/api/decks/7/rehearsals');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [done, failed] = r.body.rehearsals;
    assert.deepEqual([done.wpm, done.fillers, done.cards_over, done.cards, done.notes_covered, done.notes_total, done.time_line], [144, 7, 1, 3, 10, 12, '3:20 of 3:00']);
    assert.deepEqual([failed.wpm, failed.fillers, failed.cards_over, failed.notes_covered], [null, null, null, null], 'a run without a report reads Not recorded, never 0');
  } finally { f.close(); }
});
