/**
 * Task #21 — Investor lifecycle route access-control audit.
 *
 * The four new investor-lifecycle features (IC Decisions, LP Reporting,
 * Portfolio Updates, Cap-Table Positions) enforce role-based and tier-based
 * access rules. This suite locks those rules in so a future refactor cannot
 * silently leak data across roles or tiers.
 *
 * Coverage:
 *   A. Static assertions — middleware mounts in index.ts.
 *   B. Pure-logic predicates — userMeetsInvestorTier, userMeetsTier, canViewLpData.
 *   C. IC decisions — founder blocked by canUseIc; non-creator blocked on PUT.
 *   D. LP reports — canViewLpData blocks non-admin/non-investor;
 *      investor scoping (own authored + published LP-fund reports only).
 *   E. Portfolio updates — founder sees only own-project updates;
 *      investor sees only submitted updates; cross-tenant guard on detail.
 *   F. Positions — canViewLpData blocks non-admin/non-investor;
 *      writes are admin-only.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *        --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/investorLifecycle.authz.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SignJWT } from 'jose';
import { userMeetsInvestorTier } from '../src/middleware/requireInvestorTier.ts';
import { userMeetsTier } from '../src/middleware/requireTier.ts';
import { canViewLpData } from '../src/auth.ts';
import ic from '../src/routes/ic.ts';
import lpReports from '../src/routes/lp_reports.ts';
import { makeD1 as makeRealD1 } from './_d1_sqlite.mjs';
import portfolioUpdates from '../src/routes/portfolio_updates.ts';
import positions from '../src/routes/positions.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkUser(id: number, role: string, extra: Record<string, any> = {}) {
  return { id, role, is_active: 1, ...extra };
}

async function mintToken(userId: number, role: string, extra: Record<string, any> = {}): Promise<string> {
  const payload: any = { user_id: userId, role, ...extra };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/**
 * Build a D1 stub that pattern-matches SQL and returns pre-canned results.
 * The `stubs` map is keyed by a predicate function `fn(sqlLower, bound)`;
 * when a query matches, the `results` array is returned from `all()` and
 * `first()` returns `results[0] ?? null`. `run()` returns `{ meta: { changes: 1 } }`.
 */
function makeD1(stubs: Array<{ match: (s: string, b: any[]) => boolean; results: any[] }>, user?: any) {
  return {
    prepare: (rawSql: string) => {
      const s = rawSql.toLowerCase();
      let bound: any[] = [];
      const api: any = {
        bind: (...a: any[]) => { bound = a; return api; },
        async all() {
          // Auth user resolution (used by requireAuth)
          if (s.includes('from users') && s.includes('where id')) {
            return { results: user ? [user] : [] };
          }
          for (const stub of stubs) {
            if (stub.match(s, bound)) return { results: stub.results };
          }
          return { results: [] };
        },
        async first() {
          const a = await api.all();
          return (a.results || [])[0] ?? null;
        },
        async run() {
          // Re-run the all() path so INSERT ... RETURNING * works.
          const a = await api.all();
          const row = (a.results || [])[0];
          return {
            meta: {
              changes: row ? 1 : 0,
              last_row_id: row?.id ?? (row?.meta?.last_row_id ?? 0),
            },
          };
        },
      };
      return api;
    },
    async batch(stmts: any[]) { return (stmts || []).map(() => ({ results: [] })); },
  };
}

function makeEnv(user: any, stubs: Array<{ match: (s: string, b: any[]) => boolean; results: any[] }>) {
  return {
    JWT_SECRET,
    ENVIRONMENT: 'development',
    DB: makeD1(stubs, user),
  };
}

// ---------------------------------------------------------------------------
// (A) Static source assertions
// ---------------------------------------------------------------------------

