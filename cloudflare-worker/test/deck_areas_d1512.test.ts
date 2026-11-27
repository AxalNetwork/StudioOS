/**
 * D1512 (#3764, deck v2 A3) — Generate into areas: one quote, one hold, 1 to 3
 * variants per area, as proposals that nothing places until Accept.
 *
 * Pure parts first (the request, the plan and its quote lines, the variants a
 * run's steps leave, the quote's staleness), then the routes end to end on D1:
 * quote → admit one run under one hold → the run's steps → the proposals
 * settled from them → Accept by the area → Discard → expiry.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import {
  AREA_LIMIT, FAILED_LINE, MAX_VARIANTS, QUOTE_TTL_MS, STOPPED_LINE, expireAreaProposals, kindOf, parseRequest, planAreas, quoteHolds,
  quoteUidOf, quoteView, textSeed, variantsOf, type PlanCtx,
} from '../src/services/decks/areas.ts';
import { D1GenRuntime, type StepExecutor, type StepRow } from '../src/services/decks/genRuntime.ts';
import { admitStatus } from '../src/services/decks/genRooms.ts';
import { DECK_GENERATE } from '../src/middleware/rateLimit.ts';
import deckAreas from '../src/routes/deck_areas.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';
import { contractErrors } from '../src/contracts/validate.ts';
import { CONTRACTS } from '../src/contracts/index.ts';

const schemaOf = (name: keyof typeof CONTRACTS) => JSON.parse(readFileSync(`cloudflare-worker/src/contracts/${CONTRACTS[name].schema}`, 'utf8'));

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const IMG = '@cf/black-forest-labs/flux-1-schnell';
const CARD = {
  uid: 'card-one', title: 'Kestrel cuts audit time', notes: '',
  blocks: [
    { id: 'b1', kind: 'text', grid: { c1: 1, c2: 12, r1: 1, r2: 1 }, style: 'heading', text: 'Kestrel cuts audit time' },
    { id: 'b2', kind: 'text', grid: { c1: 1, c2: 7, r1: 2, r2: 6 }, style: 'paragraph', text: 'Audits take weeks. Kestrel reads the ledger and flags what matters.' },
  ],
};
const EMPTY = { c1: 8, c2: 12, r1: 2, r2: 4 };

function ctx(over: Partial<PlanCtx> = {}): PlanCtx & { quotes: any[] } {
  const quotes: any[] = [];
  return {
    quotes,
    userId: 7, projectId: 3, deckId: 9, cards: [CARD], aspect: '16:9', voice: null,
    quote: async (o) => { quotes.push(o); return { ok: true, hold_microusd: o.task === 'deck_image' ? 5000 : 1200, model: o.model ?? MODEL }; },
    modelFor: async (element) => ({ element, model: element === 'photo' ? IMG : MODEL, source: 'default', locked: false, set_by: null, stale: [], plan_blocked: [], notice: null, switched_off: [] }),
    venture: async (element) => (element === 'round_terms'
      ? { element, available: true, blocks: [{ kind: 'metric', label: 'Pre-money', value: null }], bindings: [], model: null, label: 'Round terms' }
      : { element, available: false, code: 'pick_required', line: 'Pick a line from a session with recorded consent.' }) as any,
    sources: async () => [],
    art: async () => ({ seed_base: 'a'.repeat(32), art: {} as any }),
    ...over,
  };
}
const ask = (areas: any[], variants = 1, extra: Record<string, unknown> = {}) => parseRequest({ card: 'card-one', areas, variants, ...extra });

// ---- the request --------------------------------------------------------------

test('the request: 1 to 3 variants, at most 6 areas of one card (60 for a whole-deck build), and no model is read from the client', () => {
  // Mutation checked: let variants reach 4 → the first refusal fails.
  assert.equal(MAX_VARIANTS, 3);
  assert.deepEqual(ask([{ id: 'b2', grid: CARD.blocks[1].grid, element: 'body' }], 4), { refusal: 'invalid_variants', message: 'Ask for 1, 2 or 3 variants per area.' });
  assert.equal((ask([{ id: 'b2', grid: CARD.blocks[1].grid, element: 'body' }], 0) as any).refusal, 'invalid_variants');
  const seven = Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, grid: { c1: 1, c2: 1, r1: 1, r2: 1 }, element: 'body' }));
  assert.equal((ask(seven) as any).refusal, 'too_many_areas');
  assert.equal(AREA_LIMIT.areas, 6);
  assert.equal(AREA_LIMIT.deck_build, 60);
  assert.ok(!('refusal' in ask(seven, 1, { class: 'deck_build' })), 'a whole-deck build takes more');
  assert.equal((ask([{ id: 'a', grid: { c1: 1, c2: 1, r1: 1, r2: 1 }, element: 'body' }, { id: 'b', grid: { c1: 2, c2: 2, r1: 1, r2: 1 }, element: 'body', card: 'other' }]) as any).refusal, 'one_card');
  assert.equal((ask([{ id: 'a', grid: { c1: 0, c2: 13, r1: 1, r2: 1 }, element: 'body' }]) as any).refusal, 'invalid_area');
  assert.equal((ask([{ id: 'a', grid: CARD.blocks[1].grid, element: 'body', action: 'translate' }]) as any).refusal, 'invalid_action');
  const ok = ask([{ id: 'b2', grid: CARD.blocks[1].grid, element: 'body', model: '@cf/evil/model' }], 2, { model: '@cf/evil/model', mode: 'compare' });
  assert.ok(!('refusal' in ok));
  if ('refusal' in ok) return;
  assert.deepEqual(ok.areas[0], { id: 'b2', grid: CARD.blocks[1].grid, element: 'body', card: 'card-one', action: 'rewrite' }, 'no model, no compare mode');
});

// ---- the plan and the quote ------------------------------------------------------

test('the plan: each kind of area, its gates, and quote lines that sum to the hold', async () => {
  const c = ctx();
  const req = ask([
    { id: 'b2', grid: CARD.blocks[1].grid, element: 'body', action: 'shorten' },
    { id: 'free:8-2', grid: EMPTY, element: 'callout' },
    { id: 'free:1-6', grid: { c1: 9, c2: 12, r1: 5, r2: 6 }, element: 'photo' },
    { id: 'free:x', grid: { c1: 1, c2: 3, r1: 6, r2: 6 }, element: 'round_terms' },
    { id: 'free:y', grid: { c1: 4, c2: 6, r1: 6, r2: 6 }, element: 'interview_quote' },
  ], 3);
  assert.ok(!('refusal' in req));
  if ('refusal' in req) return;
  const plan = await planAreas(c, req);
  const [text, empty, photo, terms, quote] = plan.areas;
  // Text with words: the founder's change, on the element's resolved model, one line per variant.
  assert.equal(text.kind, 'text');
  assert.equal(text.lines.length, 3);
  assert.ok(text.lines.every((l) => l.model === MODEL && l.task === 'rail_write'));
  assert.match(String((text.lines[0].input as any).messages[0].content), /Shorten this text/);
  // An empty area: words written from the card's own words, at most its capacity.
  assert.equal(empty.refusal, null);
  assert.match(String((empty.lines[0].input as any).messages[0].content), /Kestrel reads the ledger/);
  assert.match(String((empty.lines[0].input as any).systemPrompt), /never write a number/);
  // An image: the pipeline's steps as lines, each variant at its own seed pair, stored as a proposal.
  assert.equal(photo.kind, 'image');
  assert.deepEqual(photo.lines.map((l) => (l.input as any).variant), [0, 1, 2]);
  assert.equal((photo.lines[0].input as any).store.ask.use, 'content');
  assert.equal(photo.gates.image_check, true, 'every image is checked');
  // Records: no model, free, one variant; a gate that does not pass refuses the area on its own.
  assert.deepEqual([terms.kind, terms.variants, terms.hold_microusd, terms.lines.length], ['records', 1, 0, 0]);
  assert.equal(terms.quote_lines[0].free, true);
  assert.deepEqual(quote.refusal, { code: 'pick_required', message: 'Pick a line from a session with recorded consent.' });
  assert.equal(quote.gates.records, 'pick_required');
  // Every area's lines sum to its hold, and the areas' holds to the run's.
  // Mutation checked: price an image area at one variant → its lines no longer sum to its hold.
  for (const a of plan.areas) {
    assert.equal(a.quote_lines.reduce((n, l) => n + l.microusd, 0), a.hold_microusd, a.key);
    assert.equal(a.lines.reduce((n, l) => n + l.quote_microusd, 0), a.hold_microusd, `${a.key}: the run holds what the quote says`);
  }
  assert.equal(plan.hold_microusd, plan.areas.reduce((n, a) => n + a.hold_microusd, 0));
  assert.equal(plan.lines.length, 9);
  const view = await quoteView(plan, Date.parse('2026-11-02T22:00:00Z'));
  assert.equal(view.expires_at, '2026-11-02T22:10:00.000Z', 'valid for 10 minutes');
  assert.deepEqual([view.runs, view.refused], [4, 1]);
  assert.match(view.areas[0].lines[1].label, /Safety check on every text run/);
  assert.equal(view.areas[3].model_label, 'No model · free');
});

test('a 3-variant batch records 3 distinct seeds of the one resolved model', async () => {
  const req = ask([{ id: 'b2', grid: CARD.blocks[1].grid, element: 'body' }], 3);
  if ('refusal' in req) throw new Error('refused');
  const plan = await planAreas(ctx(), req);
  const lines = plan.areas[0].lines;
  assert.equal(new Set(lines.map((l) => l.model)).size, 1, 'one model');
  const seeds = lines.map((l) => (l.input as any).seed);
  assert.equal(new Set(seeds).size, 3, 'three seeds');
  assert.deepEqual(seeds, [0, 1, 2].map((k) => textSeed(9, 'card-one', 'b2', k)), 'the same seeds for the same area every time');
  assert.equal(new Set(lines.map((l) => (l.input as any).temperature)).size, 3, 'three wordings');
});

test('gates on the server: a locked plan, an unreadable pick, a switched-off element and nothing to write from each refuse their area only', async () => {
  const locked = ctx({ modelFor: async (element) => ({ element, model: null, source: 'org_lock', locked: true, set_by: 1, stale: [], plan_blocked: [{ level: 'org_lock', model: MODEL, plan: 'Raise + Grow' }], notice: null, switched_off: [] }) as any });
  const r1 = ask([{ id: 'b2', grid: CARD.blocks[1].grid, element: 'body' }]);
  if ('refusal' in r1) throw new Error('refused');
  const p1 = await planAreas(locked, r1);
  assert.equal(p1.areas[0].refusal?.code, 'role_locked');
  assert.equal(p1.areas[0].gates.plan, 'locked');
  assert.equal(p1.lines.length, 0, 'nothing runs');
  const off = await planAreas(ctx({ modelFor: async () => { throw Object.assign(new Error('Not switched on yet.'), { element: 'body' }); } }), r1);
  assert.equal(off.areas[0].refusal?.code, 'not_switched_on');
  const unreadable = await planAreas(ctx({ modelFor: async () => { throw new Error('D1 down'); } }), r1);
  assert.equal(unreadable.areas[0].refusal?.code, 'picks_unreadable');
  const bare = await planAreas(ctx({ cards: [{ uid: 'card-one', title: '', blocks: [] }] }), ask([{ id: 'x', grid: EMPTY, element: 'body' }]) as any);
  assert.equal(bare.areas[0].refusal?.code, 'nothing_to_write_from');
  const other = await planAreas(ctx(), ask([{ id: 'x', grid: EMPTY, element: 'speaker_notes' }]) as any);
  assert.equal(other.areas[0].refusal?.code, 'element_not_generated');
  assert.equal(kindOf('speaker_notes'), null);
});

test('a missing metric is null, never 0: a chart with nothing recorded is refused, and a chart is built only from records', async () => {
  const req = ask([{ id: 'x', grid: { c1: 1, c2: 6, r1: 2, r2: 5 }, element: 'chart' }]);
  if ('refusal' in req) throw new Error('refused');
  const none = await planAreas(ctx(), req);
  assert.equal(none.areas[0].refusal?.code, 'not_recorded');
  assert.equal(none.areas[0].hold_microusd, 0);
  assert.doesNotMatch(none.areas[0].refusal!.message, /\b0\b|\$0/);
  // A records element whose figure is not recorded keeps it null.
  const terms = await planAreas(ctx(), ask([{ id: 'r', grid: EMPTY, element: 'round_terms' }]) as any);
  assert.equal((terms.areas[0].payload as any).record.blocks[0].value, null);
});

test('the quote goes stale when the price, the areas or the time change', async () => {
  const req = ask([{ id: 'b2', grid: CARD.blocks[1].grid, element: 'body' }], 2);
  if ('refusal' in req) throw new Error('refused');
  const plan = await planAreas(ctx(), req);
  const now = Date.parse('2026-11-02T22:00:00Z');
  const uid = await quoteUidOf(plan, now + QUOTE_TTL_MS);
  assert.equal(await quoteHolds(uid, plan, now), true);
  assert.equal(await quoteHolds(uid, plan, now + QUOTE_TTL_MS + 1), false, 'expired');
  const dearer = await planAreas(ctx({ quote: async (o) => ({ ok: true, hold_microusd: 1300, model: o.model ?? MODEL }) }), req);
  assert.equal(await quoteHolds(uid, dearer, now), false, 'a new price');
  const more = await planAreas(ctx(), ask([{ id: 'b2', grid: CARD.blocks[1].grid, element: 'body' }], 3) as any);
  assert.equal(await quoteHolds(uid, more, now), false, 'more variants');
  assert.equal(await quoteHolds('not-a-quote', plan, now), false);
});

// ---- the variants -------------------------------------------------------------

const step = (seq: number, variant: number, over: Partial<StepRow>): StepRow => ({
  batch_uid: 'b', seq, card_uid: 'card-one', area_id: 'b2', element: 'body', kind: 'text', task: 'rail_write', model: MODEL, state: 'done',
  quote_microusd: 1200, charged_microusd: 600, model_used: MODEL, fallback_used: 0, usage_log_id: 1, error_code: null,
  started_at: '2026-11-02 22:00:00', ended_at: '2026-11-02 22:00:02', input: JSON.stringify({ variant, seed: 100 + variant }), result: null, ...over,
});
const TEXT_PAYLOAD = { kind: 'text', role: 'paragraph', limit: 280, grid: CARD.blocks[1].grid, action: 'rewrite', before: CARD.blocks[1].text, source: CARD.blocks[1].text };

test('a failed variant leaves the others intact, each labelled by model, seed, cost and seconds, with the free critique', () => {
  // Mutation checked: stop reading variants at the first failure → variant 3 is missing and this fails.
  const v = variantsOf(TEXT_PAYLOAD, [
    step(0, 0, { result: JSON.stringify({ text: 'Audits take weeks; Kestrel reads the ledger and flags what matters.' }) }),
    step(1, 1, { state: 'failed', error_code: 'model_failed', charged_microusd: 0 }),
    step(2, 2, { result: JSON.stringify({ text: 'Kestrel turns weeks of audit into a ledger read.' }) }),
  ], { aspect: '16:9', contrastAa: true });
  assert.deepEqual(v.map((x) => x.state), ['ready', 'failed', 'ready']);
  assert.deepEqual(v[1].error, { code: 'model_failed', message: FAILED_LINE });
  assert.deepEqual([v[0].n, v[0].seed, v[0].cost_microusd, v[0].seconds], [1, 100, 600, 2]);
  assert.match(v[0].model_label, /llama/i);
  assert.deepEqual(v[0].payload, { kind: 'text', before: CARD.blocks[1].text, after: 'Audits take weeks; Kestrel reads the ledger and flags what matters.' });
  assert.deepEqual(v[2].critique, { fits: true, contrast_aa: true, density_ok: true });
});

test('words, never figures: a variant that names a number the card does not is refused; an empty area\'s words become a block', () => {
  const [bad] = variantsOf(TEXT_PAYLOAD, [step(0, 0, { result: JSON.stringify({ text: 'Kestrel cuts audits by 73% for 40 customers.' }) })], { aspect: '16:9', contrastAa: null });
  assert.equal(bad.state, 'failed');
  assert.equal(bad.error?.code, 'wording_refused');
  const empty = { ...TEXT_PAYLOAD, before: null, role: 'subheading', grid: EMPTY };
  const [ok] = variantsOf(empty, [step(0, 0, { result: JSON.stringify({ text: 'Audits, read in an afternoon.' }) })], { aspect: '16:9', contrastAa: null });
  assert.deepEqual(ok.payload, { kind: 'block', block: { kind: 'text', text: 'Audits, read in an afternoon.', style: 'body' } });
  assert.equal(ok.critique?.contrast_aa, null, 'not checked is null, never false');
  const [stopped] = variantsOf(TEXT_PAYLOAD, [step(0, 0, { state: 'stopped', charged_microusd: 0 })], { aspect: '16:9', contrastAa: true });
  assert.deepEqual(stopped.error, { code: 'stopped', message: STOPPED_LINE });
  const [img] = variantsOf({ kind: 'image' }, [step(0, 0, { kind: 'image', result: JSON.stringify({ image: null, seed: 5 }) })], { aspect: '16:9', contrastAa: true });
  assert.equal(img.error?.code, 'image_not_stored', 'an image that was not stored is never offered');
  const [img2] = variantsOf({ kind: 'image' }, [step(0, 0, { kind: 'image', input: JSON.stringify({ variant: 0 }), result: JSON.stringify({ image: { uid: 'u1', url: '/api/decks/images/u1/file' }, seed: 5 }) })], { aspect: '16:9', contrastAa: true });
  assert.deepEqual([img2.state, img2.seed, (img2.payload as any).image.uid], ['ready', 5, 'u1']);
});

test('the rate limit covers the admission path', () => {
  assert.ok(DECK_GENERATE.test('/api/decks/9/areas'));
  assert.ok(!DECK_GENERATE.test('/api/decks/9/areas/quote'), 'a quote runs nothing');
  assert.ok(!DECK_GENERATE.test('/api/decks/9/areas/proposals'));
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
/** The deck's room, standing in for the Durable Object: it admits through the D1 core. */
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
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withThrownResponses(() => app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), DECK_GEN_ROOM: roomFor(db) } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('routes: quote, one run under one hold, proposals settled from its steps, Accept by the area, Discard, a replay, and expiry', async () => {
  const db = world();
  const body = { card: 'card-one', areas: [{ id: 'b2', grid: CARD.blocks[1].grid, element: 'body' }, { id: 'free:8-2', grid: EMPTY, element: 'callout' }], variants: 3 };
  const q = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas/quote`, body);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.runs, 2, JSON.stringify(q.body.areas.map((a: any) => a.refusal)));
  assert.ok(q.body.hold_microusd > 0);
  for (const a of q.body.areas) assert.equal(a.lines.reduce((n: number, l: any) => n + l.microusd, 0), a.hold_microusd);
  // D1511: the reply is the adapter's contract.
  assert.deepEqual(contractErrors(schemaOf('areasQuote'), q.body), []);
  // A member who cannot write the deck is refused, and nothing is quoted.
  assert.equal((await call(db, OTHER, 'POST', `/api/decks/${DECK}/areas/quote`, body)).status, 403);
  // A tampered quote is stale.
  const stale = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas`, { ...body, quote_uid: `${(Date.now() + 60_000).toString(36)}.${'0'.repeat(32)}` }, { 'Idempotency-Key': 'areas-test-0001' });
  assert.deepEqual([stale.status, stale.body.error], [409, 'quote_stale']);

  const g = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas`, { ...body, quote_uid: q.body.quote_uid }, { 'Idempotency-Key': 'areas-test-0002' });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal(g.body.hold_microusd, q.body.hold_microusd, 'the run holds what the quote said');
  assert.equal(g.body.proposals.length, 2);
  assert.ok(g.body.proposals.every((p: any) => p.state === 'running' && p.batch_uid === g.body.batch_uid));
  const hold = db.prepare('SELECT * FROM deck_area_batches WHERE uid = ?').get(g.body.batch_uid) as any;
  assert.equal(Number(hold.quote_microusd), q.body.hold_microusd, 'one parent hold for every area');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM deck_area_batch_steps WHERE batch_uid = ?').get(g.body.batch_uid) as any).n, 6);
  // The same Idempotency-Key is the same run: no second hold, no second set of proposals.
  const again = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas`, body, { 'Idempotency-Key': 'areas-test-0002' });
  assert.deepEqual([again.body.batch_uid, again.body.replayed, again.body.proposals.length], [g.body.batch_uid, true, 2]);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM deck_area_proposals').get() as any).n, 2);

  // Before the run ends, the proposals are still running.
  const early = await call(db, FOUNDER, 'GET', `/api/decks/${DECK}/areas/proposals?batch=${g.body.batch_uid}`);
  assert.equal(early.body.done, false);
  assert.deepEqual(contractErrors(schemaOf('areasGenerate'), early.body), []);
  // The run: each step charges half its line; area b2's second variant fails.
  const exec: StepExecutor = async (s) => {
    const input = JSON.parse(s.input ?? '{}');
    if (s.area_id === 'b2' && input.variant === 1) return { ok: false, charged_microusd: 0, error_code: 'model_failed' };
    db.prepare('INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, reservation_uid, record_ref) VALUES (?, ?, ?, ?, ?, ?)')
      .run(FOUNDER, 'rail_write', s.model, Math.floor(s.quote_microusd / 2), hold.reservation_uid, `deckstep:${s.batch_uid}:${s.seq}`);
    return { ok: true, charged_microusd: Math.floor(s.quote_microusd / 2), model_used: s.model, variant: { text: s.area_id === 'b2' ? 'Audits take weeks; Kestrel reads the ledger.' : 'Audits, read in an afternoon.' } };
  };
  const st = await new D1GenRuntime({ DB: d1Over(db) } as any, exec).startBatch(g.body.batch_uid);
  assert.equal(st?.state, 'done');
  assert.ok(Number(st!.charged_microusd) <= q.body.hold_microusd, 'the settled charge is at most the hold');
  const read = await call(db, FOUNDER, 'GET', `/api/decks/${DECK}/areas/proposals?batch=${g.body.batch_uid}`);
  assert.equal(read.body.done, true);
  assert.deepEqual(contractErrors(schemaOf('areasGenerate'), read.body), []);
  assert.notDeepEqual(contractErrors(schemaOf('areasGenerate'), { ...read.body, proposals: [{ ...read.body.proposals[0], variants: [{ ...read.body.proposals[0].variants[0], model: 'x' }] }] }), [], 'a model id never rides on a variant');
  const b2 = read.body.proposals.find((p: any) => p.area_id === 'b2');
  const callout = read.body.proposals.find((p: any) => p.area_id === 'free:8-2');
  assert.deepEqual(b2.variants.map((v: any) => v.state), ['ready', 'failed', 'ready'], 'a failed variant leaves the others intact');
  assert.equal(b2.state, 'ready');
  assert.equal(callout.variants[0].payload.kind, 'block', 'an empty area\'s words are a new block');
  assert.ok(read.body.batch.charged_microusd <= read.body.batch.held_microusd);

  // Accept by the area: variant 3 of b2; a failed variant cannot be accepted; another reader's proposal is not theirs to decide.
  const failed = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas/card-one/b2/accept`, { proposal_uid: b2.uid, variant: 2 });
  assert.deepEqual([failed.status, failed.body.error, failed.body.message], [409, 'variant_not_ready', FAILED_LINE]);
  assert.equal((await call(db, OTHER, 'POST', `/api/decks/${DECK}/areas/card-one/b2/accept`, { proposal_uid: b2.uid, variant: 3 })).status, 403);
  const wrongArea = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas/card-one/b1/accept`, { proposal_uid: b2.uid, variant: 3 });
  assert.equal(wrongArea.status, 404, 'a proposal is accepted only on its own area');
  const acc = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas/card-one/b2/accept`, { proposal_uid: b2.uid, variant: 3 });
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  assert.deepEqual([acc.body.proposal.state, acc.body.proposal.outcome, acc.body.proposal.accepted_variant], ['accepted', 'accept', 3]);
  assert.equal((await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas/card-one/b2/accept`, { proposal_uid: b2.uid, variant: 1 })).status, 409, 'decided once');
  const dis = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas/proposals/${callout.uid}/discard`);
  assert.deepEqual([dis.body.proposal.state, dis.body.proposal.outcome], ['discarded', 'discard']);

  // Expiry: a proposal nobody decided expires after 14 days.
  db.prepare(`INSERT INTO deck_area_proposals (uid, deck_id, project_id, card_uid, area_id, element, state, created_by, expires_at) VALUES ('00000000-0000-4000-8000-0000000000ee', ?, ?, 'card-one', 'b1', 'title', 'ready', ?, '2026-01-01 00:00:00')`).run(DECK, P, FOUNDER);
  assert.equal(await expireAreaProposals({ DB: d1Over(db) } as any, new Date('2026-11-02T00:00:00Z')), 1);
  assert.equal((db.prepare(`SELECT state FROM deck_area_proposals WHERE uid = '00000000-0000-4000-8000-0000000000ee'`).get() as any).state, 'expired');
  assert.equal(await expireAreaProposals({ DB: d1Over(db) } as any, new Date('2026-11-02T00:00:00Z')), 0, 'decided rows are never expired');
});

test('routes: an area the server refuses is listed with its reason, and nothing runs when none can', async () => {
  const db = world();
  const r = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas`, { card: 'card-one', areas: [{ id: 'q', grid: EMPTY, element: 'interview_quote' }], variants: 1 }, { 'Idempotency-Key': 'areas-test-0003' });
  assert.equal(r.status, 422);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM deck_area_batches').get() as any).n, 0, 'no run, no hold');
});

test('migration: one row per area of a run, Accept and Discard outcomes, and the expiry index', () => {
  const sql = readFileSync('cloudflare-worker/sql/migrations/202611022246_deck_area_proposals.sql', 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS deck_area_proposals/);
  assert.match(sql, /outcome IN \('accept', 'accept_all', 'discard', 'expired', 'superseded'\)/);
  assert.match(sql, /payload_json IS NULL OR length\(payload_json\) <= 32768/);
  assert.match(sql, /deck_area_proposals_open ON deck_area_proposals\(state, expires_at\)/);
  assert.doesNotMatch(sql, /insert/i, 'no data');
});
