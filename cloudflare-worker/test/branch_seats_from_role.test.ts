/**
 * Seats used is a definition, and this is what stops it drifting from the
 * contract it is measured against (D127).
 *
 * WHAT WAS DECIDED. A seat is a consequence of `users.role`. There is no seat
 * ledger: no seat has an id, none is assigned or released, and a vacant seat
 * cannot be shown. That is the product owner's call rather than a measurement,
 * and D127 records it as one — so what a guard can usefully hold is not "the
 * number is right" but "the number counts the roles the CONTRACT sells a seat
 * for, and says what it is".
 *
 * THE DRIFT THIS EXISTS FOR, stated concretely. `licence_seats.seat_type`
 * (migration 187) is the vocabulary a licence is sold in. If a fifth seat type
 * is ever added there — `service_partner`, say, which the Super Admin canvas
 * already names as a licence type — and `SEAT_ROLES` is not extended with it,
 * every branch under-reports its seats used against what HQ sold it. Nothing
 * would fail: the sum is still a sum, the page still renders, and the figure is
 * simply wrong on the one screen where "seats used against seats licensed" is
 * the whole point. So the two lists are compared rather than kept in step by
 * care.
 *
 * AND `users.role` MUST STILL ADMIT THEM. The count reads `users.role`, so a
 * seat type with no corresponding role would count zero for ever. The baseline
 * CHECK is parsed for that too.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEAT_ROLES } from '../src/rpc/branchOps.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

/**
 * The `users` DDL out of the baseline, bounded to its own statement.
 *
 * ANCHORED AT COLUMN 0 AND ON THE EXACT FORM THE FILE USES. A first draft
 * looked for `CREATE TABLE IF NOT EXISTS users`, which the baseline does not
 * contain — `indexOf` returned -1, `slice(-1)` handed back the file's last
 * character, and the failure read as "the CHECK constraint moved or was
 * dropped" rather than "this test cannot find the table". A missing anchor
 * must fail as a missing anchor.
 */
function usersDdl(baseline: string): string {
  const at = baseline.indexOf('\nCREATE TABLE users (');
  assert.ok(at >= 0, 'the baseline no longer declares `users` in the form this test reads');
  const end = baseline.indexOf('\n);', at);
  assert.ok(end > at, 'the users DDL is not terminated');
  return baseline.slice(at, end);
}

