/**
 * D1511 (#3762, deck v2 A18) — the recorded AI binding (`_recorded_ai.mjs`; part 1's injected-failure binding is `_fake_ai.mjs`), and the
 * one-click run on it.
 *
 *  · the one-click build, as `OneClickBuild.jsx` runs it: the brief from
 *    `GET /api/decks/new/context`, the quote, `POST /api/decks/generate`, then
 *    Accept (`keep-slides` with `save`). On a venture whose records fill every
 *    card (`fixtures/oneClickVenture.ts`), the proposal has 0 "Not recorded"
 *    placeholders and 0 fit problems, and the quote is at least the settled
 *    charge — for the inferred brief and for every audience and length;
 *  · each injected failure, through the real router and the real route:
 *    429 and 3040 move down the chain, or leave the figures-only deck at no
 *    charge; a timeout is cut at the router's limit; a guard block refuses
 *    before any model runs; bad JSON keeps the figures and says the words
 *    could not be read; over-capacity text never overflows an area; a
 *    non-image answer to a drawing is no image;
 *  · the fake itself: no answer nobody recorded, and every fault fires.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/recorded_ai_d1511.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckNew from '../src/routes/deck_new.ts';
import decks from '../src/routes/decks.ts';
import { __resetForTest, run, ROUTE } from '../src/services/aiRouter.ts';
import { fitProblems } from '../src/services/decks/designSystem.ts';
import { HEADLINE_MAX, LENGTH_IDS } from '../src/services/decks/newDeck.ts';
import { AUDIENCES } from '../src/services/decks/slideModel.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { FAULTS, GUARD_MODEL, OVER_CAPACITY_REPEAT, RECORDINGS, fakeAI, recordingFor } from './_recorded_ai.mjs';
import { ONE_CLICK, seedOneClickVenture } from './fixtures/oneClickVenture.ts';

after(() => removeMigratedDatabases());
const JWT_SECRET = 'synthetic-d1511-only-not-a-real-credential'.repeat(2);
const PRIMARY = ROUTE.rail_write.model;

async function world() {
  __resetForTest();
  const db = migratedDatabase();
  seedOneClickVenture(db);
  const ai = fakeAI();
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI: ai };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckNew).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const jwt = await new SignJWT({ user_id: ONE_CLICK.founderUserId }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const call = async (method: string, path: string, json?: unknown) => {
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, ...(json === undefined ? {} : { body: JSON.stringify(json) }) }, env);
    const text = await res.text();
    let body: any; try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  };
  const close = () => { globalThis.fetch = real; db.close(); };
  const runs = () => db.prepare("SELECT model, charged_microusd, reservation_uid, refusal FROM ai_usage_logs WHERE guard_for IS NULL AND task <> 'safety' ORDER BY id").all() as any[];
  return { db, ai, env, call, close, runs };
}
type W = Awaited<ReturnType<typeof world>>;

/** Every place a proposal could show a placeholder: the "Not recorded" text, or a binding graded so. */
function placeholders(slides: any[]): string[] {
  const out: string[] = [];
  slides.forEach((s, i) => {
    const seen = JSON.stringify(s);
    if (/Not recorded/.test(seen)) out.push(`card ${i + 1} (${s.spec_id})`);
  });
  return out;
}

/** The one-click run, as the studio presses it: brief → quote → build. */
async function oneClick(w: W, brief?: { audience: string; length: string }) {
  let b = brief;
  if (!b) {
    const ctx = await w.call('GET', `/api/decks/new/context?project_id=${ONE_CLICK.projectId}`);
    assert.equal(ctx.status, 200, JSON.stringify(ctx.body));
    b = ctx.body.inferred ? { audience: ctx.body.inferred.audience, length: ctx.body.inferred.length } : ctx.body.fast_path;
  }
  const quote = await w.call('POST', '/api/decks/new/quote', { project_id: ONE_CLICK.projectId, step: 'build', ...b });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  const built = await w.call('POST', '/api/decks/generate', { project_id: ONE_CLICK.projectId, ...b });
  return { brief: b!, quote, built };
}

/** The one-click bar (#3762 §One-click bar): no placeholder, no fit problem, a quote at least the charge. */
function assertBar(r: Awaited<ReturnType<typeof oneClick>>, label: string) {
  assert.equal(r.built.status, 201, `${label}: ${JSON.stringify(r.built.body)}`);
  const slides = r.built.body.proposal.slides;
  assert.ok(slides.length >= 6, label);
  assert.deepEqual(placeholders(slides), [], `${label}: 0 Not recorded placeholders`);
  assert.deepEqual(r.built.body.progress.filter((p: any) => p.missing.length).map((p: any) => [p.title, p.missing]), [], `${label}: every card's slots filled`);
  assert.deepEqual(fitProblems(slides.filter((s: any) => !s.appendix)), [], `${label}: 0 fit or overflow problems`);
  const charged = r.built.body.cost.charged_microusd;
  assert.equal(typeof charged, 'number', `${label}: the charge is read`);
  assert.ok(r.quote.body.ai === true && r.quote.body.hold_microusd >= charged, `${label}: quote ${r.quote.body.hold_microusd} ≥ charge ${charged}`);
}

