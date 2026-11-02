/**
 * D1559 (#3806, deck v2 C11): likely investor questions, real objections
 * first, answers bound to records, and the founder's kept answers written
 * back beside the objections routes. Synthetic data, the mounted Worker
 * routes and the real migrated schema (migration 736 included); no model
 * runs and `fetch` throws.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_qa_d1559.test.ts
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
import cycleRaise from '../src/routes/cycle_raise.ts';
import decks from '../src/routes/decks.ts';
import { answerOf, bindingOf, cardOfFinding, cardsOfObjection, figuresIn, keptOf, keptText, lineOf, rankQuestions, shown, unboundFigures } from '../src/services/decks/deckQa.ts';
import type { SourceItem } from '../src/services/decks/sources.ts';
import type { Finding } from '../src/services/decks/critic.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { loadSchema } from './_schema_once.mjs';

const root = new URL('../sql/', import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), 'deck-qa-d1559-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
loadSchema(schema); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = 'synthetic-d1559-only-not-a-real-credential'.repeat(2);

// ─────────────────────────────────────────────────────────── pure

const item = (o: Partial<SourceItem> & Pick<SourceItem, 'source_key' | 'label' | 'value' | 'unit'>): SourceItem => ({
  area: 'grow', module: 'Synthetic module', href: '/synthetic', as_of: '2026-10-01', grade: 'Measured', source: 'Recorded',
  record_ref: `ref:${o.source_key}`, snapshot_hash: '0123456789abcdef01234567', state: 'recorded', ...o,
} as SourceItem);

/** The rule under test, said once: every figure an answer states is carried by one of its bindings. */
function assertBound(text: string | null | undefined, bindings: readonly QaBinding[], where: string) {
  if (text == null) return;
  assert.deepEqual(unboundFigures(text, bindings), [], `${where} states a figure no binding carries: ${text}`);
}

test('a figure is its digits: separators and leading zeros set aside, so formatting keeps a figure bound', () => {
  assert.deepEqual(figuresIn('MRR $12,400.50 as of 2026-10-01'), ['1240050', '2026', '10', '1']);
  assert.deepEqual(figuresIn('no digits here'), []);
  assert.equal(shown({ value: 120050, unit: 'cents', of: null }), '$1,200.50');
  assert.equal(shown({ value: 5, unit: 'cents', of: null }), '$0.05');
  assert.equal(shown({ value: 1234567.5, unit: 'usd', of: null }), '$1,234,567.5');
  assert.equal(shown({ value: 12.5, unit: 'percent', of: null }), '12.5%');
  assert.equal(shown({ value: 9, unit: 'count', of: 12 }), '9 of 12');
  const b = bindingOf(item({ source_key: 'grow.mrr', label: 'MRR', value: 120050, unit: 'cents' }))!;
  assert.equal(lineOf(b), 'MRR: $1,200.50 (Measured, Recorded, as of 2026-10-01)');
  assert.deepEqual(unboundFigures('MRR is $1,200.50', [b]), []);
  assert.deepEqual(unboundFigures('MRR is $1,300', [b]), ['1300'], 'a figure the record does not hold is unbound');
  assert.deepEqual(unboundFigures('We have 40 customers', []), ['40'], 'with no binding, every figure is unbound');
});

