/**
 * D985 (#2777, part 4 of #2376) — a branch runs only the programs its licence
 * holds. Each grant-dependent admin write on a branch reads the branch's copy
 * of its grants (D984) and refuses, naming the program, when the licence does
 * not hold it, holds it paused or ended, or holds it outside its dates.
 * Rejections, takedowns and annotations stay open, HQ is never limited, and
 * the refusal comes after the admin gate and the freeze.
 *
 * THE WHOLE WORKER, D260's harness: `index.ts` bundled the way Wrangler
 * bundles it, every request through the real `fetch`, on the database the
 * repo's schema story builds (`buildFresh`), with the FR branch's vars.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/program_enforcement_d985.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { SignJWT } from 'jose';
import { buildFresh, postCutoffMigrations } from '../../scripts/check-baseline-drift.mjs';

const STUB = 'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class RpcTarget {} export class WorkflowEntrypoint {} export const env = {};';
const out = join(mkdtempSync(join(tmpdir(), 'd985-')), 'worker.mjs');
await build({
  entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
  // D711 — the legal paper's faces and mark, as wrangler.toml's `Data` rule bundles them.
  loader: { '.woff2': 'binary', '.png': 'binary' }, target: 'node22',
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
test.after(() => rmSync(dirname(out), { recursive: true, force: true }));

const ROOT = process.cwd();
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const LATER = (postCutoffMigrations(ROOT) as Array<{ sql: string }>).map((m) => m.sql);

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1;    // the branch's admin
const FOUNDER = 5;  // an account on the branch with a pending Lab application
const APP_ID = 40;  // FOUNDER's application
const MEMBER = 9;   // a signed-in account on the branch that is not an admin
const PERK = 'perk-in-review';

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

// The schema is built once and replayed per test, in memory: a hundred fresh
// builds of every migration would take the suite past its time limit.
const TEMPLATE = buildFresh(BASELINE, LATER, { dqs: true });
const OBJECTS = TEMPLATE.prepare(
  "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
).all() as Array<{ type: string; name: string; sql: string }>;
const SEEDS = OBJECTS.filter((o) => o.type === 'table').map((o) => ({
  name: o.name, rows: TEMPLATE.prepare(`SELECT * FROM "${o.name}"`).all() as Array<Record<string, any>>,
})).filter((t) => t.rows.length > 0);
function schemaCopy(): DB {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }) as DB;
  for (const o of OBJECTS) if (o.type === 'table') db.exec(o.sql);
  for (const t of SEEDS) {
    const cols = Object.keys(t.rows[0]);
    const ins = db.prepare(`INSERT INTO "${t.name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
    for (const r of t.rows) ins.run(...cols.map((c) => r[c]));
  }
  for (const o of OBJECTS) if (o.type !== 'table') db.exec(o.sql);
  return db;
}
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

type Copy = string | null | undefined;

/** A copy as D984 pushes it: grant rows and HQ's offered switches. */
function copyOf(grants: Array<Record<string, unknown>>, offered: Record<string, boolean> = {}): string {
  return JSON.stringify({ grants, offered });
}
/** A grant in force: granted, schedule signed, no dates. */
const inForce = (program_key: string, extra: Record<string, unknown> = {}) =>
  ({ uid: `g-${program_key}`, program_key, state: 'granted', schedule_signed_at: '2026-09-01 10:00:00', ...extra });
const ALL_HELD = copyOf(['spinout-lab', 'mentor-cohorts', 'refer-and-earn', 'perks'].map((k) => inForce(k)));
const NONE_HELD = copyOf([]);

/**
 * `licence` is the branch's copy of its licence status; null leaves the row
 * absent. `programs` is `program_grants_json`: undefined or null leaves it SQL
 * NULL (HQ has not pushed programs yet).
 */
