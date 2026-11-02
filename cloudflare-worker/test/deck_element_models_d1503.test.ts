/**
 * D1503 (#3754, deck v2 A10) — a model route per grid element, from the one
 * catalogue: `services/decks/elementModels.ts`, migration 717,
 * `GET/PUT /api/decks/:id/element-models`, the `grid:<element>` rail rows,
 * and the generation side (`POST /api/decks/generate`, the deck's images).
 *
 * Synthetic data, the mounted Worker routes and the real migrated schema;
 * `env.AI` is a stub and `fetch` throws, so no test reaches a provider.
 * Model ids a test invents start `@cf/synthetic/`.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_element_models_d1503.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckElementModels from '../src/routes/deck_element_models.ts';
import deckNew from '../src/routes/deck_new.ts';
import deckImages from '../src/routes/deck_images.ts';
import decks from '../src/routes/decks.ts';
import { __resetForTest, CANVAS_RAIL_KINDS, RAIL_KINDS, ROUTE } from '../src/services/aiRouter.ts';
import { CATALOGUE, modelById } from '../src/services/ai/catalogue.ts';
import { DECK_ELEMENT_JOBS, JOBS, USE_KINDS } from '../src/services/ai/modelUseCases.ts';
import { billedMicro } from '../src/services/ai/pricing.ts';
import { canRun, railOptionsOn, resolveRailOption, rowOffers } from '../src/services/ai/railMatrix.ts';
import {
  ELEMENTS, ELEMENT_ROUTES, FREE_LINE, LEVELS, ROUTED_ELEMENTS, choicesFor, estimateDeck, expected_ms, gridOptionRows,
  lockFor, presetModelFor, resolveElementModel, sizeFor, type PickRow,
} from '../src/services/decks/elementModels.ts';
import { OUTPUT_RULES, inputRefusal, outputProblems } from '../src/services/decks/elementOutputRules.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard, GUARD_MODEL } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const PAGE = 'Founder · Raise · Pitch deck';
const LLAMA = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MISTRAL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
const GLM = '@cf/zai-org/glm-4.7-flash';
const SCHNELL = '@cf/black-forest-labs/flux-1-schnell';
const KLEIN4 = '@cf/black-forest-labs/flux-2-klein-4b';
const RETIRED = '@cf/synthetic/retired-model';
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const ids = (element: string) => { const c = choicesFor(element); return [...c.suggested, ...c.more].map((m) => m.id); };

// ─────────────────────────────────────────────────────────── the one catalogue

test('one catalogue: no @cf/ id literal in the element routing, and every model it names is a catalogue model in #3721\'s plan', () => {
  // Mutation checked: a hard-coded '@cf/…' default in elementModels.ts → the literal assert fails.
  for (const f of ['../src/services/decks/elementModels.ts', '../src/services/decks/elementOutputRules.ts', '../src/routes/deck_element_models.ts']) {
    assert.equal(/@cf\//.test(read(f)), false, `${f} names a model itself`);
  }
  const inPlan = new Set(JOBS.flatMap((j) => [j.default, j.alternative, j.deeper, ...j.more].filter(Boolean) as string[]));
  for (const k of Object.values(USE_KINDS)) for (const id of k.models) inPlan.add(id);
  const catalogue = new Set(CATALOGUE.map((m) => m.id));
  for (const id of ROUTED_ELEMENTS) {
    const r = ELEMENT_ROUTES[id];
    assert.ok(JOBS.some((j) => j.id === r.job), `${id}: ${r.job} is a #3721 job`);
    assert.equal(DECK_ELEMENT_JOBS[ELEMENTS.find((e) => e.id === id)!.group].items[id], r.job, `${id} reads its job from DECK_ELEMENT_JOBS`);
    for (const m of [...ids(id), ...r.chain, ...r.pipeline.map((p) => p.model)]) {
      assert.ok(catalogue.has(m), `${id}: ${m} is in catalogue.ts`);
      assert.ok(inPlan.has(m), `${id}: ${m} is in #3721's plan`);
    }
  }
  // Every element of the picker is listed; a free one (or one whose job is a fixed check or not in the plan) is not routed.
  assert.equal(ELEMENTS.length, Object.values(DECK_ELEMENT_JOBS).reduce((n, g) => n + Object.keys(g.items).length, 0));
  for (const free of ['metric', 'team_grid', 'icons', 'upload', 'video', 'recorded_video']) assert.equal(ELEMENT_ROUTES[free], undefined, free);
  for (const on of ['title', 'body', 'photo', 'illustration', 'chart', 'table', 'timeline', 'flow', 'use_of_funds', 'edit_vary']) assert.ok(ELEMENT_ROUTES[on], on);
});

test('no element suggests more than three, in Default, Alternative, Deeper order, and `more` never repeats one', () => {
  // Mutation checked: choicesFor returning `more` inside `suggested` → the length assert fails (text has 7 choices).
  for (const id of ROUTED_ELEMENTS) {
    const c = choicesFor(id);
    assert.ok(c.suggested.length >= 1 && c.suggested.length <= 3, `${id}: ${c.suggested.length} suggested`);
    assert.deepEqual(c.suggested.map((m) => m.role), ['Default', 'Alternative', 'Deeper'].slice(0, c.suggested.length), id);
    const all = [...c.suggested, ...c.more].map((m) => m.id);
    assert.equal(new Set(all).size, all.length, `${id}: a model twice`);
  }
  assert.equal(choicesFor('body').suggested.length, 2, 'DK2 shows two: it names no Deeper');
  assert.ok(choicesFor('body').more.length >= 4, 'the rest of the write kind is under All models');
  assert.deepEqual(choicesFor('use_of_funds').suggested.map((m) => m.id), [LLAMA, GLM, MISTRAL], 'DK3: Default, Alternative, Deeper');
  assert.deepEqual(choicesFor('metric'), { suggested: [], more: [] });
});

test('every Phase A default is a model main already routes, on the element\'s own task, and every choice can run there', () => {
  const env = { AI_PARTNER_MODELS: 'on' };
  for (const id of ROUTED_ELEMENTS) {
    const r = ELEMENT_ROUTES[id];
    const route = (ROUTE as any)[r.task];
    assert.ok(route, `${id}: ${r.task} is a router task`);
    const def = resolveElementModel({ element: id, rows: [], deck: '1', member: '2', planRank: 2, env }).model!;
    assert.ok(def, `${id} has a default on the top plan`);
    assert.ok([route.model, ...(route.alternates ?? [])].includes(def), `${id}: ${def} is on ${r.task}`);
    for (const m of ids(id)) {
      if (r.task === 'rail_write') assert.ok(canRun(m, { vision: false }, env), `${id}: ${m} runs a rail write`);
      if (r.task === 'deck_image') {
        assert.ok(route.alternates.includes(m), `${id}: ${m} is a deck_image alternate`);
        assert.ok(rowOffers(resolveRailOption(PAGE, 'deck:image')!, m), `${id}: deck:image offers ${m}`);
      }
      if (r.task === 'rail_edit_image') assert.ok(route.alternates.includes(m), `${id}: ${m} edits`);
    }
  }
  assert.deepEqual(ELEMENT_ROUTES.photo.pipeline.map((p) => `${p.job}#${p.step}`), ['DK6#0', 'DK6#1', 'DK6#2'], 'a draw is checked three times after');
  assert.deepEqual(ELEMENT_ROUTES.photo.chain, [], 'an image never falls back to another model');
  assert.equal(ELEMENT_ROUTES.edit_vary.plan_min, 'lowest_paid', 'premium image edits are on paid plans (owner pick B, pending)');
  assert.equal(ELEMENT_ROUTES.title.plan_min, 'all');
});

// ─────────────────────────────────────────────────────────── resolveElementModel

const row = (scope: PickRow['scope'], scope_id: string, key: string, model: string, locked = 0): PickRow => ({ scope, scope_id, key, model, locked, plan_min: null, set_by: 9 });

test('the 9 levels, in order: HQ lock, area, deck element, deck group, deck preset (D1549), member element, member group, HQ default, row default', () => {
  // Mutation checked: resolveElementModel skipping the pick rows (ignoring the pick) → every level but the last fails.
  const wrote = choicesFor('body');
  const seven = [...wrote.suggested, ...wrote.more].map((m) => m.id).slice(0, 7);
  assert.equal(seven.length, 7, 'body has seven models to give seven levels a model each');
  const rows = [
    row('org', 'hq', 'body', seven[0], 1),
    row('area', '1/3/a2', 'body', seven[1]),
    row('deck', '1', 'body', seven[2]),
    row('deck', '1', 'group:text', seven[3]),
    // D1549 (#3796): the deck's preset, stored by name; Best runs body on its job's Best row.
    row('deck', '1', 'preset', 'best'),
    row('member', '2', 'body', seven[4]),
    row('member', '2', 'group:text', seven[5]),
    row('org', 'hq', 'group:text', seven[6], 0),
  ];
  assert.deepEqual([...LEVELS], ['org_lock', 'area', 'deck_element', 'deck_group', 'deck_preset', 'member_element', 'member_group', 'org_default', 'default']);
  const expected = [...seven.slice(0, 4), presetModelFor('body', 'best'), ...seven.slice(4)];
  assert.equal(expected[4], MISTRAL, 'body\'s Best is its job\'s best row');
  for (let i = 0; i <= rows.length; i++) {
    const r = resolveElementModel({ element: 'body', rows: rows.slice(i), deck: '1', member: '2', area: { card: 3, area: 'a2' }, planRank: 2, env: {} });
    assert.equal(r.source, LEVELS[i], `with the first ${i} levels gone`);
    assert.equal(r.model, i < rows.length ? expected[i] : LLAMA);
    assert.equal(r.locked, i === 0);
    assert.equal(r.notice, null);
  }
  // Another member's, deck's or area's rows never apply.
  const other = resolveElementModel({ element: 'body', rows: rows.slice(1, 6), deck: '99', member: '98', area: { card: 1, area: 'a1' }, planRank: 2, env: {} });
  assert.equal(other.source, 'default');
  // A group pick the element does not offer is not applicable, and not stale.
  const na = resolveElementModel({ element: 'photo', rows: [row('deck', '1', 'group:images', LLAMA)], deck: '1', member: '2', planRank: 2, env: {} });
  assert.equal(na.source, 'default'); assert.deepEqual(na.stale, []);
});

test('a stale pick reads as none, is returned to clear, and the answer names the model used instead', () => {
  // Mutation checked: refusalOf not testing the catalogue → the partner-gate assert in the plan_min test fails
  // (a retired id is still stale here: it is in no element's choices).
  const r = resolveElementModel({ element: 'body', rows: [row('deck', '1', 'body', RETIRED), row('member', '2', 'body', MISTRAL)], deck: '1', member: '2', planRank: 0, env: {} });
  assert.equal(r.model, MISTRAL); assert.equal(r.source, 'member_element');
  assert.deepEqual(r.stale.map((s) => s.model), [RETIRED]);
  assert.equal(r.notice, `A model retired · Using ${modelById(MISTRAL)!.name}`);
  // An element pick of a real model the element does not offer is stale too.
  const wrong = resolveElementModel({ element: 'title', rows: [row('deck', '1', 'title', SCHNELL)], deck: '1', member: '2', planRank: 0, env: {} });
  assert.equal(wrong.source, 'default'); assert.equal(wrong.stale.length, 1); assert.match(wrong.notice!, /^A model retired · Using /);
});

test('plan_min: a model the plan excludes is skipped and kept, never cleared; the partner gate makes it stale', () => {
  const rows = [row('member', '2', 'illustration', KLEIN4)];
  const free = resolveElementModel({ element: 'illustration', rows, deck: '1', member: '2', planRank: 0, env: { AI_PARTNER_MODELS: 'on' } });
  assert.equal(free.model, SCHNELL); assert.deepEqual(free.stale, []);
  assert.deepEqual(free.plan_blocked, [{ level: 'member_element', model: KLEIN4, plan: 'Paid plans' }]);
  const paid = resolveElementModel({ element: 'illustration', rows, deck: '1', member: '2', planRank: 1, env: { AI_PARTNER_MODELS: 'on' } });
  assert.equal(paid.model, KLEIN4);
  const gated = resolveElementModel({ element: 'illustration', rows, deck: '1', member: '2', planRank: 2, env: {} });
  assert.equal(gated.model, SCHNELL); assert.equal(gated.stale.length, 1, 'not offered while the partner gate is shut');
  // A row's own plan_min holds even for a model every plan runs.
  const strict = resolveElementModel({ element: 'body', rows: [{ ...row('deck', '1', 'body', MISTRAL), plan_min: 'top_paid' }], deck: '1', member: '2', planRank: 1, env: {} });
  assert.equal(strict.source, 'default');
  // An element no plan can run reads none, never a guess.
  assert.equal(resolveElementModel({ element: 'edit_vary', rows: [], deck: '1', member: '2', planRank: 0, env: { AI_PARTNER_MODELS: 'on' } }).source, 'none');
});

test('lockFor: HQ\'s lock on an element, its group, or any element of a group key', () => {
  const rows = [row('org', 'hq', 'group:images', SCHNELL, 1), row('org', 'hq', 'chart', LLAMA, 1), row('org', 'hq', 'title', LLAMA, 0)];
  assert.ok(lockFor(rows, 'photo'));
  assert.ok(lockFor(rows, 'group:images'));
  assert.ok(lockFor(rows, 'group:data'), 'a lock on chart locks its group');
  assert.equal(lockFor(rows, 'title'), null, 'a default is not a lock');
  assert.equal(lockFor(rows, 'body'), null);
});

// ─────────────────────────────────────────────────────────── output rules

test('"$2.4M" in an input is refused for every element, and placed as fact by none', () => {
  // Mutations checked: outputProblems not testing words for a figure → the words assert fails;
  // not testing a value's binding → the unbound-value assert fails.
  assert.deepEqual(Object.keys(OUTPUT_RULES), [...ROUTED_ELEMENTS], 'every routed element has rules');
  const binding = { grade: 'Recorded', snapshot_hash: 'synthetic-hash' };
  for (const id of ROUTED_ELEMENTS) {
    const r = inputRefusal(id, 'Say we raised $2.4M last quarter', 1);
    assert.equal(r?.code, 'figure_in_prompt', `${id}: the prompt is refused`);
    assert.ok(r!.figure, `${id}: the refusal names the figure`);
    assert.equal(inputRefusal(id, 'Lead with the team, keep it warm', 1), null, `${id}: words with no figure pass`);
    assert.ok(outputProblems(id, [{ text: 'We raised $2.4M from synthetic investors' }]).length > 0, `${id}: a figure in the model's words`);
    assert.ok(outputProblems(id, [{ value: 2400000, binding: null }]).length > 0, `${id}: a value with no record`);
    assert.deepEqual(outputProblems(id, [{ text: 'One ledger, closed by Tuesday.' }]), [], `${id}: plain words pass`);
    const boundValue = outputProblems(id, [{ value: 2400000, binding }]);
    if (OUTPUT_RULES[id].figures === 'records_only') assert.deepEqual(boundValue, [], `${id}: a recorded value is placed`);
    else assert.ok(boundValue.length > 0, `${id}: a picture places no figure`);
  }
  assert.ok(outputProblems('bullets', Array.from({ length: 7 }, () => ({ text: 'A point' }))).length > 0, 'at most six bullets');
  assert.deepEqual(outputProblems('metric', []), ['metric runs no model']);
});

// ─────────────────────────────────────────────────────────── size, estimate, time

test('estimateDeck equals its quote lines: each line is the element\'s model at sizeFor, the total their sum; unpriced is null, never 0', () => {
  // Mutation checked: estimateDeck adding the free line\'s count to the total → the sum assert fails.
  const counts = { title: 12, body: 12, photo: 3, chart: 2, metric: 4 };
  const models = { title: LLAMA, body: MISTRAL, photo: SCHNELL, chart: LLAMA };
  const e = estimateDeck(counts, models, 1.25);
  assert.equal(e.lines.length, 5);
  for (const l of e.lines) {
    if (l.free) { assert.equal(l.element, 'metric'); assert.equal(l.microusd, 0); continue; }
    assert.equal(l.per_microusd, billedMicro(l.model!, sizeFor(l.element, l.model!)!, 1.25), l.element);
    assert.equal(l.microusd, l.per_microusd! * l.count);
  }
  assert.equal(e.total_microusd, e.lines.reduce((s, l) => s + l.microusd!, 0));
  assert.ok(e.total_microusd! > 0);
  const unpriced = estimateDeck({ body: 1 }, { body: RETIRED }, 1.25);
  assert.equal(unpriced.lines[0].microusd, null); assert.equal(unpriced.total_microusd, null);
  assert.deepEqual(sizeFor('title', LLAMA), { tokens_in: 600, tokens_out: 80 });
  assert.deepEqual(sizeFor('photo', SCHNELL), { tiles: 4, steps: 4 });
  assert.equal(sizeFor('metric', LLAMA), null);
  assert.equal(expected_ms('title'), 8000);
  assert.equal(expected_ms('photo'), 60000 + 3 * 8000, 'the draw and its three checks');
  assert.equal(expected_ms('metric'), null);
  assert.equal(FREE_LINE, 'No model · free');
});

// ─────────────────────────────────────────────────────────── the rail matrix

test('grid:<element> rail rows: one per routed element, at most three models, the rest in more; no kind is added and the page list is unchanged', () => {
  assert.equal(CANVAS_RAIL_KINDS.length, 14);
  assert.equal(RAIL_KINDS.length, 21, 'the canvas\'s fourteen and #3934\'s seven, as before');
  const rows = gridOptionRows();
  assert.deepEqual(rows.map((r) => r.optionKey), ROUTED_ELEMENTS.map((id) => `grid:${id}`));
  for (const r of rows) {
    assert.ok(r.models.length <= 3, r.optionKey);
    assert.ok((RAIL_KINDS as readonly string[]).includes(r.kind), `${r.optionKey}: ${r.kind}`);
    assert.deepEqual(resolveRailOption(PAGE, r.optionKey)?.models.map((m) => m.id), r.models.map((m) => m.id), `${r.optionKey} is answered on the deck page`);
    assert.deepEqual([...r.models, ...r.more].map((m) => m.id), ids(r.optionKey.slice(5)));
  }
  assert.equal(resolveRailOption('Founder · Build', 'grid:title'), null, 'only on the Pitch deck page');
  assert.equal(railOptionsOn(PAGE).some((o) => o.optionKey.startsWith('grid:')), false, 'the page\'s option list is not changed');
});

test('migration 717: deck_model_picks with its unique key and no CHECK list on key', () => {
  const sql = read('../sql/migrations/717_deck_model_picks.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS deck_model_picks/);
  assert.match(sql, /UNIQUE \(scope, scope_id, key\)/);
  assert.doesNotMatch(sql, /key TEXT NOT NULL CHECK/);
  for (const c of ['scope', 'scope_id', 'key', 'model', 'locked', 'plan_min', 'set_by', 'updated_at']) assert.match(sql, new RegExp(`\\n  ${c} `), c);
});

// ─────────────────────────────────────────────────────────── the routes

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()
  .map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'deck-element-models-d1503-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
schema.exec(baseline); for (const sql of migrations) schema.exec(sql); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = 'synthetic-d1503-only-not-a-real-credential'.repeat(2);

async function fixture(extraEnv: Record<string, unknown> = {}) {
  __resetForTest();
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid, tier] of [[2, 'founder', 100, 'studio'], [3, 'founder', 300, 'free'], [4, 'founder', 400, 'studio'], [6, 'investor', null, 'studio']] as const) {
    insert.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, tier);
  }
  // D1478's plan lock reads a paid plan from the recorded subscription, not the tier column: member 2 pays for theirs.
  db.exec("INSERT INTO member_subscription_amounts(subscription_id,user_id,plan_family,amount_cents,currency,interval,interval_count,status) VALUES ('sub_synthetic_2',2,'founder',7900,'usd','month',1,'active')");
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(3,'Synthetic free venture',300),(4,'Synthetic other venture',400)");
  db.exec("INSERT INTO pitch_decks(id,project_id,version,slides,title,is_current) VALUES (7,1,1,'[]','Synthetic deck',1),(8,3,1,'[]','Synthetic free deck',1)");
  db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)').run();
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,1)').run(key);
  const calls: string[] = [];
  const AI = withGuard({
    run: async (model: string) => { calls.push(model); return { response: JSON.stringify({ cards: [] }), usage: { prompt_tokens: 60, completion_tokens: 40 } }; },
  });
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI, FILES: {}, ...extraEnv };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckElementModels).route('/api/decks', deckNew).route('/api/decks', deckImages).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const picks = () => db.prepare('SELECT scope, scope_id, key, model, locked, plan_min, set_by FROM deck_model_picks ORDER BY id').all().map((r) => ({ ...r })) as any[];
  return { db, env, app, calls: () => calls.filter((m) => m !== GUARD_MODEL), picks, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, method: string, path: string, json?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, ...(json === undefined ? {} : { body: JSON.stringify(json) }) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
const URL7 = '/api/decks/7/element-models';

test('GET: per element { suggested ≤ 3, more, pick } in #3741\'s shape, groups for the rail, and the free elements', async () => {
  const f = await fixture();
  try {
    const r = await call(f, 2, 'GET', URL7);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.deck_id, 7); assert.equal(r.body.project_id, 1); assert.equal(r.body.plan_rank, 2);
    assert.deepEqual(r.body.elements.map((e: any) => e.element), [...ROUTED_ELEMENTS]);
    for (const e of r.body.elements) {
      assert.ok(e.suggested.length <= 3, e.element);
      assert.deepEqual(e.suggested.map((m: any) => m.id), choicesFor(e.element).suggested.map((m) => m.id));
      assert.equal(e.more.some((m: any) => e.suggested.some((s: any) => s.id === m.id)), false, `${e.element}: more repeats a suggestion`);
      for (const m of [...e.suggested, ...e.more]) assert.deepEqual(Object.keys(m).filter((k) => !['role'].includes(k)).sort(), ['id', 'line', 'lock', 'name', 'plan_locked', 'price'].sort());
      if (e.resolved.model) assert.equal(e.per_run_microusd, estimateDeck({ [e.element]: 1 }, { [e.element]: e.resolved.model }, 1.25).lines[0].per_microusd, `${e.element}: the quote line`);
    }
    const body = r.body.elements.find((e: any) => e.element === 'body');
    assert.equal(body.pick, null); assert.deepEqual(body.resolved, { model: LLAMA, name: body.resolved.name, source: 'default', locked: false, notice: null });
    assert.deepEqual(r.body.groups.map((g: any) => g.group), ['text', 'images', 'graphics', 'data', 'diagrams', 'venture', 'media']);
    const graphics = r.body.groups.find((g: any) => g.group === 'graphics');
    assert.equal(graphics.free, FREE_LINE); assert.deepEqual(graphics.suggested, []);
    assert.ok(r.body.free.some((x: any) => x.element === 'metric' && x.line === FREE_LINE));
    // Who: another venture's founder is refused; an investor cannot find it.
    assert.equal((await call(f, 4, 'GET', URL7)).status, 403);
    assert.ok([403, 404].includes((await call(f, 6, 'GET', URL7)).status));
    assert.equal((await call(f, 2, 'GET', '/api/decks/999/element-models')).status, 404);
  } finally { f.close(); }
});

test('PUT: a deck pick and a member pick are stored and read back; null clears; a bad key or model is refused, nothing written', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, 2, 'PUT', URL7, { scope: 'deck', key: 'body', model: MISTRAL })).status, 200);
    assert.equal((await call(f, 2, 'PUT', URL7, { scope: 'member', key: 'group:text', model: GLM })).status, 200);
    assert.deepEqual(f.picks(), [
      { scope: 'deck', scope_id: '1', key: 'body', model: MISTRAL, locked: 0, plan_min: 'all', set_by: 2 },
      { scope: 'member', scope_id: '2', key: 'group:text', model: GLM, locked: 0, plan_min: 'all', set_by: 2 },
    ]);
    const r = (await call(f, 2, 'GET', URL7)).body;
    const el = (id: string) => r.elements.find((e: any) => e.element === id);
    assert.equal(el('body').pick, MISTRAL); assert.equal(el('body').resolved.source, 'deck_element');
    assert.equal(el('title').pick, GLM); assert.equal(el('title').resolved.source, 'member_group');
    assert.equal(el('photo').pick, null, 'a text group pick is not an image\'s');
    assert.equal((await call(f, 2, 'PUT', URL7, { scope: 'deck', key: 'body', model: null })).status, 200);
    assert.equal(f.picks().length, 1);
    const before = f.picks();
    for (const [bad, code] of [
      [{ scope: 'org', key: 'body', model: MISTRAL }, 'invalid_scope'],
      [{ scope: 'deck', key: 'metric', model: MISTRAL }, 'invalid_key'],
      [{ scope: 'deck', key: 'group:graphics', model: MISTRAL }, 'invalid_key'],
      [{ scope: 'deck', key: 'title', model: SCHNELL }, 'model_not_offered'],
      [{ scope: 'deck', key: 'title', model: RETIRED }, 'model_not_offered'],
    ] as const) {
      const res = await call(f, 2, 'PUT', URL7, bad);
      assert.equal(res.status, 400, JSON.stringify(bad)); assert.equal(res.body.error, code);
    }
    assert.deepEqual(f.picks(), before, 'nothing was written');
    assert.equal((await call(f, 4, 'PUT', URL7, { scope: 'deck', key: 'body', model: MISTRAL })).status, 403, 'another venture');
  } finally { f.close(); }
});

test('PUT: a key HQ locked answers 403 role_locked; a model the plan excludes answers plan_locked', async () => {
  const f = await fixture({ AI_PARTNER_MODELS: 'on' });
  try {
    // Mutation checked: the PUT not asking lockFor → the 403 assert fails (200).
    f.db.prepare("INSERT INTO deck_model_picks(scope,scope_id,key,model,locked,plan_min) VALUES('org','hq','group:images',?,1,'all')").run(SCHNELL);
    for (const key of ['photo', 'illustration', 'group:images']) {
      const res = await call(f, 2, 'PUT', URL7, { scope: 'deck', key, model: KLEIN4 });
      assert.equal(res.status, 403, key); assert.equal(res.body.error, 'role_locked');
      assert.match(res.body.message, /Set by Axal VC HQ/);
    }
    const r = (await call(f, 2, 'GET', URL7)).body;
    const photo = r.elements.find((e: any) => e.element === 'photo');
    assert.deepEqual([photo.resolved.model, photo.resolved.source, photo.resolved.locked], [SCHNELL, 'org_lock', true]);
    assert.equal((await call(f, 2, 'PUT', URL7, { scope: 'deck', key: 'title', model: MISTRAL })).status, 200, 'another group is not locked');
    f.db.exec("DELETE FROM deck_model_picks WHERE scope = 'org'");
    const free = await call(f, 3, 'PUT', '/api/decks/8/element-models', { scope: 'member', key: 'photo', model: KLEIN4 });
    assert.equal(free.status, 403); assert.equal(free.body.error, 'plan_locked'); assert.equal(free.body.plan, 'Paid plans');
    const freeRead = (await call(f, 3, 'GET', '/api/decks/8/element-models')).body;
    const klein = freeRead.elements.find((e: any) => e.element === 'photo').more.find((m: any) => m.id === KLEIN4);
    assert.deepEqual([klein.lock, klein.plan_locked], ['Paid plans', true], 'locked with its plan name');
  } finally { f.close(); }
});

test('GET clears a stale pick and says which model is used instead', async () => {
  const f = await fixture();
  try {
    f.db.prepare("INSERT INTO deck_model_picks(scope,scope_id,key,model,locked) VALUES('deck','1','body',?,0)").run(RETIRED);
    f.db.prepare("INSERT INTO deck_model_picks(scope,scope_id,key,model,locked) VALUES('org','hq','title',?,0)").run(RETIRED);
    const r = (await call(f, 2, 'GET', URL7)).body;
    const body = r.elements.find((e: any) => e.element === 'body');
    assert.equal(body.pick, null);
    assert.equal(body.resolved.notice, `A model retired · Using ${body.resolved.name}`);
    assert.deepEqual(f.picks().map((p) => [p.scope, p.key]), [['org', 'title']], 'the deck\'s stale row is cleared; HQ\'s is HQ\'s to change');
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── generation (dk-auto amendment 10)

test('the one-click build runs the words on the per-element pick, and the quote prices that model', async () => {
  // Mutation checked: /generate not passing the resolved model (ignoring the pick) → the call assert fails (llama).
  const f = await fixture();
  try {
    const before = await call(f, 2, 'POST', '/api/decks/generate', { project_id: 1 });
    assert.equal(before.status, 201, JSON.stringify(before.body));
    assert.deepEqual(f.calls(), [LLAMA], 'no pick: the row default');
    assert.equal(before.body.element_models.body.source, 'default');
    assert.equal((await call(f, 2, 'PUT', URL7, { scope: 'deck', key: 'body', model: MISTRAL })).status, 200);
    const quote = await call(f, 2, 'POST', '/api/decks/new/quote', { project_id: 1, step: 'build', audience: 'seed_fund' });
    assert.equal(quote.status, 200, JSON.stringify(quote.body)); assert.equal(quote.body.model, MISTRAL);
    const built = await call(f, 2, 'POST', '/api/decks/generate', { project_id: 1 });
    assert.equal(built.status, 201, JSON.stringify(built.body));
    assert.deepEqual(f.calls(), [LLAMA, MISTRAL], 'the deck\'s Body pick');
    assert.deepEqual(built.body.element_models.body, { model: MISTRAL, source: 'deck_element', notice: null });
    // The member's group pick applies when the deck has none.
    assert.equal((await call(f, 2, 'PUT', URL7, { scope: 'deck', key: 'body', model: null })).status, 200);
    assert.equal((await call(f, 2, 'PUT', URL7, { scope: 'member', key: 'group:text', model: GLM })).status, 200);
    assert.equal((await call(f, 2, 'POST', '/api/decks/generate', { project_id: 1 })).status, 201);
    assert.equal(f.calls().at(-1), GLM);
  } finally { f.close(); }
});

test('the deck\'s image runs on its element\'s pick: a scene as Generated photo, any other style as Illustration', async () => {
  const f = await fixture({ AI_PARTNER_MODELS: 'on' });
  try {
    const ask = (style: string) => ({ use: 'content', description: 'A synthetic ledger on a desk', style, palette: 'brand', aspect: '16:9', count: 1 });
    const q0 = await call(f, 2, 'POST', '/api/decks/7/images/quote', ask('flat'));
    assert.equal(q0.status, 200, JSON.stringify(q0.body)); assert.equal(q0.body.model, SCHNELL);
    assert.equal((await call(f, 2, 'PUT', URL7, { scope: 'deck', key: 'illustration', model: KLEIN4 })).status, 200);
    assert.equal((await call(f, 2, 'POST', '/api/decks/7/images/quote', ask('flat'))).body.model, KLEIN4);
    assert.equal((await call(f, 2, 'POST', '/api/decks/7/images/quote', ask('scene'))).body.model, SCHNELL, 'a photo keeps its own');
    const fig = await call(f, 2, 'POST', '/api/decks/7/images/quote', { ...ask('flat'), description: 'A banner that says $2.4M raised' });
    assert.equal(fig.status, 422); assert.equal(fig.body.error, 'figure_in_prompt');
  } finally { f.close(); }
});
