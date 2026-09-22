/**
 * D197 — a licence records the host its admin bound, and who may detach it.
 *
 * WHAT THIS FILE IS FOR. `AdminLicences.jsx` has rendered `d.custom_domain`
 * since the licence console was built, and `custom_domain` exists NOWHERE —
 * not in `cloudflare-worker/src`, not under `sql/`. So the domain strip read
 * "Not recorded" unconditionally for every licence that has ever existed: the
 * same shape D196 fixed one block over, where `d.kind` was `undefined` on
 * every row. Migration 280 gives it a store, and these are its guards.
 *
 * THE RESOLVER IS STUBBED BECAUSE IT CANNOT BE REACHED. `cloudflare-dns.com`
 * is refused at CONNECT from the environment this was written in, so the live
 * DoH call has never run here and the suite drives it with recorded response
 * shapes instead. A call that cannot be exercised and is not injected is a
 * call nothing can assert about — which is why `verifyRecords` takes a fetch.
 *
 * AND WHY THE FIXTURE SLICES ITS DDL OFF THE MIGRATION. `licence_domains`
 * carries three constraints that ARE the feature — `hostname` UNIQUE across
 * the whole table including detached rows, `licence_id` UNIQUE, and a `state`
 * CHECK with no 'active' value — and a hand-written fixture that relaxed any
 * of them would let the suite go green against a table production does not
 * have. That is the `licence_contract_instantiate` defect D139 had to correct.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/licence_domain_d197.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import licences from '../src/routes/admin_licences.ts';
import licence from '../src/routes/licence.ts';
import {
  CNAME_TARGET, TXT_PREFIX, domainPayload, mintChallengeToken, normaliseHostname,
  recordsFor, validateHostname, verifyRecords,
} from '../src/services/licenceDomain.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;
const HOLDER = 2;
const OTHER = 3;
// A super admin whose session was minted WITHOUT a second factor. The detach
// route takes `requireSuperAdminWriteBar`, which is TOTP + a recent step-up
// BEFORE the elevation check — so this account is the only thing that can tell
// the write bar apart from a bare `requireSuperAdmin`, and a mutation swapping
// one for the other escaped until it existed.
const WEAK_SUPER = 4;
const LIC = 'lic_d197';
const LIC2 = 'lic_d197_b';

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
app.route('/admin/licences', licences);
app.route('/licence', licence);
app.onError((err: any, c) => {
  const s = ERRORS[String(err?.message || '')];
  if (s) return c.json({ detail: err.message, code: err.message }, s);
  throw err;
});

/** Migration 280's own DDL, constraints and all. */
function domainsDdl(): string {
  const sql = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/sql/migrations/280_licence_domains.sql'), 'utf8',
  );
  const at = sql.indexOf('CREATE TABLE IF NOT EXISTS licence_domains');
  assert.ok(at > 0, '280 no longer declares licence_domains — re-point this fixture');
  const end = sql.indexOf('\n);', at);
  assert.ok(end > at, '280: the CREATE does not terminate');
  return sql.slice(at, end + 3);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT,
      uid TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT, note TEXT);
    CREATE TABLE user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, jti TEXT, factor TEXT,
      assurance_level TEXT, revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT,
      last_step_up_at TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT,
      user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE admin_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER, action TEXT,
      viewed_user_id INTEGER, filters_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE territory_licences (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, licence_ref TEXT, entity_id INTEGER,
      legal_entity_name TEXT, brand_name TEXT, registered_address TEXT,
      signatory_name TEXT, signatory_title TEXT, status TEXT NOT NULL DEFAULT 'active',
      term_years INTEGER, annual_fee_cents INTEGER, currency TEXT, revenue_share_bps INTEGER,
      token_split_bps INTEGER, starts_on TEXT, renews_on TEXT, suspended_at TEXT,
      terminated_at TEXT, status_note TEXT, updated_at TEXT, kind TEXT NOT NULL DEFAULT 'subsidiary',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE licence_admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL UNIQUE, admin_role TEXT NOT NULL DEFAULT 'principal',
      granted_by_user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE licence_territories (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, country_code TEXT);
    CREATE TABLE licence_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, seat_type TEXT, seats_licensed INTEGER);
    CREATE TABLE licence_deployments (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT, code TEXT, hostname TEXT, status TEXT);
    CREATE TABLE licence_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, event TEXT,
      detail_json TEXT, note TEXT, actor_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(domainsDdl());

  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(SUPER, 'admin', 'Sue', 'sue@axal.example');
  u.run(HOLDER, 'admin', 'Hana', 'hana@axal.example');
  u.run(OTHER, 'admin', 'Otto', 'otto@axal.example');
  u.run(WEAK_SUPER, 'admin', 'Walt', 'walt@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(WEAK_SUPER);
  for (const id of [SUPER, HOLDER, OTHER]) {
    db.prepare(
      `INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at)
       VALUES (?, ?, 'totp', 'totp', datetime('now'))`,
    ).run(id, `totp-${id}`);
  }
  db.prepare(
    `INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at)
     VALUES (?, ?, 'password', 'password', datetime('now'))`,
  ).run(WEAK_SUPER, `totp-${WEAK_SUPER}`);
  const lic = db.prepare(
    `INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status)
     VALUES (?,?,?,?, 'active')`,
  );
  lic.run(LIC, 'AXL-001', 'Axal VC France SAS', 'Axal VC France');
  lic.run(LIC2, 'AXL-002', 'Nordics Holdings AB', 'Axal VC Nordics');
  db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ?, 'principal')").run(HOLDER);
  db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (2, ?, 'principal')").run(OTHER);
  db.prepare("INSERT INTO licence_deployments (licence_uid, code, hostname, status) VALUES (?, 'fr', 'fr.axal.vc', 'worker_live')").run(LIC);
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>, extra: Record<string, unknown> = {}) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: makeD1(db), ...extra });

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', jti: `totp-${userId}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(db: any, method: string, path: string, who = HOLDER, body?: any, extraEnv = {}) {
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${await token(who)}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env(db, extraEnv));
  let out: any = null;
  try { out = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: out };
}

