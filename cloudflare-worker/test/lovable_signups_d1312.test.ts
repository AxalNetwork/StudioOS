/**
 * D1312 (#3432, Lovable part 4 of #2398) — a landing-page experiment's sign-up
 * address: the founder makes and turns it off; the Lovable page's form posts
 * to it; each sign-up counts in Demand and urgency signals, and only the count
 * is kept. Migration 646 is applied for real. No test reaches Lovable.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/lovable_signups_d1312.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import linkRoutes from '../src/routes/lovable_app_links.ts';
import signupRoutes from '../src/routes/lovable_signups.ts';
import { lovablePart } from '../src/services/lovableAppLinks.ts';
import { landingTestPrompt } from '../src/services/lovable/prompt.ts';
import { SIGNUP_PATH, sha256Hex, signupAddress, tokenFor } from '../src/services/lovable/signups.ts';
import { weeklySignups } from '../src/services/cycleValidate.ts';
import { HONEYPOT_FIELD } from '../src/services/landingTemplates.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 1;
const OTHER = 2;
const ADMIN = 3;
const ROLES: Record<number, string> = { [FOUNDER]: 'founder', [OTHER]: 'founder', [ADMIN]: 'admin' };
const migration = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, uid TEXT, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT, founder_id INTEGER)`);
  db.exec(`CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT, note TEXT)`);
  db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, founder_id INTEGER, deleted_at TEXT)`);
  db.exec(`CREATE TABLE hypothesis_experiments (id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER, hypothesis_id INTEGER, title TEXT)`);
  db.exec(`CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, user_id INTEGER, entity_type TEXT,
                                       entity_id TEXT, action TEXT, details TEXT, actor TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE waitlist_signups (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, landing_page_id INTEGER,
                                          email TEXT NOT NULL, name TEXT, source TEXT, ip_hash TEXT, audience TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE demand_signals (id INTEGER PRIMARY KEY, project_id INTEGER, kind TEXT, status TEXT, signal_date TEXT)`);
  const u = db.prepare('INSERT INTO users (id, uid, role, name, email, founder_id) VALUES (?, ?, ?, ?, ?, ?)');
  u.run(FOUNDER, 'u-f', 'founder', 'Fay Founder', 'f@x.test', 11);
  u.run(OTHER, 'u-o', 'founder', 'Otto Other', 'o@x.test', 12);
  u.run(ADMIN, 'u-a', 'admin', 'Alex Admin', 'a@x.test', null);
  db.prepare('INSERT INTO projects (id, founder_id) VALUES (1, 11), (2, 12)').run();
  db.prepare(`INSERT INTO hypothesis_experiments (id, uid, project_id, hypothesis_id, title) VALUES
              (5, 'e5', 1, 9, 'Landing page test'), (6, 'e6', 1, 9, 'Pricing page'), (7, 'e7', 2, 10, 'Someone else')`).run();
  for (const name of ['585_lovable_app_links.sql', '646_lovable_signup_tokens.sql']) for (const st of splitStatements(migration(name))) db.exec(st);
  return db;
}

const env = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: d1Over(db) }) as any;
const ERRORS = { Unauthorized: 401 } as Record<string, 401>;
const app = new Hono<any>();
app.onError((err: any, c) => c.json({ detail: err?.message }, ERRORS[err?.message] ?? 500));
app.route('/api/cycles', linkRoutes);
app.route('/api/validate/lovable-signups', signupRoutes);

async function call(db: DatabaseSync, method: string, path: string, as: number, body?: unknown, opts: { impersonated?: boolean } = {}) {
  const jwt = await new SignJWT({ user_id: as, role: ROLES[as], ...(opts.impersonated ? { impersonated_by: ADMIN } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env(db));
  let json: any = null;
  try { json = await res.json(); } catch { /* status says it */ }
  return { status: res.status, body: json };
}

