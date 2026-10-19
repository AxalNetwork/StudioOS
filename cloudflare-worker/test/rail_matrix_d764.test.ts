/**
 * D764 (#2089) PR 1 — the model matrix the Worker ships, generated from the
 * owner's canvas (`design/incoming/airail-every-page-data/canvas.json`).
 *
 * What D720 §5 asks the test to hold:
 *   · the committed `services/ai/railMatrix.json` is the script's output;
 *   · every canvas page has a row, and Admin has its Home;
 *   · every model is one Cloudflare prices (the pricing file, until D760's
 *     catalogue lands) and fits its kind's shape; axal-search takes bge-base;
 *   · one Default per row, at models[0];
 *   · every paid-only default has a non-paid alternative of the same shape;
 *   · the voice rule holds on every role and line;
 *   · every row's routeTask is a ROUTE key, and each rail_<kind> entry names
 *     only its kind's models, priced and named.
 * PR 2: `GET /api/ai/rail` and the per-page pick and switch, on migration
 * 465's table, for the caller only; a stale pick is refused and cleared; the
 * cap is 1,000.
 * No model is called: nothing here reaches `env.AI`.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/rail_matrix_d764.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  OUT, VOICE_BANNED, buildMatrix, readPricing, render,
} from '../../scripts/build-rail-matrix.mjs';
import { PRICE_USD_PER_1M_TOKENS, PRICE_USD_PER_AUDIO_MINUTE, RAIL_KINDS, ROUTE } from '../src/services/aiRouter.ts';
import { MODEL_NAMES, TASK_LABELS } from '../src/services/aiCatalog.ts';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import ai, { RAIL_PREFERENCE_CAP } from '../src/routes/ai.ts';
import { resolveRail } from '../src/services/ai/railMatrix.ts';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const CANVAS = JSON.parse(read('design/incoming/airail-every-page-data/canvas.json'));
const OVERRIDES = JSON.parse(read('scripts/lib/railMatrixOverrides.json'));
const PRICING = readPricing(read('design/incoming/airail-every-page-data/cloudflare-pricing-2026-10-15.md'));
const MATRIX = JSON.parse(read(OUT));
const ROWS: { pageKey: string; kind: string; routeTask: string; models: { id: string; role: string; line: string }[] }[] = MATRIX.rows;
const capsOf = (id: string): string[] =>
  (Object.values(OVERRIDES.models) as { id: string; caps: string[] }[]).find((m) => m.id === id)?.caps ?? [];
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

test('the committed matrix is the script\'s output', () => {
  assert.equal(read(OUT), render(), 'run: node scripts/build-rail-matrix.mjs');
});

test('every canvas page has one row, keyed in the canvas\'s names, and Admin has its Home', () => {
  const expected: string[] = [];
  for (const [profile, sections] of Object.entries(CANVAS.profiles as Record<string, Record<string, string[]>>)) {
    for (const [section, modules] of Object.entries(sections)) {
      expected.push(`${profile} · ${section}`);
      for (const m of modules) expected.push(`${profile} · ${section} · ${m}`);
    }
  }
  assert.equal(expected.length, 204);
  const keys = ROWS.map((r) => r.pageKey);
  assert.equal(new Set(keys).size, keys.length, 'a page key is used twice');
  for (const k of expected) assert.ok(keys.includes(k), `${k} has no row`);
  assert.deepEqual(keys.filter((k) => !expected.includes(k)), ['Admin · Home']);
  assert.ok(keys.includes('Founder · Studio'), 'Founder\'s home is Studio');
  for (const p of ['Investor', 'Advisor', 'Operating Partner']) assert.ok(keys.includes(`${p} · Home`), `${p} · Home`);
  const home = ROWS.find((r) => r.pageKey === 'Investor · Home')!;
  assert.deepEqual(ROWS.find((r) => r.pageKey === 'Admin · Home')!.models, home.models, 'Admin · Home takes a Home row\'s models');
  for (const r of ROWS) {
    const name = r.pageKey.split(' · ').at(-1)!;
    if (r.pageKey !== 'Admin · Home') assert.equal(r.kind, CANVAS.task_kind[name], `${r.pageKey}: its kind is the canvas's`);
    assert.equal(r.routeTask, `rail_${r.kind}`);
  }
});

test('every model is priced, fits its kind, and a search-index kind reads axal-search with bge-base', () => {
  for (const r of ROWS) {
    const shape = OVERRIDES.kinds[r.kind];
    assert.ok(r.models.length > 0, `${r.pageKey}: no models`);
    r.models.forEach((m, i) => {
      assert.match(m.id, /^@cf\//, `${r.pageKey}: a bare @cf id`);
      assert.ok(PRICING.priced.has(m.id), `${r.pageKey}: ${m.id} is not in the pricing file`);
      const caps = capsOf(m.id);
      assert.ok(caps.some((c) => shape.allow.includes(c)), `${r.pageKey}: ${m.id} does not fit ${r.kind}`);
      if (i === 0) assert.ok(caps.includes(shape.defaultNeeds), `${r.pageKey}: the default cannot do ${shape.defaultNeeds}`);
    });
  }
  const kindRow = (k: string) => ROWS.find((r) => r.kind === k)!;
  assert.ok(kindRow('vision').models.every((m) => capsOf(m.id).includes('vision')), 'every vision model reads images');
  assert.ok(capsOf(kindRow('speech').models[0].id).includes('speech'), 'a speech page transcribes first');
  // The search kind indexes the library and research searches it first: both read axal-search.
  assert.deepEqual([...OVERRIDES.searchIndexKinds].sort(), ['research', 'search']);
  for (const k of OVERRIDES.searchIndexKinds) {
    const embeds = kindRow(k).models.filter((m) => capsOf(m.id).includes('embedding')).map((m) => m.id);
    assert.deepEqual(embeds, ['@cf/baai/bge-base-en-v1.5'], `${k}: axal-search is 768-dimensional, so only bge-base`);
  }
  assert.equal(PRICING.paidOnly.size, 7, 'the pricing file\'s paid-only list did not parse');
});

test('one Default per row, at models[0]', () => {
  for (const r of ROWS) {
    assert.equal(r.models[0].role, 'Default', `${r.pageKey}: models[0] says Default`);
    assert.equal(r.models.filter((m) => m.role === 'Default').length, 1, `${r.pageKey}: only one Default`);
  }
});

test('every paid-only default has a non-paid alternative of the same shape', () => {
  let paidDefaults = 0;
  for (const r of ROWS) {
    const def = r.models[0];
    if (!PRICING.paidOnly.has(def.id)) continue;
    paidDefaults++;
    const need = OVERRIDES.kinds[r.kind].defaultNeeds;
    assert.ok(r.models.slice(1).some((m) => !PRICING.paidOnly.has(m.id) && capsOf(m.id).includes(need)),
      `${r.pageKey}: ${def.id} needs a paid plan and has no ${need} alternative`);
  }
  assert.ok(paidDefaults > 0, 'the canvas has paid-only defaults (research, code, numbers, legal); none were read');
});

test('the voice rule holds on every member-visible string', () => {
  for (const r of ROWS) for (const m of r.models) {
    for (const s of [m.role, m.line]) assert.doesNotMatch(s, VOICE_BANNED, `${r.pageKey}: "${s}"`);
  }
  for (const word of ['advice', 'Recommended', 'fiduciary', 'Advisor chat']) assert.match(word, VOICE_BANNED);
});

test('the generator refuses a canvas or override that breaks a rule, and writes nothing', () => {
  const problemsWith = (edit: (c: any, o: any) => void) => {
    const c = clone(CANVAS); const o = clone(OVERRIDES);
    edit(c, o);
    return buildMatrix(c, o, PRICING).problems.join('\n');
  };
  assert.equal(problemsWith(() => {}), '', 'the real inputs are clean');
  assert.match(problemsWith((c) => { c.suggested.chat[0].t = 'Unknown Model 9B'; }), /no id for the canvas model "Unknown Model 9B"/);
  assert.match(problemsWith((_c, o) => { o.models['GLM-4.7 Flash'].id = '@cf/made-up/model'; }), /not in the pricing file/);
  assert.match(problemsWith((c) => { c.suggested.vision[1].t = 'GPT-OSS 20B'; }), /does not fit vision/);
  assert.match(problemsWith((c) => { c.suggested.research.splice(1, 1); }), /paid-only default .*kimi-k2\.6 has no non-paid text alternative/);
  assert.match(problemsWith((c) => { c.suggested.write[1].line = 'Our recommended draft'; }), /breaks the voice rule/);
  assert.match(problemsWith((_c, o) => { o.searchIndexModel = '@cf/baai/bge-m3'; }), /axal-search is 768-dimensional/);
  assert.match(problemsWith((c) => { delete c.task_kind.Verdict; }), /Verdict has no kind/);
  assert.match(problemsWith((_c, o) => { o.pages['Founder · Studio'] = { kind: 'chat' }; }), /is on the canvas; drop its override/);
});

test('each rail_<kind> task is a ROUTE key that names only its kind\'s models, priced and named', () => {
  assert.equal(RAIL_KINDS.length, 14);
  assert.deepEqual([...RAIL_KINDS].sort(), Object.keys(CANVAS.suggested).sort(), 'one task per canvas kind');
  for (const r of ROWS) assert.ok(r.routeTask in ROUTE, `${r.routeTask} is not a ROUTE key`);
  for (const kind of RAIL_KINDS) {
    const entry = (ROUTE as Record<string, any>)[`rail_${kind}`];
    const row = ROWS.find((r) => r.kind === kind)!;
    const ids = row.models.map((m) => m.id);
    const offered = [entry.model, ...(entry.alternates ?? []), ...(entry.fallbackChain ?? [])];
    for (const id of offered) {
      assert.ok(ids.includes(id), `rail_${kind}: ${id} is not one of its kind's models`);
      assert.ok(id in PRICE_USD_PER_1M_TOKENS || id in PRICE_USD_PER_AUDIO_MINUTE, `rail_${kind}: ${id} has no price`);
      assert.ok(MODEL_NAMES[id], `rail_${kind}: ${id} has no name`);
    }
    assert.equal(entry.alternates[0], entry.model, `rail_${kind}: the primary is the first alternate`);
    for (const id of entry.fallbackChain ?? []) assert.ok(!PRICING.paidOnly.has(id), `rail_${kind}: ${id} in the chain needs a paid plan`);
    // The paid-only demotion: a kind with a non-paid model of the primary's shape never routes to a paid one first.
    const needs = kind === 'speech' ? 'speech' : kind === 'vision' ? 'vision' : 'text';
    const free = ids.filter((id) => !PRICING.paidOnly.has(id) && capsOf(id).includes(needs));
    if (free.length) assert.equal(entry.model, free[0], `rail_${kind}: the first model a free plan can run`);
    assert.ok(TASK_LABELS[`rail_${kind}` as keyof typeof TASK_LABELS], `rail_${kind} has a label`);
  }
});

test('the rail_<kind> prices are what Cloudflare bills: each published neuron rate × $0.011 per 1,000', () => {
  // D760 (#2017) prices from the neuron column, not the table's rounded dollars
  // (GLM-4.7 Flash: 5,500 neurons = $0.0605 per 1M input tokens, shown as $0.060).
  const md = read('design/incoming/airail-every-page-data/cloudflare-pricing-2026-10-15.md');
  const usdOf = (neurons: number) => (neurons * 11) / 1_000_000;
  for (const kind of RAIL_KINDS) {
    const entry = (ROUTE as Record<string, any>)[`rail_${kind}`];
    for (const id of [entry.model, ...(entry.alternates ?? [])]) {
      const p = PRICE_USD_PER_1M_TOKENS[id];
      if (!p) continue;
      const line = md.split('\n').find((l) => l.startsWith(`| \`${id}\``))!;
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      const neurons = cells.filter((c) => /^\d+(\.\d+)?$/.test(c)).map(Number);
      assert.ok(Math.abs(p.in - usdOf(neurons[0])) < 1e-9, `${id}: input rate ${p.in} is not ${usdOf(neurons[0])}`);
      if (id !== '@cf/baai/bge-base-en-v1.5') assert.ok(Math.abs(p.out - usdOf(neurons.at(-1)!)) < 1e-9, `${id}: output rate ${p.out} is not ${usdOf(neurons.at(-1)!)}`);
    }
  }
});

// ─────────────────────────────────────────────── PR 2: the read, the pick, the switch

const JWT_SECRET = 'd764-s17-fixture-only-signing-secret-0123456789';
const A = 2, B = 3;
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');

function world(extraEnv: Record<string, unknown> = {}) {
  const { DB, db } = makeD1('PRAGMA foreign_keys=ON;' + stripForeignKeys(tableFromBaseline(BASELINE, 'users')) + ';');
  db.exec(read('cloudflare-worker/sql/migrations/465_ai_rail_preferences.sql'));
  const add = db.prepare('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)');
  add.run(A, 'ana.founder@example.test', 'Ana Founder', 'founder');
  add.run(B, 'ben.founder@example.test', 'Ben Founder', 'founder');
  const env: any = { DB, ENVIRONMENT: 'development', JWT_SECRET, ...extraEnv };
  const prefs = (user: number) => db.prepare(
    'SELECT section, task, model, mode FROM ai_rail_preferences WHERE user_id = ? ORDER BY section, task',
  ).all(user).map((r: any) => ({ ...r }));
  return { env, db, prefs };
}

const app = (() => {
  const a = new Hono();
  a.route('/api/ai', ai as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    if (st) return c.json({ detail: err.message }, st);
    console.error(err);
    return c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function call(env: any, user: number | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (user !== null) {
    const tok = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    headers.Authorization = `Bearer ${tok}`;
  }
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.fetch(new Request(`http://x/api/ai${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const q = (page: string, option?: string) => `/rail?page=${encodeURIComponent(page)}${option ? `&option=${encodeURIComponent(option)}` : ''}`;
const MVP = 'Founder · Build · Prototype / MVP';

test('GET /api/ai/rail answers a page\'s row, named and priced, with no pick, the mode, billing at cost and the guard', async () => {
  const { env } = world();
  const r = await call(env, A, 'GET', q('Founder · Validate'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = resolveRail('Founder · Validate')!;
  assert.equal(r.body.page, 'Founder · Validate');
  assert.deepEqual(r.body.crumbs, ['Founder', 'Validate']);
  assert.equal(r.body.kind, row.kind);
  assert.deepEqual(r.body.models.map((m: any) => [m.id, m.role, m.line]), row.models.map((m) => [m.id, m.role, m.line]));
  for (const m of r.body.models) {
    assert.equal(m.name, MODEL_NAMES[m.id] ?? null);
    const p = PRICE_USD_PER_1M_TOKENS[m.id];
    assert.deepEqual(m.price, p ? { in_per_1m_usd: p.in, out_per_1m_usd: p.out } : (PRICE_USD_PER_AUDIO_MINUTE[m.id] != null ? { per_audio_minute_usd: PRICE_USD_PER_AUDIO_MINUTE[m.id] } : null));
  }
  assert.deepEqual(r.body.options, []);
  assert.equal(r.body.pick, null);
  assert.equal(r.body.mode, null);
  assert.equal(r.body.billing, 'cost');
  assert.deepEqual(r.body.guard, { model: '@cf/meta/llama-guard-3-8b', every_run: true });
  const charged = await call(world({ AI_BILLING: 'charged' }).env, A, 'GET', q('Founder · Validate'));
  assert.equal(charged.body.billing, 'charged');
  const mvp = await call(env, A, 'GET', q(MVP.toLowerCase(), 'draft:build/mvp'));
  assert.equal(mvp.status, 200, 'a key with a slash, in any case');
  assert.deepEqual(mvp.body.crumbs, ['Founder', 'Build', 'Prototype / MVP', 'draft:build/mvp']);
});

test('an unknown page is 404 with its key, a malformed option is 400, and no session is 401', async () => {
  const { env } = world();
  const r = await call(env, A, 'GET', q('Founder · Nowhere'));
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'unknown_page');
  assert.equal(r.body.page, 'Founder · Nowhere');
  assert.equal((await call(env, A, 'GET', '/rail')).status, 404);
  assert.equal((await call(env, A, 'GET', q('Founder · Validate', 'DROP TABLE'))).status, 400);
  assert.equal((await call(env, null, 'GET', q('Founder · Validate'))).status, 401);
  assert.equal((await call(env, A, 'PUT', '/rail/pick', { page: '../etc', model: null })).status, 404);
  assert.equal((await call(env, A, 'PUT', '/rail/mode', { page: 'Founder · Nowhere', mode: 'manual' })).status, 404);
});

test('a pick and the switch round-trip per page and option, for the caller only', async () => {
  const { env, prefs } = world();
  const row = resolveRail(MVP)!;
  const [first, second] = row.models.map((m) => m.id);
  assert.equal((await call(env, A, 'PUT', '/rail/pick', { page: MVP, model: second })).status, 200);
  assert.equal((await call(env, A, 'PUT', '/rail/pick', { page: MVP, option: 'draft:build/mvp', model: first })).status, 200);
  assert.equal((await call(env, A, 'PUT', '/rail/mode', { page: MVP, mode: 'manual' })).status, 200);
  assert.deepEqual(prefs(A), [
    { section: MVP.toLowerCase(), task: '', model: null, mode: 'manual' },
    { section: MVP.toLowerCase(), task: 'draft:build/mvp', model: first, mode: null },
    { section: MVP.toLowerCase(), task: 'page', model: second, mode: null },
  ]);
  let r = await call(env, A, 'GET', q(MVP));
  assert.equal(r.body.pick, second);
  assert.equal(r.body.mode, 'manual');
  r = await call(env, A, 'GET', q(MVP, 'draft:build/mvp'));
  assert.equal(r.body.pick, first, 'an option\'s own pick wins');
  r = await call(env, A, 'GET', q(MVP, 'fill:other'));
  assert.equal(r.body.pick, second, 'an option with no pick takes the page\'s');
  const ben = await call(env, B, 'GET', q(MVP));
  assert.equal(ben.body.pick, null, 'another member\'s read sees none of it');
  assert.equal(ben.body.mode, null);
  assert.equal((await call(env, A, 'PUT', '/rail/pick', { page: MVP, model: null })).status, 200);
  assert.equal((await call(env, A, 'PUT', '/rail/mode', { page: MVP, mode: null })).status, 200);
  assert.deepEqual(prefs(A).map((p: any) => p.task), ['draft:build/mvp'], 'a null clears its row');
});

test('a model the page does not offer is refused, and a stale stored pick is cleared by the read', async () => {
  const { env, db, prefs } = world();
  const bad = await call(env, A, 'PUT', '/rail/pick', { page: 'Founder · Validate', model: '@cf/qwen/qwen2.5-coder-32b-instruct' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'model_not_offered');
  assert.deepEqual(bad.body.models, resolveRail('Founder · Validate')!.models.map((m) => m.id));
  assert.equal((await call(env, A, 'PUT', '/rail/mode', { page: 'Founder · Validate', mode: 'auto' })).status, 400);
  assert.deepEqual(prefs(A), [], 'a refused write stores nothing');
  db.prepare("INSERT INTO ai_rail_preferences (uid, user_id, section, task, model) VALUES ('u1', ?, 'founder · validate', 'page', '@cf/retired/model')").run(A);
  const r = await call(env, A, 'GET', q('Founder · Validate'));
  assert.equal(r.body.pick, null, 'a model the row no longer offers is no pick');
  assert.deepEqual(prefs(A), [], 'and the read cleared it');
});

test('the cap is 1,000 rows a member: a new page pick past it is 409, an existing one still updates', async () => {
  assert.equal(RAIL_PREFERENCE_CAP, 1000);
  const { env, db, prefs } = world();
  const ins = db.prepare("INSERT INTO ai_rail_preferences (uid, user_id, section, task, mode) VALUES (?, ?, ?, '', 'manual')");
  for (let i = 0; i < RAIL_PREFERENCE_CAP - 1; i += 1) ins.run(crypto.randomUUID(), A, `section ${i}`);
  const model = resolveRail(MVP)!.models[0].id;
  assert.equal((await call(env, A, 'PUT', '/rail/pick', { page: MVP, model })).status, 200, 'the 1,000th row lands');
  const full = await call(env, A, 'PUT', '/rail/mode', { page: MVP, mode: 'manual' });
  assert.equal(full.status, 409);
  assert.equal(full.body.error, 'too_many_preferences');
  assert.equal(prefs(A).length, 1000);
  assert.equal((await call(env, A, 'PUT', '/rail/pick', { page: MVP, model: resolveRail(MVP)!.models[1].id })).status, 200, 'an existing key updates');
});