test('index.ts mounts requireInvestorTier(professional) on /api/ic', async () => {
  const src = await readFile(resolve(__dirname, '../src/index.ts'), 'utf8');
  assert.match(src, /INVESTOR_PRO_PREFIXES\s*=\s*\[[\s\S]*?'\/api\/ic'/,
    '/api/ic must be in INVESTOR_PRO_PREFIXES');
  assert.match(src, /requireInvestorTier\('professional'\)/,
    'INVESTOR_PRO_PREFIXES loop must apply requireInvestorTier(professional)');
});

test('index.ts mounts STUDIO_PREFIXES with /api/lp-reports and /api/positions', async () => {
  const src = await readFile(resolve(__dirname, '../src/index.ts'), 'utf8');
  assert.match(src, /STUDIO_PREFIXES\s*=\s*\[[\s\S]*?'\/api\/lp-reports'/,
    '/api/lp-reports must be in STUDIO_PREFIXES');
  assert.match(src, /STUDIO_PREFIXES\s*=\s*\[[\s\S]*?'\/api\/positions'/,
    '/api/positions must be in STUDIO_PREFIXES');
  assert.match(src, /requireTier\('studio'\)/,
    'STUDIO_PREFIXES loop must apply requireTier(studio)');
});

test('index.ts mounts portfolio-updates outside any prefix gate (dual-audience)', async () => {
  const src = await readFile(resolve(__dirname, '../src/index.ts'), 'utf8');
  // It must NOT appear in STUDIO_PREFIXES or INVESTOR_PRO_PREFIXES.
  const studioMatch = src.match(/STUDIO_PREFIXES\s*=\s*\[[\s\S]*?\]/);
  assert.ok(studioMatch, 'STUDIO_PREFIXES array missing');
  assert.ok(!studioMatch![0].includes('/api/portfolio-updates'),
    '/api/portfolio-updates must NOT be in STUDIO_PREFIXES');

  const proMatch = src.match(/INVESTOR_PRO_PREFIXES\s*=\s*\[[\s\S]*?\]/);
  assert.ok(proMatch, 'INVESTOR_PRO_PREFIXES array missing');
  assert.ok(!proMatch![0].includes('/api/portfolio-updates'),
    '/api/portfolio-updates must NOT be in INVESTOR_PRO_PREFIXES');
});

// ---------------------------------------------------------------------------
// (B) Pure-logic predicate tests
// ---------------------------------------------------------------------------

test('userMeetsInvestorTier: free investor blocked from professional', () => {
  assert.equal(userMeetsInvestorTier(mkUser(1, 'investor', { investor_tier: 'free' }), 'professional'), false);
});

test('userMeetsInvestorTier: professional investor passes professional gate', () => {
  assert.equal(userMeetsInvestorTier(mkUser(1, 'investor', { investor_tier: 'professional' }), 'professional'), true);
});

test('userMeetsInvestorTier: institutional investor passes professional gate', () => {
  assert.equal(userMeetsInvestorTier(mkUser(1, 'investor', { investor_tier: 'institutional' }), 'professional'), true);
});

test('userMeetsInvestorTier: admin bypasses investor tier gate', () => {
  assert.equal(userMeetsInvestorTier(mkUser(1, 'admin'), 'professional'), true);
});

test('userMeetsInvestorTier: partner bypasses investor tier gate', () => {
  assert.equal(userMeetsInvestorTier(mkUser(1, 'partner'), 'professional'), true);
});

test('userMeetsInvestorTier: advisor bypasses investor tier gate', () => {
  assert.equal(userMeetsInvestorTier(mkUser(1, 'advisor'), 'professional'), true);
});

test('userMeetsInvestorTier: founder passes through (non-investor, blocked by in-route guard)', () => {
  // By design requireInvestorTier only gates investor roles.
  assert.equal(userMeetsInvestorTier(mkUser(1, 'founder'), 'professional'), true);
});

test('userMeetsTier: free founder blocked from studio', () => {
  assert.equal(userMeetsTier(mkUser(1, 'founder', { subscription_tier: 'free' }), 'studio'), false);
});

test('userMeetsTier: growth founder blocked from studio', () => {
  assert.equal(userMeetsTier(mkUser(1, 'founder', { subscription_tier: 'growth' }), 'studio'), false);
});

test('userMeetsTier: studio founder passes studio gate', () => {
  assert.equal(userMeetsTier(mkUser(1, 'founder', { subscription_tier: 'studio' }), 'studio'), true);
});

test('userMeetsTier: investor bypasses founder studio gate', () => {
  assert.equal(userMeetsTier(mkUser(1, 'investor'), 'studio'), true);
});

test('canViewLpData: admin and investor allowed; others denied', () => {
  assert.equal(canViewLpData(mkUser(1, 'admin')), true);
  assert.equal(canViewLpData(mkUser(1, 'investor')), true);
  assert.equal(canViewLpData(mkUser(1, 'founder')), false);
  assert.equal(canViewLpData(mkUser(1, 'partner')), false);
  assert.equal(canViewLpData(mkUser(1, 'advisor')), false);
  assert.equal(canViewLpData(null), false);
});

// ---------------------------------------------------------------------------
// (C) IC Decisions — in-route guards
// ---------------------------------------------------------------------------

const IC_STUBS = {
  emptyList: { match: (s: string) => s.includes('from ic_decisions'), results: [] },
  emptyVotes: { match: (s: string) => s.includes('from ic_votes'), results: [] },
  noProject: { match: (s: string) => s.includes('from projects where id') && !s.includes('deleted_at'), results: [] },
};

test('ic GET /: founder is blocked by canUseIc (403)', async () => {
  const token = await mintToken(1, 'founder');
  const env = makeEnv(mkUser(1, 'founder'), [IC_STUBS.emptyList, IC_STUBS.emptyVotes, IC_STUBS.noProject]);
  const res = await ic.request('/', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.detail, 'Forbidden');
});

test('ic GET /: professional investor passes canUseIc (200)', async () => {
  const token = await mintToken(1, 'investor', { investor_tier: 'professional' });
  const env = makeEnv(mkUser(1, 'investor', { investor_tier: 'professional' }), [
    IC_STUBS.emptyList, IC_STUBS.emptyVotes, IC_STUBS.noProject,
  ]);
  const res = await ic.request('/', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.items, []);
});

test('ic GET /: partner passes canUseIc (200)', async () => {
  const token = await mintToken(1, 'partner');
  const env = makeEnv(mkUser(1, 'partner'), [IC_STUBS.emptyList, IC_STUBS.emptyVotes, IC_STUBS.noProject]);
  const res = await ic.request('/', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(res.status, 200);
});

test('ic GET /: admin passes canUseIc (200)', async () => {
  const token = await mintToken(1, 'admin');
  const env = makeEnv(mkUser(1, 'admin'), [IC_STUBS.emptyList, IC_STUBS.emptyVotes, IC_STUBS.noProject]);
  const res = await ic.request('/', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(res.status, 200);
});

test('ic PUT /:uid — non-creator investor gets 403', async () => {
  const token = await mintToken(2, 'investor', { investor_tier: 'professional' });
  const env = makeEnv(mkUser(2, 'investor', { investor_tier: 'professional' }), [
    {
      match: (s: string) => s.includes('from ic_decisions') && s.includes('where uid'),
      results: [{ id: 1, uid: 'ic-1', title: 'T', created_by: 1, status: 'draft', memo: null, terms_json: null, decision: null, outcome: null, decided_at: null, project_id: null, deal_id: null, created_at: '2026-01-01', updated_at: '2026-01-01' }],
    },
  ]);
  const res = await ic.request('/ic-1', { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Hijack' }) }, env);
  assert.equal(res.status, 403);
});

test('ic PUT /:uid — creator investor can edit (200)', async () => {
  const token = await mintToken(1, 'investor', { investor_tier: 'professional' });
  const env = makeEnv(mkUser(1, 'investor', { investor_tier: 'professional' }), [
    {
      match: (s: string) => s.includes('from ic_decisions') && s.includes('where uid'),
      results: [{ id: 1, uid: 'ic-1', title: 'T', created_by: 1, status: 'draft', memo: null, terms_json: null, decision: null, outcome: null, decided_at: null, project_id: null, deal_id: null, created_at: '2026-01-01', updated_at: '2026-01-01' }],
    },
    {
      match: (s: string) => s.includes('update ic_decisions'),
      results: [],
    },
    {
      match: (s: string) => s.includes('from ic_decisions') && s.includes('where id'),
      results: [{ id: 1, uid: 'ic-1', title: 'New', created_by: 1, status: 'draft', memo: null, terms_json: null, decision: null, outcome: null, decided_at: null, project_id: null, deal_id: null, created_at: '2026-01-01', updated_at: '2026-01-01' }],
    },
    IC_STUBS.emptyVotes,
  ]);
  const res = await ic.request('/ic-1', { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'New' }) }, env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.title, 'New');
});

test('ic PUT /:uid — admin can edit any decision (200)', async () => {
  const token = await mintToken(99, 'admin');
  const env = makeEnv(mkUser(99, 'admin'), [
    {
      match: (s: string) => s.includes('from ic_decisions') && s.includes('where uid'),
      results: [{ id: 1, uid: 'ic-1', title: 'T', created_by: 1, status: 'draft', memo: null, terms_json: null, decision: null, outcome: null, decided_at: null, project_id: null, deal_id: null, created_at: '2026-01-01', updated_at: '2026-01-01' }],
    },
    {
      match: (s: string) => s.includes('update ic_decisions'),
      results: [],
    },
    {
      match: (s: string) => s.includes('from ic_decisions') && s.includes('where id'),
      results: [{ id: 1, uid: 'ic-1', title: 'AdminEdit', created_by: 1, status: 'draft', memo: null, terms_json: null, decision: null, outcome: null, decided_at: null, project_id: null, deal_id: null, created_at: '2026-01-01', updated_at: '2026-01-01' }],
    },
    IC_STUBS.emptyVotes,
  ]);
  const res = await ic.request('/ic-1', { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'AdminEdit' }) }, env);
  assert.equal(res.status, 200);
});

// ---------------------------------------------------------------------------
// (D) LP Reports — canViewLpData + scoping
// ---------------------------------------------------------------------------

/**
 * Section (D) runs against a REAL database rather than the SQL-text stub the
 * rest of this file uses.
 *
 * The LP visibility rule moved into `lpMembershipScope`, and the stub's
 * matchers keyed on the old text (`where user_id ... and fund_id`). Retuning
 * them would have restored a green suite while testing nothing: a matcher
 * cannot tell a correct ownership predicate from an incorrect one, and these
 * particular tests exist to stop one LP reading another fund's quarterly
 * report. So this section runs the route's real SQL against SQLite — which is
 * what D1 is — and lets the returned rows decide.
 *
 * The other sections still use the text stub; converting them is unrelated to
 * this change and would touch IC decisions, portfolio updates and positions.
 */
const LP_SCHEMA = `
CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT, is_active INTEGER DEFAULT 1);
CREATE TABLE vc_funds (id INTEGER PRIMARY KEY, name TEXT, vintage_year INTEGER, status TEXT);
CREATE TABLE limited_partners (
  id INTEGER PRIMARY KEY, fund_id INTEGER, user_id INTEGER, email TEXT,
  commitment_amount REAL DEFAULT 0, status TEXT DEFAULT 'active');
CREATE TABLE lp_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, fund_id INTEGER, period TEXT,
  status TEXT, nav REAL, called REAL, distributed REAL, dpi REAL, tvpi REAL, irr REAL,
  narrative TEXT, created_by INTEGER, published_at TEXT,
  created_at TEXT DEFAULT '2026-01-01', updated_at TEXT DEFAULT '2026-01-01');
`;

/**
 * @param user      the caller, as requireAuth will resolve them
 * @param opts.lpOf fund ids the caller holds a CLAIMED LP row in
 * @param opts.legacyLpOf fund ids where the row carries their address but no user_id
 * @param opts.reports  lp_reports rows to seed
 */
function lpEnv(user: any, opts: {
  lpOf?: number[]; legacyLpOf?: number[]; reports?: any[]; email?: string;
} = {}) {
  const email = opts.email ?? `u${user.id}@lp.example`;
  const { DB, db } = makeRealD1(LP_SCHEMA);
  db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(user.id, email, `U${user.id}`, user.role);
  for (const fundId of [1, 2]) {
    db.prepare("INSERT INTO vc_funds (id, name, vintage_year, status) VALUES (?, ?, 2024, 'active')")
      .run(fundId, `Fund ${fundId}`);
  }
  let lpId = 1;
  for (const fundId of opts.lpOf ?? []) {
    db.prepare("INSERT INTO limited_partners (id, fund_id, user_id, email, status) VALUES (?, ?, ?, ?, 'active')")
      .run(lpId++, fundId, user.id, email);
  }
  for (const fundId of opts.legacyLpOf ?? []) {
    db.prepare("INSERT INTO limited_partners (id, fund_id, user_id, email, status) VALUES (?, ?, NULL, ?, 'active')")
      .run(lpId++, fundId, email);
  }
  for (const r of opts.reports ?? []) {
    db.prepare(`INSERT INTO lp_reports (uid, fund_id, period, status, nav, called, distributed, narrative, created_by, published_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(r.uid, r.fund_id, r.period ?? '2026-Q1', r.status, r.nav ?? null, r.called ?? null,
           r.distributed ?? null, r.narrative ?? null, r.created_by ?? null, r.published_at ?? null);
  }
  return { JWT_SECRET, ENVIRONMENT: 'development', DB, __db: db };
}

const lpGet = (env: any, token: string, path: string) =>
  lpReports.request(path, { headers: { Authorization: `Bearer ${token}` } }, env);

test('lp-reports GET /: founder blocked by canViewLpData (403)', async () => {
  const token = await mintToken(1, 'founder');
  const res = await lpGet(lpEnv(mkUser(1, 'founder')), token, '/');
  assert.equal(res.status, 403);
});

test('lp-reports GET /: partner blocked by canViewLpData (403)', async () => {
  const token = await mintToken(1, 'partner');
  const res = await lpGet(lpEnv(mkUser(1, 'partner')), token, '/');
  assert.equal(res.status, 403);
});

test('lp-reports GET /: investor passes canViewLpData (200)', async () => {
  const token = await mintToken(1, 'investor');
  // No LP rows at all → no fund visibility, so an empty list rather than a 403.
  const res = await lpGet(lpEnv(mkUser(1, 'investor')), token, '/');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.items, []);
});

test('lp-reports GET /: admin passes canViewLpData (200)', async () => {
  const token = await mintToken(1, 'admin');
  const res = await lpGet(lpEnv(mkUser(1, 'admin')), token, '/');
  assert.equal(res.status, 200);
});

test('lp-reports GET /:uid — non-author non-LP investor cannot read unpublished report (404)', async () => {
  const token = await mintToken(2, 'investor');
  const env = lpEnv(mkUser(2, 'investor'), {
    reports: [{ uid: 'lp-1', fund_id: 1, status: 'draft', created_by: 1 }],
  });
  const res = await lpGet(env, token, '/lp-1');
  assert.equal(res.status, 404);
});

test('lp-reports GET /:uid — an investor who is not an LP of the fund is refused (403)', async () => {
  // Published, so it is not hidden as "not found" — but they hold no position
  // in fund 1, and holding one in fund 2 does not carry over.
  const token = await mintToken(2, 'investor');
  const env = lpEnv(mkUser(2, 'investor'), {
    lpOf: [2],
    reports: [{ uid: 'lp-1', fund_id: 1, status: 'published', published_at: '2026-01-01', created_by: 1 }],
  });
  const res = await lpGet(env, token, '/lp-1');
  assert.equal(res.status, 403);
});

test('lp-reports GET /:uid — LP investor can read published report (200)', async () => {
  const token = await mintToken(2, 'investor');
  const env = lpEnv(mkUser(2, 'investor'), {
    lpOf: [1],
    reports: [{ uid: 'lp-1', fund_id: 1, status: 'published', nav: 100, called: 50,
                distributed: 0, narrative: 'Q1 update', created_by: 1, published_at: '2026-01-01' }],
  });
  const res = await lpGet(env, token, '/lp-1');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'published');
});

test('lp-reports: a legacy LP reads the report for the fund they hold', async () => {
  // The whole point of task #175. This LP row has a real position and a NULL
  // user_id; under `user_id = ?` this person was refused the quarterly report
  // for a fund they are an LP of, which is the one document telling them what
  // their position did.
  const token = await mintToken(2, 'investor');
  const env = lpEnv(mkUser(2, 'investor'), {
    legacyLpOf: [1],
    reports: [{ uid: 'lp-1', fund_id: 1, status: 'published', created_by: 1, published_at: '2026-01-01' }],
  });
  const res = await lpGet(env, token, '/lp-1');
  assert.equal(res.status, 200);
  // And the row is claimed on the way through, so the next read is an account
  // link rather than another email match.
  const row = env.__db.prepare('SELECT user_id FROM limited_partners WHERE fund_id = 1').get();
  assert.equal(row.user_id, 2);
});

test('lp-reports: the list is scoped to the funds the caller is an LP of', async () => {
  const token = await mintToken(2, 'investor');
  const env = lpEnv(mkUser(2, 'investor'), {
    lpOf: [1],
    reports: [
      { uid: 'lp-1', fund_id: 1, status: 'published', created_by: 1, published_at: '2026-01-01' },
      { uid: 'lp-2', fund_id: 2, status: 'published', created_by: 1, published_at: '2026-01-01' },
    ],
  });
  const res = await lpGet(env, token, '/');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.items.map((r: any) => r.uid), ['lp-1'],
    "fund 2's report must not appear for someone who holds no position in it");
});

test('lp-reports POST /: partner is blocked by requireGp (403)', async () => {
  const token = await mintToken(1, 'partner');
  const env = lpEnv(mkUser(1, 'partner'));
  const res = await lpReports.request('/', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fund_id: 1, period: '2026-Q2' }) }, env);
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// (E) Portfolio Updates — founder isolation + investor scoping
// ---------------------------------------------------------------------------

const PU_STUBS = {
  noProjects: { match: (s: string) => s.includes('from projects') && s.includes('where id') && s.includes('deleted_at'), results: [] },
  emptyUpdates: { match: (s: string) => s.includes('from portfolio_updates'), results: [] },
};

test('portfolio-updates GET /: investor only sees submitted updates', async () => {
  const token = await mintToken(1, 'investor');
  const env = makeEnv(mkUser(1, 'investor'), [
    {
      match: (s: string) => s.includes('from portfolio_updates') && s.includes("status = 'submitted'"),
      results: [
        { id: 1, uid: 'pu-1', project_id: 10, author_user_id: 5, period: '2026-06', title: 'June Update', body: 'All good', kpis_json: null, status: 'submitted', submitted_at: '2026-06-15', created_at: '2026-06-01', updated_at: '2026-06-15' },
      ],
    },
    PU_STUBS.noProjects,
  ]);
  const res = await portfolioUpdates.request('/', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].status, 'submitted');
});

test('portfolio-updates GET /: founder sees only own-project updates', async () => {
  const FOUNDER_ID = 7;
  const token = await mintToken(1, 'founder', { founder_id: FOUNDER_ID });
  const env = makeEnv(mkUser(1, 'founder', { founder_id: FOUNDER_ID }), [
    {
      match: (s: string, b: any[]) => s.includes('from portfolio_updates') && s.includes('project_id in (select id from projects where founder_id = ?)'),
      results: [
        { id: 2, uid: 'pu-2', project_id: 20, author_user_id: 1, period: '2026-06', title: 'My Update', body: 'Progress', kpis_json: null, status: 'draft', submitted_at: null, created_at: '2026-06-01', updated_at: '2026-06-01' },
      ],
    },
    {
      match: (s: string, b: any[]) => s.includes('from projects') && s.includes('where id') && s.includes('deleted_at'),
      results: [{ id: 20, uid: 'proj-20', name: 'My Project', sector: 'ai', stage: 'seed', status: 'active' }],
    },
  ]);
  const res = await portfolioUpdates.request('/', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].title, 'My Update');
});

test('portfolio-updates GET /: different founder gets disjoint own-project set', async () => {
  const FOUNDER_A = 7;
  const FOUNDER_B = 8;
  const tokenA = await mintToken(1, 'founder', { founder_id: FOUNDER_A });
  const tokenB = await mintToken(2, 'founder', { founder_id: FOUNDER_B });

  const makeStubs = (fid: number) => [
    {
      match: (s: string, b: any[]) => s.includes('from portfolio_updates') && s.includes('project_id in (select id from projects where founder_id = ?)'),
      results: fid === FOUNDER_A
        ? [{ id: 1, uid: 'pu-a', project_id: 20, author_user_id: 1, period: '2026-06', title: 'A Update', body: '', kpis_json: null, status: 'draft', submitted_at: null, created_at: '2026-06-01', updated_at: '2026-06-01' }]
        : [], // founder B has no projects
    },
    {
      match: (s: string, b: any[]) => s.includes('from projects') && s.includes('where id') && s.includes('deleted_at'),
      results: [{ id: 20, uid: 'proj-20', name: 'Proj A', sector: 'ai', stage: 'seed', status: 'active' }],
    },
  ];

  const envA = makeEnv(mkUser(1, 'founder', { founder_id: FOUNDER_A }), makeStubs(FOUNDER_A));
  const resA = await portfolioUpdates.request('/', { headers: { Authorization: `Bearer ${tokenA}` } }, envA);
  assert.equal(resA.status, 200);
  const bodyA = await resA.json();
  assert.equal(bodyA.items.length, 1);
  assert.equal(bodyA.items[0].uid, 'pu-a');

  const envB = makeEnv(mkUser(2, 'founder', { founder_id: FOUNDER_B }), makeStubs(FOUNDER_B));
  const resB = await portfolioUpdates.request('/', { headers: { Authorization: `Bearer ${tokenB}` } }, envB);
  assert.equal(resB.status, 200);
  const bodyB = await resB.json();
  assert.deepEqual(bodyB.items, []);
});

test('portfolio-updates GET /:uid — founder cannot read other founder\'s update (403)', async () => {
  const token = await mintToken(2, 'founder', { founder_id: 8 });
  const env = makeEnv(mkUser(2, 'founder', { founder_id: 8 }), [
    {
      match: (s: string, b: any[]) => s.includes('from portfolio_updates') && s.includes('where uid'),
      results: [{ id: 1, uid: 'pu-1', project_id: 20, author_user_id: 1, period: '2026-06', title: 'Other', body: '', kpis_json: null, status: 'draft', submitted_at: null, created_at: '2026-06-01', updated_at: '2026-06-01' }],
    },
    {
      match: (s: string, b: any[]) => s.includes('from projects') && s.includes('where id') && s.includes('deleted_at'),
      results: [{ id: 20, uid: 'proj-20', name: 'Proj', sector: 'ai', stage: 'seed', status: 'active', founder_id: 7 }],
    },
    {
      match: (s: string, b: any[]) => s.includes('select founder_id from projects'),
      results: [{ founder_id: 7 }], // project owned by founder 7, not caller (founder 8)
    },
  ]);
  const res = await portfolioUpdates.request('/pu-1', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(res.status, 403);
});

test('portfolio-updates GET /:uid — investor can read submitted update (200)', async () => {
  const token = await mintToken(1, 'investor');
  const env = makeEnv(mkUser(1, 'investor'), [
    {
      match: (s: string, b: any[]) => s.includes('from portfolio_updates') && s.includes('where uid'),
      results: [{ id: 1, uid: 'pu-1', project_id: 20, author_user_id: 5, period: '2026-06', title: 'Submitted', body: 'Done', kpis_json: null, status: 'submitted', submitted_at: '2026-06-15', created_at: '2026-06-01', updated_at: '2026-06-15' }],
    },
    {
      match: (s: string, b: any[]) => s.includes('from projects') && s.includes('where id') && s.includes('deleted_at'),
      results: [{ id: 20, uid: 'proj-20', name: 'Proj', sector: 'ai', stage: 'seed', status: 'active' }],
    },
  ]);
  const res = await portfolioUpdates.request('/pu-1', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.title, 'Submitted');
});

test('portfolio-updates GET /:uid — investor blocked from draft (403 for non-admin)', async () => {
  const token = await mintToken(1, 'investor');
  const env = makeEnv(mkUser(1, 'investor'), [
    {
      match: (s: string, b: any[]) => s.includes('from portfolio_updates') && s.includes('where uid'),
      results: [{ id: 1, uid: 'pu-1', project_id: 20, author_user_id: 5, period: '2026-06', title: 'Draft', body: '', kpis_json: null, status: 'draft', submitted_at: null, created_at: '2026-06-01', updated_at: '2026-06-01' }],
    },
    {
      match: (s: string, b: any[]) => s.includes('from projects') && s.includes('where id') && s.includes('deleted_at'),
      results: [{ id: 20, uid: 'proj-20', name: 'Proj', sector: 'ai', stage: 'seed', status: 'active' }],
    },
  ]);
  const res = await portfolioUpdates.request('/pu-1', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(res.status, 403);
});

test('portfolio-updates POST /: non-owning founder blocked (403)', async () => {
  const token = await mintToken(2, 'founder', { founder_id: 8 });
  const env = makeEnv(mkUser(2, 'founder', { founder_id: 8 }), [
    {
      match: (s: string, b: any[]) => s.includes('select founder_id from projects') && s.includes('where id'),
      results: [{ founder_id: 7 }], // project owned by founder 7
    },
  ]);
  const res = await portfolioUpdates.request('/', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: 20, title: 'My Update' }) }, env);
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// (F) Positions — canViewLpData + admin-only writes
// ---------------------------------------------------------------------------

const POS_STUBS = {
  emptyPositions: { match: (s: string) => s.includes('from portfolio_positions'), results: [] },
  noProjects: { match: (s: string) => s.includes('from projects') && s.includes('where id') && s.includes('deleted_at'), results: [] },
  noHolders: { match: (s: string) => s.includes('from cap_table_holders'), results: [] },
};

test('positions GET /: founder blocked by canViewLpData (403)', async () => {
  const token = await mintToken(1, 'founder');
  const env = makeEnv(mkUser(1, 'founder'), [POS_STUBS.emptyPositions, POS_STUBS.noProjects, POS_STUBS.noHolders]);
  const res = await positions.request('/', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(res.status, 403);
});

test('positions GET /: partner blocked by canViewLpData (403)', async () => {
  const token = await mintToken(1, 'partner');
  const env = makeEnv(mkUser(1, 'partner'), [POS_STUBS.emptyPositions, POS_STUBS.noProjects, POS_STUBS.noHolders]);
  const res = await positions.request('/', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(res.status, 403);
});

test('positions GET /: investor passes canViewLpData (200)', async () => {
  const token = await mintToken(1, 'investor');
  const env = makeEnv(mkUser(1, 'investor'), [POS_STUBS.emptyPositions, POS_STUBS.noProjects, POS_STUBS.noHolders]);
  const res = await positions.request('/', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.items, []);
});

test('positions GET /: admin passes canViewLpData (200)', async () => {
  const token = await mintToken(1, 'admin');
  const env = makeEnv(mkUser(1, 'admin'), [POS_STUBS.emptyPositions, POS_STUBS.noProjects, POS_STUBS.noHolders]);
  const res = await positions.request('/', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(res.status, 200);
});

test('positions GET /:uid — investor can read project detail (200)', async () => {
  const token = await mintToken(1, 'investor');
  const env = makeEnv(mkUser(1, 'investor'), [
    {
      match: (s: string, b: any[]) => s.includes('from projects') && s.includes('where uid'),
      results: [{ id: 10, uid: 'proj-10', name: 'TestCo', sector: 'ai', stage: 'seed', status: 'active' }],
    },
    {
      match: (s: string, b: any[]) => s.includes('from portfolio_positions') && s.includes('where project_id = ?') && s.includes('order by'),
      results: [],
    },
    {
      match: (s: string, b: any[]) => s.includes('from cap_table_holders') && s.includes('where project_id'),
      results: [],
    },
  ]);
  const res = await positions.request('/proj-10', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.project.name, 'TestCo');
});

test('positions POST /: investor blocked by requireAdmin (403)', async () => {
  const token = await mintToken(1, 'investor');
  const env = makeEnv(mkUser(1, 'investor'), [
    {
      match: (s: string, b: any[]) => s.includes('from projects') && s.includes('where id') && s.includes('deleted_at'),
      results: [{ id: 10, uid: 'proj-10', name: 'TestCo', sector: 'ai', stage: 'seed', status: 'active' }],
    },
  ]);
  const res = await positions.request('/', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: 10, round_name: 'Seed' }) }, env);
  assert.equal(res.status, 403);
});

test('positions POST /: admin can create (201)', async () => {
  const token = await mintToken(1, 'admin');
  const env = makeEnv(mkUser(1, 'admin'), [
    {
      match: (s: string, b: any[]) => s.includes('from projects') && s.includes('where id') && s.includes('deleted_at'),
      results: [{ id: 10, uid: 'proj-10', name: 'TestCo', sector: 'ai', stage: 'seed', status: 'active' }],
    },
    {
      match: (s: string, b: any[]) => s.includes('insert into portfolio_positions') && s.includes('returning'),
      results: [{ id: 1, uid: 'pos-1', project_id: 10, round_name: 'Seed', invested_amount: 100000, shares: 1000, price_per_share: 100, ownership_pct: 15, position_date: '2026-01-01', created_by: 1, created_at: '2026-01-01', updated_at: '2026-01-01' }],
    },
    {
      match: (s: string, b: any[]) => s.includes('from portfolio_positions') && s.includes('where id'),
      results: [{ id: 1, uid: 'pos-1', project_id: 10, round_name: 'Seed', invested_amount: 100000, shares: 1000, price_per_share: 100, ownership_pct: 15, position_date: '2026-01-01', created_by: 1, created_at: '2026-01-01', updated_at: '2026-01-01' }],
    },
  ]);
  const res = await positions.request('/', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: 10, round_name: 'Seed', invested_amount: 100000 }) }, env);
  assert.equal(res.status, 201);
});

test('positions PUT /:uid — investor blocked by requireAdmin (403)', async () => {
  const token = await mintToken(1, 'investor');
  const env = makeEnv(mkUser(1, 'investor'), [
    {
      match: (s: string, b: any[]) => s.includes('from portfolio_positions') && s.includes('where uid'),
      results: [{ id: 1, uid: 'pos-1', project_id: 10, round_name: 'Seed', invested_amount: 100000, shares: 1000, price_per_share: 100, ownership_pct: 15, position_date: '2026-01-01', created_by: 1, created_at: '2026-01-01', updated_at: '2026-01-01' }],
    },
  ]);
  const res = await positions.request('/pos-1', { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ invested_amount: 200000 }) }, env);
  assert.equal(res.status, 403);
});