const rowOf = (db: any, licenceId = 1) =>
  db.prepare('SELECT * FROM licence_domains WHERE licence_id = ?').get(licenceId) as any;

/* ── the validator: every refusal is its own sentence ───────────────────── */

test('every refusal the artboards draw has its own code, and none collapses into "invalid"', () => {
  const cases: Array<[unknown, string]> = [
    ['', 'host_required'],
    ['https://yourhost.com', 'host_has_scheme'],
    ['yourhost.com/app', 'host_has_path'],
    ['yourhost.com:8443', 'host_has_port'],
    ['*.yourhost.com', 'host_wildcard'],
    ['a.com, b.com', 'host_multiple'],
    [`${Array.from({ length: 5 }, (_, i) => String.fromCharCode(97 + i).repeat(60)).join('.')}.com`, 'host_too_long'],
    ['not_a_label.com', 'host_not_a_label'],
    ['single', 'host_not_a_label'],
    ['münchen.de', 'host_not_ascii'],
    ['axal.vc', 'host_is_hq'],
    ['app.axal.vc', 'host_is_hq'],
    ['studiolyon.os.axal.vc', 'host_is_platform'],
    ['fr.axal.vc', 'host_is_ours'],
  ];
  const seen = new Set<string>();
  for (const [input, code] of cases) {
    const out = validateHostname(input);
    assert.equal(out.ok, false, `${String(input)} was accepted`);
    assert.equal((out as any).code, code, `${String(input)} gave the wrong refusal`);
    // EACH SENTENCE IS ITS OWN. S19a's argument applies to every one of these:
    // the reader is standing in a registrar panel, and "invalid hostname" tells
    // them nothing about which thing to change.
    assert.ok(String((out as any).error).length > 20, `${code} has no sentence`);
    seen.add(String((out as any).error));
  }
  assert.equal(seen.size, new Set(cases.map(([, c]) => c)).size,
    'two different refusals share one sentence');

  // EVERY DECLARED REFUSAL IS REACHABLE, which is what this assertion is
  // really for. `host_not_ascii` was NOT: `LABEL` refuses anything outside
  // `[a-z0-9-]`, so a unicode host failed the label rule first and the
  // punycode sentence could never be produced by any input. A refusal with a
  // carefully written sentence that nothing can trigger is the same class of
  // defect as an assertion that cannot fail, and the fix was the order rather
  // than the wording.
  const src = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/src/services/licenceDomain.ts'), 'utf8',
  );
  const declared = new Set([...src.matchAll(/code: '(host_[a-z_]+)'/g)].map((m) => m[1]));
  const exercised = new Set(cases.map(([, c]) => c));
  assert.deepEqual([...declared].sort(), [...exercised].sort(),
    'a refusal is declared that no input above produces — check it is reachable at all');
});

