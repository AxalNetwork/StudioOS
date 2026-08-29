/**
 * Territory licences — the ledger half of the subsidiary model.
 *
 * Three rows of ROUTE_MAP are marked "gated on the absent tenancy model". This
 * is the ledger: who holds a licence, over which countries, on what terms. It
 * is deliberately NOT the scoping half, and the most important assertions here
 * are the ones that keep that boundary honest — a half-applied tenancy scope
 * reads as enforced and is not, which is worse than none at all.
 *
 * The two business rules worth pinning are both counter-intuitive:
 *
 *   1. A territory conflict is REFUSED, not flagged. The canvas puts it well:
 *      "a conflict found after signature is an amendment to two contracts,
 *      found here it is one click."
 *   2. Suspension does NOT release territory. Everyone's intuition runs the
 *      other way, so it is enforced by the shape of the code — rows are
 *      deleted on terminate and untouched on suspend — rather than by a rule
 *      someone has to remember.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const SQL = 'cloudflare-worker/sql/migrations/187_territory_licences.sql';
const ROUTE = 'cloudflare-worker/src/routes/admin_licences.ts';
const PAGE = 'frontend/src/pages/admin/AdminLicences.jsx';

/* ---------------------------------------------------------------- *
 * Exclusivity                                                       *
 * ---------------------------------------------------------------- */

test('one country can be held by at most one licence, enforced by an index', () => {
  // The unique index is on country_code ALONE — not (licence_id,
  // country_code), which would only stop a licence duplicating its own row and
  // would let two licences hold France.
  assert.match(
    read(SQL),
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_territory_exclusive\s+ON licence_territories\(country_code\)/,
    'exclusivity must be a storage-layer constraint, not a handler check',
  );
});

