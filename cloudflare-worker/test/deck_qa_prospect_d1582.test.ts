/**
 * D1582 (#3829, deck v2 F3): likely questions per prospect. With
 * `?prospect=<id>` that investor's own objections rank first, then the
 * venture's other objections, then the critic's findings; with no prospect the
 * order is D1559's. The prospect must be the deck's venture's: another
 * venture's, or none, answers the same 404 `prospect_not_found`. Founder only;
 * every answer still states no figure a binding does not carry. Synthetic data,
 * the mounted Worker route and the real migrated schema; no model runs and
 * `fetch` throws.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_qa_prospect_d1582.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckQaRoutes from '../src/routes/deck_qa.ts';
import decks from '../src/routes/decks.ts';
import { rankQuestions, unboundFigures, type QaBinding } from '../src/services/decks/deckQa.ts';
import { groupObjections } from '../src/services/narrative/objections.ts';
import type { Finding } from '../src/services/decks/critic.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { loadSchema } from './_schema_once.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'deck-qa-d1582-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
loadSchema(schema); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = 'synthetic-d1582-only-not-a-real-credential'.repeat(2);

function assertBound(text: string | null | undefined, bindings: readonly QaBinding[], where: string) {
  if (text == null) return;
  assert.deepEqual(unboundFigures(text, bindings), [], `${where} states a figure no binding carries: ${text}`);
}

// ─────────────────────────────────────────────────────────── pure

const row = (prospect_id: number, objection: string, created_at: string) => ({ prospect_id, objection, answer: null, created_at });
const ROWS = [
  row(13, 'Who are your competitors?', '2026-10-07 10:00:00'),
  row(12, 'Is this problem real?', '2026-10-06 10:00:00'),
  row(11, 'Market feels small', '2026-10-05 10:00:00'),
  row(11, 'Is this problem real?', '2026-10-04 10:00:00'),
  row(11, 'Market feels small', '2026-10-03 10:00:00'),
  row(12, 'Market feels small', '2026-10-02 10:00:00'),
];
const FINDINGS: Finding[] = [
  { key: 'rule:missing_card:product', source: 'rule', severity: 'deal_breaker', code: 'missing_card', card_uid: null, card_index: null, message: 'Seed deck with no product slide', action: 'Add a product slide' },
];
const rank = async (prospect: number | null) => (await rankQuestions({
  objections: await groupObjections(ROWS, prospect), findings: FINDINGS, deckCards: [], items: [], kept: new Map(),
})).questions;

test('pure: a prospect\'s own objections rank first, the ones it raised most first; the rest keep D913\'s order, then the findings', async () => {
  // Mutation checked: dropping the sort in rankQuestions (or sorting ascending) fails the 11 and 13 orders.
  const none = await rank(null);
  assert.deepEqual(none.map((q) => q.question), ['Market feels small', 'Is this problem real?', 'Who are your competitors?', 'What have you shipped so far?']);
  assert.equal(none.some((q) => q.heard && 'from_prospect' in q.heard), false, 'with no prospect nothing is said about one');
  const north = await rank(11);
  assert.deepEqual(north.map((q) => [q.question, q.heard?.from_prospect]), [
    ['Market feels small', 2], ['Is this problem real?', 1], ['Who are your competitors?', 0], ['What have you shipped so far?', undefined],
  ]);
  const east = await rank(13);
  assert.deepEqual(east.map((q) => q.question), ['Who are your competitors?', 'Market feels small', 'Is this problem real?', 'What have you shipped so far?']);
  assert.deepEqual(east.map((q) => q.rank), [1, 2, 3, 4]);
  assert.deepEqual(east.map((q) => q.kind), ['objection', 'objection', 'objection', 'finding'], 'every objection still ranks above every finding');
  // The same questions, keyed the same: a prospect re-orders, it never re-words or re-keys.
  assert.deepEqual(east.map((q) => q.key).sort(), none.map((q) => q.key).sort());
  // A prospect with no objection of its own leaves D1559's order.
  assert.deepEqual((await rank(99)).map((q) => q.question), none.map((q) => q.question));
});

// ─────────────────────────────────────────────────────────── the route

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
  for (const [id, role, fid] of [[ADMIN, 'admin', null], [FOUNDER, 'founder', 100], [OTHER, 'founder', 300]] as const) insert.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.test`, 'studio');
  db.exec("INSERT INTO projects(id,name,founder_id,stage) VALUES (1,'Synthetic venture',100,'seed'), (2,'Synthetic other venture',300,'seed')");
  db.prepare("INSERT INTO pitch_decks (id, project_id, version, slides, is_current, audience) VALUES (7, 1, 3, ?, 1, 'seed_fund')").run(JSON.stringify(SLIDES));
  db.prepare("INSERT INTO pitch_decks (id, project_id, version, slides, is_current, audience) VALUES (8, 2, 1, ?, 1, 'seed_fund')").run(JSON.stringify(SLIDES));
  const iv = db.prepare("INSERT INTO discovery_interviews (project_id, interviewee_name, stage, done_at) VALUES (1, ?, 'done', ?)");
  iv.run('Synthetic interviewee A', '2026-10-01'); iv.run('Synthetic interviewee B', '2026-10-02'); iv.run('Synthetic interviewee C', '2026-10-03');
  const pr = db.prepare("INSERT INTO raise_prospects (id, uid, project_id, name, firm, email, stage) VALUES (?, ?, ?, ?, ?, ?, 'contacted')");
  pr.run(11, 'p-11', 1, 'Synthetic Partner North', 'Synthetic Fund North', 'north@example.test');
  pr.run(12, 'p-12', 1, 'Synthetic Partner South', 'Synthetic Fund South', 'south@example.test');
  pr.run(13, 'p-13', 1, 'Synthetic Partner East', null, null);
  pr.run(14, 'p-14', 1, 'Synthetic Partner Quiet', null, null);
  pr.run(21, 'p-21', 2, 'Synthetic Partner Elsewhere', 'Synthetic Fund Elsewhere', 'elsewhere@example.test');
  const fb = db.prepare('INSERT INTO raise_prospect_feedback (prospect_id, objection, answer, created_at) VALUES (?, ?, ?, ?)');
  fb.run(13, 'Who are your competitors?', null, '2026-10-07 10:00:00');
  fb.run(12, 'is this problem  real?', null, '2026-10-06 10:00:00');
  fb.run(11, 'Is this problem real?', 'We ran 3 interviews and 40 more are booked', '2026-10-05 10:00:00');
  fb.run(11, 'Market feels small', 'The wedge opens the mid-market.', '2026-10-04 10:00:00');
  // Another venture's investor said this; it is never one of this deck's questions.
  fb.run(21, 'Your runway is 4 months', null, '2026-10-08 10:00:00');
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckQaRoutes).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  return { db, app, env, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, path: string, claims: Record<string, unknown> = {}) {
  const jwt = await new SignJWT({ user_id: who, ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await f.app.request(path, { headers: { Authorization: `Bearer ${jwt}` } }, f.env);
    const raw = await res.text();
    return { status: res.status, body: raw ? JSON.parse(raw) : null };
  } finally { [console.warn, console.error] = saved; }
}
const objectionsOf = (body: any) => body.questions.filter((q: any) => q.kind === 'objection').map((q: any) => q.question);

test('GET /api/decks/:id/qa?prospect=: that investor\'s objections first, then the venture\'s others, then the findings; no figure unbound', async () => {
  // Mutation checked: readObjections ignoring its prospectId (no of_prospect) → East's question stays third and the test fails.
  const f = await fixture();
  try {
    const plain = await call(f, FOUNDER, '/api/decks/7/qa');
    assert.equal(plain.status, 200, JSON.stringify(plain.body));
    assert.deepEqual(objectionsOf(plain.body), ['is this problem real?', 'Market feels small', 'Who are your competitors?'], 'no prospect: D1559\'s order, most heard first');
    assert.equal(plain.body.prospect, null);
    assert.equal(plain.body.questions.some((q: any) => 'from_prospect' in (q.heard ?? {})), false);

    const east = await call(f, FOUNDER, '/api/decks/7/qa?prospect=13');
    assert.equal(east.status, 200, JSON.stringify(east.body));
    assert.deepEqual(objectionsOf(east.body), ['Who are your competitors?', 'is this problem real?', 'Market feels small']);
    assert.deepEqual(east.body.questions.slice(0, 3).map((q: any) => [q.rank, q.heard.from_prospect]), [[1, 1], [2, 0], [3, 0]]);
    assert.deepEqual(east.body.prospect, { id: 13, name: 'Synthetic Partner East', firm: null });
    const kinds = east.body.questions.map((q: any) => q.kind);
    assert.ok(kinds.lastIndexOf('objection') < kinds.indexOf('finding'), 'the critic\'s findings still come after every objection');
    assert.deepEqual(east.body.questions.filter((q: any) => q.kind === 'finding').map((q: any) => q.key),
      plain.body.questions.filter((q: any) => q.kind === 'finding').map((q: any) => q.key), 'the findings are D1559\'s, in D1559\'s order');

    const north = await call(f, FOUNDER, '/api/decks/7/qa?prospect=11');
    assert.deepEqual(objectionsOf(north.body), ['is this problem real?', 'Market feels small', 'Who are your competitors?']);
    assert.deepEqual(north.body.questions.slice(0, 3).map((q: any) => q.heard.from_prospect), [1, 1, 0]);

    for (const r of [plain, east, north]) {
      assert.equal(objectionsOf(r.body).some((t: string) => /runway/i.test(t)), false, 'another venture\'s objection is never asked');
      for (const q of r.body.questions) {
        assertBound(q.answer.text, q.answer.bindings, `${q.key} answer`);
        assertBound(q.said, q.answer.bindings, `${q.key} said`);
        if (q.kept) assertBound(q.kept.text, q.kept.bindings, `${q.key} kept`);
      }
    }
    const problem = east.body.questions.find((q: any) => q.question === 'is this problem real?');
    assert.equal(problem.answer.state, 'bound', 'the property is checked over a bound answer');
    assert.equal(problem.said, null, 'the founder\'s words say 40 more; no record carries 40, with a prospect as without');

    // The picker's list: this venture's prospects only, those heard from first, name and firm and never an email.
    assert.deepEqual(east.body.prospects, [
      { id: 11, name: 'Synthetic Partner North', firm: 'Synthetic Fund North', objections: 2 },
      { id: 13, name: 'Synthetic Partner East', firm: null, objections: 1 },
      { id: 12, name: 'Synthetic Partner South', firm: 'Synthetic Fund South', objections: 1 },
      { id: 14, name: 'Synthetic Partner Quiet', firm: null, objections: 0 },
    ]);
    assert.doesNotMatch(JSON.stringify(east.body), /@example\.test|Elsewhere/);
    assert.deepEqual(east.body.reads, { objections: 'ok', objections_capped: false, sources: 'ok', claims: 'ok', kept: 'ok', prospects: 'ok', written: 'ok' });

    // A prospect who raised nothing leaves the order as it is.
    const quiet = await call(f, FOUNDER, '/api/decks/7/qa?prospect=14');
    assert.deepEqual(objectionsOf(quiet.body), objectionsOf(plain.body));
  } finally { f.close(); }
});

test('GET /api/decks/:id/qa?prospect=: another venture\'s prospect and an unknown one get the same 404; a bad id is 400; founder only', async () => {
  // Mutation checked: the lookup without `AND project_id = ?` → prospect 21 answers 200 and the first assert fails;
  // the prospect check moved above the founder gate → the support session's 403 becomes 404.
  const f = await fixture();
  try {
    const foreign = await call(f, FOUNDER, '/api/decks/7/qa?prospect=21');
    assert.equal(foreign.status, 404);
    assert.equal(foreign.body.error, 'prospect_not_found');
    assert.equal(foreign.body.questions, undefined, 'a refusal carries no question');
    assert.doesNotMatch(JSON.stringify(foreign.body), /Elsewhere|runway/i);
    const unknown = await call(f, FOUNDER, '/api/decks/7/qa?prospect=999');
    assert.deepEqual([unknown.status, unknown.body], [foreign.status, foreign.body], 'another venture\'s prospect reads exactly as one that does not exist');
    for (const bad of ['abc', '0', '-1', '1.5', '11;', '99999999999999999']) {
      const r = await call(f, FOUNDER, `/api/decks/7/qa?prospect=${encodeURIComponent(bad)}`);
      assert.deepEqual([r.status, r.body.error], [400, 'invalid_prospect'], bad);
    }
    // D4270: an HQ admin reads, as the founder does; the prospect is still read with the venture's id.
    const admin = await call(f, ADMIN, '/api/decks/7/qa?prospect=11');
    assert.equal(admin.status, 200, JSON.stringify(admin.body));
    const adminForeign = await call(f, ADMIN, '/api/decks/7/qa?prospect=21');
    assert.deepEqual([adminForeign.status, adminForeign.body.error], [404, 'prospect_not_found'], 'another venture\'s prospect is not this deck\'s, for HQ too');
    const support = await call(f, FOUNDER, '/api/decks/7/qa?prospect=11', { impersonated_by: ADMIN });
    assert.deepEqual([support.status, support.body?.error], [403, 'founder_only'], 'a support session reads no prospect\'s questions');
    // The other venture's founder, on this deck with their own prospect: refused, never their prospect's questions here.
    const other = await call(f, OTHER, '/api/decks/7/qa?prospect=21');
    assert.ok([403, 404].includes(other.status), String(other.status));
    assert.equal(other.body.questions, undefined);
    // ...and on their own deck, this venture's prospect is not theirs.
    const cross = await call(f, OTHER, '/api/decks/8/qa?prospect=11');
    assert.deepEqual([cross.status, cross.body.error], [404, 'prospect_not_found']);
    const own = await call(f, OTHER, '/api/decks/8/qa?prospect=21');
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.deepEqual(objectionsOf(own.body), ['Your runway is 4 months']);
    assert.deepEqual(own.body.prospects.map((p: any) => p.id), [21]);
  } finally { f.close(); }
});
