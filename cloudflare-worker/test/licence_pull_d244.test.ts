/**
 * D244 — a fresh branch fetches its own licence copy, once, and says why when
 * it cannot.
 *
 * THE DEFECT. A branch holds no `branch_licence` row until HQ's next licence
 * transition pushes one, and nothing guarantees a next transition: a licence
 * that is simply active never has one. So `GET /api/licence/mine` answered
 * `licence_not_pushed` for as long as nothing changed at HQ, while both halves
 * of a pull already existed and were wired to nothing — HQ's
 * `BranchEntrypoint.licence()` had no caller, and the branch's writer,
 * `applyLicenceCopy`, was the push's alone.
 *
 * AND THE HALF THAT WAS A HOLE. `licence(callerCode)` took no secret. A service
 * binding cannot say who called it, so any Worker in the account that named a
 * code received that branch's fees, revenue share and signatory. D244 gives it
 * the per-deployment secret `reportUsage` already takes, checked by the same
 * `authenticateBranch`, before it reads anything — and these tests call HQ's
 * REAL `licenceForBranch` over an HQ database, so a refusal here is HQ's own
 * refusal and not a stub's opinion of what HQ would say.
 *
 * WHAT IS ASSERTED, and each has a mutation in the PR body that breaks it:
 *   · missing copy and HQ answers → the row is written, read back and served;
 *   · HQ throws, refuses, or answers with an error object → licence_not_pushed
 *     with the pull's own sentence, and NO row (an error object written
 *     through the copy writer would render as a licence with every term null);
 *   · a second request inside the window reports the first and does not call;
 *   · a wrong, missing or unprovisioned secret → HQ refuses, nothing written;
 *   · no RPC_SECRET, no HQ binding, no throttle store, an unreadable throttle,
 *     an unreadable copy table → each refuses before calling HQ, in its words;
 *   · HQ never pulls;
 *   · a deadline — HQ that never answers is reported as not answering;
 *   · only an admin reads the branch's licence terms, and a non-admin's read
 *     never becomes a call to HQ.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/licence_pull_d244.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import licence, { pullLicenceCopy, LICENCE_PULL_WINDOW_SECONDS } from '../src/routes/licence.ts';
import { licenceForBranch } from '../src/rpc/hqOps.ts';
import { tableFromBaseline, splitStatements, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const migration = (name: string) => read(`cloudflare-worker/sql/migrations/${name}.sql`);

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 7;
const FOUNDER = 8;

// Synthetic per-deployment secret. Obviously not a credential: it exists only
// in this file, and the secret scan must never mistake it for one.
const RPC_SECRET = 'synthetic-test-value-fr-not-a-credential';
const hashOf = (v: string) => createHash('sha256').update(v).digest('hex');

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}

/** A D1 over `node:sqlite`. `refuse` makes any statement naming that table throw, as a missing table does. */
function makeD1(db: InstanceType<typeof DatabaseSync>, refuse?: string) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const guard = () => {
        if (refuse && sql.includes(refuse)) throw new Error(`D1_ERROR: no such table: ${refuse}`);
      };
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { guard(); return db.prepare(sql).get(...b) ?? null; },
        async all() { guard(); return { results: db.prepare(sql).all(...b) }; },
        async run() {
          guard();
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out: any[] = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

const run = (db: InstanceType<typeof DatabaseSync>, sql: string) => {
  for (const st of splitStatements(sql)) db.exec(st);
};

/* ------------------------------------------------------------------ *
 * HQ: the licence ledger as the baseline declares it, with the four   *
 * migrations the pull reads through — the deployment registry (258),  *
 * the contract ledger (259) and the kind (279).                       *
 * ------------------------------------------------------------------ */
function hqDb(opts: { hash?: string | null; licenceRow?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['territory_licences', 'licence_territories', 'licence_seats']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  for (const m of ['258_licence_deployments', '259_licence_contracts', '279_licence_kind']) run(db, migration(m));
  if (opts.licenceRow !== false) {
    db.prepare(
      `INSERT INTO territory_licences
         (id, uid, licence_ref, legal_entity_name, brand_name, registered_address, signatory_name,
          signatory_title, status, term_years, annual_fee_cents, currency, revenue_share_bps,
          token_split_bps, starts_on, renews_on, kind)
       VALUES (1, 'lic_fr', 'AXL-001', 'Axal VC France SAS', 'Axal VC France', '12 rue de la Paix',
               'Claire Dubois', 'Managing Director', 'active', 3, 5000000, 'EUR', 3500, 3100,
               '2026-01-01', '2027-01-01', 'subsidiary')`,
    ).run();
    const terr = db.prepare('INSERT INTO licence_territories (licence_id, country_code) VALUES (?,?)');
    for (const cc of ['LU', 'FR', 'BE']) terr.run(1, cc);
    db.prepare('INSERT INTO licence_seats (licence_id, seat_type, seats_licensed) VALUES (1, ?, ?)').run('founder', 200);
  }
  db.prepare(
    `INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status, rpc_secret_hash)
     VALUES ('lic_fr', 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr', 'live', ?)`,
  ).run(opts.hash === undefined ? hashOf(RPC_SECRET) : opts.hash);
  return db;
}

/**
 * HQ's `BranchEntrypoint.licence`, as the branch's binding reaches it: the REAL
 * `licenceForBranch`, over HQ's database, on an env with no BRANCH_CODE — so it
 * authenticates exactly as production would. `calls` counts every time the
 * branch reached HQ at all, which is what the throttle and every early refusal
 * are about.
 */
function realHq(db: InstanceType<typeof DatabaseSync>) {
  const calls: Array<{ code: string; secret: string }> = [];
  const hqEnv = { DB: makeD1(db) } as any;
  return {
    calls,
    HQ: {
      async licence(code: string, secret: string) {
        calls.push({ code, secret });
        return licenceForBranch(hqEnv, code, secret);
      },
    },
  };
}

/** An HQ binding that answers however it is told, still counting calls. */
function stubHq(answer: () => Promise<unknown>) {
  const calls: Array<{ code: string; secret: string }> = [];
  return {
    calls,
    HQ: {
      async licence(code: string, secret: string) {
        calls.push({ code, secret });
        return answer();
      },
    },
  };
}

/** A KV namespace over a Map, recording puts with the options they were given. */
function kv(opts: { failGet?: boolean } = {}) {
  const store = new Map<string, string>();
  const puts: Array<{ key: string; value: string; opts: any }> = [];
  return {
    store,
    puts,
    async get(key: string) {
      if (opts.failGet) throw new Error('KV unavailable');
      return store.get(key) ?? null;
    },
    async put(key: string, value: string, o?: any) {
      puts.push({ key, value, opts: o });
      store.set(key, value);
    },
  };
}

/** A branch database: its copy table from the four migrations that shaped it, and two accounts. */
function branchDb(opts: { table?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT);`);
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)').run(ADMIN, 'admin', 'Claire Dubois', 'claire@fr.example');
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)').run(FOUNDER, 'founder', 'Ana Reyes', 'ana@fr.example');
  if (opts.table !== false) {
    for (const m of ['256_branch_local_copies', '257_branch_licence_ref', '265_branch_licence_entity', '284_branch_licence_kind']) {
      run(db, migration(m));
    }
  }
  return db;
}

const copyRows = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare('SELECT * FROM branch_licence').all() as any[];

const FR = {
  JWT_SECRET, ENVIRONMENT: 'development',
  BRANCH_CODE: 'fr', BRANCH_NAME: 'Axal VC France', BRANCH_TERRITORY: 'FR,BE,LU', APP_URL: 'https://fr.axal.vc',
};

function branchEnv(db: InstanceType<typeof DatabaseSync>, extra: Record<string, unknown> = {}) {
  return { ...FR, DB: makeD1(db), RPC_SECRET, ...extra } as any;
}

const app = new Hono<any>();
app.route('/licence', licence);
app.onError((err: any, c) => {
  const detail = String(err?.message || '');
  return c.json({ detail }, detail === 'Admin required' ? 403 : 500);
});

async function mine(env: Record<string, unknown>, userId = ADMIN, role = 'admin') {
  const token = await new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request('/licence/mine', { headers: { Authorization: `Bearer ${token}` } }, env);
  return { status: res.status, body: await res.json() as any };
}

/* ------------------------------------------------------------------ */

test('a missing copy is fetched from HQ, written, read back and served', async () => {
  const hq = realHq(hqDb());
  const store = kv();
  const db = branchDb();
  const { status, body } = await mine(branchEnv(db, { HQ: hq.HQ, RATE_LIMITS: store }));

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(hq.calls.length, 1, 'the branch must ask HQ exactly once');
  assert.deepEqual(hq.calls[0], { code: 'fr', secret: RPC_SECRET },
    'the branch must name itself and present its own RPC_SECRET');
  assert.equal(body.source, 'hq_copy');
  assert.equal(body.licence.uid, 'lic_fr');
  assert.equal(body.licence.licence_ref, 'AXL-001');
  assert.deepEqual(body.licence.territories, ['BE', 'FR', 'LU']);
  assert.equal(body.licence.legal_entity_name, 'Axal VC France SAS');
  assert.equal(body.pull?.called, true, 'the response must say this request fetched the copy');
  assert.equal(body.pull?.ok, true);
  assert.equal(copyRows(db).length, 1, 'the pulled copy was not written');
  // as_of is HQ's stamp, carried verbatim through the push's own writer.
  assert.equal(body.as_of, copyRows(db)[0].pushed_at);

  // The attempt is recorded for the window, a success included.
  assert.equal(store.puts.length, 1);
  assert.equal(store.puts[0].key, 'licence_pull:fr');
  assert.equal(store.puts[0].opts?.expirationTtl, LICENCE_PULL_WINDOW_SECONDS);
  assert.equal(JSON.parse(store.puts[0].value).ok, true);
});

test('a copy already held is served without asking HQ', async () => {
  const hq = realHq(hqDb());
  const db = branchDb();
  // Seed a copy through the path itself, then read again.
  await mine(branchEnv(db, { HQ: hq.HQ, RATE_LIMITS: kv() }));
  assert.equal(hq.calls.length, 1);
  const again = await mine(branchEnv(db, { HQ: hq.HQ, RATE_LIMITS: kv() }));
  assert.equal(again.status, 200);
  assert.equal(hq.calls.length, 1, 'a branch that holds a copy must not call HQ');
  assert.equal(again.body.pull, undefined, 'a copy that was not fetched now must not say it was');
});

test('HQ throwing leaves no copy, and the refusal says a pull was tried and why', async () => {
  const hq = stubHq(async () => { throw new Error('binding reset by peer'); });
  const db = branchDb();
  const { status, body } = await mine(branchEnv(db, { HQ: hq.HQ, RATE_LIMITS: kv() }));
  assert.equal(status, 404);
  assert.equal(body.error, 'licence_not_pushed');
  assert.equal(body.message, 'HQ has not pushed this branch its licence yet.', 'the unchanged answer stays');
  assert.equal(body.pull.called, true);
  assert.equal(body.pull.ok, false);
  assert.match(body.pull.reason, /HQ did not return the licence: binding reset by peer/);
  assert.ok(body.pull.retry_after, 'a failed pull must say when the next one may happen');
  assert.equal(copyRows(db).length, 0, 'a failed pull wrote a copy');
});

test('a second request inside the window does not call HQ, and reports the first', async () => {
  const hq = stubHq(async () => { throw new Error('binding reset by peer'); });
  const store = kv();
  const db = branchDb();
  const first = await mine(branchEnv(db, { HQ: hq.HQ, RATE_LIMITS: store }));
  assert.equal(first.body.pull.called, true);
  const second = await mine(branchEnv(db, { HQ: hq.HQ, RATE_LIMITS: store }));
  assert.equal(hq.calls.length, 1, 'the throttle let a second call through inside its window');
  assert.equal(second.status, 404);
  assert.equal(second.body.pull.called, false);
  assert.match(second.body.pull.reason, /A pull was already tried at .* and it did not bring the licence back/);
  assert.match(second.body.pull.reason, /binding reset by peer/, 'the waiting request must carry the first attempt\'s reason');
  assert.match(second.body.pull.reason, /at most once every 5 minutes/);
  assert.equal(second.body.pull.retry_after, first.body.pull.retry_after);
});

test('a wrong secret is refused by HQ itself, and nothing is written', async () => {
  const hq = realHq(hqDb());
  const db = branchDb();
  const { status, body } = await mine(branchEnv(db, {
    HQ: hq.HQ, RATE_LIMITS: kv(), RPC_SECRET: 'synthetic-test-value-wrong-not-a-credential',
  }));
  assert.equal(status, 404);
  assert.equal(hq.calls.length, 1);
  assert.match(body.pull.reason, /fr presented the wrong secret/);
  assert.equal(copyRows(db).length, 0);
});

test('a deployment with no hash on file is refused by HQ — never a default-open', async () => {
  const hq = realHq(hqDb({ hash: null }));
  const db = branchDb();
  const { body } = await mine(branchEnv(db, { HQ: hq.HQ, RATE_LIMITS: kv() }));
  assert.match(body.pull.reason, /fr has no rpc_secret_hash on file/);
  assert.equal(copyRows(db).length, 0);
});

test('HQ\'s licence() refuses before it reads anything, whatever calls it', async () => {
  // Direct, without the branch in front: the property that closes the hole is
  // HQ's, and it must not depend on the branch being polite.
  const env = { DB: makeD1(hqDb()) } as any;
  await assert.rejects(() => licenceForBranch(env, 'fr', ''), /fr presented no secret/);
  await assert.rejects(() => licenceForBranch(env, 'fr', 'synthetic-test-value-wrong-not-a-credential'),
    /presented the wrong secret/);
  await assert.rejects(() => licenceForBranch(env, 'nowhere', RPC_SECRET), /nowhere is not a provisioned branch/);
  const ok: any = await licenceForBranch(env, 'fr', RPC_SECRET);
  assert.equal(ok.licence_uid, 'lic_fr');
  assert.equal(ok.revenue_share_bps, 3500);
  // And only HQ answers it: a branch holding the same tables is not HQ.
  await assert.rejects(() => licenceForBranch({ ...env, BRANCH_CODE: 'fr' }, 'fr', RPC_SECRET));
});

test('HQ answering with an error object writes nothing — it is never applied as a licence', async () => {
  // A licence row gone from HQ's ledger, through the REAL licence(): HQ knows
  // the deployment and answers `{ error: 'no_licence_for_branch' }`.
  const hq = realHq(hqDb({ licenceRow: false }));
  const db = branchDb();
  const { status, body } = await mine(branchEnv(db, { HQ: hq.HQ, RATE_LIMITS: kv() }));
  assert.equal(status, 404);
  assert.equal(body.error, 'licence_not_pushed');
  assert.match(body.pull.reason, /HQ has this branch's deployment on record but no licence row for it/);
  assert.equal(copyRows(db).length, 0,
    'an error object was written through the copy writer — the page would render it as a licence with every term empty');
});

test('an answer with no licence id is not stored', async () => {
  const hq = stubHq(async () => ({ licence_ref: 'AXL-001', status: 'active' }));
  const db = branchDb();
  const { body } = await mine(branchEnv(db, { HQ: hq.HQ, RATE_LIMITS: kv() }));
  assert.match(body.pull.reason, /HQ answered without a licence id/);
  assert.equal(copyRows(db).length, 0);
});

test('no RPC_SECRET refuses before calling HQ, and says what to do', async () => {
  const hq = realHq(hqDb());
  const db = branchDb();
  const { body } = await mine(branchEnv(db, { HQ: hq.HQ, RATE_LIMITS: kv(), RPC_SECRET: '' }));
  assert.equal(hq.calls.length, 0, 'a branch with no secret called HQ anyway');
  assert.equal(body.pull.called, false);
  assert.match(body.pull.reason, /this branch has no RPC_SECRET/);
  assert.match(body.pull.reason, /branch-provision\.yml/);
});

test('no HQ binding refuses before anything else can be tried', async () => {
  const db = branchDb();
  const { body } = await mine(branchEnv(db, { RATE_LIMITS: kv() }));
  assert.equal(body.pull.called, false);
  assert.match(body.pull.reason, /no HQ service binding/);
});

test('no throttle store refuses — it never falls back to an unlimited pull', async () => {
  const hq = realHq(hqDb());
  const db = branchDb();
  const { body } = await mine(branchEnv(db, { HQ: hq.HQ }));
  assert.equal(hq.calls.length, 0, 'with nothing to record attempts in, the branch called HQ unbounded');
  assert.match(body.pull.reason, /RATE_LIMITS\) is not bound here/);
});

test('an unreadable throttle record refuses rather than calling', async () => {
  const hq = realHq(hqDb());
  const db = branchDb();
  const { body } = await mine(branchEnv(db, { HQ: hq.HQ, RATE_LIMITS: kv({ failGet: true }) }));
  assert.equal(hq.calls.length, 0);
  assert.match(body.pull.reason, /could not be read, and without it the attempts cannot be limited/);
});

test('an unreadable copy table is not pulled into — the licence would have nowhere to go', async () => {
  const hq = realHq(hqDb());
  const db = branchDb({ table: false });
  const { status, body } = await mine(branchEnv(db, { HQ: hq.HQ, RATE_LIMITS: kv() }));
  assert.equal(status, 404);
  assert.equal(hq.calls.length, 0, 'the branch called HQ for a record it had no table to hold');
  assert.match(body.pull.reason, /migrations 256, 265 and 284/);
});

test('HQ never pulls — the ledger is its own', async () => {
  const hq = realHq(hqDb());
  const pull = await pullLicenceCopy({ JWT_SECRET, DB: makeD1(branchDb()), HQ: hq.HQ, RATE_LIMITS: kv(), RPC_SECRET } as any);
  assert.equal(pull.called, false);
  assert.match(String(pull.reason), /HQ holds the licence ledger itself/);
  assert.equal(hq.calls.length, 0);

  // And the route on HQ answers from licence_admins, never from a copy or a
  // pull: an admin bound to no licence gets HQ's own 404, `no_licence` — the
  // answer that route has always given — and HQ's binding is never touched.
  const hqSide = hqDb();
  hqSide.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                                   jwt_min_iat INTEGER, name TEXT, email TEXT);`);
  hqSide.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)').run(ADMIN, 'admin', 'Claire Dubois', 'claire@axal.example');
  for (const t of ['licence_admins', 'licence_events']) hqSide.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  const onHq = await mine({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc',
    DB: makeD1(hqSide), HQ: hq.HQ, RATE_LIMITS: kv(), RPC_SECRET });
  assert.equal(onHq.status, 404, JSON.stringify(onHq.body));
  assert.equal(onHq.body.error, 'no_licence', 'HQ answered with something other than its own ledger\'s answer');
  assert.equal(onHq.body.pull, undefined, 'HQ reported a pull it has no business making');
  assert.equal(hq.calls.length, 0);
});

