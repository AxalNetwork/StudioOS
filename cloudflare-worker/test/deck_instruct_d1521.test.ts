/**
 * D1521 (#3773, deck v2 A22) — an instruction on the grid selection: one
 * quote, one hold and one Idempotency-Key for up to six areas of one card,
 * answered as one proposal per selected area that nothing places until
 * Accept.
 *
 * The request first (the selection, the actions, Compare as seeds, the
 * figure refusal before any quote), then the plan (only the selection, text
 * areas only, the words as data), then the routes end to end on D1: quote →
 * one run → the proposals settled from its steps → Accept on the area, with
 * the areas left out byte-identical.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { MAX_VARIANTS, QUOTE_TTL_MS, quoteHolds, quoteUidOf, type PlanCtx } from '../src/services/decks/areas.ts';
import {
  FIGURE_REFUSAL, INSTRUCT_ACTIONS, MORE_VISUAL, SELECTION_LIMIT, parseInstruct, planInstruct, selectionJson, sha256Hex,
} from '../src/services/decks/instruct.ts';
import { ASSIST_OPTIONS } from '../src/services/decks/assist.ts';
import { D1GenRuntime, type StepExecutor } from '../src/services/decks/genRuntime.ts';
import { admitStatus } from '../src/services/decks/genRooms.ts';
import { DECK_GENERATE } from '../src/middleware/rateLimit.ts';
import deckAreas from '../src/routes/deck_areas.ts';
import deckInstruct from '../src/routes/deck_instruct.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';
import { contractErrors } from '../src/contracts/validate.ts';
import { CONTRACTS } from '../src/contracts/index.ts';

const schemaOf = (name: keyof typeof CONTRACTS) => JSON.parse(readFileSync(`cloudflare-worker/src/contracts/${CONTRACTS[name].schema}`, 'utf8'));

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
/** Four text areas, one figure tile and a picture. */
const CARD = {
  uid: 'card-one', title: 'Kestrel cuts audit time', notes: '',
  blocks: [
    { id: 'b1', kind: 'text', grid: { c1: 1, c2: 12, r1: 1, r2: 1 }, style: 'heading', text: 'Kestrel cuts audit time' },
    { id: 'b2', kind: 'text', grid: { c1: 1, c2: 6, r1: 2, r2: 4 }, style: 'paragraph', text: 'Audits take weeks. Kestrel reads the ledger and flags what matters.' },
    { id: 'b3', kind: 'text', grid: { c1: 7, c2: 12, r1: 2, r2: 4 }, style: 'list', text: 'Reads the ledger\nFlags what matters\nKeeps the trail' },
    { id: 'b4', kind: 'text', grid: { c1: 1, c2: 12, r1: 5, r2: 6 }, style: 'paragraph', text: 'Built by auditors who were tired of waiting.' },
    { id: 'm1', kind: 'metric', grid: { c1: 1, c2: 3, r1: 6, r2: 6 }, label: 'Customers', value: null, binding: { source: 'metrics', key: 'customers' } },
    { id: 'p1', kind: 'image', grid: { c1: 9, c2: 12, r1: 6, r2: 6 }, src: '/api/decks/images/u1/file' },
  ],
};

function ctx(over: Partial<PlanCtx> = {}): PlanCtx & { quotes: any[] } {
  const quotes: any[] = [];
  return {
    quotes,
    userId: 7, projectId: 3, deckId: 9, cards: [CARD], aspect: '16:9', voice: null,
    quote: async (o) => { quotes.push(o); return { ok: true, hold_microusd: 1200, model: o.model ?? MODEL }; },
    modelFor: async (element) => ({ element, model: MODEL, source: 'default', locked: false, set_by: null, stale: [], plan_blocked: [], notice: null, switched_off: [] }),
    venture: async (element) => ({ element, available: false, code: 'not_recorded', line: 'Not recorded.' }) as any,
    sources: async () => [],
    art: async () => ({ seed_base: 'a'.repeat(32), art: {} as any }),
    ...over,
  };
}
const sel = (...ids: string[]) => ids.map((area_id) => ({ area_id }));
const parse = (body: Record<string, unknown>) => parseInstruct({ card: 'card-one', ...body });

// ---- the request --------------------------------------------------------------

