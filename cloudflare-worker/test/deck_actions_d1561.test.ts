/**
 * D1561 (#3808, deck v2 C13): the ⋯ menu's whole-deck actions. Reorder for
 * stage is one undo step; Check wording is one charged run whose findings
 * quote their card; the Check claims sheet lists every Stated and Uncited
 * figure and every C7 failure. Synthetic data, the mounted Worker routes and
 * the real migrated schema; `env.AI` is a stub and `fetch` throws.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_actions_d1561.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckActions from '../src/routes/deck_actions.ts';
import deckCheck from '../src/routes/deck_check.ts';
import deckFigures from '../src/routes/deck_figures.ts';
import decks from '../src/routes/decks.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { reorderForStage, wordingCards, wordingFindings, wordingMessage } from '../src/services/decks/deckActions.ts';
import { ARCS } from '../src/services/narrative/arcs.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'deck-actions-d1561-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
loadSchema(schema); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = 'synthetic-d1561-only-not-a-real-credential'.repeat(2);

const GRID = { c1: 1, c2: 12, r1: 1, r2: 2 };
const slide = (card: string, extra: Record<string, unknown> = {}) => ({ uid: `c-${card}`, title: card, spec_id: `new:${card}`, blocks: [], ...extra });
/** Out of the seed order: the team first, a founder's own card after the market, the problem last. */
const OUT_OF_ORDER = [
  slide('title'),
  slide('team'),
  slide('market'),
  { uid: 'c-own', title: 'Our story so far', blocks: [] },
  slide('solution'),
  slide('problem', { blocks: [{ id: 'p1', kind: 'text', grid: GRID, text: 'Our product is guaranteed to cut closing time in half for every finance team.' }] }),
];

// ─────────────────────────────────────────────────────────── pure

test('reorderForStage: the plan\'s order, a card the plan does not know moves with the card before it, every card kept', () => {
  const seed = ['title', ...ARCS.seed.order.filter((c) => c !== 'title')];
  const r = reorderForStage(OUT_OF_ORDER, seed);
  assert.deepEqual(r.slides.map((s: any) => s.uid), ['c-title', 'c-problem', 'c-solution', 'c-market', 'c-own', 'c-team']);
  assert.deepEqual([...r.from].sort(), [0, 1, 2, 3, 4, 5], 'every card kept once, none added');
  assert.equal(r.moved, 5);
  assert.equal(reorderForStage(r.slides, seed).moved, 0, 'an ordered deck stays as it is');
  // A leading card the plan does not know stays first; two cards of one kind keep their order.
  const lead = reorderForStage([{ uid: 'x', title: 'Cover note' }, slide('market'), { ...slide('problem'), uid: 'p-a' }, { ...slide('problem'), uid: 'p-b' }], seed);
  assert.deepEqual(lead.slides.map((s: any) => s.uid), ['x', 'p-a', 'p-b', 'c-market']);
  assert.deepEqual(reorderForStage([], seed), { slides: [], moved: 0, from: [] });
});

test('wordingFindings: a known kind, a card of the deck, its quote on that card word for word, and no number not in the quote', () => {
  const cards = wordingCards(OUT_OF_ORDER);
  const { findings, dropped } = wordingFindings({ findings: [
    { card: 'c-problem', kind: 'guarantee', quote: 'guaranteed to cut closing time in half', why: 'A promise of a result an investor will test.' },
    { card: 'c-problem', kind: 'guarantee', quote: 'Guaranteed  to cut closing time in half', why: 'The same words twice.' },
    { card: 'c-problem', kind: 'unsupported', quote: 'the leading platform', why: 'Not on the card.' },
    { card: 'c-market', kind: 'guarantee', quote: 'market', why: 'x' },
    { card: 'c-problem', kind: 'hype', quote: 'guaranteed', why: 'Unknown kind.' },
    { card: 'c-nowhere', kind: 'guarantee', quote: 'guaranteed', why: 'No such card.' },
    { card: 'c-problem', kind: 'unsupported', quote: 'every finance team', why: 'Says 90% of teams agree, which no card holds.' },
  ] }, cards);
  assert.deepEqual(findings.map((f) => [f.card_uid, f.kind, f.quote]), [
    ['c-market', 'guarantee', 'market'],
    ['c-problem', 'guarantee', 'guaranteed to cut closing time in half'],
  ], 'listed by card');
  assert.equal(findings[1].label, 'Guarantee language');
  assert.equal(dropped, 5);
  assert.deepEqual(wordingFindings('not json', cards), { findings: [], dropped: 0 });
  assert.match(wordingMessage(cards), /BEGIN/, 'the cards reach the model as framed data');
});

