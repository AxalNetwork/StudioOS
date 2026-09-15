/**
 * D112 — HQ answers, the answer travels, and the one door that must stay open.
 *
 * FOUR THINGS THIS FILE EXISTS FOR, each a way the loop fails quietly:
 *
 *   1. A SUSPENDED BRANCH CAN STILL ESCALATE. PR 5 shipped the frozen-branch
 *      banner whose stated appeal path is an escalation, and D107 gates every
 *      other branch write behind `requireBranchNotSuspended`. Gating this one
 *      would leave the banner telling people to appeal and the button
 *      answering 423 — a locked door with a sign pointing at it. Asserted here
 *      because it is the kind of consistency a later refactor "tidies" into
 *      place without noticing.
 *   2. THE DECISION AND ITS DELIVERY ARE TWO FACTS. An unreachable branch must
 *      not make a recorded decision look like one that never happened, or an
 *      operator enters it twice.
 *   3. A RAISE THAT CANNOT REACH HQ IS KEPT, NOT DROPPED — and is not counted
 *      as an escalation HQ has.
 *   4. AN ANSWER NEEDS ITS REASON. A status change with nothing written
 *      reaches the branch as a refusal it cannot act on.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/escalation_answer.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import adminEscalations from '../src/routes/admin_escalations.ts';
import branchEscalationRoutes from '../src/routes/branch_escalations.ts';
import { recordEscalation, answerEscalation, listEscalations, slaBand } from '../src/rpc/hqOps.ts';
import { applyEscalationAnswer, branchEscalations } from '../src/rpc/branchOps.ts';
import { BRANCH_ONLY } from '../src/util/branch.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const MIG_259 = read('cloudflare-worker/sql/migrations/259_hq_escalations.sql');
const MIG_261 = read('cloudflare-worker/sql/migrations/261_branch_escalations.sql');

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 7;
const PLAIN = 9;

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
  };
}

const USERS = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                      jwt_min_iat INTEGER, name TEXT, email TEXT);
  CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
`;
const DEPLOYMENTS = `
  CREATE TABLE licence_deployments (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL UNIQUE, hostname TEXT NOT NULL, worker_name TEXT NOT NULL, d1_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'live', rpc_secret_hash TEXT);
`;

function seedUsers(db: InstanceType<typeof DatabaseSync>) {
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(HOLDER, 'admin', 'Sue Hart', 'sue@axal.example');
  u.run(PLAIN, 'admin', 'Pat Lowe', 'pat@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
}

/** HQ: the ledger, one provisioned branch. */
function hqDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(USERS); db.exec(DEPLOYMENTS); db.exec(MIG_259);
  seedUsers(db);
  db.prepare(
    `INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name)
     VALUES (?,?,?,?,?)`,
  ).run('lic_fr', 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr');
  return db;
}

/**
 * A branch: `branch_licence` carries the suspension state D107 reads, so the
 * "suspended can still escalate" test exercises the real gate rather than a
 * stand-in for it.
 */
function branchDb(licenceStatus = 'active') {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(USERS);
  db.exec('CREATE TABLE branch_licence (id INTEGER PRIMARY KEY, status TEXT, pushed_at TEXT);');
  db.exec(MIG_261);
  seedUsers(db);
  db.prepare('INSERT INTO branch_licence (id, status, pushed_at) VALUES (1,?,?)')
    .run(licenceStatus, '2026-09-15T00:00:00Z');
  return db;
}

