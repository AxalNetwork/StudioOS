// #4570 slice 2 (S1 of #4554) — the authorization sweep: the real Worker, on
// the fully migrated schema, asked for every route the inventory
// (scripts/lib/authInventory.mjs) places behind an identity gate, by callers
// that gate must refuse:
//
//   · no credentials, on every signed-in route;
//   · a founder (signed in, no staff role), on every admin / HQ / Super Admin route;
//   · an admin who is not a Super Admin, on every Super Admin route;
//   · a disabled account, on one signed-in GET route of every family.
//
// A refusal is any status that is not 2xx or 3xx. Two kinds are pinned as
// ratchets, so neither can grow unseen and each fix shows up as a list to shrink:
//   KNOWN_500        refused, but with 500 where 401 belongs (#4570 asks for 401/403/404);
//   GATE_NOT_REACHED the feature answers 503 before its gate runs (switched off here),
//                    so the sweep did not test that gate.
// A 3xx is a refusal only on an OAuth callback, whose refusal is a redirect to
// the app's error page (admin_x.ts maps requireSuperAdmin's failure to one).
//
// The sweep is the inventory checked against the running Worker: a route the
// reader called gated that answers an anonymous caller would be either a reader
// error in the dangerous direction or an open route. Neither may pass.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/authz_sweep_d4570.test.ts
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import worker from '../src/index.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { inventory } from '../../scripts/lib/authInventory.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SECRET = 'd4570-sweep-fixture-only-'.repeat(3); // A fixture signing key; never a service credential.
const ctx: any = { waitUntil() {}, passThroughOnException() {} };
const FOUNDER = 10, ADMIN = 20, SUPER = 30, DISABLED = 40;

const SIGNED_IN = ['authenticated', 'cf_access', 'admin', 'hq_admin', 'super_admin'];
const STAFF = ['cf_access', 'admin', 'hq_admin', 'super_admin'];

/** Refused with 500 where 401 belongs. Fix the route and take it off; never add to it. */
const KNOWN_500 = new Set([
  'POST /api/auth/accept-terms', 'DELETE /api/auth/passkey/:id', 'GET /api/auth/passkey/list', 'GET /api/auth/passkey/register-options',
  'POST /api/auth/passkey/register-verify', 'POST /api/auth/sign-out-everywhere', 'POST /api/auth/step-up',
]);
/** Switched off here: 503 before the gate runs, so this sweep did not reach the gate. */
const GATE_NOT_REACHED = new Set([
  'POST /api/auth/sms/confirm-enrollment', 'POST /api/auth/sms/start-enrollment', 'POST /api/calendar/google/meet-transcripts/connect',
  'POST /api/linkedin/oauth/start', 'GET /api/round-calls', 'POST /api/round-calls', 'GET /api/round-calls/:uid', 'PUT /api/round-calls/:uid',
  'PUT /api/round-calls/:uid/audience', 'POST /api/round-calls/:uid/audience-preview', 'POST /api/round-calls/:uid/counsel-approval',
  'POST /api/round-calls/:uid/counsel-request', 'POST /api/round-calls/:uid/manage', 'PUT /api/round-calls/:uid/questions/:questionUid',
  'POST /api/round-calls/:uid/responses', 'POST /api/round-calls/:uid/send', 'GET /api/round-calls/context', 'GET /api/round-calls/counsel-queue',
]);

/**
 * Super Admin routes an admin may read by design: the reader sees `requireSuperAdmin` in a helper that asks
 * for it only for some acts (services/fundAdminAccess.ts `gate`: the act's tier), so it reports the stronger
 * gate. An overstatement between two staff tiers, which this sweep is here to find; each is named with why.
 */
const ADMIN_TIER_BY_ACT = new Map([
  ['GET /api/fund-booklets', 'fund_booklet.read is an admin-tier act (fundAdminAccess.ts); the route gate is requireAdmin'],
]);

let db: any, env: any, rows: any[] = [];
const tokens: Record<number, string> = {};

before(async () => {
  db = migratedDatabase();
  db.exec(`INSERT INTO users(id,uid,name,email,role,is_active,subscription_tier,subscription_status) VALUES
    (${FOUNDER},'u-founder','Founder','founder@example.invalid','founder',1,'studio','active'),
    (${ADMIN},'u-admin','Admin','admin@example.invalid','admin',1,'studio','active'),
    (${SUPER},'u-super','Super','super@example.invalid','admin',1,'studio','active'),
    (${DISABLED},'u-disabled','Disabled','disabled@example.invalid','founder',0,'studio','active');
    INSERT INTO super_admins(user_id) VALUES (${SUPER});`);
  env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development', RATE_LIMITS: memKV(), TOKENS: memKV() };
  for (const id of [FOUNDER, ADMIN, SUPER, DISABLED]) {
    tokens[id] = await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30m').sign(new TextEncoder().encode(SECRET));
  }
  rows = inventory(ROOT);
});
after(() => { db?.close(); removeMigratedDatabases(); });

