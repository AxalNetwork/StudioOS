// #3938 part 3 (D1478 task 4) — the plan's two-step match jobs: retrieve, then rank, and no line.
//
//   1. IN10 and GR17 have no write step in the plan: `jobModels` gives no writer, and the
//      default deps never run one, whatever the caller asks.
//   2. With `write: false`, the press ranks and writes nothing: every line is null.
//   3. IN10's query is the firm's own audience fit; a firm that wrote none has nothing to rank.
//   4. The two routes press their own job, on their own page, with `write: false`.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/match_rows_two_step_3938.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultMatchDeps, jobModels, jobWrites, matchRows, type MatchDeps } from '../src/services/ai/matchRows.ts';
import { audienceFitQuery } from '../src/routes/partner_pipeline.ts';

const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('#3938 part 3: IN10 and GR17 retrieve with bge-m3 and have no writer', () => {
  for (const job of ['IN10', 'GR17'] as const) {
    assert.deepEqual(jobModels(job), { retrieve: '@cf/baai/bge-m3', write: null }, job);
    assert.equal(jobWrites(job), false, job);
  }
  for (const job of ['NE1', 'GR4', 'RA11', 'LE10'] as const) assert.equal(jobWrites(job), true, job);
});

test('#3938 part 3: a two-step job never runs a writer, even when asked', async () => {
  // An env whose every binding throws: a writer that ran would reach it.
  const env = new Proxy({}, { get() { throw new Error('a model ran'); } }) as any;
  const d = defaultMatchDeps(env, { userId: 1, surface: '/pipeline/leads', rail: { page: 'Partner · Leads', option: null, record: null } }, 'IN10');
  // Mutation checked: dropping the `!writer` return → the run reaches the env and this rejects.
  assert.equal(await d.write('1. x', 1), null);
});

test('#3938 part 3: write: false ranks and leaves every line null', async () => {
  let wrote = 0;
  const d: MatchDeps = {
    async embed(t) { return [t.includes('design') ? 1 : 0, 1]; },
    async rerank(_q, ctx) { return ctx.map((_, i) => ({ index: ctx.length - 1 - i, score: 1 - i / 10 })); },
    async write() { wrote += 1; return '1. A line.'; },
  };
  const r = await matchRows('design', [{ key: 'a', text: 'design work' }, { key: 'b', text: 'legal work' }], d, { top: 2, write: false });
  assert.equal(wrote, 0, 'no writer ran');
  assert.deepEqual(r.steps, { retrieved: true, ranked: true, written: false });
  assert.deepEqual(r.rows.map((x) => [x.key, x.position, x.line]), [['b', 1, null], ['a', 2, null]], 'the reranker\'s order, no line');
});

test('#3938 part 3 IN10: the query is the firm\'s own audience fit', () => {
  const rules = [
    { kind: 'best_fit', value: 'Seed-stage fintech' },
    { kind: 'sector_declined', value: 'gambling' },
    { kind: 'best_fit', value: '  ' },
  ];
  const offerings = [{ title: 'Design systems' }, { title: '' }];
  assert.equal(audienceFitQuery(rules, offerings, ''), 'Best fit: Seed-stage fintech. Services: Design systems');
  assert.equal(audienceFitQuery(rules, [], 'mobile apps'), 'mobile apps. Best fit: Seed-stage fintech');
  // Mutation checked: counting a declined sector as fit → "gambling" appears and the first assert fails.
  assert.equal(audienceFitQuery([{ kind: 'sector_declined', value: 'gambling' }], [], ''), '', 'nothing written down, nothing to rank against');
});

test('#3938 part 3: each route presses its own job, on its own page, and writes no line', () => {
  const leads = src('../src/routes/partner_pipeline.ts');
  const grow = src('../src/routes/cycle_grow.ts');
  assert.match(leads, /partnerPipeline\.post\('\/leads\/rank'/);
  assert.match(leads, /surface: AI_SURFACE\.partnerLeads, rail, guardText: query \}, 'IN10'\)/);
  assert.match(leads, /matchRows\(query, candidates, deps, \{ top: 10, write: false \}\)/);
  assert.match(leads, /if \(!query\) \{\s*return c\.json\(\{ detail: [^}]+\}, 409\)/, 'no fit, no run');
  assert.match(leads, /\.filter\(\(n: any\) => !scoreLead\(n, ruleRows, offeringRows\)\.excluded_by\)/, 'an excluded lead is never ranked');
  assert.match(grow, /r\.post\('\/partners\/rank'/);
  assert.match(grow, /project\(c, user, b\.project, true\)/, 'a writer on the venture');
  assert.match(grow, /surface: AI_SURFACE\.growPartnerNetwork, rail, guardText: query \}, 'GR17'\)/);
  assert.match(grow, /matchRows\(query, candidates, deps, \{ top: 10, write: false \}\)/);
  assert.match(grow, /g\.stage <> 'ended'/, 'an ended partnership is not ranked');
});