test('no answer contains an unbound figure: every unit, every state, the founder\'s own words and a kept note', async () => {
  const items: SourceItem[] = [
    item({ source_key: 'grow.mrr', label: 'MRR', value: 1234567, unit: 'cents' }),
    item({ source_key: 'grow.paying_customers', label: 'Paying customers', value: 41, unit: 'count', of: 1200 }),
    item({ source_key: 'grow.arr', label: 'ARR', value: 148148.04, unit: 'usd' }),
    item({ source_key: 'grow.churn', label: 'Churn', value: 2.75, unit: 'percent' }),
    item({ source_key: 'grow.runway', label: 'Runway', value: 18, unit: 'months' }),
    item({ source_key: 'grow.net_burn', label: 'Net burn', value: 0.5, unit: 'usd', as_of: null }),
    item({ source_key: 'build.releases_90d', label: 'Releases in 90 days', value: 7, unit: 'count' }),
    item({ source_key: 'raise.round_terms', label: 'Round terms', value: 'SAFE, 8% discount', unit: 'text', area: 'raise' }),
    item({ source_key: 'validate.interviews', label: 'Interviews', value: 3, unit: 'count', area: 'validate' }),
    item({ source_key: 'validate.top_pain', label: 'Top pain theme', value: null, unit: 'count', state: 'not_recorded', grade: 'Not recorded', source: null }),
    item({ source_key: 'grow.mercury_growth', label: 'Growth', value: null, unit: 'percent', state: 'withheld', grade: 'Not recorded', source: null }),
  ];
  const objections = [
    { key: 'a'.repeat(16), text: 'Is your traction real? Revenue looks thin', count: 4, prospects: 3, last_heard: '2026-10-09', answer: 'MRR is $12,345.67 across 41 paying customers', answered: null },
    { key: 'b'.repeat(16), text: 'What is your burn and runway?', count: 2, prospects: 2, last_heard: '2026-10-08', answer: 'We have 24 months of runway', answered: null },
    { key: 'c'.repeat(16), text: 'Why this team?', count: 1, prospects: 1, last_heard: null, answer: null, answered: null },
    { key: 'd'.repeat(16), text: 'Which terms?', count: 1, prospects: 1, last_heard: null, answer: 'An 8% discount', answered: null },
  ];
  const findings: Finding[] = [
    { key: 'rule:missing_card:product', source: 'rule', severity: 'deal_breaker', code: 'missing_card', card_uid: null, card_index: null, message: 'Seed deck with no product slide', action: 'Add a product slide' },
    { key: 'rule:not_backed:u1', source: 'rule', severity: 'will_be_asked', code: 'not_backed', card_uid: 'c1', card_index: 1, message: 'MRR is not backed by a record', action: 'Go to card' },
  ];
  const kept = new Map([[`objection-${'a'.repeat(16)}`, {
    question_key: `objection-${'a'.repeat(16)}`, deck_id: 7, version: 3, note: 'Up from 2026 plans; 41 pay today',
    bindings_json: JSON.stringify([bindingOf(items[1])]), kept_by: 2, name: 'Synthetic', kept_at: '2026-10-10 10:00:00',
  }], [`objection-${'b'.repeat(16)}`, {
    // A note whose figure the bindings no longer carry is not shown.
    question_key: `objection-${'b'.repeat(16)}`, deck_id: 7, version: 3, note: 'Runway of 30 months',
    bindings_json: JSON.stringify([bindingOf(items[4])]), kept_by: 2, name: null, kept_at: null,
  }]]);
  const { questions } = await rankQuestions({ objections, findings, deckCards: [{ kind: 'title' }, { kind: 'traction' }], items, kept });
  let bound = 0;
  for (const q of questions) {
    assertBound(q.answer.text, q.answer.bindings, `${q.key} answer`);
    assertBound(q.said, q.answer.bindings, `${q.key} said`);
    if (q.kept) assertBound(q.kept.text, q.kept.bindings, `${q.key} kept`);
    if (q.answer.state === 'bound') bound += 1;
  }
  assert.ok(bound >= 3, 'the property is checked over bound answers, not only empty ones');
  const [traction, burn, team, terms] = questions;
  assert.equal(traction.said, 'MRR is $12,345.67 across 41 paying customers', 'the founder\'s words are shown when the records carry every figure');
  assert.equal(burn.said, null, 'the founder\'s words state 24 months; the record says 18');
  assert.equal(burn.said_held, 'unbound_figure');
  assert.equal(terms.said, 'An 8% discount', 'a figure inside a bound text value is carried');
  assert.equal(team.answer.state, 'unchecked', 'the team slots were not read here, so nothing is called missing');
  assert.equal(team.answer.text, null);
  assert.equal(traction.kept?.note, 'Up from 2026 plans; 41 pay today', 'a date figure is carried by the binding\'s as_of');
  assert.equal(burn.kept?.note, null, 'a stored note with an unbound figure is not shown');
  assert.match(burn.kept!.text, /^Runway: 18 months/);
});

