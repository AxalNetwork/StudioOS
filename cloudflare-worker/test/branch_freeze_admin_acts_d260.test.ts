/**
 * D260 — a suspended branch stops deciding who gets in. KYC approve and
 * reject, the grant of limited access, Spin-Out Lab admission and the older
 * application decide now answer 423 while HQ has the branch's licence
 * suspended, and leave the row they would have written untouched. Revoking
 * limited access stays open: it is a takedown, and FREEZE_RULE says a
 * takedown still works.
 *
 * THE WHOLE WORKER, the D248 harness: `index.ts` bundled the way Wrangler
 * bundles it, every request through the real `fetch`, on the database the
 * repo's schema story builds (`buildFresh`, the deploy's step 9, D235) — here
 * with the FR branch's vars, because the gate is a no-op anywhere else. The
 * admin holds a TOTP session with a fresh step-up, so the 423 is the freeze
 * and not a missing factor.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/branch_freeze_admin_acts_d260.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { SignJWT } from 'jose';
import { buildFresh, postCutoffMigrations } from '../../scripts/check-baseline-drift.mjs';

const STUB = 'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class RpcTarget {} export class WorkflowEntrypoint {} export const env = {};';
const out = join(mkdtempSync(join(tmpdir(), 'd260-')), 'worker.mjs');
await build({
  entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
  mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'import'],
  plugins: [{
    name: 'workers-shims',
    setup(b) {
      b.onResolve({ filter: /^cloudflare:/ }, (a) => ({ path: a.path, namespace: 'cf-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'cf-stub' }, () => ({ contents: STUB, loader: 'js' }));
      b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: join(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }));
      b.onLoad({ filter: /.*/, namespace: 'raw' }, async (a) => ({
        contents: readFileSync(a.path, 'utf8'), loader: 'text',
      }));
    },
  }],
  external: ['node:*'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const worker = (await import(pathToFileURL(out).href)).default;

const ROOT = process.cwd();
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const LATER = (postCutoffMigrations(ROOT) as Array<{ sql: string }>).map((m) => m.sql);

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1;    // the branch's admin
const FOUNDER = 5;  // an account on the branch awaiting decisions
const APP_ID = 40;  // FOUNDER's pending Lab application
const MEMBER = 9;   // a signed-in account on the branch that is not an admin

const FR_VARS = {
  BRANCH_CODE: 'fr', APP_URL: 'https://fr.axal.vc', PUBLIC_BASE_URL: 'https://fr.axal.vc',
  OAUTH_CALLBACK_BASE_URL: 'https://fr.axal.vc', PUBLIC_MARKETING_URL: 'https://fr.axal.vc',
};
const HQ_VARS = {
  APP_URL: 'https://axal.vc', PUBLIC_BASE_URL: 'https://axal.vc',
  OAUTH_CALLBACK_BASE_URL: 'https://app.axal.vc', PUBLIC_MARKETING_URL: 'https://axal.vc',
};

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
type DB = ReturnType<typeof buildFresh>;
function makeD1(db: DB) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return (db.prepare(sql).get(...b) as any) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async raw() { return (db.prepare(sql).all(...b) as any[]).map((r) => Object.values(r)); },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(stmts: any[]) { const outs: any[] = []; for (const s of stmts) outs.push(await s.run()); return outs; },
  };
}

/**
 * `licence` is the branch's copy of its licence status, as HQ pushed it; null
 * leaves the copy absent (a branch HQ has not pushed to yet).
 */
