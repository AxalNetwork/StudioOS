/**
 * D107 — what a suspended branch stops doing, and what it must keep doing.
 *
 * HQ suspends a licence; the branch's DECISION writes freeze and answer 423.
 * Reads do not freeze: a frozen branch can still see its queue, which is what
 * the banner is about, and a gate that closed the reads would have made the
 * suspension unappealable from inside the product.
 *
 * TWO KINDS OF ASSERTION, and the split is deliberate.
 *
 *   1. BEHAVIOURAL — the gate itself, dispatched through a real Hono app with
 *      a real JWT and a real (node:sqlite) D1, in all four states that matter:
 *      suspended, active, no row yet, and HQ. A hand-built context would let
 *      the branch decision be asserted while skipping the resolution it sits
 *      on, which is the failure `branch_mode_gates.test.ts` records.
 *
 *   2. STRUCTURAL — that each of the four approval route files actually calls
 *      it, AFTER its own admin gate. The four have four different routers and
 *      no shared write helper, so there is no single place a behavioural test
 *      could cover them from; the ordering matters because a suspension check
 *      that ran first would answer 423 to an anonymous caller and leak the
 *      branch's licence state to anyone who could reach the URL.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/branch_suspended_freeze.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { BRANCH_SUSPENDED } from '../src/util/branch.ts';
import { requireAdmin, requireBranchNotSuspended } from '../src/auth.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 7;

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
        async run() { db.prepare(sql).run(...b); return { meta: {} }; },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
  };
}

/**
 * `status` null means the branch_licence TABLE is absent — a branch whose
 * migration 256/257 has not run, or one HQ has not pushed to yet.
 */