// 1 ───────────────────────────────────────────────────────────────────────────
test('the one-click run on the fake binding: the inferred brief builds a deck with 0 placeholders, 0 fit problems, quote ≥ charge, and Accept saves it', async () => {
  const w = await world();
  try {
    const r = await oneClick(w);
    assert.deepEqual(r.brief, { audience: 'pre_seed_fund', length: 'short' }, 'the brief a pre-seed venture infers');
    assertBar(r, 'inferred');
    assert.equal(r.built.body.wording.by, 'Eadwyn');
    assert.equal(r.built.body.wording.dropped, 0, 'the recorded words name no number, so none is dropped');
    const charged = r.built.body.cost.charged_microusd;
    assert.ok(charged > 0, 'the run charged');
    const [row] = w.runs();
    assert.equal(row.charged_microusd, charged, 'the answer\'s charge is the usage row\'s');
    const held = w.db.prepare('SELECT included_microusd + topup_microusd AS held FROM ai_budget_reservations WHERE uid = ?').get(row.reservation_uid) as any;
    assert.equal(held.held, r.quote.body.hold_microusd, 'the quote is the hold the run reserved');
    assert.deepEqual(w.ai.calls.map((c: any) => [c.model, c.fault]), [[PRIMARY, null]]);
    assert.equal(w.ai.guardCalls.length >= 2, true, 'the guard checked the input and the output');
    // Accept: every card, saved as the current version.
    const kept = await w.call('POST', `/api/decks/proposals/${r.built.body.proposal.id}/keep-slides`, { all: true, save: true });
    assert.equal(kept.status, 200, JSON.stringify(kept.body));
    assert.equal(kept.body.deck.slides.length, r.built.body.proposal.slides.length);
    assert.deepEqual(placeholders(kept.body.deck.slides), []);
  } finally { w.close(); }
});

test('the bar holds for every audience and length on the same records', async () => {
  const w = await world();
  try {
    for (const audience of AUDIENCES) {
      for (const length of LENGTH_IDS) assertBar(await oneClick(w, { audience, length }), `${audience}/${length}`);
    }
  } finally { w.close(); }
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('429 and 3040: one failure moves down the chain and still builds; every model failing builds the figures-only deck at no charge', async () => {
  for (const kind of ['rate_limit_429', 'capacity_3040'] as const) {
    const once = await world();
    try {
      once.ai.inject(kind);
      const r = await oneClick(once);
      assertBar(r, `${kind} once`);
      assert.equal(r.built.body.wording.by, 'Eadwyn', `${kind}: the next model answered`);
      assert.equal(once.ai.calls[0].fault, kind);
      assert.notEqual(once.ai.calls[1].model, PRIMARY, `${kind}: the second call is a sibling`);
      assert.deepEqual(once.ai.pending(), []);
    } finally { once.close(); }
    const every = await world();
    try {
      every.ai.inject(kind, { times: Infinity });
      const r = await oneClick(every);
      assertBar(r, `${kind} every time`);
      assert.equal(r.built.body.wording.by, 'none');
      assert.match(r.built.body.wording.reason, /could not answer.*Nothing was charged/);
      assert.equal(r.built.body.cost.charged_microusd, 0);
      assert.ok(every.ai.calls.length >= 2 && every.ai.calls.every((c: any) => c.fault === kind), `${kind}: the whole chain was tried`);
      assert.ok(every.runs().every((x: any) => x.charged_microusd === 0), 'nothing charged');
    } finally { every.close(); }
  }
});

test('a timeout: the primary that never answers is cut at the router\'s 8 s and the sibling builds the deck', async (t) => {
  const w = await world();
  try {
    w.ai.inject('timeout', { model: PRIMARY });
    // The brief and the quote on real time; only the build runs on the mocked clock, advanced
    // 100 ms at a time once the work queued so far has drained, until the build answers.
    const ctx = await w.call('GET', `/api/decks/new/context?project_id=${ONE_CLICK.projectId}`);
    const brief = { audience: ctx.body.inferred.audience, length: ctx.body.inferred.length };
    const quote = await w.call('POST', '/api/decks/new/quote', { project_id: ONE_CLICK.projectId, step: 'build', ...brief });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); };
    let settled = false;
    const pending = w.call('POST', '/api/decks/generate', { project_id: ONE_CLICK.projectId, ...brief }).finally(() => { settled = true; });
    let waited = 0;
    for (let i = 0; i < 3_000 && !settled; i += 1) { await flush(); if (!settled) { t.mock.timers.tick(100); waited += 100; } }
    assert.ok(settled, `the build answered within ${waited} ms of mocked time`);
    const r = { brief, quote, built: await pending };
    t.mock.timers.reset();
    assertBar(r, 'timeout');
    assert.equal(r.built.body.wording.by, 'Eadwyn');
    assert.deepEqual(w.ai.calls.map((c: any) => c.fault), ['timeout', null]);
    assert.notEqual(w.ai.calls[1].model, PRIMARY);
    assert.ok(waited >= 8_000, `cut at the limit, not before (${waited} ms)`);
  } finally { w.close(); }
});

