/**
 * Scope capital-call data per investor (IDOR fix).
 *
 * GET /api/capital/calls previously returned EVERY row in capital_calls to any
 * authenticated investor, and POST /api/capital/calls/:id/pay let any investor
 * act on any call by id. These route-level tests lock in the per-investor
 * scoping + ownership guard (admins remain unrestricted):
 *
 *   - a non-admin investor only sees capital calls tied to their own LP
 *     record(s) (limited_partners.user_id);
 *   - an investor cannot pay a call that belongs to someone else (404, and the
 *     call is NOT marked paid);
 *   - an admin still sees every call and can act on any call.
 *
 * Task #20 extends the same per-investor scoping to the LP-record routes:
 *   - GET /investors returns only the caller's own LP record(s) (admins: all);
 *   - GET /investors/:id 404s for an LP the caller doesn't own, so neither the
 *     LP record nor its capital_calls leak by guessing ids (admins: any).
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/capital.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import capital from '../src/routes/capital.ts';
import { makeD1 } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // >= 32 bytes

const ADMIN_ID = 1;
const OWNER_ID = 10; // investor whose LP owns call #1
const OTHER_ID = 20; // a different investor (owns call #2)

// LP records: lp #100 -> OWNER_ID, lp #200 -> OTHER_ID.
const LPS = [
  { id: 100, user_id: OWNER_ID },
  { id: 200, user_id: OTHER_ID },
];

// Two pending capital calls, one per LP (distinct created_at for ordering).
const CALLS = [
  { id: 1, limited_partner_id: 100, project_id: null, amount: 500, status: 'pending', created_at: '2026-01-02' },
  { id: 2, limited_partner_id: 200, project_id: null, amount: 700, status: 'pending', created_at: '2026-01-01' },
];

async function mintToken(userId: number, role: string): Promise<string> {
  // No `jti` so getCurrentUser skips the user_sessions revocation lookup.
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/**
 * A real in-memory database behind the D1 binding.
 *
 * This used to be a chain of `if (sql.includes(...))` branches, each returning
 * a hand-built row set. That stub could not distinguish a correct ownership
 * predicate from an incorrect one — it only knew which substrings it had been
 * taught — so when the predicate moved into `lpMembershipScope` every branch
 * missed and five IDOR tests went red without a single behavioural change.
 *
 * Retuning the matchers would have made the suite green and hollow: tests that
 * exist to stop one investor reading another's capital calls would have been
 * asserting that a query *looks* a certain way. These now run the route's real
 * SQL, with its real binds, against SQLite — which is what D1 is. A scoping
 * regression fails them because the wrong rows come back.
 *
 * LP #300 is new here and is the point of the change: a legacy LP row with no
 * `user_id`, carrying LEGACY_EMAIL. It is unreachable under the old
 * `user_id = ?` predicate and reachable under the consolidated one.
 */
const LEGACY_ID = 30;
const LEGACY_EMAIL = 'legacy@lp.example';

const SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT, is_active INTEGER DEFAULT 1);
CREATE TABLE vc_funds (
  id INTEGER PRIMARY KEY, name TEXT, status TEXT DEFAULT 'active',
  total_commitment REAL DEFAULT 0, deployed_capital REAL DEFAULT 0, lp_count INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT);
CREATE TABLE partners (id INTEGER PRIMARY KEY, name TEXT, status TEXT DEFAULT 'active');
CREATE TABLE limited_partners (
  id INTEGER PRIMARY KEY, fund_id INTEGER, user_id INTEGER, name TEXT, email TEXT,
  commitment_amount REAL DEFAULT 0, invested_amount REAL DEFAULT 0, returns REAL DEFAULT 0,
  status TEXT DEFAULT 'active', created_at TEXT DEFAULT '2026-01-01', updated_at TEXT);
CREATE TABLE capital_calls (
  id INTEGER PRIMARY KEY, limited_partner_id INTEGER, project_id INTEGER,
  amount REAL, status TEXT DEFAULT 'pending', due_date TEXT, paid_date TEXT,
  created_at TEXT DEFAULT '2026-01-01');
CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, sector TEXT);
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT,
  body TEXT, link TEXT, created_at TEXT);
