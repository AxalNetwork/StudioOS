/**
 * #4603 part 2b (D4603) — Product roadmap pages its items in SQL, and its
 * card, facts and the overview's Shipped figure read aggregates, not item rows.
 *
 * Through `routes/cycle_build.ts` over the real migrated schema (`_build_reads.ts`):
 *   1. the SQL page answers exactly what the in-memory path (`pageBuildRows`
 *      over every item) answers, for a grid of searches, filters, sorts and
 *      pages, on items covering every column value the key reads (the four,
 *      mixed case, unknown, empty, non-ASCII), free-text themes and KPIs, a PostHog KPI
 *      and equal sort orders; and the Theme and KPI filters offer the same
 *      options on both paths;
 *   2. the card and facts are what the reader computed from every item and
 *      move row before this change (the old algorithm, kept here as the
 *      reference), with repeated, future and another venture's moves;
 *   3. at 1,000 items the default page reads 25 item rows and the overview
 *      none, and no PostHog read; a search still answers, in memory;
 *   4. zero shipped stays 0, no items stays Not recorded, and an unreadable
 *      Roadmap read is Unreadable on its own (the other cards read);
 *   5. access is unchanged on the SQL-paged path;
 *   6. #5067's two ceilings on the item's record page are unchanged and named:
 *      20 feedback rows (newest first) and 200 dependency choices.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_roadmap_reads_4603.test.ts
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { buildReads, PROJECT } from './_build_reads.ts';
import { d1Over } from './_d1_sqlite.mjs';
import build, { roadmapItemRows } from '../src/routes/cycle_build.ts';
import cycleRecords from '../src/routes/cycle_records.ts';
import { ROADMAP_DEPENDENCY_CHOICES, ROADMAP_FEEDBACK_SHOWN } from '../src/services/records/build.ts';
import { pageBuildRows } from '../src/services/buildCycleRecords.ts';

let varied: Awaited<ReturnType<typeof buildReads>>;
let large: Awaited<ReturnType<typeof buildReads>>;

// 'ÉTÉ' lowercases in JavaScript but not in SQLite's ASCII-only LOWER: a filter value outside the four must page in memory.
const COLUMNS = ['now', 'next', 'later', 'done', 'Now', 'NEXT', 'archived', '', 'ÉTÉ'];
const THEMES = [null, 'Onboarding', 'Billing', 'onboarding', 'Équipe theme', 'a:b'];
const KPIS = [null, 'custom-x', 'posthog-abc', 'custom-y', 'posthog-zzz'];
const thisMonth = new Date().toISOString().slice(0, 7);

before(async () => {
  varied = await buildReads(0);
  const db = varied.db;
  const okr = db.prepare(`INSERT INTO roadmap_okrs(project_id, objective, kanban_status, sort_order, feedback_theme, kpi_key, owner_user_id, target_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  for (let i = 1; i <= 80; i += 1) {
    okr.run(PROJECT, `Synthetic item ${i}`, COLUMNS[i % COLUMNS.length], i % 6 === 0 ? 0 : i % 9, THEMES[i % 6], KPIS[i % 5], [null, 1, 2][i % 3], i % 4 === 0 ? null : `2027-0${1 + (i % 9)}-1${i % 10}`);
  }
  // A tracked PostHog metric: `posthog-abc` reads its name, not the "no longer tracked" fallback.
  db.exec(`INSERT INTO posthog_tracked_metrics (uid, integration_id, project_id, insight_short_id, insight_name, role, module, unit, created_by)
    VALUES ('abc', 1, ${PROJECT}, 'ins-synthetic', 'Synthetic activation', 'activation', 'experiments', 'count', 1)`);
  // Another venture's item, and its move: neither counts here.
  db.exec(`INSERT INTO roadmap_okrs(id, project_id, objective, kanban_status) VALUES (900, 999, 'Another venture item', 'done')`);
  const move = db.prepare(`INSERT INTO okr_column_moves(project_id, okr_id, to_status, moved_at, week_start) VALUES (?, ?, ?, ?, '2026-01-05')`);
  for (let i = 1; i <= 40; i += 1) move.run(PROJECT, i, 'done', `2026-0${1 + (i % 4)}-0${1 + (i % 7)} 10:00:00`);
  move.run(PROJECT, 1, 'done', '2026-02-20 10:00:00'); // item 1 again: counted once in its month
  move.run(PROJECT, 2, 'next', '2026-02-20 10:00:00'); // not a move to Done
  move.run(PROJECT, 3, 'done', '2099-01-01 10:00:00'); // in the future
  move.run(PROJECT, 4, 'done', `${thisMonth}-01 00:00:01`); // this month: shipped_this_month
  move.run(999, 900, 'done', '2026-02-02 10:00:00');
  large = await buildReads(1000);
});
after(() => { varied?.close(); large?.close(); });

const page = (h: typeof varied, query = '', user = 1) => h.get(`/api/cycles/build/modules/product-roadmap?project=${PROJECT}${query}`, user);
const ORDERS = { column: ['now', 'next', 'later', 'done'] };
const optionsOf = (body: any, key: string) => body.records.filters.find((f: any) => f.key === key).options;

test('1. the SQL page answers exactly what the in-memory path answers, and offers the same filters', async () => {
  // Mutation checked: ties broken by id alone (not sort_order, id) → the read-order ties differ;
  // the column filter on the stored value (not LOWER) → `column:now` misses "Now";
  // any column value let into SQL (not only the four) → `column:été` misses "ÉTÉ";
  // the rank on LOWER(kanban_status) → "Now" ranks with "now" and the sorts differ.
  const all = await roadmapItemRows({ DB: d1Over(varied.db) } as any, PROJECT);
  assert.equal(all.length, 80);
  const sorts = ['', 'column', '-column', 'item', '-date', 'theme', 'bogus'];
  const filters = ['', 'column:now', 'column:NEXT', 'column:later', 'column:done', 'column:archived', 'column:été', 'column:', 'column:now,column:next',
    'theme:onboarding', 'kpi:custom-x', 'column:now,theme:billing', 'nocolon', ':empty'];
  const searches = ['', 'item 1', 'onboarding', 'posthog'];
  const pages = ['', '2', '3', '0', 'abc'];
  let checked = 0;
  for (const sort of sorts) for (const filter of filters) for (const q of searches) for (const p of pages) {
    if (q && p && p !== '2') continue; // keep the grid's search arm small
    const query = { q: q || undefined, filter: filter || undefined, sort: sort || undefined, page: p || undefined };
    const params = Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => `&${k}=${encodeURIComponent(v!)}`).join('');
    const r = await page(varied, params);
    assert.equal(r.status, 200, params);
    const expected = pageBuildRows(all, query, 25, { orders: ORDERS, defaultSort: 'column' });
    const { rows, total, page: at, page_size } = r.body.records;
    assert.deepEqual({ rows, total, page: at, page_size }, expected, params);
    checked += 1;
  }
  assert.ok(checked > 300, `${checked} queries compared`);
  // Mutation checked: the options built from the SQL page's rows (not every item) → a Later-only page offers fewer themes.
  const sqlPath = await page(varied, '&filter=column%3Alater'), memoryPath = await page(varied, '&q=synthetic');
  assert.ok(sqlPath.log.some((s) => /^SELECT 'theme' AS key/.test(s.sql)), 'the filtered page is the SQL path');
  for (const key of ['theme', 'kpi']) assert.deepEqual(optionsOf(sqlPath.body, key), optionsOf(memoryPath.body, key), key);
  assert.deepEqual(optionsOf(sqlPath.body, 'theme').map((o: any) => o.value), ['Billing', 'Onboarding', 'onboarding', 'Équipe theme']);
  assert.deepEqual(optionsOf(sqlPath.body, 'kpi').map((o: any) => o.value), ['custom-x', 'custom-y', 'posthog-abc', 'posthog-zzz']);
  // Mutation checked: the SQL page not reading PostHog → `posthog-abc` reads the fallback, not the tracked metric's name.
  const words = (await page(varied)).body.records.rows.map((r: any) => String(r.cells.moves ?? ''));
  assert.ok(words.some((w: string) => w.startsWith('Synthetic activation')), 'a tracked PostHog KPI reads its name');
  assert.ok(words.some((w: string) => w.includes('PostHog metric · Not recorded')), 'an untracked one reads why it has none');
  assert.ok(!words.some((w: string) => w.includes('posthog-')), 'never its key');
  const empty = await page(varied, '&page=9');
  assert.deepEqual([empty.body.records.rows, empty.body.records.total], [[], 80]);
});

/** The card and facts as the reader computed them before #4603 part 2b, from every item and move row. */
function referenceCard(items: any[], moves: any[]) {
  const buckets = ['now', 'next', 'later', 'done'].map(s => items.filter(i => i.kanban_status === s).length);
  const months = new Map<string, Set<number>>();
  for (const m of moves) {
    const month = String(m.moved_at).slice(0, 7);
    if (!months.has(month)) months.set(month, new Set());
    months.get(month)!.add(Number(m.okr_id ?? 0));
  }
  const trend = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const series: any[] = items.length ? [{ kind: 'stack', rows: ['Now', 'Next', 'Later', 'Done'].map((label, n) => ({ label, parts: [buckets[n]] })), tones: ['v1'] }] : [];
  if (trend.length) series.push({ kind: 'vbars', values: trend.map(([, ids]) => ids.size), labels: trend.map(([month], at) => ({ at, label: month })) });
  return { series, next: items.length && items.find(i => i.kanban_status === 'next') ? 'Move the next planned item into Now' : null,
    facts: { items: items.length, shipped_this_month: months.get(thisMonth)?.size ?? 0 } };
}

