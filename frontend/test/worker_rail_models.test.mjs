/**
 * The rail's model menu: what may be typed, and what must be derived.
 *
 * `DECISIONS` D13 removed this menu and set the condition for its return — the
 * router must own the list, and `safety` must not be routable off the guard
 * model. The worker side of that is pinned in
 * `cloudflare-worker/test/ai_router_prices.test.mjs`. This file pins the
 * frontend half, which is a different failure: not "the wrong model runs" but
 * "the right model runs and the screen says something else about it".
 *
 * The line the whole file defends:
 *
 *   FACTS ARE DERIVED — which models exist at all, and which one a task runs
 *   by default, come from `GET /api/ai/pricing`, which reads the router's own
 *   tables. Since D698 the rail draws neither an id nor a rate.
 *   COPY IS TYPED — the display name and the sentence are editorial, with
 *   nothing to derive them from, and they live in `ui/railModels.js` and
 *   nowhere else. Which model is the DEFAULT is a fact, and derived (D400).
 *
 * Crossing that line in either direction is a real, shipped failure mode here:
 * the rail quoted `0.50 / 0.50` for a model Cloudflare bills at `0.293 / 2.253`
 * for months, because the number was typed once and never re-checked.
 *
 * Run with:
 *   npx tsx --test frontend/test/worker_rail_models.test.mjs
 * (from the repo root — the paths below are repo-relative)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const RAIL = 'frontend/src/ui/WorkerRail.jsx';
const COPY = 'frontend/src/ui/railModels.js';
const ROUTER = 'cloudflare-worker/src/services/aiRouter.ts';

/** `alternates` per ROUTE task, constants resolved — the router's own list. */
function alternatesByTask() {
  const src = read(ROUTER);
  const consts = new Map(
    [...src.matchAll(/const (SMALL_LLAMA|MID_LLAMA)\s*=\s*'(@cf\/[^']+)'/g)].map((m) => [m[1], m[2]]),
  );
  const body = src.slice(src.indexOf('export const ROUTE'));
  const entries = [...body.matchAll(/^ {2}([a-z_]+):\s*\{/gm)];
  const out = new Map();
  for (let i = 0; i < entries.length; i += 1) {
    const to = i + 1 < entries.length ? entries[i + 1].index : body.length;
    const chunk = body.slice(entries[i].index, to);
    const alt = /alternates:\s*\[([^\]]*)\]/.exec(chunk);
    out.set(entries[i][1], !alt ? [] : alt[1].split(',').map((x) => x.trim()).filter(Boolean)
      .map((n) => (consts.has(n) ? consts.get(n) : n.replace(/^'|'$/g, ''))));
  }
  return out;
}

