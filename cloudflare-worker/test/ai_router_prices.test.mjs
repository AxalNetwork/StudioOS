/**
 * The router's model table must name models Cloudflare still serves, at the
 * prices Cloudflare publishes.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT. `ui/WorkerRail.jsx` renders the rate
 * beside the model name — "$0.293 / M in · $2.253 / M out" — so these numbers
 * are shown to a founder deciding whether to run something. They stopped being
 * a budget-accounting detail the day that card shipped, and the table's own
 * comment still said "the exact numbers don't have to be perfect" while the
 * most-used model's output price was understated by 4.5x.
 *
 * Two things are pinned:
 *
 * 1. **Every routed model has a price.** A model in ROUTE with no row in
 *    PRICE_USD_PER_1M_TOKENS bills as zero, and a spend cap that counts zero
 *    never trips.
 * 2. **No routed model is one Cloudflare has deprecated.** The list below is
 *    small and hand-maintained on purpose: an automated check would need a live
 *    call to the models API from CI, and a stale allow-list that fails closed
 *    is better than a network dependency that fails open.
 * 3. **`safety` and `embed` offer no alternates.** This is the whole reason the
 *    rail's model menu could come back at all. DECISIONS D13 removed it because
 *    "a caller must never be able to route a `safety` call away from the guard
 *    model"; the answer is not a check inside `run()` but an EMPTY LIST, and an
 *    empty list is a thing a test can hold shut. If a future edit adds one
 *    here, the guard model becomes optional and this fails.
 *
 * Verified against developers.cloudflare.com/workers-ai/platform/pricing/ on
 * 2026-09-06. When a price moves, move it here in the same commit — the point
 * is not that these numbers are eternal, it is that changing one is deliberate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The router imports a good deal of the worker, so rather than transpile that
 * graph this reads the two exported literals out of the SOURCE. They are plain
 * object literals with no computation in them, which is what makes that sound.
 */
async function source() {
  return readFile(resolve(__dirname, '../src/services/aiRouter.ts'), 'utf8');
}

/** `'@cf/…': { in: N, out: N }` rows from the price table. */
function pricesFrom(src) {
  const start = src.indexOf('export const PRICE_USD_PER_1M_TOKENS');
  assert.ok(start > 0, 'the price table is no longer exported under that name');
  const body = src.slice(start, src.indexOf('};', start));
  const out = new Map();
  for (const m of body.matchAll(/'(@cf\/[^']+)':\s*\{\s*in:\s*([\d.]+),\s*out:\s*([\d.]+)/g)) {
    out.set(m[1], { in: Number(m[2]), out: Number(m[3]) });
  }
  return out;
}