test('answers: bound to recorded slots, unchecked when a slot is withheld or unread, not recorded with where to fill it, and none for no topic', () => {
  const rec = item({ source_key: 'validate.interviews', label: 'Interviews', value: 3, unit: 'count' });
  const gap = item({ source_key: 'validate.top_pain', label: 'Top pain theme', value: null, unit: 'count', state: 'not_recorded', grade: 'Not recorded', source: null });
  const held = item({ source_key: 'grow.mrr', label: 'MRR', value: null, unit: 'usd', state: 'withheld', grade: 'Not recorded', source: null });
  const a = answerOf(['validate.top_pain', 'validate.interviews'], [rec, gap]);
  assert.equal(a.state, 'bound');
  assert.deepEqual(a.bindings.map((b) => [b.source_key, b.record_ref, b.grade, b.snapshot_hash]), [['validate.interviews', 'ref:validate.interviews', 'Measured', '0123456789abcdef01234567']]);
  assert.deepEqual(a.fill.map((f) => f.source_key), ['validate.top_pain']);
  assert.equal(answerOf(['validate.top_pain'], [gap]).state, 'not_recorded');
  assert.equal(answerOf(['grow.mrr', 'validate.top_pain'], [held, gap]).state, 'unchecked');
  assert.equal(answerOf(['validate.top_pain'], []).state, 'unchecked', 'a slot the read did not return is unchecked, never not recorded');
  assert.equal(answerOf([], [rec]).state, 'no_topic');
  assert.equal(answerOf(['grow.mrr'], [held]).text, null, 'a withheld value is never written into an answer');
  assert.equal(bindingOf(item({ source_key: 'grow.mrr', label: 'MRR', value: 5, unit: 'usd', state: 'withheld' })), null, 'only a recorded slot binds, whatever value it carries');
  assert.deepEqual(cardsOfObjection('Your revenue is thin and the market small'), ['traction', 'market']);
  assert.deepEqual(cardsOfObjection('Who are you?'), []);
  assert.equal(cardOfFinding({ key: 'rule:missing_proof:team', code: 'missing_proof', card_index: null } as Finding, []), 'team');
  assert.equal(cardOfFinding({ key: 'rule:market_unsourced', code: 'market_unsourced', card_index: 0 } as Finding, [{ kind: 'x' }]), 'market');
  assert.equal(cardOfFinding({ key: 'rule:not_backed:u', code: 'not_backed', card_index: 1 } as Finding, [{ kind: 'title' }, { kind: 'traction' }]), 'traction');
});

test('a kept binding reads fresh, stale when its record moved, gone when it holds nothing, unknown when unread', () => {
  const b = bindingOf(item({ source_key: 'validate.interviews', label: 'Interviews', value: 3, unit: 'count' }))!;
  const row = { question_key: 'objection-' + 'e'.repeat(16), deck_id: 7, version: 3, note: null, bindings_json: JSON.stringify([b]), kept_by: null, name: null, kept_at: null };
  const state = (it: SourceItem | null) => keptOf(row, it ? [it] : [])!.bindings[0].state;
  assert.equal(state(item({ source_key: 'validate.interviews', label: 'Interviews', value: 3, unit: 'count' })), 'fresh');
  assert.equal(state(item({ source_key: 'validate.interviews', label: 'Interviews', value: 4, unit: 'count', snapshot_hash: 'ffffffffffffffffffffffff' })), 'stale');
  assert.equal(state(item({ source_key: 'validate.interviews', label: 'Interviews', value: null, unit: 'count', state: 'not_recorded' })), 'gone');
  assert.equal(state(item({ source_key: 'validate.interviews', label: 'Interviews', value: null, unit: 'count', state: 'unreadable' })), 'unknown');
  assert.equal(keptOf({ ...row, bindings_json: 'not json' }, []), null, 'a bad row is dropped, never repaired');
  assert.equal(keptText([b], 'Three, all recorded'), 'Interviews: 3 (Measured, Recorded, as of 2026-10-01) — Three, all recorded');
});

// ─────────────────────────────────────────────────────────── the routes

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
  db.prepare("INSERT INTO pitch_decks (id, project_id, version, slides, is_current, audience) VALUES (7, 1, 3, ?, 1, 'seed_fund')").run(JSON.stringify(SLIDES));
  const iv = db.prepare("INSERT INTO discovery_interviews (project_id, interviewee_name, stage, done_at) VALUES (1, ?, 'done', ?)");
  iv.run('Synthetic interviewee A', '2026-10-01'); iv.run('Synthetic interviewee B', '2026-10-02'); iv.run('Synthetic interviewee C', '2026-10-03');
  const pr = db.prepare("INSERT INTO raise_prospects (id, uid, project_id, name, stage) VALUES (?, ?, 1, ?, 'contacted')");
  pr.run(11, 'p-11', 'Synthetic Fund North'); pr.run(12, 'p-12', 'Synthetic Fund South');
  const fb = db.prepare('INSERT INTO raise_prospect_feedback (prospect_id, objection, answer, created_at) VALUES (?, ?, ?, ?)');
  fb.run(11, 'Market feels small', 'The wedge opens the mid-market.', '2026-10-04 10:00:00');
  fb.run(11, 'Is this problem real?', 'We ran 3 interviews and 40 more are booked', '2026-10-05 10:00:00');
  fb.run(12, 'is this problem  real?', null, '2026-10-06 10:00:00');
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckQaRoutes).route('/api/decks', decks).route('/api/cycles/raise', cycleRaise);
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
const answerPath = (key: string) => `/api/cycles/raise/narrative/questions/${key}/answer?project=1`;