/** Every model id ROUTE can send work to: primaries, fallbacks and alternates. */
function routeModelIds() {
  const src = read(ROUTER);
  const consts = new Map(
    [...src.matchAll(/const (SMALL_LLAMA|MID_LLAMA)\s*=\s*'(@cf\/[^']+)'/g)].map((m) => [m[1], m[2]]),
  );
  const body = src.slice(src.indexOf('export const ROUTE'));
  const table = body.slice(0, body.indexOf('\n};\n'));
  const ids = new Set([...table.matchAll(/'(@cf\/[^']+)'/g)].map((m) => m[1]));
  for (const name of consts.keys()) if (new RegExp(`\\b${name}\\b`).test(table)) ids.add(consts.get(name));
  return ids;
}

/** Model ids used as keys in `MODEL_COPY`. */
const copiedIds = () => [...read(COPY).matchAll(/'(@cf\/[^']+)':\s*\{/g)].map((m) => m[1]);

test('the copy table prices nothing', () => {
  // The one rule that would have caught the four wrong rates. A price in this
  // file is a price nobody re-checks against Cloudflare, because it does not
  // look like configuration — it looks like a sentence.
  const src = codeOnly(read(COPY));
  assert.doesNotMatch(src, /\$\s*\d/, 'a dollar figure was typed into the copy table');
  assert.doesNotMatch(src, /\/\s*M\s+(in|out)\b/i, 'a per-million rate was typed into the copy table');
  assert.doesNotMatch(src, /\bpin\b|\bpout\b|per M input|per audio minute/i,
    'the copy table is reaching for price fields');
  // A price can also arrive as prose — "costs 0.293 per million" — which none
  // of the three patterns above would catch. Numbers are banned in the two
  // fields that carry sentences, and NOT in `name`, where a decimal is part of
  // the model's name and not a figure: an earlier version of this assertion
  // banned every decimal on a line without an id and duly failed on
  // "Llama 3.3 70B Fast".
  for (const m of src.matchAll(/^\s*(why|tags):\s*(.+)$/gm)) {
    assert.doesNotMatch(m[2], /\d+\.\d+/,
      `a decimal in the ${m[1]} field: "${m[2].trim()}" — every figure must be derived`);
  }
});

test('every model the copy table names is one the router can run, and every such model has a name', () => {
  // Copy for a model the router never runs is dead weight that reads as a
  // promise. And since D698 the catalogue chips are every ROUTE model, so a
  // ROUTE model with no name would draw nothing at all (no chip shows an id).
  const route = routeModelIds();
  assert.ok(route.size >= 8, `the ROUTE models did not parse — got ${[...route].join(', ')}`);
  const ids = copiedIds();
  assert.ok(ids.length >= 3, 'the copy table describes fewer models than the menu shows');
  for (const id of ids) {
    assert.ok(route.has(id), `railModels.js describes ${id}, which no ROUTE entry runs — the rail will never show it`);
  }
  for (const id of route) {
    assert.ok(ids.includes(id), `${id} is a ROUTE model with no name in railModels.js`);
  }
});

test('every model the router offers has copy, or renders on its bare id', () => {
  // The reverse direction is ALLOWED and this test says so rather than
  // banning it: `modelsForTask` falls back to the id's last segment and an
  // empty sentence. Ugly, not wrong — the model is real and the router offers
  // it; the only thing missing is a description someone has yet to write. What
  // must exist is that fallback.
  const hook = codeOnly(read('frontend/src/hooks/useAiSpend.js'));
  assert.match(hook, /name: c\.name \|\| id\.split\('\/'\)\.pop\(\)/,
    'a model with no copy would render a blank name');
  assert.match(hook, /why: c\.why \|\| ''/, 'a model with no copy would render undefined');
});

test('the Default badge is derived from the router, never typed (D400)', () => {
  // It was RECOMMENDED, from a typed `RECOMMENDED_BY_TASK` map whose one entry
  // named `ROUTE.workspace_explain.model` — the router's own primary. So the
  // badge was a hand-typed copy of a router fact. Now `modelsForTask` sets
  // `isDefault` from `route.model` in the same `/api/ai/pricing` response the
  // menu is built from, and the copy table holds no per-task map at all.
  const copy = codeOnly(read(COPY));
  assert.doesNotMatch(copy, /_BY_TASK\b/,
    'railModels.js is deciding which model a task defaults to; that is the router\'s fact');
  const hook = codeOnly(read('frontend/src/hooks/useAiSpend.js'));
  assert.match(hook, /isDefault: id === route\.model/,
    'the default flag is no longer derived from the route\'s own model');
});

test('modelsForTask marks the router\'s primary as Default, and only it', async () => {
  const { modelsForTask } = await import('../src/hooks/useAiSpend.js');
  const pricing = {
    prices: { 'a/big': { in: 1, out: 2 }, 'a/small': { in: 0.1, out: 0.2 }, 'a/tiny': { in: 0.01, out: 0.02 } },
    // The primary is deliberately NOT first in alternates, so a flag that
    // meant "first entry" instead of "the route's model" fails here.
    routes: { t: { model: 'a/small', alternates: ['a/big', 'a/small', 'a/tiny'] } },
  };
  const menu = modelsForTask(pricing, 't', { copy: {} });
  assert.deepEqual(menu.map((m) => [m.id, m.isDefault]),
    [['a/big', false], ['a/small', true], ['a/tiny', false]]);
});

test('the rail types no rate and no model name, and draws no rate at all (D698)', () => {
  const src = codeOnly(read(RAIL));
  assert.doesNotMatch(src, /\$\d|\$\{?\s*\d/, 'a rate was typed into the rail');
  assert.doesNotMatch(src, /Llama|DeepSeek|Whisper|Qwen|Mistral|GPT-OSS|Gemma/i,
    'a model NAME was typed into the rail; names live in railModels.js');
  assert.doesNotMatch(src, /@cf\//, 'a model id was typed into the rail');
  // Ids and rates left the rail (D698 decision 10): no formatter for them.
  assert.doesNotMatch(src, /formatRate\(|priceOfModel\(|rateLine|inlineRate/, 'the rail draws a rate again');
  assert.doesNotMatch(src, /\.toFixed\(/, 'the rail is formatting a figure by hand');
});

// ── The AIRail canvas's cards (D698) ────────────────────────────────────
// `railSuggestions` is pinned page by page in `airail_d698.test.mjs`.

test('the badge says Default, and the rail never says "recommend" (D400)', () => {
  const src = codeOnly(read(RAIL));
  assert.deepEqual([...new Set([...src.matchAll(/\brecommend\w*\b/gi)].map((m) => m[0]))], [],
    'a form of "recommend" is back in the rail');
  const copy = codeOnly(read(COPY));
  assert.match(copy, /const primary = routes\[job\.task\]\.model === id;/,
    'Default is no longer derived from the router\'s own model');
  assert.match(copy, /s\.role === 'Default' && !primary \? null : s\.role/,
    'a canvas "Default" on a model that is not the router\'s primary is drawn');
});

test('the rail draws no estimate and no average (D16, D698)', () => {
  // D16's averages were measured and never modelled; D698 moved them, with
  // the receipts, to `/account/usage`. The rail draws neither.
  const src = codeOnly(read(RAIL));
  assert.doesNotMatch(src, /observedRunCost|≈|No runs yet/, 'an average is drawn on the rail again');
  assert.doesNotMatch(src, /tin:|tout:/, 'a modelled token count reached the rail (D16)');
});

test('a pick is stored per section and per task, the way every other rail preference is', () => {
  const src = codeOnly(read(RAIL));
  assert.doesNotMatch(src, /localStorage\./,
    'localStorage throws outright in some embedded contexts; use safeReadJSON/safeWriteJSON');
  assert.match(src, /for \(const task of tasks\) writeRailModel\(workspace, task, id\);/);
  const store = codeOnly(read('frontend/src/ui/railModelChoice.js'));
  assert.match(store, /safeReadJSON\(railModelKey\(workspace, task\), null\)/);
  assert.match(store, /safeWriteJSON\(railModelKey\(workspace, task\), id \|\| null\)/);
});

test('each section names only work its pages run, on router tasks', () => {
  const copy = codeOnly(read(COPY));
  const alts = alternatesByTask();
  for (const task of [...copy.matchAll(/task: '([a-z_]+)'/g)].map((m) => m[1])) {
    // D698: Grow's Product improvement names D691's task before the router
    // carries it; `railSuggestions` skips a job the pricing read does not list
    // (airail_d698.test.mjs, test 13). No other task may be ahead of the router.
    if (task === 'grow_theme_feedback' && !alts.has(task)) continue;
    assert.ok(alts.has(task), `railModels.js names ${task}, which is not a ROUTE entry`);
  }
  // A job that takes a pick must offer one; a pick with nowhere to go is the
  // dead control D17 refused.
  for (const m of copy.matchAll(/task: '([a-z_]+)',\s*pick: true/g)) {
    if (m[1] === 'grow_theme_feedback' && !alts.has(m[1])) continue;
    assert.ok((alts.get(m[1]) || []).length > 1, `${m[1]} takes a pick and the router offers none`);
  }
});

test('formatRate prints the published figure, not a rounding of it', async () => {
  // Every one of these is a real row from Cloudflare's pricing tables, read
  // 2026-09-06. `formatSpend`'s two decimal places renders the first as $0.29
  // and the audio rate as $0.00, and a rate shown as $0.00 reads as free —
  // which is how this function came to exist and is the mutation that survived
  // its first run, because nothing pinned it.
  const { formatRate } = await import('../src/ui/assistCost.js');
  const PUBLISHED = [
    [0.293, '$0.293'], [2.253, '$2.253'],     // llama-3.3-70b-instruct-fp8-fast
    [0.152, '$0.152'], [0.287, '$0.287'],     // llama-3.1-8b-instruct-fp8
    [0.051, '$0.051'], [0.335, '$0.335'],     // llama-3.2-3b-instruct
    [0.484, '$0.484'], [0.030, '$0.030'],     // llama-guard-3-8b — trailing zero kept
    [1.320, '$1.320'],                        // deepseek-v4-pro — a whole cent, still 3 places
    [0.012, '$0.012'],                        // bge-m3
    [0.0005, '$0.0005'],                      // whisper, per audio minute — four places
  ];
  for (const [value, want] of PUBLISHED) {
    assert.equal(formatRate(value), want, `${value} printed as something other than ${want}`);
  }
  // Absent is absent, and a bad value is not silently a price.
  assert.equal(formatRate(0), '$0.000');
  assert.equal(formatRate(null), '$0.000');
  assert.equal(formatRate(Number.NaN), '$0.000');
});
