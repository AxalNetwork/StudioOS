/**
 * #4603 part 2b (D4603) — Founding team reads its founders only, and the
 * overview does not read the cap table for the option pool it never shows.
 *
 * Through `routes/cycle_build.ts` over the real migrated schema (`_build_reads.ts`):
 *   1. the module page's founders, their order, equity, vesting and agreement,
 *      and the card drawn from them are what the old read of every holder
 *      gave once filtered to founders (the old algorithm, kept here);
 *   2. at 1,000 holders the overview reads the founders and no other holder,
 *      and no cap-table record; the module page still answers the option pool;
 *   3. the card stays honest: no founders is empty, an unrecorded share is
 *      Not recorded, an unreadable founders read is Unreadable on its own, and
 *      an unreadable cap table fails the module page as before, not the overview;
 *   4. access is unchanged.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_founding_reads_4603.test.ts
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildReads, seedHolders, PROJECT } from './_build_reads.ts';

let varied: Awaited<ReturnType<typeof buildReads>>;
let large: Awaited<ReturnType<typeof buildReads>>;

before(async () => {
  varied = await buildReads(0);
  const db = varied.db;
  // Founders in an order their names do not follow, investors between them, and another venture's founder.
  db.exec(`INSERT INTO cap_table_holders(id, user_id, project_id, name, shares, ownership_pct, founder_role) VALUES
      (11, 1, ${PROJECT}, 'Zed Synthetic', 4000, 40, 'CEO'),
      (12, 51, ${PROJECT}, 'Synthetic Fund', 1000, 10, NULL),
      (13, 2, ${PROJECT}, 'Ada Synthetic', 3000, 30, 'CTO'),
      (14, 52, ${PROJECT}, 'Synthetic Option Pool', 500, 5, NULL),
      (15, 3, ${PROJECT}, 'Mo Synthetic', 1500, 15, 'COO'),
      (16, 4, 999, 'Another venture founder', 100, 100, 'CEO');
    INSERT INTO cap_table_vesting(user_id, holder_id, project_id, start_date, cliff_months, total_months, vested_shares) VALUES
      (1, 11, ${PROJECT}, '2026-01-01', 12, 48, 1000),
      (2, 13, ${PROJECT}, '2026-02-01', 0, 48, 600),
      (99, 15, ${PROJECT}, '2026-03-01', 12, 36, 1);
    INSERT INTO documents(id, title, status, template_name, project_id, created_at) VALUES
      (7001, 'Synthetic agreement', 'signed', 'cofounder_agreement', ${PROJECT}, '2026-01-01'),
      (7002, 'Synthetic redraft', 'sent', 'cofounder_agreement', ${PROJECT}, '2026-02-01'),
      (7003, 'Synthetic agreement two', 'signed', 'cofounder_agreement', ${PROJECT}, '2026-01-15');
    INSERT INTO cofounder_agreement_parties(document_id, party_index, name, user_id) VALUES
      (7001, 0, 'Zed Synthetic', 1), (7002, 0, 'Zed Synthetic', 1), (7003, 0, 'Ada Synthetic', 2), (7003, 1, 'Synthetic Fund', 51);`);
  large = await buildReads(1000);
  seedHolders(large.db, 1000);
});
after(() => { varied?.close(); large?.close(); });

const page = (h: typeof varied, query = '', user = 1) => h.get(`/api/cycles/build/modules/founding-team?project=${PROJECT}${query}`, user);
const overview = (h: typeof varied, user = 1) => h.get(`/api/cycles/build/overview?project=${PROJECT}`, user);
/** The cap-table record and model reads (`readCapTable`), which only the option pool needs. */
const CAP_TABLE = /cap_table_currency|cap_table_scenarios|SELECT id, kind FROM cap_table_holders/;

/** Every holder, as the reader read them before #4603 part 2b; it then kept the founders. */
function oldFounders(h: typeof varied) {
  return (h.db.prepare(`SELECT h.id, h.name, h.founder_role, h.ownership_pct, v.start_date,
      (SELECT d.status FROM documents d JOIN cofounder_agreement_parties party ON party.document_id = d.id
        WHERE d.project_id = h.project_id AND d.template_name = 'cofounder_agreement' AND party.user_id = h.user_id
        ORDER BY d.created_at DESC, d.id DESC LIMIT 1) AS agreement_status
    FROM cap_table_holders h LEFT JOIN cap_table_vesting v ON v.holder_id = h.id AND v.user_id = h.user_id
    WHERE h.project_id = ? ORDER BY h.id`).all(PROJECT) as any[]).filter((h) => h.founder_role != null);
}