function freshDb(licence: 'suspended' | 'active' | null, programs?: Copy): DB {
  const db = schemaCopy();
  db.exec('PRAGMA foreign_keys = OFF;');
  db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(ADMIN, 'admin', 'Aline Admin', 'aline@fr.example');
  db.prepare(
    `INSERT INTO users (id, role, name, email, is_active, kyc_status)
     VALUES (?, 'founder', 'Fleur Founder', 'fleur@fr.example', 1, 'approved')`,
  ).run(FOUNDER);
  db.prepare(
    `INSERT INTO users (id, role, name, email, is_active, kyc_status, subscription_tier, subscription_status)
     VALUES (?, 'founder', 'Maud Member', 'maud@fr.example', 1, 'approved', 'studio', 'active')`,
  ).run(MEMBER);
  db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at)
     VALUES ('totp-9', ?, 'totp', datetime('now'), datetime('now'))`,
  ).run(MEMBER);
  db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at)
     VALUES ('totp-1', ?, 'totp', datetime('now'), datetime('now'))`,
  ).run(ADMIN);
  db.prepare(
    `INSERT INTO spinout_applications (id, user_id, company_name, idea, cohort, status)
     VALUES (?, ?, 'Fleur Labs', 'Soil sensors for vineyards', 'Cohort 5', 'pending')`,
  ).run(APP_ID, FOUNDER);
  db.exec("INSERT INTO cohort_cycles(id,year,month,start_at,end_at) VALUES(1,2035,1,'2035-01-01 05:00:00','2035-02-01 05:00:00')");
  db.prepare('INSERT INTO cohort_applicants(id,application_id,user_id,cohort_cycle_id) VALUES(1,?,?,1)').run(APP_ID, FOUNDER);
  db.prepare(
    `INSERT INTO perks (uid, partner_name, category, offer, status, created_at, updated_at)
     VALUES (?, 'Acme Cloud', 'infrastructure', '$5,000 in credits', 'in_review', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
  ).run(PERK);
  if (licence) {
    db.prepare(
      `INSERT INTO branch_licence (id, licence_uid, territory, status, pushed_at, program_grants_json)
       VALUES (1, 'lic-fr-test', 'FR', ?, datetime('now', '-4 days'), ?)`,
    ).run(licence, programs ?? null);
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

type Act = { name: string; program: string; method: string; path: string; body: Record<string, unknown> };

/** Every write D985 gates, with a body that reaches the gate. */
const GATED: Act[] = [
  { name: 'cohort decide (approve)', program: 'spinout-lab', method: 'POST', path: '/api/admin/cohort/applications/1/decide', body: { status: 'approved', reason: 'Synthetic review' } },
  { name: 'legacy decide (accept)', program: 'spinout-lab', method: 'POST', path: `/api/admin/spinout-applications/${APP_ID}/decide`, body: { decision: 'accepted', reason: 'Synthetic review' } },
  { name: 'interview', program: 'spinout-lab', method: 'POST', path: '/api/admin/cohort/applications/1/interview', body: {} },
  { name: 'force-proceed', program: 'spinout-lab', method: 'POST', path: '/api/admin/cohort/applications/cycles/1/force-proceed', body: { reason: 'Synthetic' } },
  { name: 'move', program: 'spinout-lab', method: 'POST', path: '/api/admin/cohort/applications/1/move', body: { cycle_id: 1, reason: 'Synthetic' } },
  { name: 'bulk decide (approve)', program: 'spinout-lab', method: 'POST', path: '/api/admin/cohort/applications/bulk-decide', body: { applicant_ids: [1], status: 'approved', reason: 'Synthetic' } },
  { name: 'admit', program: 'spinout-lab', method: 'POST', path: '/api/admin/cohort/applications/admit', body: { user_id: MEMBER, cycle_id: 1, reason: 'Synthetic' } },
  { name: 'spinout-admit', program: 'spinout-lab', method: 'POST', path: `/api/admin/users/${MEMBER}/spinout-admit`, body: { cycle_id: 1, reason: 'Synthetic' } },
  { name: 'host approve', program: 'spinout-lab', method: 'POST', path: '/api/admin/lab-hosts/no-such-host/decision', body: { decision: 'approve' } },
  { name: 'certificate issue', program: 'spinout-lab', method: 'POST', path: '/api/spinout-lab/certificates', body: { user_id: FOUNDER } },
  { name: 'certificate backfill', program: 'spinout-lab', method: 'POST', path: '/api/spinout-lab/certificates/backfill', body: {} },
  { name: 'mentor assignment', program: 'mentor-cohorts', method: 'POST', path: '/api/advisors/admin/cohort-assignments', body: { advisor_user_id: MEMBER, cohort_cycle_id: 1 } },
  { name: 'strategic access grant', program: 'refer-and-earn', method: 'POST', path: `/api/refer-earn/admin/strategic-access/${FOUNDER}/decision`, body: { decision: 'granted' } },
  { name: 'submission qualified', program: 'refer-and-earn', method: 'PATCH', path: '/api/refer-earn/admin/submissions/no-such-sub', body: { status: 'qualified' } },
  { name: 'submission converted', program: 'refer-and-earn', method: 'PATCH', path: '/api/refer-earn/admin/submissions/no-such-sub', body: { status: 'converted' } },
  { name: 'submission reward eligible', program: 'refer-and-earn', method: 'PATCH', path: '/api/refer-earn/admin/submissions/no-such-sub', body: { status: 'reward_eligible' } },
  { name: 'perk approve', program: 'perks', method: 'POST', path: `/api/perks/admin/${PERK}/review`, body: { action: 'approve' } },
];

/** Writes that wind something down or annotate it: no grant needed. */
const OPEN: Array<Omit<Act, 'program'>> = [
  { name: 'cohort decide (reject)', method: 'POST', path: '/api/admin/cohort/applications/1/decide', body: { status: 'rejected', reason: 'Synthetic review' } },
  { name: 'cohort decide (waitlist)', method: 'POST', path: '/api/admin/cohort/applications/1/decide', body: { status: 'waitlisted', reason: 'Synthetic review' } },
  { name: 'legacy decide (refuse)', method: 'POST', path: `/api/admin/spinout-applications/${APP_ID}/decide`, body: { decision: 'refused', reason: 'Synthetic review' } },
  { name: 'bulk decide (waitlist)', method: 'POST', path: '/api/admin/cohort/applications/bulk-decide', body: { applicant_ids: [1], status: 'waitlisted', reason: 'Synthetic' } },
  { name: 'interview cancel', method: 'POST', path: '/api/admin/cohort/applications/1/interview/cancel', body: {} },
  { name: 'cohort settings', method: 'POST', path: '/api/admin/cohort/applications/settings', body: { min_cohort_size: 3 } },
  { name: 'grace', method: 'POST', path: '/api/admin/cohort/grace', body: {} },
  { name: 'host reject', method: 'POST', path: '/api/admin/lab-hosts/no-such-host/decision', body: { decision: 'reject' } },
  { name: 'host revoke', method: 'POST', path: '/api/admin/lab-hosts/no-such-host/decision', body: { decision: 'revoke' } },
  { name: 'certificate revoke', method: 'POST', path: '/api/spinout-lab/certificates/no-such-cert/revoke', body: { reason: 'Synthetic' } },
  { name: 'mentor unassign', method: 'DELETE', path: '/api/advisors/admin/cohort-assignments/999', body: {} },
  { name: 'strategic access decline', method: 'POST', path: `/api/refer-earn/admin/strategic-access/${FOUNDER}/decision`, body: { decision: 'declined', note: 'Synthetic decline reason.' } },
  { name: 'submission rejected', method: 'PATCH', path: '/api/refer-earn/admin/submissions/no-such-sub', body: { status: 'rejected', note: 'Synthetic' } },
  { name: 'submission reward issued', method: 'PATCH', path: '/api/refer-earn/admin/submissions/no-such-sub', body: { status: 'reward_issued' } },
  { name: 'perk reject', method: 'POST', path: `/api/perks/admin/${PERK}/review`, body: { action: 'reject', review_note: 'Synthetic' } },
];

/** What any gated write could change, read back whole. */
function snapshot(db: DB) {
  const all = (t: string) => db.prepare(`SELECT * FROM ${t}`).all();
  return JSON.stringify({
    applicants: all('cohort_applicants'), apps: all('spinout_applications'), cycles: all('cohort_cycles'),
    flags: all('user_spinout_flags'), hosts: all('lab_host_applications'), certs: all('spinout_certificates'),
    perks: all('perks'), access: all('referral_strategic_access'), subs: all('referral_submissions'),
    assignments: all('advisor_cohort_assignments'),
  });
}

const notGrant = (r: { body: any }) => r.body?.code !== 'program_not_granted' && r.body?.code !== 'program_grants_unreadable';

/* 1. A branch whose licence does not hold the program: each gated write refuses, names it, writes nothing */

for (const act of GATED) {
  test(`D985: on a branch not granted ${act.program}, the ${act.name} answers 403 program_not_granted and writes nothing`, async () => {
    const db = freshDb('active', NONE_HELD);
    const before = snapshot(db);
    const r = await req(makeEnv(db, FR_VARS), act.method, act.path, act.body);
    assert.equal(r.status, 403, `${act.name}: ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(r.body?.code, 'program_not_granted');
    assert.equal(r.body?.program_key, act.program);
    assert.equal(r.body?.standing, 'not_held');
    assert.match(r.body?.detail, /^This studio's licence does not hold .+\. Ask HQ for it from the licence page\.$/);
    assert.equal(snapshot(db), before, `${act.name} was refused but still wrote`);
  });
}

