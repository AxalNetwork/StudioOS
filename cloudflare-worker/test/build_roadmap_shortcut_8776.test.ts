/**
 * #8776 (D8776, BLR01B, BLR02, owner question 2 option A) — a Product roadmap item carries its quarter, over the
 * real migrated schema (`_build_reads.ts`):
 *
 *   1. `quarterValue` keeps one spelling, `Q1 2027`, and refuses any other; `keyResultsLine` reads stored key
 *      results as one line and never says "0" for none;
 *   2. PATCH /api/cycles/build/roadmap/:id writes the quarter (and clears it), refuses a quarter it cannot
 *      place, leaves it alone when the body does not name it, and logs "Quarter changed";
 *   3. the item's record shows Quarter beside Column and its key results in a side section, links "See its quarter, links and
 *      scenarios" to `/build/roadmap` on this item with the venture kept, and its Edit writes the quarter.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_roadmap_shortcut_8776.test.ts
 *
 * Every item and person here is synthetic.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { buildReads, PROJECT } from './_build_reads.ts';
import { d1Over } from './_d1_sqlite.mjs';
import build, { quarterValue } from '../src/routes/cycle_build.ts';
import cycleRecords from '../src/routes/cycle_records.ts';
import { keyResultsLine } from '../src/services/records/build.ts';

let h: Awaited<ReturnType<typeof buildReads>>;
let call: (path: string, init?: RequestInit) => Promise<{ status: number; body: any }>;

before(async () => {
  h = await buildReads(0);
  h.db.exec(`INSERT INTO roadmap_okrs(id, project_id, objective, kanban_status, sort_order, quarter, key_results_json) VALUES
    (1, ${PROJECT}, '[Harvest log]', 'next', 1, NULL, '[{"text":"Five growers log a harvest","target":5,"current":1,"unit":null},{"text":"  "}]'),
    (2, ${PROJECT}, '[Block map]', 'now', 2, 'Q4 2026', 'not json');
    UPDATE users SET subscription_tier = 'growth' WHERE id = 1;`);
  const SECRET = 'synthetic-8776-records-only-not-a-real-credential';
  const app = new Hono<any>().route('/api/cycles', cycleRecords).route('/api/cycles/build', build);
  const token = await new SignJWT({ user_id: 1, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const env = { DB: d1Over(h.db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  call = async (path: string, init: RequestInit = {}) => {
    const r = await app.request(path, { ...init, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, env);
    return { status: r.status, body: await r.json() as any };
  };
});
after(() => h?.close());

const quarterOf = (id: number) => (h.db.prepare('SELECT quarter FROM roadmap_okrs WHERE id = ?').get(id) as any)?.quarter;
const patch = (id: number, body: unknown) => call(`/api/cycles/build/roadmap/${id}?project=${PROJECT}`, { method: 'PATCH', body: JSON.stringify(body) });

test('1. one spelling of a quarter, and key results as one line', () => {
  // Mutation checked: the year-first branch dropped → '2027-Q1' is refused; a blank string read as a quarter →
  // '  ' is false instead of null; key results read with their blanks → a trailing " · ".
  assert.deepEqual(['Q1 2027', 'q3  2026', 'Q4-2026', '2027-Q1', '2027 q2'].map(quarterValue), ['Q1 2027', 'Q3 2026', 'Q4 2026', 'Q1 2027', 'Q2 2027']);
  assert.deepEqual([null, '', '  '].map(quarterValue), [null, null, null], 'empty clears');
  assert.deepEqual(['Q5 2027', 'Spring 2027', 'Q1', '2027', 'Q1 1999', 7].map(quarterValue), [false, false, false, false, false, false]);
  assert.equal(keyResultsLine('[{"text":"A"},{"text":" B "},{"text":""},{"x":1}]'), 'A · B');
  assert.deepEqual([keyResultsLine(null), keyResultsLine('[]'), keyResultsLine('not json'), keyResultsLine('{"text":"A"}')], [null, null, null, null]);
});

test('2. PATCH writes the quarter, refuses one it cannot place, and keeps it when unnamed', async () => {
  // Mutation checked: `quarter` left out of the UPDATE → the row stays NULL; the refusal dropped → 'Spring' is stored;
  // the existing quarter not carried → a title-only edit clears it; the summary not told apart → "Owner, date or KPI changed".
  const set = await patch(1, { quarter: '2027-q1' });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(quarterOf(1), 'Q1 2027');
  const logged = h.db.prepare("SELECT details FROM activity_logs WHERE action = 'build_roadmap_details_changed' ORDER BY id DESC LIMIT 1").get() as any;
  assert.match(String(logged?.details), /Quarter changed/);

  const refused = await patch(1, { quarter: 'Spring' });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.detail, 'Write the quarter as Q1 2027');
  assert.equal(quarterOf(1), 'Q1 2027', 'a refused quarter writes nothing');

  assert.equal((await patch(1, { title: '[Harvest log]' })).status, 200);
  assert.equal(quarterOf(1), 'Q1 2027', 'a body that names no quarter keeps it');

  assert.equal((await patch(1, { quarter: null })).status, 200);
  assert.equal(quarterOf(1), null, 'null clears it');
});

test('3. the record shows Quarter and Key results, links its quarter view, and Edit writes the quarter', async () => {
  // Mutation checked: the Quarter fact dropped → the labels differ; the link's `project_id` written as `project=` →
  // the landing would read no venture; the Edit's key list without `quarter` → the quarter never reaches the route.
  const one = await call(`/api/cycles/build/modules/product-roadmap/records/2?project=${PROJECT}`);
  assert.equal(one.status, 200, JSON.stringify(one.body));
  const facts = Object.fromEntries(one.body.facts.map((f: any) => [f.label, f.value ?? `∅ ${f.reason}`]));
  assert.equal(facts.Column, 'Now');
  assert.equal(facts.Quarter, 'Q4 2026');
  const view = one.body.side.find((s: any) => s.key === 'roadmap-view');
  assert.ok(view, 'the item links Quarters, dependencies and scenarios');
  assert.deepEqual([view.rows[0].a, view.rows[0].c], ['Key results', 'Not recorded'], 'unreadable key results read as none recorded, never 0');
  assert.deepEqual([view.rows[1].a, view.rows[1].href], ['See its quarter, links and scenarios', `/build/roadmap?project_id=${PROJECT}&view=quarters&item=2`]);

  const first = await call(`/api/cycles/build/modules/product-roadmap/records/1?project=${PROJECT}`);
  const firstFacts = Object.fromEntries(first.body.facts.map((f: any) => [f.label, f.value ?? `∅ ${f.reason}`]));
  assert.deepEqual(first.body.side.find((s: any) => s.key === 'roadmap-view').rows[0], { a: 'Key results', b: 'Five growers log a harvest' });
  assert.equal(firstFacts.Quarter, '∅ No quarter recorded. Set one with Edit.');
  const edit = first.body.actions.find((a: any) => a.key === 'edit');
  assert.ok(edit.form.fields.some((f: any) => f.key === 'quarter' && f.placeholder === 'Q1 2027'), 'Edit offers the quarter');

  const saved = await call(`/api/cycles/build/modules/product-roadmap/records/1/actions/edit?project=${PROJECT}`,
    { method: 'POST', body: JSON.stringify({ title: '[Harvest log]', column: 'next', quarter: 'Q2 2027' }) });
  assert.ok(saved.status < 300, JSON.stringify(saved.body));
  assert.equal(quarterOf(1), 'Q2 2027');
  const cleared = await call(`/api/cycles/build/modules/product-roadmap/records/1/actions/edit?project=${PROJECT}`,
    { method: 'POST', body: JSON.stringify({ title: '[Harvest log]', column: 'next', quarter: '' }) });
  assert.ok(cleared.status < 300, JSON.stringify(cleared.body));
  assert.equal(quarterOf(1), null, 'an emptied Quarter clears it');
});
