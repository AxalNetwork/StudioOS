/**
 * D198 — a white-label licence records the brand its operator trades under.
 *
 * WHAT THIS FILE IS FOR. `AdminLicences.jsx` has shipped a `licence-brand-kit`
 * block since the licence console was built, and three of its four fields were
 * `value={null}` under the hints "No logo store.", "No colour store." and
 * "Hiding the mark is not a stored switch." Migration 281 gives two of those
 * three a store; the third stays absent on purpose, because nothing in the
 * shell renders a platform credit at all. These are the guards.
 *
 * THE KIND IS THE WHOLE FEATURE, not a check around it. The two canvases
 * disagree about who owns a brand kit — S11 says HQ, H26 says "Unique to this
 * kind · an Axal subsidiary never sees this step" — and `wlCompare` resolves
 * them by licence kind. So every refusal below for a subsidiary is asserted as
 * a refusal, not skipped as an edge case.
 *
 * THE MARK IS READ TWICE ON PURPOSE. The approved plan's own sizing line said
 * `files.ts`'s signed-download primitive was the reuse point for the mark. It
 * is not: `mintDownloadToken` is one-time (its `jti` is deleted on consume) and
 * hard-clamped to five minutes, so an `<img src>` on a page that re-renders
 * 404s the second time. That correction is SHOWN rather than argued — the
 * stream test fetches the same URL twice and compares the bytes.
 *
 * AND THE FIXTURE SLICES ITS DDL OFF THE MIGRATION, for D197's reason one
 * table over: `licence_id UNIQUE` IS the "one kit per licence" rule, and a
 * hand-written fixture that relaxed it would let this suite go green against a
 * table production does not have.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/licence_brand_kit_d198.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import licences from '../src/routes/admin_licences.ts';
import { LOGO_MAX_BYTES, readUploadedMark } from '../src/routes/brand.ts';

const JWT_SECRET = 'test-secret-that-is-long-enough-for-the-boot-assertion';
const SUPER = 1;
// A super admin whose session was minted WITHOUT a second factor. The three
// writes take `requireSuperAdminWriteBar` — TOTP and a recent step-up BEFORE
// the elevation check — so this account is the only thing that tells the write
// bar apart from a bare `requireSuperAdmin`.
const WEAK_SUPER = 4;
const WL = 'lic_d198_wl';
const SUB = 'lic_d198_sub';

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

/** An object store that records every key it was handed, so the KEY can be asserted. */
function makeR2() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    objects,
    async put(key: string, bytes: Uint8Array, opts: any) {
      objects.set(key, { bytes, contentType: opts?.httpMetadata?.contentType || '' });
    },
    async get(key: string) {
      const o = objects.get(key);
      return o ? { body: o.bytes, httpMetadata: { contentType: o.contentType } } : null;
    },
    async delete(key: string) { objects.delete(key); },
  };
}

const ERRORS = {
  Unauthorized: 401, 'Admin required': 403, 'Super admin required': 403, 'HQ only': 403,
} as Record<string, 401 | 403>;
const app = new Hono<any>();
app.route('/admin/licences', licences);
app.onError((err: any, c) => {
  const s = ERRORS[String(err?.message || '')];
  if (s) return c.json({ detail: err.message, code: err.message }, s);
  throw err;
});

/** Migration 281's own DDL, UNIQUE and all. */
function kitsDdl(): string {
  const sql = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/sql/migrations/281_licence_brand_kits.sql'), 'utf8',
  );
  const at = sql.indexOf('CREATE TABLE IF NOT EXISTS licence_brand_kits');
  assert.ok(at > 0, '281 no longer declares licence_brand_kits — re-point this fixture');
  const end = sql.indexOf('\n);', at);
  assert.ok(end > at, '281: the CREATE does not terminate');
  return sql.slice(at, end + 3);
}

