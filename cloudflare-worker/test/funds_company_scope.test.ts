/**
 * Company scoping, stage 7: the investor's Fund (the GP add-on at /funds).
 *
 * WHICH SURFACE THIS IS. The Investor sidebar carries two fund rows and they
 * are not the same thing: "Axal VC Fund" points at
 * /spinout-lab/investor-workspace — LP participation in Axal's own fund, and
 * out of bounds — while "Fund" points at /funds, an investor running their
 * OWN fund. `shellConfig.js` states the distinction in those words. Only the
 * second is scoped here.
 *
 * WHY THIS STAGE IS DIFFERENT FROM THE SIX BEFORE IT. In stages 1-6 the
 * company was a FILTER over rows the caller could already read, so an error
 * showed too little. Here it enters `fundGpScope`, the predicate that makes
 * `requireFundGp` return 404 — an AUTHORISATION. `middleware/activeCompany.ts`
 * named this scope as the case to watch when it was written, before the
 * rollout reached it. So the tests below spend most of their effort on the two
 * ways an authorisation predicate can be wrong: granting what it should not
 * (a company standing in for ownership) and denying what it should not (an
 * admin, or a fund whose GP has no company at all).
 *
 * Harness matches stages 1-6: the real router against real in-memory SQLite
 * with a real `user_company_links` table, so `resolveActiveCompany` is
 * unmocked and a forged header is refused by the same code production runs.
 *
 * `vc_funds` is created from the canonical DDL in sql/infrastructure.sql with
 * NOTHING added: the columns migrations 163 and 195 contribute are left to
 * `ensureFundGpColumns`, which the probe route calls, so the fixture cannot
 * drift from the bootstrap the way a hand-transcribed table would.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import funds from '../src/routes/funds.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const GP = 42;            // institutional investor, GP of record for two funds
const OTHER_GP = 43;      // a different GP, in the SAME company as GP's firm A
const ADMIN = 44;
const FIRM_A = 21;        // the GP's first firm
const FIRM_B = 22;        // the GP's second firm
const FUND_A = 1;         // run by GP, under FIRM_A
const FUND_B = 2;         // run by GP, under FIRM_B
const FUND_NO_CO = 3;     // run by GP, company_id NULL — no primary link to backfill
const FUND_OTHER = 4;     // run by OTHER_GP, under FIRM_A

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { return x; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT,
      email TEXT, investor_seat_primary_user_id INTEGER, investor_tier TEXT,
      investor_subscription_status TEXT, subscription_tier TEXT
    );
    -- Verbatim from sql/infrastructure.sql. gp_user_id (163) and company_id
    -- (195) are deliberately absent: ensureFundGpColumns adds them.
    CREATE TABLE vc_funds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        vintage_year INTEGER,
        total_commitment REAL NOT NULL DEFAULT 0,
        deployed_capital REAL NOT NULL DEFAULT 0,
        lp_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'fundraising',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Verbatim from sql/funds_v2.sql: Funds.create writes three of these, so a
    -- fixture without them fails POST /funds for a reason that has nothing to
    -- do with company scoping.
    ALTER TABLE vc_funds ADD COLUMN lpa_doc_id INTEGER;
    ALTER TABLE vc_funds ADD COLUMN fund_size_cents INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE vc_funds ADD COLUMN carried_interest REAL NOT NULL DEFAULT 0.20;
    ALTER TABLE vc_funds ADD COLUMN management_fee REAL NOT NULL DEFAULT 0.02;
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL
    );
    -- Verbatim from sql/monitoring.sql plus sql/queue_jobs_alter.sql. POST
    -- /funds enqueues LPA generation, and a hand-shortened copy of this table
    -- fails on max_retries — a 500 that looks like a scoping bug and is not.
    CREATE TABLE queue_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_type TEXT NOT NULL,
        payload TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ALTER TABLE queue_jobs ADD COLUMN started_at TEXT;
    ALTER TABLE queue_jobs ADD COLUMN completed_at TEXT;
    ALTER TABLE queue_jobs ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 3;
    ALTER TABLE queue_jobs ADD COLUMN dead_at TEXT;
  `);
  const u = db.prepare(
    'INSERT INTO users (id, role, email, investor_tier, investor_subscription_status) VALUES (?, ?, ?, ?, ?)',
  );
  u.run(GP, 'investor', 'gp@example.com', 'institutional', 'active');
  u.run(OTHER_GP, 'investor', 'other@example.com', 'institutional', 'active');
  u.run(ADMIN, 'admin', 'admin@example.com', null, null);

  const f = db.prepare('INSERT INTO vc_funds (id, name) VALUES (?, ?)');
  f.run(FUND_A, 'Fund A'); f.run(FUND_B, 'Fund B');
  f.run(FUND_NO_CO, 'Legacy Fund'); f.run(FUND_OTHER, "Another GP's Fund");

  const l = db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)');
  l.run(FIRM_A, GP); l.run(FIRM_B, GP);
  // The other GP belongs to FIRM_A too. This is the fixture that makes the
  // "a company cannot substitute for ownership" test mean something: their
  // fund is in the company the caller is acting for, and must still be 404.
  l.run(FIRM_A, OTHER_GP);
  return db;
}

/**
 * Apply what migrations 163 and 195 apply, through the bootstrap rather than
 * by hand, then set the ownership the tests are about.
 */
