/**
 * Company scoping: the founder surfaces the earlier stages did not reach.
 *
 * Measuring the worker after stage 10 found 51 route files reading `projects`
 * and 38 with no company predicate at all. Most are legitimately wide — admin
 * and monitoring, public routes, Spin-Out Lab, the studio operator board,
 * marketplaces — but a handful were founder-owning surfaces in two shapes this
 * rollout had already solved several times:
 *
 *   SINGLE-PROJECT LOADS   decks, legal, scoring, settings
 *   FOUNDER-KEYED LISTS    private-data, assistant, imports
 *
 * AND THE ONE THAT MATTERED MOST, which the measurement is what surfaced:
 * `POST /projects` never recorded a `company_id` at all. Migration 189
 * backfilled the projects that existed then, so the picker narrowed — while
 * every project created SINCE landed with NULL and therefore appeared under
 * every company. The feature quietly did not apply to anything new.
 *
 * Two files came OFF the list on inspection, and the reasons are worth as much
 * as the fixes: `capital.ts` reads a project inside an admin-only handler, and
 * `founder_risk.ts` keys its data on `founder_id` — a founder's risk profile
 * belongs to the person, not to one of their companies, and its `projects`
 * join is only a lookup path from a deal to its owner.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import decks from '../src/routes/decks.ts';
import privateData from '../src/routes/private-data.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = { user: 50, founder_id: 150 };
const OTHER = { user: 51, founder_id: 151 };
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
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, name TEXT, sector TEXT, stage TEXT, status TEXT,
      description TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL
    );
    -- The admin arm of /portfolio/metrics counts these. Verbatim from
    -- sql/infrastructure.sql; without them that branch 500s and the
    -- "admin is not narrowed" half of the test cannot run.
    CREATE TABLE limited_partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, fund_id INTEGER NOT NULL,
      commitment_amount REAL NOT NULL DEFAULT 0, invested_amount REAL NOT NULL DEFAULT 0,
      returns REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'committed',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, partner_id INTEGER,
      status TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Verbatim from sql/schema.sql (FK clause dropped: the fixture has no
    -- ON DELETE behaviour to exercise). private-data's founder branch reads
    -- it through getVerifiedLatestSnapshot, so without it the handler 500s
    -- and the narrowing under test cannot be observed at all.
    CREATE TABLE score_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      project_id INTEGER NOT NULL ,
      total_score REAL NOT NULL,
      tier TEXT NOT NULL,
      market_size REAL DEFAULT 0,
      market_urgency REAL DEFAULT 0,
      market_trend REAL DEFAULT 0,
      market_total REAL DEFAULT 0,
      team_expertise REAL DEFAULT 0,
      team_execution REAL DEFAULT 0,
      team_network REAL DEFAULT 0,
      team_total REAL DEFAULT 0,
      product_mvp_time REAL DEFAULT 0,
      product_complexity REAL DEFAULT 0,
      product_dependency REAL DEFAULT 0,
      product_total REAL DEFAULT 0,
      capital_cost_mvp REAL DEFAULT 0,
      capital_time_revenue REAL DEFAULT 0,
      capital_burn_traction REAL DEFAULT 0,
      capital_total REAL DEFAULT 0,
      fit_alignment REAL DEFAULT 0,
      fit_synergy REAL DEFAULT 0,
      fit_total REAL DEFAULT 0,
      distribution_channels REAL DEFAULT 0,
      distribution_virality REAL DEFAULT 0,
      distribution_total REAL DEFAULT 0,
      ai_adjustment REAL DEFAULT 0,
      ai_notes TEXT,
      scored_by TEXT,
      is_sandbox INTEGER NOT NULL DEFAULT 0,
      integrity_hash TEXT,
      integrity_version TEXT NOT NULL DEFAULT 'v1',
      inputs_json TEXT,
      qualitative_text TEXT,
      anomaly_flags TEXT,
      admin_review_status TEXT NOT NULL DEFAULT 'auto_approved',
      admin_review_notes TEXT,
      admin_reviewed_by INTEGER REFERENCES users(id),
      admin_reviewed_at TEXT,
      locked_until TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE pitch_decks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, version INTEGER,
      title TEXT, is_current INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, founder_id, email) VALUES (?,?,?,?)');
  u.run(FOUNDER.user, 'founder', FOUNDER.founder_id, 'f@example.com');
  u.run(OTHER.user, 'founder', OTHER.founder_id, 'g@example.com');
  u.run(ADMIN, 'admin', null, 'a@example.com');
  const p = db.prepare('INSERT INTO projects (id, name, status, founder_id, company_id) VALUES (?,?,?,?,?)');
  p.run(1, 'Alpha', 'tier_1', FOUNDER.founder_id, CO_A);
  p.run(2, 'Beta', 'tier_1', FOUNDER.founder_id, CO_B);
  p.run(3, 'Legacy', 'tier_1', FOUNDER.founder_id, null);
  // Another founder's project, sitting in a company OUR founder also belongs
  // to. Only founder_id keeps it out of reach.
  p.run(4, 'Theirs', 'tier_1', OTHER.founder_id, CO_A);
  const l = db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?,?)');
  l.run(CO_A, FOUNDER.user); l.run(CO_B, FOUNDER.user);
  // The admin holds CO_A too, so a header from them resolves and the
  // "never narrowed" assertions below are not vacuous.
  l.run(CO_A, ADMIN);
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

async function call(
  router: any, path: string, who: { user: number; role: string }, company?: number | string,
): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
  };
  if (company !== undefined) headers['X-Company-Id'] = String(company);
  const res = await router.request(path, { headers }, env(freshDb()));
  return { status: res.status, body: await res.json().catch(() => null) };
}

const founder = { user: FOUNDER.user, role: 'founder' };
const admin = { user: ADMIN, role: 'admin' };

// ---------- decks: the single gate, thirteen call sites ----------

test('a deck on the other company\'s project is not reachable', async () => {
  assert.equal((await call(decks, '/by-project/1', founder, CO_A)).status, 200);
  // This handler wraps `projectOwned` in a blanket catch that answers 403 for
  // every refusal, so the wrong company reads the same as another founder's
  // project. That is the handler's existing shape and not something this
  // change alters — what matters is that it refuses at all.
  assert.equal((await call(decks, '/by-project/1', founder, CO_B)).status, 403);
});

test('a project with no company stays reachable under every company', async () => {
  for (const co of [CO_A, CO_B, undefined]) {
    assert.equal((await call(decks, '/by-project/3', founder, co)).status, 200, `company=${co}`);
  }
});

test('another founder\'s project is refused whatever the company', async () => {
  // Project 4 sits in CO_A — the company the caller is acting for — and is
  // owned by someone else. Only founder_id keeps it out, so if the company
  // check ever ran before ownership this would stop being 403.
  for (const co of [CO_A, CO_B, undefined]) {
    assert.equal((await call(decks, '/by-project/4', founder, co)).status, 403, `company=${co}`);
  }
});

test('admin, partner and investor are not narrowed by a company', async () => {
  // decks exempts all three: a deck is shown to people who do not own the
  // project, so narrowing them by a company that is not theirs would break
  // the surface rather than protect it.
  assert.equal((await call(decks, '/by-project/2', admin, CO_A)).status, 200,
    'an admin reaches a CO_B project while acting for CO_A');
});

// ---------- private-data: the founder's own dashboard ----------

test('the founder dashboard narrows, and its admin overview does not', async () => {
  const a = await call(privateData, '/portfolio/metrics', founder, CO_A);
  const b = await call(privateData, '/portfolio/metrics', founder, CO_B);
  const ids = (r: any) => (r.body?.projects || []).map((p: any) => Number(p.id)).sort();
  assert.deepEqual(ids(a), [1, 3]);
  assert.deepEqual(ids(b), [2, 3]);

  // The admin arm counts every project on the platform and must not move.
  const adminView = await call(privateData, '/portfolio/metrics', admin, CO_A);
  assert.equal(Number(adminView.body?.overview?.total_projects), 4);
});

// ---------- the files that must carry the predicate ----------

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

test('every founder surface identified by the measurement now narrows', () => {
  // A source guard, not a substitute for the behaviour tests above: it is the
  // cheap half that keeps a later edit from silently dropping one of seven
  // files back off the rollout.
  for (const f of ['decks', 'legal', 'scoring', 'settings', 'private-data', 'assistant', 'imports']) {
    const src = read(`cloudflare-worker/src/routes/${f}.ts`);
    assert.match(src, /activeCompanyFor|resolveActiveCompany/, `${f}.ts must resolve the active company`);
    assert.match(src, /company_id/, `${f}.ts must use it`);
  }
});

test('project creation records the company on BOTH paths', () => {
  // The find the measurement produced. Without this the picker narrows while
  // nothing created after migration 189 ever belongs to a company.
  const src = read('cloudflare-worker/src/routes/projects.ts');
  const inserts = src.match(/INSERT INTO projects \([^)]*\)/g) || [];
  assert.equal(inserts.length, 2, 'POST / and POST /submit');
  for (const ins of inserts) {
    assert.match(ins, /company_id/, `a project INSERT without company_id: ${ins.slice(0, 80)}`);
  }
  assert.match(src, /createCompanyId/);
  assert.match(src, /submitCompanyId/);
});

test('the two files that came off the list stay off it, for stated reasons', () => {
  // capital.ts reads a project inside an admin-only handler; founder_risk.ts
  // keys on founder_id, and a risk profile belongs to the person rather than
  // to one of their companies. Asserting the REASONS, so that if either stops
  // being true this fails rather than quietly leaving a gap.
  const capital = read('cloudflare-worker/src/routes/capital.ts');
  assert.match(capital, /role !== 'admin'\) return c\.json\(\{ error: "Forbidden: admin access required" \}/,
    'capital.ts stays admin-gated where it reads a project');
  const risk = read('cloudflare-worker/src/routes/founder_risk.ts');
  assert.match(risk, /latestPull\(c\.env, row\.founder_id\)/,
    'founder_risk keys its payload on the founder, not the project');
  assert.doesNotMatch(risk, /activeCompanyFor/);
});