test('GET /api/decks/:id/qa: real objections first, most heard first, then the critic\'s rule findings, deal-breakers first; no figure unbound', async () => {
  const f = await fixture();
  try {
    const r = await call(f, FOUNDER, 'GET', '/api/decks/7/qa');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const qs = r.body.questions;
    assert.deepEqual(qs.map((q: any) => [q.rank, q.kind]).slice(0, 2), [[1, 'objection'], [2, 'objection']]);
    assert.deepEqual(qs.slice(0, 2).map((q: any) => [q.question, q.heard.count]), [['is this problem  real?'.replace(/\s+/g, ' '), 2], ['Market feels small', 1]]);
    const kinds = qs.map((q: any) => q.kind);
    assert.equal(kinds.lastIndexOf('objection') < kinds.indexOf('finding'), true, 'every objection ranks above every finding');
    const findings = qs.filter((q: any) => q.kind === 'finding');
    assert.deepEqual(findings.map((q: any) => [q.code, q.severity]), [['missing_card', 'deal_breaker'], ['missing_card', 'deal_breaker'], ['market_unsourced', 'will_be_asked']]);
    assert.deepEqual(findings.map((q: any) => q.cards[0]), ['traction', 'team', 'market']);
    const problem = qs[0];
    assert.equal(problem.answer.state, 'bound');
    assert.deepEqual(problem.answer.bindings.map((b: any) => [b.source_key, b.value, b.as_of]), [['validate.interviews', 3, '2026-10-03']]);
    assert.match(problem.answer.text, /^Interviews: 3 \(/);
    assert.equal(problem.said, null, 'the founder\'s words say 40 more; no record carries 40');
    assert.equal(problem.said_held, 'unbound_figure');
    assert.equal(qs[1].said, 'The wedge opens the mid-market.');
    for (const q of qs) {
      assertBound(q.answer.text, q.answer.bindings, `${q.key} answer`);
      assertBound(q.said, q.answer.bindings, `${q.key} said`);
      for (const b of q.answer.bindings) assert.ok(b.source_key && b.grade && b.snapshot_hash, 'every binding carries its source key, grade and snapshot');
    }
    assert.deepEqual(r.body.reads, { objections: 'ok', objections_capped: false, sources: 'ok', claims: 'ok', kept: 'ok' });
    assert.equal(r.body.stage, 'seed');
  } finally { f.close(); }
});

test('GET /api/decks/:id/qa: the founder\'s alone; an admin and another founder are refused, as is a bad stage', async () => {
  const f = await fixture();
  try {
    const admin = await call(f, ADMIN, 'GET', '/api/decks/7/qa');
    assert.equal(admin.status, 403);
    assert.equal(admin.body.error, 'founder_only');
    assert.equal(admin.body.questions, undefined, 'a refusal carries no question');
    const support = await call(f, FOUNDER, 'GET', '/api/decks/7/qa', undefined, { impersonated_by: ADMIN });
    assert.deepEqual([support.status, support.body?.error], [403, 'founder_only'], 'a support session reads no deck figure');
    const other = await call(f, OTHER, 'GET', '/api/decks/7/qa');
    assert.ok([403, 404].includes(other.status), String(other.status));
    assert.equal(other.body.questions, undefined);
    assert.equal((await call(f, FOUNDER, 'GET', '/api/decks/7/qa?stage=late')).status, 400);
    assert.equal((await call(f, FOUNDER, 'GET', '/api/decks/99/qa')).status, 404);
  } finally { f.close(); }
});

test('kept answers write back beside the objections: bindings only, a note with an unbound figure refused, stale when the record moves, cleared', async () => {
  const f = await fixture();
  try {
    const read = await call(f, FOUNDER, 'GET', '/api/decks/7/qa');
    const key = read.body.questions[0].key;
    assert.match(key, /^objection-[0-9a-f]{16}$/);
    const rows = () => (f.db.prepare('SELECT question_key, deck_id, version, note FROM deck_qa_answers ORDER BY id').all() as any[]).map((r) => ({ ...r }));

    const unbound = await call(f, FOUNDER, 'PUT', answerPath(key), { deck_id: 7, source_keys: ['validate.interviews'], note: 'Three done, 40 booked' });
    assert.equal(unbound.status, 422);
    assert.equal(unbound.body.error, 'unbound_figure');
    assert.equal(rows().length, 0, 'nothing is written');

    const gap = await call(f, FOUNDER, 'PUT', answerPath(key), { deck_id: 7, source_keys: ['grow.mrr'] });
    assert.equal(gap.status, 422);
    assert.equal(gap.body.error, 'not_recorded', 'an answer binds only a record that holds a value now');
    assert.equal((await call(f, FOUNDER, 'PUT', answerPath(key), { deck_id: 7, source_keys: [] })).status, 400);
    assert.equal((await call(f, FOUNDER, 'PUT', answerPath('objection-' + '0'.repeat(16)), { deck_id: 7, source_keys: ['validate.interviews'] })).body.error, 'question_not_found');
    assert.equal((await call(f, FOUNDER, 'PUT', answerPath(key), { deck_id: 99, source_keys: ['validate.interviews'] })).status, 404);
    const admin = await call(f, ADMIN, 'PUT', answerPath(key), { deck_id: 7, source_keys: ['validate.interviews'] });
    assert.equal(admin.status, 403);
    // A support session acting as the founder passes the narrative's write gate, and is still not the founder (D900).
    const support = await call(f, FOUNDER, 'PUT', answerPath(key), { deck_id: 7, source_keys: ['validate.interviews'] }, { impersonated_by: ADMIN });
    assert.deepEqual([support.status, support.body?.error], [403, 'founder_only']);
    assert.equal(rows().length, 0);

    const ok = await call(f, FOUNDER, 'PUT', answerPath(key), { deck_id: 7, source_keys: ['validate.interviews'], note: 'All 3 were held in October 2026' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assertBound(ok.body.kept.text, ok.body.kept.bindings, 'the kept answer');
    assert.deepEqual(rows(), [{ question_key: key, deck_id: 7, version: 3, note: 'All 3 were held in October 2026' }]);
    const log = f.db.prepare("SELECT entity_type, action, details FROM activity_logs WHERE action LIKE 'deck_question%'").all() as any[];
    assert.deepEqual(log.map((l) => [l.entity_type, l.action]), [['raise.pitch-deck', 'deck_question_answer_kept']]);
    assert.doesNotMatch(log[0].details, /problem|interview|October|held/i, 'the log names no question words or figure');

    let again = await call(f, FOUNDER, 'GET', '/api/decks/7/qa');
    let kept = again.body.questions.find((q: any) => q.key === key).kept;
    assert.deepEqual(kept.bindings.map((b: any) => [b.source_key, b.state]), [['validate.interviews', 'fresh']]);
    assert.equal(kept.by.id, FOUNDER);

    f.db.prepare("INSERT INTO discovery_interviews (project_id, interviewee_name, stage, done_at) VALUES (1, 'Synthetic interviewee D', 'done', '2026-10-07')").run();
    again = await call(f, FOUNDER, 'GET', '/api/decks/7/qa');
    kept = again.body.questions.find((q: any) => q.key === key).kept;
    assert.equal(kept.bindings[0].state, 'stale', 'the record moved since the answer was kept');
    assert.equal(kept.bindings[0].value, 3, 'the kept answer keeps the value it was kept with');
    assertBound(kept.text, kept.bindings, 'the kept answer, read back');

    const finding = again.body.questions.find((q: any) => q.kind === 'finding' && q.cards[0] === 'market');
    // Another venture's deck with the same cards has the same finding question: the deck must be this venture's.
    f.db.exec("INSERT INTO projects(id,name,founder_id,stage) VALUES (2,'Synthetic other venture',300,'seed')");
    f.db.prepare("INSERT INTO pitch_decks (id, project_id, version, slides, is_current, audience) VALUES (8, 2, 1, ?, 1, 'seed_fund')").run(JSON.stringify(SLIDES));
    const foreign = await call(f, FOUNDER, 'PUT', answerPath(finding.key), { deck_id: 8, source_keys: ['validate.interviews'] });
    assert.deepEqual([foreign.status, foreign.body?.error], [404, 'deck_not_found']);
    const keptFinding = await call(f, FOUNDER, 'PUT', answerPath(finding.key), { deck_id: 7, source_keys: ['validate.interviews'] });
    assert.equal(keptFinding.status, 200, 'a finding\'s question is kept the same way');

    const del = await call(f, FOUNDER, 'DELETE', answerPath(key));
    assert.deepEqual([del.status, del.body.kept], [200, null]);
    assert.equal((await call(f, FOUNDER, 'DELETE', answerPath(key))).body.error, 'not_kept');
    assert.deepEqual(rows().map((r) => r.question_key), [finding.key]);
  } finally { f.close(); }
});