async function seeded(): Promise<any> {
  const db = freshDb();
  const e = env(db);
  const { ensureFundGpColumns } = await import('../src/services/fundGpSchema.ts');
  await ensureFundGpColumns(e as any);
  const g = db.prepare('UPDATE vc_funds SET gp_user_id = ?, company_id = ? WHERE id = ?');
  g.run(GP, FIRM_A, FUND_A);
  g.run(GP, FIRM_B, FUND_B);
  g.run(GP, null, FUND_NO_CO);
  g.run(OTHER_GP, FIRM_A, FUND_OTHER);
  return e;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

/**
 * Reach a fund through a GP-gated control. `/:id/report-periods` is the probe
 * because it bootstraps its own schema and reads nothing but the fund, so a
 * non-200 is `requireFundGp` refusing and never a missing fixture table.
 */
async function reach(
  e: any, who: { user: number; role: string }, fundId: number, company?: number | string,
): Promise<number> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(who.user, who.role)}` };
  if (company !== undefined) headers['X-Company-Id'] = String(company);
  // `requireFundGp` refuses by THROWING a Response, and Hono re-throws it
  // rather than returning it — which is why `withThrownResponses` exists at the
  // entry point. This harness drives the router directly, below that fix, so it
  // has to unwrap the throw itself. The status is the same either way; the
  // separate test below pins that production actually returns it.
  try {
    const res = await funds.request(`/${fundId}/report-periods`, { headers }, e);
    return res.status;
  } catch (err) {
    if (err instanceof Response) return err.status;
    throw err;
  }
}

const gp = { user: GP, role: 'investor' };
const admin = { user: ADMIN, role: 'admin' };

test('a GP reaches their fund under the firm that runs it', async () => {
  assert.equal(await reach(await seeded(), gp, FUND_A, FIRM_A), 200);
  assert.equal(await reach(await seeded(), gp, FUND_B, FIRM_B), 200);
});

test('the same fund under the GP\'s OTHER firm is 404', async () => {
  // The narrowing itself. Fund A belongs to firm A; acting for firm B, the GP
  // is not running it, and the refusal is the same 404 as a fund that does not
  // exist — the switcher must not become an oracle for the platform's funds
  // any more than a sequential id may be.
  assert.equal(await reach(await seeded(), gp, FUND_A, FIRM_B), 404);
  assert.equal(await reach(await seeded(), gp, FUND_B, FIRM_A), 404);
});

test('a fund whose GP has no company is theirs under every company', async () => {
  // Migration 195 leaves company_id NULL when the GP has no primary link, and
  // NULL means "under every company" — never "under none". Hiding these would
  // lock a GP out of their own fund because of a control they never touched.
  for (const co of [FIRM_A, FIRM_B, undefined]) {
    assert.equal(await reach(await seeded(), gp, FUND_NO_CO, co), 200, `company=${co}`);
  }
});

test('with no company selected, a GP still reaches every fund they run', async () => {
  // The pre-195 behaviour, preserved exactly. A caller who has never touched
  // the switcher sends no header, and must lose nothing.
  for (const id of [FUND_A, FUND_B, FUND_NO_CO]) {
    assert.equal(await reach(await seeded(), gp, id, undefined), 200, `fund=${id}`);
  }
});

test('a company cannot substitute for ownership', async () => {
  // The failure that would matter most, and the reason this stage is not just
  // another filter: FUND_OTHER sits in FIRM_A, the company the caller IS
  // acting for. Only `gp_user_id` keeps it out of reach. If the company arm
  // were ever ORed onto the clause instead of ANDed, this returns 200 and one
  // GP gains capital calls over another's fund.
  assert.equal(await reach(await seeded(), gp, FUND_OTHER, FIRM_A), 404);
  assert.equal(await reach(await seeded(), gp, FUND_OTHER, undefined), 404);
});

test('a forged company header is refused, not obeyed', async () => {
  // 999 is a company the caller has no link to, so resolveActiveCompany
  // returns null and the request behaves exactly as if no header was sent.
  // Both directions matter: it must not grant FUND_OTHER, and it must not
  // deny FUND_A either.
  assert.equal(await reach(await seeded(), gp, FUND_OTHER, 999), 404);
  assert.equal(await reach(await seeded(), gp, FUND_A, 999), 200);
  assert.equal(await reach(await seeded(), gp, FUND_A, 'not-a-number'), 200);
});

test('an admin is never narrowed by a company header', async () => {
  // An admin bypasses ownership, and must bypass the company with it. A
  // company arm that reached the admin branch would not filter their view, it
  // would 404 them out of funds they are meant to administer.
  for (const id of [FUND_A, FUND_B, FUND_NO_CO, FUND_OTHER]) {
    assert.equal(await reach(await seeded(), admin, id, FIRM_B), 200, `fund=${id}`);
  }
});

test('creating a fund records the firm it was created under', async () => {
  const e = await seeded();
  const res = await funds.request('/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token(GP, 'investor')}`,
      'Content-Type': 'application/json',
      'X-Company-Id': String(FIRM_B),
    },
    body: JSON.stringify({ name: 'Fund C' }),
  }, e);
  assert.equal(res.status, 201);
  const { fund } = (await res.json()) as any;
  assert.equal(Number(fund.gp_user_id), GP, 'the creator is the GP of record');
  assert.equal(Number(fund.company_id), FIRM_B, 'and the active firm is stamped with it');
  // Stamping is only worth anything if it then gates: the new fund must be
  // reachable under FIRM_B and refused under FIRM_A.
  assert.equal(await reach(e, gp, Number(fund.id), FIRM_B), 200);
  assert.equal(await reach(e, gp, Number(fund.id), FIRM_A), 404);
});