test('1. the founders, their order and the card are what the old read of every holder gave', async () => {
  // Mutation checked: the founder filter dropped → the fund and the pool are listed;
  // `founder_role IS NULL` → only they are; ordered by name → Ada before Zed.
  const want = oldFounders(varied);
  assert.deepEqual(want.map((h) => h.name), ['Zed Synthetic', 'Ada Synthetic', 'Mo Synthetic']);
  const r = await page(varied, '&sort=founder_id_unknown');
  assert.equal(r.status, 200);
  const rows = r.body.records.rows;
  assert.deepEqual(rows.map((x: any) => x.id), want.map((h) => `h-${h.id}`), 'the founders in read order');
  assert.deepEqual(rows.map((x: any) => x.cells.role), ['CEO', 'CTO', 'COO']);
  // Zed's newest agreement was re-sent (Awaiting); Ada's is signed; Mo has none. Vesting joins on both keys: Mo's is another user's.
  assert.deepEqual(rows.map((x: any) => x.cells.agreement), ['Awaiting', 'Signed', null]);
  assert.deepEqual(rows.map((x: any) => x.cells.vesting === null), [false, false, true]);
  const stack = r.body.card.series.find((s: any) => s.kind === 'stack');
  assert.deepEqual(stack.legend.map((l: any) => l.label), want.map((h) => h.name));
  assert.deepEqual(stack.rows[0].parts, want.map((h) => h.ownership_pct));
  assert.equal(r.body.card.next?.text, 'Record founder vesting', 'Mo has no schedule of his own');
  assert.deepEqual(r.body.records.filters[0].options.map((o: any) => o.value), ['CEO', 'COO', 'CTO']);
  const o = await overview(varied);
  assert.deepEqual(o.body.cards[3], r.body.card, 'the overview card is the module card');
});

test('2. at 1,000 holders the overview reads the founders and no cap-table record; the page still answers the option pool', async () => {
  // Mutation checked: the overview reading page facts → the cap-table reads run; the module page not reading them → no option pool.
  const o = await overview(large);
  assert.equal(o.status, 200);
  const holderRows = o.log.filter((s) => /^SELECT h\.id, h\.name, h\.founder_role/.test(s.sql)).reduce((t, s) => t + s.rows, 0);
  assert.equal(holderRows, 3, 'the three founders, not the 997 other holders');
  assert.deepEqual(o.log.filter((s) => CAP_TABLE.test(s.sql)).map((s) => s.sql), [], 'no cap-table record read');
  assert.equal(o.body.cards[3].state, 'ok');
  assert.equal(o.body.index.find((x: any) => x.key === 'founding-team').value, '');
  const m = await page(large);
  assert.deepEqual(m.body.records.rows.map((x: any) => x.cells.founder), ['Synthetic holder 1', 'Synthetic holder 2', 'Synthetic holder 3']);
  assert.ok(Object.hasOwn(m.body.facts, 'option_pool_pct') && Object.hasOwn(m.body.facts, 'option_pool_source'), 'the module page still answers the option pool');
  assert.ok(m.log.some((s) => CAP_TABLE.test(s.sql)), 'and reads the cap table for it');
  assert.deepEqual(m.body.card, o.body.cards[3]);
});

test('3. empty, not recorded and unreadable stay distinct; a cap-table failure fails the module page, not the overview', async () => {
  const h = await buildReads(0);
  try {
    h.db.exec(`INSERT INTO cap_table_holders(user_id, project_id, name, shares, ownership_pct, founder_role) VALUES (51, ${PROJECT}, 'Synthetic Fund', 100, 10, NULL)`);
    let o = await overview(h);
    assert.equal(o.body.cards[3].state, 'empty', 'an investor is not a founder');
    assert.equal(o.body.index.find((x: any) => x.key === 'founding-team').value, null);
    h.db.exec(`INSERT INTO cap_table_holders(user_id, project_id, name, shares, ownership_pct, founder_role) VALUES (1, ${PROJECT}, 'Synthetic founder', 100, NULL, 'CEO')`);
    o = await overview(h);
    assert.equal(o.body.cards[3].state, 'not_recorded', 'an unrecorded share is not a zero');
    // The cap table's model store unreadable: the option pool cannot be read.
    // Mutation checked: the overview reading the option pool → its Founding card is Unreadable too.
    h.db.exec('ALTER TABLE cap_table_scenarios RENAME TO cap_table_scenarios_synthetic');
    o = await overview(h);
    assert.equal(o.body.cards[3].state, 'not_recorded', 'the overview never needed the cap table');
    const m = await page(h);
    assert.equal(m.body.card.state, 'unreadable', 'the module page needs it for the option pool, and fails as before');
    h.db.exec('ALTER TABLE cap_table_scenarios_synthetic RENAME TO cap_table_scenarios');
    // The founders' own read unreadable: Founding team alone is Unreadable.
    // Mutation checked: the overview's Founding card built without the founders read → it is not Unreadable.
    h.db.exec('ALTER TABLE cap_table_vesting RENAME COLUMN cliff_months TO cliff_months_synthetic');
    o = await overview(h);
    assert.equal(o.status, 200);
    assert.equal(o.body.cards[3].state, 'unreadable');
    assert.equal(o.body.index.find((x: any) => x.key === 'founding-team').value, 'Unreadable');
    assert.deepEqual([0, 1, 2, 4, 5].map((i) => o.body.cards[i].state === 'unreadable'), [false, false, false, false, false], 'the other cards still read');
  } finally { h.close(); }
});

test('4. access is unchanged: another venture\'s founder is refused the module page', async () => {
  assert.equal((await page(varied, '', 2)).status, 403);
  assert.equal((await page(varied, '&q=synthetic', 2)).status, 403);
});
