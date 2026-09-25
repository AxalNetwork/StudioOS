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
import { apiMethodNames } from './_apiMethods.mjs';

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
  // D149 MOVED THE PROPERTY AND THIS ASSERTION FOLLOWED IT, INVERTED. It used
  // to read `Number(bps) / 100` here under the comment "bps → percent happens
  // in exactly one place" — which was true of this file and false of the tree:
  // the same arithmetic was written SIX times, three of them in a different
  // format. So the page must now NOT contain it, and the one-place property is
  // asserted across all of `frontend/src` by `bps_single_definition.test.mjs`.
  // A guard scoped to the file a helper happens to live in cannot see the copy
  // in the next file, which is how six of them accumulated.
  assert.match(s, /import \{ bpsPercent as pct \} from '\.\.\/\.\.\/lib\/bps'/);
  assert.ok(
    !/\/ 100\)\.toFixed\(/.test(s),
    'bps → percent is lib/bps.js\'s, not a copy in this page',
  );
});

/* ---------------------------------------------------------------- *
 * The six-step flow                                                 *
 * ---------------------------------------------------------------- */

test('every step of the issue flow has an endpoint', () => {
  // D110 — five became six. Contract and Deploy are the two the canvas draws
  // and the flow stopped short of; "Activate" was never a tab (the button sits
  // above them) and the fifth tab was really the history, which now has its
  // own unnumbered one.
  const s = read(ROUTE);
  for (const [step, marker] of [
    ['Entity', "r.post('/'"],
    ['Territory', "r.put('/:uid/territories'"],
    ['Seats', "r.put('/:uid/seats'"],
    ['Terms', "r.patch('/:uid/terms'"],
    ['Activate', "r.post('/:uid/activate'"],
    ['Contract', "r.post('/:uid/contract'"],
  ]) {
    assert.ok(s.includes(marker), `step ${step} has no endpoint (${marker})`);
  }
  // Deploy is the one step whose endpoint is NOT in the ledger, deliberately:
  // deploying does not change a licence, it creates infrastructure, and
  // folding a workflow_dispatch in beside the money writes would make every
  // reader check which was which. It still has to exist, and be reachable.
  const deployments = read('cloudflare-worker/src/routes/admin_deployments.ts');
  assert.ok(deployments.includes("r.post('/licences/:uid/deploy'"), 'step Deploy has no endpoint');
  assert.match(read('cloudflare-worker/src/index.ts'), /app\.route\('\/api\/admin', adminDeployments\)/);

  assert.match(
    read(PAGE),
    /const STEPS = \['Entity', 'Territory', 'Seats', 'Terms', 'Contract', 'Deploy'\]/,
    'the UI must name the same six steps',
  );
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
  // The gate is now `requireSuperAdmin` (migration 199): this is the
  // FRANCHISOR's console, and an admin who can issue licences is not a
  // subsidiary of anything. That is strictly stronger than what this test
  // originally asserted — `requireSuperAdmin` calls `requireAdmin` and then
  // narrows — so the claim here is unchanged in kind and tighter in degree.
  // Matching either keeps the original property (no ungated mutation) as the
  // floor; the second assertion pins the ceiling for THIS file.
  // `requireSuperAdminWriteBar` is the stronger gate (TOTP, a fresh step-up,
  // then `requireSuperAdmin`), and D262 moved terminate onto it; counting it is
  // the same floor, not a looser one.
  const gated = (s.match(/require(?:Super)?Admin(?:WriteBar)?\(c\)/g) || []).length;
  assert.ok(gated >= handlers.length, `every mutation must be gated (${gated} vs ${handlers.length})`);
  assert.doesNotMatch(s, /\brequireAdmin\b/,
    'a plain requireAdmin on the franchise console is a franchisee who can franchise');
  assert.match(s, /async function logEvent/, 'state changes must be recorded');
  for (const ev of ['created', 'territory_changed', 'seats_changed', 'terms_changed',
    'activated', 'suspended', 'reinstated', 'renewed', 'terminated']) {
    assert.ok(s.includes(`'${ev}'`), `${ev} must be a logged event`);
  }
});

