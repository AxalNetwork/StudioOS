/**
 * #6036 (D6036, BD25) — Product roadmap's board fields, over the real migrated schema (`_build_reads.ts`):
 *
 *   1. each row says its state (okrGraph's), what it waits on, how many it blocks, Late and Unlinked; a blocker
 *      off the page still blocks, a Done blocker does not, a Done item blocks nothing;
 *   2. Late is a readable target day before today that is not Done (today, a later day, Done and an
 *      unreadable date are not Late); Unlinked is no theme and no KPI, blank counting as none;
 *   3. the strip's facts are exact over the whole list (paged at 25 of 60), and the Late and Unlinked filters
 *      page in SQL to exactly those counts, row for row what the in-memory path answers;
 *   4. the module page reads the dependency edges once, the overview not at all;
 *   5. Add item links a feature: the form offers the venture's features, the write stores the one chosen,
 *      and another venture's feature is refused.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_roadmap_board_6036.test.ts
 *
 * Every item, feature and person here is synthetic.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { buildReads, PROJECT } from './_build_reads.ts';
import { d1Over } from './_d1_sqlite.mjs';
import build, { roadmapItemRows } from '../src/routes/cycle_build.ts';
import cycleRecords from '../src/routes/cycle_records.ts';
import { pageBuildRows } from '../src/services/buildCycleRecords.ts';

let h: Awaited<ReturnType<typeof buildReads>>;
// Days relative to today: Late is compared with SQLite's own date('now'), which a mocked JS clock cannot move.
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10); // clock-ok: relative

before(async () => {
  h = await buildReads(0);
  const okr = h.db.prepare(`INSERT INTO roadmap_okrs(id, project_id, objective, kanban_status, sort_order, feedback_theme, kpi_key, target_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  // The named cases (ids 1–9), then filler (ids 10–60) so the default list pages.
  okr.run(1, PROJECT, 'Account setup', 'now', 1, 'Setup takes two days', null, day(30));
  okr.run(2, PROJECT, 'Billing page', 'now', 2, null, 'custom-paid', day(-3)); // late, waits on 1
  okr.run(3, PROJECT, 'Data import', 'next', 3, null, null, day(0)); // today: not late; unlinked
  okr.run(4, PROJECT, 'Signup flow', 'done', 4, '  ', '', day(-40)); // done: never late; blank counts as none → unlinked
  okr.run(5, PROJECT, 'Role templates', 'later', 5, 'Permissions', null, 'soon'); // unreadable date: not late
  okr.run(6, PROJECT, 'SSO', 'later', 6, 'Enterprise asks', null, null); // waits on 4 (done): not blocked
  okr.run(7, PROJECT, 'Team invites', 'NOW', 7, null, 'custom-x', day(-1)); // late (stored case differs)
  okr.run(8, PROJECT, 'Public API', 'later', 8, 'API', null, day(10)); // waits on 60 (off the first page)
  okr.run(9, PROJECT, 'Bulk invite', 'done', 9, 'Invites', null, day(-5)); // done, blocks 1 by its edge: blocks 0
  for (let i = 10; i <= 60; i += 1) okr.run(i, PROJECT, `Synthetic filler ${i}`, ['now', 'next', 'later'][i % 3], 100 + i, i % 2 ? `Theme ${i % 4}` : null, null, i % 5 ? day(20 + i) : day(-(i)));
  // Edges: blocker → blocked.
  const edge = h.db.prepare('INSERT INTO okr_dependencies(project_id, okr_id, blocks_okr_id, created_by) VALUES (?, ?, ?, 1)');
  edge.run(PROJECT, 1, 2); edge.run(PROJECT, 1, 3); edge.run(PROJECT, 4, 6); edge.run(PROJECT, 60, 8); edge.run(PROJECT, 9, 1);
  // Another venture's item and edge: never read here.
  h.db.exec(`INSERT INTO roadmap_okrs(id, project_id, objective, kanban_status) VALUES (900, 999, 'Another venture item', 'now');
    INSERT INTO okr_dependencies(project_id, okr_id, blocks_okr_id, created_by) VALUES (999, 900, 2, 1);`);
});
after(() => h?.close());

const page = (query = '') => h.get(`/api/cycles/build/modules/product-roadmap?project=${PROJECT}${query}`);
const byTitle = (rows: any[], title: string) => rows.find((r) => r.cells.item === title);

test('1. each row says its state, what it waits on, how many it blocks, Late and Unlinked', async () => {
  // Mutation checked: Done blockers counted as unresolved → SSO is Blocked; a Done item's edges counted → Bulk
  // invite blocks 1. Equivalent: dropping the edge read's venture filter (both joins already tie each end to the
  // edge's own venture, and item ids are global).
  const all = await roadmapItemRows({ DB: d1Over(h.db) } as any, PROJECT);
  const keys = (title: string) => byTitle(all, title).keys;
  assert.deepEqual(keys('Billing page'), { column: 'now', theme: null, kpi: 'custom-paid', state: 'blocked', late: 'yes', link: 'linked', blocks: 0, waits_on: 'Account setup' });
  // Account setup waits only on Bulk invite, which is Done: In flight, and it blocks two.
  assert.deepEqual([keys('Account setup').state, keys('Account setup').blocks, keys('Account setup').waits_on], ['in_flight', 2, null]);
  assert.equal(keys('SSO').state, 'provisional', 'its only blocker is Done');
  assert.equal(keys('Public API').state, 'blocked', 'a blocker off the first page still blocks');
  assert.equal(keys('Public API').waits_on, 'Synthetic filler 60');
  assert.equal(keys('Bulk invite').blocks, 0, 'a Done item blocks nothing');
  assert.equal(keys('Signup flow').state, 'done');
  assert.equal(keys('Team invites').state, 'in_flight', 'the stored column decides In flight');
  const billing = byTitle(all, 'Billing page').cells.state;
  assert.deepEqual(billing, { text: 'Blocked · waits on Account setup · Late', tone: 'red' });
  assert.deepEqual(byTitle(all, 'Account setup').cells.state, { text: 'In flight · Blocks 2', tone: 'blue' });
  assert.deepEqual(byTitle(all, 'Team invites').cells.state, { text: 'In flight · Late', tone: 'amber' });
});

test('2. Late and Unlinked follow their one rule', async () => {
  // Mutation checked: `<=` for `<` → Data import (due today) is Late; the Done guard dropped → Signup flow is Late;
  // TRIM dropped from Unlinked → Signup flow's blank theme links it.
  const all = await roadmapItemRows({ DB: d1Over(h.db) } as any, PROJECT);
  const late = (title: string) => byTitle(all, title).keys.late;
  const link = (title: string) => byTitle(all, title).keys.link;
  assert.deepEqual(['Billing page', 'Data import', 'Signup flow', 'Role templates', 'SSO', 'Team invites'].map(late), ['yes', 'no', 'no', 'no', 'no', 'yes']);
  assert.deepEqual(['Account setup', 'Billing page', 'Data import', 'Signup flow'].map(link), ['linked', 'linked', 'unlinked', 'unlinked']);
});

test('3. the facts are exact over the whole list; Late and Unlinked page in SQL to those counts', async () => {
  // Mutation checked: the Late tally read as 0 → the facts disagree with the list; Late left out of the SQL keys →
  // the Late page is paged in memory (no COUNT statement).
  const all = await roadmapItemRows({ DB: d1Over(h.db) } as any, PROJECT);
  const r = await page();
  assert.equal(r.body.records.total, 60);
  assert.equal(r.body.records.rows.length, 25);
  const late = all.filter((x) => x.keys!.late === 'yes').length, unlinked = all.filter((x) => x.keys!.link === 'unlinked').length;
  assert.ok(late >= 10 && unlinked >= 20, `${late} late, ${unlinked} unlinked: past one page`);
  const f = r.body.facts;
  assert.deepEqual({ late: f.late, unlinked: f.unlinked, items: f.items, now: f.now, next: f.next, later: f.later, done: f.done },
    { late, unlinked, items: 60, now: all.filter((x) => x.keys!.column === 'now').length, next: all.filter((x) => x.keys!.column === 'next').length,
      later: all.filter((x) => x.keys!.column === 'later').length, done: 2 });
  const filters = r.body.records.filters;
  assert.deepEqual(filters.find((x: any) => x.key === 'late').options, [{ value: 'yes', label: 'Late', count: late }]);
  assert.deepEqual(filters.find((x: any) => x.key === 'link').options, [{ value: 'unlinked', label: 'Unlinked', count: unlinked }, { value: 'linked', label: 'Linked', count: 60 - unlinked }]);
  for (const filter of ['late:yes', 'link:unlinked', 'link:linked', 'late:no', 'late:yes,column:now']) {
    for (const p of ['1', '2']) {
      const got = await page(`&filter=${encodeURIComponent(filter)}&page=${p}`);
      assert.ok(got.log.some((s) => /^SELECT COUNT\(\*\) AS n FROM roadmap_okrs o/.test(s.sql)), `${filter}: paged in SQL`);
      const want = pageBuildRows(all, { filter, page: p }, 25, { orders: { column: ['now', 'next', 'later', 'done'] }, defaultSort: 'column' });
      const { rows, total, page: at, page_size } = got.body.records;
      assert.deepEqual({ rows, total, page: at, page_size }, want, `${filter} page ${p}`);
    }
  }
  assert.equal((await page('&filter=late%3Ayes')).body.records.total, late);
  assert.equal((await page('&filter=link%3Aunlinked')).body.records.total, unlinked);
});

test('4. the module page reads the edges once; the overview never', async () => {
  // The edge read is the module page's only: one statement whatever the path, none on the overview.
  const edgeReads = (log: Array<{ sql: string }>) => log.filter((s) => /FROM okr_dependencies d/.test(s.sql)).length;
  assert.equal(edgeReads((await page()).log), 1);
  assert.equal(edgeReads((await page('&q=synthetic')).log), 1, 'the in-memory path too');
  assert.equal(edgeReads((await h.get(`/api/cycles/build/overview?project=${PROJECT}`)).log), 0);
});

test('5. Add item links a feature; another venture\'s feature is refused', async () => {
  // Mutation checked: form options without `feature_id` → no Feature choices. The ownership check is the existing route's.
  h.db.exec(`INSERT INTO mvp_features(id, project_id, title, sort_order) VALUES (71, ${PROJECT}, 'Synthetic feature', 1), (72, ${PROJECT}, 'Second feature', 2), (73, 999, 'Not this venture', 1);
    UPDATE users SET subscription_tier = 'growth' WHERE id = 1;`);
  const SECRET = 'synthetic-6036-records-only-not-a-real-credential';
  const app = new Hono<any>().route('/api/cycles', cycleRecords).route('/api/cycles/build', build);
  const token = await new SignJWT({ user_id: 1, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const env = { DB: d1Over(h.db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const call = async (path: string, init: RequestInit = {}) => {
    const r = await app.request(path, { ...init, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, env);
    return { status: r.status, body: await r.json() as any };
  };
  const options = await call(`/api/cycles/build/modules/product-roadmap/form-options?project=${PROJECT}`);
  assert.equal(options.status, 200);
  assert.deepEqual(options.body.feature_id.options, [{ value: '71', label: 'Synthetic feature' }, { value: '72', label: 'Second feature' }]);
  const added = await call(`/api/cycles/build/roadmap?project=${PROJECT}`, { method: 'POST', body: JSON.stringify({ title: 'Synthetic linked item', column: 'next', feature_id: 72 }) });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal((h.db.prepare("SELECT feature_id FROM roadmap_okrs WHERE objective = 'Synthetic linked item'").get() as any)?.feature_id, 72);
  const refused = await call(`/api/cycles/build/roadmap?project=${PROJECT}`, { method: 'POST', body: JSON.stringify({ title: 'Synthetic foreign item', column: 'next', feature_id: 73 }) });
  assert.ok(refused.status >= 400 && refused.status < 500, String(refused.status));
  assert.equal(h.db.prepare("SELECT 1 FROM roadmap_okrs WHERE objective = 'Synthetic foreign item'").get(), undefined);
});