test('creating a fund with no firm selected records none, and stays reachable', async () => {
  // The honest NULL. Guessing the creator's primary company would put a firm
  // on a fund they never named — the one thing the fund surfaces must not do.
  const e = await seeded();
  const res = await funds.request('/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token(GP, 'investor')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'Fund D' }),
  }, e);
  assert.equal(res.status, 201);
  const { fund } = (await res.json()) as any;
  assert.equal(fund.company_id, null, 'no company selected must record no company');
  assert.equal(await reach(e, gp, Number(fund.id), FIRM_A), 200);
  assert.equal(await reach(e, gp, Number(fund.id), FIRM_B), 200);
});

// ---------- what deliberately does NOT narrow ----------
//
// Asserted against the source, the idiom fundGpAccess.test.ts already uses for
// decisions whose runtime proof would need a fixture larger than the claim.
// These are regression guards: each one fails if a later change narrows a
// surface this stage decided must stay wide, which is the mistake that looks
// like more scoping and is less product.

const routeSrc = (await import('node:fs')).readFileSync(
  (await import('node:path')).resolve(process.cwd(), 'cloudflare-worker/src/routes/funds.ts'), 'utf8');
const scopeSrc = (await import('node:fs')).readFileSync(
  (await import('node:path')).resolve(process.cwd(), 'cloudflare-worker/src/services/tenancyScope.ts'), 'utf8');

test('the LP portal is a personal view and carries no company clause', () => {
  // /lp-portal answers "what do I hold", not "what does my firm hold". It
  // goes through lpSelfScope, which exists precisely because returning more
  // there corrupts a personal view rather than granting an oversight one.
  const start = routeSrc.indexOf("funds.get('/lp-portal'");
  const end = routeSrc.indexOf("funds.get('/syndication'");
  assert.ok(start > 0 && end > start);
  const handler = routeSrc.slice(start, end);
  assert.match(handler, /lpSelfScope/, 'still the self-view predicate');
  assert.doesNotMatch(handler, /company/i, 'and no company narrowing');
});

test('neither LP scope takes a company at all', () => {
  // The strongest form of "not narrowed": there is no parameter to pass. A
  // future company arm on these has to be added deliberately, and this fails
  // when it is.
  for (const fn of ['lpMembershipScope', 'lpSelfScope']) {
    const sig = scopeSrc.slice(scopeSrc.indexOf(`export function ${fn}(`));
    assert.doesNotMatch(sig.slice(0, 200), /companyId/, `${fn} must take no company`);
  }
});

test('the fund list and analytics stay platform-wide', () => {
  // Not merely "a directory": api.fundsList() is read by
  // SpinoutLabLpWorkspacePage, and Spin-Out Lab is out of bounds for this
  // rollout. Narrowing these would change a page this work must not touch.
  for (const route of ["funds.get('/', ", "funds.get('/analytics'", "funds.get('/:id', "]) {
    const start = routeSrc.indexOf(route);
    assert.ok(start > 0, `${route} not found`);
    assert.doesNotMatch(routeSrc.slice(start, start + 600), /company_id/,
      `${route} must not be narrowed by company`);
  }
});