// ─────────────────────────────────────────────────────────── the routes

async function fixture(o: { slides?: unknown[]; answer?: unknown } = {}) {
  __resetForTest();
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid] of [[1, 'admin', null], [2, 'founder', 100], [3, 'founder', 300]] as const) insert.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  db.exec("INSERT INTO projects(id,name,founder_id,stage) VALUES (1,'Synthetic venture',100,'seed')");
  db.prepare("INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, audience, theme_json) VALUES (7, 1, 3, ?, 'Synthetic deck', 1, 'seed_fund', ?)")
    .run(JSON.stringify(o.slides ?? OUT_OF_ORDER), JSON.stringify({ kind: 'neutral_light', background: null }));
  db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)').run();
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,1)').run(key);
  const models: string[] = [];
  const answer = o.answer ?? { findings: [
    { card: 'c-problem', kind: 'guarantee', quote: 'guaranteed to cut closing time in half', why: 'A promise of a result an investor will test.' },
    { card: 'c-problem', kind: 'unsupported', quote: 'the only platform', why: 'Not on the card, so never shown.' },
  ] };
  const AI = withGuard({ run: async (model: string) => { models.push(model); return { response: JSON.stringify(answer), usage: { prompt_tokens: 60, completion_tokens: 40 } }; } });
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckActions).route('/api/decks', deckCheck).route('/api/decks', deckFigures).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const runs = () => db.prepare("SELECT rail_option, charged_microusd FROM ai_usage_logs WHERE guard_for IS NULL AND task <> 'safety' ORDER BY id").all() as any[];
  const versions = () => db.prepare('SELECT id, version, slides, theme_json, is_current FROM pitch_decks WHERE project_id = 1 ORDER BY id').all() as any[];
  return { db, app, env, models, runs, versions, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, method: string, path: string, json: unknown = {}) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withThrownResponses(() => f.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(json) }) }, f.env));
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

test('Reorder for stage is one undo step: one new version, the same cards in the seed order, the theme kept, no model', async () => {
  const f = await fixture();
  try {
    const before = f.versions();
    const r = await call(f, 2, 'POST', '/api/decks/7/reorder-for-stage', { stage: 'seed' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const after = f.versions();
    assert.equal(after.length, before.length + 1, 'exactly one new version: one undo step');
    assert.deepEqual([r.body.one_undo_step, r.body.stage, r.body.stage_label, r.body.moved], [true, 'seed', 'Seed', 5]);
    const v = after.at(-1);
    assert.equal(v.is_current, 1);
    assert.deepEqual(JSON.parse(v.slides).map((s: any) => s.uid), ['c-title', 'c-problem', 'c-solution', 'c-market', 'c-own', 'c-team']);
    assert.equal(JSON.parse(v.theme_json).kind, 'neutral_light', 'the theme rides along');
    assert.deepEqual(r.body.deck.slides.map((s: any) => s.uid), JSON.parse(v.slides).map((s: any) => s.uid));
    assert.equal(f.models.length, 0, 'free: no model');
    // The same press on the new version: already in order, nothing written.
    const again = await call(f, 2, 'POST', `/api/decks/${v.id}/reorder-for-stage`, { stage: 'seed' });
    assert.deepEqual([again.status, again.body.unchanged, again.body.moved], [200, true, 0]);
    assert.equal(f.versions().length, after.length, 'nothing written when nothing moves');
    // The old version is no longer current: a reorder of it answers the conflict, never a reordered copy of old cards.
    const stale = await call(f, 2, 'POST', '/api/decks/7/reorder-for-stage', { stage: 'series_a' });
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    assert.equal(f.versions().length, after.length);
  } finally { f.close(); }
});

test('Reorder for stage: a reader, another venture and a bad stage are refused; unreadable cards are never saved over', async () => {
  const f = await fixture();
  try {
    const before = f.versions().length;
    assert.equal((await call(f, 3, 'POST', '/api/decks/7/reorder-for-stage')).status, 403, 'another venture\'s founder');
    assert.equal((await call(f, 2, 'POST', '/api/decks/7/reorder-for-stage', { stage: 'not_a_stage' })).status, 400);
    assert.equal((await call(f, 2, 'POST', '/api/decks/7/reorder-for-stage', { investor_type: 'nobody' })).status, 400);
    assert.equal((await call(f, 2, 'POST', '/api/decks/99/reorder-for-stage')).status, 404);
    f.db.prepare("UPDATE pitch_decks SET slides = '[{not json' WHERE id = 7").run();
    const r = await call(f, 2, 'POST', '/api/decks/7/reorder-for-stage');
    assert.deepEqual([r.status, r.body.error], [503, 'unreadable']);
    assert.equal(f.versions().length, before, 'nothing written');
  } finally { f.close(); }
});

test('Check wording: the quote runs nothing; the press is one charged run under deck:wording; only quotes on their card are shown', async () => {
  const f = await fixture();
  try {
    const q = await call(f, 2, 'POST', '/api/decks/7/check/wording/quote');
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.ai, true, JSON.stringify(q.body));
    assert.ok(q.body.hold_microusd > 0, 'the hold is quoted before the press');
    assert.equal(f.models.length, 0, 'a quote runs nothing');
    const before = f.versions().length;
    const r = await call(f, 2, 'POST', '/api/decks/7/check/wording');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.state, 'ok');
    assert.deepEqual(r.body.findings.map((x: any) => [x.card_index, x.kind, x.quote]), [[5, 'guarantee', 'guaranteed to cut closing time in half']]);
    assert.equal(r.body.dropped, 1, 'a quote not on its card is dropped, never shown');
    assert.deepEqual(f.runs().map((x) => x.rail_option), ['deck:wording'], 'one run, under its own option');
    assert.ok(r.body.cost.usage_log_id, 'the run is the founder\'s, charged when pressed');
    assert.equal(f.versions().length, before, 'a check writes no version');
    assert.equal((await call(f, 3, 'POST', '/api/decks/7/check/wording')).status, 403);
    assert.equal(f.models.length, 1, 'a refused caller runs nothing');
  } finally { f.close(); }
});