function freshDb({ withKits = true } = {}) {
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
      signatory_name TEXT, signatory_title TEXT, status TEXT NOT NULL DEFAULT 'draft',
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
    CREATE TABLE licence_domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, hostname TEXT, challenge_token TEXT,
      state TEXT, txt_verified_at TEXT, cname_verified_at TEXT, last_checked_at TEXT,
      last_check_json TEXT, is_primary INTEGER, detached_at TEXT, detached_by_user_id INTEGER,
      detach_reason TEXT, created_by_user_id INTEGER, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE licence_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, event TEXT,
      detail_json TEXT, note TEXT, actor_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // withKits: false is the database that has NOT applied 281. Every reader has
  // to render that as unreadable rather than as "this licence has no kit".
  if (withKits) db.exec(kitsDdl());

  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(SUPER, 'admin', 'Sue', 'sue@axal.example');
  u.run(WEAK_SUPER, 'admin', 'Walt', 'walt@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(WEAK_SUPER);
  db.prepare(
    `INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at)
     VALUES (?, ?, 'totp', 'totp', datetime('now'))`,
  ).run(SUPER, `totp-${SUPER}`);
  db.prepare(
    `INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at)
     VALUES (?, ?, 'password', 'password', datetime('now'))`,
  ).run(WEAK_SUPER, `totp-${WEAK_SUPER}`);

  const lic = db.prepare(
    `INSERT INTO territory_licences
       (uid, licence_ref, legal_entity_name, brand_name, status, kind,
        annual_fee_cents, revenue_share_bps, renews_on)
     VALUES (?,?,?,?, 'draft', ?, 120000, 3500, '2027-01-01')`,
  );
  lic.run(WL, 'AXL-010', 'Studio Lyon Ventures SAS', 'Studio Lyon', 'white_label');
  lic.run(SUB, 'AXL-011', 'Axal VC France SAS', 'Axal VC France', 'subsidiary');
  for (const id of [1, 2]) {
    db.prepare('INSERT INTO licence_territories (licence_id, country_code) VALUES (?, ?)').run(id, 'FR');
    db.prepare("INSERT INTO licence_seats (licence_id, seat_type, seats_licensed) VALUES (?, 'founder', 25)").run(id);
  }
  return db;
}

const env = (db: any, extra: Record<string, unknown> = {}) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: makeD1(db), ...extra });

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', jti: `totp-${userId}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(db: any, method: string, path: string, who = SUPER, body?: any, extraEnv = {}) {
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${await token(who)}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env(db, extraEnv));
  let out: any = null;
  try { out = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: out };
}

async function upload(db: any, uid: string, file: File, who = SUPER, extraEnv = {}) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await app.request(`/admin/licences/${uid}/brand/mark`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token(who)}` },
    body: fd,
  }, env(db, extraEnv));
  let out: any = null;
  try { out = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: out };
}

const kitRow = (db: any, licenceId = 1) =>
  db.prepare('SELECT * FROM licence_brand_kits WHERE licence_id = ?').get(licenceId) as any;

const ROUTE_SRC = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/src/routes/admin_licences.ts'), 'utf8',
);

/* ------------------------------------------------------------------ */

test('migration 281 makes one-kit-per-licence STRUCTURAL, not a handler check', () => {
  const db = freshDb();
  db.prepare("INSERT INTO licence_brand_kits (licence_id, primary_hex) VALUES (1, '#0f766e')").run();
  assert.throws(
    () => db.prepare("INSERT INTO licence_brand_kits (licence_id, primary_hex) VALUES (1, '#111111')").run(),
    /UNIQUE/i,
    'a second kit for one licence was accepted, so the rule is only in the handler',
  );
});

test('a SUBSIDIARY licence is refused a brand kit, on all three writes', async () => {
  const db = freshDb();
  const put = await call(db, 'PUT', `/admin/licences/${SUB}/brand`, SUPER,
    { primary_hex: '#0f766e', accent_hex: '#f59e0b' });
  assert.equal(put.status, 409, 'a subsidiary was allowed to store its own brand');
  assert.equal(put.body?.code, 'not_white_label');

  const up = await upload(db, SUB, new File([new Uint8Array([1, 2, 3])], 'm.png', { type: 'image/png' }),
    SUPER, { FILES: makeR2() });
  assert.equal(up.status, 409, 'a subsidiary was allowed to upload a mark');

  const del = await call(db, 'DELETE', `/admin/licences/${SUB}/brand/mark`);
  assert.equal(del.status, 409, 'a subsidiary reached the mark delete');

  assert.equal(kitRow(db, 2), undefined, 'a refused write left a row behind');
});

test('a colour that is not a hex value is REFUSED, never coerced to a default', async () => {
  const db = freshDb();
  for (const body of [
    { primary_hex: 'teal', accent_hex: '#f59e0b' },
    { primary_hex: '#0f766e', accent_hex: 'rgb(1,2,3)' },
    { primary_hex: '#0f766e' },
    { primary_hex: '#0f766e', accent_hex: '#12345' },
  ]) {
    const res = await call(db, 'PUT', `/admin/licences/${WL}/brand`, SUPER, body);
    assert.equal(res.status, 400, `${JSON.stringify(body)} was accepted`);
    assert.equal(res.body?.code, 'invalid_colours');
  }
  assert.equal(kitRow(db), undefined, 'a refused colour still wrote a row');

  // And the shape `cleanHex` DOES admit, so the refusal is not merely strict:
  // `#rgb` as well as `#rrggbb`, lowercased. Normalising case is not coercion.
  const ok = await call(db, 'PUT', `/admin/licences/${WL}/brand`, SUPER,
    { primary_hex: '#ABC', accent_hex: '#F59E0B' });
  assert.equal(ok.status, 200);
  assert.equal(kitRow(db).primary_hex, '#abc');
  assert.equal(kitRow(db).accent_hex, '#f59e0b');
});

