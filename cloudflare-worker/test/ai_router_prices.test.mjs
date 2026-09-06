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
  for (const m of body.matchAll(/fallbackChain:\s*\[([^\]]*)\]/g)) {
    for (const name of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
      if (consts.has(name)) models.add(consts.get(name));
      else if (/^'@cf\//.test(name)) models.add(name.slice(1, -1));
    }
  }
  return models;
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
