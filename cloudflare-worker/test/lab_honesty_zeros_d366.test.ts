/**
 * D366 — the Lab tools' Worker reads stop turning a missing or unread value
 * into zero. D360, D364 and D365 each filed one of these and left it:
 *
 *   - `GET /captable/equity-plan` caught a failed SELECT into an empty list, so
 *     "No pools or grants recorded" could hide a read that never happened;
 *   - `GET /contacts/raise-pro-rata` computed entitlements against
 *     `target_amount || 0` and post-round stakes against `pre_money || 0` and
 *     `taking_amount || 0`, so a round with no target showed every right as $0;
 *   - the brand page DTOs sent `views_count || 0` / `?? 0`;
 *   - the Stripe import's success body sent `mrr ?? 0` / `customers ?? 0`.
 *
 * The real routers run against real SQLite (node:sqlite through
 * _d1_sqlite.mjs); the equity-plan failure is injected at the adapter for its
 * one SELECT, so auth runs unmocked. The Stripe body cannot be reached with a
 * missing figure through the real sync (its success path always returns
 * numbers), so that one line is pinned as source text.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/lab_honesty_zeros_d366.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import captable from '../src/routes/captable.ts';
import contacts from '../src/routes/contacts.ts';
import brand from '../src/routes/brand.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 10, PROJECT = 1;
const SQLITE_TEXT = 'disk I/O error: database page 9 is corrupt';

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, email TEXT, name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, founder_id INTEGER, spinout_lab_active INTEGER);
    CREATE TABLE user_company_links (id INTEGER PRIMARY KEY, company_id INTEGER, user_id INTEGER);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
    CREATE TABLE cap_table_option_pools (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT,
      shares_authorized REAL, shares_issued REAL, shares_available REAL, source TEXT, updated_at TEXT);
    CREATE TABLE cap_table_vesting (id INTEGER PRIMARY KEY, user_id INTEGER, holder_id TEXT, security_id TEXT,
      start_date TEXT, cliff_months INTEGER, total_months INTEGER, total_shares REAL, vested_shares REAL,
      source TEXT, updated_at TEXT);
    INSERT INTO users (id, role, founder_id) VALUES (10, 'founder', 1001);
    INSERT INTO projects (id, name, founder_id) VALUES (1, 'Acme', 1001);
  `);
  return db;
}

async function call(router: any, path: string, DB: unknown) {
  const tok = await new SignJWT({ user_id: FOUNDER, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await router.request(path, { headers: { Authorization: `Bearer ${tok}` } }, { JWT_SECRET, ENVIRONMENT: 'development', DB });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

/** The same D1 over `db`, except any SELECT containing `needle` throws. */
function failing(db: InstanceType<typeof DatabaseSync>, needle: string) {
  const d1: any = d1Over(db);
  const prepare = d1.prepare.bind(d1);
  d1.prepare = (sql: string) => {
    const stmt = prepare(sql);
    if (!sql.includes(needle)) return stmt;
    const bind = stmt.bind.bind(stmt);
    stmt.bind = (...a: unknown[]) => {
      const bound = bind(...a);
      bound.all = async () => { throw new Error(SQLITE_TEXT); };
      return bound;
    };
    return stmt;
  };
  return d1;
}

async function quiet<T>(fn: () => Promise<T>, sink: unknown[][] = []): Promise<T> {
  const orig = console.error;
  console.error = (...a: unknown[]) => { sink.push(a); };
  try { return await fn(); } finally { console.error = orig; }
}

// ---- equity plan ----------------------------------------------------------

for (const table of ['cap_table_option_pools', 'cap_table_vesting']) {
  test(`equity plan: a failed ${table} read is a 500 refusal, never an empty plan`, async () => {
    const logged: unknown[][] = [];
    const r = await quiet(() => call(captable, '/equity-plan', failing(freshDb(), `FROM ${table}`)), logged);
    assert.equal(r.status, 500);
    assert.equal(r.body.error, 'equity_plan_read_failed');
    assert.match(r.body.message, /not a claim that none are recorded/);
    assert.equal('pools' in r.body, false, 'no list rides on a refusal');
    assert.equal('grants' in r.body, false);
    assert.doesNotMatch(JSON.stringify(r.body), /disk I\/O|corrupt/, 'SQLite\'s text never reaches the body');
    assert.ok(logged.some((a) => a.join(' ').includes(SQLITE_TEXT)), 'it is logged instead');
  });
}

test('equity plan: a readable empty store is still 200 with nothing recorded', async () => {
  const r = await call(captable, '/equity-plan', d1Over(freshDb()));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.pools, []);
  assert.deepEqual(r.body.grants, []);
  assert.equal(r.body.summary.shares_authorized, null);
});

// ---- pro-rata --------------------------------------------------------------

