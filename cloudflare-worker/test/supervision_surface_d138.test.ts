/**
 * D138 — the supervision surface: GET /api/admin/hq/admins.
 *
 * WHAT THIS GUARDS, and why each half needs its own assertion.
 *
 * THE ROLE FILTER IS SERVER-SIDE. The defect it closes is not cosmetic:
 * `SuperAdminHolders.jsx` fed its grant picker from `GET /admin/users` with no
 * arguments — the newest 100 accounts — and filtered THAT PAGE to
 * `role === 'admin'` in the browser. Admins are among the OLDEST accounts, so
 * past a hundred rows an admin is absent from the list and the elevation cannot
 * be granted to them at all. The fixture therefore seeds 120 accounts with the
 * admins OLDEST, which is the only arrangement in which a LIMIT can be caught:
 * a ten-row fixture passes with or without one, and an assertion that cannot
 * fail on the machines that run it is not a guard.
 *
 * AN UNREADABLE LADDER IS NOT A CLEAR ONE. `admin_notices` is migration 264, so
 * a database that has not applied it must report `ladder_readable: false` with
 * a reason rather than rendering four rungs of "clear". `auth.ts`'s own freeze
 * gate states the rule in the same words: being under notice is a claim
 * somebody MADE, and inferring its absence from a failed read is how a screen
 * comes to say the opposite of the truth. This is also the D133 lesson — a
 * fixture narrower than the handler once had seven tests reporting "HQ has not
 * pushed this branch its licence" about a row sitting in front of them.
 *
 * FIXTURE TIMESTAMPS ARE THE WRITER'S OWN FORMAT — `datetime('now','-N days')`,
 * never an ISO string. Aging a row in ISO proves only that the test and the
 * fixture agree, which is how a mutation escaped on #588.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/supervision_surface_d138.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import hq from '../src/routes/admin_hq.ts';
import { normalizeTeamSearch, TEAM_SEARCH_MAX, TEAM_SEARCH_MIN } from '../src/util/teamSearch.ts';
import { FREEZING_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;    // HQ, holds the elevation
const FROZEN = 2;   // an admin with an overdue notice
const ANSWERED = 3; // an admin who has responded and waits on HQ
const NOTICED = 4;  // an admin inside a notice's window
const CLEAR = 5;    // an admin with nothing against them
const UNBOUND = 6;  // an admin holding no licence
const LIC = 'lic_d138';

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
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

const ERRORS = {
  Unauthorized: 401, 'Admin required': 403, 'Super admin required': 403, 'HQ only': 403,
} as Record<string, 401 | 403>;

const app = new Hono<any>();
app.route('/', hq);
app.onError((err: any, c) => {
  const s = ERRORS[String(err?.message || '')];
  if (s) return c.json({ detail: err.message, code: err.message }, s);
  throw err;
});

/** Migration 264's CREATE TABLE and its indexes, read off disk. */
function noticesDdl(): string {
  const sql = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/sql/migrations/264_admin_notices.sql'), 'utf8',
  );
  const at = sql.indexOf('CREATE TABLE IF NOT EXISTS admin_notices');
  assert.ok(at > 0, 'migration 264 no longer creates admin_notices — re-point this fixture');
  return sql.slice(at);
}