test('the request: at most six areas of one card, words or one action, 1 to 3 variants, and Compare is three seeds', () => {
  assert.equal(SELECTION_LIMIT, 6);
  assert.deepEqual([...INSTRUCT_ACTIONS], ['shorten', 'expand', 'rewrite', 'more_visual']);
  const seven = Array.from({ length: 7 }, (_, i) => ({ area_id: `a${i}` }));
  assert.equal((parse({ selection: seven, instruction: 'warmer' }) as any).refusal, 'too_many_areas');
  assert.equal((parse({ selection: [], instruction: 'warmer' }) as any).refusal, 'no_selection');
  assert.equal((parse({ selection: sel('b2') }) as any).refusal, 'no_instruction');
  assert.equal((parse({ selection: sel('b2'), instruction: 'warmer', action: 'shorten' }) as any).refusal, 'one_change');
  assert.equal((parse({ selection: sel('b2'), action: 'translate' }) as any).refusal, 'invalid_action');
  assert.equal((parse({ selection: sel('b2'), instruction: 'x'.repeat(301) }) as any).refusal, 'instruction_too_long');
  assert.equal((parse({ selection: sel('b2', 'b2'), instruction: 'warmer' }) as any).refusal, 'duplicate_area');
  assert.equal((parse({ selection: [{ area_id: 'b2' }, { area_id: 'b3', card_uid: 'card-two' }], instruction: 'warmer' }) as any).refusal, 'one_card');
  assert.equal((parse({ selection: [{ area_id: '' }], instruction: 'warmer' }) as any).refusal, 'invalid_area');
  assert.equal((parse({ selection: sel('b2'), instruction: 'warmer', variants: 4 }) as any).refusal, 'invalid_variants');
  const compare = parse({ selection: sel('b2'), instruction: 'warmer', mode: 'compare' });
  assert.ok(!('refusal' in compare));
  if ('refusal' in compare) return;
  assert.equal(compare.variants, MAX_VARIANTS, 'Compare is three variants of the one model');
  // Each area may carry its own words; the top-level words fill in the rest.
  const own = parse({ selection: [{ area_id: 'b2', instruction: 'warmer' }, { area_id: 'b3' }], instruction: 'plainer' });
  assert.ok(!('refusal' in own));
  if ('refusal' in own) return;
  assert.deepEqual(own.selection.map((e) => e.instruction), ['warmer', null]);
});

test('a figure in the words is refused before anything is quoted: "$2.4M", "40%" and number words alike', () => {
  // Mutation checked: drop the numberIn check → each of these parses and this fails.
  for (const words of ['Say we raised $2.4M', 'add that churn is 40%', 'mention our twelve customers']) {
    assert.deepEqual(parse({ selection: sel('b2'), instruction: words }), { refusal: 'names_figure', message: FIGURE_REFUSAL }, words);
  }
  assert.deepEqual(parse({ selection: [{ area_id: 'b2', instruction: 'Say $2.4M' }], action: null }), { refusal: 'names_figure', message: FIGURE_REFUSAL }, 'an area\'s own words too');
  assert.ok(!('refusal' in parse({ selection: sel('b2'), instruction: 'warmer, in plain words' })));
});

// ---- the plan -----------------------------------------------------------------

test('the plan: only the selected areas, each a text run on its own words, the instruction as data and never a figure', async () => {
  const req = parse({ selection: sel('b2', 'b3'), instruction: 'warmer, for a seed investor', variants: 2 });
  if ('refusal' in req) throw new Error(req.message);
  const c = ctx();
  const plan = await planInstruct(c, req);
  // Mutation checked: plan every text block of the card instead of the selection → four areas, and this fails.
  assert.deepEqual(plan.areas.map((a) => a.area_id), ['b2', 'b3']);
  assert.equal(plan.cls, 'areas');
  assert.equal(plan.lines.length, 4, 'two variants of two areas');
  assert.ok(plan.lines.every((l) => l.task === 'rail_write' && l.model === MODEL && (l.input as any).option === ASSIST_OPTIONS.ask));
  assert.deepEqual(plan.areas.map((a) => a.element), ['body', 'bullets']);
  const content = String((plan.lines[0].input as any).messages[0].content);
  assert.match(content, /BEGIN_INSTRUCTION_UNTRUSTED_[0-9a-f]{32}\nwarmer, for a seed investor\nEND_INSTRUCTION_UNTRUSTED_/, 'the words reach the model only as data');
  assert.match(content, /Audits take weeks/);
  assert.doesNotMatch(content, /Built by auditors/, 'an area left out never reaches the model');
  const p = plan.areas[0].payload as any;
  assert.deepEqual([p.kind, p.action, p.instruct, p.replaces_block, p.before], ['text', 'rewrite', 'instruction', 'b2', CARD.blocks[1].text]);
  assert.equal(p.instruction_sha256, await sha256Hex('warmer, for a seed investor'));
  assert.ok(!JSON.stringify(p).includes('warmer'), 'the proposal keeps the hash, never the words');
  for (const a of plan.areas) assert.equal(a.quote_lines.reduce((n, l) => n + l.microusd, 0), a.hold_microusd, a.key);
  assert.deepEqual(JSON.parse(selectionJson(plan)), [{ card_uid: 'card-one', area_id: 'b2' }, { card_uid: 'card-one', area_id: 'b3' }]);
});