test('2. the card and facts are what the old full read computed', async () => {
  // Mutation checked: COUNT(okr_id) for COUNT(DISTINCT okr_id) → item 1's second move counts twice;
  // the months without the future-date guard → 2099 appears; buckets compared case-blind → "Now" counts as now.
  for (const h of [varied, large]) {
    const items = h.db.prepare('SELECT * FROM roadmap_okrs WHERE project_id = ? ORDER BY sort_order, id').all(PROJECT) as any[];
    const moves = h.db.prepare(`SELECT m.okr_id, m.moved_at FROM okr_column_moves m JOIN roadmap_okrs o ON o.id = m.okr_id AND o.project_id = m.project_id
      WHERE m.project_id = ? AND m.to_status = 'done' AND datetime(m.moved_at) <= datetime('now') ORDER BY m.moved_at`).all(PROJECT) as any[];
    const want = referenceCard(items, moves);
    const r = await page(h);
    assert.deepEqual(r.body.card.series, want.series);
    assert.equal(r.body.card.next?.text ?? null, want.next);
    assert.deepEqual(r.body.facts, want.facts);
  }
  assert.equal((await page(varied)).body.facts.shipped_this_month, 1, 'the fixture ships one item this month');
});

test('3. at 1,000 items the page reads 25 item rows and the overview none; a search still answers', async () => {
  // Mutation checked: the module page reading with no query → every item is read again;
  // the overview reading rows → its item rows are listed (and PostHog would be read).
  const listed = (log: Array<{ sql: string; rows: number }>) => log.filter((s) => /o\.feature_id, u\.name AS owner/.test(s.sql)).reduce((t, s) => t + s.rows, 0);
  const r = await page(large);
  assert.equal(r.body.records.rows.length, 25);
  assert.equal(r.body.records.total, 1000);
  assert.ok(listed(r.log) <= 25, `${listed(r.log)} item rows returned to the Worker`);
  const o = await large.get(`/api/cycles/build/overview?project=${PROJECT}`);
  assert.equal(o.status, 200);
  assert.equal(listed(o.log), 0, 'the overview lists no item');
  const roadmapRows = o.log.filter((s) => /FROM (roadmap_okrs WHERE project_id = \? GROUP BY|okr_column_moves)/.test(s.sql)).reduce((t, s) => t + s.rows, 0);
  assert.ok(roadmapRows <= 20, `${roadmapRows} rows for the card: one per column value and one per month`);
  const v = await varied.get(`/api/cycles/build/overview?project=${PROJECT}`);
  assert.deepEqual(v.log.filter((s) => /posthog_/.test(s.sql)).map((s) => s.sql), [], 'the overview reads no PostHog store');
  assert.equal(v.body.figures[2].value, 1);
  const searched = await page(large, '&q=objective%20999');
  assert.deepEqual(searched.body.records.rows.map((x: any) => x.cells.item), ['Synthetic objective 999']);
});