test('the three writes take the SUPER-ADMIN WRITE BAR, not a bare elevation', async () => {
  const db = freshDb();
  const put = await call(db, 'PUT', `/admin/licences/${WL}/brand`, WEAK_SUPER,
    { primary_hex: '#0f766e', accent_hex: '#f59e0b' });
  assert.notEqual(put.status, 200, 'a session with no second factor set a brand kit');
  const up = await upload(db, WL, new File([new Uint8Array([1])], 'm.png', { type: 'image/png' }),
    WEAK_SUPER, { FILES: makeR2() });
  assert.notEqual(up.status, 200, 'a session with no second factor uploaded a mark');
  const del = await call(db, 'DELETE', `/admin/licences/${WL}/brand/mark`, WEAK_SUPER);
  assert.notEqual(del.status, 200, 'a session with no second factor removed a mark');
});

test('setting the colours stores them and writes ONE audit row, not a licence event', async () => {
  const db = freshDb();
  const res = await call(db, 'PUT', `/admin/licences/${WL}/brand`, SUPER,
    { primary_hex: '#0f766e', accent_hex: '#f59e0b' });
  assert.equal(res.status, 200);
  assert.equal(res.body?.brand_kit?.primary_hex, '#0f766e');
  assert.equal(res.body?.brand_kit?.accent_hex, '#f59e0b');
  assert.equal(res.body?.brand_kit?.mark_url, null, 'a kit with no mark advertised a mark url');

  const audit = db.prepare("SELECT * FROM admin_audit_log WHERE action = 'licence_brand_kit_set'").all() as any[];
  assert.equal(audit.length, 1, 'the colour write was not audited exactly once');
  // `licence_events` has a CHECK admitting ten values, and widening it cost
  // migration 266 a full table rebuild to add ONE. An HQ act against a tenant
  // belongs in `admin_audit_log`, which has none.
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM licence_events').get() as any).n, 0,
    'the brand kit reached licence_events, whose CHECK would have to be rebuilt to admit it');
});

test('an uploaded SVG is SANITISED before it is stored, and the mark is keyed by the LICENCE', async () => {
  const db = freshDb();
  const files = makeR2();
  const hostile = '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("//evil")</script><rect/></svg>';
  const mark = new File([hostile], 'm.svg', { type: 'image/svg+xml' });
  // THE ANNOTATION IS `brand_svg_sanitize.test.ts:41,64,78`'s, for the same rule
  // and the same reason: a deliberately hostile fixture in a SANITISATION test,
  // never rendered anywhere, whose entire point is the assertion below that these
  // bytes do NOT survive. GOTCHAS.md:210's rule is to read the code before calling
  // a match a false positive — and its other half, that `detect-non-literal-regexp`
  // gets fixed rather than suppressed, does not transfer: that fix produced better
  // code, while obfuscating an attack fixture until a scanner stops recognising it
  // would produce worse. The call is one line because the rule reports where the
  // payload meets the identifiers it cannot resolve, and that was two lines.
  const res = await upload(db, WL, mark, SUPER, { FILES: files }); // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const keys = [...files.objects.keys()];
  assert.equal(keys.length, 1);
  // NOT `brand-logos/<uploader id>/…`. `/api/brand/logo/upload` keys by whoever
  // uploaded; a licence's mark must not land in a namespace belonging to
  // whichever operator happened to be at the keyboard.
  assert.ok(keys[0].startsWith(`licence-marks/${WL}/`),
    `the mark landed at ${keys[0]}, which is not the licence's own namespace`);
  assert.ok(keys[0].endsWith('.svg'));

  const stored = new TextDecoder().decode(files.objects.get(keys[0])!.bytes);
  assert.doesNotMatch(stored, /<script/i, 'the stored bytes carry a script payload');
  assert.match(stored, /<svg/i, 'sanitisation ate the image as well as the script');
  assert.equal(kitRow(db).mark_r2_key, keys[0]);
  assert.equal(kitRow(db).mark_mime, 'image/svg+xml');
});

