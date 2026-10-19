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
