/**
 * Perks & Products — the credit economy has to be right or it is worse than absent.
 *
 * The P−1 census graded this canvas NEW and it genuinely is: nothing in D1
 * models a perk, and `products.ts` / `catalog.ts` / `admin_promos.ts` are the
 * Stripe storefront and admin promo minting, not a partner marketplace.
 *
 * Most of what follows pins two kinds of claim.
 *
 * The first is arithmetic. A credit balance that can go negative, be
 * double-spent, or drift from its own ledger is a bug that costs a real
 * person something real. So: balance is derived and never stored, a claim and
 * its debit are one batch, and two separate unique indexes make a double-spend
 * unreachable rather than unlikely.
 *
 * The second is honesty about the two zero-balance states. "Not enough
 * credits" says you spent yours. Nobody has spent anything, because no plan
 * allowance has ever been decided — so the true sentence is that credits are
 * not configured. `allowance_configured` exists to carry exactly that
 * distinction, and these tests fail if the page stops making it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const SQL = 'cloudflare-worker/sql/migrations/186_perks.sql';
const ROUTE = 'cloudflare-worker/src/routes/perks.ts';
const PAGE = 'frontend/src/pages/PerksPage.jsx';

/* ---------------------------------------------------------------- *
 * Schema                                                            *
 * ---------------------------------------------------------------- */

