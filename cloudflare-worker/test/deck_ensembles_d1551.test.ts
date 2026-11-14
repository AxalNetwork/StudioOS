/**
 * D1551 (#3798, deck v2 C3) — text ensembles on the generation runtime.
 *
 *   1. The modes: a whole-deck build drafts and refines by default; an areas
 *      run writes once; best-of-n writes three drafts and a judge line.
 *   2. One quote, one hold: every refine and judge is a line of the plan,
 *      quoted at its run's maximum, and the lines sum to the area's hold.
 *   3. Order: a refine or judge line is claimed only once its drafts have
 *      ended, even with six drivers racing.
 *   4. The refine reads its draft's words; the variant is the refined text,
 *      or the draft when the refine did not land (and says so).
 *   5. The judge ranks the drafts blind, outside their family, inside the
 *      run's one hold, and names the best variant; the judge is no variant.
 *   6. Progress rows name each step's role (draft, refine, judge).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_ensembles_d1551.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { parseRequest, planAreas, variantsOf, type PlanCtx } from '../src/services/decks/areas.ts';
import { D1GenRuntime, READY_STEP, stepRecordRef, type PlanLine, type StepExecutor, type StepRow } from '../src/services/decks/genRuntime.ts';
import { stepExecutor } from '../src/services/decks/stepExecutor.ts';
import { BEST_OF_N, ensembleOf, refineMessages, resolveAfter, roleOf } from '../src/services/decks/ensembles.ts';
import { familyOf } from '../src/services/decks/critic.ts';
import { runView } from '../src/routes/deck_batches.ts';

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const CARD = {
  uid: 'card-one', title: 'Kestrel cuts audit time', notes: '',
  blocks: [{ id: 'b2', kind: 'text', grid: { c1: 1, c2: 7, r1: 2, r2: 6 }, style: 'paragraph', text: 'Audits take weeks. Kestrel reads the ledger and flags what matters.' }],
};
const EMPTY = { c1: 8, c2: 12, r1: 2, r2: 4 };

function ctx(): PlanCtx & { quotes: any[] } {
  const quotes: any[] = [];
  return {
    quotes, userId: 7, projectId: 5, deckId: 50, cards: [CARD], aspect: '16:9', voice: null,
    quote: async (o: any) => { quotes.push(o); return { ok: true, hold_microusd: o.task === 'module_decision' ? 700 : 1200, model: o.model ?? MODEL }; },
    modelFor: async (element: string) => ({ element, model: MODEL, source: 'default', locked: false, set_by: null, stale: [], plan_blocked: [], notice: null, switched_off: [] }) as any,
    venture: async () => ({ available: false, code: 'x', line: 'x' }) as any,
    sources: async () => [], art: async () => ({ seed_base: 'a'.repeat(32), art: {} as any }),
  } as any;
}
const area = { id: 'free:8-2', grid: EMPTY, element: 'callout' };
const req = (extra: Record<string, unknown>) => { const r = parseRequest({ card: 'card-one', areas: [area], ...extra }); if ('refusal' in r) throw new Error(r.message); return r; };

// ---- 1. the modes ----------------------------------------------------------------

test('1. a whole-deck build drafts and refines by default; an areas run writes once; a mode can be asked for', () => {
  assert.equal(ensembleOf(undefined, 'deck_build'), 'draft_refine');
  assert.equal(ensembleOf(undefined, 'areas'), 'single');
  assert.equal(ensembleOf('best_of_n', 'areas'), 'best_of_n');
  assert.equal(ensembleOf('everything', 'deck_build'), 'draft_refine', 'an unknown mode is the class default');
  assert.equal(req({ class: 'deck_build' }).ensemble, 'draft_refine');
  assert.equal(req({}).ensemble, 'single');
});

// ---- 2. one quote, one hold ------------------------------------------------------------

test('2. draft-refine: each draft has its refine line, after it, and the lines sum to the hold', async () => {
  // Mutation checked: the refine line left out of the hold → the lines no longer sum to it.
  const c = ctx();
  const plan = await planAreas(c, req({ class: 'deck_build' }));
  const [a] = plan.areas;
  assert.deepEqual(plan.lines.map((l) => l.kind), ['text', 'refine']);
  assert.deepEqual((plan.lines[1].input as any).after, [0], 'the refine is after its draft');
  assert.equal(plan.lines[1].model, MODEL, 'refined by the model #3754 routed the element to');
  assert.equal(a.lines.reduce((n, l) => n + l.quote_microusd, 0), a.hold_microusd);
  assert.equal(a.quote_lines.reduce((n, l) => n + l.microusd, 0), a.hold_microusd);
  assert.equal(plan.hold_microusd, 2400, 'one quote: the draft and its refine');
  // The refine is quoted at its most: a draft as long as the area's limit.
  const refineQuote = c.quotes.find((q) => /improve one draft/.test(String(q.systemPrompt)));
  assert.ok(refineQuote, 'the refine was quoted');
  assert.ok(String(refineQuote.messages[0].content).length > Number((plan.areas[0].payload as any).limit));
});

test('2. best-of-n: three drafts and one judge after all three, outside the drafts\' family, inside the quote', async () => {
  const c = ctx();
  const plan = await planAreas(c, req({ ensemble: 'best_of_n' }));
  assert.equal(BEST_OF_N, 3);
  assert.deepEqual(plan.lines.map((l) => l.kind), ['text', 'text', 'text', 'judge']);
  const judge = plan.lines[3];
  assert.deepEqual((judge.input as any).after, [0, 1, 2]);
  assert.notEqual(familyOf(judge.model), familyOf(MODEL), 'the family rule');
  assert.equal(judge.task, 'module_decision');
  assert.equal(plan.hold_microusd, 3 * 1200 + 700);
  assert.equal(plan.areas[0].quote_lines.reduce((n, l) => n + l.microusd, 0), plan.hold_microusd);
});

test('2. resolveAfter turns each line\'s offsets into the run\'s sequence numbers', () => {
  const lines = resolveAfter([{ input: { a: 1 } }, { input: { after_back: [1] } }, { input: null }, { input: { after_back: [3, 1] } }] as any);
  assert.deepEqual(lines.map((l: any) => l.input?.after ?? null), [null, [0], null, [0, 2]]);
});

// ---- the runtime, end to end on D1 -----------------------------------------------------

const M716 = readFileSync('cloudflare-worker/sql/migrations/716_deck_area_batches.sql', 'utf8');
const M752 = readFileSync('cloudflare-worker/sql/migrations/752_deck_area_batches_seen.sql', 'utf8');
const RUNTIME_COLUMN = readFileSync('cloudflare-worker/sql/migrations/202611022120_deck_batch_runtime.sql', 'utf8');
const HOLD_COLUMNS = ['525_ai_reservation_idempotency.sql', '632_ai_hold_context.sql'].map((n) => readFileSync(`cloudflare-worker/sql/migrations/${n}`, 'utf8')).join('\n');
const USER = 7, DECK = 50, P = 5;

function world() {
  const f = aiBudgetFixture();
  f.db.exec(HOLD_COLUMNS);
  f.db.exec('CREATE TABLE IF NOT EXISTS pitch_decks (id INTEGER PRIMARY KEY, project_id INTEGER, version INTEGER, slides TEXT, title TEXT, is_current INTEGER)');
  f.db.exec(`INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (${DECK}, ${P}, 1, '[]', 'Synthetic', 1)`);
  f.db.exec(M716); f.db.exec(M752); f.db.exec(RUNTIME_COLUMN);
  setFixtureAllowance(f.db, 0);
  f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,?)').run(USER, 50_000_000);
  return f;
}
const steps = (f: any, uid: string) => f.db.prepare('SELECT * FROM deck_area_batch_steps WHERE batch_uid = ? ORDER BY seq').all(uid) as StepRow[];
const free = { acquire: async () => ({ ok: true, lease: { id: 'l' } }), release: async () => {} } as any;

test('3. a refine or judge is claimed only after its drafts end, even with six drivers racing', async () => {
  // Mutation checked: READY_STEP without the `after` clause → a refine starts while its draft runs.
  const f = world();
  try {
    const order: string[] = [];
    const execute: StepExecutor = async (step) => {
      order.push(`start ${step.seq}`);
      await new Promise((r) => setTimeout(r, step.kind === 'text' ? 30 : 1));
      order.push(`end ${step.seq}`);
      return { ok: true, charged_microusd: 0, variant: { text: `words ${step.seq}` } };
    };
    const rt = new D1GenRuntime({ DB: f.DB } as any, execute);
    const lines: PlanLine[] = resolveAfter([
      { card_uid: 'c1', area_id: 'a1', element: 'callout', kind: 'text', task: 'rail_write', model: MODEL, quote_microusd: 100, input: { variant: 0, ensemble: 'draft_refine' } },
      { card_uid: 'c1', area_id: 'a1', element: 'callout', kind: 'refine', task: 'rail_write', model: MODEL, quote_microusd: 100, input: { variant: 0, ensemble: 'draft_refine', after_back: [1] } },
      { card_uid: 'c2', area_id: 'a2', element: 'callout', kind: 'text', task: 'rail_write', model: MODEL, quote_microusd: 100, input: { variant: 0, ensemble: 'draft_refine' } },
      { card_uid: 'c2', area_id: 'a2', element: 'callout', kind: 'refine', task: 'rail_write', model: MODEL, quote_microusd: 100, input: { variant: 0, ensemble: 'draft_refine', after_back: [1] } },
    ]);
    const a = await rt.admit({ deckId: DECK, projectId: P, userId: USER, cls: 'deck_build', idemKey: 'ensemble-order-1', lines });
    assert.equal(a.ok, true, JSON.stringify(a));
    if (!a.ok) return;
    await Promise.all(Array.from({ length: 6 }, () => rt.startBatch(a.uid)));
    for (const [draft, refine] of [[0, 1], [2, 3]]) {
      assert.ok(order.indexOf(`end ${draft}`) < order.indexOf(`start ${refine}`), `refine ${refine} started after draft ${draft} ended: ${order.join(', ')}`);
    }
    assert.ok(order.indexOf('start 2') < order.indexOf('end 0'), 'the two drafts ran side by side (the fan-out)');
    assert.ok(steps(f, a.uid).every((s) => s.state === 'done'));
    assert.match(READY_STEP, /json_extract\(s\.input, '\$\.after'\)/);
  } finally { f.db.close(); }
});

test('3. every ready draft is claimed before any ready second pass, so the deck\'s first draft lands first', async () => {
  // Mutation checked: READY_STEP ordered by seq alone → the refine of the first area runs before the second area\'s draft.
  const f = world();
  try {
    const order: number[] = [];
    const rt = new D1GenRuntime({ DB: f.DB } as any, async (step) => { order.push(step.seq); return { ok: true, charged_microusd: 0, variant: { text: 'w' } }; });
    const line = (card: string, kind: string, back?: number[]): PlanLine => ({ card_uid: card, area_id: 'a', element: 'callout', kind, task: 'rail_write', model: MODEL, quote_microusd: 10, input: { ensemble: 'draft_refine', ...(back ? { after_back: back } : {}) } });
    const a = await rt.admit({ deckId: DECK, projectId: P, userId: USER, cls: 'deck_build', idemKey: 'ensemble-draft-first', lines: resolveAfter([line('c1', 'text'), line('c1', 'refine', [1]), line('c2', 'text'), line('c2', 'refine', [1])]) });
    if (!a.ok) throw new Error(JSON.stringify(a));
    await rt.startBatch(a.uid);
    assert.deepEqual(order, [0, 2, 1, 3]);
  } finally { f.db.close(); }
});

function fakeRun(f: any, opts: { refine?: 'ok' | 'fail'; judge?: string } = {}) {
  const seen: any[] = [];
  const run = async (_env: any, o: any) => {
    seen.push(o);
    const row = f.db.prepare('INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, reservation_uid, record_ref) VALUES (?, ?, ?, ?, ?, ?)')
      .run(USER, o.task, o.model ?? MODEL, 50, o.parentHold?.uid ?? null, o.rail?.record ?? null);
    const base = { usage: { model: o.model ?? MODEL }, usageLogId: Number(row.lastInsertRowid), attempts: [] };
    if (o.task === 'module_decision') return { ok: true, output: JSON.stringify({ best: { choice: opts.judge ?? 'A', confidence: 0.8 } }), ...base };
    const refining = /improve one draft/.test(String(o.systemPrompt ?? ''));
    if (refining && opts.refine === 'fail') return { ok: false, refusal: 'all_models_failed', error: 'down', ...base, attempts: [] };
    return { ok: true, output: refining ? 'Kestrel reads the ledger and flags what matters, in hours.' : 'Kestrel reads the ledger.', ...base };
  };
  return { run, seen };
}

async function runPlan(f: any, plan: { lines: PlanLine[] }, run: any) {
  const rt = new D1GenRuntime({ DB: f.DB } as any, stepExecutor({ DB: f.DB } as any, { run, governor: free, sleep: async () => {} }));
  const a = await rt.admit({ deckId: DECK, projectId: P, userId: USER, cls: 'deck_build', idemKey: `ensemble-${Math.random().toString(36).slice(2, 10)}`, lines: plan.lines });
  assert.equal(a.ok, true, JSON.stringify(a));
  if (!a.ok) throw new Error('not admitted');
  await rt.startBatch(a.uid);
  return a.uid;
}

test('4. the refine reads its draft\'s words; the variant is the refined text, charged for both, under the one hold', async () => {
  // Mutation checked: the executor not reading the draft → the refine's message has no draft in it.
  const f = world();
  try {
    const plan = await planAreas(ctx(), req({ class: 'deck_build' }));
    const fr = fakeRun(f);
    const uid = await runPlan(f, plan, fr.run);
    const refineCall = fr.seen.find((o) => /improve one draft/.test(String(o.systemPrompt)));
    assert.match(String(refineCall.messages[0].content), /Kestrel reads the ledger\./, 'the draft is in the refine, as data');
    assert.ok(fr.seen.every((o) => o.parentHold?.uid), 'every call ran under the one parent hold');
    const holds = f.db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations").get() as any;
    assert.equal(holds.n, 1, 'one hold for the draft and the refine');
    const [v] = variantsOf(plan.areas[0].payload, steps(f, uid), { aspect: '16:9', contrastAa: true });
    assert.equal((v.payload as any).block.text, 'Kestrel reads the ledger and flags what matters, in hours.');
    assert.deepEqual(v.ensemble, { mode: 'draft_refine', refined: true, draft_model_label: v.ensemble?.draft_model_label });
    assert.equal(v.cost_microusd, 100, 'the draft and its refine');
    assert.equal(variantsOf(plan.areas[0].payload, steps(f, uid), { aspect: '16:9', contrastAa: true }).length, 1, 'the refine is no variant of its own');
  } finally { f.db.close(); }
});

test('4. a refine that does not land leaves the draft standing, and the variant says so', async () => {
  const f = world();
  try {
    const plan = await planAreas(ctx(), req({ class: 'deck_build' }));
    const uid = await runPlan(f, plan, fakeRun(f, { refine: 'fail' }).run);
    const [v] = variantsOf(plan.areas[0].payload, steps(f, uid), { aspect: '16:9', contrastAa: true });
    assert.equal(v.state, 'ready');
    assert.equal((v.payload as any).block.text, 'Kestrel reads the ledger.');
    assert.equal(v.ensemble?.refined, false);
  } finally { f.db.close(); }
});

test('5. best-of-n: the judge ranks the drafts inside the run\'s hold and names the best; it is no variant', async () => {
  // Mutation checked: variantsOf ignoring the judge's result → no variant is marked best.
  const f = world();
  try {
    const plan = await planAreas(ctx(), req({ ensemble: 'best_of_n' }));
    const fr = fakeRun(f, { judge: 'B' });
    const uid = await runPlan(f, plan, fr.run);
    const judgeCall = fr.seen.find((o) => o.task === 'module_decision');
    assert.ok(judgeCall, 'the judge ran');
    assert.notEqual(familyOf(judgeCall.model), familyOf(MODEL));
    assert.ok(judgeCall.parentHold?.uid, 'inside the run\'s one hold');
    assert.doesNotMatch(String(judgeCall.text), /llama|meta/i, 'blind: no model name');
    const vs = variantsOf(plan.areas[0].payload, steps(f, uid), { aspect: '16:9', contrastAa: true });
    assert.equal(vs.length, 3, 'three drafts; the judge is none of them');
    assert.equal(vs.filter((v) => v.best).length, 1);
    const charged = (f.db.prepare('SELECT charged_microusd AS n FROM deck_area_batches WHERE uid = ?').get(uid) as any).n;
    assert.ok(charged <= plan.hold_microusd, 'settled within the one quote');
  } finally { f.db.close(); }
});

test('6. progress rows name each step\'s role, model, state, seconds and cost', async () => {
  const f = world();
  try {
    const plan = await planAreas(ctx(), req({ class: 'deck_build' }));
    const uid = await runPlan(f, plan, fakeRun(f).run);
    const rt = new D1GenRuntime({ DB: f.DB } as any, async () => ({ ok: true, charged_microusd: 0 }));
    const view = runView((await rt.status(uid))!);
    assert.deepEqual(view.steps.map((s: any) => s.role), ['draft', 'refine']);
    for (const s of view.steps as any[]) for (const k of ['element', 'model_label', 'state', 'seconds', 'cost_microusd']) assert.ok(k in s, k);
    assert.equal(roleOf('text', { ensemble: 'single' }), 'variant');
    assert.equal(stepRecordRef(uid, 1), `deckstep:${uid}:1`);
    assert.match(refineMessages({ label: 'callout', limit: 90, voice: '', card: 'Card words' }, 'Draft words').user, /Draft:[\s\S]*Draft words/);
  } finally { f.db.close(); }
});