test('the event log is append-only', () => {
  // D156 MADE THIS A DATABASE CONSTRAINT, AND THIS ASSERTION STAYS ANYWAY.
  // Migration 269 installs BEFORE UPDATE / BEFORE DELETE triggers on
  // `licence_events`, so the property now holds against every writer rather
  // than against the writers that happen to live in this one file — which is
  // the whole point, because a scan of the source cannot see a write that is
  // not in the source. What this keeps buying is the OTHER direction: a
  // handler that reaches for an UPDATE fails here at review time, rather than
  // shipping and raising ABORT in front of an operator. The database guard is
  // in `cloudflare-worker/test/audit_immutability_d156.test.ts`.
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

test('D248: Extend is paused by the recovery cool-off, End is not, and each admin-over-admin write is decided', () => {
  const idx = read('cloudflare-worker/src/index.ts');
  const start = idx.indexOf('const COOL_OFF_ROUTES = [');
  assert.ok(start > 0, 'the cool-off route list is gone');
  const block = idx.slice(start, idx.indexOf('];', start));
  for (const route of [
    '/api/admin/impersonate-sessions/:id/extend',
    '/api/admin/super-admins/:userId',
    '/api/admin/users/:userId/toggle-active',
    '/api/admin/users/:userId/role',
    // D259 — the two acts HQ takes into a branch's database.
    '/api/admin/branches/:code/support-session',
    '/api/admin/branches/:code/accounts/:userId/move',
    // D262 — unbinding a branch's administrator, and HQ's demote-admin.
    '/api/admin/branches/:code/admins/:userId/unbind',
    '/api/admin/users/:userId/demote-admin',
  ]) assert.ok(block.includes(`'${route}'`), `${route} is not paused during the cool-off`);
  // D262 decided these three stay open: none gives power over an administrator,
  // money or another tenant.
  for (const open of ['access-level', 'spinout-admit', 'spinout-applications']) {
    assert.ok(!block.includes(open), `${open} was added to the cool-off; D262 decided it stays open`);
  }
  // Registered as the route itself, never with a wildcard: `${p}/*` on a
  // parent would reach End.
  assert.match(idx, /for \(const p of COOL_OFF_ROUTES\) app\.use\(p, recoveryCoolOff\);/);
  // What must stay open: End (the safe direction), the holder list, every
  // other /users route, and force re-auth. A PREFIX here would take them all.
  const pStart = idx.indexOf('const COOL_OFF_PREFIXES = [');
  const prefixes = idx.slice(pStart, idx.indexOf('];', pStart));
  // D259 — `/api/admin/branches` joins them: a prefix there would pause the
  // next HQ→branch route before anyone had decided it.
  for (const parent of ['/api/admin/impersonate-sessions', '/api/admin/super-admins', '/api/admin/users', '/api/admin/security', '/api/admin/branches']) {
    assert.ok(!prefixes.includes(`'${parent}'`), `${parent} is a cool-off PREFIX, which pauses every route under it`);
  }
  assert.ok(!block.includes('/end'), 'End is paused by the cool-off; ending a session is the safe direction');
  assert.ok(!block.includes('/api/admin/security'), 'force re-auth is paused; it ends sessions and grants nothing');
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
  // Not apiCallsIn() here: six of these are passed to act() as a FUNCTION
  // REFERENCE (`act(api.licenceRenew, uid, {})`) with no call parenthesis, so
  // a caller-shaped pattern misses them. The name match stays; only the
  // definition side becomes exact.
  const called = [...new Set([...page.matchAll(/api\.(licences?[A-Za-z]*)\b/g)].map((m) => m[1]))];
  assert.ok(called.length >= 8, 'the page should exercise the flow');
  const defined = apiMethodNames(apiSrc);
  for (const m of called) {
    assert.ok(defined.has(m), `api.js must expose ${m}`);
  }
});

test('the route is admin-gated in the SPA too', () => {
  const app = read('frontend/src/App.jsx');
  const i = app.indexOf('path="/admin/licences"');
  assert.ok(i > 0, '/admin/licences must be registered');
  const line = app.slice(i, app.indexOf('\n', i));
  assert.match(line, /guard\(\['admin'\]/, 'admin only');
});