test('a host is normalised rather than refused for case and a trailing dot', () => {
  for (const raw of ['APP.Yourhost.COM', ' app.yourhost.com ', 'app.yourhost.com.']) {
    const out = validateHostname(raw);
    assert.equal(out.ok, true, `${raw} was refused`);
    assert.equal((out as any).hostname, 'app.yourhost.com');
  }
  assert.equal(normaliseHostname('APP.Yourhost.COM.'), 'app.yourhost.com');
});

test('the two records are derived from the stable target, not from the tenant', () => {
  const recs = recordsFor('app.yourhost.com', 'abcdef1234');
  assert.equal(recs.length, 2);
  const txt = recs.find((r) => r.kind === 'ownership')!;
  const cname = recs.find((r) => r.kind === 'traffic')!;
  assert.equal(txt.type, 'TXT');
  assert.equal(txt.name, `${TXT_PREFIX}.app.yourhost.com`);
  assert.equal(txt.value, 'axal-verify=abcdef1234');
  assert.equal(cname.type, 'CNAME');
  assert.equal(cname.name, 'app.yourhost.com');
  // S19a's second failure exists because a tenant can point at the right-
  // LOOKING wrong thing. The published target is the shared one, never the
  // per-tenant fallback origin.
  assert.equal(cname.value, CNAME_TARGET);
  // THE CANVAS CONTRADICTS ITSELF HERE AND S19a SETTLES IT. S18 publishes
  // `cname.os.axal.vc` while H34 draws `studiolyon.os.axal.vc`, and S19a makes
  // H34's version an explicit FAILURE: "It currently resolves to
  // axalfrance.os.axal.vc. That is our fallback origin, not the published
  // target." So the target is the shared one, and a per-tenant origin here
  // would be the very mistake the next test catches.
  assert.equal(CNAME_TARGET, 'cname.os.axal.vc');
  const perTenant = recordsFor('a.example.com', 't').concat(recordsFor('b.example.com', 't'))
    .filter((r) => r.kind === 'traffic').map((r) => r.value);
  assert.deepEqual(perTenant, [CNAME_TARGET, CNAME_TARGET],
    'the published target varies by tenant, so a tenant\'s DNS would change when their origin does');
});

test('a minted token is hex, so nothing in it needs quoting in a TXT record', () => {
  for (let i = 0; i < 20; i += 1) {
    assert.match(mintChallengeToken(), /^[0-9a-f]{10}$/);
  }
});

/* ── the resolver: real DoH shapes, and the two failure kinds ───────────── */

/** A `fetch` that answers each query from a recorded DoH body. */
function resolver(map: Record<string, any>) {
  return async (url: any) => {
    const u = new URL(String(url));
    const key = `${u.searchParams.get('type')}:${u.searchParams.get('name')}`;
    const entry = map[key];
    if (entry === 'network') throw new Error('CONNECT tunnel failed');
    if (entry === undefined) return { ok: true, json: async () => ({ Status: 3 }) } as any;
    if (entry === 'servfail') return { ok: true, json: async () => ({ Status: 2 }) } as any;
    return { ok: true, json: async () => entry } as any;
  };
}

const HOST = 'app.yourhost.com';
const TOKEN = 'abc1234567';
const TXT_OK = { Status: 0, Answer: [{ name: `${TXT_PREFIX}.${HOST}`, type: 16, data: `"axal-verify=${TOKEN}"` }] };
const CNAME_OK = { Status: 0, Answer: [{ name: HOST, type: 5, data: `${CNAME_TARGET}.` }] };

test('both records published reads as both confirmed', async () => {
  const out = await verifyRecords(HOST, TOKEN, '2026-09-22 10:00:00', resolver({
    [`TXT:${TXT_PREFIX}.${HOST}`]: TXT_OK,
    [`CNAME:${HOST}`]: CNAME_OK,
  }) as any);
  assert.equal(out.records.length, 2);
  for (const r of out.records) {
    assert.equal(r.ok, true, `${r.kind} did not confirm`);
    assert.equal(r.readable, true);
  }
});

test('NXDOMAIN is an ANSWER — not published — and never reads as an unreadable resolver', async () => {
  const out = await verifyRecords(HOST, TOKEN, '2026-09-22 10:00:00', resolver({
    [`CNAME:${HOST}`]: CNAME_OK,
  }) as any);
  const txt = out.records.find((r) => r.kind === 'ownership')!;
  assert.equal(txt.ok, false);
  // THE DISTINCTION THAT MATTERS. Status 3 says the name does not exist, which
  // is a fact about the tenant's zone; a resolver that could not be read is a
  // fact about us. Collapsing them sends somebody to a registrar panel to fix
  // a record that is fine.
  assert.equal(txt.readable, true, 'NXDOMAIN was reported as an unreadable resolver');
  assert.match(txt.title, /No TXT yet/);
});

