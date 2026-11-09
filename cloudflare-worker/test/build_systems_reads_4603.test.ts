/**
 * #4603 part 2b (D4603) — Operating systems counts the company's tools on the
 * overview and reads only the failing tool its card names; the module page
 * still lists every tool in its Tools part.
 *
 * Through `routes/cycle_build.ts` over the real migrated schema (`_build_reads.ts`):
 *   1. the overview's tool counts, phone Tools row and card are what the old
 *      read of every tool gave (the old rule, kept here), and what the module
 *      page answers;
 *   2. at 1,000 tools the overview reads two tool rows (a count and one
 *      failing tool) and no membership; the module page still lists them all;
 *   3. Reconnect names the first failing tool the registry knows, in id order,
 *      skipping unknown providers, personal connections, tools disabled for the
 *      company and tools of people outside it;
 *   4. no company stays Not recorded, no tool is a zero, and an unreadable tools
 *      read is Unreadable on its own;
 *   5. access is unchanged.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_systems_reads_4603.test.ts
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildReads, seedTools, PROJECT } from './_build_reads.ts';
import { getDescriptor } from '../src/integrations/registry.ts';

let varied: Awaited<ReturnType<typeof buildReads>>;
let large: Awaited<ReturnType<typeof buildReads>>;
before(async () => {
  varied = await buildReads(0); seedTools(varied.db, 40);
  large = await buildReads(0); seedTools(large.db, 1000);
});
after(() => { varied?.close(); large?.close(); });

const overview = (h: typeof varied, user = 1) => h.get(`/api/cycles/build/overview?project=${PROJECT}`, user);
const page = (h: typeof varied, query = '', user = 1) => h.get(`/api/cycles/build/modules/operating-systems?project=${PROJECT}${query}`, user);
const toolsRow = (body: any) => body.index.find((x: any) => x.key === 'tools');

/** Every tool of the company, as the reader read them before #4603 part 2b, and the rule it applied. */
function oldTools(h: typeof varied) {
  const tools = h.db.prepare(`SELECT i.id, i.provider_key, i.status FROM integrations i
      JOIN integration_companies ic ON ic.integration_id = i.id AND ic.company_id = 10 AND ic.enabled = 1
      JOIN user_company_links ucl ON ucl.company_id = ic.company_id AND ucl.user_id = i.user_id
     WHERE i.provider_key NOT IN ('google_calendar','microsoft_365') ORDER BY i.id`).all() as any[];
  return { total: tools.length, connected: tools.filter((t) => t.status === 'active').length, failing: tools.filter((t) => t.status === 'error').length,
    reconnect: tools.find((t) => t.status === 'error' && getDescriptor(t.provider_key)) ?? null };
}

test('1. the overview\'s counts, Tools row and card are what the old read of every tool gave, and what the page answers', async () => {
  // Mutation checked: the count without the company's enabled flag → disabled tools are counted;
  // the overview's counts from its (empty) tool list → zeros.
  for (const h of [varied, large]) {
    const want = oldTools(h);
    const o = await overview(h), m = await page(h);
    assert.deepEqual([m.body.facts.tools_total, m.body.facts.tools_connected, m.body.facts.tools_failing], [want.total, want.connected, want.failing]);
    assert.deepEqual([toolsRow(o.body).value, toolsRow(o.body).detail], [String(want.total), `${want.connected} connected · ${want.failing} failing`]);
    assert.deepEqual(o.body.cards[5], m.body.card, 'the overview card is the module card');
    assert.equal(m.body.parts.tools.rows.length, want.total, 'the Tools part lists every tool');
  }
});