function freshDb(licence: 'suspended' | 'active' | null): DB {
  const db = buildFresh(BASELINE, LATER, { dqs: true });
  db.exec('PRAGMA foreign_keys = OFF;');
  db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(ADMIN, 'admin', 'Aline Admin', 'aline@fr.example');
  db.prepare(
    `INSERT INTO users (id, role, name, email, is_active, kyc_status, kyc_submitted_at)
     VALUES (?, 'founder', 'Fleur Founder', 'fleur@fr.example', 1, 'pending', datetime('now', '-2 days'))`,
  ).run(FOUNDER);
  db.prepare(
    // On the Studio tier, so the studio middleware lets her through to the
    // handler rather than answering 402 before either gate is reached.
    `INSERT INTO users (id, role, name, email, is_active, kyc_status, subscription_tier, subscription_status)
     VALUES (?, 'founder', 'Maud Member', 'maud@fr.example', 1, 'approved', 'studio', 'active')`,
  ).run(MEMBER);
  db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at)
     VALUES ('totp-9', ?, 'totp', datetime('now'), datetime('now'))`,
  ).run(MEMBER);
  db.prepare(
    `INSERT INTO spinout_applications (id, user_id, company_name, idea, cohort, status)
     VALUES (?, ?, 'Fleur Labs', 'Soil sensors for vineyards', 'Cohort 5', 'pending')`,
  ).run(APP_ID, FOUNDER);
  // A TOTP session with a step-up this minute: the KYC verdicts ask for one,
  // and without it a refusal here would be the step-up, not the freeze.
  db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at)
     VALUES ('totp-1', ?, 'totp', datetime('now'), datetime('now'))`,
  ).run(ADMIN);
  if (licence) {
    db.prepare(
      `INSERT INTO branch_licence (id, licence_uid, territory, status, suspended_at, suspended_note, pushed_at)
       VALUES (1, 'lic-fr-test', 'FR', ?, ?, ?, datetime('now', '-4 days'))`,
    ).run(licence, licence === 'suspended' ? '2026-09-20 09:00:00' : null,
      licence === 'suspended' ? 'payment default, 41 days' : null);
  }
  return db;
}

function makeEnv(db: DB, vars: Record<string, string>) {
  const kv = new Map<string, string>();
  return {
    JWT_SECRET, ENVIRONMENT: 'development',
    DB: makeD1(db),
    RATE_LIMITS: {
      async get(k: string) { return kv.get(k) ?? null; },
      async put(k: string, v: string) { kv.set(k, v); },
      async delete(k: string) { kv.delete(k); },
    },
    ...vars,
  } as any;
}

async function jwtFor(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: userId === ADMIN ? 'admin' : 'founder', jti: `totp-${userId}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function req(
  env: any, method: string, path: string, body?: Record<string, unknown>, signedIn = true, as = ADMIN,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (signedIn) headers.Authorization = `Bearer ${await jwtFor(as)}`;
  if (body) headers['content-type'] = 'application/json';
  const silence = ['info', 'warn', 'error', 'log'].map((k) => mock.method(console, k as any, () => {}));
  try {
    const waits: Promise<unknown>[] = [];
    const ctx: any = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} };
    const host = env.BRANCH_CODE ? 'https://fr.axal.vc' : 'https://axal.vc';
    const res = await worker.fetch(
      new Request(`${host}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }),
      env, ctx,
    );
    await Promise.allSettled(waits);
    let parsed: any = null;
    try { parsed = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: parsed };
  } finally {
    silence.forEach((m) => m.mock.restore());
  }
}

/** The five writes D260 gates: what each sends, and what it would change. */
const ACTS: Array<{ name: string; method: string; path: string; body: Record<string, unknown> }> = [
  { name: 'KYC approve', method: 'PATCH', path: `/api/kyc/admin/${FOUNDER}/approve`, body: {} },
  { name: 'KYC reject', method: 'PATCH', path: `/api/kyc/admin/${FOUNDER}/reject`, body: { reason: 'The document is unreadable; please resubmit' } },
  { name: 'limited-access grant', method: 'PATCH', path: `/api/admin/users/${FOUNDER}/access-level`, body: { level: 'limited' } },
  { name: 'Lab admission', method: 'POST', path: `/api/admin/users/${FOUNDER}/spinout-admit`, body: { cohort: 'Cohort 5' } },
  { name: 'application decide', method: 'POST', path: `/api/admin/spinout-applications/${APP_ID}/decide`, body: { decision: 'accepted' } },
];

/** Everything any of the five could write, read back whole. */
function snapshot(db: DB) {
  return JSON.stringify({
    user: db.prepare('SELECT * FROM users WHERE id = ?').get(FOUNDER),
    flags: db.prepare('SELECT * FROM user_spinout_flags WHERE user_id = ?').all(FOUNDER),
    app: db.prepare('SELECT * FROM spinout_applications WHERE id = ?').get(APP_ID),
    cohort: db.prepare('SELECT * FROM cohort_applicants WHERE application_id = ?').all(APP_ID),
  });
}

/* ------------------------------------------------------------------ *
 * 1. Suspended: each of the five is refused, and nothing is written   *
 * ------------------------------------------------------------------ */