test('a resolver that did not answer says so, and says nothing about the zone', async () => {
  for (const failure of ['network', 'servfail']) {
    const out = await verifyRecords(HOST, TOKEN, '2026-09-22 10:00:00', resolver({
      [`TXT:${TXT_PREFIX}.${HOST}`]: failure,
      [`CNAME:${HOST}`]: failure,
    }) as any);
    for (const r of out.records) {
      assert.equal(r.readable, false, `${failure} read as a published verdict`);
      assert.match(r.detail, /not a claim that the record is missing/,
        'an unreadable resolver told the tenant their record is missing');
    }
  }
});

test('S19a\'s own second failure — a CNAME at the FALLBACK ORIGIN gets its own sentence', async () => {
  const out = await verifyRecords(HOST, TOKEN, '2026-09-22 10:00:00', resolver({
    [`TXT:${TXT_PREFIX}.${HOST}`]: TXT_OK,
    [`CNAME:${HOST}`]: { Status: 0, Answer: [{ name: HOST, type: 5, data: 'axalfrance.os.axal.vc.' }] },
  }) as any);
  const cname = out.records.find((r) => r.kind === 'traffic')!;
  assert.equal(cname.ok, false);
  assert.equal(cname.readable, true);
  assert.ok(String(cname.found).includes('axalfrance.os.axal.vc'),
    'the recorded CNAME is not the fallback origin');
  // The artboard's words: "That is our fallback origin, not the published
  // target." A tenant who sees a host under our own zone and a failure needs
  // telling WHY it is wrong, or they will assume the check is broken.
  assert.match(cname.detail, /fallback origin, not the published target/,
    'a CNAME at the fallback origin fell into the generic does-not-point-at sentence');
  // A LITERAL COMPARISON, BECAUSE THAT IS WHAT THIS ASSERTION MEANS. It used
  // to build a regex from the target with a hand-rolled dot-escaper, which
  // CodeQL raises as incomplete sanitization: `.replace(/\./g, '\\.')` escapes
  // dots and NOT backslashes, so an input carrying one would break the pattern.
  // MEASURED, THE OLD FORM WAS NOT WEAK HERE — the dots were escaped and a
  // fixture differing at a dot position was already refused — so this is not a
  // bug being fixed. It is the wrong tool being put down: these three
  // assertions mean "the sentence NAMES this host", which is a literal
  // comparison, and a regex assembled from data to express it is what the
  // query exists to flag.
  assert.ok(cname.detail.includes(CNAME_TARGET),
    `the fallback-origin sentence does not name ${CNAME_TARGET}`);
});

test('a CNAME pointing somewhere else names what it found, and is not the fallback sentence', async () => {
  const out = await verifyRecords(HOST, TOKEN, '2026-09-22 10:00:00', resolver({
    [`TXT:${TXT_PREFIX}.${HOST}`]: TXT_OK,
    [`CNAME:${HOST}`]: { Status: 0, Answer: [{ name: HOST, type: 5, data: 'ghs.googlehosted.com.' }] },
  }) as any);
  const cname = out.records.find((r) => r.kind === 'traffic')!;
  assert.equal(cname.ok, false);
  // A literal, same as the three verdict sentences above. An unanchored
  // hostname regex matches that host with anything before or after it.
  assert.ok(cname.detail.includes('ghs.googlehosted.com'),
    `the third-party sentence does not name what was found: ${cname.detail}`);
  assert.doesNotMatch(cname.detail, /fallback origin/,
    'a third-party target was described as our own fallback');
});

test('a TXT carrying somebody else\'s token does not verify this claim', async () => {
  const out = await verifyRecords(HOST, TOKEN, '2026-09-22 10:00:00', resolver({
    [`TXT:${TXT_PREFIX}.${HOST}`]: { Status: 0, Answer: [{ data: '"axal-verify=deadbeef00"' }] },
    [`CNAME:${HOST}`]: CNAME_OK,
  }) as any);
  assert.equal(out.records.find((r) => r.kind === 'ownership')!.ok, false);
});

/* ── the tenant's three writes ──────────────────────────────────────────── */