async function token(userId: number) {
  return new SignJWT({ user_id: userId, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

function appFor(routes: any, prefix: string, env: Record<string, unknown>) {
  const app = new Hono<any>();
  app.route(prefix, routes);
  app.onError((err: any, c) => {
    const msg = String(err?.message || '');
    if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
    return c.json({ detail: msg }, 403);
  });
  return async (path: string, init: RequestInit = {}, userId: number | null = HOLDER) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (userId !== null) headers.Authorization = `Bearer ${await token(userId)}`;
    const res = await app.request(`${prefix}${path}`, { ...init, headers }, env);
    return { status: res.status, body: await res.json() as any };
  };
}

/* ------------------------------------------------------------------ *
 * The branch raises                                                   *
 * ------------------------------------------------------------------ */

/** A stub HQ binding that records what it was asked and answers like HQ does. */
function stubHq(behaviour: 'ok' | 'throw' | 'no-uid' = 'ok') {
  const seen: Array<{ code: string; item: any }> = [];
  return {
    seen,
    HQ: {
      async escalate(code: string, item: any) {
        seen.push({ code, item });
        if (behaviour === 'throw') throw new Error('binding unreachable');
        if (behaviour === 'no-uid') return {};
        return { uid: 'esc_from_hq', due_at: '2026-09-18T00:00:00Z', status: 'open' };
      },
    },
  };
}

test('a branch raises, and the local row carries HQ\'s own uid', async () => {
  const db = branchDb();
  const hq = stubHq();
  const call = appFor(branchEscalationRoutes, '/api/branch', {
    DB: makeD1(db), JWT_SECRET, BRANCH_CODE: 'fr', HQ: hq.HQ,
  });

  const r = await call('/escalations', {
    method: 'POST',
    body: JSON.stringify({ kind: 'seat_increase', subject: 'Four more Founder seats', detail: 'Cohort 3 intake' }),
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.hq_uid, 'esc_from_hq');
  assert.equal(r.body.status, 'open');

  // The CALLER's own code is what HQ was told, never a body field.
  assert.equal(hq.seen[0].code, 'fr');
  assert.equal(hq.seen[0].item.raised_by_branch_user_id, HOLDER);

  const [row] = db.prepare('SELECT * FROM branch_escalations').all() as any[];
  assert.equal(row.hq_uid, 'esc_from_hq');
  assert.equal(row.due_at, '2026-09-18T00:00:00Z');
  assert.equal(row.delivery_error, null);
});

test('a SUSPENDED branch can still escalate — the appeal path is not the thing that freezes', async () => {
  // THE TEST THIS FILE EXISTS FOR. Every other branch write answers 423 while
  // suspended; this one must not, because the frozen banner tells people to
  // appeal by escalating.
  const db = branchDb('suspended');
  const hq = stubHq();
  const call = appFor(branchEscalationRoutes, '/api/branch', {
    DB: makeD1(db), JWT_SECRET, BRANCH_CODE: 'fr', HQ: hq.HQ,
  });

  const r = await call('/escalations', {
    method: 'POST',
    body: JSON.stringify({ kind: 'other', subject: 'Appealing the suspension' }),
  });
  assert.equal(r.status, 201, 'a suspended branch was refused its own appeal path');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM branch_escalations').get() as any).n, 1);
});

test('a raise HQ cannot take is kept, marked undelivered, and is NOT an escalation HQ has', async () => {
  const db = branchDb();
  const call = appFor(branchEscalationRoutes, '/api/branch', {
    DB: makeD1(db), JWT_SECRET, BRANCH_CODE: 'fr', HQ: stubHq('throw').HQ,
  });

  const r = await call('/escalations', {
    method: 'POST', body: JSON.stringify({ kind: 'moderation', subject: 'A spinout listing' }),
  });
  assert.equal(r.status, 201, 'the raise was dropped because the transport was down');
  assert.equal(r.body.status, 'undelivered');
  assert.equal(r.body.hq_uid, null, 'an undelivered raise claims an HQ id');
  assert.match(String(r.body.delivery_error), /did not accept/);

  const [row] = db.prepare('SELECT * FROM branch_escalations').all() as any[];
  assert.equal(row.hq_uid, null);
  assert.equal(row.status, 'undelivered');
});

test('no HQ binding at all is its own reason, not a crash', async () => {
  const db = branchDb();
  const call = appFor(branchEscalationRoutes, '/api/branch', {
    DB: makeD1(db), JWT_SECRET, BRANCH_CODE: 'fr',
  });
  const r = await call('/escalations', {
    method: 'POST', body: JSON.stringify({ kind: 'other', subject: 'No binding here' }),
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'undelivered');
  assert.match(String(r.body.delivery_error), /no HQ service binding/);
});

test('a kind outside the four, and a missing subject, are each refused with nothing written', async () => {
  const db = branchDb();
  const call = appFor(branchEscalationRoutes, '/api/branch', {
    DB: makeD1(db), JWT_SECRET, BRANCH_CODE: 'fr', HQ: stubHq().HQ,
  });

  const bad = await call('/escalations', {
    method: 'POST', body: JSON.stringify({ kind: 'billing', subject: 'x' }),
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'bad_kind');

  const bare = await call('/escalations', {
    method: 'POST', body: JSON.stringify({ kind: 'other' }),
  });
  assert.equal(bare.status, 400);
  assert.equal(bare.body.error, 'subject_required');

  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM branch_escalations').get() as any).n, 0);
});

test('the lane is a branch surface, and HQ is refused it', async () => {
  const db = branchDb();
  const call = appFor(branchEscalationRoutes, '/api/branch', {
    DB: makeD1(db), JWT_SECRET, // no BRANCH_CODE — this is HQ
  });
  const r = await call('/escalations', {
    method: 'POST', body: JSON.stringify({ kind: 'other', subject: 'x' }),
  });
  // 403 AND NOT 400, which is the point. The first version of this route threw
  // its own wording, `mapError` did not know it, and the answer was 400 — a
  // tier refusal indistinguishable from a malformed body. The sentence is a
  // shared constant in `AUTH_ERROR_STATUSES` now (D110's lesson, D112's case).
  assert.equal(r.status, 403, 'a tier refusal answers 400, which reads as a bad request');
  assert.equal(r.body.detail, BRANCH_ONLY);
  // AND THE TABLE IS WHY. Asserted directly, because the route throwing the
  // right sentence is only half of it — an entry deleted from the map would
  // put this back at 400 with the route unchanged.
  assert.equal(AUTH_ERROR_STATUSES[BRANCH_ONLY], 403,
    'the branch-only refusal is not in the shared status table, so mapError answers 400');
});

test('the lane says the answer is one decision, so nothing draws a reply box', async () => {
  const db = branchDb();
  const call = appFor(branchEscalationRoutes, '/api/branch', {
    DB: makeD1(db), JWT_SECRET, BRANCH_CODE: 'fr',
  });
  const r = await call('/escalations');
  assert.equal(r.status, 200);
  assert.equal(r.body.answer_shape, 'single_decision');
  assert.match(String(r.body.answer_note), /no reply thread/);
});

/* ------------------------------------------------------------------ *
 * HQ answers                                                          *
 * ------------------------------------------------------------------ */

test('the answer needs its reason, and a status that leaves it open is refused', async () => {
  const db = hqDb();
  const env = { DB: makeD1(db), JWT_SECRET } as any;
  const { uid } = await recordEscalation(env, 'fr', { kind: 'content', subject: 'A localised post' });

  await assert.rejects(
    () => answerEscalation(env, uid, { answer: '   ', answered_by_user_id: HOLDER, answered_by_name: 'Sue' }),
    /a decision needs its reason/,
  );
  await assert.rejects(
    () => answerEscalation(env, uid, { answer: 'ok', status: 'open', answered_by_user_id: HOLDER, answered_by_name: 'Sue' }),
    /cannot stay open/,
  );

  const [row] = db.prepare('SELECT * FROM hq_escalations').all() as any[];
  assert.equal(row.answer, null, 'a refused answer was written anyway');
  assert.equal(row.status, 'open');
});

test('a second answer replaces the first rather than appending — one column is not a thread', async () => {
  const db = hqDb();
  const env = { DB: makeD1(db), JWT_SECRET } as any;
  const { uid } = await recordEscalation(env, 'fr', { kind: 'other', subject: 'A question' });

  await answerEscalation(env, uid, { answer: 'First take', answered_by_user_id: HOLDER, answered_by_name: 'Sue' });
  await answerEscalation(env, uid, { answer: 'On reflection, no', status: 'declined', answered_by_user_id: HOLDER, answered_by_name: 'Sue' });

  const rows = db.prepare('SELECT * FROM hq_escalations').all() as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].answer, 'On reflection, no');
  assert.equal(rows[0].status, 'declined');
});

test('HQ records the decision even when the branch cannot be reached, and says so separately', async () => {
  const db = hqDb();
  // No BRANCH_FR binding in env: the push has nowhere to go.
  const call = appFor(adminEscalations, '/api/admin', { DB: makeD1(db), JWT_SECRET });
  const { uid } = await recordEscalation({ DB: makeD1(db) } as any, 'fr', {
    kind: 'seat_increase', subject: 'Four more seats',
  });

  const r = await call(`/escalations/${uid}`, {
    method: 'PATCH', body: JSON.stringify({ answer: 'Granted for Q4.' }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.answer, 'Granted for Q4.');
  assert.equal(r.body.status, 'answered');
  // THE HALF THAT MATTERS: the decision stands, the delivery is its own field.
  assert.equal(r.body.pushed.ok, false);
  assert.match(String(r.body.pushed.reason), /No branch Worker is bound/);

  const [row] = db.prepare('SELECT * FROM hq_escalations').all() as any[];
  assert.equal(row.answer, 'Granted for Q4.', 'an unreachable branch lost HQ\'s decision');
  assert.equal(row.answered_by_user_id, HOLDER);
});

test('a BOUND branch that throws is reported, not raised — the other half of the same rule', async () => {
  // THE CASE ABOVE IS THE PRE-PROVISIONING ONE; this is the common one. A
  // branch that is bound and DOWN takes a different path through the handler
  // — the `catch` around the RPC rather than the no-binding default — and
  // that path had no test, so replacing its body with a bare `throw` changed
  // nothing any assertion could see. An operator who gets a 500 here re-enters
  // a decision that is already stored, which is the whole failure D111's
  // promo ceiling established the shape for.
  const db = hqDb();
  const down = {
    applyEscalationAnswer() { throw new Error('Worker threw: no such deployment'); },
  };
  const call = appFor(adminEscalations, '/api/admin', {
    DB: makeD1(db), JWT_SECRET, BRANCH_FR: down,
  });
  const { uid } = await recordEscalation({ DB: makeD1(db) } as any, 'fr', {
    kind: 'moderation', subject: 'A case for HQ',
  });

  const r = await call(`/escalations/${uid}`, {
    method: 'PATCH', body: JSON.stringify({ answer: 'Take it locally.', status: 'declined' }),
  });
  assert.equal(r.status, 200, 'an unreachable branch turned HQ\'s recorded decision into an error');
  assert.equal(r.body.pushed.ok, false);
  assert.match(String(r.body.pushed.reason), /did not accept the decision/,
    'the failure is reported without saying what went wrong');
  assert.match(String(r.body.pushed.reason), /no such deployment/,
    'the branch\'s own reason is swallowed, so nobody can tell why');

  const [row] = db.prepare('SELECT * FROM hq_escalations').all() as any[];
  assert.equal(row.answer, 'Take it locally.', 'a failed push rolled back a decision HQ made');
  assert.equal(row.status, 'declined');
});

test('a branch that REFUSES the push has its reason surfaced, not overwritten with success', async () => {
  // The branch answers `{ok:false, reason}` rather than throwing when it holds
  // no local row for this uid (D112 — a row is never invented from a push).
  // That is a real state and must survive the handler: collapsing every
  // non-throwing reply to `{ok:true}` would report a decision as delivered to
  // a branch that does not have it.
  const db = hqDb();
  const refuses = {
    applyEscalationAnswer: () => ({ ok: false, reason: 'This branch has no escalation with HQ uid' }),
  };
  const call = appFor(adminEscalations, '/api/admin', {
    DB: makeD1(db), JWT_SECRET, BRANCH_FR: refuses,
  });
  const { uid } = await recordEscalation({ DB: makeD1(db) } as any, 'fr', {
    kind: 'other', subject: 'Raised before the mirror existed',
  });

  const r = await call(`/escalations/${uid}`, {
    method: 'PATCH', body: JSON.stringify({ answer: 'Noted.' }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.pushed.ok, false, 'a refusal from the branch was reported as a successful push');
  assert.match(String(r.body.pushed.reason), /no escalation with HQ uid/);
});

test('answering needs the elevation, and a refused caller writes nothing', async () => {
  const db = hqDb();
  const call = appFor(adminEscalations, '/api/admin', { DB: makeD1(db), JWT_SECRET });
  const { uid } = await recordEscalation({ DB: makeD1(db) } as any, 'fr', { kind: 'other', subject: 'x' });

  const r = await call(`/escalations/${uid}`, {
    method: 'PATCH', body: JSON.stringify({ answer: 'yes' }),
  }, PLAIN);
  assert.equal(r.status, 403);
  assert.equal((db.prepare('SELECT * FROM hq_escalations').all() as any[])[0].answer, null);

  const read = await call('/escalations', {}, PLAIN);
  assert.equal(read.status, 403);
});

test('an escalation that does not exist is 404', async () => {
  const db = hqDb();
  const call = appFor(adminEscalations, '/api/admin', { DB: makeD1(db), JWT_SECRET });
  const r = await call('/escalations/esc_nope', {
    method: 'PATCH', body: JSON.stringify({ answer: 'yes' }),
  });
  assert.equal(r.status, 404);
});

test('the board filters by kind and status, and refuses values outside the vocabularies', async () => {
  const db = hqDb();
  const env = { DB: makeD1(db), JWT_SECRET } as any;
  const a = await recordEscalation(env, 'fr', { kind: 'content', subject: 'Localised post' });
  await recordEscalation(env, 'fr', { kind: 'moderation', subject: 'A listing' });
  await answerEscalation(env, a.uid, { answer: 'Approved', answered_by_user_id: HOLDER, answered_by_name: 'Sue' });

  const call = appFor(adminEscalations, '/api/admin', env);

  // H6's lane: content, whatever its status — an approved localisation is
  // still a localisation, and a lane that hid it would lose the decision.
  const content = await call('/escalations?kind=content');
  assert.equal(content.body.items.length, 1);
  assert.equal(content.body.items[0].kind, 'content');
  assert.equal(content.body.items[0].answer, 'Approved');

  // H1's zone: what is still awaiting HQ.
  const open = await call('/escalations?status=open');
  assert.deepEqual(open.body.items.map((x: any) => x.kind), ['moderation']);

  for (const [q, err] of [['status=settled', 'bad_status'], ['kind=billing', 'bad_kind']]) {
    const bad = await call(`/escalations?${q}`);
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, err);
  }
});

test('every listed escalation carries an SLA band derived on read, never stored', async () => {
  const db = hqDb();
  const env = { DB: makeD1(db), JWT_SECRET } as any;
  await recordEscalation(env, 'fr', { kind: 'moderation', subject: 'Due in 24h' });

  const rows = await listEscalations(env, {});
  assert.equal(rows.length, 1);
  assert.ok(['ok', 'due_soon', 'past'].includes(rows[0].sla));
  // The band is a function of the date and NOW — proven by asking for a band
  // at a time past the due date rather than by trusting the stored row.
  const due = rows[0].due_at!;
  assert.equal(slaBand(due, Date.parse(due) + 1000), 'past');
  assert.equal(slaBand(due, Date.parse(due) - 48 * 3600_000), 'ok');
  // And nothing wrote a band into the table.
  const cols = db.prepare('PRAGMA table_info(hq_escalations)').all() as any[];
  assert.equal(cols.some((c) => /sla|band/i.test(c.name)), false, 'the band was stored');
});

/* ------------------------------------------------------------------ *
 * The answer reaches the branch                                       *
 * ------------------------------------------------------------------ */

test('the push matches on HQ\'s uid and updates the branch\'s own row', async () => {
  const db = branchDb();
  const env = { DB: makeD1(db), BRANCH_CODE: 'fr' } as any;
  db.prepare(
    `INSERT INTO branch_escalations (hq_uid, kind, subject, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?)`,
  ).run('esc_abc', 'seat_increase', 'Four more seats', 'open', '2026-09-15T00:00:00Z', '2026-09-15T00:00:00Z');

  const res = await applyEscalationAnswer(env, {
    hq_uid: 'esc_abc', answer: 'Granted for Q4.', answered_by_name: 'Sue Hart',
    answered_at: '2026-09-15T12:00:00Z', status: 'answered', pushed_at: '2026-09-15T12:00:01Z',
  });
  assert.deepEqual(res, { ok: true });

  const [row] = db.prepare('SELECT * FROM branch_escalations').all() as any[];
  assert.equal(row.answer, 'Granted for Q4.');
  assert.equal(row.status, 'answered');
  // A NAME, NOT AN ID — the two id spaces collide (D104).
  assert.equal(row.answered_by_name, 'Sue Hart');
  const cols = db.prepare('PRAGMA table_info(branch_escalations)').all() as any[];
  assert.equal(cols.some((c) => c.name === 'answered_by_user_id'), false,
    'an HQ user id is stored where a local id would be joined');
  // HQ's stamp, not this database's write time.
  assert.equal(row.pushed_at, '2026-09-15T12:00:01Z');
});

test('a push for a uid this branch never raised is reported, never inserted', async () => {
  const db = branchDb();
  const env = { DB: makeD1(db), BRANCH_CODE: 'fr' } as any;

  const res = await applyEscalationAnswer(env, {
    hq_uid: 'esc_someone_else', answer: 'Granted', answered_by_name: 'Sue',
    answered_at: '2026-09-15T12:00:00Z', status: 'answered', pushed_at: '2026-09-15T12:00:01Z',
  });
  assert.equal(res.ok, false);
  assert.match(String(res.reason), /no escalation with HQ uid/);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM branch_escalations').get() as any).n, 0,
    'a push invented a local row for an escalation nobody here raised');
});

test('HQ\'s wider status vocabulary collapses to the branch\'s two, rather than drifting', async () => {
  const db = branchDb();
  const env = { DB: makeD1(db), BRANCH_CODE: 'fr' } as any;
  const ins = db.prepare(
    `INSERT INTO branch_escalations (hq_uid, kind, subject, status, created_at, updated_at)
     VALUES (?,?,?,'open','2026-09-15T00:00:00Z','2026-09-15T00:00:00Z')`,
  );
  ins.run('esc_a', 'other', 'One');
  ins.run('esc_b', 'other', 'Two');

  // 'declined' and 'withdrawn' are both decided as far as the lane is
  // concerned. Storing them verbatim would need two more CHECK values and a
  // second vocabulary to keep in step with HQ's.
  await applyEscalationAnswer(env, {
    hq_uid: 'esc_a', answer: 'No', answered_by_name: 'Sue',
    answered_at: '2026-09-15T12:00:00Z', status: 'declined', pushed_at: '2026-09-15T12:00:01Z',
  });
  await applyEscalationAnswer(env, {
    hq_uid: 'esc_b', answer: 'Dropped', answered_by_name: 'Sue',
    answered_at: '2026-09-15T12:00:00Z', status: 'withdrawn', pushed_at: '2026-09-15T12:00:01Z',
  });

  const rows = db.prepare('SELECT hq_uid, status FROM branch_escalations ORDER BY hq_uid').all() as any[];
  assert.deepEqual(rows.map((r) => r.status), ['answered', 'answered']);
});

test('the branch lane lists newest first with the same SLA band HQ uses', async () => {
  const db = branchDb();
  const env = { DB: makeD1(db), BRANCH_CODE: 'fr' } as any;
  const ins = db.prepare(
    `INSERT INTO branch_escalations (hq_uid, kind, subject, status, due_at, created_at, updated_at)
     VALUES (?,?,?,'open',?,?,?)`,
  );
  ins.run('esc_old', 'other', 'Older', '2030-01-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
  ins.run('esc_new', 'other', 'Newer', '2020-01-01T00:00:00Z', '2026-09-14T00:00:00Z', '2026-09-14T00:00:00Z');

  const out = await branchEscalations(env);
  assert.equal(out.branch, 'fr');
  assert.deepEqual(out.items.map((i) => i.hq_uid), ['esc_new', 'esc_old']);
  assert.equal(out.items[0].sla, 'past', 'a long-overdue item does not read as past SLA');
  assert.equal(out.items[1].sla, 'ok');
});

test('the branch ops refuse to run at HQ', async () => {
  const db = branchDb();
  const atHq = { DB: makeD1(db) } as any;
  await assert.rejects(() => branchEscalations(atHq), /only live on a branch/);
  await assert.rejects(() => applyEscalationAnswer(atHq, {
    hq_uid: 'x', answer: 'y', answered_by_name: 'z',
    answered_at: 'a', status: 'answered', pushed_at: 'b',
  }), /only live on a branch/);
});
