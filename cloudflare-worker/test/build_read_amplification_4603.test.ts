/**
 * #4603 (Build audit 4/4, D4603) — the Build overview reads no integration
 * parts, and the module pages still do.
 *
 * Measured through `routes/cycle_build.ts` over the real migrated schema with a
 * synthetic venture at 10 and 1,000 records per list (`_build_reads.ts`):
 *   1. the overview's statement count is its budget at every size, and none
 *      of its statements reads an integration store;
 *   2. each overview card is the card its module page answers, so skipping the
 *      parts changed no card, figure or phone entry built from them;
 *   3. every module page still answers its integration parts;
 *   4. access is unchanged: another venture's founder is refused both;
 *   5. what is left (recorded, not endorsed): rows still grow with the venture
 *      on the overview and on every module page but Solution design's feature list.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_read_amplification_4603.test.ts
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildReads, MODULE_SLUGS, PROJECT } from './_build_reads.ts';

/** Measured on main before #4603: 52 at every size. After: 29. */
const OVERVIEW_STATEMENTS = 29;
/** Integration stores: read by a module page's parts, never by the overview. */
const INTEGRATION = /\b(github_\w+|vercel_\w+|lovable_\w+|solution_design_\w+|roadmap_releases|mvp_release_checks|company_creation_proposals|formation_step_checks|build_handoffs)\b/;
/** Each module page's parts, by key. */
const PARTS: Record<string, string[]> = {
  'solution-design': ['from_code', 'vercel_runtime'],
  'prototype-mvp': ['github', 'lovable', 'vercel'],
  'product-roadmap': ['github', 'vercel'],
  'founding-team': ['github'],
  'company-creation': ['github', 'vercel'],
  'operating-systems': ['tools'],
};

let small: Awaited<ReturnType<typeof buildReads>>;
let large: Awaited<ReturnType<typeof buildReads>>;
before(async () => { small = await buildReads(10); large = await buildReads(1000); });
after(() => { small?.close(); large?.close(); });

const overview = (h: typeof small, user = 1) => h.get(`/api/cycles/build/overview?project=${PROJECT}`, user);
const module = (h: typeof small, slug: string, user = 1) => h.get(`/api/cycles/build/modules/${slug}?project=${PROJECT}`, user);

test('1. the overview runs its budget of statements at every size, and reads no integration store', async () => {
  // Mutation checked: the overview reading with FULL → 52 statements and the integration reads fail;
  // Operating systems' Code read left ungated → its github_* statements fail the integration check.
  for (const h of [small, large]) {
    const r = await overview(h);
    assert.equal(r.status, 200);
    assert.ok(r.statements <= OVERVIEW_STATEMENTS, `${r.statements} statements, budget ${OVERVIEW_STATEMENTS}`);
    assert.deepEqual(r.log.filter((s) => INTEGRATION.test(s.sql)).map((s) => s.sql), []);
  }
});

test('2. each overview card is its module page card: skipping the parts changed no card', async () => {
  // Mutation checked: Operating systems' card built from the hosting read (null in the overview) → its card differs.
  for (const h of [small, large]) {
    const o = await overview(h);
    for (const [i, slug] of MODULE_SLUGS.entries()) {
      const m = await module(h, slug);
      assert.equal(m.status, 200, slug);
      assert.deepEqual(o.body.cards[i], m.body.card, slug);
    }
    assert.equal(o.body.figures.length, 4);
    assert.ok(o.body.focus !== undefined && o.body.index !== undefined, 'the phone parts are still answered');
  }
});

test('3. every module page still answers its integration parts', async () => {
  // Mutation checked: a module page reading with OVERVIEW → its parts are missing.
  for (const slug of MODULE_SLUGS) {
    const m = await module(small, slug);
    assert.deepEqual(Object.keys(m.body.parts ?? {}).sort(), [...PARTS[slug]].sort(), slug);
  }
});

test('4. access is unchanged: another venture\'s founder is refused the overview and every module', async () => {
  assert.equal((await overview(small, 2)).status, 403);
  for (const slug of MODULE_SLUGS) assert.equal((await module(small, slug, 2)).status, 403, slug);
});

test('5. the remaining limit, recorded: rows still grow with the venture (bounded reads are the next part of #4603)', async () => {
  const s = await overview(small), l = await overview(large);
  assert.equal(s.statements, l.statements, 'the statement count does not grow with the venture');
  assert.ok(l.rows > 50 * s.rows / 10, `rows returned grow with the venture: ${s.rows} → ${l.rows}`);
  // Part 2 pages Solution design's features in SQL (build_bounded_reads_4603.test.ts); its risks list
  // (`facts.risks`, D662) is still read whole, and so are the other modules' lists.
  const page = await module(large, 'solution-design');
  assert.equal(page.body.records.rows.length, 25, 'a page shows 25 records');
  assert.ok(page.rows >= 1000 && page.rows < 1100, `the risks list is still read whole: ${page.rows} rows returned to the Worker`);
  const roadmapPage = await module(large, 'product-roadmap');
  assert.ok(roadmapPage.rows >= 1000, `the other modules still read every record: ${roadmapPage.rows} rows returned to the Worker`);
});
