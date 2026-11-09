/**
 * #4603 part 2b (D4603) — the phone index reads Company creation's facts, not
 * its rows, and the overview reads no Company creation record row.
 *
 * Through `routes/cycle_build.ts` over the real migrated schema (`_build_reads.ts`):
 *   1. `facts.filings` and `facts.next_filing_due` are what the module's own
 *      rows give (the count, and the earliest open filing's date), on filings
 *      from every source: dated, undated, done, overdue and due-soon steps, a
 *      Lab order, and open and filed obligations; and the overview's index
 *      says that date;
 *   2. the index's edges: no filing is Not recorded, only filed filings name
 *      no date, filings from obligations alone are counted, and a read with no
 *      facts (an older reader) still falls back to its rows;
 *   3. an unreadable Company creation read is Unreadable on its own;
 *   4. what is not bounded, recorded: the card's timeline draws every step, so
 *      the overview still reads every step.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_company_reads_4603.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReads, seedFilings, PROJECT } from './_build_reads.ts';
import { buildPhone, dayMonth } from '../src/services/cycleFocus.ts';

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const overview = (h: Awaited<ReturnType<typeof buildReads>>) => h.get(`/api/cycles/build/overview?project=${PROJECT}`);
const indexRow = (body: any) => body.index.find((x: any) => x.key === 'company-creation');

/** Every row of the module's list, page by page. */
async function allRows(h: Awaited<ReturnType<typeof buildReads>>) {
  const out: any[] = [];
  for (let page = 1; ; page += 1) {
    const r = await h.get(`/api/cycles/build/modules/company-creation?project=${PROJECT}&page=${page}`);
    out.push(...r.body.records.rows);
    if (out.length >= r.body.records.total) return { rows: out, body: r.body };
  }
}
/** The index's rule over the rows, as cycleFocus applied it before #4603 part 2b. */
const earliestOpen = (rows: any[]) => rows.filter((r) => r.keys?.state !== 'filed' && typeof r.keys?.due === 'string').map((r) => String(r.keys.due)).sort()[0] ?? null;

test('1. the facts are what the rows give, and the overview index says the earliest open filing', async () => {
  // Mutation checked: filed filings counted as open → the filed step's earlier date wins;
  // the latest date, not the earliest → a later date is named; the index ignoring the facts → the overview (no rows) names none.
  const h = await buildReads(60);
  try {
    seedFilings(h.db);
    // A done step dated before everything open: filed, so never the next filing.
    h.db.exec(`INSERT INTO formation_steps(project_id, title, state, sort_order, created_by, due_date) VALUES (${PROJECT}, 'Synthetic filed step', 'done', 0, 1, '${day(-400)}')`);
    const { rows, body } = await allRows(h);
    assert.equal(body.facts.filings, rows.length);
    assert.equal(body.facts.filings, body.records.total);
    const want = earliestOpen(rows);
    assert.ok(want && want > day(-400), `the earliest open filing is ${want}`);
    assert.equal(body.facts.next_filing_due, want);
    // The three Lab steps and three of the four open obligations are listed; the filed obligation is not.
    assert.equal(rows.filter((r) => String(r.id).startsWith('lab-')).length, 3);
    assert.equal(rows.filter((r) => String(r.id).startsWith('obligation-')).length, 3);
    const o = await overview(h);
    assert.equal(indexRow(o.body).detail, `Next filing ${dayMonth(want)}`);
    assert.equal(indexRow(o.body).value, '');
  } finally { h.close(); }
});

test('2. the index\'s edges: none, all filed, obligations alone, and a read with no facts', async () => {
  // Mutation checked: `filings` counting the steps only → a venture with obligations alone reads Not recorded;
  // the fallback to rows removed → a read with rows and no facts says no filing.
  const h = await buildReads(0);
  try {
    let o = await overview(h);
    assert.deepEqual([indexRow(o.body).detail, indexRow(o.body).value], ['Next filing', null], 'no filing is Not recorded');
    h.db.exec(`INSERT INTO entity_obligations(uid, entity_id, kind, title, cadence, due_date, status) VALUES ('ob-x', 501, 'annual_report', 'Synthetic report', 'annual', '${day(12)}', 'open')`);
    o = await overview(h);
    assert.deepEqual([indexRow(o.body).detail, indexRow(o.body).value], [`Next filing ${dayMonth(day(12))}`, ''], 'an obligation alone is a filing');
    h.db.exec(`UPDATE entity_obligations SET status = 'filed', resolved_on = '${day(0)}';
      INSERT INTO formation_steps(project_id, title, state, sort_order, created_by, due_date) VALUES (${PROJECT}, 'Synthetic done step', 'done', 1, 1, '${day(5)}')`);
    o = await overview(h);
    assert.deepEqual([indexRow(o.body).detail, indexRow(o.body).value], ['Next filing', ''], 'only filed filings: a filing, but no date');
  } finally { h.close(); }
  // A read that gives rows and no facts (as before #4603 part 2b) still reads its rows.
  const card = (slug: string) => ({ slug, name: slug, caption: '', state: 'ok', series: [], range: 'Now', reason: null, next: null }) as any;
  const reads = ['solution-design', 'prototype-mvp', 'product-roadmap', 'founding-team', 'company-creation', 'operating-systems'].map((slug) => ({ card: card(slug), rows: [] as any[] }));
  reads[4].rows = [{ id: 'step-1', keys: { state: 'upcoming', due: '2027-03-04' } }, { id: 'step-2', keys: { state: 'filed', due: '2027-01-01' } }];
  const phone = await buildPhone({} as any, { id: PROJECT, founder_id: 11, company_id: null, mvp_target_date: null } as any, { id: 1, role: 'founder' } as any, reads as any, []);
  assert.equal(indexRow(phone).detail, `Next filing ${dayMonth('2027-03-04')}`);
});

test('3. an unreadable Company creation read is Unreadable on its own', async () => {
  // Mutation checked: the index reading the facts before the card's state → an unreadable read with no facts reads Not recorded.
  const h = await buildReads(10);
  try {
    h.db.exec('ALTER TABLE formation_steps RENAME COLUMN proof_file_key TO proof_file_key_synthetic');
    const o = await overview(h);
    assert.equal(o.status, 200);
    assert.equal(o.body.cards[4].state, 'unreadable');
    assert.equal(indexRow(o.body).value, 'Unreadable');
    assert.deepEqual([0, 1, 2, 3, 5].map((i) => o.body.cards[i].state === 'unreadable'), [false, false, false, false, false], 'the other cards still read');
  } finally { h.close(); }
});

test('4. what is not bounded, recorded: the card\'s timeline draws every step, so the overview reads every step', async () => {
  const h = await buildReads(1000);
  try {
    const o = await overview(h);
    const timeline = o.body.cards[4].series.find((s: any) => s.kind === 'timeline');
    assert.equal(timeline.steps.length, 1000, 'one timeline entry per step');
    const stepRows = o.log.filter((s) => /FROM formation_steps WHERE project_id/.test(s.sql)).reduce((t, s) => t + s.rows, 0);
    assert.equal(stepRows, 1000, 'so every step is read; bounding it would change the chart');
    const m = await h.get(`/api/cycles/build/modules/company-creation?project=${PROJECT}`);
    assert.deepEqual(m.body.card, o.body.cards[4], 'the overview card is the module card');
  } finally { h.close(); }
});