test('D985: each refusal names its program by name', async () => {
  const names: Record<string, string> = { 'spinout-lab': 'Spin-Out Lab', 'mentor-cohorts': 'Mentor cohort access', 'refer-and-earn': 'Refer & Earn', perks: 'Perks' };
  const { programOf } = await import('../src/services/programGrants.ts');
  for (const [key, name] of Object.entries(names)) assert.equal(programOf(key)?.name, name, key);
  for (const act of [GATED[0], GATED[11], GATED[12], GATED[16]]) {
    const r = await req(makeEnv(freshDb('active', NONE_HELD), FR_VARS), act.method, act.path, act.body);
    assert.ok(r.body?.detail.includes(names[act.program]), `${act.name}: ${r.body?.detail}`);
  }
});

/* 2. Granted and in force: no gated write answers the grant refusal */

test('D985: on a branch holding all four, no gated write is refused for its grant', async () => {
  for (const act of GATED) {
    const r = await req(makeEnv(freshDb('active', ALL_HELD), FR_VARS), act.method, act.path, act.body);
    assert.ok(notGrant(r), `${act.name} was refused while held: ${JSON.stringify(r.body)}`);
  }
});

test('D985: holding one program does not open another', async () => {
  const onlyLab = copyOf([inForce('spinout-lab')]);
  const lab = await req(makeEnv(freshDb('active', onlyLab), FR_VARS), 'POST', `/api/admin/users/${MEMBER}/spinout-admit`, { cycle_id: 1, reason: 'Synthetic' });
  assert.ok(notGrant(lab), JSON.stringify(lab.body));
  const perk = await req(makeEnv(freshDb('active', onlyLab), FR_VARS), 'POST', `/api/perks/admin/${PERK}/review`, { action: 'approve' });
  assert.equal(perk.body?.code, 'program_not_granted');
  assert.equal(perk.body?.program_key, 'perks');
});