function dbWith(status: string | null) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
  `);
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)')
    .run(ADMIN, 'admin', 'Sue', 'sue@axal.example');
  if (status !== null) {
    db.exec('CREATE TABLE branch_licence (id INTEGER PRIMARY KEY, status TEXT NOT NULL)');
    db.prepare('INSERT INTO branch_licence (id, status) VALUES (1, ?)').run(status);
  }
  return db;
}

const HQ_VARS = {
  APP_URL: 'https://axal.vc', PUBLIC_BASE_URL: 'https://axal.vc',
  OAUTH_CALLBACK_BASE_URL: 'https://app.axal.vc', PUBLIC_MARKETING_URL: 'https://axal.vc',
};
const FR_VARS = {
  BRANCH_CODE: 'fr', APP_URL: 'https://fr.axal.vc', PUBLIC_BASE_URL: 'https://fr.axal.vc',
  OAUTH_CALLBACK_BASE_URL: 'https://fr.axal.vc', PUBLIC_MARKETING_URL: 'https://fr.axal.vc',
};

/**
 * A decide-shaped route: admin gate, then the freeze gate, then the write —
 * the exact order the four real handlers use. The error handler maps the
 * refusal the way `index.ts`'s `AUTH_ERROR_STATUSES` does, and the map's own
 * entry is pinned separately below so this shim cannot drift from it quietly.
 */
function decideApp(env: Record<string, unknown>) {
  const app = new Hono<any>();
  app.post('/decide', async (c) => {
    const admin = await requireAdmin(c as any);
    await requireBranchNotSuspended(c as any);
    return c.json({ decided_by: admin.id });
  });
  app.onError((err: any, c) => {
    const msg = String(err?.message || '');
    if (msg === BRANCH_SUSPENDED) return c.json({ detail: msg }, 423);
    if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
    return c.json({ detail: msg }, 403);
  });
  return async (userId: number | null, role = 'admin') => {
    const headers: Record<string, string> = {};
    if (userId !== null) {
      const token = await new SignJWT({ user_id: userId, role })
        .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
        .sign(new TextEncoder().encode(JWT_SECRET));
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await app.request('/decide', { method: 'POST', headers }, env);
    return { status: res.status, body: await res.json() as any };
  };
}

const envFor = (vars: object, status: string | null) => ({
  ...vars, DB: makeD1(dbWith(status)), JWT_SECRET, ENVIRONMENT: 'development',
});

test('a suspended branch refuses a decision write with 423', async () => {
  const post = decideApp(envFor(FR_VARS, 'suspended'));
  const r = await post(ADMIN);
  assert.equal(r.status, 423, 'a frozen queue is Locked, not Forbidden');
  assert.equal(r.body.detail, BRANCH_SUSPENDED);
});

test('an ACTIVE branch decides normally — the gate is not a blanket refusal', async () => {
  // The other half of the pair, and the half that catches a gate which
  // refuses everything. Without it, `return throw` would pass the test above.
  const post = decideApp(envFor(FR_VARS, 'active'));
  const r = await post(ADMIN);
  assert.equal(r.status, 200);
  assert.equal(r.body.decided_by, ADMIN);
});

test('a branch HQ has not pushed a licence to is not frozen', async () => {
  // `status: null` = no `branch_licence` table at all. Inferring suspension
  // from an unreadable copy would freeze every branch in the window between
  // bootstrap and the first push — precisely when its principal is working.
  const post = decideApp(envFor(FR_VARS, null));
  const r = await post(ADMIN);
  assert.equal(r.status, 200, 'an unreadable copy must read as NOT suspended');
});

test('HQ is unaffected, even with a suspended row sitting in the table', async () => {
  // The gate keys on the DEPLOYMENT, not on the row: HQ has no licence above
  // it to be suspended, so a stray row must change nothing there.
  const post = decideApp(envFor(HQ_VARS, 'suspended'));
  const r = await post(ADMIN);
  assert.equal(r.status, 200);
});

test('the freeze gate never authenticates — an anonymous caller still gets 401', async () => {
  // If this returned 423, the branch's licence state would be readable by
  // anyone who could reach the URL. It is 401 because the admin gate runs
  // first, which is the ordering the structural test below pins in the four
  // real files.
  const post = decideApp(envFor(FR_VARS, 'suspended'));
  const r = await post(null);
  assert.equal(r.status, 401);
});

test('the shared table maps the refusal to 423, off the shared constant', () => {
  // D110 — the table moved from `index.ts` to `util/authErrors.ts`, because a
  // second copy of the same decisions was found in `mapError`. What it
  // promises is unchanged; where it lives is not.
  const src = read('cloudflare-worker/src/util/authErrors.ts');
  // The computed key, not a second copy of the sentence — the drift that
  // turned "Super admin required" into a 500 before it had an entry.
  assert.match(src, /\[BRANCH_SUSPENDED\]:\s*423/);
  assert.ok(
    !src.includes(`'${BRANCH_SUSPENDED}':`),
    'the map must key off the constant, never a literal copy of its text',
  );
  // The map's type has to admit 423 or the entry above does not compile.
  assert.match(src, /AUTH_ERROR_STATUSES: Record<string, [^>]*423[^>]*>/);
});

test('all four approval files gate their decision write, after the admin gate', () => {
  const FILES = [
    'cloudflare-worker/src/routes/admin_lp_applications.ts',
    'cloudflare-worker/src/routes/refer_earn.ts',
    'cloudflare-worker/src/routes/admin_cohort.ts',
    'cloudflare-worker/src/routes/spinout_moderation.ts',
  ];
  for (const f of FILES) {
    const src = read(f);
    const gate = src.indexOf('await requireBranchNotSuspended(c)');
    assert.ok(gate > 0, `${f} must call the freeze gate on its decision write`);

    // The admin gate must come first WITHIN THE SAME HANDLER, which is why
    // this slices the handler out rather than comparing file offsets: these
    // files register several routes, so an admin gate belonging to an EARLIER
    // handler sits before this one no matter where the freeze gate is put,
    // and a whole-file index comparison passes even when the two are
    // reversed. Mutation-checked by swapping the pair in admin_cohort.ts: the
    // file-offset version did not notice.
    const open = Math.max(
      ...['.post(', '.patch(', '.put(', '.delete('].map((m) => src.lastIndexOf(m, gate)),
    );
    assert.ok(open > 0 && open < gate, `${f}: could not locate the handler around the freeze gate`);
    const handler = src.slice(open, gate);
    // Both admin shapes are accepted because spinout_moderation uses
    // requireAuth plus an explicit role check rather than requireAdmin — a
    // real difference, not one to paper over.
    assert.ok(
      handler.includes('await requireAdmin(c)') || handler.includes("admin.role !== 'admin'"),
      `${f}: the admin gate must run BEFORE the freeze gate in the same handler, `
      + 'or an anonymous caller learns the licence state',
    );
    assert.match(src, /requireBranchNotSuspended[^\n]*from '\.\.\/auth'|requireBranchNotSuspended[,}]/);
  }
});
