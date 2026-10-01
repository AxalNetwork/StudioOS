/**
 * D106 — what a branch Worker refuses, and why the refusal is structural.
 *
 * THE ASSERTION THIS FILE EXISTS FOR is the first one below: HQ's 24
 * super-admin routes must be closed on a branch EVEN WHEN `super_admins`
 * HOLDS A ROW. Before D106 the only thing closing them was that a
 * bootstrapped branch database starts with that table empty (migration 207
 * sits below `BASELINE_CUTOFF`, so it is marked and never executed) — and an
 * empty table is a data state, not a gate. One INSERT would have reopened
 * HQ's whole console over branch data, silently, with every route still
 * "working". So every deny case here seeds the row first: a test that only
 * ever asked an empty table would pass against the old code and prove
 * nothing about the new.
 *
 * The same shape applies to the authoring gate and the URL assertion: each is
 * checked in BOTH directions, because a gate that refuses everything is as
 * broken as one that refuses nothing, and only the pair distinguishes them.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/branch_mode_gates.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { branchOf, assertBranchAppUrl, HQ_ONLY, HQ_AUTHORING_ONLY } from '../src/util/branch.ts';
import { hydrateSuperAdmin, isSuperAdmin, requireSuperAdmin, requireHqAuthoring } from '../src/auth.ts';
import { securityHeadersMiddleware } from '../src/middleware/securityHeaders.ts';
import { setSecret } from '../src/services/cloudflareSecrets.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 7; // an admin WITH a super_admins row
const PLAIN = 9;  // an admin without one

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
    async batch(x: any[]) { const out: any[] = []; for (const st of x || []) out.push(await st.run().catch(() => ({}))); return out; },
  };
}

/**
 * A database in the state that used to be impossible on a branch and is the
 * only interesting one: an admin account WITH its elevation row present.
 */
function seededDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
  `);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(HOLDER, 'admin', 'Sue', 'sue@axal.example');
  u.run(PLAIN, 'admin', 'Pat', 'pat@axal.example');
  u.run(30, 'founder', 'Fran', 'fran@example.com');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  return db;
}

const HQ_VARS = {
  APP_URL: 'https://axal.vc',
  PUBLIC_BASE_URL: 'https://axal.vc',
  OAUTH_CALLBACK_BASE_URL: 'https://app.axal.vc',
  PUBLIC_MARKETING_URL: 'https://axal.vc',
};
const FR_VARS = {
  BRANCH_CODE: 'fr',
  APP_URL: 'https://fr.axal.vc',
  PUBLIC_BASE_URL: 'https://fr.axal.vc',
  OAUTH_CALLBACK_BASE_URL: 'https://fr.axal.vc',
  PUBLIC_MARKETING_URL: 'https://fr.axal.vc',
};

/**
 * Two routes behind the two new guards, dispatched with a real JWT.
 *
 * Dispatched rather than called directly because `requireSuperAdmin` reaches
 * `getCurrentUser`, which reads the token and the `users` row: a hand-built
 * context object would let the test assert the branch decision while skipping
 * the resolution it is layered on, and a gate that never ran requireAdmin is
 * not the gate that ships.
 */
function guardApp(env: Record<string, unknown>) {
  const app = new Hono<any>();
  app.get('/super', async (c) => c.json({ id: (await requireSuperAdmin(c as any)).id }));
  app.get('/author', async (c) => c.json({ id: (await requireHqAuthoring(c as any)).id }));
  app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 403));
  return async (path: string, userId: number, role = 'admin') => {
    const token = await new SignJWT({ user_id: userId, role })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));
    const res = await app.request(path, { headers: { Authorization: `Bearer ${token}` } }, env);
    return { status: res.status, body: await res.json() as any };
  };
}

test('a super_admins ROW does not make a branch admin a super admin — the deployment decides, not the table', async () => {
  const DB = makeD1(seededDb());

  // HQ: the row means what it has always meant.
  const onHq = await hydrateSuperAdmin({ ...HQ_VARS, DB } as any, { id: HOLDER, role: 'admin' });
  assert.equal(onHq.is_super_admin, 1, 'HQ must still read the elevation row');
  assert.equal(isSuperAdmin(onHq as any), true);

  // The same database, the same row, the same account — on a branch.
  const onBranch = await hydrateSuperAdmin({ ...FR_VARS, DB } as any, { id: HOLDER, role: 'admin' });
  assert.equal(onBranch.is_super_admin, 0, 'a branch must answer 0 with the row PRESENT');
  assert.equal(isSuperAdmin(onBranch as any), false);
});

test('hydrateSuperAdmin does not even read the table on a branch', async () => {
  // A database with no `super_admins` table at all stands in for "the query
  // was never issued": `loadSuperAdminFlag` catches a missing table and
  // answers 0, so a version that still queried would also answer 0 and this
  // assertion would not distinguish them. Counting the reads does.
  const reads: string[] = [];
  const DB = {
    prepare(sql: string) {
      reads.push(sql);
      return { bind: () => ({ first: async () => ({ user_id: 7 }) }) };
    },
  };
  await hydrateSuperAdmin({ ...FR_VARS, DB } as any, { id: HOLDER, role: 'admin' });
  assert.deepEqual(reads, [], 'a branch must not query super_admins at all');

  await hydrateSuperAdmin({ ...HQ_VARS, DB } as any, { id: HOLDER, role: 'admin' });
  assert.equal(reads.length, 1, 'HQ must still issue exactly one keyed lookup');
  assert.match(reads[0], /super_admins/);
});

test('requireSuperAdmin: "HQ only" on a branch, "Super admin required" on HQ without the elevation', async () => {
  const DB = makeD1(seededDb());
  const onBranch = guardApp({ ...FR_VARS, DB, JWT_SECRET, ENVIRONMENT: 'development' });
  const onHq = guardApp({ ...HQ_VARS, DB, JWT_SECRET, ENVIRONMENT: 'development' });

  // On a branch, with the elevation row present, and the message is the one
  // that is TRUE — there is no elevation to be granted here.
  const refused = await onBranch('/super', HOLDER);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.detail, HQ_ONLY, 'a branch must refuse with HQ only');

  // On HQ the elevated holder passes — otherwise the gate above would be
  // indistinguishable from a gate that refuses everyone.
  const passed = await onHq('/super', HOLDER);
  assert.equal(passed.status, 200);
  assert.equal(passed.body.id, HOLDER);

  // On HQ an admin without the row keeps the older, different sentence.
  const plain = await onHq('/super', PLAIN);
  assert.equal(plain.body.detail, 'Super admin required');
});

test('requireHqAuthoring: an HQ admin authors, a branch admin is told where the change goes', async () => {
  const DB = makeD1(seededDb());
  const onBranch = guardApp({ ...FR_VARS, DB, JWT_SECRET, ENVIRONMENT: 'development' });
  const onHq = guardApp({ ...HQ_VARS, DB, JWT_SECRET, ENVIRONMENT: 'development' });

  // Authoring is not an elevation: the UNELEVATED HQ admin authors, which is
  // what distinguishes this gate from requireSuperAdmin above.
  const author = await onHq('/author', PLAIN);
  assert.equal(author.status, 200);
  assert.equal(author.body.id, PLAIN);

  const refused = await onBranch('/author', HOLDER);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.detail, HQ_AUTHORING_ONLY);

  // Not an admin at all is still the older refusal, on both tiers: the new
  // gate layers on requireAdmin, it does not replace it.
  for (const call of [onHq, onBranch]) {
    const founder = await call('/author', 30, 'founder');
    assert.equal(founder.body.detail, 'Admin required');
  }
});

test('both refusals are mapped to 403 by the constant, not by a copy of the sentence', () => {
  // Source-parsed for the reason the map's own comment gives: an entry that
  // is missing does not weaken the gate, it turns a working refusal into a
  // 500. Matching on the CONSTANT NAMES is what makes this survive a reword
  // of either sentence — and fail if someone re-types the string instead.
  //
  // D110 — the table lives in `util/authErrors.ts` now. It was in `index.ts`
  // until a second copy of the same decisions turned up in `mapError`.
  const src = readFileSync(new URL('../src/util/authErrors.ts', import.meta.url), 'utf8');
  const map = src.match(/const AUTH_ERROR_STATUSES[\s\S]*?\n\};/);
  assert.ok(map, 'AUTH_ERROR_STATUSES must still be a single object literal');
  assert.match(map[0], /\[HQ_ONLY\]:\s*403/, 'HQ_ONLY must map to 403 via the constant');
  assert.match(map[0], /\[HQ_AUTHORING_ONLY\]:\s*403/, 'HQ_AUTHORING_ONLY must map to 403 via the constant');
  assert.ok(
    !map[0].includes(`'${HQ_ONLY}'`) && !map[0].includes(`'${HQ_AUTHORING_ONLY}'`),
    'the map must not carry a second, driftable copy of either sentence',
  );
});

test('assertBranchAppUrl: silent on HQ, and names the var that still points at the apex', () => {
  assert.doesNotThrow(() => assertBranchAppUrl(HQ_VARS as any), 'HQ has no BRANCH_CODE and must be untouched');
  assert.doesNotThrow(() => assertBranchAppUrl(FR_VARS as any), 'a correctly generated branch config must pass');

  // Each var, one at a time, so a check that only ever looked at APP_URL fails
  // the other three.
  for (const name of ['APP_URL', 'PUBLIC_BASE_URL', 'OAUTH_CALLBACK_BASE_URL', 'PUBLIC_MARKETING_URL']) {
    assert.throws(
      () => assertBranchAppUrl({ ...FR_VARS, [name]: 'https://axal.vc' } as any),
      new RegExp(`${name} points at axal\\.vc`),
      `${name} left on HQ must be named in the refusal`,
    );
    assert.throws(
      () => assertBranchAppUrl({ ...FR_VARS, [name]: '' } as any),
      new RegExp(`${name} is unset`),
    );
    assert.throws(
      () => assertBranchAppUrl({ ...FR_VARS, [name]: 'fr.axal.vc' } as any),
      new RegExp(`${name} is not a URL`),
      'a bare host is not a URL and must not be read as one',
    );
  }

  // A different branch's host is as wrong as HQ's, and the comparison is
  // against BRANCH_CODE rather than against one var trusting another.
  assert.throws(
    () => assertBranchAppUrl({ ...FR_VARS, APP_URL: 'https://dach.axal.vc' } as any),
    /APP_URL points at dach\.axal\.vc/,
  );
});

test('a branch answers X-Robots-Tag: noindex; HQ sets no such header', async () => {
  const run = async (env: Record<string, unknown>) => {
    const res = new Response('ok');
    const c = { env, req: { path: '/api/health' }, res, set: () => {} } as any;
    await securityHeadersMiddleware()(c, async () => {});
    return res.headers;
  };
  assert.equal((await run(HQ_VARS)).get('x-robots-tag'), null, 'HQ must stay indexable');
  assert.equal((await run(FR_VARS)).get('x-robots-tag'), 'noindex, nofollow');
  // The rest of the posture is unchanged on a branch — the header is added,
  // nothing is traded for it.
  assert.equal((await run(FR_VARS)).get('x-content-type-options'), 'nosniff');
});

test('a branch never promotes an integration key onto HQ\'s script', async () => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }) as any;
  try {
    const creds = { CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'acct' };

    // HQ keeps its fallback: an unset var still means the production script.
    const hq = await setSecret({ ...HQ_VARS, ...creds } as any, 'GOOGLE_CLIENT_SECRET', 'v');
    assert.equal(hq.ok, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/workers\/scripts\/studioos\/secrets$/);

    // A branch with the var unset REFUSES rather than guessing HQ. This is
    // the whole point: the guess would have written a subsidiary's secret
    // onto production, and reported success.
    const guessed = await setSecret({ ...FR_VARS, ...creds } as any, 'GOOGLE_CLIENT_SECRET', 'v');
    assert.equal(guessed.ok, false);
    assert.equal(guessed.code, 'cloudflare_api_token_missing');
    assert.equal(calls.length, 1, 'no request may be made when the script name is unknown');

    // With the var the generator writes, it targets its own script.
    const ok = await setSecret(
      { ...FR_VARS, ...creds, CF_WORKER_SCRIPT_NAME: 'studioos-fr' } as any,
      'GOOGLE_CLIENT_SECRET', 'v',
    );
    assert.equal(ok.ok, true);
    assert.match(calls[1], /\/workers\/scripts\/studioos-fr\/secrets$/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('branchOf is the single reader of BRANCH_CODE across the gates added here', () => {
  // Every gate in this file must route through branchOf, so a malformed code
  // fails loudly everywhere rather than reading as HQ in one place. The
  // constructor for that failure is already pinned in branch_cookies.test.ts;
  // this asserts the gates inherit it.
  const bad = { ...FR_VARS, BRANCH_CODE: 'FR.axal' };
  assert.throws(() => branchOf(bad as any), /not a branch code/);
  assert.throws(() => assertBranchAppUrl(bad as any), /not a branch code/);
});