test('3b. the page reads PostHog exactly when an item names a PostHog KPI, as before; the overview never does', async () => {
  // Mutation checked: the flag as `LIKE 'posthog-%'` (case-blind) → "POSTHOG-x" reads PostHog; the flag dropped → no read at all.
  const h = await buildReads(0);
  try {
    const reads = (r: { log: Array<{ sql: string }> }) => r.log.some((s) => /posthog_tracked_metrics/.test(s.sql));
    h.db.exec(`INSERT INTO roadmap_okrs(project_id, objective, kanban_status, kpi_key) VALUES (${PROJECT}, 'Synthetic upper', 'now', 'POSTHOG-x'), (${PROJECT}, 'Synthetic custom', 'next', 'custom-x')`);
    assert.equal(reads(await page(h)), false, 'no item names a PostHog KPI (the prefix is case-sensitive)');
    h.db.exec(`INSERT INTO roadmap_okrs(project_id, objective, kanban_status, kpi_key) VALUES (${PROJECT}, 'Synthetic tracked', 'later', 'posthog-abc')`);
    assert.equal(reads(await page(h)), true, 'an item names one: the SQL page reads PostHog');
    assert.equal(reads(await page(h, '&q=synthetic')), true, 'and so does the in-memory path');
    assert.equal(reads(await h.get(`/api/cycles/build/overview?project=${PROJECT}`)), false, 'the overview never does');
  } finally { h.close(); }
});

