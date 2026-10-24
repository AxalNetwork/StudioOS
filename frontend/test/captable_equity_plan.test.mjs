/**
 * Cap Table: the equity plan reads data the importer has always written (Wave 2).
 *
 * `cap_table_option_pools` and `cap_table_vesting` have existed since migration
 * 057 and are populated on every Carta sync. Before this change the ONLY file in
 * the worker naming either table was `integrations/providers/carta.ts` — the
 * importer. Nothing read them. A founder who connected Carta had pools and
 * vesting schedules sitting in D1 and no surface that showed them.
 *
 * The same canvas also asks for per-SAFE conversion detail (cap vs discount, MFN
 * inheritance). That is deliberately NOT built, and this file pins the reason:
 * those terms are not stored. `valuation_cap` exists only on `deals` — the
 * investor-side pipeline, not a cap-table security — and `discount_rate` and MFN
 * appear in no table at all. Rendering a conversion from terms the database does
 * not hold would be inventing fiduciary numbers, which is the one thing the
 * fund-honesty rule exists to prevent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

test('cap-table vesting readers remain scoped to their intended audience', () => {
  // Guards the premise. If another reader appears, this endpoint may be
  // duplicating one — worth knowing rather than assuming.
  const dir = resolve(root, 'cloudflare-worker/src');
  const readers = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.ts')) {
        const s = readFileSync(f, 'utf8');
        if (/cap_table_(option_pools|vesting)/.test(s)) readers.push(f.slice(dir.length + 1));
      }
    }
  };
  walk(dir);
  // D435 added one reader on purpose: the founder's Team page reads the
  // company's option pool through `user_company_links` (a member's import,
  // and the page says so) rather than duplicating this per-caller endpoint.
  // It is a SELECT joined through the membership, names only the pools table,
  // and writes nothing — pinned below so the list can grow only that way.
  // D896 (#2675) added one more on purpose: the pitch deck's sources count
  // the venture's vesting schedules through its own cap-table holders, as a
  // number for a card, read only — pinned below.
  assert.deepEqual(
    readers.sort(),
    ['integrations/providers/carta.ts', 'routes/captable.ts', 'routes/company.ts', 'routes/cycle_build.ts', 'services/capTableWrites.ts', 'services/decks/sources.ts', 'services/records/build.ts'],
    'only the Carta importer, the four reviewed readers and the one reviewed writer should touch these tables',
  );
  const deck = read('cloudflare-worker/src/services/decks/sources.ts');
  assert.doesNotMatch(deck, /cap_table_option_pools/, 'the deck counts vesting rows, not pools');
  assert.doesNotMatch(deck, /(INSERT INTO|UPDATE|DELETE FROM)\s+cap_table_/, 'a read, never a write');
  assert.match(deck, /FROM cap_table_vesting v\s*WHERE v\.holder_id IN \(SELECT h\.id FROM cap_table_holders h WHERE h\.project_id = \?/,
    'vesting is reached only through this venture\u2019s holders');
  const company = read('cloudflare-worker/src/routes/company.ts');
  assert.doesNotMatch(company, /cap_table_vesting/, 'the Team page reads pools, not vesting rows');
  assert.doesNotMatch(company, /(INSERT INTO|UPDATE|DELETE FROM)\s+cap_table_option_pools/, 'a read, never a write');
  assert.match(company, /FROM cap_table_option_pools o\s*JOIN user_company_links ucl ON ucl\.user_id = o\.user_id\s*WHERE ucl\.company_id = \?/,
    'the company-scoped read is joined through the membership, so it can only return a member’s import');
  const build = read('cloudflare-worker/src/routes/cycle_build.ts');
  assert.match(build, /v\.holder_id = h\.id AND v\.user_id = h\.user_id[\s\S]*WHERE h\.project_id = \?/,
    'the Build cycle can read vesting only through a holder of the requested project and owner');
  assert.doesNotMatch(build, /(INSERT INTO|UPDATE|DELETE FROM)\s+cap_table_vesting/, 'the Build cycle cannot write personal vesting');
  // D690 (S18-B, #1694): Build's Founding team record reads one founder's
  // vesting the same way the list does, and writes nothing.
  const buildRecord = read('cloudflare-worker/src/services/records/build.ts');
  assert.match(buildRecord, /v\.holder_id = h\.id AND v\.user_id = h\.user_id[\s\S]*WHERE h\.project_id = \?/,
    'the Build founder record can read vesting only through a holder of the requested project and owner');
  assert.doesNotMatch(buildRecord, /(INSERT INTO|UPDATE|DELETE FROM)\s+cap_table_(vesting|option_pools)/, 'the Build founder record cannot write personal vesting');
  // D691 decision 4 (#1700): `addHolder()` and `updateHolder()` write a founder's
  // vesting, only ever for a holder of the requested venture, on that holder's
  // own user_id. It names no pool.
  const writes = read('cloudflare-worker/src/services/capTableWrites.ts');
  assert.doesNotMatch(writes, /cap_table_option_pools/, 'the holder writer touches no pool');
  // addHolder: the vesting row's holder is the register row it just inserted for args.projectId, on the same user.
  assert.match(writes, /INSERT INTO cap_table_holders \(user_id, project_id,[\s\S]*?RETURNING id`,\s*\)\.bind\(owner\.id, args\.projectId,/);
  assert.match(writes, /INSERT INTO cap_table_vesting \(user_id, holder_id,[\s\S]*?\)\.bind\(owner\.id, holderId,/,
    'the vesting row carries the user_id and holder_id of the register row just written');
  // updateHolder: the holder is read back for args.projectId first, and its own user_id keys the vesting.
  assert.match(writes, /FROM cap_table_holders WHERE id = \? AND project_id = \?'\)\s*\.bind\(holderId, args\.projectId\)/);
  assert.match(writes, /WHERE holder_id = \? AND user_id = \?`,\s*\)\.bind\([^)]*holderId, reg\.user_id\)/);
  assert.match(writes, /INSERT INTO cap_table_vesting \(user_id, holder_id,[\s\S]*?\)\.bind\(reg\.user_id, holderId,/);
  // The only delete is the compensating one, scoped to the same pair.
  assert.deepEqual([...writes.matchAll(/DELETE FROM cap_table_vesting[^']*/g)].map((m) => m[0]),
    ['DELETE FROM cap_table_vesting WHERE holder_id = ? AND user_id = ?']);
});