for (const act of ACTS) {
  test(`D260: on a suspended branch, the ${act.name} answers 423 branch_suspended and writes nothing`, async () => {
    const db = freshDb('suspended');
    const env = makeEnv(db, FR_VARS);
    const before = snapshot(db);
    const r = await req(env, act.method, act.path, act.body);
    assert.equal(r.status, 423, `the ${act.name} was not frozen: ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(r.body?.code, 'branch_suspended', `the 423 was not the branch freeze: ${JSON.stringify(r.body)}`);
    assert.equal(snapshot(db), before, `the ${act.name} was refused but still changed the account`);
  });
}

/* ------------------------------------------------------------------ *
 * 2. Active: the same five go through                                 *
 * ------------------------------------------------------------------ */

test('D260: on an active branch, all five writes go through and land', async () => {
  const expected: Record<string, (db: DB) => void> = {
    'KYC approve': (db) => assert.equal((db.prepare('SELECT kyc_status FROM users WHERE id = ?').get(FOUNDER) as any).kyc_status, 'approved'),
    'KYC reject': (db) => assert.equal((db.prepare('SELECT kyc_status FROM users WHERE id = ?').get(FOUNDER) as any).kyc_status, 'rejected'),
    'limited-access grant': (db) => assert.equal((db.prepare('SELECT access_level FROM users WHERE id = ?').get(FOUNDER) as any).access_level, 'limited'),
    'Lab admission': (db) => assert.equal(Number((db.prepare('SELECT spinout_lab_admitted FROM user_spinout_flags WHERE user_id = ?').get(FOUNDER) as any)?.spinout_lab_admitted), 1),
    'application decide': (db) => assert.equal((db.prepare('SELECT status FROM spinout_applications WHERE id = ?').get(APP_ID) as any).status, 'accepted'),
  };
  for (const act of ACTS) {
    // Each on its own database: approve and reject cannot both land on one row.
    const db = freshDb('active');
    const r = await req(makeEnv(db, FR_VARS), act.method, act.path, act.body);
    assert.equal(r.status, 200, `the ${act.name} was refused on an active branch: ${r.status} ${JSON.stringify(r.body)}`);
    expected[act.name](db);
  }
});

/* ------------------------------------------------------------------ *
 * 3. Anonymous: 401, never the licence state                           *
 * ------------------------------------------------------------------ */

test('D260: an anonymous caller gets 401 from all five on a suspended branch, never a 423 that would tell them the licence state', async () => {
  for (const act of ACTS) {
    const db = freshDb('suspended');
    const before = snapshot(db);
    const r = await req(makeEnv(db, FR_VARS), act.method, act.path, act.body, false);
    assert.equal(r.status, 401, `the ${act.name} answered ${r.status} to nobody — the freeze gate ran before the admin gate`);
    assert.notEqual(r.body?.code, 'branch_suspended');
    assert.equal(snapshot(db), before);
  }
});

test('D260: a signed-in account that is not an admin is refused as a non-admin on all five, never with the licence state', async () => {
  // The anonymous case above cannot see the order on the KYC routes: the
  // cool-off and studio middlewares in index.ts answer 401 before the handler
  // runs. A signed-in member passes both and reaches the handler, so this is
  // the case that tells "admin gate, then freeze" from the reverse everywhere.
  for (const act of ACTS) {
    const db = freshDb('suspended');
    const before = snapshot(db);
    const r = await req(makeEnv(db, FR_VARS), act.method, act.path, act.body, true, MEMBER);
    assert.notEqual(r.status, 423, `the ${act.name} told a non-admin the branch is suspended — the freeze gate ran before the admin gate`);
    assert.ok(r.status === 401 || r.status === 403, `the ${act.name} answered a non-admin ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(snapshot(db), before);
  }
});

/* ------------------------------------------------------------------ *
 * 4. HQ: the gate is a no-op there                                    *
 * ------------------------------------------------------------------ */

test('D260: HQ is not frozen by a suspended licence row — the gate is a no-op without a branch code', async () => {
  for (const act of ACTS) {
    // The row is there on purpose: HQ must ignore it rather than lack it.
    const db = freshDb('suspended');
    const r = await req(makeEnv(db, HQ_VARS), act.method, act.path, act.body);
    assert.equal(r.status, 200, `HQ's ${act.name} was frozen: ${r.status} ${JSON.stringify(r.body)}`);
  }
});

/* ------------------------------------------------------------------ *
 * 5. The takedown stays open                                          *
 * ------------------------------------------------------------------ */

test('D260: revoking limited access still works on a suspended branch — it is a takedown', async () => {
  const db = freshDb('suspended');
  db.prepare("UPDATE users SET access_level = 'limited' WHERE id = ?").run(FOUNDER);
  const r = await req(makeEnv(db, FR_VARS), 'PATCH', `/api/admin/users/${FOUNDER}/access-level`, { level: null });
  assert.equal(r.status, 200, `the revoke was frozen: ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.body?.access_level, null);
  assert.equal((db.prepare('SELECT access_level FROM users WHERE id = ?').get(FOUNDER) as any).access_level, null,
    'the revoke answered 200 and left the account with limited access');
});

test('D260: a branch whose licence copy has not arrived is not frozen (D107: suspension is a claim HQ makes)', async () => {
  const db = freshDb(null);
  const r = await req(makeEnv(db, FR_VARS), 'PATCH', `/api/admin/users/${FOUNDER}/access-level`, { level: 'limited' });
  assert.equal(r.status, 200, `a branch with no licence copy was frozen: ${r.status} ${JSON.stringify(r.body)}`);
});

/* ------------------------------------------------------------------ *
 * 6. The search half: HQ can see which state an account is in         *
 * ------------------------------------------------------------------ */

test('D260: the branch account search carries KYC, access and Lab state, read as stored, on the schema the deploy builds', async () => {
  const { branchSearchAccounts } = await import('../src/rpc/branchOps.ts');
  const db = freshDb('active');
  // 6: admitted and running in the Lab, with limited access; 8: a KYC state
  // nobody recorded. 5 (pending KYC, no flags row) comes from freshDb.
  db.prepare(
    `INSERT INTO users (id, role, name, email, is_active, kyc_status, access_level, spinout_lab_active)
     VALUES (6, 'founder', 'Fleur Second', 'fleur2@fr.example', 1, 'approved', 'limited', 1)`,
  ).run();
  db.prepare('INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted) VALUES (6, 1)').run();
  db.prepare(
    `INSERT INTO users (id, role, name, email, is_active, kyc_status)
     VALUES (8, 'founder', 'Fleur Third', 'fleur3@fr.example', 1, NULL)`,
  ).run();
  const r: any = await branchSearchAccounts(makeEnv(db, FR_VARS), 'fleur');
  const by = Object.fromEntries(r.results.map((h: any) => [h.id, h]));
  assert.deepEqual(Object.keys(by).map(Number).sort(), [5, 6, 8]);

  assert.equal(by[5].kyc_status, 'pending');
  assert.equal(by[5].access_level, null);
  assert.equal(Number(by[5].spinout_lab_active), 0);
  // Strict: a missing flags row must arrive as the table's own default, 0 —
  // not as NULL, which `Number()` would quietly have turned into the same.
  assert.strictEqual(by[5].spinout_lab_admitted, 0, 'no flags row is "never admitted", the table\'s own default');

  assert.equal(by[6].kyc_status, 'approved');
  assert.equal(by[6].access_level, 'limited');
  assert.equal(Number(by[6].spinout_lab_active), 1);
  assert.equal(Number(by[6].spinout_lab_admitted), 1);

  assert.equal(by[8].kyc_status, null, 'an unrecorded KYC state must stay null, not become "not_started"');
});

/* ------------------------------------------------------------------ *
 * 7. The decide's role read, now used                                 *
 * ------------------------------------------------------------------ */

test('D260: the application decide will not admit an applicant who is now an admin, and can still refuse one', async () => {
  // /apply takes founders and explorers only; a role can change while the
  // application waits. spinout-admit refuses an admin, so the decide must too.
  const db = freshDb('active');
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(FOUNDER);
  const before = snapshot(db);
  const accepted = await req(makeEnv(db, FR_VARS), 'POST', `/api/admin/spinout-applications/${APP_ID}/decide`, { decision: 'accepted' });
  assert.equal(accepted.status, 400, `an admin was admitted through the decide: ${accepted.status} ${JSON.stringify(accepted.body)}`);
  assert.equal(snapshot(db), before, 'the refused acceptance still wrote');

  const refused = await req(makeEnv(db, FR_VARS), 'POST', `/api/admin/spinout-applications/${APP_ID}/decide`, { decision: 'refused' });
  assert.equal(refused.status, 200, `refusing the admin's application was blocked: ${refused.status} ${JSON.stringify(refused.body)}`);
  assert.equal((db.prepare('SELECT status FROM spinout_applications WHERE id = ?').get(APP_ID) as any).status, 'refused');
});