test('the holder binds a host, and the row carries its own challenge token', async () => {
  const db = freshDb();
  const { status, body } = await call(db, 'POST', '/licence/mine/domain', HOLDER, { hostname: 'APP.Yourhost.com' });
  assert.equal(status, 201);
  assert.equal(body.domain.hostname, 'app.yourhost.com', 'the host was stored un-normalised');
  assert.equal(body.domain.state, 'pending');
  const row = rowOf(db);
  assert.match(String(row.challenge_token), /^[0-9a-f]{10}$/);
  assert.equal(row.created_by_user_id, HOLDER);
  // The records ride the response, derived from the row rather than stored.
  assert.equal(body.domain.records.length, 2);
  assert.equal(body.domain.records.find((r: any) => r.kind === 'traffic').value, CNAME_TARGET);
  // VERIFIED IS NOT SERVING, and the payload says so from the first read.
  assert.equal(body.domain.serves, false);
  assert.match(String(body.domain.serves_reason), /Cloudflare for SaaS/);
});

test('one host per licence in this pass, and the refusal names the one already bound', async () => {
  const db = freshDb();
  await call(db, 'POST', '/licence/mine/domain', HOLDER, { hostname: 'app.yourhost.com' });
  const { status, body } = await call(db, 'POST', '/licence/mine/domain', HOLDER, { hostname: 'other.yourhost.com' });
  assert.equal(status, 409);
  assert.equal(body.code, 'domain_already_bound');
  assert.ok(String(body.error).includes('app.yourhost.com'),
    `the refusal does not name the host already bound: ${body.error}`);
});

test('H33 — a collision names the other operator\'s PUBLIC name and never its legal entity', async () => {
  const db = freshDb();
  await call(db, 'POST', '/licence/mine/domain', OTHER, { hostname: 'app.yourhost.com' });
  const { status, body } = await call(db, 'POST', '/licence/mine/domain', HOLDER, { hostname: 'app.yourhost.com' });
  assert.equal(status, 409);
  assert.equal(body.code, 'host_taken');
  assert.match(String(body.error), /Axal VC Nordics/, 'the refusal stopped naming the holder');
  // WHO TRADES UNDER A BRAND IS PUBLIC; WHICH COMPANY HOLDS THE LICENCE IS
  // NOT. A refusal is not the place to disclose another tenant's legal entity.
  assert.doesNotMatch(JSON.stringify(body), /Nordics Holdings AB/,
    'the collision leaked the other operator\'s legal entity');
});

test('a detached host stays claimed, and the refusal names nobody', async () => {
  const db = freshDb();
  await call(db, 'POST', '/licence/mine/domain', OTHER, { hostname: 'app.yourhost.com' });
  const det = await call(db, 'POST', `/admin/licences/${LIC2}/domain/detach`, SUPER, {
    reason: 'Trademark complaint upheld by the registrar.',
  });
  assert.equal(det.status, 200);
  const { status, body } = await call(db, 'POST', '/licence/mine/domain', HOLDER, { hostname: 'app.yourhost.com' });
  assert.equal(status, 409);
  assert.equal(body.code, 'host_detached_elsewhere');
  // Nobody holds it, so nobody is named — and it is not available, which is
  // what stops a detach being undone by the next licence claiming the host.
  assert.doesNotMatch(JSON.stringify(body), /Nordics|Axal VC/,
    'a detached host named an operator who no longer holds it');
});

test('check-now moves pending to verified, stores the verdict, and keeps the stamps', async () => {
  const db = freshDb();
  await call(db, 'POST', '/licence/mine/domain', HOLDER, { hostname: HOST });
  const token0 = rowOf(db).challenge_token;
  const real = globalThis.fetch;
  globalThis.fetch = resolver({
    [`TXT:${TXT_PREFIX}.${HOST}`]: { Status: 0, Answer: [{ data: `"axal-verify=${token0}"` }] },
    [`CNAME:${HOST}`]: CNAME_OK,
  }) as any;
  try {
    const { status, body } = await call(db, 'POST', '/licence/mine/domain/check', HOLDER);
    assert.equal(status, 200);
    assert.equal(body.verified, true);
    assert.equal(body.domain.state, 'verified');
    const row = rowOf(db);
    assert.ok(row.txt_verified_at, 'the ownership stamp was not written');
    assert.ok(row.cname_verified_at, 'the traffic stamp was not written');
    assert.ok(row.last_checked_at, 'the check was not stamped');
    // THE VERDICT IS STORED SO THE SCREEN CAN REPRINT IT, rather than querying
    // a resolver on every render.
    const stored = JSON.parse(row.last_check_json);
    assert.equal(stored.records.length, 2);
  } finally { globalThis.fetch = real; }
});

