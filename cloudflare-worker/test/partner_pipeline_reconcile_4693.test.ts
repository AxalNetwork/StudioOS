/**
 * D4693 (#4693) — the Pipeline's overview and its detail zones describe the same
 * company, populations, money and lifecycle. One fixture is read through every
 * surface (`/api/quotes/me`, `/api/quotes/analytics`, and the zones under
 * `/api/partner/pipeline`), with and without a selected company, and the figures
 * must agree. Synthetic data only.
 *
 * WHAT IS PINNED
 *   · Company scope: the zones narrow to the verified selected company exactly as
 *     the overview does (a row with no company stays visible); writes are scoped
 *     the same way; with nothing selected every company is in.
 *   · One win rate: Proposals and Analytics print the same number and the same
 *     sentence, and a withdrawn quote that carries a `decided_at` is not a loss.
 *   · Current recurring revenue is ACTIVE retainers' MONTHLY amounts: an ended
 *     retainer is not in it, a quarterly amount is divided by three, an unknown
 *     amount is named rather than counted as zero.
 *   · One definition of an open negotiation, and a label that follows the quote.
 *   · The traction score is validated, out of 100, versioned, and says what it
 *     did not score.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/partner_pipeline_reconcile_4693.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';

import partnerPipeline from '../src/routes/partner_pipeline.ts';
import { quotesRouter } from '../src/routes/needs.ts';
import pipeline from '../src/routes/pipeline.ts';
import { analysePipeline } from '../src/services/bdAnalytics.ts';
import { isRetainerActive, monthlyAmountCents, retainerProjection } from '../src/routes/_partner_workspace_helpers.ts';
import { MATCH_DEPS } from '../src/services/ai/matchRows.ts';
import {
  companyBinds, negotiationIsOpen, negotiationLabel, quoteOutcome, winRate, winRateBasis,
} from '../src/services/partnerPipelineRules.ts';
import {
  COMPONENT_CAPS_V2, FORMULA_KEY, formulaVersionOf, scaleOf, scoreTraction, validateKeyMetrics,
} from '../src/services/tractionScore.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const OURS_USER = 80;
const FOUNDER_USER = 82;
const CO_A = 10;
const CO_B = 20;

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
    async batch(x: any[]) {
      const out = [];
      for (const st of x || []) out.push(await st.run().catch(() => ({})));
      return out;
    },
  };
}

const migration = (name: string) => readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');

/**
 * One table, lifted verbatim out of the production schema baseline.
 *
 * `schema_baseline.sql` is the dump of the live D1 and is what
 * `check-baseline-drift.mjs` verifies production against, so a fixture built
 * from it cannot describe a shape production does not have. Used where a
 * migration cannot simply be replayed — `200_service_offerings_shape.sql`
 * opens with a preflight (`SELECT partner_id FROM service_offerings WHERE 0`)
 * that only makes sense against the pre-200 table, so replaying it on an empty
 * database is not possible.
 *
 * THIS EXISTS BECAUSE HAND-COPYING THE SHAPE HID A PRODUCTION OUTAGE. This file
 * used to declare `service_offerings` inline with `partner_id INTEGER NOT NULL`
 * — the retired `sql/historical/t13_t14_t15.sql` marketplace shape — so every
 * test here passed while `GET /partner/pipeline/leads` answered
 * `D1_ERROR: no such column: partner_id` to every partner in production. The
 * header below already stated the rule; this makes it enforceable.
 */
function baselineTable(name: string): string {
  const sql = readFileSync(`${SQL}/schema_baseline.sql`, 'utf8');
  const at = sql.indexOf(`CREATE TABLE ${name} (`);
  if (at < 0) throw new Error(`${name} is not in schema_baseline.sql`);
  const end = sql.indexOf(');', at);
  if (end < 0) throw new Error(`${name}'s definition in schema_baseline.sql is unterminated`);
  return sql.slice(at, end + 2);
}


