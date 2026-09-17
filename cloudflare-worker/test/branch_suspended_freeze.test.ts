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
import { ADMIN_FROZEN, BRANCH_SUSPENDED_CODE, branchSuspendedBody } from '../src/util/authErrors.ts';
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
function dbWith(status: string | null, opts: { withReason?: boolean } = {}) {
  // D142 — `withReason` defaults TRUE because migration 256 has those columns
  // and a fixture narrower than the schema cannot fail on the shape production
  // actually has. The narrow variant exists for exactly one test below, which
  // proves the freeze survives without them.
  const withReason = opts.withReason !== false;
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
    db.exec(
      'CREATE TABLE branch_licence (id INTEGER PRIMARY KEY, status TEXT NOT NULL'
      + (withReason ? ', suspended_at TEXT, suspended_note TEXT' : '') + ')',
    );
    if (withReason) {
      db.prepare(
        'INSERT INTO branch_licence (id, status, suspended_at, suspended_note) VALUES (1, ?, ?, ?)',
      ).run(status, '2026-07-18 11:40:00', 'payment default, 41 days');
    } else {
      db.prepare('INSERT INTO branch_licence (id, status) VALUES (1, ?)').run(status);
    }
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
    // D142 — THE SHIM CALLS THE REAL BODY BUILDER, it does not imitate one.
    // It used to hand-build `{detail: msg}`, under a comment promising it
    // could not drift from the production mapping — and the moment the branch
    // refusal grew a `code`, it had. A stand-in that reimplements the thing it
    // stands in for is a second implementation with a test pointed at the
    // wrong one. The structural test below pins that BOTH real mappers
    // (`index.ts` and `mapError`) route through this same function.
    if (msg === BRANCH_SUSPENDED) return c.json(branchSuspendedBody(err), 423);
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

/** The same env, on a licence copy that predates migration 256's reason columns. */
const envNarrow = (vars: object, status: string | null) => ({
  ...vars, DB: makeD1(dbWith(status, { withReason: false })), JWT_SECRET, ENVIRONMENT: 'development',
});

test('a suspended branch refuses a decision write with 423', async () => {
  const post = decideApp(envFor(FR_VARS, 'suspended'));
  const r = await post(ADMIN);
  assert.equal(r.status, 423, 'a frozen queue is Locked, not Forbidden');
  assert.equal(r.body.detail, BRANCH_SUSPENDED);
});

test('the refusal carries a machine-readable code, and HQ\u2019s own reason (D142)', async () => {
  // WHY THIS IS THE LOAD-BEARING ONE. Until D142 the branch freeze shipped as
  // `423 {detail}` and nothing else, while `frontend/src/lib/api.js` keys
  // STRICTLY on `code === 'admin_frozen'` for its HQ twin. So the branch 423
  // reached no handler and fell through to whatever generic error the page
  // printed — which is why three places in the repo could claim the
  // frozen-branch banner had shipped when there was nothing on the wire to key
  // it on.
  const post = decideApp(envFor(FR_VARS, 'suspended'));
  const r = await post(ADMIN);
  assert.equal(r.status, 423);
  assert.equal(r.body.code, BRANCH_SUSPENDED_CODE, 'the shell keys on this, not on the prose');
  assert.notEqual(r.body.code, ADMIN_FROZEN, 'the branch freeze is not the HQ freeze wearing its code');
  // HQ's own words, pushed with the licence — not this worker's paraphrase.
  assert.equal(r.body.reason, 'payment default, 41 days');
  assert.equal(r.body.since, '2026-07-18 11:40:00');
});

test('an unreadable REASON does not unfreeze the branch (D142)', async () => {
  // The hole the first draft had, kept as a test rather than as a memory. It
  // selected `status, suspended_at, suspended_note` in one statement; on a
  // copy narrower than migration 256 that throws `no such column`, the catch
  // read it as "unreadable, so not suspended", and a suspended branch went on
  // trading. The decision is made on `status` alone and the reason is fetched
  // after, so a branch that cannot say WHY is still frozen.
  const post = decideApp(envNarrow(FR_VARS, 'suspended'));
  const r = await post(ADMIN);
  assert.equal(r.status, 423, 'a missing reason column must never lift the freeze');
  assert.equal(r.body.code, BRANCH_SUSPENDED_CODE);
  assert.equal(r.body.reason, null, 'and the absence is stated, never invented');
  assert.equal(r.body.since, null);
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

test('BOTH production error paths build the refusal from the shared function', () => {
  // There are two, and D110/D134 record what happens when they disagree:
  // `app.onError` for routes that let a throw escape, and `mapError` for the
  // 31 route files that catch their own. A body added to one and not the other
  // is a refusal that changes shape depending on which file raised it.
  for (const f of [
    'cloudflare-worker/src/index.ts',
    'cloudflare-worker/src/routes/_t13t14t15_helpers.ts',
  ]) {
    const src = read(f);
    assert.match(
      src, /if \(msg === BRANCH_SUSPENDED\) return c\.json\(branchSuspendedBody\(\w+\), 423\)/,
      `${f} must map the branch freeze through branchSuspendedBody, not a literal object`,
    );
  }
});

test('every gated write sits AFTER its own admin gate, in every file', () => {
  // D142 — this used to read `indexOf`, which finds the FIRST gate in a file
  // and stops. That was fine while every file had exactly one; the community
  // files now have two and four, so a second gate placed before its admin
  // check would have gone unexamined. It walks every occurrence now.
  const FILES = [
    // D107 — the four approval lanes.
    'cloudflare-worker/src/routes/admin_lp_applications.ts',
    'cloudflare-worker/src/routes/refer_earn.ts',
    'cloudflare-worker/src/routes/admin_cohort.ts',
    'cloudflare-worker/src/routes/spinout_moderation.ts',
    // D142 — the community publish-and-promote writes.
    'cloudflare-worker/src/routes/admin_events.ts',
    'cloudflare-worker/src/routes/admin_jobs.ts',
    'cloudflare-worker/src/routes/admin_circles.ts',
  ];
  let checked = 0;
  for (const f of FILES) {
    const src = read(f);
    const gates: number[] = [];
    for (let at = src.indexOf('await requireBranchNotSuspended(c)'); at > 0;
      at = src.indexOf('await requireBranchNotSuspended(c)', at + 1)) gates.push(at);
    assert.ok(gates.length > 0, `${f} must call the freeze gate on its guarded writes`);

    for (const gate of gates) {
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
      assert.ok(open > 0 && open < gate, `${f}: could not locate the handler around a freeze gate`);
      const handler = src.slice(open, gate);
      // Three admin shapes are accepted because the files genuinely differ:
      // `requireAdmin`, spinout_moderation's explicit role check, and the
      // community files' `admin(c)` helper which returns a Response. Papering
      // over that difference would weaken the assertion, not simplify it.
      assert.ok(
        handler.includes('await requireAdmin(c)')
        || handler.includes("admin.role !== 'admin'")
        || /const a = await admin\(c\);\s*\n\s*if \(a instanceof Response\) return a;/.test(handler),
        `${f}: the admin gate must run BEFORE the freeze gate in the same handler, `
        + 'or an anonymous caller learns the licence state',
      );
      checked += 1;
    }
    assert.match(src, /requireBranchNotSuspended[^\n]*from '\.\.\/auth'|requireBranchNotSuspended[,}]/);
  }
  // A floor, so deleting gates cannot quietly shrink what this covers.
  assert.ok(checked >= 11, `only ${checked} gated writes were examined; the four lanes plus seven community writes is 11`);
});

test('a suspended branch can still TAKE DOWN what it published', () => {
  // THE RULE, ASSERTED FROM BOTH SIDES. A freeze that also froze removal would
  // trap a branch with content under its own brand that it cannot pull — worse
  // than the freeze it implements, and not what the canvas asks for
  // ("Existing pages stay up"). So the takedowns must NOT carry the gate.
  const cases: Array<[string, string[]]> = [
    ['cloudflare-worker/src/routes/admin_events.ts',
      ["adminEvents.post('/:id/reject'", "adminEvents.post('/:id/unpublish'",
        "adminEvents.post('/:id/cancel'", "adminEvents.post('/:id/capacity'"]],
    ['cloudflare-worker/src/routes/admin_jobs.ts',
      ["adminJobs.post('/:id/reject'", "adminJobs.post('/:id/unpublish'"]],
    ['cloudflare-worker/src/routes/admin_circles.ts',
      ["adminCircles.post('/:id/unpublish'", "adminCircles.delete('/:id'"]],
  ];
  for (const [f, handlers] of cases) {
    const src = read(f);
    for (const h of handlers) {
      const at = src.indexOf(h);
      assert.ok(at > 0, `${f}: ${h} not found — this list is stale`);
      // Bounded to this handler: the next route registration ends it.
      const next = ['.post(', '.patch(', '.put(', '.delete(']
        .map((m) => src.indexOf(m, at + h.length))
        .filter((n) => n > 0);
      const body = src.slice(at, next.length ? Math.min(...next) : src.length);
      assert.ok(
        !body.includes('requireBranchNotSuspended'),
        `${f}: ${h} is a TAKEDOWN and must not be frozen — a branch that cannot `
        + 'remove its own published content is worse off than one that cannot publish',
      );
    }
  }
});