/** The values inside a `CHECK (<column> IN ('a', 'b', …))` in some DDL. */
function checkVocabulary(ddl: string, column: string): string[] {
  const at = ddl.indexOf(`CHECK (${column} IN (`);
  assert.ok(at >= 0, `no CHECK vocabulary for ${column} — the constraint moved or was dropped`);
  const open = ddl.indexOf('(', ddl.indexOf(' IN ', at));
  const close = ddl.indexOf(')', open);
  assert.ok(close > open, `the CHECK for ${column} is not terminated`);
  return [...ddl.slice(open + 1, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('SEAT_ROLES is exactly the vocabulary a licence sells seats in', () => {
  const seatTypes = checkVocabulary(
    read('cloudflare-worker/sql/migrations/187_territory_licences.sql'),
    'seat_type',
  );
  assert.deepEqual(
    [...SEAT_ROLES].sort(),
    [...seatTypes].sort(),
    'SEAT_ROLES and licence_seats.seat_type disagree — a branch is counting seats the contract does not sell, or missing ones it does',
  );
});

test('every seat role is a role a user can actually hold', () => {
  // A seat type with no matching `users.role` value would count zero for ever,
  // silently. The baseline is the canonical schema a branch is bootstrapped
  // from, so it is the right place to ask.
  const roles = checkVocabulary(usersDdl(read('cloudflare-worker/sql/schema_baseline.sql')), 'role');
  assert.ok(roles.length >= 4, `users.role vocabulary did not parse — got ${roles.join(', ')}`);
  const orphans = SEAT_ROLES.filter((r) => !roles.includes(r));
  assert.deepEqual(orphans, [], 'these seat roles are not values users.role admits, so they would always count zero');
});

test('the two roles that hold no seat are named, and they are the right two', () => {
  // Not "SEAT_ROLES is shorter than the role list" — that passes however the
  // difference is made up. The excluded set must be exactly `admin` and
  // `exploring`: an admin administers the territory rather than occupying a
  // licensed seat, and `exploring` is precisely S2's Exploring board — someone
  // who signed up and holds no licence. If a new role appears, this fails and
  // somebody decides which side it is on, which is the point.
  const roles = checkVocabulary(usersDdl(read('cloudflare-worker/sql/schema_baseline.sql')), 'role');
  const seatless = roles.filter((r) => !(SEAT_ROLES as readonly string[]).includes(r)).sort();
  assert.deepEqual(seatless, ['admin', 'exploring'],
    'the set of roles holding no seat changed — decide whether the new role occupies one before this figure ships');
});

test('the branch counts seats and HQ does not, and both say why', () => {
  // The asymmetry is structural (D127) and must not be tidied away by someone
  // making the two tiers "consistent". A branch can count because every user in
  // its D1 is its own; HQ cannot, because no account names a licence (U1).
  const branchOps = read('cloudflare-worker/src/rpc/branchOps.ts');
  const hq = read('cloudflare-worker/src/routes/admin_licences.ts');
  assert.match(branchOps, /seats_used:\s*seatsUsed\b/, 'the branch stopped counting its seats');
  assert.match(hq, /function seatsUsed\(\): null \{ return null; \}/, 'HQ started claiming a figure it cannot compute');
  assert.match(hq, /D127/, "HQ's null no longer explains why the branch differs");
});

test('the reason retires the store that is not coming', () => {
  // The old reason said seats used "needs `seat_assignments` … No such store
  // exists yet on either tier", which read as a gap about to be closed. It is
  // not being closed, so the sentence had to go rather than be softened — a
  // stale reason that still reads plausibly is what the next surface cites.
  // ANCHORED INSIDE `branchOverview`, because `seats_used_reason:` appears
  // TWICE — once in the type, once as the value — and the type match carries
  // no sentence to check. Reading the first one would pass this test against a
  // reason that still promised the store. That is the same miss the previous
  // commit fixed in `hq_revenue_h5.test.mjs`, one file along.
  const branchOps = read('cloudflare-worker/src/rpc/branchOps.ts');
  const fnAt = branchOps.indexOf('export async function branchOverview');
  assert.ok(fnAt > 0, 'branchOverview moved');
  const reasonAt = branchOps.indexOf('seats_used_reason:', fnAt);
  assert.ok(reasonAt > fnAt, 'the seats-used reason is gone from branchOverview');
  const reason = branchOps.slice(reasonAt, branchOps.indexOf('backlog,', reasonAt));
  assert.doesNotMatch(reason, /seat_assignments/, 'the reason still promises a store nothing builds');
  assert.match(reason, /Role is not the same thing as a licensed seat/);
});

test('the licence page and the overview count the same thing', () => {
  // Two readers, one definition. They drifted apart once already in this repo
  // for deck categories (#207), and a branch admin comparing its own licence
  // page against what HQ's card shows is exactly who would notice.
  const licence = read('cloudflare-worker/src/routes/licence.ts');
  // THE PROPERTY, NOT THE LINE. This pinned the literal
  // `import { SEAT_ROLES } from '../rpc/branchOps'` until D244 added a second
  // name to that import, which failed the test on a change that kept the rule.
  // What the rule needs is that SEAT_ROLES arrives from branchOps by name and
  // that nothing declares a local copy beside it.
  const fromBranchOps = [...licence.matchAll(/import \{([^}]*)\} from '\.\.\/rpc\/branchOps'/g)]
    .flatMap((m) => m[1].split(',').map((n) => n.trim()));
  assert.ok(fromBranchOps.includes('SEAT_ROLES'),
    'the licence page must take the seat roles from one place, not re-list them');
  assert.doesNotMatch(licence, /\b(?:const|let|var)\s+SEAT_ROLES\b/,
    'the licence page declares its own seat roles beside the shared ones');
  // THE SAME QUERY, not merely the same list. Both readers run
  // `SELECT role, COUNT(*) … WHERE is_active = 1 GROUP BY role` and sum over
  // SEAT_ROLES in JavaScript — which is also why neither interpolates into
  // query text, the thing `check-sql-prepare` refused in the first draft.
  const SHARED_SQL = "'SELECT role, COUNT(*) AS n FROM users WHERE is_active = 1 GROUP BY role'";
  assert.ok(licence.includes(SHARED_SQL), 'the licence page asks a different question than the overview');
  assert.ok(read('cloudflare-worker/src/rpc/branchOps.ts').includes(SHARED_SQL),
    'the overview asks a different question than the licence page');
  assert.doesNotMatch(licence, /role IN \(\$\{/, 'nothing may reach the query text');
});