test('D985: a held grant lets the admission land', async () => {
  const db = freshDb('active', ALL_HELD);
  const r = await req(makeEnv(db, FR_VARS), 'POST', `/api/admin/users/${MEMBER}/spinout-admit`, { cycle_id: 1, reason: 'Synthetic admission' });
  assert.ok(r.status >= 200 && r.status < 300, `${r.status} ${JSON.stringify(r.body)}`);
  assert.equal((db.prepare('SELECT status FROM cohort_applicants WHERE user_id = ? AND cohort_cycle_id = 1').get(MEMBER) as any)?.status, 'approved');
  const perk = await req(makeEnv(db, FR_VARS), 'POST', `/api/perks/admin/${PERK}/review`, { action: 'approve' });
  assert.equal(perk.status, 200, JSON.stringify(perk.body));
  assert.equal((db.prepare('SELECT status FROM perks WHERE uid = ?').get(PERK) as any).status, 'live');
});

/* 3. Winding down stays open */

test('D985: rejections, takedowns and annotations are not refused for a missing grant', async () => {
  for (const act of OPEN) {
    const r = await req(makeEnv(freshDb('active', NONE_HELD), FR_VARS), act.method, act.path, act.body);
    assert.ok(notGrant(r), `${act.name} was refused for its grant: ${JSON.stringify(r.body)}`);
  }
});