/** Every model string named inside the ROUTE map, constants resolved. */
function routedModels(src) {
  const consts = new Map();
  for (const m of src.matchAll(/const (SMALL_LLAMA|MID_LLAMA)\s*=\s*'(@cf\/[^']+)'/g)) {
    consts.set(m[1], m[2]);
  }
  assert.equal(consts.size, 2, 'SMALL_LLAMA and MID_LLAMA are no longer both declared');
  const start = src.indexOf('export const ROUTE');
  assert.ok(start > 0, 'the ROUTE map is no longer exported under that name');
  const body = src.slice(start);
  const models = new Set(consts.values());
  for (const m of body.matchAll(/model:\s*'(@cf\/[^']+)'/g)) models.add(m[1]);
  // `fallbackChain` is where the router degrades TO; `alternates` is what a
  // person may PICK. Both end up as an `env.AI.run` argument, so both are
  // "routed to" for the purposes of every rule in this file.
  for (const key of ['fallbackChain', 'alternates']) {
    for (const m of body.matchAll(new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`, 'g'))) {
      for (const name of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
        if (consts.has(name)) models.add(consts.get(name));
        else if (/^'@cf\//.test(name)) models.add(name.slice(1, -1));
      }
    }
  }
  return models;
}

/** `task: { … alternates: [ … ] }` per task, constants resolved. */
function alternatesByTask(src) {
  const consts = new Map();
  for (const m of src.matchAll(/const (SMALL_LLAMA|MID_LLAMA)\s*=\s*'(@cf\/[^']+)'/g)) {
    consts.set(m[1], m[2]);
  }
  const body = src.slice(src.indexOf('export const ROUTE'));
  const out = new Map();
  // Each ROUTE entry starts at column 2 with `name:` and runs to the next one.
  const entries = [...body.matchAll(/^ {2}([a-z_]+):\s*\{/gm)];
  for (let i = 0; i < entries.length; i += 1) {
    const from = entries[i].index;
    const to = i + 1 < entries.length ? entries[i + 1].index : body.length;
    const chunk = body.slice(from, to);
    const alt = /alternates:\s*\[([^\]]*)\]/.exec(chunk);
    out.set(entries[i][1], !alt ? [] : alt[1].split(',').map((x) => x.trim()).filter(Boolean)
      .map((name) => (consts.has(name) ? consts.get(name) : name.replace(/^'|'$/g, ''))));
  }
  return out;
}

/**
 * Models Cloudflare has marked Deprecated that this worker has used. Not the
 * whole catalogue — only what we have actually pointed at, so the list stays
 * short enough to keep true.
 */
const DEPRECATED = new Set([
  '@cf/meta/llama-3.1-8b-instruct',      // Deprecated 5/30/2026
  '@cf/meta/llama-3.1-8b-instruct-awq',  // Deprecated 5/30/2026
  '@cf/meta/llama-3-8b-instruct-awq',    // Deprecated 5/30/2026
  '@cf/meta/meta-llama-3-8b-instruct',   // Deprecated
  '@cf/mistral/mistral-7b-instruct-v0.1',
  '@cf/mistral/mistral-7b-instruct-v0.2',
]);

/** Cloudflare's published rates, per 1M tokens, read 2026-09-06. */
const PUBLISHED = {
  '@cf/meta/llama-guard-3-8b':                { in: 0.484, out: 0.030 },
  '@cf/meta/llama-3.1-8b-instruct':           { in: 0.282, out: 0.827 },
  '@cf/meta/llama-3.1-8b-instruct-fp8':       { in: 0.152, out: 0.287 },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { in: 0.293, out: 2.253 },
  '@cf/qwen/qwen2.5-coder-32b-instruct':      { in: 0.660, out: 1.000 },
  '@cf/meta/llama-3.2-3b-instruct':           { in: 0.051, out: 0.335 },
};

test('every model the router routes to has a price', async () => {
  const src = await source();
  const prices = pricesFrom(src);
  const routed = routedModels(src);
  assert.ok(routed.size >= 4, `only ${routed.size} routed models found — the matcher is not matching`);
  for (const m of routed) {
    assert.ok(prices.has(m),
      `${m} is routed to but has no price row — its runs would bill as zero and no cap would trip`);
  }
});

test('the router routes to no deprecated model', async () => {
  const src = await source();
  for (const m of routedModels(src)) {
    assert.ok(!DEPRECATED.has(m),
      `${m} is deprecated by Cloudflare and is still routed to; pick its successor`);
  }
});

test('every price matches what Cloudflare publishes', async () => {
  const prices = pricesFrom(await source());
  let checked = 0;
  for (const [model, want] of Object.entries(PUBLISHED)) {
    const got = prices.get(model);
    assert.ok(got, `${model} has no row in the price table`);
    assert.equal(got.in, want.in, `${model} input price is ${got.in}, Cloudflare publishes ${want.in}`);
    assert.equal(got.out, want.out, `${model} output price is ${got.out}, Cloudflare publishes ${want.out}`);
    checked += 1;
  }
  assert.equal(checked, Object.keys(PUBLISHED).length);
});

test('input and output prices are not assumed symmetric', async () => {
  // The old table set in === out for all four LLMs, which is true of none of
  // them: Llama Guard is 16x dearer to prompt than to answer, and the 70b is
  // 8x the other way. A table that flattens that misprices every task in the
  // direction of the traffic — long prompts, short answers.
  const prices = pricesFrom(await source());
  const asymmetric = [...prices.entries()].filter(([m, p]) => m !== '@cf/baai/bge-base-en-v1.5' && p.in !== p.out);
  assert.ok(asymmetric.length >= 4,
    `only ${asymmetric.length} models have distinct in/out prices — a flat table is the bug this catches`);
});

test('no source file still calls the deprecated 8b model directly', async () => {
  // Twelve call sites named it outside the router — pipeline, legalcap,
  // matches, monitoring, networkfx and the queue worker each ran
  // `env.AI.run('@cf/meta/llama-3.1-8b-instruct', …)`, bypassing ROUTE
  // entirely, so fixing the router alone would have left them on it.
  const roots = ['../src/routes', '../src/services'];
  const offenders = [];
  const walk = (rel) => {
    for (const e of readdirSync(resolve(__dirname, rel), { withFileTypes: true })) {
      if (e.isDirectory()) { walk(join(rel, e.name)); continue; }
      if (!e.name.endsWith('.ts')) continue;
      const p = join(rel, e.name);
      const src = readFileSync(resolve(__dirname, p), 'utf8');
      // The price table keeps a row for it deliberately, for accounting on runs
      // already recorded; what must not come back is a CALL.
      if (/AI\.run\(\s*'@cf\/meta\/llama-3\.1-8b-instruct'/.test(src)) offenders.push(p);
      if (/model:\s*'@cf\/meta\/llama-3\.1-8b-instruct'/.test(src)) offenders.push(p);
    }
  };
  for (const r of roots) walk(r);
  assert.deepEqual(offenders, [], `these still call the deprecated model directly:\n${offenders.join('\n')}`);
});

// ---------------------------------------------------------------------------
// The model menu's safety property, held open as a list rather than a check.
// ---------------------------------------------------------------------------

test('safety and embed offer no alternates at all', async () => {
  const alts = alternatesByTask(await source());
  assert.ok(alts.size >= 10, `only ${alts.size} ROUTE entries parsed — the matcher is not matching`);
  for (const task of ['safety', 'embed']) {
    assert.ok(alts.has(task), `${task} is no longer a ROUTE entry`);
    assert.deepEqual(alts.get(task), [],
      `${task} declares alternates. DECISIONS D13 conditioned the model menu's return on a `
      + `caller never being able to route this task off its model; an empty list is how that is `
      + `kept true, and a non-empty one makes the guard model optional.`);
  }
});

