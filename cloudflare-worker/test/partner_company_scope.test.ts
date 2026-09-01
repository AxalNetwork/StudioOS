/**
 * Company scoping, stage 8: the Partner's three rows.
 *
 * Pipeline (quotes on founder needs), Delivery (engagements) and Offers (the
 * service catalog and co-marketing pitches) all show a partner their OWN work,
 * keyed on the partner alone. Migration 196 puts `company_id` on those rows so
 * a partner running two agencies can tell them apart.
 *
 * THREE THINGS THIS STAGE HAD TO GET RIGHT, and each has its own test below.
 *
 * 1. THE MARKETPLACES STAY WIDE. The founder-needs board and the founder-facing
 *    offering catalog exist to show work from people you have no relationship
 *    with. Narrowing either hides the demand a partner could bid on, or the
 *    providers a founder could hire.
 *
 * 2. THE TWO SIDES OF A SHARED ROW ASK DIFFERENT QUESTIONS. An engagement joins
 *    a founder to a partner. `engagements.company_id` is the PARTNER's agency,
 *    so the founder's branch narrows on the PROJECT's company instead
 *    (migration 189). Testing a founder against the partner's column would
 *    refuse them their own engagement.
 *
 * 3. THE NUMBERS MUST MATCH THE LIST. Quote analytics is a second query over
 *    the same rows; if only the list narrows, a partner reads a win rate for
 *    one agency beside a pipeline for another.
 *
 * Harness matches stages 1-7: real routers against real in-memory SQLite with
 * a real `user_company_links` table, so `resolveActiveCompany` is unmocked.
 * Every table is the canonical DDL copied verbatim — `service_offerings` from
 * sql/schema.sql (NOT the dead partner_id shape in t13_t14_t15.sql), the rest
 * from sql/t13_t14_t15.sql.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import services from '../src/routes/services.ts';
import { needs as needsRouter, quotesRouter, engagementsRouter } from '../src/routes/needs.ts';
import comarketing from '../src/routes/comarketing.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const PARTNER = { user: 42, partner_id: 7 };
const FOUNDER = { user: 50, founder_id: 150 };
const ADMIN = 44;
const AGENCY_A = 21;      // the partner's first agency
const AGENCY_B = 22;      // the partner's second
const FOUNDER_CO = 31;    // the founder's company — never a partner's
const PROJ = 3;
const NEED_OWN = 61;      // posted by our founder
const NEED_OTHER = 62;    // posted by a founder we have no relationship with

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
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, partner_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE partners (id INTEGER PRIMARY KEY, name TEXT, company TEXT, email TEXT);
    -- Verbatim from sql/t13_t14_t15.sql, plus migration 196's company_id on
    -- the pitch. Attributions get NO column: they inherit the pitch's agency.
    CREATE TABLE comarketing_pitches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      partner_id INTEGER NOT NULL, submitter_user_id INTEGER NOT NULL,
      title TEXT NOT NULL, summary TEXT NOT NULL,
      asset_type TEXT NOT NULL DEFAULT 'webinar', proposed_date TEXT,
      target_audience TEXT, distribution_channels TEXT, co_branding_notes TEXT,
      angle TEXT, what_you_bring TEXT, asset_url TEXT,
      status TEXT NOT NULL DEFAULT 'proposed', review_notes TEXT,
      reviewed_by_user_id INTEGER, reviewed_at TEXT, published_at TEXT,
      published_url TEXT, attribution_code TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      company_id INTEGER
    );
    CREATE TABLE comarketing_attributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      pitch_id INTEGER NOT NULL, partner_id INTEGER NOT NULL,
      event_kind TEXT NOT NULL, user_id INTEGER, project_id INTEGER,
      lead_email TEXT, referrer TEXT, landing_path TEXT, notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE founders (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER);
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL
    );
    -- Verbatim from sql/t13_t14_t15.sql, plus the company_id migration 196 adds.
    CREATE TABLE founder_needs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      project_id INTEGER NOT NULL, founder_id INTEGER NOT NULL,
      category TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
      budget_min REAL, budget_max REAL, timeline TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE rfps (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      need_id INTEGER NOT NULL UNIQUE, scope_md TEXT NOT NULL, deliverables_md TEXT,
      deadline_at TEXT, status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      need_id INTEGER NOT NULL, rfp_id INTEGER, partner_id INTEGER NOT NULL,
      price REAL NOT NULL, timeline_weeks INTEGER, deliverables TEXT NOT NULL, notes TEXT,
      status TEXT NOT NULL DEFAULT 'submitted', decided_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      company_id INTEGER,
      UNIQUE (need_id, partner_id)
    );
    CREATE TABLE engagements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      need_id INTEGER NOT NULL, quote_id INTEGER NOT NULL UNIQUE,
      partner_id INTEGER NOT NULL, founder_id INTEGER NOT NULL, project_id INTEGER NOT NULL,
      price REAL NOT NULL, status TEXT NOT NULL DEFAULT 'accepted',
      delivered_at TEXT, delivery_notes TEXT, cancelled_at TEXT, cancel_reason TEXT,
      invoice_id TEXT, invoiced_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      company_id INTEGER
    );
    -- Verbatim from sql/schema.sql — the shape routes/services.ts reads.
    CREATE TABLE service_offerings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      owner_user_id INTEGER NOT NULL,
      title TEXT NOT NULL, category TEXT, summary TEXT, price_usd REAL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      company_id INTEGER
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, founder_id, partner_id, email) VALUES (?,?,?,?,?)');
  u.run(PARTNER.user, 'partner', null, PARTNER.partner_id, 'p@example.com');
  u.run(FOUNDER.user, 'founder', FOUNDER.founder_id, null, 'f@example.com');
  u.run(ADMIN, 'admin', null, null, 'a@example.com');
  db.prepare('INSERT INTO partners (id, name, email) VALUES (?,?,?)')
    .run(PARTNER.partner_id, 'Acme Studio', 'p@example.com');
  db.prepare('INSERT INTO founders (id, name) VALUES (?, ?)').run(FOUNDER.founder_id, 'Fay');
  db.prepare('INSERT INTO projects (id, name, founder_id, company_id) VALUES (?,?,?,?)')
    .run(PROJ, 'Alpha', FOUNDER.founder_id, FOUNDER_CO);

  const l = db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?,?)');
  l.run(AGENCY_A, PARTNER.user); l.run(AGENCY_B, PARTNER.user);
  l.run(FOUNDER_CO, FOUNDER.user);

  const n = db.prepare(
    'INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description, status) VALUES (?,?,?,?,?,?,?,?)');
  n.run(NEED_OWN, 'need-own', PROJ, FOUNDER.founder_id, 'design', 'Brand refresh', 'desc', 'open');
  n.run(NEED_OTHER, 'need-other', 0, 999, 'eng', 'Someone else needs help', 'desc', 'open');

  // Two quotes from ONE partner, one per agency, so every list below has
  // something it must show and something it must hide.
  const q = db.prepare(
    'INSERT INTO quotes (id, uid, need_id, partner_id, price, deliverables, status, company_id) VALUES (?,?,?,?,?,?,?,?)');
  q.run(81, 'q-a', NEED_OWN, PARTNER.partner_id, 1000, 'd', 'accepted', AGENCY_A);
  q.run(82, 'q-b', NEED_OTHER, PARTNER.partner_id, 2000, 'd', 'submitted', AGENCY_B);

  const e = db.prepare(
    'INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price, company_id) VALUES (?,?,?,?,?,?,?,?,?)');
  e.run(91, 'e-a', NEED_OWN, 81, PARTNER.partner_id, FOUNDER.founder_id, PROJ, 1000, AGENCY_A);
  e.run(92, 'e-b', NEED_OTHER, 82, PARTNER.partner_id, FOUNDER.founder_id, PROJ, 2000, AGENCY_B);

  const o = db.prepare(
    'INSERT INTO service_offerings (id, uid, owner_user_id, title, is_active, company_id) VALUES (?,?,?,?,?,?)');
  o.run(71, 'o-a', PARTNER.user, 'Design sprints', 1, AGENCY_A);
  o.run(72, 'o-b', PARTNER.user, 'Growth audits', 1, AGENCY_B);
  o.run(73, 'o-null', PARTNER.user, 'Legacy offering', 1, null);
  o.run(74, 'o-other', ADMIN, "Someone else's offering", 1, null);
  // Owned by someone else, and sitting in the caller's OWN agency. This is the
  // row that makes the substitution test bite: only the ownership check keeps
  // it out of reach, so a gate that let a matching company grant access would
  // hand it over.
  o.run(75, 'o-other-same-co', ADMIN, "Another owner, my agency", 1, AGENCY_A);

  const pitch = db.prepare(
    'INSERT INTO comarketing_pitches (id, uid, partner_id, submitter_user_id, title, summary, company_id) VALUES (?,?,?,?,?,?,?)');
  pitch.run(51, 'p-a', PARTNER.partner_id, PARTNER.user, 'Webinar with A', 'summary text', AGENCY_A);
  pitch.run(52, 'p-b', PARTNER.partner_id, PARTNER.user, 'Podcast with B', 'summary text', AGENCY_B);
  const attr = db.prepare(
    'INSERT INTO comarketing_attributions (id, uid, pitch_id, partner_id, event_kind) VALUES (?,?,?,?,?)');
  attr.run(41, 'at-a', 51, PARTNER.partner_id, 'signup');
  attr.run(42, 'at-b', 52, PARTNER.partner_id, 'signup');
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

/**
 * @param e  an env to reuse. Omit for a fresh database — most tests want one —
 *           but a create-then-read sequence has to keep the same one, or the
 *           row under test is discarded before it can be looked at.
 */