test('D985: a paused Perks grant still lets a listing be rejected, and the rejection lands', async () => {
  const db = freshDb('active', copyOf([inForce('perks', { state: 'paused' })]));
  const r = await req(makeEnv(db, FR_VARS), 'POST', `/api/perks/admin/${PERK}/review`, { action: 'reject', review_note: 'Synthetic' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((db.prepare('SELECT status FROM perks WHERE uid = ?').get(PERK) as any).status, 'rejected');
});

/* 4. HQ: never limited (D981 §5, decision 1) */

test('D985: HQ is never refused for a grant, even with a branch_licence row holding nothing', async () => {
  for (const act of GATED) {
    const r = await req(makeEnv(freshDb('active', NONE_HELD), HQ_VARS), act.method, act.path, act.body);
    assert.ok(notGrant(r), `HQ's ${act.name} was refused for a grant: ${JSON.stringify(r.body)}`);
  }
});

/* 5. Order: the admin gate, then the freeze, then the grant */

test('D985: a non-admin is refused as a non-admin, never told what the branch is granted', async () => {
  for (const act of GATED) {
    const r = await req(makeEnv(freshDb('active', NONE_HELD), FR_VARS), act.method, act.path, act.body, true, MEMBER);
    assert.ok(notGrant(r), `${act.name} told a non-admin the grant: ${JSON.stringify(r.body)}`);
    assert.ok(r.status === 401 || r.status === 403, `${act.name}: ${r.status}`);
  }
});

test('D985: a suspended branch answers the freeze first, not the grant', async () => {
  for (const act of GATED) {
    const r = await req(makeEnv(freshDb('suspended', NONE_HELD), FR_VARS), act.method, act.path, act.body);
    assert.equal(r.status, 423, `${act.name}: ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(r.body?.code, 'branch_suspended');
  }
});

/* 6. No copy yet refuses nothing; an unreadable copy refuses with its own sentence */

test('D985: a branch HQ has not pushed programs to is not refused', async () => {
  for (const db of [freshDb('active', null), freshDb(null)]) {
    const r = await req(makeEnv(db, FR_VARS), 'POST', `/api/admin/users/${MEMBER}/spinout-admit`, { cycle_id: 1, reason: 'Synthetic' });
    assert.ok(r.status >= 200 && r.status < 300, `${r.status} ${JSON.stringify(r.body)}`);
  }
});

test('D985: an unparseable copy answers 503 program_grants_unreadable and writes nothing', async () => {
  for (const bad of ['{not json', '[]', '{"grants":{}}', '{"grants":[]}']) {
    const db = freshDb('active', bad);
    const before = snapshot(db);
    const r = await req(makeEnv(db, FR_VARS), 'POST', `/api/admin/users/${MEMBER}/spinout-admit`, { cycle_id: 1, reason: 'Synthetic' });
    assert.equal(r.status, 503, `${bad}: ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(r.body?.code, 'program_grants_unreadable');
    assert.equal(r.body?.detail, 'Your programs could not be read, so Spin-Out Lab cannot start anything new. That is not the same as not granted.');
    assert.equal(snapshot(db), before);
  }
});

/* 7. The standings, by part 1's rule for a grant's dates */

test('D985: each standing that refuses has its own sentence; one in force or waiting on paperwork does not refuse', async () => {
  const { programRefusal } = await import('../src/services/programEnforcement.ts');
  const TODAY = '2026-10-25';
  const at = async (programs: string, status = 'active') => {
    const db = freshDb(status as 'active', programs);
    return programRefusal(makeEnv(db, FR_VARS), 'spinout-lab', TODAY);
  };
  const cases: Array<[string, string, string | null, RegExp | null]> = [
    ['no row', copyOf([]), 'not_held', /^This studio's licence does not hold Spin-Out Lab\./],
    ['a draft', copyOf([inForce('spinout-lab', { state: 'draft' })]), 'not_held', /does not hold/],
    ['switched off', copyOf([], { 'spinout-lab': false }), 'switched_off', /^HQ does not grant Spin-Out Lab at the moment/],
    ['a draft, switched off', copyOf([inForce('spinout-lab', { state: 'draft' })], { 'spinout-lab': false }), 'switched_off', /^HQ does not grant/],
    ['paused', copyOf([inForce('spinout-lab', { state: 'paused' })]), 'paused', /^HQ has paused Spin-Out Lab for this studio\. Nothing new starts until HQ resumes it\.$/],
    ['ended', copyOf([inForce('spinout-lab', { state: 'ended' })]), 'ended', /^HQ has ended this studio's grant of Spin-Out Lab\./],
    ['an unknown state', copyOf([inForce('spinout-lab', { state: 'revoked' })]), 'not_held', /does not hold/],
    ['starts tomorrow', copyOf([inForce('spinout-lab', { starts_on: '2026-10-26' })]), 'not_started', /has not started yet/],
    ['ended yesterday', copyOf([inForce('spinout-lab', { ends_on: '2026-10-24' })]), 'period_over', /has run past its end date/],
    ['ends with a lapsed licence', copyOf([inForce('spinout-lab', { ends_with_licence: 1 })]), 'held', null],
    ['in force', copyOf([inForce('spinout-lab')]), 'held', null],
    ['starts today', copyOf([inForce('spinout-lab', { starts_on: TODAY })]), 'held', null],
    ['ends today', copyOf([inForce('spinout-lab', { ends_on: TODAY })]), 'held', null],
    ['schedule unsigned', copyOf([inForce('spinout-lab', { schedule_signed_at: null })]), 'held', null],
    ['another program held', copyOf([inForce('perks')]), 'not_held', /does not hold/],
  ];
  for (const [name, programs, standing, sentence] of cases) {
    const r = await at(programs);
    if (standing === 'held') { assert.equal(r, null, `${name}: ${JSON.stringify(r)}`); continue; }
    assert.equal(r?.status, 403, name);
    assert.equal(r?.body.standing, standing, name);
    assert.match(r!.body.detail, sentence!, name);
  }
  // A grant waiting only on the licence becoming active is the freeze's, not this gate's.
  assert.equal(await at(copyOf([inForce('spinout-lab')]), 'lapsed'), null);
});

test('D985: ends_with_licence reads the licence renewal date from the copy row', async () => {
  const { programRefusal } = await import('../src/services/programEnforcement.ts');
  const db = freshDb('active', copyOf([inForce('spinout-lab', { ends_with_licence: 1 })]));
  db.exec("UPDATE branch_licence SET renewal_at = '2026-10-01 00:00:00' WHERE id = 1");
  const r = await programRefusal(makeEnv(db, FR_VARS), 'spinout-lab', '2026-10-25');
  assert.equal(r?.body.standing, 'period_over');
  db.exec("UPDATE branch_licence SET renewal_at = '2027-10-01 00:00:00' WHERE id = 1");
  assert.equal(await programRefusal(makeEnv(db, FR_VARS), 'spinout-lab', '2026-10-25'), null);
});

test('D985: a branch_licence this deployment cannot read refuses nothing', async () => {
  const { programRefusal } = await import('../src/services/programEnforcement.ts');
  const db = freshDb(null);
  db.exec('DROP TABLE branch_licence');
  assert.equal(await programRefusal(makeEnv(db, FR_VARS), 'spinout-lab'), null);
});