/** A visitor's form post, as a browser sends it: form-encoded, from the Lovable app's origin. */
async function post(db: DatabaseSync, token: string, fields: Record<string, string>, extra: Record<string, string> = {}) {
  const res = await app.request(`${SIGNUP_PATH}${token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://harbor.lovable.app', 'CF-Connecting-IP': '203.0.113.9', ...extra },
    body: new URLSearchParams(fields).toString(),
  }, env(db));
  return { status: res.status, text: await res.text(), headers: res.headers };
}
const tokenOf = (address: string) => address.slice(address.lastIndexOf('/') + 1);
const make = async (db: DatabaseSync, record = 5, as = FOUNDER) => call(db, 'POST', '/api/cycles/validate/lovable/signup-token?project=1', as, { record_id: record });

test('make: the venture\'s writer gets an address once; only its hash is stored; making again turns the old one off', async () => {
  const db = freshDb();
  const r = await make(db);
  assert.equal(r.status, 201);
  const { address, live, count, uid } = r.body.signup;
  assert.equal(live, true);
  assert.equal(count, 0);
  assert.match(address, /^https:\/\/axal\.vc\/api\/validate\/lovable-signups\/[0-9a-f]{32}$/);
  const row = db.prepare('SELECT * FROM lovable_signup_tokens WHERE uid = ?').get(uid) as any;
  assert.equal(row.token_hash, await sha256Hex(tokenOf(address)));
  assert.ok(!JSON.stringify(row).includes(tokenOf(address)), 'the token itself is stored nowhere');
  assert.equal(address, signupAddress(env(db), await tokenFor(env(db), uid)), 'the address is re-derived, not stored');
  const again = await make(db);
  assert.notEqual(again.body.signup.address, address);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM lovable_signup_tokens WHERE experiment_id = 5 AND revoked_at IS NULL').get() as any).n, 1, 'one live address per experiment');
  assert.equal((await post(db, tokenOf(address), { email: 'a@x.test' })).status, 404, 'the replaced address is off');
  const log = db.prepare("SELECT action, details FROM activity_logs WHERE action LIKE 'lovable_signup%'").all() as any[];
  assert.ok(log.length >= 2);
  assert.ok(!JSON.stringify(log).includes(tokenOf(address)), 'the activity row names no token');
});

test('who may make or turn off: the venture\'s writer or an admin; never another founder, never a support session, never on Build', async () => {
  const db = freshDb();
  assert.equal((await make(db, 5, OTHER)).status, 403);
  assert.equal((await call(db, 'POST', '/api/cycles/validate/lovable/signup-token?project=1', FOUNDER, { record_id: 5 }, { impersonated: true })).status, 403);
  assert.equal((await make(db, 7)).status, 404, 'an experiment on another venture');
  assert.equal((await call(db, 'POST', '/api/cycles/build/lovable/signup-token?project=1', FOUNDER, {})).status, 404);
  assert.equal((await make(db, 5, ADMIN)).status, 201);
  assert.equal((await call(db, 'DELETE', '/api/cycles/validate/lovable/signup-token?project=1&record_id=6', FOUNDER)).status, 404, 'nothing to turn off');
});

test('a sign-up: form-encoded, counted once, with no name or email stored; a browser gets a thank-you page, a fetch JSON', async () => {
  const db = freshDb();
  const token = tokenOf((await make(db)).body.signup.address);
  const first = await post(db, token, { email: 'Ada@Example.test', name: 'Ada Lovelace' });
  assert.equal(first.status, 200);
  assert.match(first.text, /You are on the list\./);
  const dup = await post(db, token, { email: 'ada@example.test' });
  assert.equal(dup.status, 200, 'a repeat answers as success');
  const rows = db.prepare('SELECT * FROM waitlist_signups').all() as any[];
  assert.equal(rows.length, 1, 'the repeat wrote nothing');
  assert.deepEqual([rows[0].project_id, rows[0].landing_page_id, rows[0].email, rows[0].name, rows[0].source, rows[0].audience], [1, null, '', null, 'lovable', 'customer']);
  assert.match(rows[0].ip_hash, /^[0-9a-f]{32}$/);
  const everything = JSON.stringify([db.prepare('SELECT * FROM waitlist_signups').all(), db.prepare('SELECT * FROM lovable_signup_seen').all(), db.prepare('SELECT * FROM lovable_signup_tokens').all()]);
  for (const s of ['ada@example.test', 'Ada@Example.test', 'Ada Lovelace', '203.0.113.9']) assert.ok(!everything.includes(s), `${s} is stored nowhere`);
  const json = await app.request(`${SIGNUP_PATH}${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: 'bo@example.test' }) }, env(db));
  assert.deepEqual(await json.json(), { ok: true });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM waitlist_signups').get() as any).n, 2);
});

test('the honeypot, a bad email, an unknown or turned-off address; and no CORS header on any answer', async () => {
  const db = freshDb();
  const token = tokenOf((await make(db)).body.signup.address);
  const trap = await post(db, token, { email: 'bot@example.test', [HONEYPOT_FIELD]: 'https://spam.test' });
  assert.equal(trap.status, 200, 'a tripped honeypot looks like success');
  assert.equal((await post(db, token, { email: 'not an email' })).status, 400);
  assert.equal((await post(db, token, {})).status, 400);
  assert.equal((await post(db, '0'.repeat(32), { email: 'a@x.test' })).status, 404);
  assert.equal((await post(db, 'not-a-token', { email: 'a@x.test' })).status, 404);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM waitlist_signups').get() as any).n, 0, 'none of these wrote a sign-up');
  assert.equal((await call(db, 'DELETE', '/api/cycles/validate/lovable/signup-token?project=1&record_id=5', FOUNDER)).status, 200);
  const off = await post(db, token, { email: 'a@x.test' });
  assert.equal(off.status, 404, 'a turned-off address is 404');
  for (const r of [trap, off]) assert.equal(r.headers.get('access-control-allow-origin'), null);
  // The route is not under the CORS allowlist: the Lovable app's origin is never added.
  assert.doesNotMatch(read('src/index.ts'), /lovable\.app/);
});