test('check-now on a half-published host stays pending and names WHICH record is wrong', async () => {
  const db = freshDb();
  await call(db, 'POST', '/licence/mine/domain', HOLDER, { hostname: HOST });
  const real = globalThis.fetch;
  globalThis.fetch = resolver({ [`CNAME:${HOST}`]: CNAME_OK }) as any;
  try {
    const { body } = await call(db, 'POST', '/licence/mine/domain/check', HOLDER);
    assert.equal(body.verified, false);
    assert.equal(rowOf(db).state, 'pending');
    const txt = body.check.records.find((r: any) => r.kind === 'ownership');
    const cname = body.check.records.find((r: any) => r.kind === 'traffic');
    // S19a's whole point: not "DNS error", but which row to edit.
    assert.equal(txt.ok, false);
    assert.equal(cname.ok, true);
    assert.ok(txt.title.includes(`${TXT_PREFIX}.${HOST}`),
      `the failing record is not named: ${txt.title}`);
  } finally { globalThis.fetch = real; }
});

test('check-now on the OTHER half — TXT published, no CNAME — also stays pending', async () => {
  // THE MIRROR OF THE TEST ABOVE, AND IT EXISTS BECAUSE A MUTATION ESCAPED.
  // Dropping the CNAME conjunct from the promotion — `txtAt && cnameAt` becoming
  // `txtAt` — left every assertion above passing, because that case has no TXT
  // to promote on. Only the half where the ownership record IS published can
  // tell a two-record rule from a one-record one.
  const db = freshDb();
  await call(db, 'POST', '/licence/mine/domain', HOLDER, { hostname: HOST });
  const token0 = rowOf(db).challenge_token;
  const real = globalThis.fetch;
  globalThis.fetch = resolver({
    [`TXT:${TXT_PREFIX}.${HOST}`]: { Status: 0, Answer: [{ data: `"axal-verify=${token0}"` }] },
  }) as any;
  try {
    const { body } = await call(db, 'POST', '/licence/mine/domain/check', HOLDER);
    assert.equal(body.verified, false, 'an ownership record alone verified the host');
    assert.equal(rowOf(db).state, 'pending', 'the state promoted on one record of two');
    const txt = body.check.records.find((r: any) => r.kind === 'ownership');
    const cname = body.check.records.find((r: any) => r.kind === 'traffic');
    assert.equal(txt.ok, true);
    assert.equal(cname.ok, false);
    // The autofix on this line (3eaa472f4) widened the escaper to cover every
    // metacharacter, which is correct as far as it goes and leaves a regex
    // built from data behind — on one of the three sites, not all three.
    // Superseded rather than reverted: with no regex here there is nothing to
    // escape, and the same treatment reaches its two siblings.
    assert.ok(cname.title.includes(HOST),
      `the failing traffic record is not named: ${cname.title}`);
  } finally { globalThis.fetch = real; }
});

test('the holder removes a host they bound, and cannot remove one Super Admin detached', async () => {
  const db = freshDb();
  await call(db, 'POST', '/licence/mine/domain', HOLDER, { hostname: HOST });
  const gone = await call(db, 'DELETE', '/licence/mine/domain', HOLDER);
  assert.equal(gone.status, 200);
  assert.equal(rowOf(db), undefined);

  await call(db, 'POST', '/licence/mine/domain', HOLDER, { hostname: HOST });
  await call(db, 'POST', `/admin/licences/${LIC}/domain/detach`, SUPER, {
    reason: 'Abuse report upheld, host withdrawn.',
  });
  for (const [method, path] of [['DELETE', '/licence/mine/domain'], ['POST', '/licence/mine/domain/check']]) {
    const res = await call(db, method, path, HOLDER);
    // A DETACHED ROW IS WHAT KEEPS THE HOST OUT OF CIRCULATION. Deleting it
    // here would let the same licence re-bind in the next request and undo the
    // detach without anybody deciding to.
    assert.equal(res.status, 409, `${method} ${path} acted on a detached host`);
    assert.equal(res.body.code, 'domain_detached');
  }
  assert.equal(rowOf(db).state, 'detached', 'the detached row was removed');
});

test('an account that administers no licence is told that, not shown a form', async () => {
  const db = freshDb();
  db.prepare('DELETE FROM licence_admins WHERE user_id = ?').run(HOLDER);
  const { status, body } = await call(db, 'POST', '/licence/mine/domain', HOLDER, { hostname: HOST });
  assert.equal(status, 404);
  assert.equal(body.error, 'no_licence');
});