function freshDb({ withNotices = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT,
      uid TEXT, last_active_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT, note TEXT);
    CREATE TABLE user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, jti TEXT, factor TEXT,
      assurance_level TEXT, revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT,
      last_step_up_at TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE territory_licences (
    revision INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, licence_ref TEXT, legal_entity_name TEXT,
      brand_name TEXT, status TEXT NOT NULL DEFAULT 'active', renews_on TEXT, seats_total INTEGER,
      annual_fee_cents INTEGER, currency TEXT, revenue_share_bps INTEGER, token_split_bps INTEGER,
      starts_on TEXT, suspended_at TEXT, terminated_at TEXT, status_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE licence_admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL UNIQUE, admin_role TEXT NOT NULL DEFAULT 'principal',
      granted_by_user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE licence_territories (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, country_code TEXT);
    CREATE TABLE licence_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, licence_type TEXT, seats INTEGER);
    CREATE TABLE licence_events (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, event TEXT, detail_json TEXT, note TEXT, actor_user_id INTEGER, created_at TEXT);
    CREATE TABLE licence_deployments (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT, code TEXT, hostname TEXT, status TEXT);
    CREATE TABLE hq_escalations (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, branch_code TEXT, kind TEXT, status TEXT, created_at TEXT);
    CREATE TABLE support_tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT);
  `);
  if (withNotices) db.exec(noticesDdl());

  const u = db.prepare(
    "INSERT INTO users (id, role, name, email, last_active_at, created_at) VALUES (?,?,?,?,?, datetime('now', ?))",
  );
  // THE ADMINS ARE THE OLDEST ACCOUNTS, which is the arrangement that makes a
  // LIMIT catchable. `-900 days` puts them behind every member seeded below.
  u.run(SUPER, 'admin', 'Sue', 'sue@axal.example', '2026-09-16 08:00:00', '-900 days');
  u.run(FROZEN, 'admin', 'Hana', 'hana@axal.example', '2026-09-10 08:00:00', '-899 days');
  u.run(ANSWERED, 'admin', 'Ivo', 'ivo@axal.example', null, '-898 days');
  u.run(NOTICED, 'admin', 'Nia', 'nia@axal.example', null, '-897 days');
  u.run(CLEAR, 'admin', 'Cal', 'cal@axal.example', null, '-896 days');
  u.run(UNBOUND, 'admin', 'Uma', 'uma@axal.example', null, '-895 days');
  // 120 NEWER ADMINS, and the count is the point. A LIMIT of 100 over a query
  // that already filters on role is invisible until there are more than a
  // hundred ADMINS — seeding a hundred founders would prove nothing, because
  // the predicate excludes them before the limit is reached. With these, the
  // six named admins above are rows 121-126 by `created_at DESC` and any page
  // of 100 drops every one of them.
  for (let i = 0; i < 120; i += 1) {
    db.prepare(
      "INSERT INTO users (role, name, email, created_at) VALUES ('admin', ?, ?, datetime('now', ?))",
    ).run(`Bulk ${i}`, `bulk${i}@axal.example`, `-${120 - i} days`);
  }
  // Non-admins, so dropping the role predicate is observable too. One defect
  // class per mutation: the predicate and the limit fail differently.
  for (let i = 0; i < 5; i += 1) {
    db.prepare(
      "INSERT INTO users (role, name, email, created_at) VALUES ('founder', ?, ?, datetime('now', ?))",
    ).run(`Member ${i}`, `m${i}@axal.example`, `-${5 - i} days`);
  }
  for (const id of [SUPER, FROZEN, ANSWERED, NOTICED, CLEAR, UNBOUND]) {
    db.prepare(
      `INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at)
       VALUES (?, ?, 'totp', 'totp', datetime('now'))`,
    ).run(id, `totp-${id}`);
  }
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare(
    "INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status) VALUES (?,?,?,?,'active')",
  ).run(LIC, 'AXL-001', 'Axal VC France SAS', 'Axal VC France');
  const la = db.prepare('INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ?, ?)');
  la.run(SUPER, 'principal');
  la.run(FROZEN, 'delegate');
  la.run(ANSWERED, 'delegate');
  la.run(NOTICED, 'delegate');
  la.run(CLEAR, 'delegate');
  // UNBOUND deliberately gets no row.
  return db;
}

/** Ages every stamp in the writer's own SQL format. */
function notice(
  db: InstanceType<typeof DatabaseSync>,
  userId: number, status: string, respondOffset: string, frozeOffset: string | null = null,
) {
  db.prepare(
    `INSERT INTO admin_notices (uid, user_id, licence_id, kind, subject, body, respond_by, status, froze_at)
     VALUES (?, ?, 1, 'fees', 'Annual fee', 'The annual fee is outstanding.',
             datetime('now', ?), ?, ${frozeOffset ? "datetime('now', ?)" : 'NULL'})`,
  ).run(...(frozeOffset
    ? [`n-${userId}-${status}-${respondOffset}`, userId, respondOffset, status, frozeOffset]
    : [`n-${userId}-${status}-${respondOffset}`, userId, respondOffset, status]));
}

const env = (db: InstanceType<typeof DatabaseSync>, extra: Record<string, unknown> = {}) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: makeD1(db), ...extra });

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', jti: `totp-${userId}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function getAdmins(db: InstanceType<typeof DatabaseSync>, as = SUPER, q = '', extraEnv = {}) {
  const res = await app.request(
    `/admins${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    { headers: { Authorization: `Bearer ${await token(as)}` } },
    env(db, extraEnv),
  );
  return { status: res.status, body: await res.json() as any };
}

const byId = (body: any, id: number) => (body.items || []).find((x: any) => x.user_id === id);

test('every admin is returned, including ones older than any page of accounts', async () => {
  const db = freshDb();
  const { status, body } = await getAdmins(db);
  assert.equal(status, 200);
  const ids = new Set((body.items || []).map((x: any) => x.user_id));
  for (const id of [SUPER, FROZEN, ANSWERED, NOTICED, CLEAR, UNBOUND]) {
    assert.ok(ids.has(id),
      `administrator ${id} fell off the list — the query has a LIMIT, and these six are the OLDEST admin rows`);
  }
  assert.equal(body.total, 126, 'the roster is a page rather than every admin');
});

test('the filter is on role: no member reaches the administrator roster', async () => {
  const db = freshDb();
  const { body } = await getAdmins(db);
  for (const item of body.items || []) {
    assert.ok(!/^m\d+@axal\.example$/.test(item.email),
      `a non-admin (${item.email}) reached the administrator roster`);
  }
  assert.equal(body.total, 126, 'the five founders are counted as administrators');
});

test('each admin carries the licence they hold and the role they hold it in', async () => {
  const db = freshDb();
  const { body } = await getAdmins(db);
  assert.equal(body.licences_available, true);
  const sue = byId(body, SUPER);
  assert.equal(sue.licence.licence_ref, 'AXL-001');
  assert.equal(sue.licence.brand_name, 'Axal VC France');
  assert.equal(sue.licence.status, 'active');
  assert.equal(sue.licence.admin_role, 'principal');
  assert.equal(byId(body, FROZEN).licence.admin_role, 'delegate');
  // No binding is NULL and not an invented one — the row says "no licence",
  // which is a different claim from "the ledger could not be read".
  assert.equal(byId(body, UNBOUND).licence, null);
});

test('the rung is worst-first, and one admin with two notices takes the worse', async () => {
  const db = freshDb();
  notice(db, FROZEN, 'overdue', '-9 days', '-6 days');
  notice(db, FROZEN, 'issued', '+5 days');       // a second, milder notice
  notice(db, ANSWERED, 'responded', '-2 days');
  notice(db, NOTICED, 'issued', '+3 days');
  const { body } = await getAdmins(db);
  assert.equal(body.ladder_readable, true);
  assert.equal(byId(body, FROZEN).rung, 'frozen',
    'an admin with a freezing notice and a milder one reads as the milder one');
  assert.equal(byId(body, FROZEN).open_notices, 2);
  assert.equal(byId(body, ANSWERED).rung, 'awaiting_review');
  assert.equal(byId(body, NOTICED).rung, 'notified');
  assert.equal(byId(body, CLEAR).rung, 'clear');
  assert.equal(byId(body, CLEAR).open_notices, 0);
});

test('both of the worker\'s freezing statuses put an admin on the frozen rung', async () => {
  // `FREEZING_STATUSES` is the worker's own tuple, iterated rather than
  // retyped: adding a third status to it must not silently leave this route
  // reading two.
  for (const status of FREEZING_STATUSES) {
    const db = freshDb();
    notice(db, CLEAR, status, '-4 days', '-1 days');
    const { body } = await getAdmins(db);
    assert.equal(byId(body, CLEAR).rung, 'frozen', `'${status}' does not freeze on this screen`);
  }
});

test('the deadline and the freeze stamp are the EARLIEST, not the newest', async () => {
  // A supervisor needs the oldest unanswered thing. Taking the latest would
  // make a long-frozen account look freshly frozen.
  const db = freshDb();
  // TWO DIFFERENT STATUSES ON PURPOSE. `GROUP BY user_id, status` already
  // reduces same-status rows with MIN(), so two `overdue` notices arrive as one
  // group and the per-admin reduction below never sees two candidates — the
  // choice of earliest-vs-newest would be unreachable and the assertion could
  // not fail.
  notice(db, FROZEN, 'overdue', '-30 days', '-27 days');
  notice(db, FROZEN, 'rejected', '-3 days', '-1 days');
  const { body } = await getAdmins(db);
  const row = byId(body, FROZEN);
  const days = (s: string) => Math.round((Date.now() - new Date(`${s.replace(' ', 'T')}Z`).getTime()) / 86400000);
  assert.ok(days(row.froze_at) >= 26, `froze_at is the newest freeze, not the oldest (${row.froze_at})`);
  assert.ok(days(row.respond_by) >= 29, `respond_by is the newest deadline, not the oldest (${row.respond_by})`);
});

test('an unreadable ladder reads as unreadable, never as a clear one', async () => {
  const db = freshDb({ withNotices: false });
  const { status, body } = await getAdmins(db);
  assert.equal(status, 200, 'the roster goes down with the notices table');
  assert.equal(body.ladder_readable, false);
  assert.match(String(body.ladder_reason), /not a clear ladder/i);
  for (const item of body.items || []) {
    assert.equal(item.rung, undefined,
      'a rung was reported for an account whose notices could not be read');
  }
});

test('the elevation is reported per row, from the side table', async () => {
  const db = freshDb();
  const { body } = await getAdmins(db);
  assert.equal(byId(body, SUPER).super_admin, 1);
  for (const id of [FROZEN, ANSWERED, NOTICED, CLEAR, UNBOUND]) {
    assert.equal(byId(body, id).super_admin, 0, `account ${id} reads as a holder and is not one`);
  }
  assert.equal(body.holders_available, true);
});

test('last-active and active state reach the payload', async () => {
  // `last_active_at` is written by `middleware/lastActive.ts` and appeared in
  // NO list payload before this route, so "when was this admin last here" had
  // no answer anywhere.
  const db = freshDb();
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(CLEAR);
  const { body } = await getAdmins(db);
  assert.equal(byId(body, SUPER).last_active_at, '2026-09-16 08:00:00');
  assert.equal(byId(body, ANSWERED).last_active_at, null);
  assert.equal(byId(body, CLEAR).is_active, 0);
  assert.equal(body.total, 126, 'the total counts every admin');
  assert.equal(body.active, 125, 'the active count does not exclude the deactivated one');
});

test('a plain admin is refused: this is a cross-admin read', async () => {
  const db = freshDb();
  db.prepare('DELETE FROM super_admins WHERE user_id = ?').run(SUPER);
  const { status } = await getAdmins(db, SUPER);
  assert.equal(status, 403, 'every administrator can read every other administrator\'s ladder state');
});

test('with no branch bound there are no groups, and searched says whether HQ asked', async () => {
  const db = freshDb();
  const unasked = await getAdmins(db);
  assert.deepEqual(unasked.body.branches, []);
  assert.equal(unasked.body.searched, false);
  assert.deepEqual(unasked.body.branches_coverage, {
    total: 0, asked: 0, answered: 0, complete: true, unreadable: [], not_deployed: [], not_asked: [],
  });
  // D5041: the registry was read and holds no row and nothing is bound, so HQ HAS established there is no branch.
  assert.equal(unasked.body.no_branches, true);
  assert.equal(unasked.body.registry_available, true);
  const asked = await getAdmins(db, SUPER, 'hana');
  assert.equal(asked.body.searched, true, 'a query reached the route and it did not notice');
  // Every admin still comes back: `q` asks the BRANCHES; the HQ roster is
  // complete and the page narrows it in the browser.
  assert.equal(asked.body.total, 126, 'the query filtered the HQ roster server-side');
});

test('a bound branch is asked, and one that throws is unreadable rather than empty', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO licence_deployments (licence_uid, code, hostname, status) VALUES (?,'fr','fr.axal.vc','live')").run(LIC);
  const asked: any[] = [];
  const { body } = await getAdmins(db, SUPER, 'hana', {
    BRANCH_FR: {
      async searchAccounts(q: string, limit: number) {
        asked.push([q, limit]);
        return { results: [{ id: 7, name: 'Hana Branchside', email: 'h@fr.example', role: 'founder', is_active: 1 }], truncated: false, branch: 'fr', as_of: '2026-09-16T22:00:00Z' };
      },
    },
    BRANCH_DE: { async searchAccounts() { throw new Error('binding refused'); } },
  });
  assert.deepEqual(asked, [['hana', 20]], 'the branch was not asked the query HQ was asked');
  const fr = (body.branches || []).find((b: any) => b.code === 'fr');
  assert.equal(fr.status, 'ok');
  assert.equal(fr.data.results.length, 1);
  const de = (body.branches || []).find((b: any) => b.code === 'de');
  assert.equal(de.status, 'unreadable', 'a branch that threw reads as an empty territory');
  assert.match(String(de.reason), /binding refused/);
  assert.equal(body.branches_coverage.answered, 1);
  assert.equal(body.branches_coverage.total, 2);
});

test('the open-status tuple and its bound placeholders cannot drift apart', () => {
  // `check-sql-prepare` refuses a `${}` inside DB.prepare, so the four `?` are
  // literal text and the four values come from a typed tuple. That is only safe
  // while the two agree — a fifth status added to the tuple with four
  // placeholders left behind is a silent under-bind, which SQLite reports as
  // NULL rather than as an error. This is the compensating count
  // `util/authErrors.ts` states the same rule for.
  const src = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/src/routes/admin_hq.ts'), 'utf8',
  );
  const decl = src.match(/OPEN_NOTICE_STATUSES: readonly \[([^\]]*)\]/)?.[1];
  assert.ok(decl, 'OPEN_NOTICE_STATUSES lost its tuple type — re-point this guard rather than deleting it');
  const arity = decl.split(',').filter((x) => x.trim()).length;
  const clause = src.match(/WHERE status IN \(([^)]*)\)/)?.[1];
  assert.ok(clause, 'the notices query no longer has an IN clause');
  const placeholders = clause.split(',').filter((x) => x.trim() === '?').length;
  assert.equal(placeholders, arity,
    `${arity} statuses are bound against ${placeholders} placeholders`);
  // And the tuple is the worker's freezing set plus the two waiting states, not
  // a fourth hand-typed list of the ladder's vocabulary.
  assert.match(src, /\[\.\.\.FREEZING_STATUSES, 'responded', 'issued'\]/,
    'the open statuses were retyped instead of derived from FREEZING_STATUSES');
});

/* ------------------------------------------------------------------ *
 * D5041 (#5041) — branch truth states                                 *
 * ------------------------------------------------------------------ */

const FR_ROW = (db: InstanceType<typeof DatabaseSync>, code = 'fr') => db.prepare(
  "INSERT INTO licence_deployments (licence_uid, code, hostname, status) VALUES (?,?,?,'live')",
).run(`${LIC}-${code}`, code, `${code}.axal.vc`);

/** A binding that records every call, so a test can prove nobody was asked. */
const spyBranch = (calls: any[][], hits: any[] = []) => ({
  async searchAccounts(...a: any[]) { calls.push(a); return { results: hits, truncated: false, branch: 'x', as_of: '2026-09-16T22:00:00Z' }; },
});
const branchOf = (body: any, code: string) => (body.branches || []).find((b: any) => b.code === code);

test('D5041: a registry row with a live binding and no search is ready to search, not "not deployed", and nobody is asked', async () => {
  const db = freshDb();
  FR_ROW(db);
  const calls: any[][] = [];
  const { body } = await getAdmins(db, SUPER, '', { BRANCH_FR: spyBranch(calls) });
  assert.deepEqual(calls, [], 'an idle read fanned out to a branch');
  assert.equal(branchOf(body, 'fr').status, 'not_asked');
  assert.equal(branchOf(body, 'fr').licence_uid, `${LIC}-fr`, 'the licence stamp is lost on an idle row');
  assert.equal(body.searched, false);
});

test('D5041: a registry row with no binding and no search is not deployed', async () => {
  const db = freshDb();
  FR_ROW(db, 'de');
  const { body } = await getAdmins(db);
  assert.equal(branchOf(body, 'de').status, 'not_deployed');
  assert.match(String(branchOf(body, 'de').reason), /no service binding/);
});

test('D5041: a binding with no registry row is listed as not asked, and not as a deployment', async () => {
  const db = freshDb();
  const { body } = await getAdmins(db, SUPER, '', { BRANCH_IT: spyBranch([]) });
  assert.equal(branchOf(body, 'it').status, 'not_asked');
  assert.equal(branchOf(body, 'it').licence_uid ?? null, null);
});

test('D5041: idle rows are not failures in the coverage, and a search then counts only what it asked', async () => {
  const db = freshDb();
  FR_ROW(db, 'fr'); FR_ROW(db, 'de');
  const idle = await getAdmins(db, SUPER, '', { BRANCH_FR: spyBranch([]) });
  assert.deepEqual(idle.body.branches_coverage, {
    total: 2, asked: 0, answered: 0, complete: false,
    unreadable: [], not_deployed: ['de'], not_asked: ['fr'],
  });
  const searched = await getAdmins(db, SUPER, 'hana', { BRANCH_FR: spyBranch([]), BRANCH_IT: { async searchAccounts() { throw new Error('refused'); } } });
  assert.deepEqual(searched.body.branches_coverage, {
    total: 3, asked: 2, answered: 1, complete: false,
    unreadable: ['it'], not_deployed: ['de'], not_asked: [],
  });
});

test('D5041: one branch unreadable for the query while another answers keeps both states', async () => {
  const db = freshDb();
  FR_ROW(db, 'fr');
  const { body } = await getAdmins(db, SUPER, 'hana', {
    BRANCH_FR: spyBranch([], [{ id: 7, name: 'Hana', email: 'h@fr.example', role: 'founder', is_active: 1 }]),
    BRANCH_DE: { async searchAccounts() { throw new Error('binding refused'); } },
  });
  assert.equal(branchOf(body, 'fr').status, 'ok');
  assert.equal(branchOf(body, 'de').status, 'unreadable');
  assert.equal(body.branches_coverage.answered, 1);
});

test('D5041: a registry that cannot be read is not "no branches"', async () => {
  const db = freshDb();
  db.exec('DROP TABLE licence_deployments');
  db.exec('CREATE VIEW licence_deployments AS SELECT * FROM nonexistent_table_5041'); // a read that THROWS, not a missing table
  const { status, body } = await getAdmins(db);
  assert.equal(status, 200);
  assert.equal(body.registry_available, false);
  assert.match(String(body.registry_reason), /deployment registry/);
  assert.equal(body.no_branches, false, 'a failed read was reported as none provisioned');
  assert.equal(body.branches_coverage.complete, false, 'completeness was claimed over an unknown set');
});

test('D5041: a registry that cannot be read does not hide a bound branch', async () => {
  const db = freshDb();
  db.exec('DROP TABLE licence_deployments');
  db.exec('CREATE VIEW licence_deployments AS SELECT * FROM nonexistent_table_5041');
  const { body } = await getAdmins(db, SUPER, '', { BRANCH_FR: spyBranch([]) });
  assert.equal(branchOf(body, 'fr').status, 'not_asked');
  assert.equal(body.no_branches, false);
});

test('D5041: a missing registry table (migration 258 not applied) is an empty registry, not a failure', async () => {
  const db = freshDb();
  db.exec('DROP TABLE licence_deployments');
  const { body } = await getAdmins(db);
  assert.equal(body.registry_available, true);
  assert.equal(body.no_branches, true);
});

test('D5041: no_branches is false when a binding exists even though the registry is empty', async () => {
  const db = freshDb();
  const { body } = await getAdmins(db, SUPER, '', { BRANCH_FR: spyBranch([]) });
  assert.equal(body.registry_available, true);
  assert.equal(body.no_branches, false);
});

test('D5041: complete is true only when something that could fail was asked and nothing did', async () => {
  // Idle, one bound branch and nothing else: no branch failed, but none was asked either.
  const idle = freshDb();
  FR_ROW(idle, 'fr');
  const idleBody = (await getAdmins(idle, SUPER, '', { BRANCH_FR: spyBranch([]) })).body;
  assert.equal(idleBody.branches_coverage.complete, false, 'an unasked branch was counted as covered');
  // Searched, the one branch answered: complete.
  const done = (await getAdmins(idle, SUPER, 'hana', { BRANCH_FR: spyBranch([]) })).body;
  assert.equal(done.branches_coverage.complete, true);
  // Searched, one answered and one registry row has no binding: nothing failed, but not every branch was reachable.
  const gap = freshDb();
  FR_ROW(gap, 'fr'); FR_ROW(gap, 'de');
  const gapBody = (await getAdmins(gap, SUPER, 'hana', { BRANCH_FR: spyBranch([]) })).body;
  assert.deepEqual(gapBody.branches_coverage.unreadable, []);
  assert.equal(gapBody.branches_coverage.complete, false, 'a branch with no binding was counted as covered');
});

/* ------------------------------------------------------------------ *
 * D5042 (#5042) — one search contract                                 *
 * ------------------------------------------------------------------ */

async function getRaw(db: InstanceType<typeof DatabaseSync>, qs: string, extraEnv = {}) {
  const res = await app.request(`/admins${qs}`, { headers: { Authorization: `Bearer ${await token(SUPER)}` } }, env(db, extraEnv));
  return { status: res.status, body: await res.json() as any };
}
const seen = () => { const calls: any[][] = []; return { calls, bound: { async searchAccounts(...a: any[]) { calls.push(a); return { results: [], truncated: false, branch: 'fr', as_of: '2026-11-08T10:00:00Z' }; } } }; };

test('D5042: normalizeTeamSearch trims, collapses whitespace, counts characters and names its state', () => {
  assert.equal(TEAM_SEARCH_MIN, 2);
  assert.equal(TEAM_SEARCH_MAX, 64);
  assert.equal(normalizeTeamSearch(undefined).state, 'none');
  assert.equal(normalizeTeamSearch('').state, 'none');
  assert.equal(normalizeTeamSearch('   \t \n ').state, 'none');
  assert.deepEqual(normalizeTeamSearch(' a '), { state: 'too_short', query: 'a', min_length: 2, max_length: 64 });
  assert.deepEqual(normalizeTeamSearch('  gu  '), { state: 'asked', query: 'gu', min_length: 2, max_length: 64 });
  assert.equal(normalizeTeamSearch('  hana    lee ').query, 'hana lee');
  assert.equal(normalizeTeamSearch('a'.repeat(64)).state, 'asked');
  assert.equal(normalizeTeamSearch('a'.repeat(65)).state, 'too_long');
  assert.equal(normalizeTeamSearch('é'.repeat(64)).state, 'asked', 'characters, not UTF-16 units or bytes');
  assert.equal(normalizeTeamSearch('😀'.repeat(64)).state, 'asked');
  assert.equal(normalizeTeamSearch('😀'.repeat(65)).state, 'too_long');
  assert.equal(normalizeTeamSearch('😀').state, 'too_short');
});

for (const [label, q, state] of [
  ['no query', '', 'none'],
  ['whitespace only', '%20%20%09', 'none'],
  ['one character', 'g', 'too_short'],
  ['one character with padding', '%20g%20', 'too_short'],
  ['over the limit', 'x'.repeat(TEAM_SEARCH_MAX + 1), 'too_long'],
] as const) {
  test(`D5042: ${label} asks no branch, and says so`, async () => {
    const db = freshDb();
    FR_ROW(db);
    const { calls, bound } = seen();
    const { status, body } = await getRaw(db, q ? `?q=${q}` : '', { BRANCH_FR: bound });
    assert.equal(status, 200);
    assert.deepEqual(calls, [], 'a query below the minimum or above the maximum fanned out');
    assert.equal(body.searched, false);
    assert.equal(body.search.state, state);
    assert.equal(body.search.min_length, 2);
    assert.equal(body.search.max_length, 64);
    assert.equal(branchOf(body, 'fr').status, 'not_asked');
    assert.equal(body.total, 126, 'the HQ roster is returned whatever the branch search did');
  });
}

test('D5042: two characters ask every branch, with the normalized query and nothing else', async () => {
  const db = freshDb();
  FR_ROW(db);
  const { calls, bound } = seen();
  const { body } = await getRaw(db, '?q=%20%20gu%20%20', { BRANCH_FR: bound });
  assert.deepEqual(calls, [['gu', 20]]);
  assert.equal(body.searched, true);
  assert.deepEqual(body.search, { state: 'asked', query: 'gu', min_length: 2, max_length: 64 });
  const spaced = seen();
  await getRaw(db, '?q=hana%20%20%20lee', { BRANCH_FR: spaced.bound });
  assert.deepEqual(spaced.calls, [['hana lee', 20]]);
});

test('D5042: the longest allowed query is asked in full', async () => {
  const db = freshDb();
  FR_ROW(db);
  const { calls, bound } = seen();
  const longest = 'a'.repeat(TEAM_SEARCH_MAX);
  const { body } = await getRaw(db, `?q=${longest}`, { BRANCH_FR: bound });
  assert.deepEqual(calls, [[longest, 20]]);
  assert.equal(body.search.state, 'asked');
});

test('D5042: view-as uses the same policy: a short or over-long query asks nobody, a good one asks that branch once', async () => {
  const db = freshDb();
  FR_ROW(db);
  for (const q of ['', 'g', 'x'.repeat(TEAM_SEARCH_MAX + 1)]) {
    const { calls, bound } = seen();
    const { body } = await getRaw(db, `?branch=fr${q ? `&q=${q}` : ''}`, { BRANCH_FR: bound });
    assert.deepEqual(calls, [], `view-as asked the branch for ${JSON.stringify(q)}`);
    assert.equal(body.scope.status, 'not_asked');
    assert.equal(body.scope.asked, '');
    assert.equal(body.searched, false);
    assert.equal(body.branches_coverage.unreadable.length, 0, 'an unasked branch was counted as failed');
  }
  const { calls, bound } = seen();
  const { body } = await getRaw(db, '?branch=fr&q=%20gu%20', { BRANCH_FR: bound });
  assert.deepEqual(calls, [['gu', 20]]);
  assert.equal(body.scope.status, 'ok');
  assert.equal(body.scope.asked, 'gu');
  assert.equal(body.search.query, 'gu');
});

test('D5042: view-as of a branch with no binding is not deployed whatever was typed, and nobody is called', async () => {
  const db = freshDb();
  FR_ROW(db, 'de');
  const { body } = await getRaw(db, '?branch=de&q=g');
  assert.equal(body.scope.status, 'not_deployed');
});

test('D5042: the browser mirrors the Worker\'s minimum and maximum', () => {
  const policy = readFileSync(resolve(process.cwd(), 'frontend/src/pages/hq/teamSearchPolicy.js'), 'utf8');
  assert.match(policy, new RegExp(`TEAM_SEARCH_MIN = ${TEAM_SEARCH_MIN};`));
  assert.match(policy, new RegExp(`TEAM_SEARCH_MAX = ${TEAM_SEARCH_MAX};`));
});