function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  // The tables 208 hangs off, in their live shapes. `partners` is schema.sql's;
  // `founder_needs`, `quotes` and `engagements` are t13_t14_t15.sql's.
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, partner_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL, company TEXT, email TEXT UNIQUE NOT NULL,
      specialization TEXT, status TEXT NOT NULL DEFAULT 'active'
    );
    -- #4673: an engagement's founder_id is a FOUNDER PROFILE (founders.id), and the client's name is
    -- read from it. These fixtures keep the founder's id equal to the user's (FOUNDER_USER) on purpose;
    -- partner_delivery_report_access_4673.test.ts proves the two apart.
    CREATE TABLE founders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, name TEXT NOT NULL, email TEXT
    );
    CREATE TABLE founder_needs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      project_id INTEGER NOT NULL, founder_id INTEGER NOT NULL,
      category TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
      budget_min REAL, budget_max REAL, timeline TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      need_id INTEGER NOT NULL, rfp_id INTEGER, partner_id INTEGER NOT NULL,
      price REAL NOT NULL, timeline_weeks INTEGER, deliverables TEXT NOT NULL,
      notes TEXT, status TEXT NOT NULL DEFAULT 'submitted', decided_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      company_id INTEGER,
      UNIQUE (need_id, partner_id)
    );
    CREATE TABLE engagements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      need_id INTEGER NOT NULL, quote_id INTEGER NOT NULL UNIQUE,
      partner_id INTEGER NOT NULL, founder_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL, price REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'accepted',
      delivered_at TEXT, delivery_notes TEXT, cancelled_at TEXT, cancel_reason TEXT,
      invoice_id TEXT, invoiced_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      company_id INTEGER
    );
  `);

  db.exec(migration('208_partner_delivery_stores'));
  db.exec(migration('202611141535_5944_negotiation_wip_limits'));
  db.exec(migration('209_partner_offers_stores'));
  db.exec(migration('229_fit_rule_signal'));
  db.exec(migration('233_partner_lead_passes'));
  db.exec(migration('234_quote_versions_and_loss'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE, name TEXT NOT NULL);
    CREATE TABLE company_profiles (id INTEGER PRIMARY KEY, archived_at TEXT);
    CREATE TABLE user_company_links (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
  `);
  db.exec(baselineTable('service_offerings'));

  db.prepare('INSERT INTO users (id, role, partner_id, name, email) VALUES (?,?,?,?,?)').run(OURS_USER, 'partner', 1, 'Ours', 'ours@example.com');
  db.prepare('INSERT INTO users (id, role, partner_id, name, email) VALUES (?,?,?,?,?)').run(FOUNDER_USER, 'founder', null, 'Fran', 'fran@example.com');
  db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(FOUNDER_USER, 'Fran', 'fran@example.com');
  db.prepare('INSERT INTO partners (id, uid, name, email) VALUES (?,?,?,?)').run(1, 'p-1', 'Ours', 'ours@example.com');
  for (const co of [CO_A, CO_B]) {
    db.prepare('INSERT INTO company_profiles (id) VALUES (?)').run(co);
    db.prepare('INSERT INTO user_company_links (uid, company_id, user_id) VALUES (?,?,?)').run(`l-${co}`, co, OURS_USER);
  }

  // One quote per need. company: A, B, or none (NULL, visible under any selection).
  const need = db.prepare('INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description) VALUES (?,?,?,?,?,?,?)');
  const quote = db.prepare('INSERT INTO quotes (id, uid, need_id, partner_id, price, deliverables, status, decided_at, company_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const rows: Array<[number, string, number, string | null, number | null]> = [
    // id, status, price, decided_at, company
    [501, 'accepted', 10000, '2026-02-01', CO_A],
    [502, 'rejected', 8000, '2026-02-02', CO_A],
    // A WITHDRAWN QUOTE THAT CARRIES A decided_at: not a decision, so not a loss.
    [503, 'withdrawn', 6000, '2026-02-03', CO_A],
    [504, 'submitted', 5000, null, CO_A],
    [505, 'accepted', 20000, '2026-02-05', CO_B],
    [506, 'submitted', 4000, null, null],
    [507, 'accepted', 3000, '2026-02-07', CO_A],
    [508, 'accepted', 9000, '2026-02-08', CO_A],
    [509, 'accepted', 7000, '2026-02-09', CO_A],
  ];
  for (const [id, status, price, decided, co] of rows) {
    need.run(id - 200, `need-${id}`, 9, FOUNDER_USER, 'engineering', `Need ${id}`, 'd');
    quote.run(id, `q-${id}`, id - 200, 1, price, 'Scope', status, decided, co, `2026-01-${String(id - 490).padStart(2, '0')}`);
  }

  // Engagements and retainers. cents are whole cents.
  const eng = db.prepare('INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price, company_id) VALUES (?,?,?,?,?,?,?,?,?)');
  const ret = db.prepare('INSERT INTO partner_retainers (uid, engagement_id, shape, cadence, amount_cents, retained_hours, renews_at, ended_at) VALUES (?,?,?,?,?,?,?,?)');
  const eRows: Array<[number, number, number | null, string, number | null, string | null]> = [
    // engagement, quote, company, cadence, amount, ended_at
    [601, 501, CO_A, 'monthly', 100000, null],
    [602, 508, CO_A, 'quarterly', 300000, null],
    [603, 509, CO_A, 'monthly', 500000, '2020-01-01'],
    [604, 505, CO_B, 'monthly', 700000, null],
    [605, 507, CO_A, 'monthly', null, null],
  ];
  for (const [id, q, co, cadence, amount, ended] of eRows) {
    eng.run(id, `e-${id}`, q - 200, q, 1, FOUNDER_USER, 9, 1000, co);
    ret.run(`r-${id}`, id, 'retainer', cadence, amount, null, '2099-01-01', ended);
  }

  // Negotiations: an open stage on a waiting quote, a closed one, and an open stage left on an ACCEPTED quote.
  const neg = db.prepare('INSERT INTO quote_negotiations (uid, quote_id, stage, ball, last_moved_at) VALUES (?,?,?,?,?)');
  neg.run('n-504', 504, 'terms', 'us', '2026-02-01T00:00:00Z');
  neg.run('n-506', 506, 'closed', 'them', '2026-02-01T00:00:00Z');
  neg.run('n-507', 507, 'legal', 'us', '2026-02-01T00:00:00Z');
  return db;
}

