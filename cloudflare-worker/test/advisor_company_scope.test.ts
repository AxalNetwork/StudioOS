/**
 * Company scoping, stage 9 — and the surface it turned out to be.
 *
 * THE ADVISOR ROLE'S OWN ROWS CANNOT BE SCOPED, and that is a finding rather
 * than a shortfall. Practice (/advisor/advisory/*) and Expertise
 * (/office-hours) are two sidebar rows over ONE API — routes/advisors.ts, the
 * office-hours implementation — and /office-hours is task #124, under a
 * standing do-not-touch instruction. `documentation/architecture/
 * UNRESOLVED_ITEMS.md` U4 records the same collision from the other side.
 * Cohorts has no store at all: AdvisorBucketRoutes.jsx renders a deliberate
 * empty state saying "nothing in the product links an advisor to a cohort".
 * The last test in this file pins both facts so the omission stays deliberate.
 *
 * WHAT WAS ACTUALLY UNSCOPED is the FOUNDER-side advisor roster in
 * routes/advisory.ts. Its `ownedProjectScope` says "Mirrors contacts.ts" in
 * its own comment, and contacts.ts was narrowed in stage 3 while this copy was
 * not — the fifth appearance of the inlined-ownership pattern this rollout
 * keeps finding.
 *
 * Harness matches stages 1-8: the real router against real in-memory SQLite
 * with a real `user_company_links` table, so `resolveActiveCompany` is
 * unmocked. `advisor_profiles` and `advisor_startups` are copied verbatim
 * from `services/advisorProfilesSchema.ts` rather than left to the bootstrap:
 * that helper caches readiness in a MODULE-level `_ready` flag, which is right
 * for a worker isolate (one isolate, one D1) and wrong here (one process, a
 * fresh database per test) — after the first call it would skip creation and
 * every later test would fail on a missing table.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import advisory from '../src/routes/advisory.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = { user: 50, founder_id: 150 };
const OTHER_FOUNDER = { user: 51, founder_id: 151 };
const ADMIN = 44;
const CO_A = 21;
const CO_B = 22;

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
      // The bootstrap batches its CREATEs; each stub statement has already been
      // prepared, so running them here is what actually creates the tables.
      const out = [];
      for (const st of x || []) out.push(await st.run().catch(() => ({})));
      return out;
    },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, advisor_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT
    );
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL
    );
    -- Verbatim from services/advisorProfilesSchema.ts, plus the company_id
    -- migration 197 adds (and which that bootstrap now also heals).
    CREATE TABLE advisor_profiles (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      founder_id        INTEGER NOT NULL,
      name              TEXT NOT NULL,
      email             TEXT,
      bio               TEXT,
      sectors_json      TEXT NOT NULL DEFAULT '[]',
      expertise_json    TEXT NOT NULL DEFAULT '[]',
      linkedin_url      TEXT,
      hourly_rate       REAL,
      source            TEXT,
      status            TEXT NOT NULL DEFAULT 'active',
      source_contact_id INTEGER,
      last_session_at   TEXT,
      notes             TEXT,
      follow_up_at      TEXT,
      follow_up_note    TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
      company_id        INTEGER
    );
    CREATE TABLE advisor_startups (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      advisor_profile_id INTEGER NOT NULL,
      project_id         INTEGER NOT NULL,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (advisor_profile_id, project_id)
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, founder_id, email) VALUES (?,?,?,?)');
  u.run(FOUNDER.user, 'founder', FOUNDER.founder_id, 'f@example.com');
  u.run(OTHER_FOUNDER.user, 'founder', OTHER_FOUNDER.founder_id, 'g@example.com');
  u.run(ADMIN, 'admin', null, 'a@example.com');
  const p = db.prepare('INSERT INTO projects (id, name, founder_id, company_id) VALUES (?,?,?,?)');
  p.run(1, 'Alpha', FOUNDER.founder_id, CO_A);
  p.run(2, 'Beta', FOUNDER.founder_id, CO_B);
  const l = db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?,?)');
  l.run(CO_A, FOUNDER.user); l.run(CO_B, FOUNDER.user); l.run(CO_A, OTHER_FOUNDER.user);
  // The admin needs a real link too, or `X-Company-Id` from them resolves to
  // null and the "an admin is never narrowed" test can never fail — it would
  // pass against a build that narrowed the admin arm. Third time this exact
  // gap has appeared in this rollout's tests; a caller must HOLD the company
  // it sends for an over-narrowing canary to mean anything.
  l.run(CO_A, ADMIN);
  return db;
}

async function seeded(): Promise<{ e: any; db: any }> {
  const db = freshDb();
  const e = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) };
  const a = db.prepare(
    'INSERT INTO advisor_profiles (id, founder_id, name, status, company_id) VALUES (?,?,?,?,?)');
  a.run(11, FOUNDER.founder_id, 'Ada', 'active', CO_A);
  a.run(12, FOUNDER.founder_id, 'Grace', 'active', CO_B);
  a.run(13, FOUNDER.founder_id, 'Legacy', 'active', null);
  // Another founder's advisor, sitting in a company OUR founder also belongs
  // to. Only the founder_id check keeps it out of reach — this is the row that
  // makes the substitution test bite.
  a.run(14, OTHER_FOUNDER.founder_id, "Someone else's advisor", 'active', CO_A);
  return { e, db };
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  path: string, who: { user: number; role: string }, company?: number | string,
  init: RequestInit = {}, e?: any,
): Promise<any> {
  const target = e ?? (await seeded()).e;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
    ...(init.headers as Record<string, string> | undefined),
  };
  if (company !== undefined) headers['X-Company-Id'] = String(company);
  const res = await advisory.request(path, { ...init, headers }, target);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const ids = (rows: any[]) => (rows || []).map((r) => Number(r.id)).sort((a, b) => a - b);
const founder = { user: FOUNDER.user, role: 'founder' };
const admin = { user: ADMIN, role: 'admin' };

test('the advisor roster narrows to the active company', async () => {
  assert.deepEqual(ids((await call('/advisors', founder, CO_A)).body.items), [11, 13],
    'company A, plus the profile with no company');
  assert.deepEqual(ids((await call('/advisors', founder, CO_B)).body.items), [12, 13]);
});

test('with no company selected the whole roster shows', async () => {
  assert.deepEqual(ids((await call('/advisors', founder)).body.items), [11, 12, 13]);
});

test('a forged company header is ignored, not obeyed', async () => {
  // 999 is a company this founder has no link to, so it resolves to null and
  // the request behaves as though no header was sent. Both directions matter.
  assert.deepEqual(ids((await call('/advisors', founder, 999)).body.items), [11, 12, 13]);
  assert.deepEqual(ids((await call('/advisors', founder, 'abc')).body.items), [11, 12, 13]);
});

test('editing an advisor under the wrong company is 404', async () => {
  const ok = await call('/advisors/11', founder, CO_A, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Ada L' }),
  });
  assert.equal(ok.status, 200);
  const no = await call('/advisors/11', founder, CO_B, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Ada L' }),
  });
  assert.equal(no.status, 404, 'the same 404 as an advisor that does not exist');
});

test('a company cannot substitute for ownership', async () => {
  // Profile 14 belongs to another founder and sits in CO_A — the company the
  // caller is acting for. If the company test ever ran before the founder
  // check, or replaced it, this becomes 200.
  for (const co of [CO_A, CO_B, undefined]) {
    const r = await call('/advisors/14', founder, co, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Stolen' }),
    });
    assert.equal(r.status, 404, `company=${co}`);
  }
});

test('a profile with no company stays reachable under every company', async () => {
  for (const co of [CO_A, CO_B, undefined]) {
    const r = await call('/advisors/13', founder, co, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Legacy renamed' }),
    });
    assert.equal(r.status, 200, `company=${co}`);
  }
});

test('assignments can only use the active company\'s projects', async () => {
  // ownedProjectScope is the gate. Project 2 belongs to company B, so under
  // company A it must not be assignable — otherwise a founder attaches an
  // advisor to a project the picker had already stopped showing them.
  const ok = await call('/advisors/11/assignments', founder, CO_A, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_ids: [1] }),
  });
  assert.equal(ok.status, 200);
  const crossed = await call('/advisors/11/assignments', founder, CO_A, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_ids: [2] }),
  });
  assert.notEqual(crossed.status, 200, 'a project from the other company must not be assignable');
});

test('an admin is never narrowed', async () => {
  // The admin genuinely belongs to CO_A (see the fixture), so this header is
  // verified and would narrow if the admin arm were ever included. Advisor 12
  // lives in CO_B and is the row that disappears if it is.
  const r = await call('/advisors', admin, CO_A);
  assert.deepEqual(ids(r.body.items), [11, 12, 13, 14]);
});

// ---------- what stage 9 deliberately did NOT scope ----------

test('the Advisor role\'s own rows are not company-scoped, and the reason is on record', () => {
  // THE INVARIANT SURVIVED ITS ORIGINAL REASON. This used to say "advisors.ts
  // serves /office-hours (task #124) and is under a do-not-touch instruction".
  // The freeze is lifted and that page is retired, so that reason is gone —
  // but the rule is not, and its real justification was always the better one:
  //
  // AN ADVISOR'S PRACTICE IS NOT A COMPANY'S DATA. Every other scoped surface
  // narrows a founder's or a firm's records to the company being viewed.
  // `advisors.ts` serves the advisor's OWN profile, availability, bookings,
  // services, proof and earnings — records that belong to a person and follow
  // them across every company they advise. Narrowing them by active company
  // would hide an advisor's own book from them depending on a switcher they
  // do not control. `197_advisor_profile_company.sql` records the same finding
  // from the schema side.
  const advisorsSrc = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/src/routes/advisors.ts'), 'utf8');
  assert.doesNotMatch(advisorsSrc, /activeCompanyFor|X-Company-Id/,
    "an advisor's own practice is theirs, not the active company's");

  // Every read is still scoped — to the PERSON, which is the correct axis.
  assert.match(advisorsSrc, /WHERE b\.advisor_id = \?/);
  assert.match(advisorsSrc, /WHERE advisor_id = \?\s*\n?\s*ORDER BY is_active DESC/,
    'the services read scopes on the resolved advisor, not on a path parameter');

  // And U4 is closed, not folklore in the other direction.
  const u4 = readFileSync(
    resolve(process.cwd(), 'documentation/architecture/UNRESOLVED_ITEMS.md'), 'utf8');
  assert.match(u4, /U4 — RESOLVED [\d-]+ — the `\/office-hours` freeze is lifted/);
  assert.doesNotMatch(u4, /\*\*Blocks:\*\* #124\./,
    '#124 is unblocked; U4 must not still claim it');
});