test('the migration creates the four tables and nothing else', () => {
  const s = read(SQL);
  for (const t of ['perks', 'perk_claims', 'perk_credit_ledger', 'perk_views']) {
    assert.match(s, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`), `${t} must be created`);
  }
  // Additive only: no destructive statement may appear in a migration that
  // runs against production D1.
  for (const bad of ['DROP TABLE', 'DROP COLUMN', 'DELETE FROM', 'ALTER TABLE']) {
    assert.ok(!s.includes(bad), `a migration must not ${bad}`);
  }
});

test('there is no stored balance column anywhere', () => {
  // A stored balance is a second source of truth for a fact the ledger rows
  // already hold, and it drifts the first time a write half-fails.
  const s = read(SQL);
  assert.ok(!/^\s*balance\s+(INTEGER|REAL|TEXT)/mi.test(s), 'balance must be derived, not stored');
  assert.match(read(ROUTE), /SUM\(delta\)/, 'the route must derive the balance by summing the ledger');
});

test('the ledger is idempotent on (user, kind, source_ref)', () => {
  const s = read(SQL);
  assert.match(
    s, /CREATE UNIQUE INDEX IF NOT EXISTS idx_perk_ledger_idem\s+ON perk_credit_ledger\(user_id, kind, source_ref\)/,
    'the idempotency index is what makes a retried spend safe',
  );
});

test('a perk can be claimed once per user, enforced by the storage layer', () => {
  assert.match(
    read(SQL),
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_perk_claims_once ON perk_claims\(perk_id, user_id\)/,
    'the double-claim guard must be an index, not just a check in the handler',
  );
});

test('money is integer cents and credits are not money', () => {
  const s = read(SQL);
  // EVERY money column must END in `_cents`, not merely contain it. The
  // guard's hard rule — a `*_cents` column may never be REAL — keys on the
  // suffix, so a column named `price_cents_at_claim` would hold cents while
  // sitting outside the one check that protects them. This schema had exactly
  // that column until the guard's own counter gave it away.
  const moneyCols = [...s.matchAll(/^\s*([a-z_]*(?:price|amount|cost)[a-z_]*)\s+(\w+)/gmi)]
    .map((m) => [m[1], m[2]]);
  assert.ok(moneyCols.length >= 2, 'the schema should declare money columns');
  for (const [col, type] of moneyCols) {
    assert.match(col, /_cents$/, `${col} holds currency and must end in _cents`);
    assert.match(type, /^INTEGER$/i, `${col} must be INTEGER, not ${type}`);
  }
  // `credits` is a COUNT. Naming it `*_cost` or `*_price` would make
  // check-money-cents correctly demand cents of something that is not money.
  assert.ok(!/credit_cost|cost_credits|credit_price/.test(s), 'a credit count must not be named like money');
});

test('the migration explains why it does not reuse intro_credit_ledger', () => {
  // Migration 150 already ships a well-built credit ledger. Reusing it would
  // have been wrong twice over and the reasoning has to survive in the file,
  // because the next person will ask the same question.
  const s = read(SQL);
  assert.match(s, /intro_credit_ledger/, 'the existing ledger must be named');
  assert.match(s, /NOT THE SAME UNIT/i, 'the unit mismatch is the decisive reason');
  assert.match(s, /CHECK/, 'the SQLite CHECK-rebuild constraint must be recorded too');
});

/* ---------------------------------------------------------------- *
 * The debit                                                         *
 * ---------------------------------------------------------------- */

test('the claim and its debit are written in one batch', () => {
  const s = read(ROUTE);
  const i = s.indexOf("r.post('/:uid/claim'");
  assert.ok(i > 0, 'the claim route must exist');
  const body = s.slice(i);
  assert.match(body, /DB\.batch\(stmts\)/, 'a claim without its debit must not be reachable');
  assert.match(body, /INSERT INTO perk_claims/, 'the claim row');
  assert.match(body, /INSERT INTO perk_credit_ledger/, 'the debit row');
  assert.match(body, /`perk:\$\{claimUid\}`/, 'the spend must key on the claim uid so a retry is idempotent');
});

test('a second claim returns the first rather than erroring', () => {
  const s = read(ROUTE);
  const body = s.slice(s.indexOf("r.post('/:uid/claim'"));
  assert.match(body, /already_claimed: true/, 'a double-click should show the code, not a failure');
});

test('the redemption code is generated, never taken from the request', () => {
  const s = read(ROUTE);
  const body = s.slice(s.indexOf("r.post('/:uid/claim'"));
  assert.match(body, /const code = perk\.fulfilment === 'code'/, 'the code is derived from the perk');
  assert.ok(!/body\?\.code|b\?\.code/.test(body), 'a caller must not be able to choose their own code');
});

test('a spend can never take a balance below zero', () => {
  const s = read(ROUTE);
  // Two independent places: the claim checks affordability before batching,
  // and an admin adjustment cannot push a balance negative either.
  assert.match(s, /insufficient_credits/, 'the claim must refuse an unaffordable perk');
  assert.match(s, /that would take the balance below zero/, 'an admin adjustment must refuse too');
});

/* ---------------------------------------------------------------- *
 * Ownership and review                                              *
 * ---------------------------------------------------------------- */

test('a partner route 404s for a listing they do not own', () => {
  const s = read(ROUTE);
  assert.match(s, /AND partner_user_id = \?/, 'ownership is part of the lookup, not a later check');
  const patch = s.slice(s.indexOf("r.patch('/partner/:uid'"), s.indexOf("r.get('/partner/:uid/stats'"));
  assert.match(patch, /'not_found' \}, 404/, 'a 403 would confirm the listing exists');
  // Against the code alone: the handler's own comment explains why 403 is
  // wrong here, and that comment is the one you want to keep.
  assert.ok(!/403/.test(codeOnly(patch)), 'no 403 on a resource the caller may not see');
});

test('no caller-controlled string can reach a column name', () => {
  // The PATCH handler interpolates `sets.join(', ')` into the query TEXT,
  // where no binding protects it, and that is recorded in
  // scripts/sql-prepare-baseline.json as a reviewed-safe site. It is only
  // safe while every column name is a literal — so that is the thing to pin,
  // not the reviewer's memory of having checked it once.
  const s = read(ROUTE);
  const patch = s.slice(s.indexOf("r.patch('/partner/:uid'"), s.indexOf("r.get('/partner/:uid/stats'"));
  const calls = [...patch.matchAll(/put\(([^,)]+)/g)].map((m) => m[1].trim());
  assert.ok(calls.length >= 8, 'the UPDATE builder should have several columns');
  for (const arg of calls) {
    assert.match(arg, /^'[a-z_]+'$/, `put() must take a literal column name, got ${arg}`);
  }
  // And the value always goes through a bound parameter.
  assert.match(patch, /sets\.push\(`\$\{col\} = \?`\)/, 'the value must be bound, never interpolated');
});

test('editing a live listing sends it back for review', () => {
  const s = read(ROUTE);
  const patch = s.slice(s.indexOf("r.patch('/partner/:uid'"), s.indexOf("r.get('/partner/:uid/stats'"));
  assert.match(
    patch, /perk\.status === 'live'.*\n?.*put\('status', 'in_review'\)/,
    'a partner must not be able to change the price of something already on the shelf',
  );
});

test('a submission never lands live', () => {
  const s = read(ROUTE);
  const post = s.slice(s.indexOf("r.post('/partner'"), s.indexOf("r.patch('/partner/:uid'"));
  assert.match(post, /'in_review'/, 'submissions go to review');
  assert.ok(!/VALUES[\s\S]{0,400}'live'/.test(post), 'a partner cannot publish straight to founders');
});

test('a rejection must carry a reason the partner reads', () => {
  const s = read(ROUTE);
  const review = s.slice(s.indexOf("r.post('/admin/:uid/review'"));
  assert.match(review, /a rejection must say why/, 'rejecting without a reason is not an option');
  assert.match(review, /requireAdmin/, 'review is admin-only');
});

test('literal partner and admin paths are registered before the :uid route', () => {
  // D1 aside, Hono matches in registration order: `/mine` registered after
  // `/:uid` would be swallowed and read as a perk uid.
  const s = read(ROUTE);
  const uidRoute = s.indexOf("r.get('/:uid'");
  for (const lit of ["r.get('/mine'", "r.get('/partner'", "r.get('/admin/queue'", "r.post('/admin/credits'"]) {
    const i = s.indexOf(lit);
    assert.ok(i > 0 && i < uidRoute, `${lit} must be registered before /:uid`);
  }
});

/* ---------------------------------------------------------------- *
 * The two zero-balance states                                       *
 * ---------------------------------------------------------------- */

test('the catalogue reports whether any allowance exists at all', () => {
  const s = read(ROUTE);
  assert.match(s, /async function allowanceConfigured/, 'the worker must answer this question');
  assert.match(s, /allowance_configured/, 'and put it on the response');
});

test('the page says "not configured" rather than "not enough" when nothing was ever granted', () => {
  const s = read(PAGE);
  assert.match(s, /!data\.allowance_configured/, 'the page must branch on it');
  assert.match(s, /No perk-credit allowance is set up/i, 'and say the true thing');
});

test('the page does not invent a monthly allowance', () => {
  // How many credits a Growth or Studio subscription includes is a commercial
  // term nobody has set. Naming a number here would put a made-up price in
  // the product.
  const code = codeOnly(read(PAGE)) + codeOnly(read(ROUTE));
  assert.ok(
    !/credits (per|a) month|monthly (credit )?allowance of|includes \d+ credits/i.test(code),
    'no invented allowance figure may ship',
  );
});

test('perk credits are labelled distinctly from introduction credits', () => {
  // Two unlabelled "credits" in one product is a trap: an intro credit buys
  // one warm introduction, a perk costs hundreds.
  const s = read(PAGE);
  assert.match(s, /perk credits/i, 'the balance must name its unit');
  assert.match(s, /introduction credits/i, 'and say what it is not');
});

/* ---------------------------------------------------------------- *
 * No invented commercial relationships                              *
 * ---------------------------------------------------------------- */

test('none of the canvas placeholder partners ship', () => {
  // The canvas names Northlake, Sablefin, Oakbridge and friends. They are
  // design placeholders; listing them would be inventing partnerships that do
  // not exist. `DIRECTORY_PREVIEWS` had exactly this problem earlier in this
  // integration and it was removed for the same reason.
  const sources = [read(PAGE), read(ROUTE), read(SQL)].join('\n');
  for (const name of ['Northlake', 'Sablefin', 'Oakbridge', 'Tessellate', 'Castellan', 'Harlow', 'Linfield', 'Brayton']) {
    assert.ok(!sources.includes(name), `${name} is a canvas placeholder and must not ship`);
  }
});

test('the empty catalogue explains itself', () => {
  const s = read(PAGE);
  assert.match(s, /No perks are listed yet/i, 'an empty marketplace must say why it is empty');
  assert.match(s, /reviewed before it appears/i, 'and that listings are vetted');
});

/* ---------------------------------------------------------------- *
 * Wiring                                                            *
 * ---------------------------------------------------------------- */

test('every api method the page calls exists and is served', () => {
  const page = read(PAGE);
  const apiSrc = read('frontend/src/lib/api.js');
  const index = read('cloudflare-worker/src/index.ts');
  const called = [...page.matchAll(/api\.(perk[A-Za-z]*)\(/g)].map((m) => m[1]);
  assert.ok(called.length >= 6, 'the page should be calling the perk surface');
  for (const m of new Set(called)) {
    assert.ok(apiSrc.includes(`${m}:`), `api.js must expose ${m}`);
  }
  assert.match(index, /app\.route\('\/api\/perks', perksRoutes\)/, 'the worker must mount it');
});

test('the route is registered for every persona, not guard([])', () => {
  // guard([]) registers a route that RoleGuard denies to everyone, because it
  // tests allowedRoles.includes(effectiveRole).
  const app = read('frontend/src/App.jsx');
  const i = app.indexOf('path="/perks"');
  assert.ok(i > 0, '/perks must be registered');
  const line = app.slice(i, app.indexOf('\n', i));
  assert.ok(!/guard\(\[\]/.test(line), 'guard([]) would deny everyone');
  for (const role of ['admin', 'founder', 'partner']) {
    assert.ok(line.includes(`'${role}'`), `${role} must be able to reach /perks`);
  }
});

test('the page converts dollars to integer cents before sending', () => {
  const s = read(PAGE);
  assert.match(s, /Math\.round\(\(Number\(form\.price_cents\) \|\| 0\) \* 100\)/,
    'money crosses the wire as an integer number of cents');
  assert.ok(!/parseFloat\(/.test(s), 'no float parsing of money');
});
