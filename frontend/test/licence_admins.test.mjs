/**
 * A subsidiary administrator, and the line this does NOT cross.
 *
 * Migration 187 built the territory-licence ledger and said plainly that it is
 * the ledger half of the tenancy model, not the scoping half. It named three
 * ROUTE_MAP rows still gated on the missing half — Admin · Subsidiary, Support
 * Security · Super, Support · Subsidiary.
 *
 * Chasing the first of those turned up something neither half covered:
 * `territory_licences` names a legal entity, a brand and a signatory, and it
 * never names a USER. "Which licence is this admin's?" had no answer, so the
 * subsidiary administrator was not representable at all.
 *
 * Migration 190 is that answer and nothing more. These tests exist to keep it
 * from growing into the scoping half by accident — a half-applied scope reads
 * as enforced and is not, which is worse than none.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const migration = read('cloudflare-worker/sql/migrations/190_licence_admins.sql');
const route = read('cloudflare-worker/src/routes/licence.ts');
// D135 — THE CODE, NOT THE PROSE. The `requireAdmin` ban below is about what
// this router USES; a comment explaining why it deliberately does not use it is
// not a use, and the raw-text version of that assertion failed on exactly such
// a comment. `codeOnly` is the repo's tool for the distinction and every
// code-shaped assertion in this file now reads through it.
const routeCode = codeOnly(route);
const adminRoute = read('cloudflare-worker/src/routes/admin_licences.ts');
const index = read('cloudflare-worker/src/index.ts');
const page = read('frontend/src/pages/subsidiary/MyLicencePage.jsx');

test('one licence per user is enforced by the schema, not by a query', () => {
  // If the index were on the pair, "the" licence would be whichever row the
  // query happened to return first — ambiguous exactly where it must not be.
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_admins_user\s*\n?\s*ON licence_admins\(user_id\);/);
  assert.doesNotMatch(migration, /ON licence_admins\(licence_id,\s*user_id\)/);
});

test('the migration is additive and seeds nothing', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS licence_admins/);
  assert.doesNotMatch(migration, /\bINSERT INTO\b/i, 'a migration that seeds rows is not idempotent here');
  assert.doesNotMatch(migration, /\bDROP\b|\bALTER TABLE\b/i);
});

test('the holder route is requireAuth, and reads only its own licence', () => {
  assert.match(routeCode, /import \{ requireAuth \}/);
  assert.doesNotMatch(routeCode, /requireAdmin/, 'a subsidiary admin is not a super admin');
  // The join through licence_admins IS the scope. No caller-supplied id.
  assert.match(routeCode, /FROM licence_admins la\s*\n?\s*JOIN territory_licences l ON l\.id = la\.licence_id\s*\n?\s*WHERE la\.user_id = \?/);

  // RE-POINTED IN D135, AND THE REASON MATTERS. This was a whole-FILE ban on
  // `c.req.param('uid')`, which pinned a SPELLING rather than the property: the
  // claim is that the LICENCE comes from the session, and D135 added a route
  // that takes a NOTICE uid — a different identifier, scoped by the session in
  // its own WHERE. The blanket ban failed a change that does not cross the line
  // it was drawn for. The sixth guard in this programme to pin a spelling.
  //
  // So the ban is bounded to the handler it was about, and the new route gets
  // the same claim asserted in the form that actually applies to it.
  const mineAt = routeCode.indexOf("r.get('/mine'");
  assert.ok(mineAt > 0, 'GET /mine moved — re-point this guard rather than deleting it');
  const nextAt = routeCode.indexOf("r.get('/notices'", mineAt);
  const mine = routeCode.slice(mineAt, nextAt > 0 ? nextAt : routeCode.length);
  assert.doesNotMatch(mine, /c\.req\.param\(|c\.req\.query\(/,
    'the licence must come from the session, never from the request');
});

test('D135 — a notice is reached by its own uid, and ONLY by its addressee', () => {
  // The same property the ban above expresses, in the form a per-row route
  // needs: ownership is in the WHERE, so a notice belonging to somebody else
  // answers 404 rather than 403 — a 403 would confirm that it exists.
  const at = routeCode.indexOf("r.post('/notices/:uid/respond'");
  assert.ok(at > 0, 'the respond route is gone');
  const handler = routeCode.slice(at, at + 1800);
  assert.match(handler, /FROM admin_notices WHERE uid = \? AND user_id = \?/,
    'a notice is looked up by uid alone, so one admin can answer another\'s notice');
  assert.match(handler, /const user = await requireAuth\(c\)/,
    'the respond route must stay on plain auth — behind requireAdmin the freeze '
    + 'would lock the addressee out of the one action that lifts it');
  // And the UPDATE is scoped too, not just the read: a check-then-write pair
  // whose write is unscoped is an unscoped write.
  assert.match(handler, /UPDATE admin_notices[\s\S]{0,400}WHERE id = \? AND user_id = \?/,
    'the response is written without re-asserting who it belongs to');
});

test('administering none is a 404, not a 403', () => {
  // They are not forbidden a licence; there is no licence of theirs. The UI
  // renders an empty state for one and an error for the other.
  assert.match(route, /error: 'no_licence'[\s\S]{0,200}\}, 404\)/);
  assert.match(page, /e\?\.status === 404/);
});

test('what cannot be computed is said, not left as a hole', () => {
  // Same rule the fund analytics follow: an unmeasured number is unknown.
  assert.match(route, /derived_metrics_available: false/);
  assert.match(route, /derived_metrics_reason/);
  assert.match(page, /Seats used is not shown/);
  // And the page must not invent one.
  assert.doesNotMatch(page, /seats_used/, 'the page must not read a field the server refuses to send');
});

test('the holder sees the same shape HQ does', () => {
  // Both go through hydrate(), so the two views cannot drift into disagreeing
  // about the same licence — including the null seats_used.
  assert.match(adminRoute, /^export async function hydrate/m);
  assert.match(route, /import \{ hydrate, type LicenceRow \} from '\.\/admin_licences'/);
});

test('HQ writes administrators, and every assignment lands in the audit trail', () => {
  for (const verb of ["r.get('/:uid/admins'", "r.post('/:uid/admins'", "r.delete('/:uid/admins/:userId{[0-9]+}'"]) {
    assert.ok(adminRoute.includes(verb), `missing ${verb}`);
  }
  assert.match(adminRoute, /administrator_added/);
  assert.match(adminRoute, /administrator_removed/);
  // An address nobody holds would create an administrator who cannot sign in.
  assert.match(adminRoute, /no account with that address/);
  // The UNIQUE index would otherwise fail opaquely.
  assert.match(adminRoute, /already administers/);
});

test('the route is mounted, and is not a new top-level root', () => {
  assert.match(index, /app\.route\('\/api\/licence', licence\);/);
  assert.match(read('frontend/src/App.jsx'), /path="\/admin\/my-licence"/);
  assert.doesNotMatch(read('frontend/src/App.jsx'), /path="\/subsidiary"/,
    'no /subsidiary root — a subsidiary admin is an admin with a licence');
});

test('this is still not the scoping half', () => {
  // The guard against scope creep. If any of these appears, the change has
  // stopped being an identity and started being a filter, and that belongs in
  // services/tenancyScope.ts behind one middleware — not here.
  assert.doesNotMatch(migration, /ALTER TABLE (?!licence_admins)/i);
  for (const forbidden of ['licence_id INTEGER', 'territory_code']) {
    assert.ok(!read('cloudflare-worker/src/services/tenancyScope.ts').includes(forbidden),
      `tenancyScope.ts gained ${forbidden} — territory scoping is a programme, not a side effect`);
  }
});
