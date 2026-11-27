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

/**
 * D760 (#2017) — the two price tables are views of the catalogue now, so the
 * prices are read from the module, not from source text: there is no literal
 * left to parse. The ROUTE readers below still read the source.
 */
const router = await import('../src/services/aiRouter.ts');

/** `model → { in, out }` from the token price table. */
function pricesFrom(_src) {
  return new Map(Object.entries(router.PRICE_USD_PER_1M_TOKENS));
}

/** `model → USD per minute` from the per-audio-minute table. */
function audioPricesFrom(_src) {
  return new Map(Object.entries(router.PRICE_USD_PER_AUDIO_MINUTE));
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
// D760 (#2017; S1, 2026-10-19): Workers AI bills NEURONS, at $0.011 per 1,000.
// The pricing page prints the neuron column beside its rounded dollar column,
// and the dollar column is a rounding of neurons × 0.000011. These are the
// neuron figures per 1M tokens as printed (read 2026-10-19), and the price
// each must come to is that product, exactly.
const PUBLISHED_NEURONS = {
  '@cf/meta/llama-guard-3-8b':                { in: 44003, out: 2730,   in_usd: 0.484033, out_usd: 0.03003 },
  '@cf/meta/llama-3.1-8b-instruct':           { in: 25608, out: 75147,  in_usd: 0.281688, out_usd: 0.826617 },
  '@cf/meta/llama-3.1-8b-instruct-fp8':       { in: 13778, out: 26128,  in_usd: 0.151558, out_usd: 0.287408 },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { in: 26668, out: 204805, in_usd: 0.293348, out_usd: 2.252855 },
  '@cf/qwen/qwen2.5-coder-32b-instruct':      { in: 60000, out: 90909,  in_usd: 0.66,     out_usd: 0.999999 },
  '@cf/meta/llama-3.2-3b-instruct':           { in: 4625,  out: 30475,  in_usd: 0.050875, out_usd: 0.335225 },
  // D658: quoted in aiRouter.ts's SMALL_LLAMA note from the same reading.
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast':  { in: 4119,  out: 34868,  in_usd: 0.045309, out_usd: 0.383548 },
  // D658: Cloudflare's model page and pricing table, read 2026-10-09.
  '@cf/deepseek-ai/deepseek-v4-flash-0731':   { in: 40000, out: 120000, in_usd: 0.44,     out_usd: 1.32 },
};

test('every model the router routes to has a price', async () => {
  const src = await source();
  // TWO tables now, and a model priced in either one is priced. Whisper is
  // billed per audio MINUTE and has no token rate anywhere, so a check that
  // only knew the token table would demand a fabricated per-token figure for
  // it — which is the same class of wrong number this file exists to keep out.
  const prices = pricesFrom(src);
  const audio = audioPricesFrom(src);
  // D766: an image model (`brand_logo`) is priced in its own unit by the
  // catalogue; `IMAGE_PRICED_MODELS` names the ones the router prices (D761).
  const images = router.IMAGE_PRICED_MODELS;
  const routed = routedModels(src);
  assert.ok(routed.size >= 4, `only ${routed.size} routed models found — the matcher is not matching`);
  for (const m of routed) {
    assert.ok(prices.has(m) || audio.has(m) || images.has(m),
      `${m} is routed to but is in no price table — its runs would bill as zero and no cap would trip`);
  }
});

test('no model is priced in both tables at once', async () => {
  // A model in both would bill by whichever branch `estimateCostUsd` checks
  // first, and the other figure would sit there looking authoritative. Whichever
  // unit a model is sold in, it has exactly one.
  const src = await source();
  const both = [...audioPricesFrom(src).keys()].filter((m) => pricesFrom(src).has(m));
  assert.deepEqual(both, [], `priced in both tables: ${both.join(', ')}`);
});

test('an audio model is billed by the minute, not by tokens', async () => {
  // The whole reason the second table exists. Whisper reports no tokens at
  // all, so the token path answers 0 for any clip — and a spend cap that
  // counts zero never trips.
  const src = await source();
  const fn = src.slice(src.indexOf('export function estimateCostUsd'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.match(body, /PRICE_USD_PER_AUDIO_MINUTE\[model\]/);
  assert.ok(body.indexOf('PRICE_USD_PER_AUDIO_MINUTE') < body.indexOf('PRICE_USD_PER_1M_TOKENS'),
    'the audio table must be consulted first; a per-minute model has no token rate to find');
  assert.match(body, /audioMinutes/);
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
  for (const [model, want] of Object.entries(PUBLISHED_NEURONS)) {
    const got = prices.get(model);
    assert.ok(got, `${model} has no row in the price table`);
    // The figure is neurons × $0.000011, to the last digit, not the rounded dollar column.
    assert.equal(got.in, want.in_usd, `${model} input price is ${got.in}; ${want.in} neurons is ${want.in_usd}`);
    assert.equal(got.out, want.out_usd, `${model} output price is ${got.out}; ${want.out} neurons is ${want.out_usd}`);
    assert.ok(Math.abs(want.in * 0.000011 - want.in_usd) < 1e-12 && Math.abs(want.out * 0.000011 - want.out_usd) < 1e-12, model);
    checked += 1;
  }
  assert.equal(checked, Object.keys(PUBLISHED_NEURONS).length);
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
  // An audio task is priced by the minute (D657 gave `transcribe` a menu), so
  // its alternates are read against the per-minute table.
  const src = await source();
  const prices = pricesFrom(src);
  const audio = audioPricesFrom(src);
  for (const [task, list] of alternatesByTask(src)) {
    for (const model of list) {
      assert.ok(prices.has(model) || audio.has(model), `${task} offers ${model}, which has no price row`);
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