test('4. zero shipped stays 0, no items stays Not recorded, and an unreadable read is isolated', async () => {
  const h = await buildReads(0);
  try {
    const overview = () => h.get(`/api/cycles/build/overview?project=${PROJECT}`);
    let o = await overview();
    assert.deepEqual([o.body.figures[2].state, o.body.figures[2].value], ['not_recorded', null], 'no items');
    h.db.exec(`INSERT INTO roadmap_okrs(project_id, objective, kanban_status) VALUES (${PROJECT}, 'Synthetic open item', 'now')`);
    o = await overview();
    assert.deepEqual([o.body.figures[2].state, o.body.figures[2].value], ['ok', 0], 'nothing shipped is a zero');
    assert.equal(o.body.index.find((x: any) => x.key === 'product-roadmap').value, '0');
    // Only Roadmap's shipped-per-month read reads okr_column_moves.moved_at: renaming it breaks that read alone.
    h.db.exec('ALTER TABLE okr_column_moves RENAME COLUMN moved_at TO moved_at_synthetic');
    o = await overview();
    assert.equal(o.status, 200);
    assert.equal(o.body.cards[2].state, 'unreadable');
    assert.equal(o.body.figures[2].state, 'unreadable');
    assert.deepEqual([0, 1, 3, 4, 5].map((i) => o.body.cards[i].state === 'unreadable'), [false, false, false, false, false], 'the other cards still read');
    assert.equal(o.body.index.find((x: any) => x.key === 'product-roadmap').value, 'Unreadable');
    const m = await page(h, '&filter=column%3Anow');
    assert.equal(m.status, 200);
    assert.equal(m.body.card.state, 'unreadable');
    assert.deepEqual([m.body.records.rows, m.body.records.total], [[], 0]);
  } finally { h.close(); }
});

test('5. access is unchanged: another venture\'s founder is refused the paged list', async () => {
  assert.equal((await page(varied, '&filter=column%3Anow&page=2', 2)).status, 403);
  assert.equal((await page(varied, '&q=item', 2)).status, 403);
});

test('6. #5067\'s two record-page ceilings are unchanged, each one named constant', async () => {
  // Mutation checked: either constant set one higher → the 21st feedback row or the 201st choice appears.
  assert.deepEqual([ROADMAP_FEEDBACK_SHOWN, ROADMAP_DEPENDENCY_CHOICES], [20, 200]);
  const h = await buildReads(202); // items 1–202: item 1 has 201 others
  try {
    const fb = h.db.prepare(`INSERT INTO product_feedback (uid, project_id, body, source, from_name, from_email, roadmap_item_ref, status, created_at)
      VALUES (?, ?, ?, 'customer', 'A tester', 'tester@example.invalid', ?, 'open', ?)`);
    for (let i = 1; i <= 21; i += 1) fb.run(`fb-${i}`, PROJECT, `Synthetic note ${i}`, '1', `2026-03-${String(i).padStart(2, '0')} 10:00:00`);
    for (let i = 1; i <= 20; i += 1) fb.run(`fb-two-${i}`, PROJECT, `Synthetic other ${i}`, '2', `2026-03-${String(i).padStart(2, '0')} 10:00:00`);
    const SECRET = 'synthetic-4603-records-only-not-a-real-credential';
    const app = new Hono<any>().route('/api/cycles', cycleRecords).route('/api/cycles/build', build);
    const token = await new SignJWT({ user_id: 1, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const record = async (id: number) => {
      const r = await app.request(`/api/cycles/build/modules/product-roadmap/records/${id}?project=${PROJECT}`, { headers: { Authorization: `Bearer ${token}` } },
        { DB: d1Over(h.db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any);
      assert.equal(r.status, 200);
      return await r.json() as any;
    };
    const one = await record(1), two = await record(2);
    const feedbackRows = (b: any) => [...b.main, ...b.side].find((s: any) => s.key === 'feedback').rows;
    const quoted = (b: any) => feedbackRows(b).filter((r: any) => r.a !== 'View all feedback').map((r: any) => r.a);
    // 21 notes: the newest 20 (21 down to 2), then the view-all row; 20 notes: all 20, and no view-all row.
    assert.deepEqual(quoted(one), Array.from({ length: 20 }, (_, i) => `“Synthetic note ${21 - i}”`));
    assert.equal(feedbackRows(one).at(-1).a, 'View all feedback');
    assert.equal(quoted(two).length, 20);
    assert.ok(!feedbackRows(two).some((r: any) => r.a === 'View all feedback'));
    const choices = (b: any) => b.actions.find((a: any) => a.key === 'add-dependency').form.fields.find((f: any) => f.key === 'waits_on_id').options;
    // 201 others: the first 200 in board order (items 2–201); item 202 is not offered.
    assert.equal(choices(one).length, 200);
    assert.deepEqual([choices(one)[0].value, choices(one)[199].value], ['2', '201']);
  } finally { h.close(); }
});