test('the conflict check names the holder but the index is the guard', () => {
  const s = read(ROUTE);
  const put = s.slice(s.indexOf("r.put('/:uid/territories'"), s.indexOf("r.put('/:uid/seats'"));
  assert.match(put, /territory_conflict/, 'a conflict must be refused with a nameable reason');
  assert.match(put, /409/, 'and it is a conflict, not a validation error');
  assert.match(put, /lt\.licence_id != \?/, "a licence keeping its own country is not a conflict");
  assert.match(put, /DB\.batch\(/, 'the write must be a batch so the unique index is the final word');
});

test('a suspended licence still holds its territory', () => {
  const s = read(ROUTE);
  const suspend = s.slice(s.indexOf("r.post('/:uid/suspend'"), s.indexOf("r.post('/:uid/reinstate'"));
  // The proof is an absence: suspension must not touch licence_territories.
  assert.ok(
    !/DELETE FROM licence_territories/.test(suspend),
    'suspending must not release territory — that is a termination',
  );
  assert.match(suspend, /territory_released: false/, 'and the response must say so');

  const terminate = s.slice(s.indexOf("r.post('/:uid/terminate'"));
  assert.match(
    terminate, /DELETE FROM licence_territories WHERE licence_id = \?/,
    'termination is the only thing that releases a country',
  );
});

test('the UI states the suspension rule rather than leaving it to be inferred', () => {
  const s = read(PAGE);
  assert.match(s, /releasing (them|it) is a termination, not a lapse/i,
    'the counter-intuitive rule must be on screen');
});

test('the picker refuses rather than warns', () => {
  const s = read(PAGE);
  assert.match(s, /disabled=\{busy \|\| clashes\.length > 0\}/,
    'save must be unavailable while a clash is entered, not merely flagged');
});

/* ---------------------------------------------------------------- *
 * The boundary: ledger, not scope                                   *
 * ---------------------------------------------------------------- */

test('seats used is null, never zero', () => {
  // "0 of 325 seats used" is a false statement about a real business. Null
  // renders as "unavailable"; zero renders as "nobody signed up".
  const s = read(ROUTE);
  assert.match(s, /function seatsUsed\(\): null/, 'the unknown must be typed as unknown');
  assert.match(s, /seats_used: seatsUsed\(\)/, 'and used wherever seats are reported');
  assert.match(s, /seats_used_available: false/, 'the list response must say it is unavailable');
  assert.match(s, /seats_used_reason/, 'and say why');
});

test('no row anywhere gains a licence_id', () => {
  // The scoping half is a programme, not this migration. If a licence_id
  // appears on an existing table, tenancy has been half-applied — which reads
  // as enforced and is not.
  const s = read(SQL);
  assert.ok(!/ALTER TABLE/.test(s), 'no existing table may be altered here');
  const created = [...s.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(
    created.sort(),
    ['licence_events', 'licence_seats', 'licence_territories', 'territory_licences'],
    'exactly the four ledger tables, and nothing else',
  );
});

test('the route says out loud that it is not the scope', () => {
  const s = read(ROUTE);
  assert.match(s, /WHAT THIS IS NOT/, 'the boundary must be documented at the top of the file');
  assert.match(s, /ONE middleware/, 'and name the rule it is respecting');
});

/* ---------------------------------------------------------------- *
 * Money and rates                                                   *
 * ---------------------------------------------------------------- */

test('the fee is integer cents and the rates are integer basis points', () => {
  const s = read(SQL);
  assert.match(s, /annual_fee_cents INTEGER/, 'money is an integer number of cents');
  assert.match(s, /revenue_share_bps INTEGER/, 'a rate is integer basis points');
  assert.match(s, /token_split_bps   INTEGER|token_split_bps INTEGER/, 'both rates');
  // No float anywhere in the commercial terms.
  assert.ok(!/\b(REAL|FLOAT|DOUBLE)\b/.test(s), 'no float column in a contract ledger');
});

test('a share above 100% is clamped, not stored', () => {
  const s = read(ROUTE);
  assert.match(s, /Math\.min\(10000, Math\.max\(0, n\)\)/, '10000 bps is 100%');
});

test('the page converts entered currency to cents and shows bps as a percentage', () => {
  const s = read(PAGE);
  assert.match(s, /Math\.round\(Number\(f\.annual_fee\) \* 100\)/, 'entered units → integer cents');
  assert.ok(!/parseFloat\(/.test(s), 'no float parsing of money');
  assert.match(s, /Number\(bps\) \/ 100/, 'bps → percent happens in exactly one place');
});

/* ---------------------------------------------------------------- *
 * The five-step flow                                                *
 * ---------------------------------------------------------------- */

test('every step of the issue flow has an endpoint', () => {
  const s = read(ROUTE);
  for (const [step, marker] of [
    ['Entity', "r.post('/'"],
    ['Territory', "r.put('/:uid/territories'"],
    ['Seats', "r.put('/:uid/seats'"],
    ['Terms', "r.patch('/:uid/terms'"],
    ['Activate', "r.post('/:uid/activate'"],
  ]) {
    assert.ok(s.includes(marker), `step ${step} has no endpoint (${marker})`);
  }
  assert.match(read(PAGE), /const STEPS = \['Entity', 'Territory', 'Seats', 'Terms', 'Activate'\]/,
    'the UI must name the same five steps');
});

test('activation lists what blocks it, and a pending signature does not', () => {
  const s = read(ROUTE);
  assert.match(s, /async function activationBlockers/, 'blockers must be enumerable, not a boolean');
  assert.match(s, /A pending signature does not block activation/,
    'the canvas is explicit about this and the API must say it');
  const activate = s.slice(s.indexOf("r.post('/:uid/activate'"), s.indexOf("r.post('/:uid/suspend'"));
  assert.match(activate, /if \(blockers\.length\) return c\.json\(\{ error: 'blocked', blockers \}, 409\)/,
    'activation must refuse while anything blocks');
});

test('a draft with no territory, seats or terms cannot be activated', () => {
  const s = read(ROUTE);
  const fn = s.slice(s.indexOf('async function activationBlockers'), s.indexOf("r.get('/', async"));
  for (const need of ['No territory is assigned', 'No seats are licensed', 'Commercial terms are incomplete', 'No renewal date']) {
    assert.ok(fn.includes(need), `activation must check: ${need}`);
  }
});

/* ---------------------------------------------------------------- *
 * Audit and access                                                  *
 * ---------------------------------------------------------------- */

test('every mutation is admin-only and recorded', () => {
  const s = read(ROUTE);
  const handlers = [...s.matchAll(/r\.(post|put|patch|delete)\('([^']+)'/g)].map((m) => m[2]);
  assert.ok(handlers.length >= 9, 'the flow should have several mutations');
  // requireAdmin appears once per handler plus the two GETs.
  const admins = (s.match(/requireAdmin\(c\)/g) || []).length;
  assert.ok(admins >= handlers.length, `every mutation must call requireAdmin (${admins} vs ${handlers.length})`);
  assert.match(s, /async function logEvent/, 'state changes must be recorded');
  for (const ev of ['created', 'territory_changed', 'seats_changed', 'terms_changed',
    'activated', 'suspended', 'reinstated', 'renewed', 'terminated']) {
    assert.ok(s.includes(`'${ev}'`), `${ev} must be a logged event`);
  }
});

test('the event log is append-only', () => {
  const s = read(ROUTE);
  assert.ok(!/UPDATE licence_events|DELETE FROM licence_events/.test(s),
    'a contract dispute is exactly when an overwritten history is useless');
});

test('suspension and termination both require a recorded reason', () => {
  const s = read(ROUTE);
  assert.match(s, /a suspension must record why/);
  assert.match(s, /a termination must record why/);
});

test('the licence surface is in the recovery cool-off list', () => {
  // A licence carries an annual fee, a revenue share and an exclusive country
  // grant. Same money-adjacent class as promo minting, which is already there.
  const idx = read('cloudflare-worker/src/index.ts');
  const start = idx.indexOf('COOL_OFF_PREFIXES');
  const block = idx.slice(start, idx.indexOf('];', start));
  assert.ok(block.includes("'/api/admin/licences'"), 'a freshly-recovered admin must not issue licences');
});

test('it is mounted before the /api/admin catch-all', () => {
  const s = read('cloudflare-worker/src/index.ts');
  const mine = s.indexOf("app.route('/api/admin/licences'");
  const catchAll = s.indexOf("app.route('/api/admin', admin)");
  assert.ok(mine > 0 && catchAll > 0 && mine < catchAll,
    'a later mount would be swallowed by the generic admin router');
});

/* ---------------------------------------------------------------- *
 * Nothing invented                                                  *
 * ---------------------------------------------------------------- */

test('no subsidiary from the canvas is seeded', () => {
  // The canvas names four licensees with fees, account counts and revenue.
  // They are placeholders; seeding them would state that Axal has subsidiaries
  // it does not have.
  const sources = [read(SQL), read(ROUTE), read(PAGE)].join('\n');
  for (const name of ['AXL-001', 'AXL-002', 'AXL-003', 'AXL-004',
    'Axal VC France', 'Axal VC DACH', 'Axal VC Nordics', 'Axal VC Iberia']) {
    assert.ok(!sources.includes(name), `${name} is a canvas placeholder and must not ship`);
  }
  assert.ok(!/INSERT INTO territory_licences/.test(read(SQL)), 'the migration seeds no rows');
});

test('the empty ledger explains itself', () => {
  assert.match(read(PAGE), /No licences have been issued/i);
  assert.match(read(PAGE), /inventing one would misrepresent/i,
    'and says why it is not pre-filled');
});

test('the page does not claim a utilisation figure', () => {
  const code = codeOnly(read(PAGE));
  assert.ok(!/utilised|utilization|% used/i.test(code),
    'the canvas shows "% utilised"; without account attribution that number cannot be computed');
});

/* ---------------------------------------------------------------- *
 * Wiring                                                            *
 * ---------------------------------------------------------------- */

test('every api method the page calls exists and is served', () => {
  const page = read(PAGE);
  const apiSrc = read('frontend/src/lib/api.js');
  // No trailing `(`: several of these are passed to act() as a FUNCTION
  // REFERENCE (`act(api.licenceRenew, uid, {})`), and a regex demanding the
  // call parenthesis silently misses every one of them — which is how this
  // assertion first passed while proving less than it claimed.
  const called = [...page.matchAll(/api\.(licences?[A-Za-z]*)\b/g)].map((m) => m[1]);
  assert.ok(called.length >= 8, 'the page should exercise the flow');
  for (const m of new Set(called)) {
    assert.ok(apiSrc.includes(`${m}:`), `api.js must expose ${m}`);
  }
});

test('the route is admin-gated in the SPA too', () => {
  const app = read('frontend/src/App.jsx');
  const i = app.indexOf('path="/admin/licences"');
  assert.ok(i > 0, '/admin/licences must be registered');
  const line = app.slice(i, app.indexOf('\n', i));
  assert.match(line, /guard\(\['admin'\]/, 'admin only');
});