`;

function seedFor(user: any): string {
  const rows = [
    { id: ADMIN_ID, email: 'admin@axal.vc', role: 'admin' },
    { id: OWNER_ID, email: 'owner@lp.example', role: 'investor' },
    { id: OTHER_ID, email: 'other@lp.example', role: 'investor' },
    { id: LEGACY_ID, email: LEGACY_EMAIL, role: 'investor' },
  ];
  // The caller's own row must reflect the role the token claims, so auth
  // resolves the same actor the test intends.
  const users = rows
    .map((r) => {
      const role = user && user.id === r.id ? user.role : r.role;
      return `(${r.id}, '${r.email}', 'U${r.id}', '${role}', 1)`;
    })
    .join(', ');
  return `
INSERT INTO users (id, email, name, role, is_active) VALUES ${users};
INSERT INTO vc_funds (id, name) VALUES (1, 'Fund I');
INSERT INTO limited_partners (id, fund_id, user_id, name, email, commitment_amount, status, created_at)
  VALUES (100, 1, ${OWNER_ID}, 'Owner LP', 'owner@lp.example', 500, 'active', '2026-01-02'),
         (200, 1, ${OTHER_ID}, 'Other LP', 'other@lp.example', 700, 'active', '2026-01-01'),
         (300, 1, NULL,        'Legacy LP', '${LEGACY_EMAIL}',  900, 'active', '2026-01-03');
INSERT INTO capital_calls (id, limited_partner_id, amount, status, created_at)
  VALUES (1, 100, 500, 'pending', '2026-01-02'),
         (2, 200, 700, 'pending', '2026-01-01'),
         (3, 300, 900, 'pending', '2026-01-03');