test('the shared helper is what enforces the allowlist and the cap', async () => {
  const bad = new FormData();
  bad.append('file', new File(['x'], 'm.gif', { type: 'image/gif' }));
  const r1 = await readUploadedMark(bad);
  assert.equal(r1.ok, false);
  assert.equal((r1 as any).error, 'invalid mime type');

  const big = new FormData();
  big.append('file', new File([new Uint8Array(LOGO_MAX_BYTES + 1)], 'm.png', { type: 'image/png' }));
  const r2 = await readUploadedMark(big);
  assert.equal(r2.ok, false);
  assert.equal((r2 as any).error, 'file too large');

  const empty = new FormData();
  empty.append('file', new File([], 'm.png', { type: 'image/png' }));
  assert.equal((await readUploadedMark(empty)).ok, false);
});

test('the mark streams, and reads the SAME the second time — a one-time token would not', async () => {
  const db = freshDb();
  const files = makeR2();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  await upload(db, WL, new File([png], 'm.png', { type: 'image/png' }), SUPER, { FILES: files });

  const read = async () => app.request(`/admin/licences/${WL}/brand/mark`, {
    headers: { Authorization: `Bearer ${await token(SUPER)}` },
  }, env(db, { FILES: files }));

  const a = await read();
  assert.equal(a.status, 200);
  assert.equal(a.headers.get('content-type'), 'image/png');
  const first = new Uint8Array(await a.arrayBuffer());

  // THE MEASUREMENT THAT CORRECTS THE PLAN'S OWN SIZING LINE. A signed
  // download token is one-time — its `jti` is deleted on consume — so the
  // second render of an <img> would 404. A gated stream does not.
  const b = await read();
  assert.equal(b.status, 200, 'the second read of a mark failed, which is what a one-time token does');
  assert.deepEqual(new Uint8Array(await b.arrayBuffer()), first);

  // AND THE MODULE DOES NOT REACH FOR THAT PRIMITIVE — asserted on the IMPORT,
  // not on the name. The first draft of this scanned the source for
  // `mintDownloadToken` and passed trivially: the only occurrence is the
  // comment ABOVE the route explaining why it is not used. A lexical scan
  // cannot tell a rule from its violation, which is the fourth time this
  // programme has paid for that; an import is a structural fact prose cannot
  // satisfy.
  assert.doesNotMatch(ROUTE_SRC, /from '\.\.\/services\/signedDownload/,
    'the licence routes imported the one-time signed-download primitive');
});

test('removing the mark keeps the colours, and drops the object', async () => {
  const db = freshDb();
  const files = makeR2();
  await call(db, 'PUT', `/admin/licences/${WL}/brand`, SUPER,
    { primary_hex: '#0f766e', accent_hex: '#f59e0b' });
  await upload(db, WL, new File([new Uint8Array([1, 2])], 'm.png', { type: 'image/png' }), SUPER, { FILES: files });
  assert.equal(files.objects.size, 1);

  const res = await call(db, 'DELETE', `/admin/licences/${WL}/brand/mark`, SUPER, undefined, { FILES: files });
  assert.equal(res.status, 200);
  assert.equal(files.objects.size, 0, 'the object survived the delete');
  const row = kitRow(db);
  assert.equal(row.mark_r2_key, null);
  assert.equal(row.mark_mime, null);
  assert.equal(row.primary_hex, '#0f766e', 'removing the mark took the colours with it');

  const again = await call(db, 'DELETE', `/admin/licences/${WL}/brand/mark`, SUPER, undefined, { FILES: files });
  assert.equal(again.status, 404);
  assert.equal(again.body?.code, 'no_mark');
});

test('replacing a mark removes the superseded object rather than orphaning it', async () => {
  const db = freshDb();
  const files = makeR2();
  await upload(db, WL, new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }), SUPER, { FILES: files });
  const firstKey = [...files.objects.keys()][0];
  await upload(db, WL, new File([new Uint8Array([2])], 'b.png', { type: 'image/png' }), SUPER, { FILES: files });
  assert.equal(files.objects.size, 1, 'the superseded object was left in the bucket');
  assert.notEqual([...files.objects.keys()][0], firstKey);
  assert.equal(kitRow(db).mark_r2_key, [...files.objects.keys()][0]);
});