async function call(
  router: any, path: string, who: { user: number; role: string },
  company?: number | string, init: RequestInit = {}, e?: any,
): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
    ...(init.headers as Record<string, string> | undefined),
  };
  if (company !== undefined) headers['X-Company-Id'] = String(company);
  const res = await router.request(path, { ...init, headers }, e ?? env(freshDb()));
  return { status: res.status, body: await res.json().catch(() => null) };
}

const ids = (rows: any[]) => (rows || []).map((r) => Number(r.id)).sort((a, b) => a - b);
const partner = { user: PARTNER.user, role: 'partner' };
const founder = { user: FOUNDER.user, role: 'founder' };
const admin = { user: ADMIN, role: 'admin' };

// ---------- Offers: the catalog ----------

test('?mine=1 shows only the active agency, plus rows with no agency', async () => {
  const a = await call(services, '/offerings?mine=1', partner, AGENCY_A);
  assert.deepEqual(ids(a.body.items), [71, 73], 'agency A and the NULL-company row');
  const b = await call(services, '/offerings?mine=1', partner, AGENCY_B);
  assert.deepEqual(ids(b.body.items), [72, 73]);
});

test('with no agency selected, ?mine=1 shows the whole catalog', async () => {
  const r = await call(services, '/offerings?mine=1', partner);
  assert.deepEqual(ids(r.body.items), [71, 72, 73]);
});