test('on a BRANCH all three writes refuse, because one-host-one-licence is HQ\'s to check', async () => {
  const db = freshDb();
  for (const [method, path] of [
    ['POST', '/licence/mine/domain'],
    ['POST', '/licence/mine/domain/check'],
    ['DELETE', '/licence/mine/domain'],
  ]) {
    const res = await call(db, method, path, HOLDER, { hostname: HOST }, { BRANCH_CODE: 'fr' });
    assert.equal(res.status, 501, `${method} ${path} wrote from a branch`);
    assert.equal(res.body.error, 'domain_hq_only');
    assert.equal(res.body.branch, 'fr');
    // The refusal carries a reason the SPA can render, which is what
    // `check-api-drift` reads and what a spread would have hidden from it.
    assert.match(String(res.body.message), /cannot see what another tenant bound/);
  }
  assert.equal(rowOf(db), undefined, 'a branch write reached the register');
});

/* ── HQ's one control ───────────────────────────────────────────────────── */

test('detach takes the super-admin write bar — a plain admin cannot', async () => {
  const db = freshDb();
  await call(db, 'POST', '/licence/mine/domain', HOLDER, { hostname: HOST });
  const res = await call(db, 'POST', `/admin/licences/${LIC}/domain/detach`, HOLDER, {
    reason: 'I would rather this host were mine.',
  });
  assert.equal(res.status, 403);
  assert.equal(rowOf(db).state, 'pending', 'a plain admin detached a host');

  // AND the bar is the WRITE bar, not the elevation alone. Walt holds the same
  // `super_admins` row Sue does; his session was minted without a second
  // factor. Under `requireSuperAdmin` he would detach a tenant's host; under
  // `requireSuperAdminWriteBar` he does not get that far.
  const weak = await call(db, 'POST', `/admin/licences/${LIC}/domain/detach`, WEAK_SUPER, {
    reason: 'No second factor on this session at all.',
  });
  assert.ok(weak.status === 401 || weak.status === 403,
    `a super admin with no second factor detached a host (${weak.status})`);
  assert.equal(rowOf(db).state, 'pending', 'a session with no step-up detached a host');
});

test('detach requires a typed reason, and writes nothing without one', async () => {
  const db = freshDb();
  await call(db, 'POST', '/licence/mine/domain', HOLDER, { hostname: HOST });
  for (const reason of [undefined, '', 'too short']) {
    const res = await call(db, 'POST', `/admin/licences/${LIC}/domain/detach`, SUPER, { reason });
    assert.equal(res.status, 400, `a reason of "${String(reason)}" was accepted`);
    assert.equal(res.body.code, 'reason_too_short');
  }
  assert.equal(rowOf(db).state, 'pending');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get().n, 0,
    'a refused detach still wrote an audit row');
});

test('a detach is recorded through logAdminAction, naming the licence and the host', async () => {
  const db = freshDb();
  await call(db, 'POST', '/licence/mine/domain', HOLDER, { hostname: HOST });
  const res = await call(db, 'POST', `/admin/licences/${LIC}/domain/detach`, SUPER, {
    reason: 'Trademark complaint upheld by the registrar.',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.domain.state, 'detached');
  assert.equal(res.body.domain.detach_reason, 'Trademark complaint upheld by the registrar.');

  const audit = db.prepare("SELECT * FROM admin_audit_log WHERE action = 'licence_domain_detached'").get() as any;
  assert.ok(audit, 'the detach reached no audit row');
  assert.equal(audit.admin_user_id, SUPER);
  const detail = JSON.parse(audit.filters_json);
  assert.equal(detail.hostname, HOST);
  assert.equal(detail.licence_uid, LIC);
  assert.equal(detail.reason, 'Trademark complaint upheld by the registrar.');
  // NOT `licence_events`, and that is the point of routing it here: SQLite
  // cannot ALTER a CHECK, so admitting one new value there means the full
  // table rebuild migration 266 had to pay for. `admin_audit_log` has none.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM licence_events').get().n, 0,
    'the detach wrote a licence_events row, which would need the CHECK widened');
  // Detaching twice is refused rather than re-recorded.
  const again = await call(db, 'POST', `/admin/licences/${LIC}/domain/detach`, SUPER, {
    reason: 'Trademark complaint upheld by the registrar.',
  });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'already_detached');
});