test('HQ that never answers is reported as not answering, within the deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let called!: () => void;
  const reached = new Promise<void>((r) => { called = r; });
  const hq = {
    HQ: {
      licence() { called(); return new Promise(() => {}); },
    },
  };
  const db = branchDb();
  const pending = pullLicenceCopy(branchEnv(db, { HQ: hq.HQ, RATE_LIMITS: kv() }));
  await reached;
  // withDeadline registered its timer synchronously in the same turn as the call.
  t.mock.timers.tick(3_000);
  const pull = await pending;
  assert.equal(pull.called, true);
  assert.equal(pull.ok, false);
  assert.match(String(pull.reason), /HQ did not answer within 3 seconds/);
  assert.equal(copyRows(db).length, 0);
});

test('only an admin reads the branch\'s licence terms, and a founder\'s read never reaches HQ', async () => {
  const hq = realHq(hqDb());
  const db = branchDb();
  const { status, body } = await mine(branchEnv(db, { HQ: hq.HQ, RATE_LIMITS: kv() }), FOUNDER, 'founder');
  assert.equal(status, 403);
  assert.equal(body.detail, 'Admin required');
  assert.equal(hq.calls.length, 0, 'a founder\'s page load became a call to HQ');
  assert.equal(copyRows(db).length, 0);
});

test('the call is written where the RPC harvest can see it', () => {
  // `scripts/lib/rpcSurface.mjs` finds branch→HQ calls through a local alias
  // (`const hq = … .HQ;` then `hq.<method>(`). The topology table and its
  // guard learn that `licence` has a caller only through that harvest, so the
  // form is load-bearing, not a style choice.
  const src = read('cloudflare-worker/src/routes/licence.ts');
  assert.match(src, /const hq = \(env as [^;]*\)\.HQ;/);
  assert.match(src, /hq\.licence\(code, secret\)/);
});