test('the founder-facing catalog is a marketplace and does NOT narrow', async () => {
  // Narrowing this hides the providers a founder could hire.
  //
  // Browsed as the PARTNER on purpose. The founder holds no link to either
  // agency, so a company header from them resolves to null and no amount of
  // over-narrowing would show up — the first version of this test passed
  // against a build that narrowed the catalog, which is exactly the mistake
  // this stage is most likely to make.
  for (const co of [AGENCY_A, AGENCY_B, undefined]) {
    const r = await call(services, '/offerings', partner, co);
    assert.deepEqual(ids(r.body.items), [71, 72, 73, 74, 75], `company=${co}`);
  }
  // And from a founder acting for their own company, which they do hold.
  const asFounder = await call(services, '/offerings', founder, FOUNDER_CO);
  assert.deepEqual(ids(asFounder.body.items), [71, 72, 73, 74, 75]);
});

test('editing an offering under the wrong agency is 404', async () => {
  // The write gate is an authorisation check, so this is a refusal, not a
  // filter — and it must be the same 404 as an offering that does not exist.
  const ok = await call(services, '/offerings/71', partner, AGENCY_A, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Renamed' }),
  });
  assert.equal(ok.status, 200);
  const no = await call(services, '/offerings/71', partner, AGENCY_B, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Renamed' }),
  });
  assert.equal(no.status, 404);
});

