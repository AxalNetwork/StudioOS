/**
 * #4603 part 2b (D4603) — Prototype / MVP pages its must-haves in SQL, and its
 * card, facts and the overview's figures read aggregates, not must-have rows.
 *
 * Through `routes/cycle_build.ts` over the real migrated schema (`_build_reads.ts`):
 *   1. the SQL page answers exactly what the in-memory path (`pageBuildRows`
 *      over every must-have) answers, for a grid of searches, filters, sorts
 *      and pages, on must-haves covering every stored value the keys map
 *      (each state, Review, an unknown state, a hypothesis whose claim does not
 *      join, no hypothesis, equal sort orders), with non-must-haves beside them;
 *      and the Hypothesis filter offers the same options on both paths;
 *   2. the card and facts are what the reader computed from every feature row
 *      before this change (the old algorithm, kept here as the reference);
 *   3. at 1,000 records the default page reads 25 must-have rows and the
 *      overview reads none, and a search still answers, from the in-memory path;
 *   4. a counted zero stays a zero, no must-haves stays Not recorded, and an
 *      unreadable Prototype read is Unreadable on its own (the other cards read);
 *   5. access is unchanged on the SQL-paged path.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_prototype_reads_4603.test.ts
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildReads, PROJECT } from './_build_reads.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { prototypeMustRows } from '../src/routes/cycle_build.ts';
import { pageBuildRows } from '../src/services/buildCycleRecords.ts';

let varied: Awaited<ReturnType<typeof buildReads>>;
let large: Awaited<ReturnType<typeof buildReads>>;

const STATUSES = ['Backlog', 'In Progress', 'Review', 'Done', 'Blocked', 'Synthetic state'];

before(async () => {
  varied = await buildReads(0);
  const db = varied.db;
  // Hypothesis 3 belongs to another venture: a must-have pointing at it has no claim and reads "none".
  db.exec(`INSERT INTO hypotheses(id, project_id, code, claim) VALUES (1, ${PROJECT}, 'H1', 'Teams pay for faster setup'), (2, ${PROJECT}, 'H2', 'Admins want audit logs'), (3, 999, 'H9', 'Another venture claim');`);
  const feat = db.prepare(`INSERT INTO mvp_features(project_id, title, is_must_have, delivery_status, hypothesis_id, owner_user_id, due_date, sort_order, done_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (let i = 1; i <= 96; i += 1) {
    const status = STATUSES[i % 6];
    // Done must-haves across five months; one not-done row carries a stale done_at, which the burn-up ignores.
    const doneAt = status === 'Done' ? `2026-0${1 + (i % 5)}-12` : i === 8 ? '2026-08-01' : null;
    feat.run(PROJECT, `Synthetic must ${i}`, [1, 1, 0, null][i % 4] ?? null, status, [null, 1, 2, 3][Math.floor(i / 4) % 4] ?? null, [null, 1, 2][i % 3] ?? null,
      i % 5 === 0 ? null : `2027-0${1 + (i % 9)}-0${1 + (i % 8)}`, i % 9 === 0 ? 0 : i % 11, doneAt);
  }
  large = await buildReads(1000);
});
after(() => { varied?.close(); large?.close(); });

const page = (h: typeof varied, query = '', user = 1) => h.get(`/api/cycles/build/modules/prototype-mvp?project=${PROJECT}${query}`, user);
const ORDERS = { state: ['blocked', 'in_progress', 'not_started', 'done'] };
const hypothesisOptions = (body: any) => body.records.filters.find((f: any) => f.key === 'hypothesis').options;

test('1. the SQL page answers exactly what the in-memory path answers, and offers the same filters', async () => {
  // Mutation checked: ties broken by id alone (not sort_order, id) → the read-order ties differ;
  // the unknown-last term dropped → `state` sorts differ; the filter without COALESCE → `state:` differs;
  // the hypothesis key on hypothesis_id instead of a joined claim → `hypothesis:none` differs;
  // `is_must_have = 1` dropped from the paged read → totals differ.
  const all = await prototypeMustRows({ DB: d1Over(varied.db) } as any, PROJECT);
  assert.equal(all.length, 48);
  const sorts = ['', 'state', '-state', 'must_have', '-due', 'hypothesis', 'bogus'];
  const filters = ['', 'state:blocked', 'state:in_progress', 'state:', 'state:DONE', 'hypothesis:none', 'hypothesis:1', 'hypothesis:2,state:not_started',
    'state:done,hypothesis:3', 'owner:synthetic founder', 'nocolon', ':empty'];
  const searches = ['', 'must 1', 'teams'];
  const pages = ['', '2', '3', '0', 'abc'];
  let checked = 0;
  for (const sort of sorts) for (const filter of filters) for (const q of searches) for (const p of pages) {
    if (q && p && p !== '2') continue; // keep the grid's search arm small
    const query = { q: q || undefined, filter: filter || undefined, sort: sort || undefined, page: p || undefined };
    const params = Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => `&${k}=${encodeURIComponent(v!)}`).join('');
    const r = await page(varied, params);
    assert.equal(r.status, 200, params);
    const expected = pageBuildRows(all, query, 25, { orders: ORDERS, defaultSort: 'state' });
    const { rows, total, page: at, page_size } = r.body.records;
    assert.deepEqual({ rows, total, page: at, page_size }, expected, params);
    checked += 1;
  }
  assert.ok(checked > 300, `${checked} queries compared`);
  // Mutation checked: the options built from the SQL page's rows (not every must-have) → they differ from the in-memory path's.
  const sqlPath = await page(varied, '&page=3'), memoryPath = await page(varied, '&q=synthetic');
  assert.deepEqual(hypothesisOptions(sqlPath.body), hypothesisOptions(memoryPath.body));
  assert.deepEqual(hypothesisOptions(sqlPath.body), [
    { value: '1', label: 'Teams pay for faster setup' }, { value: '2', label: 'Admins want audit logs' }, { value: 'none', label: 'No hypothesis' }]);
  // Past the last page: no rows, the total kept.
  const empty = await page(varied, '&page=9');
  assert.deepEqual([empty.body.records.rows, empty.body.records.total], [[], 48]);
});

/** The card and facts as the reader computed them before #4603 part 2b, from every feature row. */
function referenceCard(features: any[], target: string | null) {
  const must = features.filter(f => Number(f.is_must_have ?? 0) === 1);
  const done = must.filter(f => f.delivery_status === 'Done');
  const history = new Map<string, number>();
  for (const f of done.filter(f => f.done_at)) { const month = String(f.done_at).slice(0, 7); history.set(month, (history.get(month) ?? 0) + 1); }
  const points = [...history.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let cumulative = 0;
  const dated: Array<{ date: string; value: number | null; label: string }> = points.map(([month, n]) => ({ date: `${month}-01`, value: (cumulative += n), label: month }));
  if (target) dated.push({ date: target, value: null, label: 'Ship' });
  dated.sort((a, b) => a.date.localeCompare(b.date));
  const mark = target ? dated.findIndex(point => point.label === 'Ship') : -1;
  const series = points.length >= 3 ? [{ kind: 'line', values: dated.map(point => point.value), target: must.length,
    labels: dated.map((point, at) => ({ at, label: point.label })), ...(mark >= 0 ? { mark, mark_label: `Ship ${target}` } : {}) }] : [];
  const missing = must.find(f => f.delivery_status !== 'Done');
  return { series, state: must.length === 0 ? 'empty' : points.length < 3 ? 'too_little' : 'ok', next: missing ? `Complete ${missing.title}` : null,
    facts: { done: done.length, total: must.length, target_date: target } };
}

test('2. the card and facts are what the old full read computed', async () => {
  // Mutation checked: the history without `delivery_status = 'Done'` → the stale done_at adds a month;
  // `missing` ordered by id alone → the card's next names another must-have.
  for (const h of [varied, large]) {
    const features = h.db.prepare(`SELECT * FROM mvp_features WHERE project_id = ? ORDER BY sort_order, id`).all(PROJECT) as any[];
    const target = (h.db.prepare('SELECT mvp_target_date AS t FROM projects WHERE id = ?').get(PROJECT) as any).t;
    const want = referenceCard(features, target);
    const r = await page(h);
    assert.deepEqual(r.body.card.series, want.series);
    assert.equal(r.body.card.state, want.state);
    assert.equal(r.body.card.next?.text ?? null, want.next);
    assert.deepEqual(r.body.facts, want.facts);
  }
});

test('3. at 1,000 records the page reads 25 must-have rows and the overview none; a search still answers', async () => {
  // Mutation checked: the module page reading with no query → every must-have is read again;
  // the overview reading rows → its must-have rows are listed.
  const listed = (log: Array<{ sql: string; rows: number }>) => log.filter((s) => /u\.name AS owner, h\.claim AS test_hypothesis/.test(s.sql)).reduce((t, s) => t + s.rows, 0);
  const r = await page(large);
  assert.equal(r.body.records.rows.length, 25);
  assert.equal(r.body.records.total, 500);
  assert.ok(listed(r.log) <= 25, `${listed(r.log)} must-have rows returned to the Worker`);
  const o = await large.get(`/api/cycles/build/overview?project=${PROJECT}`);
  assert.equal(o.status, 200);
  assert.equal(listed(o.log), 0, 'the overview lists no must-have');
  const prototypeRows = o.log.filter((s) => /FROM mvp_features WHERE project_id = \? AND is_must_have = 1/.test(s.sql)).reduce((t, s) => t + s.rows, 0);
  assert.ok(prototypeRows <= 13, `${prototypeRows} rows for the card: one count row and one per month`);
  assert.deepEqual(o.body.figures[0].value, [r.body.facts.done, r.body.facts.total]);
  const searched = await page(large, '&q=feature%20999');
  assert.deepEqual(searched.body.records.rows.map((x: any) => x.cells.must_have), ['Synthetic feature 999']);
});

test('4. a counted zero stays zero, none stays Not recorded, and an unreadable read is isolated', async () => {
  const h = await buildReads(0);
  try {
    const overview = () => h.get(`/api/cycles/build/overview?project=${PROJECT}`);
    let o = await overview();
    assert.deepEqual([o.body.figures[0].state, o.body.figures[0].value], ['not_recorded', null], 'no must-haves');
    h.db.exec(`INSERT INTO mvp_features(project_id, title, is_must_have, delivery_status) VALUES (${PROJECT}, 'Synthetic open must', 1, 'Backlog')`);
    o = await overview();
    assert.deepEqual([o.body.figures[0].state, o.body.figures[0].value], ['ok', [0, 1]], 'zero done is a zero');
    assert.equal(o.body.index.find((x: any) => x.key === 'prototype-mvp').value, '0 of 1');
    // Only Prototype's burn-up reads done_at: renaming it breaks that read alone.
    h.db.exec('ALTER TABLE mvp_features RENAME COLUMN done_at TO done_at_synthetic');
    o = await overview();
    assert.equal(o.status, 200);
    assert.equal(o.body.cards[1].state, 'unreadable');
    assert.deepEqual(o.body.figures.slice(0, 2).map((f: any) => f.state), ['unreadable', 'unreadable']);
    assert.notEqual(o.body.cards[0].state, 'unreadable', 'Solution design still reads');
    assert.equal(o.body.index.find((x: any) => x.key === 'prototype-mvp').value, 'Unreadable');
    const m = await page(h, '&sort=-state');
    assert.equal(m.status, 200);
    assert.equal(m.body.card.state, 'unreadable');
    assert.deepEqual([m.body.records.rows, m.body.records.total], [[], 0]);
  } finally { h.close(); }
});

test('5. access is unchanged: another venture\'s founder is refused the paged list', async () => {
  assert.equal((await page(varied, '&filter=state%3Adone&page=2', 2)).status, 403);
  assert.equal((await page(varied, '&q=must', 2)).status, 403);
});