async function proRata(round: { target_amount: number | null; pre_money: number | null },
  holders: Array<{ uid: string; stake: number; taking: number | null; state: string }>) {
  const db = freshDb();
  const DB = d1Over(db);
  // Let the route build its own schema first, then seed the round.
  await call(contacts, `/raise-pro-rata?project_id=${PROJECT}`, DB);
  db.prepare(`INSERT INTO raise_rounds (id, uid, project_id, name, target_amount, status, pre_money) VALUES (1, 'r1', ?, 'Seed', ?, 'active', ?)`)
    .run(PROJECT, round.target_amount, round.pre_money);
  for (const h of holders) {
    db.prepare(`INSERT INTO raise_pro_rata (uid, project_id, round_id, holder_name, prior_stake_pct, taking_amount, state) VALUES (?, ?, 1, ?, ?, ?, ?)`)
      .run(h.uid, PROJECT, h.uid, h.stake, h.taking, h.state);
  }
  const r = await call(contacts, `/raise-pro-rata?project_id=${PROJECT}`, DB);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

test('pro-rata: a round with no target shows no entitlement, with its reason — never $0', async () => {
  const body = await proRata({ target_amount: null, pre_money: 4_000_000 },
    [{ uid: 'a', stake: 10, taking: null, state: 'offered' }]);
  const [h] = body.holders;
  assert.equal(h.entitlement, null);
  assert.equal(h.entitlement_raw, null);
  assert.match(h.entitlement_not_recorded, /no target amount on record/);
  assert.equal(body.result.round_size, null);
  assert.equal(body.result.entitlement_total, null);
  assert.equal(body.result.rule, null, 'no reconciliation is claimed over entitlements nobody computed');
  assert.equal(h.post_round_stake_pct, null);
  assert.match(h.post_round_stake_not_recorded, /target amount/);
});

test('pro-rata: no pre-money means no post-round stake, with its reason', async () => {
  const body = await proRata({ target_amount: 1_000_000, pre_money: null },
    [{ uid: 'a', stake: 10, taking: 100_000, state: 'taking' }]);
  const [h] = body.holders;
  assert.equal(h.entitlement, 100_000, 'the entitlement needs only the target');
  assert.equal(h.entitlement_not_recorded, null);
  assert.equal(h.post_round_stake_pct, null);
  assert.match(h.post_round_stake_not_recorded, /pre-money/);
});

test('pro-rata: an undecided holder has no post-round stake; a waived one takes nothing', async () => {
  const body = await proRata({ target_amount: 1_000_000, pre_money: 4_000_000 }, [
    { uid: 'a', stake: 10, taking: null, state: 'offered' },
    { uid: 'b', stake: 5, taking: null, state: 'waived' },
    { uid: 'c', stake: 20, taking: 200_000, state: 'taking' },
  ]);
  const by = Object.fromEntries(body.holders.map((h: any) => [h.uid, h]));
  assert.equal(by.a.post_round_stake_pct, null);
  assert.match(by.a.post_round_stake_not_recorded, /not recorded what they are taking/);
  // 5% of 4M = 200k, diluted by 1M of new money: 200k / 5M = 4%.
  assert.equal(by.b.post_round_stake_pct, 4);
  assert.equal(by.b.post_round_stake_not_recorded, null);
  // (800k + 200k) / 5M = 20%.
  assert.equal(by.c.post_round_stake_pct, 20);
  assert.equal(by.c.entitlement, 200_000);
  assert.equal(body.result.round_size, 1_000_000);
  assert.equal(body.result.rule, 'raw');
});

// ---- brand views_count -----------------------------------------------------

async function brandPages(views: number | null) {
  const db = freshDb();
  const DB = d1Over(db);
  await call(brand, `/landing/by-project/${PROJECT}/pages`, DB); // builds landing_pages
  db.prepare(`INSERT INTO landing_pages (id, project_id, slug, name, published, views_count) VALUES (1, ?, 'acme-x', 'Acme', 1, ?)`)
    .run(PROJECT, views);
  const list = await call(brand, `/landing/by-project/${PROJECT}/pages`, DB);
  const one = await call(brand, `/landing/by-project/${PROJECT}`, DB);
  return { list, one };
}

test('brand: a page with no stored view count reads null in both DTOs, never 0', async () => {
  const { list, one } = await brandPages(null);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.pages[0].views_count, null);
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.equal(one.body.views_count, null);
});

test('brand: a recorded count, zero included, comes back as recorded', async () => {
  for (const n of [0, 37]) {
    const { list, one } = await brandPages(n);
    assert.equal(list.body.pages[0].views_count, n);
    assert.equal(one.body.views_count, n);
  }
});

// ---- Stripe import body ------------------------------------------------------

test('Stripe import: the success body never invents a $0 MRR or 0 customers', () => {
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/progress.ts'), 'utf8');
  const a = src.indexOf("source: 'stripe',\n    // D366");
  assert.ok(a > 0, 'the import success body is where D366 left it');
  const body = src.slice(a, src.indexOf('});', a));
  assert.doesNotMatch(body, /\?\?\s*0|\|\|\s*0/, 'no zero fallback on a figure');
  assert.match(body, /mrr: Number\.isFinite\(result\.mrr\) \? result\.mrr : null/);
  assert.match(body, /customers: Number\.isFinite\(result\.customers\) \? result\.customers : null/);
});
