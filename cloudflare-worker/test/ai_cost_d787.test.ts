// D787 (#2212) — `GET /api/ai-budget/cost` and `cost.csv`: a member's own AI
// cost per day and per model, tokens in and out, the other units, cost and
// charged. Real SQLite with migrations 419, 430, 486, 493 and 505
// (`_ai_budget_fixture.mjs`). The service is called with a fixed `now`, so
// each range is exact; the routes are called on rows in the current month.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/ai_cost_d787.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import budgetRoute from '../src/routes/ai_budget.ts';
import { MAX_COST_RUNS, costCsv, costRange, memberCost, modelName, otherUnits } from '../src/services/aiCost.ts';

const ME = 2;
const OTHER = 3;
const LLAMA = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const WHISPER = '@cf/openai/whisper-large-v3-turbo';
const GUARD = '@cf/meta/llama-guard-3-8b';
const NOW = new Date('2026-10-20T12:00:00Z');

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error' }, 500);
  });
  a.route('/api/ai-budget', budgetRoute);
  return a;
}

function world() {
  const f = aiBudgetFixture();
  const env = { DB: f.DB, JWT_SECRET: 'd787-fixture-only-secret', ENVIRONMENT: 'development' } as any;
  const insert = f.db.prepare(`INSERT INTO ai_usage_logs(user_id,task,model,created_at,prompt_tokens,completion_tokens,est_cost_usd,
      charged_microusd,units_json,rail_page,rail_option,refusal,guard_for) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  /** One log row; every field but `at` has a default. */
  const run = (o: { user?: number; model?: string; at: string; in?: number; out?: number; cost?: number; charged?: number | null;
    units?: Record<string, number> | null; page?: string | null; option?: string | null; refusal?: string | null; guardFor?: number | null }) => {
    const r = insert.run(o.user ?? ME, 'paraphrase', o.model ?? LLAMA, o.at, o.in ?? 0, o.out ?? 0, o.cost ?? 0,
      o.charged === undefined ? 0 : o.charged, o.units ? JSON.stringify(o.units) : null, o.page ?? null, o.option ?? null,
      o.refusal ?? null, o.guardFor ?? null);
    return Number(r.lastInsertRowid);
  };
  return { f, env, run };
}

async function call(w: any, path: string, user: number | null) {
  const headers: Record<string, string> = {};
  if (user !== null) {
    const jwt = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(w.env.JWT_SECRET));
    headers.Authorization = `Bearer ${jwt}`;
  }
  const r = await app().request(path, { headers }, w.env);
  const text = await r.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body, type: r.headers.get('content-type'), disposition: r.headers.get('content-disposition') };
}

/** RFC 4180 rows: a quoted cell may hold a comma (a model's name does). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.trimEnd().split('\r\n')) {
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { cells.push(cell); cell = ''; } else cell += ch;
    }
    cells.push(cell);
    rows.push(cells);
  }
  return rows;
}

/** Two models across three days, the case the issue names. */
function twoModels(w: ReturnType<typeof world>) {
  w.run({ at: '2026-10-01 09:00:00', in: 100, out: 40, cost: 0.000123, charged: 154, page: 'Founder · Validate' });
  w.run({ at: '2026-10-01 18:30:00', in: 50, out: 10, cost: 0.0000505, charged: 63, page: 'Founder · Validate' });
  w.run({ at: '2026-10-02 08:00:00', model: WHISPER, cost: 0.001, charged: 1250, units: { audio_minutes: 2.5 },
    page: 'Founder · Validate', option: 'transcribe:interview' });
  w.run({ at: '2026-10-20 11:59:59', in: 300, out: 120, cost: 0.0004, charged: 500, page: 'Founder · Build' });
  w.run({ at: '2026-10-20 11:00:00', model: WHISPER, cost: 0.0004, charged: 500, units: { audio_minutes: 1, tokens_in: 7 },
    page: 'Founder · Validate', option: 'transcribe:interview' });
}

// 1 ───────────────────────────────────────────────────────────────────────────
// Mutations: a day with no runs dropped from `days`; tokens counted in `units`;
// cost summed as floats without rounding; models keyed by day only.
test('two models across three days: every day, the per-day split, the totals, the units and the charges', async () => {
  const w = world();
  twoModels(w);
  const r = await memberCost(w.env, ME, 'mtd', 'model', NOW);
  assert.deepEqual(r.range, { name: 'mtd', from: '2026-10-01', to: '2026-10-20' });
  assert.equal(r.days.length, 20, 'every day in the range, a day with no runs included');
  assert.deepEqual(r.days[2], { day: '2026-10-03', by_model: [] });
  assert.deepEqual(r.days[0], { day: '2026-10-01', by_model: [
    { model: LLAMA, runs: 2, input_tokens: 150, output_tokens: 50, cost_usd: 0.000174, charged_microusd: 217 },
  ] });
  assert.deepEqual(r.days[1].by_model.map((m) => [m.model, m.runs, m.charged_microusd]), [[WHISPER, 1, 1250]]);
  assert.deepEqual(r.days[19].by_model.map((m) => [m.model, m.runs, m.input_tokens, m.charged_microusd]),
    [[LLAMA, 1, 300, 500], [WHISPER, 1, 0, 500]], 'two models on one day, in model order');
  assert.deepEqual(r.totals, {
    runs: 5, input_tokens: 450, output_tokens: 170, cost_usd: 0.001974, charged_microusd: 2467, refused: 0, not_recorded: 0,
    // D805: the same runs by kind; no image or other run, so those lines charge nothing recorded.
    by_kind: {
      tokens: { cost_usd: 0.000574, charged_microusd: 717 }, audio_speech: { cost_usd: 0.0014, charged_microusd: 1750 },
      image: { cost_usd: 0, charged_microusd: null }, other: { cost_usd: 0, charged_microusd: null },
    },
    other_models: [], output_not_recorded: 0,
  });
  const whisper = r.models.find((m) => m.model === WHISPER)!;
  assert.deepEqual(whisper.units, { audio_minutes: 3.5 }, 'units that are not tokens, summed; tokens_in left out');
  assert.equal(whisper.cost_usd, 0.0014);
  assert.equal(whisper.charged_microusd, 1750);
  assert.deepEqual(r.models.find((m) => m.model === LLAMA)!.units, {});
  assert.deepEqual(r.models.map((m) => m.model), [WHISPER, LLAMA], 'the largest cost first');
  assert.equal(whisper.name, modelName(WHISPER));
  assert.ok(whisper.name, 'the Worker sends the catalogue name');
  assert.deepEqual(r.groups.map((g) => [g.key, g.label, g.runs]), [[WHISPER, whisper.name, 2], [LLAMA, modelName(LLAMA), 3]],
    'group=model, the default, lists the models');
  assert.equal(r.truncated, false);
});

// 2 ───────────────────────────────────────────────────────────────────────────
// Mutations: the user_id condition dropped; the user read from the query.
test('another member\'s runs never appear, whatever the query says', async () => {
  const w = world();
  const at = `${new Date().toISOString().slice(0, 10)} 00:00:01`;
  w.run({ at, in: 10, charged: 5 });
  w.run({ user: OTHER, at, in: 999, charged: 999_999 });
  const mine = await call(w, '/api/ai-budget/cost?user_id=3', ME);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.totals.runs, 1);
  assert.equal(mine.body.totals.input_tokens, 10);
  assert.equal(mine.body.totals.charged_microusd, 5);
  const theirs = await memberCost(w.env, OTHER, 'mtd', 'model', new Date());
  assert.equal(theirs.totals.charged_microusd, 999_999);
  assert.equal((await call(w, '/api/ai-budget/cost', null)).status, 401, 'signed in only');
});

// 3 ───────────────────────────────────────────────────────────────────────────
// Mutations: the refusal check removed; a refused row counted as a run too.
test('a refused run counts in refused and in nothing else', async () => {
  const w = world();
  w.run({ at: '2026-10-05 10:00:00', in: 20, out: 5, cost: 0.00002, charged: 25 });
  w.run({ at: '2026-10-05 10:01:00', in: 400, out: 0, cost: 0.5, charged: 0, refusal: 'budget_user_month', page: 'Founder · Raise' });
  const r = await memberCost(w.env, ME, 'mtd', 'page', NOW);
  assert.equal(r.totals.refused, 1);
  assert.deepEqual([r.totals.runs, r.totals.input_tokens, r.totals.cost_usd, r.totals.charged_microusd], [1, 20, 0.00002, 25]);
  assert.deepEqual(r.days[4].by_model.map((m) => m.runs), [1]);
  assert.deepEqual(r.models.map((m) => m.runs), [1]);
  assert.deepEqual(r.groups.map((g) => g.key), [null], 'the refused run\'s page is not a group');
});

// 4 ───────────────────────────────────────────────────────────────────────────
// Mutations: guard rows skipped; guard rows folded into the run's model.
test('a guard run counts under the guard model, and shows as it', async () => {
  const w = world();
  const id = w.run({ at: '2026-10-06 10:00:00', in: 100, out: 30, cost: 0.0001, charged: 125 });
  w.run({ at: '2026-10-06 10:00:00', model: GUARD, in: 120, out: 2, cost: 0.00006, charged: 75, guardFor: id });
  const r = await memberCost(w.env, ME, 'mtd', 'model', NOW);
  const guard = r.models.find((m) => m.model === GUARD)!;
  assert.deepEqual([guard.runs, guard.input_tokens, guard.output_tokens, guard.charged_microusd], [1, 120, 2, 75]);
  assert.equal(guard.name, modelName(GUARD));
  assert.deepEqual(r.models.find((m) => m.model === LLAMA)!.runs, 1);
  assert.equal(r.totals.charged_microusd, 200);
});

// 5 ───────────────────────────────────────────────────────────────────────────
// Mutations: `<=` for the end bound; local time for the bounds; 30d as 31 days.
test('the range boundaries are UTC days, the end exclusive', async () => {
  assert.deepEqual(costRange('mtd', NOW), { from: '2026-10-01', to: '2026-10-20', start: '2026-10-01 00:00:00', end: '2026-10-21 00:00:00' });
  assert.deepEqual(costRange('30d', NOW), { from: '2026-09-21', to: '2026-10-20', start: '2026-09-21 00:00:00', end: '2026-10-21 00:00:00' });
  assert.deepEqual(costRange('prev_month', NOW), { from: '2026-09-01', to: '2026-09-30', start: '2026-09-01 00:00:00', end: '2026-10-01 00:00:00' });
  assert.deepEqual(costRange('prev_month', new Date('2026-01-01T00:00:00Z')).from, '2025-12-01', 'January reaches back a year');
  assert.deepEqual(costRange('mtd', new Date('2026-10-31T23:59:59Z')).to, '2026-10-31');
  const w = world();
  for (const at of ['2026-09-20 23:59:59', '2026-09-21 00:00:00', '2026-09-30 23:59:59', '2026-10-01 00:00:00', '2026-10-20 23:59:59', '2026-10-21 00:00:00']) {
    w.run({ at, charged: 1 });
  }
  const runs = async (range: any) => (await memberCost(w.env, ME, range, 'model', NOW)).totals.runs;
  assert.equal(await runs('mtd'), 2, '10-01 00:00:00 and 10-20 23:59:59');
  assert.equal(await runs('30d'), 4, 'from 09-21 00:00:00');
  assert.equal(await runs('prev_month'), 3, 'September: 09-20, 09-21 and 09-30 23:59:59, not 10-01');
  assert.equal((await memberCost(w.env, ME, '30d', 'model', NOW)).days.length, 30);
});

// 6 ───────────────────────────────────────────────────────────────────────────
// Mutations: a CSV column dropped or reordered; a day with no runs written as a row.
test('the CSV is the JSON\'s days, one row per day and model, and the route serves both', async () => {
  const w = world();
  twoModels(w);
  const r = await memberCost(w.env, ME, 'mtd', 'model', NOW);
  const lines = parseCsv(costCsv(r));
  assert.equal(lines[0].join(','), 'day,model,name,kind,runs,input_tokens,output_tokens,cost_usd,charged_microusd');
  const fromJson = r.days.flatMap((d) => d.by_model.map((m) => [d.day, m.model, m.runs, m.input_tokens, m.output_tokens, m.cost_usd.toFixed(6), m.charged_microusd]));
  assert.equal(lines.length - 1, fromJson.length, 'a row per day and model with a run, no empty days');
  for (const [i, c] of lines.slice(1).entries()) {
    assert.equal(c.length, 9, 'nine cells, a quoted name kept whole');
    assert.equal(c[2], modelName(c[1]) ?? '');
    assert.deepEqual([c[0], c[1], Number(c[4]), Number(c[5]), Number(c[6]), c[7], Number(c[8])], fromJson[i]);
  }
  // Through the route, on today's rows.
  const today = new Date().toISOString().slice(0, 10);
  const x = world();
  x.run({ at: `${today} 01:00:00`, in: 7, out: 3, cost: 0.000001, charged: 2 });
  x.run({ at: `${today} 02:00:00`, model: WHISPER, cost: 0.002, charged: 2500, units: { audio_minutes: 4 } });
  const json = await call(x, '/api/ai-budget/cost?range=30d', ME);
  const csv = await call(x, '/api/ai-budget/cost.csv?range=30d', ME);
  assert.equal(csv.status, 200);
  assert.match(String(csv.type), /^text\/csv/);
  assert.match(String(csv.disposition), /^attachment; filename="ai-cost-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv"$/);
  const rows = parseCsv(String(csv.body)).slice(1);
  const days = json.body.days.flatMap((d: any) => d.by_model.map((m: any) => [d.day, m.model, String(m.charged_microusd)]));
  assert.deepEqual(rows.map((c) => [c[0], c[1], c[8]]), days);
});

// 7 ───────────────────────────────────────────────────────────────────────────
// Mutations: page and option groups keyed alike; a NULL charge read as 0.
test('group=page and group=option, and a charge not recorded is never a zero', async () => {
  const w = world();
  twoModels(w);
  w.run({ at: '2026-10-07 10:00:00', in: 5, charged: null, page: 'Founder · Build' });
  const pages = await memberCost(w.env, ME, 'mtd', 'page', NOW);
  assert.deepEqual(pages.groups.map((g) => [g.key, g.runs, g.charged_microusd]), [['Founder · Validate', 4, 1967], ['Founder · Build', 2, 500]]);
  const options = await memberCost(w.env, ME, 'mtd', 'option', NOW);
  const t = options.groups.find((g: any) => g.key === 'transcribe:interview') as any;
  assert.deepEqual([t.page, t.runs, t.charged_microusd], ['Founder · Validate', 2, 1750]);
  assert.ok(t.label, 'an option carries a label');
  assert.equal(pages.totals.not_recorded, 1);
  const only = world();
  only.run({ at: '2026-10-07 10:00:00', in: 5, charged: null });
  const r = await memberCost(only.env, ME, 'mtd', 'model', NOW);
  assert.equal(r.totals.charged_microusd, null, 'no recorded charge reads null, not 0');
  assert.equal(r.days[6].by_model[0].charged_microusd, null);
});

// 8 ───────────────────────────────────────────────────────────────────────────
// Mutations: the LIMIT removed; truncated set on exactly MAX_COST_RUNS.
test('at most 10,000 runs are read, then truncated', async () => {
  const w = world();
  w.f.db.exec('BEGIN');
  for (let i = 0; i < MAX_COST_RUNS; i += 1) w.run({ at: `2026-10-10 ${String(Math.floor(i / 3600) % 24).padStart(2, '0')}:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`, charged: 1 });
  w.f.db.exec('COMMIT');
  const exact = await memberCost(w.env, ME, 'mtd', 'model', NOW);
  assert.deepEqual([exact.totals.runs, exact.truncated], [MAX_COST_RUNS, false]);
  w.run({ at: '2026-10-11 00:00:00', charged: 1 });
  const over = await memberCost(w.env, ME, 'mtd', 'model', NOW);
  assert.deepEqual([over.totals.runs, over.truncated], [MAX_COST_RUNS, true]);
  assert.equal(over.days[10].by_model[0].runs, 1, 'the newest runs are the ones read');
});

// 9 ───────────────────────────────────────────────────────────────────────────
test('the query, the refusals and the index', async () => {
  const w = world();
  for (const q of ['range=year', 'range=MTD', 'group=record', 'group=']) {
    const r = await call(w, `/api/ai-budget/cost?${q}`, ME);
    assert.equal(r.status, 400, q);
    assert.ok(['invalid_range', 'invalid_group'].includes(r.body.error), q);
  }
  assert.equal((await call(w, '/api/ai-budget/cost.csv?range=year', ME)).status, 400);
  assert.deepEqual(otherUnits('{"tokens_in":5,"tokens_cached":2,"characters":120,"images":0}'), { characters: 120 });
  assert.equal(otherUnits('not json'), null);
  // `idx_ai_usage_user_created` (migration 040) answers the read; no new index is needed.
  const index = /CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created[^;]+;/.exec(readFileSync(new URL('../sql/migrations/040_ai_usage_logs.sql', import.meta.url), 'utf8'))![0];
  w.f.db.exec(index);
  const plan = w.f.db.prepare(`EXPLAIN QUERY PLAN SELECT substr(created_at, 1, 10) AS day, model FROM ai_usage_logs
    WHERE user_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at DESC, id DESC LIMIT ?`).all(ME, 'a', 'b', 1)
    .map((r: any) => r.detail).join(' | ');
  assert.match(plan, /idx_ai_usage_user_created \(user_id=\? AND created_at>\? AND created_at<\?\)/, plan);
});
