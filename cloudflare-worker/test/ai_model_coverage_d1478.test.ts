/**
 * D1478 (#3721) — the Workers AI coverage matrix is generated, committed and
 * held here: the file is `renderCoverage()`, every catalogue model has one row,
 * every cited line names its job, nothing unoffered runs or is offered, and no
 * image generator reaches a module that has no images.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/ai_model_coverage_d1478.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOGUE, isOffered, modelById } from '../src/services/ai/catalogue.ts';
import { MODEL_CONNECTIONS } from '../src/services/ai/moduleConnections.ts';
import { AI_MARKUP, billedMicro } from '../src/services/ai/pricing.ts';
import {
  COVERAGE_MODULES, DECK_V2_ROLES, FITS, FIXED_JOBS, SWITCHES_ALL_ON, coverageCell, moduleOfPage,
  notOfferedReason, optionMismatches, outsideFit, renderCoverage,
} from '../src/services/ai/coverage.ts';
import { ROUTE } from '../src/services/aiRouter.ts';
import { STT_MODELS, isChoosable } from '../src/services/sttModels.ts';

const DOC = new URL('../../documentation/architecture/AI_MODEL_COVERAGE.md', import.meta.url);
const SRC = (rel: string) => new URL(`../src/${rel}`, import.meta.url);
const matrix = JSON.parse(readFileSync(new URL('../src/services/ai/railMatrix.json', import.meta.url), 'utf8'));

test('the committed AI_MODEL_COVERAGE.md is renderCoverage(), exactly', () => {
  assert.equal(readFileSync(DOC, 'utf8'), renderCoverage(),
    'Re-render: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs cloudflare-worker/scripts/render-ai-coverage.mjs');
});

test('every catalogue row has exactly one matrix row, and every cell one of the four states', () => {
  const doc = readFileSync(DOC, 'utf8');
  const table = doc.slice(doc.indexOf('## The matrix'), doc.indexOf('## Where each offered model'));
  for (const m of CATALOGUE) {
    const rows = table.split('\n').filter((l) => l.startsWith(`| \`${m.id}\` |`));
    assert.equal(rows.length, 1, m.id);
    const cells = rows[0].split('|').slice(1, -1).map((c) => c.trim()).slice(6);
    assert.equal(cells.length, COVERAGE_MODULES.length, m.id);
    for (const c of cells) assert.ok(['W', 'O', 'G', '·'].includes(c), `${m.id}: ${c}`);
  }
  assert.equal(table.split('\n').filter((l) => /^\| `@(cf|hf)\//.test(l)).length, CATALOGUE.length);
});

test('every fixed job cites a line that names its router task', () => {
  for (const job of FIXED_JOBS) {
    const [file, line] = job.ref.split(':');
    const text = readFileSync(SRC(file), 'utf8').split('\n')[Number(line) - 1] ?? '';
    assert.ok(text.includes(String(job.task)), `${job.ref} no longer names ${String(job.task)}: ${text.trim()}`);
    assert.ok(ROUTE[job.task], `${String(job.task)} is not a router task`);
  }
});

test('a model that is not offered is n/a everywhere, with its reason', () => {
  for (const m of CATALOGUE) {
    const why = notOfferedReason(m);
    assert.equal(why === null, isOffered(m, SWITCHES_ALL_ON), m.id);
    if (!why) continue;
    for (const { key } of COVERAGE_MODULES) {
      const c = coverageCell(m.id, key);
      assert.equal(c.state, 'n/a', `${m.id} is ${why} and ${c.state} in ${key}`);
      assert.equal(c.reason, why);
    }
  }
  // The 2026-10-31 re-read's preview is held off, and its GA model is on.
  assert.equal(notOfferedReason(modelById('@cf/cloudflare/clairic')!), 'beta');
  assert.equal(notOfferedReason(modelById('@cf/deepseek-ai/deepseek-v4.1-flash-1017')!), null);
});

test('no image generator is anything but n/a in Validate, Record a Session, Network, Research, Email or Calendar', () => {
  const draw = Object.keys(MODEL_CONNECTIONS).filter((id) => MODEL_CONNECTIONS[id].operation === 'draw');
  assert.ok(draw.length >= 6);
  for (const id of draw) {
    for (const key of ['validate', 'record', 'network', 'research', 'email', 'calendar'] as const) {
      assert.equal(coverageCell(id, key).state, 'n/a', `${id} in ${key}`);
    }
  }
  for (const key of ['validate', 'record', 'network', 'research', 'email', 'calendar'] as const) assert.ok(!FITS.draw.includes(key), key);
});

test('every model a job routes to, a page lists or a session can pick is offered', () => {
  const ids = new Set<string>();
  for (const r of Object.values(ROUTE) as Array<{ model: string; fallbackChain?: string[]; alternates?: string[] }>) {
    for (const id of [r.model, ...(r.fallbackChain ?? []), ...(r.alternates ?? [])]) ids.add(id);
  }
  for (const row of [...matrix.rows, ...matrix.options]) for (const m of row.models) ids.add(m.id);
  for (const s of STT_MODELS) if (isChoosable(s.model, s.kind)) ids.add(s.model);
  const unoffered = [...ids].filter((id) => {
    const m = modelById(id);
    return !m || !isOffered(m, SWITCHES_ALL_ON);
  });
  assert.deepEqual(unoffered, []);
});

test('every page belongs to one column, and the fixed jobs land where their module is', () => {
  for (const row of matrix.rows) assert.ok(COVERAGE_MODULES.some((c) => c.key === moduleOfPage(row.pageKey)), row.pageKey);
  assert.equal(moduleOfPage('Admin · Home'), 'admin');
  assert.equal(moduleOfPage('Founder · Studio'), 'studio');
  assert.equal(moduleOfPage('Advisor · Network'), 'network');
  assert.equal(moduleOfPage('Investor · Deals · Pipeline'), 'workspaces');
  assert.equal(coverageCell('@cf/openai/whisper-large-v3-turbo', 'record').state, 'wired');
  assert.equal(coverageCell('@cf/deepgram/nova-3', 'record').state, 'wired');
  assert.equal(coverageCell('@cf/openai/whisper', 'record').state, 'offered');
  assert.equal(coverageCell('@cf/meta/llama-guard-3-8b', 'safety').state, 'wired');
  assert.equal(coverageCell('@cf/black-forest-labs/flux-1-schnell', 'raise').state, 'wired');
  assert.equal(coverageCell('@cf/baai/bge-base-en-v1.5', 'research').state, 'wired');
});

test('the faults Part B fixes are listed, and nothing else is connected outside its fit', () => {
  const m = optionMismatches();
  assert.deepEqual(m.filter((x) => x.optionKey === 'deck:image').map((x) => x.listed.sort()), [[
    '@cf/google/gemma-4-26b-a4b-it', '@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/moondream/moondream3.1-9B-A2B',
  ]]);
  for (const x of m.filter((y) => y.optionKey.startsWith('transcribe:'))) {
    assert.ok(x.listed.includes('@cf/meta/llama-3.3-70b-instruct-fp8-fast'), `${x.pageKey} ${x.optionKey}`);
  }
  assert.deepEqual(outsideFit().map((x) => `${x.id} ${x.module}`), ['@cf/moondream/moondream3.1-9B-A2B grow']);
});

test('the Pitch deck v2 table prints billedMicro for each role, and each role\'s model is offered', () => {
  const doc = readFileSync(DOC, 'utf8');
  for (const r of DECK_V2_ROLES) {
    assert.ok(isOffered(modelById(r.model)!, SWITCHES_ALL_ON), r.model);
    const price = `$${(billedMicro(r.model, r.units, AI_MARKUP) / 1_000_000).toFixed(6)}`;
    const line = doc.split('\n').find((l) => l.startsWith(`| ${r.role} |`));
    assert.ok(line?.includes(`| ${price} |`), `${r.role}: ${price}`);
  }
  // FLUX.1 Schnell at 4 tiles and 4 steps: (4 × 4.80 + 4 × 9.60) neurons × $0.000011 × 1.25, rounded up once.
  assert.equal(billedMicro('@cf/black-forest-labs/flux-1-schnell', { tiles: 4, steps: 4 }, AI_MARKUP), 792);
});