test('an agency cannot substitute for ownership', async () => {
  // 75 is owned by someone else and sits in AGENCY_A — the company the caller
  // is acting for. Only the ownership check keeps it out of reach, so if the
  // company test ever runs before ownership, or replaces it, this becomes 200
  // and one partner can edit another's catalog. 74 is the same question with
  // no company on the row at all.
  for (const id of [74, 75]) {
    for (const co of [AGENCY_A, AGENCY_B, undefined]) {
      const r = await call(services, `/offerings/${id}`, partner, co, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Stolen' }),
      });
      assert.equal(r.status, 404, `offering=${id} company=${co}`);
    }
  }
});

test('creating an offering records the agency it was created under', async () => {
  // Asserted through behaviour, not through the response body: `serialize()`
  // does not emit company_id, so reading it back off the POST would be a test
  // of nothing. What the stamp is FOR is that the row then follows the
  // switcher, so that is what this checks.
  const e = env(freshDb());
  const r = await call(services, '/offerings', partner, AGENCY_B, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'New service' }),
  }, e);
  assert.equal(r.status, 200);
  const created = Number(r.body.id);

  const inB = await call(services, '/offerings?mine=1', partner, AGENCY_B, {}, e);
  assert.ok(ids(inB.body.items).includes(created), 'visible under the agency it was made in');
  const inA = await call(services, '/offerings?mine=1', partner, AGENCY_A, {}, e);
  assert.ok(!ids(inA.body.items).includes(created), 'and not under the other one');
});

test('creating with no agency selected records none, and stays visible in both', async () => {
  // The honest NULL: guessing the creator's primary company would file the
  // offering under a firm they never named.
  const e = env(freshDb());
  const r = await call(services, '/offerings', partner, undefined, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Unfiled service' }),
  }, e);
  const created = Number(r.body.id);
  for (const co of [AGENCY_A, AGENCY_B]) {
    const seen = await call(services, '/offerings?mine=1', partner, co, {}, e);
    assert.ok(ids(seen.body.items).includes(created), `visible under ${co}`);
  }
});

// ---------- Pipeline: needs and quotes ----------

test('the needs board is a marketplace and does NOT narrow', async () => {
  // A partner is meant to see demand from founders they have no relationship
  // with. This is the surface the Pipeline row exists for.
  for (const co of [AGENCY_A, AGENCY_B, undefined]) {
    const r = await call(needsRouter, '/', partner, co);
    assert.deepEqual(ids(r.body.items), [NEED_OWN, NEED_OTHER], `company=${co}`);
  }
});

test('my quotes narrow to the active agency', async () => {
  assert.deepEqual(ids((await call(quotesRouter, '/me', partner, AGENCY_A)).body.items), [81]);
  assert.deepEqual(ids((await call(quotesRouter, '/me', partner, AGENCY_B)).body.items), [82]);
  assert.deepEqual(ids((await call(quotesRouter, '/me', partner)).body.items), [81, 82]);
});

test('an admin reading quotes is never narrowed', async () => {
  // The oversight view. Every file in this rollout has its own exemption set
  // and this one is admin-only; narrowing it would break the admin console
  // rather than protect anything.
  const r = await call(quotesRouter, '/me', admin, AGENCY_A);
  assert.deepEqual(ids(r.body.items), [81, 82]);
});