test('the actions: Shorten and Expand run their own option, More visual runs our words as data, and the seeds differ', async () => {
  const short = await planInstruct(ctx(), parse({ selection: sel('b2'), action: 'shorten', variants: 3 }) as any);
  assert.equal((short.lines[0].input as any).option, ASSIST_OPTIONS.shorten);
  assert.match(String((short.lines[0].input as any).messages[0].content), /Shorten this text/);
  assert.equal((short.areas[0].payload as any).action, 'shorten');
  assert.equal(new Set(short.lines.map((l) => (l.input as any).seed)).size, 3, 'three seeds of one model');
  assert.equal(new Set(short.lines.map((l) => l.model)).size, 1);
  const visual = await planInstruct(ctx(), parse({ selection: sel('b2'), action: 'more_visual' }) as any);
  assert.ok(String((visual.lines[0].input as any).messages[0].content).includes(MORE_VISUAL));
  assert.equal((visual.areas[0].payload as any).instruct, 'more_visual');
});

test('an area that is not words is refused on its own; the others still run', async () => {
  const plan = await planInstruct(ctx(), parse({ selection: sel('b2', 'm1', 'p1', 'zz'), instruction: 'warmer' }) as any);
  assert.deepEqual(plan.areas.map((a) => a.refusal?.code ?? null), [null, 'not_text', 'not_text', 'area_not_found']);
  assert.equal(plan.lines.length, 1);
  assert.deepEqual(plan.areas.slice(1).map((a) => a.hold_microusd), [0, 0, 0]);
  const locked = await planInstruct(ctx({ modelFor: async (element) => ({ element, model: null, source: 'org_lock', locked: true, set_by: 1, stale: [], plan_blocked: [{ level: 'org_lock', model: MODEL, plan: 'Raise + Grow' }], notice: null, switched_off: [] }) as any }), parse({ selection: sel('b2'), instruction: 'warmer' }) as any);
  assert.equal(locked.areas[0].refusal?.code, 'role_locked');
});

test('the quote goes stale when the words change, even at the same price', async () => {
  const a = await planInstruct(ctx(), parse({ selection: sel('b2'), instruction: 'warmer' }) as any);
  const b = await planInstruct(ctx(), parse({ selection: sel('b2'), instruction: 'colder' }) as any);
  const now = Date.parse('2026-11-03T15:00:00Z');
  const uid = await quoteUidOf(a, now + QUOTE_TTL_MS);
  assert.equal(await quoteHolds(uid, a, now), true);
  assert.equal(a.hold_microusd, b.hold_microusd);
  // Mutation checked: leave instruction_sha256 out of planSignature → the second quote holds, and this fails.
  assert.equal(await quoteHolds(uid, b, now), false);
});

test('the rate limit covers the run, and not the quote', () => {
  assert.ok(DECK_GENERATE.test('/api/decks/9/areas/instruct'));
  assert.ok(!DECK_GENERATE.test('/api/decks/9/areas/instruct/quote'), 'a quote runs nothing');
});

// ---- the routes, end to end ----------------------------------------------------