test('HQ cannot bind, check or approve a host — detach is the only route it has', () => {
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/admin_licences.ts'), 'utf8');
  const registered = [...src.matchAll(/^r\.(get|post|put|patch|delete)\('([^']+)'/gm)].map((m) => m[2]);
  const domainRoutes = registered.filter((p) => p.includes('domain'));
  // H31: "There is no Approve, no Add domain, and no DNS editor for HQ to
  // complete on a tenant's behalf."
  assert.deepEqual(domainRoutes, ['/:uid/domain/detach'],
    `HQ grew a domain route beyond detach: ${domainRoutes.join(', ')}`);
});

/* ── the constraints that ARE the feature ───────────────────────────────── */

test('the state CHECK admits three values and deliberately has no "active"', () => {
  const db = freshDb();
  const ins = (state: string) => db.prepare(
    'INSERT INTO licence_domains (licence_id, hostname, challenge_token, state) VALUES (?,?,?,?)',
  ).run(1, `h-${state}.example.com`, 'abc1234567', state);
  for (const ok of ['pending', 'verified', 'detached']) {
    db.prepare('DELETE FROM licence_domains').run();
    ins(ok);
  }
  db.prepare('DELETE FROM licence_domains').run();
  // A COLUMN THAT COULD HOLD A STATE NOTHING CAN REACH IS A CLAIM WAITING TO
  // BE MADE FALSELY. Reaching `active` needs a Cloudflare for SaaS custom
  // hostname that is not configured, so the value does not exist.
  assert.throws(() => ins('active'), /CHECK constraint failed/,
    "'active' was storable, and nothing on this platform can reach it");
});

test('one host, one licence — structurally, including a detached row', () => {
  const db = freshDb();
  db.prepare('INSERT INTO licence_domains (licence_id, hostname, challenge_token) VALUES (1, ?, ?)')
    .run(HOST, 'abc1234567');
  assert.throws(
    () => db.prepare('INSERT INTO licence_domains (licence_id, hostname, challenge_token) VALUES (2, ?, ?)')
      .run(HOST, 'def1234567'),
    /UNIQUE constraint failed/,
    'two licences hold one host — the collision check in the handler is not what enforces this',
  );
  db.prepare("UPDATE licence_domains SET state = 'detached' WHERE licence_id = 1").run();
  assert.throws(
    () => db.prepare('INSERT INTO licence_domains (licence_id, hostname, challenge_token) VALUES (2, ?, ?)')
      .run(HOST, 'def1234567'),
    /UNIQUE constraint failed/,
    'a detached host was re-claimed, which would undo the detach that took it away',
  );
  db.prepare('DELETE FROM licence_domains').run();
  db.prepare('INSERT INTO licence_domains (licence_id, hostname, challenge_token) VALUES (1, ?, ?)')
    .run('one.example.com', 'abc1234567');
  assert.throws(
    () => db.prepare('INSERT INTO licence_domains (licence_id, hostname, challenge_token) VALUES (1, ?, ?)')
      .run('two.example.com', 'def1234567'),
    /UNIQUE constraint failed/,
    'a licence bound two hosts — S18 says one host per field in this pass',
  );
});

test('the payload names what verified is NOT, so neither screen has to word it', () => {
  const payload = domainPayload({
    id: 1, licence_id: 1, hostname: HOST, challenge_token: 'abc1234567', state: 'verified',
    txt_verified_at: '2026-09-22 10:00:00', cname_verified_at: '2026-09-22 10:00:00',
    last_checked_at: '2026-09-22 10:00:00', last_check_json: null, is_primary: 0,
    detached_at: null, detached_by_user_id: null, detach_reason: null,
    created_by_user_id: 2, created_at: '2026-09-22 09:00:00', updated_at: '2026-09-22 10:00:00',
  });
  assert.equal(payload.state, 'verified');
  assert.equal(payload.serves, false, 'a verified host claimed to serve');
  assert.ok(String(payload.serves_reason).includes('os.axal.vc'),
    'the reason stopped naming the platform host');
  assert.match(payload.serves_reason, /Members keep using the platform host/);
  // `is_primary` is 0 and nothing writes 1: a host members are sent to has to
  // serve first.
  assert.equal(payload.is_primary, false);
  // A MALFORMED STORED VERDICT IS NOT A CRASH. The column is JSON somebody
  // wrote; a page that threw on it would take the licence panels down with it.
  const bad = domainPayload({ ...({} as any), hostname: HOST, challenge_token: 'a', state: 'pending', is_primary: 0, last_check_json: '{not json' } as any);
  assert.equal(bad.last_check, null);
});