INSERT INTO projects (id, name, sector) VALUES (1, 'Test Project', 'ai');
`;
}

function makeEnv(user: any): any {
  const { DB, db } = makeD1(SCHEMA, seedFor(user));
  return { JWT_SECRET, ENVIRONMENT: 'development', DB, __db: db };
}

function listCalls(env: any, token: string, query = ''): Promise<Response> {
  return capital.request('/calls' + query, { headers: { Authorization: `Bearer ${token}` } }, env);
}

function payCall(env: any, token: string, id: number): Promise<Response> {
  return capital.request(`/calls/${id}/pay`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, env);
}

// --- GET /calls scoping ----------------------------------------------------

test('calls list: admin sees every capital call', async () => {
  const token = await mintToken(ADMIN_ID, 'admin');
  const env = makeEnv({ id: ADMIN_ID, role: 'admin', is_active: 1 });
  const res = await listCalls(env, token);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any[];
  assert.deepEqual(body.map((c) => c.id).sort(), [1, 2, 3]);
});

test('calls list: a non-admin investor only sees their own LP calls', async () => {
  const token = await mintToken(OWNER_ID, 'investor');
  const env = makeEnv({ id: OWNER_ID, role: 'investor', is_active: 1 });
  const res = await listCalls(env, token);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any[];
  assert.deepEqual(body.map((c) => c.id), [1]);
  // Cross-tenant guard: the other investor's call (#2) must NOT leak.
  assert.ok(!body.some((c) => c.id === 2));
});

test('calls list: a different investor sees only their own (disjoint) calls', async () => {
  const token = await mintToken(OTHER_ID, 'investor');
  const env = makeEnv({ id: OTHER_ID, role: 'investor', is_active: 1 });
  const res = await listCalls(env, token);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any[];
  assert.deepEqual(body.map((c) => c.id), [2]);
});

test('calls list: investor scoping still honors the status filter', async () => {
  const token = await mintToken(OWNER_ID, 'investor');
  const env = makeEnv({ id: OWNER_ID, role: 'investor', is_active: 1 });
  const pending = (await (await listCalls(env, token, '?status=pending')).json()) as any[];
  assert.deepEqual(pending.map((c) => c.id), [1]);
  const paid = (await (await listCalls(env, token, '?status=paid')).json()) as any[];
  assert.deepEqual(paid, []);
});

// --- POST /calls/:id/pay ownership guard -----------------------------------

test('pay: an investor cannot pay a call that is not theirs (404, not mutated)', async () => {
  const token = await mintToken(OTHER_ID, 'investor');
  const env = makeEnv({ id: OTHER_ID, role: 'investor', is_active: 1 });
  // call #1 belongs to OWNER_ID's LP, not OTHER_ID.
  const res = await payCall(env, token, 1);
  assert.equal(res.status, 404);
  const body = (await res.json()) as any;
  assert.notEqual(body.status, 'paid');
});

test('pay: an investor can pay a call that belongs to their own LP (200)', async () => {
  const token = await mintToken(OWNER_ID, 'investor');
  const env = makeEnv({ id: OWNER_ID, role: 'investor', is_active: 1 });
  const res = await payCall(env, token, 1);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.status, 'paid');
});

test('pay: an admin can pay any capital call (200)', async () => {
  const token = await mintToken(ADMIN_ID, 'admin');
  const env = makeEnv({ id: ADMIN_ID, role: 'admin', is_active: 1 });
  const res = await payCall(env, token, 2);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.status, 'paid');
});

// --- GET /investors scoping (Task #20) -------------------------------------

function listInvestors(env: any, token: string): Promise<Response> {
  return capital.request('/investors', { headers: { Authorization: `Bearer ${token}` } }, env);
}

function getInvestor(env: any, token: string, id: number): Promise<Response> {
  return capital.request(`/investors/${id}`, { headers: { Authorization: `Bearer ${token}` } }, env);
}

test('investors list: admin sees every LP record', async () => {
  const token = await mintToken(ADMIN_ID, 'admin');
  const env = makeEnv({ id: ADMIN_ID, role: 'admin', is_active: 1 });
  const res = await listInvestors(env, token);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any[];
  assert.deepEqual(body.map((lp) => lp.id).sort((a, b) => a - b), [100, 200, 300]);
});

test('investors list: a non-admin investor only sees their own LP record', async () => {
  const token = await mintToken(OWNER_ID, 'investor');
  const env = makeEnv({ id: OWNER_ID, role: 'investor', is_active: 1 });
  const res = await listInvestors(env, token);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any[];
  assert.deepEqual(body.map((lp) => lp.id), [100]);
  // Cross-tenant guard: the other investor's LP (#200) must NOT leak.
  assert.ok(!body.some((lp) => lp.id === 200));
});

test('investors list: a different investor sees only their own (disjoint) LP', async () => {
  const token = await mintToken(OTHER_ID, 'investor');
  const env = makeEnv({ id: OTHER_ID, role: 'investor', is_active: 1 });
  const res = await listInvestors(env, token);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any[];
  assert.deepEqual(body.map((lp) => lp.id), [200]);
});

// --- GET /investors/:id scoping (Task #20) ---------------------------------

test('investor detail: an investor can read their own LP record + its calls', async () => {
  const token = await mintToken(OWNER_ID, 'investor');
  const env = makeEnv({ id: OWNER_ID, role: 'investor', is_active: 1 });
  const res = await getInvestor(env, token, 100);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.id, 100);
  assert.deepEqual(body.capital_calls.map((cc: any) => cc.id), [1]);
});

test('investor detail: an investor canNOT read another LP record (404, no calls leaked)', async () => {
  const token = await mintToken(OTHER_ID, 'investor');
  const env = makeEnv({ id: OTHER_ID, role: 'investor', is_active: 1 });
  // LP #100 belongs to OWNER_ID, not OTHER_ID — must 404 with no LP/calls data.
  const res = await getInvestor(env, token, 100);
  assert.equal(res.status, 404);
  const body = (await res.json()) as any;
  assert.equal(body.capital_calls, undefined);
  assert.notEqual(body.id, 100);
});

test('investor detail: an admin can read any LP record + its calls', async () => {
  const token = await mintToken(ADMIN_ID, 'admin');
  const env = makeEnv({ id: ADMIN_ID, role: 'admin', is_active: 1 });
  const res = await getInvestor(env, token, 200);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.id, 200);
  assert.deepEqual(body.capital_calls.map((cc: any) => cc.id), [2]);
});

// --- Task #9: the three capital write/issue routes are admin-only -----------
// Adding an LP record (POST /investors), creating a call against one LP
// (POST /calls), and issuing a call to every active investor (POST /capitalCall)
// are fund/GP operations. They were previously gated by canViewLpData (admin OR
// investor), so any investor could add LPs and issue capital calls. They now
// require role==='admin' and return 403 for investors. The read routes and the
// pay-own-call route (covered above) stay investor-accessible.

function addInvestor(env: any, token: string, body: any): Promise<Response> {
  return capital.request('/investors', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, env);
}

function createCall(env: any, token: string, body: any): Promise<Response> {
  return capital.request('/calls', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, env);
}

function issueToAllInvestors(env: any, token: string, body: any): Promise<Response> {
  return capital.request('/capitalCall', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, env);
}

test('add investor: a non-admin investor is forbidden (403)', async () => {
  const token = await mintToken(OWNER_ID, 'investor');
  const env = makeEnv({ id: OWNER_ID, role: 'investor', is_active: 1 });
  const res = await addInvestor(env, token, { name: 'New LP', email: 'new@lp.com', committed_capital: 1000 });
  assert.equal(res.status, 403);
});

test('add investor: an admin is allowed (201)', async () => {
  const token = await mintToken(ADMIN_ID, 'admin');
  const env = makeEnv({ id: ADMIN_ID, role: 'admin', is_active: 1 });
  const res = await addInvestor(env, token, { name: 'New LP', email: 'new@lp.com', committed_capital: 1000 });
  assert.equal(res.status, 201);
  const body = (await res.json()) as any;
  // A real INSERT, so the id comes from the database. The old stub returned a
  // hardcoded 999 for any INSERT, which is also why it never noticed that this
  // route's `NOW()` is not a SQLite function and threw against D1.
  assert.ok(Number.isInteger(body.id) && body.id > 0, 'the LP row was really inserted');
  assert.equal(body.name, 'New LP');
  assert.equal(body.email, 'new@lp.com');
});

test('create call: a non-admin investor is forbidden (403)', async () => {
  const token = await mintToken(OWNER_ID, 'investor');
  const env = makeEnv({ id: OWNER_ID, role: 'investor', is_active: 1 });
  const res = await createCall(env, token, { limited_partner_id: 100, amount: 500, due_date: '2026-03-01' });
  assert.equal(res.status, 403);
});

test('create call: an admin is allowed (201)', async () => {
  const token = await mintToken(ADMIN_ID, 'admin');
  const env = makeEnv({ id: ADMIN_ID, role: 'admin', is_active: 1 });
  const res = await createCall(env, token, { limited_partner_id: 100, amount: 500, due_date: '2026-03-01' });
  assert.equal(res.status, 201);
  const body = (await res.json()) as any;
  assert.equal(body.amount, 500);
  assert.equal(body.lp_investor_id, 100);
});

test('issue-to-all: a non-admin investor is forbidden (403)', async () => {
  const token = await mintToken(OWNER_ID, 'investor');
  const env = makeEnv({ id: OWNER_ID, role: 'investor', is_active: 1 });
  const res = await issueToAllInvestors(env, token, { startup_id: 1, amount: 1000 });
  assert.equal(res.status, 403);
});

test('issue-to-all: an admin is allowed and fans out to active investors (200)', async () => {
  const token = await mintToken(ADMIN_ID, 'admin');
  const env = makeEnv({ id: ADMIN_ID, role: 'admin', is_active: 1 });
  const res = await issueToAllInvestors(env, token, { startup_id: 1, amount: 1000 });
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.calls_created.length, 3, 'one call per active LP row');
  // The route splits the total across active LPs and rounds to cents, so three
  // ways leaves a residual: 3 x 333.33 is 999.99, not 1000. Asserted rather
  // than smoothed over — `amount` here is a legacy float dollars column, and
  // making the split whole is a money-representation change to a route this
  // work does not otherwise touch.
  assert.equal(body.calls_created[0].amount, 333.33);
  const dealt = body.calls_created.reduce((sum: number, x: any) => sum + x.amount, 0);
  assert.equal(Number(dealt.toFixed(2)), 999.99, 'a cent is left undealt by the even split');
  assert.equal(body.total_amount, 1000, 'the total reported is still the amount requested');
});

// --- the legacy LP (task #175) ---------------------------------------------
// LP #300 has a real position and a NULL user_id — a "legacy LP migrated from
// lp_investors", in funds.ts's own words. Under `user_id = ?` this person was
// refused their own LP record and their own capital call while the platform
// went on issuing calls against the row. These tests are only possible against
// a real database: the outcome depends on what the SQL returns.

function legacyEnv() {
  return makeEnv({ id: LEGACY_ID, role: 'investor', is_active: 1 });
}

test('legacy LP: reaches their own LP record through the verified account email', async () => {
  const token = await mintToken(LEGACY_ID, 'investor');
  const env = legacyEnv();
  const res = await listInvestors(env, token);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any[];
  assert.deepEqual(body.map((lp) => lp.id), [300]);
});

test('legacy LP: reaches the capital call issued against that row', async () => {
  const token = await mintToken(LEGACY_ID, 'investor');
  const env = legacyEnv();
  const body = (await (await listCalls(env, token)).json()) as any[];
  assert.deepEqual(body.map((c) => c.id), [3]);
});

test('legacy LP: the row is CLAIMED on first access, not granted forever', async () => {
  const token = await mintToken(LEGACY_ID, 'investor');
  const env = legacyEnv();
  const before = env.__db.prepare('SELECT user_id FROM limited_partners WHERE id = 300').get();
  assert.equal(before.user_id, null, 'starts unclaimed');
  await listInvestors(env, token);
  const after = env.__db.prepare('SELECT user_id FROM limited_partners WHERE id = 300').get();
  assert.equal(after.user_id, LEGACY_ID, 'the email match became a permanent account link');
});

test('claiming never re-points a row that already belongs to someone else', async () => {
  // Two rows now carry the legacy address: #300, unclaimed, and #200, which
  // OTHER_ID already owns. `limited_partners.email` is operator-entered, so
  // this is an ordinary data-entry outcome rather than an exotic one. The
  // caller is the account that actually holds the address, and even so only
  // the unclaimed row may move — reassignment is an administrative act, not a
  // side effect of a GET.
  const token = await mintToken(LEGACY_ID, 'investor');
  const env = legacyEnv();
  env.__db.exec(`UPDATE limited_partners SET email = '${LEGACY_EMAIL}' WHERE id = 200`);
  await listInvestors(env, token);
  const rows = env.__db.prepare('SELECT id, user_id FROM limited_partners ORDER BY id').all();
  assert.deepEqual(
    rows.map((r: any) => [r.id, r.user_id]),
    [[100, OWNER_ID], [200, OTHER_ID], [300, LEGACY_ID]],
    'row 200 keeps its owner; only the unclaimed row 300 is linked',
  );
});

test('a claimed row is never reachable by another account holding the same address', async () => {
  // The email arm is qualified by `user_id IS NULL`. Without that qualifier
  // the LEGACY user would reach row #200 — which OTHER_ID owns — purely
  // because the denormalized email column names their address.
  const token = await mintToken(LEGACY_ID, 'investor');
  const env = legacyEnv();
  env.__db.exec(`UPDATE limited_partners SET email = '${LEGACY_EMAIL}' WHERE id = 200`);
  const body = (await (await listInvestors(env, token)).json()) as any[];
  assert.ok(!body.some((lp) => lp.id === 200), 'a row with an owner is reachable only by its owner');
  assert.deepEqual(body.map((lp) => lp.id), [300]);
});

test('legacy LP: cannot reach anyone else’s LP record by id', async () => {
  const token = await mintToken(LEGACY_ID, 'investor');
  const res = await getInvestor(legacyEnv(), token, 100);
  assert.equal(res.status, 404);
});

test('paying a capital call really marks it paid and moves the money', async () => {
  // The old stub swallowed every UPDATE as a no-op, so this route's `NOW()` —
  // not a SQLite function, and D1 is SQLite — threw in production while the
  // test suite stayed green. Assert the writes, not just the status code.
  const token = await mintToken(OWNER_ID, 'investor');
  const env = makeEnv({ id: OWNER_ID, role: 'investor', is_active: 1 });
  const res = await payCall(env, token, 1);
  assert.equal(res.status, 200);
  const call = env.__db.prepare('SELECT status, paid_date FROM capital_calls WHERE id = 1').get();
  assert.equal(call.status, 'paid');
  assert.ok(call.paid_date, 'paid_date is stamped');
  const lp = env.__db.prepare('SELECT invested_amount FROM limited_partners WHERE id = 100').get();
  assert.equal(lp.invested_amount, 500, 'the call amount is recorded as invested');
  const fund = env.__db.prepare('SELECT deployed_capital FROM vc_funds WHERE id = 1').get();
  assert.equal(fund.deployed_capital, 500, 'and as deployed against the fund');
});