/** A path with its parameters filled: ids as 1, uids, tokens and slugs as 32 hex. */
const fill = (p: string) => p.replace(/:([A-Za-z_]\w*)(\{[^}]*\})?/g, (_m, n) => (/uid|token|key|slug|handle|code/i.test(n) ? 'a'.repeat(32) : '1')).replace(/\*/g, 'x');
const keyOf = (r: { method: string; path: string }) => `${r.method === 'ALL' ? 'GET' : r.method} ${r.path}`;

async function send(r: { method: string; path: string }, who?: number) {
  const method = r.method === 'ALL' ? 'GET' : r.method;
  const read = method === 'GET' || method === 'HEAD';
  const res = await worker.fetch(new Request(`https://unit.test${fill(r.path)}`, {
    method, redirect: 'manual',
    headers: { ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), ...(read ? {} : { 'content-type': 'application/json' }) },
    body: read ? undefined : '{}',
  // A fresh limiter per request: this sweep is about gates, and the limiter would otherwise answer 429 first.
  }), { ...env, RATE_LIMITS: memKV() }, ctx);
  return { status: res.status, location: res.headers.get('location') };
}

/** Each way a refusal can be wrong, as a list of `METHOD path — status`. */
function wrong(results: Array<{ key: string; path: string; status: number; location: string | null }>) {
  return results.filter(({ key, path, status, location }) => {
    if (status >= 200 && status < 300) return true;
    if (status >= 300 && status < 400) return !(/\/callback$/.test(path) && location && /(error|denied|admin_required)/i.test(location));
    if (status === 500) return !KNOWN_500.has(key);
    if (status === 503) return !GATE_NOT_REACHED.has(key);
    return false;
  }).map(({ key, status }) => `${key} — ${status}`);
}

test('every signed-in route refuses a caller with no credentials', async () => {
  const swept = rows.filter((r) => SIGNED_IN.includes(r.gate));
  assert.ok(swept.length > 3000, `${swept.length} signed-in routes`);
  const results = [];
  for (const r of swept) results.push({ key: keyOf(r), path: r.path, ...(await send(r)) });
  // Mutation checked: requireAuth in auth.ts returning the first user for a missing token → hundreds of 200s and this fails.
  assert.deepEqual(wrong(results), []);
  // The ratchets name only routes that still answer that way: a fixed one must come off its list.
  const got = (code: number) => new Set(results.filter((x) => x.status === code).map((x) => x.key));
  assert.deepEqual([...KNOWN_500].filter((k) => !got(500).has(k)), [], 'fixed: take these off KNOWN_500');
  assert.deepEqual([...GATE_NOT_REACHED].filter((k) => !got(503).has(k)), [], 'reached now: take these off GATE_NOT_REACHED');
  assert.ok(results.filter((x) => x.status === 401).length > 3000, 'most refusals are the 401 the gate gives');
});

test('every admin, HQ and Super Admin route refuses a founder', async () => {
  const swept = rows.filter((r) => STAFF.includes(r.gate));
  assert.ok(swept.length > 900, `${swept.length} staff routes`);
  const results = [];
  for (const r of swept) results.push({ key: keyOf(r), path: r.path, ...(await send(r, FOUNDER)) });
  // Mutation checked: requireAdmin letting any signed-in member through → founders reach admin routes and this fails.
  assert.deepEqual(wrong(results), []);
});

test('every Super Admin route refuses an admin who is not a Super Admin', async () => {
  const swept = rows.filter((r) => r.gate === 'super_admin');
  assert.ok(swept.length > 400, `${swept.length} Super Admin routes`);
  const results = [];
  for (const r of swept) results.push({ key: keyOf(r), path: r.path, ...(await send(r, ADMIN)) });
  // Mutation checked: requireSuperAdmin accepting role 'admin' alone → admins reach Super Admin routes and this fails.
  assert.deepEqual(wrong(results).filter((w) => !ADMIN_TIER_BY_ACT.has(w.replace(/ — \d+$/, ''))), []);
  // Each exception still is one: an admin still reads it.
  for (const k of ADMIN_TIER_BY_ACT.keys()) assert.equal(results.find((x) => x.key === k)?.status, 200, `${k} is no longer read by an admin: take it off ADMIN_TIER_BY_ACT`);
  // The Super Admin is let through somewhere, so the refusals above are the gate and not the fixture.
  const ok = [];
  for (const r of swept.filter((x) => x.method === 'GET' && !x.path.includes(':')).slice(0, 20)) ok.push((await send(r, SUPER)).status);
  assert.ok(ok.some((s) => s >= 200 && s < 300), `the Super Admin read nothing: ${ok.join(',')}`);
});

test('a disabled account is refused on every family', async () => {
  const byFamily = new Map<string, any>();
  for (const r of rows) if (r.gate === 'authenticated' && r.method === 'GET' && !r.path.includes(':') && !byFamily.has(r.family)) byFamily.set(r.family, r);
  assert.ok(byFamily.size > 100, `${byFamily.size} families with a signed-in GET`);
  const results = [];
  for (const r of byFamily.values()) results.push({ key: keyOf(r), path: r.path, ...(await send(r, DISABLED)) });
  // Mutation checked: getCurrentUser's is_active check dropped → the disabled account reads and this fails.
  assert.deepEqual(wrong(results), []);
});