test('a guard block: refused 422 guard_blocked before any model runs; nothing written, nothing charged', async () => {
  const w = await world();
  try {
    w.ai.inject('guard_block');
    const r = await oneClick(w);
    assert.equal(r.built.status, 422, JSON.stringify(r.built.body));
    assert.equal(r.built.body.error, 'guard_blocked');
    assert.deepEqual(w.ai.calls, [], 'no model was called');
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM pitch_deck_proposals').get() as any).n, 0);
    assert.ok(w.runs().every((x: any) => x.charged_microusd === 0));
  } finally { w.close(); }
});

test('bad JSON: the figures-only deck, with the reason; the words are not invented', async () => {
  const w = await world();
  try {
    w.ai.inject('bad_json');
    const r = await oneClick(w);
    assertBar(r, 'bad_json');
    assert.equal(r.built.body.wording.by, 'none');
    assert.match(r.built.body.wording.reason, /words could not be read/);
    assert.doesNotMatch(JSON.stringify(r.built.body.proposal.slides), /Close the books/, 'nothing from the broken answer reaches a card');
  } finally { w.close(); }
});

test('over-capacity text: no card overflows; a headline past its space is clipped or moved to the notes', async () => {
  const w = await world();
  try {
    w.ai.inject('over_capacity_text');
    const r = await oneClick(w);
    assertBar(r, 'over_capacity_text');
    const recorded = recordingFor(PRIMARY, 'Write the cards of a pitch deck').response;
    const longest = Math.min(...recorded.cards.map((c: any) => `${c.headline} `.repeat(OVER_CAPACITY_REPEAT).trim().length));
    assert.ok(longest > HEADLINE_MAX, 'every injected headline is longer than any headline may be');
    for (const s of r.built.body.proposal.slides) {
      for (const b of s.blocks.filter((x: any) => x.kind === 'text' && x.style === 'heading')) assert.ok(b.text.length <= HEADLINE_MAX, `${s.spec_id}: ${b.text.length}`);
    }
  } finally { w.close(); }
});

test('a non-image answer to a drawing is no image: the run fails at no charge, and the recorded image draws', async () => {
  const draw = { task: 'deck_image' as const, drawJob: 'DK4', userId: 0, text: 'A calm ledger on a desk', draw: {} };
  const kv = () => { const m = new Map(); return { async get(k: string) { return m.get(k) ?? null; }, async put(k: string, v: string) { m.set(k, v); } }; };
  __resetForTest();
  const good = fakeAI();
  const ok: any = await run({ AI: good, AI_SPEND: kv(), DB: aiBudgetFixture().DB } as any, draw as any);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.image.mime, 'image/png');
  assert.deepEqual([ok.image.width, ok.image.height], [1, 1], 'the size read from the recorded bytes');
  __resetForTest();
  const bad = fakeAI().inject('non_image', { times: Infinity });
  const r: any = await run({ AI: bad, AI_SPEND: kv(), DB: aiBudgetFixture().DB } as any, draw as any);
  assert.equal(r.ok, false);
  assert.equal(r.refusal, 'all_models_failed');
  assert.match(r.error, /unexpected image response/);
  assert.ok(bad.calls.length >= 1 && bad.calls.every((c: any) => c.fault === 'non_image'));
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('the fake: every fault is known and fires once by default; an unrecorded call throws; a recorded call is answered', async () => {
  assert.deepEqual([...FAULTS], ['rate_limit_429', 'capacity_3040', 'timeout', 'guard_block', 'bad_json', 'over_capacity_text', 'non_image']);
  assert.throws(() => fakeAI().inject('teapot' as any), /unknown fault/);
  const ai = fakeAI({ recordings: [] });
  await assert.rejects(ai.run('@cf/x/y', { messages: [{ role: 'user', content: 'hi' }] }), /no recording/);
  const once = fakeAI().inject('rate_limit_429');
  await assert.rejects(once.run(PRIMARY, { messages: [{ role: 'user', content: 'Write the cards of a pitch deck' }] }), (e: any) => e.status === 429);
  const second: any = await once.run(PRIMARY, { messages: [{ role: 'user', content: 'Write the cards of a pitch deck' }] });
  assert.ok(JSON.parse(second.response).cards.length >= 12, 'the second call is answered from the recording');
  assert.deepEqual(once.pending(), []);
  const g: any = await fakeAI().inject('guard_block').run(GUARD_MODEL, { messages: [] });
  assert.equal(g.response, 'unsafe\nS1');
  await assert.rejects(fakeAI().inject('capacity_3040').run(PRIMARY, { messages: [] }), /3040/);
  assert.ok(RECORDINGS.every((r: any) => typeof r.id === 'string'));
});