function env(db: InstanceType<typeof DatabaseSync>) {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) };
}

const app = new Hono<any>();
app.route('/api/quotes', quotesRouter);
app.route('/api/partner/pipeline', partnerPipeline);

async function call(e: any, method: string, path: string, company: number | null = null, body?: any) {
  const token = await new SignJWT({ user_id: OURS_USER, role: 'partner' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (company !== null) headers['X-Company-Id'] = String(company);
  const init: RequestInit = { method, headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; (init as any).body = JSON.stringify(body); }
  const res = await app.request(path, init, e, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const get = (e: any, path: string, company: number | null) => call(e, 'GET', path, company);

test('lead ranking only hands eligible marketplace needs to the ranker', async (t) => {
  const db = freshDb();
  t.after(() => db.close());
  db.exec("UPDATE founder_needs SET status = 'closed'");
  const need = db.prepare('INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description) VALUES (?, ?, 9, ?, ?, ?, ?)');
  for (const [id, title] of ['Eligible design', 'Gambling project', 'Mainframe support', 'Already bid', 'Already passed'].entries()) {
    need.run(900 + id, `rank-${id}`, FOUNDER_USER, 'design', title, 'Marketplace fixture');
  }
  db.exec(`INSERT INTO partner_fit_rules (uid, partner_id, kind, value) VALUES
      ('declined', 1, 'sector_declined', 'gambling'), ('missing', 1, 'capability_absent', 'mainframe');
    INSERT INTO quotes (uid, need_id, partner_id, price, deliverables) VALUES ('bid-rank', 903, 1, 100, '[]');
    INSERT INTO partner_lead_passes (partner_id, need_id, reason) VALUES (1, 904, 'timing');`);
  const rerank = t.mock.fn(async (_query: string, _contexts: string[]) => null);
  t.mock.method(MATCH_DEPS, 'make', () => ({ embed: async () => null, rerank, write: async () => assert.fail('ranking must not write') }));
  const response = await call(env(db), 'POST', '/api/partner/pipeline/leads/rank', CO_A, { query: 'design' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(response.body.rows.map((row: { need_id: number }) => row.need_id), [900]);
  assert.equal(rerank.mock.callCount(), 1);
  assert.match(rerank.mock.calls[0].arguments[1].join('\n'), /^Eligible design\./);
  assert.equal(rerank.mock.calls[0].arguments[1].length, 1);
  const leads = await get(env(db), '/api/partner/pipeline/leads', CO_A);
  assert.equal(leads.status, 200, JSON.stringify(leads.body));
  assert.equal(leads.body.open_count, 3);
  assert.equal(leads.body.excluded_count, 2);
  assert.match(leads.body.population_note, /including fit exclusions, except needs already bid on or passed/);
});

// 1 ───────────────────────────────────────────────────────────────────────────
test('the overview and the proposal zone count the same populations and print the same win rate, with and without a company', async () => {
  // Mutations checked: the zone not narrowed by company; decided_at making a withdrawn quote a decision; the win rate not from winRate().
  const e = env(freshDb());
  for (const company of [CO_A, CO_B, null]) {
    const analytics = (await get(e, '/api/quotes/analytics', company)).body.pipeline;
    const zone = (await get(e, '/api/partner/pipeline/proposals', company)).body;
    const mine = (await get(e, '/api/quotes/me', company)).body.items;
    const label = String(company);
    assert.equal(zone.items.length, mine.length, `${label}: the zone lists the quotes the overview lists`);
    assert.deepEqual([zone.won_count, zone.lost_count, zone.live_count, zone.withdrawn_count],
      [analytics.accepted, analytics.rejected, analytics.pending, analytics.withdrawn], `${label}: the same four populations`);
    assert.equal(zone.win_rate_pct, analytics.win_rate_pct, `${label}: one win rate`);
    assert.equal(zone.win_rate_basis, analytics.win_rate_basis, `${label}: one sentence for it`);
  }
  // Company A (+ rows with no company): 4 won, 1 lost, 2 waiting, 1 withdrawn. The withdrawn quote's decided_at is not a decision.
  const a = (await get(e, '/api/partner/pipeline/proposals', CO_A)).body;
  assert.deepEqual([a.won_count, a.lost_count, a.live_count, a.withdrawn_count, a.decided_count, a.win_rate_pct], [4, 1, 2, 1, 5, 80]);
  // Company B (+ no-company rows): one won, the unattached one waiting.
  const b = (await get(e, '/api/partner/pipeline/proposals', CO_B)).body;
  assert.deepEqual([b.won_count, b.lost_count, b.live_count, b.win_rate_pct], [1, 0, 1, 100]);
  // Nothing selected: every company is in.
  const all = (await get(e, '/api/partner/pipeline/proposals', null)).body;
  assert.equal(all.items.length, 9);
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('recurring revenue is active retainers\' monthly amounts: ended ones are out, a quarterly is divided by three, an unpriced one is named', async () => {
  // Mutations checked: isActiveRetainer ignoring ended_at; monthlyCents not dividing a quarterly amount; the company predicate removed.
  const e = env(freshDb());
  const a = (await get(e, '/api/partner/pipeline/retainers', CO_A)).body;
  assert.equal(a.mrr_cents, 200000, '100000 monthly + 300000 quarterly / 3; the ended 500000 and the unpriced one are not in it');
  assert.deepEqual([a.retainer_count, a.active_count, a.ended_count], [4, 3, 1]);
  const row = (id: number) => a.items.find((x: any) => x.engagement_id === id).retainer;
  assert.deepEqual([row(602).monthly_cents, row(602).amount_cents, row(602).cadence], [100000, 300000, 'quarterly'], 'a "Monthly" figure is never the raw quarterly amount');
  assert.deepEqual([row(603).active, row(601).active, row(605).monthly_cents], [false, true, null]);
  assert.match(a.mrr_basis, /^2 active retainers with a recorded amount; normalised to a month \(quarterly divided by three\); 1 ended not counted\.$/);
  assert.match(a.mrr_note, /1 retainer has no amount recorded/);
  assert.equal(a.items.every((x: any) => x.engagement_id !== 604), true, 'another company\'s retainer is not in this company\'s book');

  assert.equal((await get(e, '/api/partner/pipeline/retainers', CO_B)).body.mrr_cents, 700000);
  assert.equal((await get(e, '/api/partner/pipeline/retainers', null)).body.mrr_cents, 900000, 'nothing selected: every company');
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('one definition of an open negotiation: the count, the flag and the label agree, and a decided quote is not open', async () => {
  // Mutations checked: negotiationIsOpen ignoring the quote; the label ignoring the quote outcome; open_count not from the rule.
  const e = env(freshDb());
  const n = (await get(e, '/api/partner/pipeline/negotiations', CO_A)).body;
  assert.equal(n.items.filter((x: any) => x.negotiation).length, 3);
  const by = (id: number) => n.items.find((x: any) => x.quote_id === id).negotiation;
  assert.deepEqual([by(504).open, by(504).label], [true, 'Terms']);
  assert.deepEqual([by(506).open, by(506).label], [false, 'Closed']);
  assert.deepEqual([by(507).open, by(507).label], [false, 'Won'], 'an open stage left on an accepted quote is not a live negotiation');
  assert.deepEqual([n.open_count, n.live_count, n.tracked_count], [1, 1, 3]);
  assert.match(n.count_basis, /^1 open of 3 tracked\./);
  assert.equal(n.awaiting_us_count, 1);
  // Company B holds none of these quotes (the unattached one is visible to both).
  const b = (await get(e, '/api/partner/pipeline/negotiations', CO_B)).body;
  assert.deepEqual([b.open_count, b.tracked_count], [0, 1]);
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('writes are scoped to the selected company like the reads: another company\'s quote or retainer is a 404', async () => {
  // Mutations checked: the companyId argument not passed to requireOwnQuote / requireOwnEngagement.
  const e = env(freshDb());
  const outcome = { outcome: 'lost', loss_reason: 'price' };
  assert.equal((await call(e, 'PUT', '/api/partner/pipeline/proposals/505/outcome', CO_A, outcome)).status, 404, 'B\'s quote, A selected');
  assert.notEqual((await call(e, 'PUT', '/api/partner/pipeline/proposals/502/outcome', CO_A, outcome)).status, 404, 'A\'s own quote is reachable');
  assert.equal((await call(e, 'PUT', '/api/partner/pipeline/retainers/604', CO_A, { cadence: 'monthly', amount_cents: 1 })).status, 404);
  assert.notEqual((await call(e, 'PUT', '/api/partner/pipeline/retainers/601', CO_A, { cadence: 'monthly', amount_cents: 110000 })).status, 404);
  assert.notEqual((await call(e, 'PUT', '/api/partner/pipeline/retainers/604', null, { cadence: 'monthly', amount_cents: 710000 })).status, 404, 'with no company selected the firm\'s whole book is in reach');
  assert.equal((await call(e, 'POST', '/api/partner/pipeline/negotiations/505/terms', CO_A, { label: 'Payment' })).status, 404);
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('the rules, as pure functions', () => {
  // Mutations checked: quoteOutcome reading decided_at; winRate counting withdrawn; monthlyCents defaulting an unknown cadence to monthly.
  assert.deepEqual(['accepted', 'rejected', 'submitted', 'withdrawn', 'draft', null].map(quoteOutcome), ['won', 'lost', 'open', 'withdrawn', 'unknown', 'unknown']);
  assert.deepEqual(winRate(4, 1), { pct: 80, decided: 5 });
  assert.deepEqual(winRate(2, 1), { pct: 66.7, decided: 3 });
  assert.deepEqual(winRate(0, 0), { pct: null, decided: 0 });
  assert.match(winRateBasis(0, 0, 3, 1), /^No quotes decided yet/);
  assert.match(winRateBasis(4, 1, 2, 1), /^4 won of 5 decided\. 2 still open and 1 withdrawn are excluded/);

  const now = new Date('2026-11-07T12:00:00Z');
  assert.equal(isRetainerActive({ ended_at: null }, now), true);
  assert.equal(isRetainerActive({ ended_at: '2026-11-07' }, now), false);
  assert.equal(isRetainerActive({ ended_at: '2026-11-07 13:00:00' }, now), true);
  assert.equal(isRetainerActive({ ended_at: '2026-11-07 12:00:00' }, now), false);
  assert.equal(isRetainerActive({ ended_at: 'soon' }, now), false);
  assert.equal(isRetainerActive({ engagement_status: 'cancelled' }, now), false);
  assert.equal(isRetainerActive({ cancelled_at: '2026-01-01' }, now), false);
  assert.equal(monthlyAmountCents({ amount_cents: 1200000, cadence: 'annual' }), 100000);
  assert.equal(monthlyAmountCents({ amount_cents: 100000, cadence: 'unknown' }), null);
  const projected = retainerProjection({ retainer_id: 1, cadence: 'quarterly', amount_cents: 300000, engagement_status: 'cancelled' }, [], now);
  assert.deepEqual([projected.retainer?.active, projected.retainer?.monthly_cents, projected.retainer?.current_monthly_cents], [false, 100000, null]);

  assert.equal(negotiationIsOpen('terms', 'submitted'), true);
  assert.equal(negotiationIsOpen('closed', 'submitted'), false);
  assert.equal(negotiationIsOpen('terms', 'accepted'), false);
  assert.equal(negotiationIsOpen(null, 'submitted'), false);
  assert.deepEqual([negotiationLabel('ready_to_sign', 'submitted'), negotiationLabel('terms', 'rejected'), negotiationLabel('terms', 'withdrawn')], ['Ready to sign', 'Lost', 'Withdrawn']);
  assert.deepEqual(companyBinds(7), [7, 7]);

  // The analytics engine classifies with the same function: a status the store does not define is counted nowhere.
  const engine = analysePipeline([
    { status: 'accepted', amount: 100 }, { status: 'rejected', amount: 50 }, { status: 'withdrawn', amount: 20 },
    { status: 'submitted', amount: 30 }, { status: 'draft', amount: 999 },
  ]);
  assert.deepEqual([engine.accepted, engine.rejected, engine.pending, engine.withdrawn, engine.open_value, engine.win_rate_pct], [1, 1, 1, 1, 30, 50]);
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('traction metrics are refused, not coerced, and a part nobody recorded is absent, not zero', () => {
  // Mutations checked: Number() coercion back in the validator; a range removed; a missing part scored as zero.
  const ok = validateKeyMetrics({ users: 1200, revenue: '5000', engagement: 40, growth: 12.5 });
  assert.deepEqual(ok, { ok: true, clean: { users: 1200, revenue: 5000, engagement: 40, growth: 12.5 } });
  const bad: Array<[string, unknown]> = [
    ['users', true], ['users', null], ['users', ''], ['users', []], ['users', '0x10'], ['users', '1e3'], ['users', ' '], ['users', -1],
    ['revenue', -5], ['retention', 101], ['engagement', -1], ['churn', 100.5], ['growth', -101], ['nps', 101], ['nps', -101], ['users', 1e11],
  ];
  for (const [k, v] of bad) {
    const r = validateKeyMetrics({ [k]: v });
    assert.equal(r.ok, false, `${k}=${JSON.stringify(v)}`);
  }
  assert.equal(validateKeyMetrics({}).ok, false);
  assert.equal(validateKeyMetrics({ stars: 5 }).ok, false);
  assert.equal(validateKeyMetrics([1]).ok, false);
  assert.deepEqual(validateKeyMetrics({ growth: -100, nps: -100, churn: 0 }).ok, true, 'the bounds themselves are allowed');
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('the score is out of 100 whatever the metrics, its caps add up to 100, and the formula is versioned', () => {
  // Mutations checked: a cap raised back to 40; the max not 100; a missing part scored as zero; the version not recorded.
  assert.equal(Object.values(COMPONENT_CAPS_V2).reduce((a, b) => a + b, 0), 100, 'the caps add up to the scale');
  const top = scoreTraction({ users: 1e10, revenue: 1e12, engagement: 100, growth: 10000 });
  assert.deepEqual([top.score, top.max, top.formula_version, top.missing], [100, 100, 2, []]);
  const none = scoreTraction({ users: 0, revenue: 0, engagement: 0, growth: 0 });
  assert.deepEqual([none.score, none.missing], [0, []], 'recorded zeros are zeros');
  const partial = scoreTraction({ users: 999 });
  assert.deepEqual([partial.score, partial.components.users, partial.components.revenue, partial.missing], [30, 30, null, ['revenue', 'engagement', 'growth']]);
  assert.match(partial.basis, /Not recorded, so not scored: revenue, engagement, growth\./);
  const noUsers = scoreTraction({ revenue: 1000 });
  assert.deepEqual([noUsers.components.users, noUsers.missing], [null, ['users', 'engagement', 'growth']], 'a first part nobody recorded is absent too');
  const shrinking = scoreTraction({ users: 999, growth: -50 });
  assert.equal(shrinking.components.growth, 0, 'a shrinking metric adds nothing and subtracts nothing');
  for (let i = 0; i < 200; i++) {
    const r = scoreTraction({ users: Math.random() * 1e10, revenue: Math.random() * 1e12, engagement: Math.random() * 100, growth: Math.random() * 10000 });
    assert.ok(r.score >= 0 && r.score <= 100, String(r.score));
  }
  assert.deepEqual([formulaVersionOf({ users: 5 }), formulaVersionOf({ [FORMULA_KEY]: 2 }), formulaVersionOf(null), formulaVersionOf({ [FORMULA_KEY]: 'x' })], [1, 2, 1, 1],
    'a snapshot with no recorded formula is formula 1');
  assert.deepEqual([scaleOf(1), scaleOf(2)], [110, 100]);
});

// 8 ───────────────────────────────────────────────────────────────────────────
test('POST /pipeline/metrics/snapshot: invalid metrics are refused and stored nowhere; a valid one stores its formula and says what it did not score', async () => {
  // Mutations checked: the formula key not stored; the validator bypassed; the legacy score read as /100.
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, partner_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER, name TEXT, email TEXT);
    INSERT INTO users (id, role, name, email) VALUES (1, 'admin', 'Root', 'root@example.test');
    -- D4676 (#4676): a snapshot is recorded against a venture that exists. The
    -- route used to store metrics for any deal id, real or not; it now asks the
    -- venture's access rule first, and a venture that is not there is a 404.
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, status TEXT, stage TEXT);
    INSERT INTO projects (id, name, founder_id, status, stage) VALUES (1, 'Scored venture', NULL, 'active', 'idea');
  `);
  const e = env(db);
  const papp = new Hono<any>();
  papp.route('/api/pipeline', pipeline);
  const token = await new SignJWT({ user_id: 1, role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const post = async (body: unknown) => {
    const res = await papp.request('/api/pipeline/metrics/snapshot', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, e, { waitUntil() {}, passThroughOnException() {} } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const rowsIn = () => (db.prepare('SELECT key_metrics, traction_score, traction_formula_version FROM metrics_snapshots').all() as any[]).map((r) => ({ ...r }));

  for (const km of [{ users: true }, { users: -5 }, { retention: 400 }, { growth: null }, { users: '1e3' }, {}]) {
    const r = await post({ deal_id: 1, key_metrics: km });
    assert.equal(r.status, 400, JSON.stringify(km));
  }
  assert.deepEqual(rowsIn(), [], 'nothing refused was stored');

  const ok = await post({ deal_id: 1, key_metrics: { users: 999, engagement: 50 } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.traction_score, ok.body.score_max, ok.body.formula_version, ok.body.components_missing], [38, 100, 2, ['revenue', 'growth']]);
  assert.match(ok.body.score_basis, /Not recorded, so not scored: revenue, growth\./);
  const stored = rowsIn();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].traction_formula_version, 2);
  assert.deepEqual(JSON.parse(stored[0].key_metrics), { users: 999, engagement: 50, [FORMULA_KEY]: 2 });
  assert.equal(formulaVersionOf(JSON.parse(stored[0].key_metrics)), 2);
});