test("a task's alternates begin with its own primary", async () => {
  // The rail sends back whatever it renders selected, and what it renders
  // selected by default is the primary. A list that omits the primary would
  // refuse the default choice — the menu would 503 on first use.
  const src = await source();
  const alts = alternatesByTask(src);
  const consts = new Map(
    [...src.matchAll(/const (SMALL_LLAMA|MID_LLAMA)\s*=\s*'(@cf\/[^']+)'/g)].map((m) => [m[1], m[2]]),
  );
  const body = src.slice(src.indexOf('export const ROUTE'));
  const entries = [...body.matchAll(/^ {2}([a-z_]+):\s*\{/gm)];
  let checked = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const task = entries[i][1];
    const list = alts.get(task) || [];
    if (!list.length) continue;
    const to = i + 1 < entries.length ? entries[i + 1].index : body.length;
    const chunk = body.slice(entries[i].index, to);
    const raw = /model:\s*(?:'(@cf\/[^']+)'|(SMALL_LLAMA|MID_LLAMA))/.exec(chunk);
    const primary = raw[1] || consts.get(raw[2]);
    assert.equal(list[0], primary,
      `${task}'s alternates start with ${list[0]}, not its primary ${primary}`);
    checked += 1;
  }
  assert.ok(checked >= 1, 'no task declares alternates — this test is asserting nothing');
});

test('no alternate is a model the price table cannot price', async () => {
  // Covered transitively by 'every model the router routes to has a price',
  // but stated separately because the failure reads differently: an unpriced
  // FALLBACK bills as zero on a bad day, while an unpriced ALTERNATE is a
  // choice the rail offers and then cannot put a rate beside — and the rail
  // drops a model it cannot price, so the menu would silently lose an entry
  // rather than fail.
  const src = await source();
  const prices = pricesFrom(src);
  for (const [task, list] of alternatesByTask(src)) {
    for (const model of list) {
      assert.ok(prices.has(model), `${task} offers ${model}, which has no price row`);
    }
  }
});

test('the cache key carries the model, so two alternates cannot share a row', async () => {
  // Held at the source because it is not yet reachable at runtime: no task
  // today has both a `cacheTtlSec` and `alternates`, so no two chosen models
  // can collide. The day one grows both — and a cached task with a menu is an
  // obvious thing to want — the failure would be silent and week-long: the
  // second caller served the first's text under their own model's name and
  // rate. `aiRouter.test.mjs` covers the half that IS reachable, a fallback's
  // answer being cached under the primary's name.
  const src = await source();
  const fn = src.slice(src.indexOf('async function cacheKeyFor'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /cacheKeyFor\(opts: RunOptions, model: string\)/,
    'cacheKeyFor no longer takes the model');
  assert.match(body, /return `ai_cache:\$\{opts\.task\}:\$\{model\}:/,
    'the model is no longer a segment of the cache key');
});