const FOUNDER = 10, OTHER = 20, P = 1, DECK = 1;
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const add = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  add.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  add.run(OTHER, 'founder', 'Oz Other', 'oz@example.test', 1002);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001)`);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current) VALUES (?, ?, 1, ?, ?, 1)').run(DECK, P, 'Synthetic deck', JSON.stringify([CARD]));
  db.prepare('INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (?, ?)').run(FOUNDER, 50_000_000);
  return db;
}
function roomFor(db: DatabaseSync) {
  const env: any = { DB: d1Over(db) };
  return { idFromName: (n: string) => n, get: () => ({ fetch: async (_url: string, init: any) => {
    const a = await new D1GenRuntime(env, async () => ({ ok: false, charged_microusd: 0 })).admit(JSON.parse(init.body));
    return Response.json(a, { status: a.ok ? 200 : admitStatus(a.refusal) });
  } }) };
}
async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const app = new Hono<any>();
  app.route('/api/decks', deckAreas);
  app.route('/api/decks', deckInstruct);
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withThrownResponses(() => app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), DECK_GEN_ROOM: roomFor(db) } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const count = (db: DatabaseSync, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n;

test('routes: 2 of 4 text areas instructed — one quote, one run under one hold, proposals only for the selection, the others byte-identical', async () => {
  const db = world();
  const slidesBefore = (db.prepare('SELECT slides FROM pitch_decks WHERE id = ?').get(DECK) as any).slides;
  const body = { card: 'card-one', selection: sel('b2', 'b3'), instruction: 'warmer, for a seed investor', variants: 2 };
  const q = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas/instruct/quote`, body);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.deepEqual([q.body.runs, q.body.refused, q.body.areas.map((a: any) => a.area_id)], [2, 0, ['b2', 'b3']]);
  assert.deepEqual(contractErrors(schemaOf('instruct'), q.body), [], 'D1511: the quote is the adapter\'s contract');
  assert.equal(count(db, 'deck_area_batches'), 0, 'a quote holds nothing');
  assert.equal((await call(db, OTHER, 'POST', `/api/decks/${DECK}/areas/instruct/quote`, body)).status, 403, 'only the deck\'s writers');

  // Changed words are a new quote.
  const changed = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas/instruct`, { ...body, instruction: 'colder', quote_uid: q.body.quote_uid }, { 'Idempotency-Key': 'instruct-test-0001' });
  assert.deepEqual([changed.status, changed.body.error], [409, 'quote_stale']);
  assert.equal(count(db, 'deck_area_batches'), 0);

  const g = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas/instruct`, { ...body, quote_uid: q.body.quote_uid }, { 'Idempotency-Key': 'instruct-test-0002' });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.deepEqual(contractErrors(schemaOf('instruct'), g.body), [], 'D1511: the run is the adapter\'s contract');
  assert.equal(g.body.hold_microusd, q.body.hold_microusd, 'the run holds what the quote said');
  assert.deepEqual(g.body.selection, [{ card_uid: 'card-one', area_id: 'b2' }, { card_uid: 'card-one', area_id: 'b3' }]);
  assert.equal(g.body.action, 'instruction');
  assert.deepEqual(g.body.proposals.map((p: any) => p.area_id).sort(), ['b2', 'b3'], 'one proposal per selected area, and none for the others');
  assert.equal(count(db, 'deck_area_batches'), 1, 'one parent hold');
  assert.equal(count(db, 'deck_area_batch_steps'), 4);
  const rows = db.prepare('SELECT area_id, selection_json, instruction_sha256, action, payload_json FROM deck_area_proposals ORDER BY area_id').all() as any[];
  const sha = await sha256Hex('warmer, for a seed investor');
  for (const r of rows) {
    assert.deepEqual([JSON.parse(r.selection_json).length, r.instruction_sha256, r.action], [2, sha, 'instruction'], r.area_id);
    assert.ok(!String(r.payload_json).includes('warmer'), 'the words are not stored on the proposal');
  }

  // The same key is the same run: no second hold, no second set of proposals, nothing charged twice.
  const again = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas/instruct`, body, { 'Idempotency-Key': 'instruct-test-0002' });
  assert.deepEqual([again.status, again.body.batch_uid, again.body.replayed, again.body.proposals.length], [200, g.body.batch_uid, true, 2]);
  assert.deepEqual(contractErrors(schemaOf('instruct'), again.body), []);
  assert.equal(count(db, 'deck_area_batches'), 1);
  assert.equal(count(db, 'deck_area_proposals'), 2);

  // The run: every step words its area.
  const hold = db.prepare('SELECT * FROM deck_area_batches WHERE uid = ?').get(g.body.batch_uid) as any;
  const exec: StepExecutor = async (s) => {
    db.prepare('INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, reservation_uid, record_ref) VALUES (?, ?, ?, ?, ?, ?)')
      .run(FOUNDER, 'rail_write', s.model, Math.floor(s.quote_microusd / 2), hold.reservation_uid, `deckstep:${s.batch_uid}:${s.seq}`);
    return { ok: true, charged_microusd: Math.floor(s.quote_microusd / 2), model_used: s.model, variant: { text: s.area_id === 'b2' ? 'Audits take weeks. Kestrel reads the ledger for you.' : 'Reads your ledger\nFlags what matters' } };
  };
  const st = await new D1GenRuntime({ DB: d1Over(db) } as any, exec).startBatch(g.body.batch_uid);
  assert.equal(st?.state, 'done');
  const read = await call(db, FOUNDER, 'GET', `/api/decks/${DECK}/areas/proposals?batch=${g.body.batch_uid}`);
  assert.equal(read.body.done, true);
  const b2 = read.body.proposals.find((p: any) => p.area_id === 'b2');
  assert.deepEqual(b2.variants.map((v: any) => v.state), ['ready', 'ready']);
  // Accept on its own area; the deck row is untouched — the editor places the words and saves.
  const acc = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas/card-one/b2/accept`, { proposal_uid: b2.uid, variant: 1 });
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  assert.equal((await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas/card-one/b4/accept`, { proposal_uid: b2.uid, variant: 1 })).status, 404, 'never on an area left out');
  assert.equal((db.prepare('SELECT slides FROM pitch_decks WHERE id = ?').get(DECK) as any).slides, slidesBefore, 'b1 and b4 (and every area) byte-identical');
});

test('routes: a figure is 422 before any quote or hold, and an instruction on nothing runnable is 422 with each reason', async () => {
  const db = world();
  for (const path of [`/api/decks/${DECK}/areas/instruct/quote`, `/api/decks/${DECK}/areas/instruct`]) {
    const r = await call(db, FOUNDER, 'POST', path, { card: 'card-one', selection: sel('b2'), instruction: 'Say we raised $2.4M' }, { 'Idempotency-Key': 'instruct-test-0003' });
    assert.deepEqual([r.status, r.body.error, r.body.message], [422, 'names_figure', FIGURE_REFUSAL], path);
  }
  assert.equal(count(db, 'deck_area_batches'), 0, 'no run, no hold');
  assert.equal(count(db, 'ai_usage_logs'), 0, 'nothing charged');
  const none = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas/instruct`, { card: 'card-one', selection: sel('m1', 'p1'), instruction: 'warmer' }, { 'Idempotency-Key': 'instruct-test-0004' });
  assert.equal(none.status, 422);
  assert.equal(none.body.error, 'nothing_to_run');
  assert.equal(count(db, 'deck_area_batches'), 0);
  assert.equal((await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas/instruct/quote`, { card: 'card-one', selection: [] })).status, 400);
});

test('migration: three nullable columns on deck_area_proposals, by UTC minute, no data', () => {
  const sql = readFileSync('cloudflare-worker/sql/migrations/202611031458_deck_area_instructions.sql', 'utf8');
  assert.match(sql, /ADD COLUMN selection_json TEXT CHECK \(selection_json IS NULL OR length\(selection_json\) <= 8192\)/);
  assert.match(sql, /ADD COLUMN instruction_sha256 TEXT CHECK \(instruction_sha256 IS NULL OR length\(instruction_sha256\) = 64\)/);
  assert.match(sql, /action IN \('instruction', 'shorten', 'expand', 'rewrite', 'more_visual'\)/);
  assert.doesNotMatch(sql, /insert|update /i, 'no data');
  const db = world();
  const cols = (db.prepare('PRAGMA table_info(deck_area_proposals)').all() as any[]).map((c) => c.name);
  for (const c of ['selection_json', 'instruction_sha256', 'action']) assert.ok(cols.includes(c), c);
  assert.throws(() => db.prepare(`INSERT INTO deck_area_proposals (uid, deck_id, project_id, card_uid, area_id, element, state, created_by, expires_at, action) VALUES ('u', 1, 1, 'c', 'a', 'body', 'ready', 1, '2026-12-01 00:00:00', 'translate')`).run());
});
