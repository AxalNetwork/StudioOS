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

function sortByCreatedDesc<T extends { created_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

/**
 * In-memory D1 stub backed by a tiny LP + capital_calls dataset. getSQL() runs
 * every statement (incl. UPDATE) through prepare().bind().all(), so all routing
 * logic lives in all(); UPDATEs fall through as no-ops. The notify LP lookup
 * returns a null user_id so the best-effort notification path is skipped.
 */
function makeEnv(user: any): any {
  const calls = CALLS.map((c) => ({ ...c }));
  const handle = (rawSql: string) => {
    const s = rawSql.toLowerCase();
    let bound: any[] = [];
    const api: any = {
      bind: (...a: any[]) => { bound = a; return api; },
      async all() {
        // Auth: resolve the JWT's user_id to a users row.
        if (s.includes('from users where id')) {
          return { results: user ? [user] : [] };
        }
        // --- Task #9: happy-path stubs for the admin-only write/issue routes.
        // These only matter for the admin "allowed" cases; the investor cases
        // 403 before any SQL runs.
        // get-or-create fund (POST /investors).
        if (s.includes('from vc_funds') && s.includes('where name')) {
          return { results: [{ id: 1, name: bound[0] }] };
        }
        // INSERT INTO limited_partners ... RETURNING * (POST /investors).
        if (s.includes('insert into limited_partners')) {
          return { results: [{ id: 999, fund_id: bound[0], name: bound[1], email: bound[2], commitment_amount: bound[3], invested_amount: 0, status: 'active' }] };
        }
        // INSERT INTO capital_calls ... RETURNING * (POST /calls).
        if (s.includes('insert into capital_calls') && s.includes('returning')) {
          return { results: [{ id: 999, limited_partner_id: bound[0], project_id: bound[1] ?? null, amount: bound[2], status: 'pending', due_date: bound[3] ?? null, created_at: '2026-02-01' }] };
        }
        // Resolve a single LP by id (POST /calls lp lookup).
        if (s.includes('select id from limited_partners where id')) {
          const row = LPS.find((lp) => lp.id === bound[0]);
          return { results: row ? [{ id: row.id }] : [] };
        }
        // Active-LP fan-out (POST /capitalCall issue-to-all).
        if (s.includes('from limited_partners') && s.includes("status = 'active'")) {
          return { results: LPS.map((lp) => ({ id: lp.id, name: `LP ${lp.id}`, status: 'active' })) };
        }
        // Project lookup (POST /capitalCall).
        if (s.includes('from projects')) {
          return { results: [{ id: bound[0] ?? 1, name: 'Test Project', sector: 'ai' }] };
        }
        // Best-effort notify lookup -> null user disables notifications in tests.
        if (s.includes('select user_id from limited_partners')) {
          return { results: [{ user_id: null }] };
        }
        // Ownership probe in the pay route (SELECT 1 ... AND user_id = ?).
        if (s.includes('from limited_partners') && s.includes('and user_id')) {
          const [lpId, uid] = bound;
          const owns = LPS.some((lp) => lp.id === lpId && lp.user_id === uid);
          return { results: owns ? [{ '1': 1 }] : [] };
        }
        // Investor list / detail (limited_partners JOIN vc_funds) — Task #20
        // per-investor scoping. The detail query carries WHERE lp.id (and, for
        // non-admins, AND lp.user_id); the list carries an optional WHERE
        // lp.user_id for non-admins. Admin variants have no user_id filter.
        if (s.includes('from limited_partners lp') && s.includes('join vc_funds')) {
          if (s.includes('where lp.id')) {
            const lpId = bound[0];
            const uid = s.includes('and lp.user_id') ? bound[1] : null;
            let row = LPS.find((lp) => lp.id === lpId);
            if (uid != null && (!row || row.user_id !== uid)) row = undefined;
            return { results: row ? [row] : [] };
          }
          if (s.includes('where lp.user_id')) {
            const uid = bound[0];
            return { results: LPS.filter((lp) => lp.user_id === uid) };
          }
          return { results: [...LPS] };
        }
        // Non-admin scoped list (capital_calls JOIN limited_partners).
        if (s.includes('from capital_calls cc') && s.includes('join limited_partners')) {
          const uid = bound[0];
          const status = s.includes('and cc.status') ? bound[1] : null;
          const ownLpIds = LPS.filter((lp) => lp.user_id === uid).map((lp) => lp.id);
          let rows = calls.filter((cc) => ownLpIds.includes(cc.limited_partner_id));
          if (status) rows = rows.filter((cc) => cc.status === status);
          return { results: sortByCreatedDesc(rows) };
        }
        // Per-LP capital calls for the investor-detail route (Task #20).
        if (s.includes('from capital_calls where limited_partner_id')) {
          const lpId = bound[0];
          return { results: calls.filter((cc) => cc.limited_partner_id === lpId) };
        }
        // Single call by id (pay route + post-update re-read).
        if (s.includes('from capital_calls where id')) {
          const row = calls.find((cc) => cc.id === bound[0]);
          return { results: row ? [row] : [] };
        }
        // Admin unscoped list.
        if (s.includes('from capital_calls')) {
          const status = s.includes('where status') ? bound[0] : null;
          let rows = [...calls];
          if (status) rows = rows.filter((cc) => cc.status === status);
          return { results: sortByCreatedDesc(rows) };
        }
        return { results: [] };
      },
      async first() { return null; },
      async run() { return { meta: { changes: 1 } }; },
    };
    return api;
  };
  return {
    JWT_SECRET,
    ENVIRONMENT: 'development',
    DB: {
      prepare: (sql: string) => handle(sql),
      async batch(stmts: any[]) { return (stmts || []).map(() => ({ results: [] })); },
    },
  };
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
  assert.deepEqual(body.map((c) => c.id).sort(), [1, 2]);
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
  assert.deepEqual(body.map((lp) => lp.id).sort((a, b) => a - b), [100, 200]);
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
  assert.equal(body.id, 999);
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
  assert.equal(body.calls_created.length, 2);
  assert.equal(body.calls_created[0].amount, 500);
});