test('the kit rides the licence payload, and UNREADABLE is not ABSENT', async () => {
  const db = freshDb();
  await call(db, 'PUT', `/admin/licences/${WL}/brand`, SUPER,
    { primary_hex: '#0f766e', accent_hex: '#f59e0b' });

  const list = await call(db, 'GET', '/admin/licences');
  const wl = list.body.items.find((l: any) => l.uid === WL);
  const sub = list.body.items.find((l: any) => l.uid === SUB);
  assert.equal(wl.brand_kit_available, true);
  assert.equal(wl.brand_kit.primary_hex, '#0f766e');
  // A subsidiary has no kit and the store WAS readable — those are two
  // different fields, and only one of them is a claim about the database.
  assert.equal(sub.brand_kit, null);
  assert.equal(sub.brand_kit_available, true);

  // A database that has not applied 281 renders UNREADABLE with its own reason
  // — never `brand_kit: null`, which would be a claim about the licence.
  const old = freshDb({ withKits: false });
  const oldList = await call(old, 'GET', '/admin/licences');
  const row = oldList.body.items.find((l: any) => l.uid === WL);
  assert.equal(row.brand_kit_available, false, 'a missing store read as "this licence has no kit"');
  assert.equal(row.brand_kit, null);
  assert.match(String(row.brand_kit_reason), /migration 281/,
    'the unreadable state does not name what is missing');
});

test('a WHITE-LABEL cannot activate without its colours — and a subsidiary is untouched', async () => {
  const db = freshDb();

  // H26: "Brand kit — required to activate."
  const before = await call(db, 'GET', `/admin/licences/${WL}/activation`);
  assert.equal(before.body.can_activate, false);
  assert.ok(before.body.blockers.some((b: string) => /brand kit has no colours/i.test(b)),
    `the white-label blocker is missing: ${JSON.stringify(before.body.blockers)}`);
  const refused = await call(db, 'POST', `/admin/licences/${WL}/activate`);
  assert.equal(refused.status, 409);

  // THE HALF THAT PROVES NOTHING EXISTING MOVED. A subsidiary licence with the
  // same territory, seats and terms activates exactly as it did before D198 —
  // no kit, no blocker, no mention of one.
  const sub = await call(db, 'GET', `/admin/licences/${SUB}/activation`);
  assert.deepEqual(sub.body.blockers, [], `a subsidiary gained a blocker: ${JSON.stringify(sub.body.blockers)}`);
  assert.equal(sub.body.can_activate, true);
  assert.equal((await call(db, 'POST', `/admin/licences/${SUB}/activate`)).status, 200);

  // Set the colours and the white-label's own blocker clears.
  await call(db, 'PUT', `/admin/licences/${WL}/brand`, SUPER,
    { primary_hex: '#0f766e', accent_hex: '#f59e0b' });
  const after = await call(db, 'GET', `/admin/licences/${WL}/activation`);
  assert.deepEqual(after.body.blockers, [], JSON.stringify(after.body.blockers));
  assert.equal((await call(db, 'POST', `/admin/licences/${WL}/activate`)).status, 200);
});

test('an unreadable kit store FAILS CLOSED on a white-label, and open on a subsidiary', async () => {
  const db = freshDb({ withKits: false });
  const wl = await call(db, 'GET', `/admin/licences/${WL}/activation`);
  assert.equal(wl.body.can_activate, false, '"we could not tell" was treated as "it is fine"');
  assert.ok(wl.body.blockers.some((b: string) => /migration 281/.test(b)),
    `the unreadable store is not named as the blocker: ${JSON.stringify(wl.body.blockers)}`);

  const sub = await call(db, 'GET', `/admin/licences/${SUB}/activation`);
  assert.deepEqual(sub.body.blockers, [],
    'a missing kit store blocked a subsidiary, which has no kit to read');
});

test('a mark upload with no object store STATES it rather than storing a data URI', async () => {
  const db = freshDb();
  const res = await upload(db, WL, new File([new Uint8Array([1])], 'm.png', { type: 'image/png' }), SUPER, {});
  assert.equal(res.status, 503);
  assert.equal(res.body?.code, 'r2_unavailable');
  assert.equal(kitRow(db), undefined, 'a refused upload wrote a kit row anyway');
});
