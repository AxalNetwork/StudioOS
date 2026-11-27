/**
 * D1542 (#3780, deck v2 B4) — the `grid_diagram` job: the model writes
 * structure only, code strips every number, draws it, holds it to its area
 * and refuses an overflow; the result is a proposal nothing saves before
 * Accept. Then the free check route the canvas reads after a node edit.
 *
 * Pure parts first (numbers, the family of types, the structure, the fit, the
 * plan, the variant), then the areas routes end to end on D1 for a Flow, and
 * `POST /api/decks/:id/diagrams/check` against its contract. Every name is
 * synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_grid_diagram_d1542.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import {
  DIAGRAM_ELEMENTS, DIAGRAM_FAMILY, FAMILY_TYPES, GRID_DIAGRAM_JOB, LATER_LINE, diagramFit, diagramVariant, drawnTypeOf, sanitizeStructure, stripNumbers,
} from '../src/services/decks/gridDiagram.ts';
import { kindOf, parseRequest, planAreas, variantsOf, type PlanCtx } from '../src/services/decks/areas.ts';
import { diagramLayout } from '../src/services/decks/diagramLayout.ts';
import { fitProblems } from '../src/services/decks/designSystem.ts';
import { ELEMENT_ROUTES, choicesFor, groupElements } from '../src/services/decks/elementModels.ts';
import { D1GenRuntime, type StepExecutor, type StepRow } from '../src/services/decks/genRuntime.ts';
import { admitStatus } from '../src/services/decks/genRooms.ts';
import deckAreas from '../src/routes/deck_areas.ts';
import deckDiagrams from '../src/routes/deck_diagrams.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';
import { contractErrors } from '../src/contracts/validate.ts';
import { CONTRACTS } from '../src/contracts/index.ts';

const schemaOf = (name: keyof typeof CONTRACTS) => JSON.parse(readFileSync(`cloudflare-worker/src/contracts/${CONTRACTS[name].schema}`, 'utf8'));
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const WIDE = { c1: 1, c2: 12, r1: 2, r2: 6 };
const CARD = {
  uid: 'card-one', title: 'How Kestrel closes the books', notes: '',
  blocks: [
    { id: 'b1', kind: 'text', grid: { c1: 1, c2: 12, r1: 1, r2: 1 }, style: 'heading', text: 'How Kestrel closes the books' },
    { id: 'b2', kind: 'text', grid: WIDE, style: 'paragraph', text: 'Connect the ledger, reconcile every account, review the flags, then close.' },
  ],
};
const FLOW = JSON.stringify({
  type: 'flow',
  nodes: [{ id: 'a', label: 'Connect ledger' }, { id: 'c', label: 'Review flags' }, { id: 'b', label: '$3M ARR' }, { id: 'd', label: 'Close' }],
  edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }],
});

// ---- numbers ---------------------------------------------------------------------

test('every number is stripped: a "$3M ARR" label comes out "ARR", and no figure survives into the diagram', () => {
  // Mutation checked: keep tokens numberIn flags (return true) → "$3M ARR" stays and the first assertion fails.
  assert.deepEqual(stripNumbers('$3M ARR'), { text: 'ARR', stripped: 1 });
  assert.deepEqual(stripNumbers('Grow to 40% margin'), { text: 'Grow to margin', stripped: 1 });
  assert.deepEqual(stripNumbers('three million users (2026)'), { text: 'users', stripped: 3 });
  assert.deepEqual(stripNumbers('Close the books'), { text: 'Close the books', stripped: 0 });
  const s = sanitizeStructure(JSON.parse(FLOW), 'flow');
  assert.ok(s.ok);
  if (!s.ok) return;
  assert.deepEqual(s.diagram.items.map((i) => i.label), ['Connect ledger', 'ARR', 'Review flags', 'Close'], 'the edges order the steps; the number is gone');
  assert.equal(s.stripped, 1);
  assert.doesNotMatch(JSON.stringify(s.diagram.items), /\d|\$/);
  // A label that was only a number is dropped, and its node with it.
  const only = sanitizeStructure({ nodes: [{ label: 'Sign up' }, { label: '40%' }, { label: 'Renew' }] }, 'flow');
  assert.ok(only.ok && only.diagram.items.length === 2);
  // A matrix axis is stripped too; an axis left empty refuses the matrix.
  const m = sanitizeStructure({ nodes: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }], axes: { x: 'Price', y: '10x depth' } }, 'matrix');
  assert.ok(m.ok && m.diagram.axes?.y === 'depth');
  assert.equal((sanitizeStructure({ nodes: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }], axes: { x: 'Price', y: '2026' } }, 'matrix') as any).code, 'matrix_axes');
});

// ---- the family of types ---------------------------------------------------------

test('the family of types: the four the model draws, then funnel, hierarchy, hub and spoke and 2×2 as later; Flow, Cycle and Matrix generate', () => {
  // Mutation checked: mark funnel live with drawn 'flow' → drawnTypeOf('funnel') is no longer null and this fails.
  assert.deepEqual([...FAMILY_TYPES].sort(), ['cycle', 'flow', 'funnel', 'hierarchy', 'hub', 'matrix', 'positioning', 'timeline']);
  for (const t of ['flow', 'cycle', 'matrix', 'timeline'] as const) {
    assert.equal(DIAGRAM_FAMILY[t].drawn, t);
    const nodes = Array.from({ length: 4 }, (_, i) => ({ id: `n${i}`, label: `Step ${'abcd'[i]}` }));
    const s = sanitizeStructure({ nodes, axes: { x: 'Price', y: 'Depth' } }, t);
    assert.ok(s.ok, t);
    if (s.ok) assert.equal(diagramLayout(s.diagram)?.type, t, `${t} draws`);
  }
  for (const t of ['funnel', 'hierarchy', 'hub', 'positioning'] as const) assert.deepEqual([DIAGRAM_FAMILY[t].live, DIAGRAM_FAMILY[t].drawn], [false, null], t);
  assert.deepEqual(Object.keys(DIAGRAM_ELEMENTS).filter((e) => drawnTypeOf(e)), ['flow', 'cycle', 'matrix']);
  for (const e of Object.keys(DIAGRAM_ELEMENTS)) assert.equal(kindOf(e), 'diagram', e);
  // The model is the rail's Diagrams group's, through the one catalogue: no second list.
  assert.deepEqual(groupElements('diagrams'), ['flow', 'cycle', 'matrix', 'funnel', 'hierarchy', 'hub']);
  assert.equal(ELEMENT_ROUTES.flow.task, 'rail_write');
  assert.ok(choicesFor('flow').suggested.length > 0);
});

// ---- the fit -----------------------------------------------------------------------

test('overflow is refused by fitProblems: more steps than the area\'s width holds, or a label longer than its box, is never placed', () => {
  // Mutation checked: return [] from diagramFit → both refusals below pass through as placed blocks and this fails.
  const s = sanitizeStructure(JSON.parse(FLOW), 'flow');
  if (!s.ok) throw new Error('refused');
  assert.deepEqual(diagramFit(s.diagram, WIDE), [], 'four steps fit twelve columns');
  const narrow = { c1: 1, c2: 4, r1: 2, r2: 6 };
  const problems = diagramFit(s.diagram, narrow);
  assert.equal(problems[0].kind, 'too_many_items');
  assert.deepEqual(problems.filter((p) => p.kind === 'too_many_items'), fitProblems([{ blocks: [{ id: 'diagram', kind: 'graphic', grid: narrow, diagram: s.diagram }] }]), 'the steps rule is fitProblems\' own');
  const refused = diagramVariant({ type: 'flow', grid: narrow, card_index: 0 }, FLOW);
  assert.deepEqual([refused.ok, (refused as any).code], [false, 'does_not_fit']);
  assert.match((refused as any).message, /holds at most 2 steps/);
  // A label that cannot sit in its box, at any size, overflows too.
  const long = JSON.stringify({ nodes: [{ label: 'Reconciliation of every intercompany account' }, { label: 'Close' }] });
  const tight = diagramVariant({ type: 'flow', grid: { c1: 1, c2: 4, r1: 2, r2: 2 }, card_index: 2 }, long);
  assert.deepEqual([tight.ok, (tight as any).code], [false, 'does_not_fit']);
  assert.match((tight as any).message, /^Card 3: "Reconciliation/);
  const fine = diagramVariant({ type: 'flow', grid: WIDE, card_index: 0 }, FLOW);
  assert.ok(fine.ok);
  if (fine.ok) assert.deepEqual([fine.block.kind, fine.block.graphic, fine.stripped], ['graphic', 'Flow', 1]);
  assert.equal((diagramVariant({ type: 'flow', grid: WIDE }, JSON.stringify({ nodes: Array.from({ length: 9 }, (_, i) => ({ label: `Step ${'abcdefghi'[i]}` })) })) as any).code, 'too_many_nodes', 'more than a diagram holds is refused, never cut short');
});

// ---- the plan and the variant ---------------------------------------------------------

function ctx(over: Partial<PlanCtx> = {}): PlanCtx & { quotes: any[] } {
  const quotes: any[] = [];
  return {
    quotes, userId: 7, projectId: 3, deckId: 9, cards: [CARD], aspect: '16:9', voice: null,
    quote: async (o) => { quotes.push(o); return { ok: true, hold_microusd: 1500, model: o.model ?? MODEL } as any; },
    modelFor: async (element) => ({ element, model: MODEL, source: 'deck_group', locked: false, set_by: null, stale: [], plan_blocked: [], notice: null, switched_off: [] }),
    venture: async () => ({ available: false, code: 'x', line: 'x' }) as any,
    sources: async () => [], art: async () => ({ seed_base: 'a'.repeat(32), art: {} as any }),
    ...over,
  };
}
const ask = (areas: any[], variants = 1) => parseRequest({ card: 'card-one', areas, variants });

test('the plan: a Flow runs the grid_diagram job on the resolved model; a later type and an area too small are refused before any quote', async () => {
  // Mutation checked: drop the `coming_later` refusal → funnel plans lines and is quoted, and this fails.
  const c = ctx();
  const req = ask([
    { id: 'b2', grid: WIDE, element: 'flow' },
    { id: 'free:1', grid: { c1: 1, c2: 6, r1: 1, r2: 1 }, element: 'funnel' },
    { id: 'free:2', grid: { c1: 1, c2: 6, r1: 2, r2: 3 }, element: 'matrix' },
  ], 2);
  if ('refusal' in req) throw new Error(req.message);
  const plan = await planAreas(c, req);
  const [flow, funnel, matrix] = plan.areas;
  assert.equal(flow.kind, 'diagram');
  assert.equal(flow.lines.length, 2);
  assert.ok(flow.lines.every((l) => l.model === MODEL && l.task === 'rail_write' && (l.input as any).job === GRID_DIAGRAM_JOB && (l.input as any).option === 'grid:flow'));
  assert.match(String((flow.lines[0].input as any).systemPrompt), /Never write a number/);
  assert.match(String((flow.lines[0].input as any).messages[0].content), /reconcile every account/);
  assert.deepEqual(flow.payload, { kind: 'diagram', job: GRID_DIAGRAM_JOB, element: 'flow', type: 'flow', grid: WIDE, card_index: 0, replaces_block: 'b2' });
  assert.equal(flow.quote_lines.reduce((n, l) => n + l.microusd, 0), flow.hold_microusd);
  assert.deepEqual(funnel.refusal, { code: 'coming_later', message: LATER_LINE });
  assert.equal(funnel.hold_microusd, 0);
  assert.equal(matrix.refusal?.code, 'area_too_small', 'a matrix needs eight columns for its four quadrants');
  assert.equal(c.quotes.length, 1, 'only the Flow was quoted');
});

const step = (variant: number, over: Partial<StepRow>): StepRow => ({
  batch_uid: 'b', seq: variant, card_uid: 'card-one', area_id: 'b2', element: 'flow', kind: 'text', task: 'rail_write', model: MODEL, state: 'done',
  quote_microusd: 1500, charged_microusd: 700, model_used: MODEL, fallback_used: 0, usage_log_id: 1, error_code: null,
  started_at: '2026-11-03 10:00:00', ended_at: '2026-11-03 10:00:03', input: JSON.stringify({ variant, seed: 50 + variant }), result: null, ...over,
});

test('a variant is the drawn block, numbers stripped; one that does not fit fails on its own and the others stay acceptable', () => {
  const payload = { kind: 'diagram', job: GRID_DIAGRAM_JOB, element: 'flow', type: 'flow', grid: { c1: 1, c2: 8, r1: 2, r2: 6 }, card_index: 0, replaces_block: 'b2' };
  const five = JSON.stringify({ nodes: ['Connect', 'Match', 'Flag', 'Review', 'Close'].map((label) => ({ label })) });
  const v = variantsOf(payload, [step(0, { result: JSON.stringify({ text: FLOW }) }), step(1, { result: JSON.stringify({ text: five }) })], { aspect: '16:9', contrastAa: true });
  assert.deepEqual(v.map((x) => x.state), ['ready', 'failed']);
  assert.equal((v[0].payload as any).kind, 'block');
  assert.equal((v[0].payload as any).block.diagram.items[1].label, 'ARR');
  assert.equal((v[0].payload as any).stripped, 1);
  assert.deepEqual(v[0].critique, { fits: true, contrast_aa: true, density_ok: true });
  assert.equal(v[1].error?.code, 'does_not_fit');
});

// ---- the routes, end to end ----------------------------------------------------------

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
  app.route('/api/decks', deckDiagrams);
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withThrownResponses(() => app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), DECK_GEN_ROOM: roomFor(db) } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const slidesOf = (db: DatabaseSync) => (db.prepare('SELECT slides FROM pitch_decks WHERE id = ?').get(DECK) as any).slides;

test('routes: a Flow is a proposal; nothing is saved to the deck before Accept, Discard leaves the card unchanged, and the model is the Diagrams group pick', async () => {
  // Mutation checked: write pitch_decks.slides in settleProposals → "nothing is saved before Accept" fails;
  // drop resolveElementModel's deck_group level → the step model is no longer the Diagrams group pick and this fails.
  const db = world();
  const before = slidesOf(db);
  // The rail's Diagrams group pick for this deck (`group:diagrams`), resolved by resolveElementModel on the server.
  const alt = choicesFor('flow').suggested[1]?.id ?? MODEL;
  db.prepare("INSERT INTO deck_model_picks (scope, scope_id, key, model, locked) VALUES ('deck', ?, 'group:diagrams', ?, 0)").run(String(P), alt);
  const body = { card: 'card-one', areas: [{ id: 'b2', grid: WIDE, element: 'flow' }], variants: 2 };
  const q = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas/quote`, body);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.deepEqual(contractErrors(schemaOf('areasQuote'), q.body), []);
  assert.deepEqual([q.body.areas[0].kind, q.body.areas[0].model, q.body.runs], ['diagram', alt, 1]);
  const g = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas`, { ...body, quote_uid: q.body.quote_uid }, { 'Idempotency-Key': 'diagram-test-0001' });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  const hold = db.prepare('SELECT * FROM deck_area_batches WHERE uid = ?').get(g.body.batch_uid) as any;
  const exec: StepExecutor = async (s) => {
    const input = JSON.parse(s.input ?? '{}');
    assert.equal(input.job, GRID_DIAGRAM_JOB);
    db.prepare('INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, reservation_uid, record_ref) VALUES (?, ?, ?, ?, ?, ?)')
      .run(FOUNDER, 'rail_write', s.model, Math.floor(s.quote_microusd / 2), hold.reservation_uid, `deckstep:${s.batch_uid}:${s.seq}`);
    return { ok: true, charged_microusd: Math.floor(s.quote_microusd / 2), model_used: s.model, variant: { text: FLOW } };
  };
  await new D1GenRuntime({ DB: d1Over(db) } as any, exec).startBatch(g.body.batch_uid);
  const read = await call(db, FOUNDER, 'GET', `/api/decks/${DECK}/areas/proposals?batch=${g.body.batch_uid}`);
  assert.equal(read.body.done, true);
  assert.deepEqual(contractErrors(schemaOf('areasGenerate'), read.body), []);
  const p = read.body.proposals[0];
  assert.deepEqual([p.state, p.kind, p.variants.length], ['ready', 'diagram', 2]);
  const block = p.variants[0].payload.block;
  assert.deepEqual(block.diagram.items.map((i: any) => i.label), ['Connect ledger', 'ARR', 'Review flags', 'Close'], 'the "$3M ARR" label is stripped end to end');
  assert.equal(slidesOf(db), before, 'nothing is saved before Accept');
  const steps = db.prepare('SELECT model FROM deck_area_batch_steps WHERE batch_uid = ?').all(g.body.batch_uid) as any[];
  assert.ok(steps.every((s) => s.model === alt), 'every step runs the Diagrams group pick');
  // Discard: the proposal is decided, the card is as it was.
  const dis = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas/proposals/${p.uid}/discard`);
  assert.deepEqual([dis.status, dis.body.proposal.state], [200, 'discarded']);
  assert.equal(slidesOf(db), before, 'Discard leaves the card unchanged');
  assert.equal((await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/areas/card-one/b2/accept`, { proposal_uid: p.uid, variant: 1 })).status, 409, 'a discarded proposal cannot be accepted');
});

test('the check route: an edited diagram, its fit and the figures its labels name, against its contract; free and read-only', async () => {
  // Mutation checked: drop the node-box check from diagramFit → the long label reads fits: true and this fails.
  const db = world();
  const before = slidesOf(db);
  const diagram = { v: 1, type: 'flow', items: [{ label: 'Connect ledger' }, { label: 'Review flags' }, { label: 'Close' }] };
  const ok = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/diagrams/check`, { diagram, grid: WIDE });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(contractErrors(schemaOf('diagrams'), ok.body), []);
  assert.deepEqual([ok.body.fits, ok.body.problems, ok.body.figures, ok.body.steps], [true, [], [], { min: 2, max: 6 }]);
  const long = { ...diagram, items: [{ label: 'Reconciliation of every intercompany account' }, { label: 'Close' }] };
  const over = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/diagrams/check`, { diagram: long, grid: { c1: 1, c2: 4, r1: 2, r2: 2 }, card: 1 });
  assert.equal(over.body.fits, false);
  assert.match(over.body.problems[0].message, /^Card 2: "Reconciliation/);
  assert.deepEqual(contractErrors(schemaOf('diagrams'), over.body), []);
  const fig = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/diagrams/check`, { diagram: { ...diagram, items: [{ label: '$3M ARR' }, { label: 'Close' }] }, grid: WIDE });
  assert.deepEqual(fig.body.figures, ['$'], 'a figure the founder typed is named, never removed from their words');
  assert.equal(fig.body.diagram.items[0].label, '$3M ARR');
  const bad = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/diagrams/check`, { diagram: { v: 1, type: 'funnel', items: [] }, grid: WIDE });
  assert.deepEqual([bad.body.diagram, bad.body.fits], [null, false]);
  assert.deepEqual(contractErrors(schemaOf('diagrams'), bad.body), []);
  assert.equal((await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/diagrams/check`, { diagram, grid: { c1: 0 } })).status, 400);
  assert.ok([403, 404].includes((await call(db, OTHER, 'POST', `/api/decks/${DECK}/diagrams/check`, { diagram, grid: WIDE })).status), 'another member\'s deck is not checked');
  assert.equal(slidesOf(db), before, 'a check saves nothing');
});