test('2. at 1,000 tools the overview reads two tool rows and no membership; the page still lists them all', async () => {
  // Mutation checked: the overview reading the tool list → 775 rows; the failing read without LIMIT → every failing tool;
  // the membership read ungated → its statement runs on the overview.
  const o = await overview(large);
  const rowsOf = (re: RegExp) => o.log.filter((s) => re.test(s.sql)).reduce((t, s) => t + s.rows, 0);
  assert.equal(rowsOf(/^SELECT COUNT\(\*\) AS total, COALESCE\(SUM\(CASE WHEN i\.status/), 1, 'one count row');
  assert.equal(rowsOf(/^SELECT i\.id, i\.provider_key, i\.status, i\.last_error_at/), 1, 'one failing tool');
  assert.equal(rowsOf(/^SELECT i\.id, i\.user_id, i\.provider_key/), 0, 'no tool list');
  assert.deepEqual(o.log.filter((s) => /^SELECT 1 FROM user_company_links/.test(s.sql)).map((s) => s.sql), [], 'no membership read');
  const m = await page(large);
  assert.equal(m.body.parts.tools.rows.length, oldTools(large).total);
  assert.ok(m.log.some((s) => /^SELECT 1 FROM user_company_links/.test(s.sql)), 'the module page still reads it, for owners');
});

test('3. Reconnect names the first failing tool the registry knows, in id order', async () => {
  // Mutation checked: the failing read without the registry's keys → an unknown provider is named;
  // newest first → a later tool is named; without `status = 'error'` → an active tool is named.
  const h = await buildReads(0);
  try {
    seedTools(h.db, 12);
    const failing = (ids: string[]) => h.db.exec(`UPDATE integrations SET status = CASE WHEN uid IN (${ids.map((u) => `'${u}'`).join(',')}) THEN 'error' ELSE 'active' END, last_error_at = '2026-11-04 09:00:00'`);
    // int-6 is the unknown provider (the first failing company tool by id), int-7 Google Calendar (personal),
    // int-10 disabled for the company, int-13 outside the company; then int-9 is Stripe and int-11 Notion.
    failing(['int-6', 'int-7', 'int-10', 'int-13', 'int-9', 'int-11']);
    let o = await overview(h);
    assert.equal(o.body.cards[5].next?.text, 'Reconnect Stripe · failing since 4 Nov', 'the first known failing tool by id, past the unknown one');
    assert.deepEqual(o.body.cards[5], (await page(h)).body.card);
    failing(['int-6', 'int-7', 'int-10', 'int-13']);
    o = await overview(h);
    assert.equal(o.body.cards[5].next, null, 'only unknown, personal, disabled or outside tools fail: nothing to reconnect');
    // Twelve tools less Google Calendar and the disabled one: ten, the unknown one failing and still counted.
    assert.equal(toolsRow(o.body).detail, '9 connected · 1 failing', 'the unknown one still counts as failing');
    assert.equal(toolsRow(o.body).value, '10');
  } finally { h.close(); }
});

test('4. no company stays Not recorded, no tool is a zero, and an unreadable tools read is Unreadable on its own', async () => {
  const h = await buildReads(0);
  try {
    let o = await overview(h);
    assert.deepEqual([toolsRow(o.body).value, (await page(h)).body.facts.tools_total], [null, 0], 'no tool: a zero, shown as no value');
    h.db.exec(`UPDATE projects SET company_id = NULL WHERE id = ${PROJECT}`);
    o = await overview(h);
    assert.equal(o.body.cards[5].state, 'not_recorded');
    assert.equal((await page(h)).body.facts.tools_total, null, 'no company: not recorded, not zero');
    h.db.exec(`UPDATE projects SET company_id = 10 WHERE id = ${PROJECT}; ALTER TABLE integration_companies RENAME COLUMN enabled TO enabled_synthetic`);
    o = await overview(h);
    assert.equal(o.status, 200);
    assert.equal(o.body.cards[5].state, 'unreadable');
    assert.equal(toolsRow(o.body).value, 'Unreadable');
    assert.deepEqual([0, 1, 2, 3, 4].map((i) => o.body.cards[i].state === 'unreadable'), [false, false, false, false, false], 'the other cards still read');
  } finally { h.close(); }
});

test('5. access is unchanged: another venture\'s founder is refused', async () => {
  assert.equal((await overview(varied, 2)).status, 403);
  assert.equal((await page(varied, '', 2)).status, 403);
});