test('a forged agency header is ignored, not obeyed', async () => {
  // 999 is a company the partner has no link to, so resolveActiveCompany
  // returns null and the request behaves as though no header was sent.
  assert.deepEqual(ids((await call(quotesRouter, '/me', partner, 999)).body.items), [81, 82]);
  assert.deepEqual(ids((await call(quotesRouter, '/me', partner, 'abc')).body.items), [81, 82]);
});

// ---------- Delivery: engagements ----------

test('a partner\'s engagements narrow on their agency', async () => {
  assert.deepEqual(ids((await call(engagementsRouter, '/', partner, AGENCY_A)).body.items), [91]);
  assert.deepEqual(ids((await call(engagementsRouter, '/', partner, AGENCY_B)).body.items), [92]);
});

test('a founder\'s engagements narrow on the PROJECT, not the partner\'s agency', async () => {
  // The asymmetry that makes this stage tricky. Both engagements are on the
  // founder's project, so under their own company they see BOTH — the
  // partner's agency split is not the founder's business. Testing the founder
  // against engagements.company_id would show them neither.
  const mine = await call(engagementsRouter, '/', founder, FOUNDER_CO);
  assert.deepEqual(ids(mine.body.items), [91, 92]);
});

test('reaching one engagement under the wrong agency is refused', async () => {
  assert.equal((await call(engagementsRouter, '/91', partner, AGENCY_A)).status, 200);
  assert.equal((await call(engagementsRouter, '/91', partner, AGENCY_B)).status, 403);
});

test('quote analytics describe the same agency the list does', async () => {
  // Two queries over the same rows. If only the list narrows, a partner reads
  // a win rate for one agency beside a pipeline for another.
  // Agency A holds the one ACCEPTED quote (81) and agency B the one still
  // SUBMITTED (82), so the two agencies' pipelines are distinguishable by
  // status rather than merely unequal.
  const a = await call(quotesRouter, '/analytics', partner, AGENCY_A);
  const b = await call(quotesRouter, '/analytics', partner, AGENCY_B);
  const all = await call(quotesRouter, '/analytics', partner);
  const total = (r: any) => JSON.stringify(r.body?.pipeline ?? r.body);
  assert.notEqual(total(a), total(b), 'each agency reports its own quotes');
  assert.notEqual(total(a), total(all), 'and neither reports the whole partner');
  assert.notEqual(total(b), total(all));
});

// ---------- Offers: co-marketing ----------

test('my pitches narrow to the active agency', async () => {
  assert.deepEqual(ids((await call(comarketing, '/me/pitches', partner, AGENCY_A)).body.items), [51]);
  assert.deepEqual(ids((await call(comarketing, '/me/pitches', partner, AGENCY_B)).body.items), [52]);
  assert.deepEqual(ids((await call(comarketing, '/me/pitches', partner)).body.items), [51, 52]);
});

test('the status filter still works once the company clause is added', async () => {
  // Four literal query variants replaced two. The one most likely to be
  // mis-wired is status AND company together, so it is asserted directly.
  const r = await call(comarketing, '/me/pitches?status=proposed', partner, AGENCY_A);
  assert.deepEqual(ids(r.body.items), [51]);
  const none = await call(comarketing, '/me/pitches?status=published', partner, AGENCY_A);
  assert.deepEqual(ids(none.body.items), []);
});

test('attributions follow the pitch, so the two views agree', async () => {
  // An attribution carries no company of its own. Without the join it would
  // report reach for a pitch the list above has stopped showing — an overview
  // disagreeing with its own detail, the failure this rollout keeps hitting.
  assert.deepEqual(ids((await call(comarketing, '/me/attributions', partner, AGENCY_A)).body.items), [41]);
  assert.deepEqual(ids((await call(comarketing, '/me/attributions', partner, AGENCY_B)).body.items), [42]);
  assert.deepEqual(ids((await call(comarketing, '/me/attributions', partner)).body.items), [41, 42]);
});
