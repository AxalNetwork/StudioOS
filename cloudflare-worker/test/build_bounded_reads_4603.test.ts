/**
 * #4603 part 2 (D4603) — Solution design pages its features in SQL, and its
 * card and the phone index read counts, not rows.
 *
 * Through `routes/cycle_build.ts` over the real migrated schema (`_build_reads.ts`):
 *   1. the SQL page answers exactly what the in-memory path (`pageBuildRows`
 *      over every feature) answers, for a grid of searches, filters, sorts and
 *      pages, on features that cover every stored value the keys map
 *      (unknown impact and effort, XL, linked and unlinked, a hypothesis only,
 *      equal sort orders);
 *   2. at 1,000 features the default page reads 25 feature rows, and a
 *      search still answers, from the in-memory path;
 *   3. the overview reads no feature row and no risk row, only their counts,
 *      and its card and phone index are what they were.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_bounded_reads_4603.test.ts
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildReads, PROJECT } from './_build_reads.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { solutionFeatureRows } from '../src/routes/cycle_build.ts';
import { pageBuildRows } from '../src/services/buildCycleRecords.ts';

let varied: Awaited<ReturnType<typeof buildReads>>;
let large: Awaited<ReturnType<typeof buildReads>>;

before(async () => {
  varied = await buildReads(0);
  const db = varied.db;
  db.exec(`INSERT INTO pain_groups(id, project_id, title) VALUES (1, ${PROJECT}, 'Slow onboarding'), (2, ${PROJECT}, 'Billing errors');
    INSERT INTO hypotheses(id, project_id, code, claim) VALUES (1, ${PROJECT}, 'H1', 'Teams pay for faster setup');`);
  const feat = db.prepare('INSERT INTO mvp_features(project_id, title, added_value, effort, sort_order, pain_group_id, hypothesis_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const impacts = ['High', 'Medium', 'Low', '', 'Huge'];
  const efforts = ['S', 'M', 'L', 'XL', '', 'tiny'];
  for (let i = 1; i <= 90; i += 1) {
    const pain = i % 4 === 0 ? 1 : i % 4 === 1 ? 2 : null;
    const hyp = i % 3 === 0 ? 1 : null;
    feat.run(PROJECT, `Synthetic feature ${i}`, impacts[i % 5], efforts[i % 6], i % 7 === 0 ? 0 : i % 10, pain, hyp);
  }
  large = await buildReads(1000);
});
after(() => { varied?.close(); large?.close(); });

const page = (h: typeof varied, query = '') => h.get(`/api/cycles/build/modules/solution-design?project=${PROJECT}${query}`);
const ORDERS = { impact: ['high', 'medium', 'low'], effort: ['low', 'medium', 'high'] };

test('1. the SQL page answers exactly what the in-memory path answers', async () => {
  // Mutation checked: ties broken by id alone (not sort_order, id) → the read-order ties differ;
  // an unknown impact ranked first → the `impact` sorts differ; the filter without COALESCE → `impact:` differs.
  const all = await solutionFeatureRows({ DB: d1Over(varied.db) } as any, PROJECT);
  assert.equal(all.length, 90);
  const sorts = ['', 'impact', '-impact', 'effort', '-effort', 'feature', '-pain_theme', 'bogus'];
  const filters = ['', 'linked:yes', 'linked:no', 'impact:high', 'impact:', 'effort:HIGH', 'impact:low,linked:no', 'feature:synthetic feature 3', 'nocolon', ':empty'];
  const searches = ['', 'feature 1', 'links to', 'TEAMS'];
  const pages = ['', '2', '4', '0', 'abc'];
  let checked = 0;
  for (const sort of sorts) for (const filter of filters) for (const q of searches) for (const p of pages) {
    if (q && p && p !== '2') continue; // keep the grid's search arm small
    const query = { q: q || undefined, filter: filter || undefined, sort: sort || undefined, page: p || undefined };
    const params = Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => `&${k}=${encodeURIComponent(v!)}`).join('');
    const r = await page(varied, params);
    assert.equal(r.status, 200, params);
    const expected = pageBuildRows(all, query, 25, { orders: ORDERS, defaultSort: 'impact' });
    const { rows, total, page: at, page_size } = r.body.records;
    assert.deepEqual({ rows, total, page: at, page_size }, expected, params);
    checked += 1;
  }
  assert.ok(checked > 300, `${checked} queries compared`);
});

test('2. at 1,000 features the default page reads 25 feature rows; a search still answers', async () => {
  // Mutation checked: the module page reading with no query → every feature is read again and this fails.
  const r = await page(large);
  assert.equal(r.body.records.rows.length, 25);
  assert.equal(r.body.records.total, 1000);
  const featureRows = r.log.filter((s) => /pg\.title AS pain_theme/.test(s.sql)).reduce((t, s) => t + s.rows, 0);
  assert.ok(featureRows <= 26, `${featureRows} feature rows returned to the Worker`);
  const searched = await page(large, '&q=feature%20999');
  assert.deepEqual(searched.body.records.rows.map((x: any) => x.cells.feature), ['Synthetic feature 999']);
});

test('3. the overview reads counts, not feature or risk rows, and its card and index are unchanged', async () => {
  // Mutation checked: cycleFocus reading the rows only → the index says no features; the overview reading rows → the row check fails.
  const o = await large.get(`/api/cycles/build/overview?project=${PROJECT}`);
  assert.equal(o.status, 200);
  const listed = o.log.filter((s) => /FROM (mvp_features|venture_risks)/.test(s.sql) && !/COUNT\(\*\)/.test(s.sql));
  assert.deepEqual(listed.filter((s) => /venture_risks|pain_theme/.test(s.sql)).map((s) => s.sql), []);
  const m = await page(large);
  assert.deepEqual(o.body.cards[0], m.body.card, 'the overview card is the module card');
  const row = o.body.index.find((x: any) => x.key === 'solution-design');
  assert.equal(row.detail, '0 features linked to a pain');
});