test('the endpoint is scoped to the caller', () => {
  const w = read('cloudflare-worker/src/routes/captable.ts');
  const i = w.indexOf("captable.get('/equity-plan'");
  assert.ok(i > 0, 'GET /captable/equity-plan must exist');
  // Bounded to the handler (D366 lengthened it with its refusal branch).
  const body = w.slice(i, w.indexOf("captable.post('/simulate'", i));
  assert.match(body, /requireAuth\(c\)/, 'must authenticate');
  // Both tables key on user_id and carry no project_id, so this is a per-account
  // view — every query must bind the caller.
  const wheres = body.match(/WHERE user_id = \?/g) || [];
  assert.equal(wheres.length, 2, 'both reads must filter on user_id');
  assert.match(body, /\.bind\(user\.id\)/, 'the bound value must be the caller');
  assert.ok(!/req\.query\('user_id'\)|body\.user_id/.test(body),
    'the user must never come from the request');
});

test('totals are null when nothing is recorded, never a confident zero', () => {
  // The fund-honesty rule: an unset fiduciary fact reads "Not recorded", not 0.
  const w = read('cloudflare-worker/src/routes/captable.ts');
  const i = w.indexOf("captable.get('/equity-plan'");
  // Bounded to the handler (D366 lengthened it with its refusal branch).
  const body = w.slice(i, w.indexOf("captable.post('/simulate'", i));
  assert.match(body, /poolRows\.length \? sum\(poolRows, 'shares_authorized'\) : null/);
  assert.match(body, /vestRows\.length \? totalGranted : null/);

  const ui = read('frontend/src/pages/captable/EquityPlanPanel.jsx');
  assert.match(ui, /return 'Not recorded'/, 'the panel must render absence as "Not recorded"');
});

test('no money column is introduced — these are share counts', () => {
  // The integer-cents rule covers money. Shares are not money, and this
  // endpoint must not quietly add a dollar figure that dodges the rule.
  const w = read('cloudflare-worker/src/routes/captable.ts');
  const i = w.indexOf("captable.get('/equity-plan'");
  // Bounded to the handler (D366 lengthened it with its refusal branch).
  const body = w.slice(i, w.indexOf("captable.post('/simulate'", i));
  for (const bad of ['amount', 'price', '_usd', 'valuation']) {
    assert.ok(!body.includes(bad), `the equity-plan payload must not carry ${bad}`);
  }
});

test('vested amounts are reported, not recomputed', () => {
  const w = read('cloudflare-worker/src/routes/captable.ts');
  // The rationale lives in the doc comment ABOVE the handler, so the region
  // has to start there — slicing from the handler index skips it, which is
  // how the first version of this test failed against correct code.
  const docStart = w.indexOf('Wave 2 — GET /api/captable/equity-plan');
  const handler = w.indexOf("captable.get('/equity-plan'");
  assert.ok(docStart > 0 && handler > docStart, 'the doc comment must precede the handler');
  assert.match(w.slice(docStart, handler), /AS IMPORTED and never recomputed/,
    'the reason must stay recorded next to the code');

  // No date arithmetic in the HANDLER: deriving a second vested number from
  // cliff/term would disagree with the provider in front of the same founder.
  const body = w.slice(handler, handler + 2600);
  assert.ok(!/Date\.now\(\)|new Date\(/.test(body),
    'the endpoint must not derive vesting from the clock');
});

test('the panel says SAFE conversion is absent, and why', () => {
  const ui = read('frontend/src/pages/captable/EquityPlanPanel.jsx');
  assert.match(ui, /not shown/i);
  assert.match(ui, /not stored/i, 'the reason must be stated, not just the absence');

  // And the premise: those columns really do not exist on a cap-table security.
  const sql = readdirSync(resolve(root, 'cloudflare-worker/sql/migrations'))
    .map((f) => readFileSync(resolve(root, 'cloudflare-worker/sql/migrations', f), 'utf8'))
    .join('\n') + read('cloudflare-worker/sql/schema_baseline.sql');
  assert.ok(!/discount_rate/.test(sql), 'if discount_rate now exists, build the conversion detail');

  // Look for a COLUMN, not a mention. A bare /\bmfn\b/ matches
  // "MFN Provision: [Yes/No]" inside a seeded legal template — which is the
  // point rather than a counterexample: MFN exists here as document prose a
  // human fills in, not as a modelled field anything can compute from.
  const mfnColumn = /^\s*\w*mfn\w*\s+(TEXT|INTEGER|REAL|NUMERIC|BOOLEAN)/im;
  assert.ok(!mfnColumn.test(sql), 'if MFN is now a column, build the inheritance view');
});

test('the panel is mounted and the api method exists on both sides', () => {
  assert.match(read('frontend/src/pages/CapTablePage.jsx'), /<EquityPlanPanel \/>/,
    'defining the panel is not shipping it');
  assert.match(read('frontend/src/lib/api.js'), /getEquityPlan: \(\) => request\('\/captable\/equity-plan'\)/);
  assert.match(read('cloudflare-worker/src/routes/captable.ts'), /captable\.get\('\/equity-plan'/);
});