test('the rate bucket and the CSRF exemption: 6 a minute per IP, failing closed; the token is the authorisation', () => {
  const rate = read('src/middleware/rateLimit.ts');
  const bucket = rate.slice(rate.indexOf("name: 'lovable_signup'"), rate.indexOf("name: 'lovable_signup'") + 400);
  assert.match(bucket, /limit: 6/);
  assert.match(bucket, /scope: 'ip'/);
  assert.match(bucket, /failClosed: true/);
  const re = /\/\^\\\/api\\\/validate\\\/lovable-signups\\\/\[\^\/\]\+\$\//;
  assert.match(bucket, re);
  assert.match(read('src/middleware/csrf.ts'), /c\.req\.path\.startsWith\('\/api\/validate\/lovable-signups\/'\)/);
  assert.match(read('src/index.ts'), /app\.route\('\/api\/validate\/lovable-signups', lovableSignups\);/);
});

test('weeklySignups counts the Lovable sign-ups; the owner\'s contact list leaves them out', async () => {
  const db = freshDb();
  const token = tokenOf((await make(db)).body.signup.address);
  await post(db, token, { email: 'a@example.test' });
  await post(db, token, { email: 'b@example.test' });
  db.prepare("INSERT INTO waitlist_signups (project_id, email, source, audience) VALUES (1, 'c@example.test', 'landing', 'customer')").run();
  const today = new Date().toISOString().slice(0, 10);
  const w = await weeklySignups({ env: env(db), projectId: 1, today } as any, 4);
  assert.equal(w.total, 3);
  assert.equal(w.weeks[3], 3);
  const brand = read('src/routes/brand.ts');
  assert.equal((brand.match(/AND COALESCE\(source, ''\) <> 'lovable' ORDER BY created_at DESC LIMIT 500/g) || []).length, 2);
});

test('From Lovable\'s slot: the count for everyone who reads it, the address for the venture\'s writers only', async () => {
  const db = freshDb();
  const token = tokenOf((await make(db)).body.signup.address);
  await post(db, token, { email: 'a@example.test' });
  const writer = await lovablePart(env(db), 1, 'validate', [{ id: 5, label: 'Landing page test' }, { id: 6, label: 'Pricing page' }], { writer: true });
  assert.equal(writer.state, 'ok');
  const [five, six] = (writer as any).slots;
  assert.equal(five.signup.count, 1);
  assert.match(five.signup.address, /lovable-signups\/[0-9a-f]{32}$/);
  assert.equal(six.signup, null, 'an experiment with no address');
  const reader = await lovablePart(env(db), 1, 'validate', [{ id: 5, label: 'Landing page test' }]);
  assert.equal((reader as any).slots[0].signup.address, null, 'a reader sees the count, not the address');
  assert.equal((reader as any).slots[0].signup.count, 1);
  const build = await lovablePart(env(db), 1, 'build', [{ id: 1, label: 'Prototype / MVP' }]);
  assert.equal('signup' in (build as any).slots[0], false, 'Build has no sign-up address');
  db.exec('DROP TABLE lovable_signup_seen');
  const broken = await lovablePart(env(db), 1, 'validate', [{ id: 5, label: 'Landing page test' }], { writer: true });
  assert.equal(broken.state, 'ok', 'the link still draws');
  assert.deepEqual([(broken as any).slots[0].signup, (broken as any).slots[0].signup_unreadable], [null, true]);
});

test('the landing-page prompt names the address only when the experiment has one', () => {
  const r = { venture: 'Harbor Ledger', description: null, code: 'H2', claim: 'Bookkeepers want this', title: 'Landing page test', method: null, target: '40 sign-ups' };
  assert.doesNotMatch(landingTestPrompt(r).prompt, /lovable-signups|method POST|field named/);
  assert.doesNotMatch(landingTestPrompt({ ...r, signupUrl: null }).prompt, /method POST/);
  const p = landingTestPrompt({ ...r, signupUrl: 'https://axal.vc/api/validate/lovable-signups/0123456789abcdef0123456789abcdef' }).prompt;
  assert.match(p, /method POST, action https:\/\/axal\.vc\/api\/validate\/lovable-signups\/0123456789abcdef0123456789abcdef, one email field named "email"/);
  assert.match(read('src/services/lovable/launch.ts'), /liveAddress\(env, projectId, Number\(ref\.id\)\)/);
});
