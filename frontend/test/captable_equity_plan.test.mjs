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

test('the two tables were write-only before this change', () => {
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
  assert.deepEqual(
    readers.sort(),
    ['integrations/providers/carta.ts', 'routes/captable.ts'],
    'only the Carta importer and this new endpoint should touch these tables',
  );
});

test('the endpoint is scoped to the caller', () => {
  const w = read('cloudflare-worker/src/routes/captable.ts');
  const i = w.indexOf("captable.get('/equity-plan'");
  assert.ok(i > 0, 'GET /captable/equity-plan must exist');
  const body = w.slice(i, i + 2600);
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
  const body = w.slice(i, i + 2600);
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
  const body = w.slice(i, i + 2600);
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
    .join('\n') + read('cloudflare-worker/sql/schema.sql');
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