test('Check wording with AI off answers off at no cost; sound wording is an empty list', async () => {
  const f = await fixture({ answer: { findings: [] } });
  try {
    const ok = await call(f, 2, 'POST', '/api/decks/7/check/wording');
    assert.deepEqual([ok.status, ok.body.state, ok.body.findings], [200, 'ok', []]);
    f.db.prepare("INSERT INTO ai_rail_preferences(uid,user_id,section,task,mode) VALUES('off-2',2,?,'','manual')").run('founder · raise · pitch deck');
    const off = await call(f, 2, 'POST', '/api/decks/7/check/wording');
    assert.deepEqual([off.status, off.body.state], [200, 'off']);
    assert.equal((await call(f, 2, 'POST', '/api/decks/7/check/wording/quote')).body.reason, 'assist_off');
    assert.equal(f.models.length, 1, 'with AI off nothing more runs');
  } finally { f.close(); }
});

// The issue's fixture: Check claims lists every Stated and Uncited figure, and every C7 failure.
const para = (value: string) => ({ key: 'body', label: 'Body', kind: 'paragraph', value });
const CLAIMS = [
  { uid: 'k-ask', title: 'Ask', fields: [para('Raising $2.0M seed.')] },
  { uid: 'k-uof', title: 'Use of funds', fields: [para('Engineering $1.0M'), para('Sales $0.5M'), para('Operations $0.3M')] },
  { uid: 'k-run', title: 'Runway', fields: [para('Cash $1.2M'), para('Burn $100K per month'), para('Runway 18 months')] },
  { uid: 'k-trac', title: 'Traction', blocks: [
    { id: 'm1', kind: 'metric', label: 'Customers', value: '42' },
    { id: 't1', kind: 'text', text: 'We grew 40% last quarter.' },
  ] },
];

test('Check claims on the fixture: every Stated and Uncited figure, and every C7 failure, is listed with its card', async () => {
  const f = await fixture({ slides: CLAIMS });
  try {
    const fig = await call(f, 2, 'GET', '/api/decks/7/figures');
    assert.equal(fig.status, 200, JSON.stringify(fig.body));
    const states = fig.body.figures.map((x: any) => [x.state, x.card]);
    assert.ok(states.some(([s, c]: any) => s === 'stated' && c === 3), 'the typed Customers tile is Stated');
    assert.ok(states.some(([s, c]: any) => s === 'uncited' && c === 3), 'the 40% in free text is Uncited');
    assert.equal(fig.body.figures.filter((x: any) => x.state === 'stated').length, fig.body.counts.stated, 'every Stated figure listed');
    assert.equal(fig.body.figures.filter((x: any) => x.state === 'uncited').length, fig.body.counts.uncited, 'every Uncited figure listed');
    const check = await call(f, 2, 'GET', '/api/decks/7/check');
    assert.equal(check.status, 200, JSON.stringify(check.body));
    const rules = check.body.consistency.findings.map((x: any) => x.rule).sort();
    assert.deepEqual(rules, ['runway', 'use_of_funds'], 'both C7 failures: use of funds against the raise, runway against cash ÷ burn');
    for (const x of check.body.consistency.findings) assert.ok(x.cards.length >= 1, `${x.rule} names its cards`);
  } finally { f.close(); }
});
