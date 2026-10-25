/**
 * D900 (#2679, part 6 of #2434) — the studio's review of a deck version,
 * through the real mounted routes on SQLite (the baseline and every later
 * migration, 541 included). The model is stubbed; nothing leaves the test.
 *
 *   1. A founder's review reads the version's cards: each point names a card it
 *      has, the score is the one returned, the run's cost comes back, and the
 *      row names its deck and version.
 *   2. A missing score stays missing, in the answer and in the history.
 *   3. A run that returns nothing stores nothing and says what it cost.
 *   4. Who: founders run and read; an Admin reads and cannot run; an advisor
 *      member, another venture's founder and nobody signed in reach nothing.
 *   5. The history is the venture's version reviews, newest first: never an
 *      upload, never another venture's.
 *   6. One `raise.pitch-deck` activity row per review, never a figure.
 *   7. The pure parts: a card's text, the deck's numbering, the normalizer.
 *
 * Every name, figure and line is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/deck_review_d900.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckReview, { VERSION_REVIEW_OPTION, VERSION_REVIEW_PAGE } from '../src/routes/deck_review.ts';
import decks from '../src/routes/decks.ts';
import { cardText, deckText, normalizeCardReview, returnedScore } from '../src/services/deckVersionReview.ts';
import { FOUNDER_OPTIONS } from '../../frontend/src/lib/railOptions/founder.js';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { __resetForTest } from '../src/services/aiRouter.ts';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const JWT_SECRET = 'unit-test-jwt-secret-d900-deck-version-review-0123456789';

// Users: the venture's owner and cofounder, an advisor member, an Admin, another venture's founder.
const OWNER = 1, COFOUNDER = 2, ADVISOR = 3, ADMIN = 4, OTHER = 5;
const PID = 7, OTHER_PID = 8;

const SLIDES_V1 = [
  { title: 'Synthetic problem', fields: [{ key: 'body', label: 'Body', kind: 'paragraph', value: 'Synthetic teams reconcile by hand.' }] },
  { title: 'Synthetic traction', fields: [{ key: 'kpis', label: 'KPIs', kind: 'metric_grid', value: [{ label: 'Paying customers', value: '[42]' }] }] },
];
const SLIDES_V2 = [...SLIDES_V1, { title: 'Synthetic ask', bullets: ['Synthetic round'] }];

let answer: string | null = null;
let seenPrompt = '';

function fixture() {
  __resetForTest();
  answer = null;
  seenPrompt = '';
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const name of readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()) {
    db.exec(readFileSync(resolve(M, name), 'utf8'));
  }
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Synthetic Founder', 'f@example.test'), (11, 'Synthetic Other', 'o@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES
      (${OWNER}, 'owner@example.test', 'Synthetic Owner', 'founder', 10),
      (${COFOUNDER}, 'co@example.test', 'Synthetic Cofounder', 'founder', NULL),
      (${ADVISOR}, 'adv@example.test', 'Synthetic Advisor', 'advisor', NULL),
      (${ADMIN}, 'admin@example.test', 'Synthetic Admin', 'admin', NULL),
      (${OTHER}, 'other@example.test', 'Synthetic Other Founder', 'founder', 11);
    INSERT INTO projects (id, name, founder_id) VALUES (${PID}, 'Synthetic venture', 10), (${OTHER_PID}, 'Synthetic other venture', 11);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (${PID}, ${OWNER}, 'owner', 'accepted'), (${PID}, ${COFOUNDER}, 'cofounder', 'accepted'), (${PID}, ${ADVISOR}, 'advisor', 'accepted');
    INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (${OWNER}, 5000000), (${COFOUNDER}, 5000000), (${OTHER}, 5000000);`);
  const insert = db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insert.run(20, PID, 1, JSON.stringify(SLIDES_V1), 'Synthetic deck', 0, OWNER);
  insert.run(21, PID, 2, JSON.stringify(SLIDES_V2), 'Synthetic deck', 1, OWNER);
  insert.run(30, OTHER_PID, 1, JSON.stringify(SLIDES_V1), 'Synthetic other deck', 1, OTHER);
  insert.run(22, PID, 3, '[]', 'Synthetic empty', 0, OWNER);
  return db;
}

async function call(db: any, who: number | null, method: string, path: string, headers: Record<string, string> = {}) {
  const AI: any = withGuard({
    run: async (_m: string, input: any) => {
      seenPrompt = String(input?.messages?.map((m: any) => m.content).join('\n') || '');
      return { response: answer ?? '' };
    },
  });
  const app = new Hono<any>().route('/api/decks', deckReview).route('/api/decks', decks);
  app.onError((err: any, c: any) => c.json({ error: err?.message === 'Unauthorized' ? 'unauthorized' : 'error', detail: String(err?.message) }, err?.message === 'Unauthorized' ? 401 : 500));
  const h: Record<string, string> = { 'content-type': 'application/json', ...headers };
  if (who) h.Authorization = 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t${path}`, { method, headers: h, ...(method === 'POST' ? { body: '{}' } : {}) }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), AI } as any, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const reviewRows = (db: any) => (db.prepare('SELECT user_id, project_id, source, deck_id, deck_version, status, review_json FROM deck_reviews ORDER BY created_at, id').all() as any[]).map((r) => ({ ...r }));
const historyCount = (db: any) => Number((db.prepare('SELECT COUNT(*) AS n FROM deck_review_history').get() as any).n);
const reviewLogs = (db: any) => (db.prepare("SELECT project_id, user_id, entity_type, entity_id, action, details FROM activity_logs WHERE action = 'deck_reviewed' ORDER BY id").all() as any[]).map((r) => ({ ...r }));

const FULL = {
  overall_score: 68,
  summary: 'Synthetic: the problem is clear; the traction card needs its source.',
  strengths: [{ text: 'Synthetic problem is concrete', card: 1 }],
  weaknesses: [{ text: 'Synthetic customer count has no source', card: 'Card 2' }, { text: 'Synthetic point about a card it lacks', card: 9 }],
  red_flags: [{ text: 'Synthetic figure differs from the records', card: 2 }],
  fixes: [{ text: 'Synthetic: source the count or cut it', card: 2 }, 'Synthetic loose fix with no card'],
};

test('D900: the option is inventoried on the Pitch deck page, and the route runs under it', () => {
  const row = FOUNDER_OPTIONS.find((o: any) => o.key === VERSION_REVIEW_OPTION) as any;
  assert.ok(row, 'review:deck-version is in the founder inventory');
  assert.equal(row.page, VERSION_REVIEW_PAGE);
  assert.equal(row.route, '/raise/pitch/review');
});

test('D900: a founder\'s review reads the version\'s cards; each point names a card it has, with the returned score and the run\'s cost', async () => {
  // Mutations checked: drop `cardOf`'s range check (card 9 kept); read the score as a heuristic (not 68);
  // drop the cost read (cost missing); send the upload's sections instead of numbered cards (prompt lacks "## Card 3").
  const db = fixture();
  answer = JSON.stringify(FULL);
  const res = await call(db, OWNER, 'POST', '/api/decks/21/review');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const r = res.body.review;
  assert.deepEqual([r.deck_id, r.deck_version, r.shape, r.overall_score], [21, 2, 'cards', 68]);
  assert.deepEqual(r.strengths, [{ text: 'Synthetic problem is concrete', card: 1 }]);
  assert.deepEqual(r.weaknesses, [{ text: 'Synthetic customer count has no source', card: 2 }, { text: 'Synthetic point about a card it lacks', card: null }]);
  assert.deepEqual(r.red_flags, [{ text: 'Synthetic figure differs from the records', card: 2 }]);
  assert.deepEqual(r.fixes, [{ text: 'Synthetic: source the count or cut it', card: 2 }, { text: 'Synthetic loose fix with no card', card: null }]);
  // The prompt is the version's own cards, numbered as the studio shows them.
  assert.match(seenPrompt, /## Card 1\nSynthetic problem\nSynthetic teams reconcile by hand\./);
  assert.match(seenPrompt, /## Card 2\nSynthetic traction\nPaying customers: \[42\]/);
  assert.match(seenPrompt, /## Card 3\nSynthetic ask\n• Synthetic round/);
  // The run's cost: what the run's rows charged, never a guessed zero.
  assert.equal(typeof res.body.cost.charged_microusd, 'number');
  assert.ok(res.body.cost.charged_microusd > 0);
  assert.equal(res.body.cost.runs, 1);
  // The row names its deck and version; the run is a history row.
  assert.deepEqual(reviewRows(db).map((x) => [x.user_id, x.project_id, x.source, x.deck_id, x.deck_version, x.status]),
    [[OWNER, PID, 'deck', 21, 2, 'complete']]);
  assert.equal(historyCount(db), 1);
  // The run is logged under this page, option and review.
  const log = db.prepare('SELECT rail_page, rail_option, record_ref FROM ai_usage_logs WHERE guard_for IS NULL').all() as any[];
  assert.deepEqual(log.map((l) => [l.rail_page, l.rail_option, l.record_ref]), [[VERSION_REVIEW_PAGE, VERSION_REVIEW_OPTION, `deck_review:${r.id}`]]);
});

test('D900: a missing score stays missing, in the answer and in the history', async () => {
  // Mutation checked: default a missing score to 50 → the answer and the history read 50.
  const db = fixture();
  answer = JSON.stringify({ ...FULL, overall_score: undefined });
  const res = await call(db, OWNER, 'POST', '/api/decks/21/review');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.review.overall_score, null);
  answer = JSON.stringify({ ...FULL, overall_score: 'strong' });
  assert.equal((await call(db, OWNER, 'POST', '/api/decks/20/review')).body.review.overall_score, null);
  const hist = await call(db, OWNER, 'GET', '/api/decks/21/reviews');
  assert.deepEqual(hist.body.reviews.map((x: any) => [x.deck_version, x.overall_score]), [[1, null], [2, null]]);
});

test('D900: a run that returns nothing stores nothing and says what it cost', async () => {
  // Mutation checked: store the empty review → a row and a history row appear.
  const db = fixture();
  for (const empty of ['', 'not json at all', JSON.stringify({ overall_score: 80 }), JSON.stringify({ strengths: [{ text: '  ', card: 1 }] })]) {
    answer = empty;
    const res = await call(db, OWNER, 'POST', '/api/decks/21/review');
    assert.deepEqual([res.status, res.body.error], [502, 'review_not_returned'], empty);
    assert.ok('cost' in res.body, 'the answer says what the run cost');
  }
  assert.deepEqual(reviewRows(db), []);
  assert.equal(historyCount(db), 0);
  assert.deepEqual(reviewLogs(db), []);
  // An empty version is refused before any run.
  const empty = await call(db, OWNER, 'POST', '/api/decks/22/review');
  assert.deepEqual([empty.status, empty.body.error], [400, 'deck_empty']);
});

test('D900: founders run and read; an Admin reads only; an advisor member, another founder and nobody signed in reach nothing', async () => {
  // Mutations checked: let an Admin run (a row appears); drop the role check (the advisor reads).
  const db = fixture();
  answer = JSON.stringify(FULL);
  const co = await call(db, COFOUNDER, 'POST', '/api/decks/21/review');
  assert.equal(co.status, 201, JSON.stringify(co.body));
  const admin = await call(db, ADMIN, 'POST', '/api/decks/21/review');
  assert.deepEqual([admin.status, admin.body.error], [403, 'read_only']);
  const adminRead = await call(db, ADMIN, 'GET', '/api/decks/21/reviews');
  assert.deepEqual([adminRead.status, adminRead.body.viewer, adminRead.body.reviews.length], [200, 'admin', 1]);
  for (const who of [ADVISOR, OTHER]) {
    for (const [method, path] of [['POST', '/api/decks/21/review'], ['GET', '/api/decks/21/reviews']] as const) {
      const r = await call(db, who, method, path);
      assert.deepEqual([r.status, r.body.error], [404, 'deck_not_found'], `${who} ${method}`);
    }
  }
  assert.equal((await call(db, null, 'GET', '/api/decks/21/reviews')).status, 401);
  assert.equal((await call(db, OWNER, 'GET', '/api/decks/999/reviews')).status, 404);
  assert.equal(reviewRows(db).length, 1, 'only the cofounder\'s review was written');
});

test('D900: the history is the venture\'s version reviews, newest first; never an upload, never another venture\'s', async () => {
  // Mutation checked: drop `r.deck_id IS NOT NULL` → the pasted review appears.
  const db = fixture();
  answer = JSON.stringify(FULL);
  await call(db, OWNER, 'POST', '/api/decks/20/review');
  answer = JSON.stringify({ ...FULL, overall_score: 74 });
  await call(db, OWNER, 'POST', '/api/decks/21/review');
  await call(db, OTHER, 'POST', '/api/decks/30/review');
  // A pasted review on this venture, the reviewer's own, stays out of the studio's history.
  db.prepare("INSERT INTO deck_reviews (id, user_id, project_id, source, review_json, status, created_at, updated_at) VALUES ('pasted', ?, ?, 'paste', '{}', 'complete', '2099-01-01', '2099-01-01')").run(OWNER, PID);
  db.prepare("INSERT INTO deck_review_history (id, review_id, review_json, created_at) VALUES ('ph', 'pasted', '{}', '2099-01-01')").run();
  const hist = await call(db, OWNER, 'GET', '/api/decks/20/reviews');
  assert.equal(hist.status, 200, JSON.stringify(hist.body));
  assert.deepEqual(hist.body.reviews.map((x: any) => [x.deck_id, x.deck_version, x.overall_score]), [[21, 2, 74], [20, 1, 68]]);
  for (const x of hist.body.reviews) {
    assert.equal(typeof x.cost.charged_microusd, 'number');
    assert.equal(x.review.shape, 'cards');
  }
  assert.equal(hist.body.capped, false);
});

test('D900: one raise.pitch-deck activity row per review, naming the version and never a figure', async () => {
  // Mutation checked: put the score in the summary → the row carries "68".
  const db = fixture();
  answer = JSON.stringify(FULL);
  await call(db, OWNER, 'POST', '/api/decks/21/review');
  const logs = reviewLogs(db);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].project_id, PID);
  assert.equal(String(logs[0].entity_id), '21');
  assert.match(String(logs[0].details), /Review run on v2, 3 cards/);
  assert.equal(String(logs[0].details).includes('68'), false);
  assert.equal(String(logs[0].details).includes('42'), false);
});

test('D900: a card\'s text, the deck\'s numbering and the normalizer', () => {
  // Mutations checked: keep image fields (the URL appears); keep duplicate lines; accept a score of "strong".
  assert.equal(cardText({ title: 'T', subtitle: 'S', body: 'B', bullets: ['one', ' '], fields: [
    { kind: 'title', value: 'T' }, { kind: 'image', value: 'https://example.test/x.png' },
    { kind: 'metric_grid', value: [{ label: 'MRR', value: 'Not recorded' }, { label: '', value: '' }] },
    { kind: 'bullets', value: ['a', 'b'] }, { kind: 'quote', value: '  spaced   out  ' },
  ] }), 'T\nS\nB\n• one\nMRR: Not recorded\n• a\n• b\nspaced out');
  assert.equal(cardText(null), '');
  assert.equal(deckText([{}, { title: 'Two' }]), '## Card 1\n(this card has no text)\n\n## Card 2\nTwo');
  assert.equal(returnedScore(120), 100);
  assert.equal(returnedScore('71.6'), 72);
  assert.equal(returnedScore('strong'), null);
  assert.equal(returnedScore(undefined), null);
  assert.equal(normalizeCardReview({ overall_score: 50 }, 3), null, 'a score with nothing to show is no review');
  assert.deepEqual(normalizeCardReview({ summary: 'x', priority_fixes: [{ text: 'f', card: 3 }] }, 3)?.fixes, [{ text: 'f', card: 3 }]);
});
