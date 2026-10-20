/**
 * D799 (#2232) — the Administrator's requests to HQ, answered in the bell.
 *
 * On HQ, where today's Administrators hold their licences (D286), the
 * Administrator raises a renewal, a term change, more seats, a delegate or
 * notice of non-renewal through `/api/licence/mine/requests`, which writes
 * `hq_escalations` under `branch_code = 'hq'` against their own licence. HQ
 * answers on its escalation board, and the answer writes one bell notice for
 * the raiser. On a branch the same call is the branch's "To HQ" lane, and the
 * branch tells its own raiser when HQ's decision lands.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/licence_requests_d799.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import licenceRequests from '../src/routes/licence_requests.ts';
import adminEscalations from '../src/routes/admin_escalations.ts';
import {
  recordEscalation, escalationSlaBand, SLA_HOURS, ESCALATION_KINDS, HQ_TIER_CODE,
} from '../src/rpc/hqOps.ts';
import { applyEscalationAnswer } from '../src/rpc/branchOps.ts';
import {
  parseRequest, encodeRequestDetail, decodeRequestDetail, REQUEST_REFUSALS,
} from '../src/services/escalationRequests.ts';
import { REQUEST_ANSWER_TYPE, REQUEST_ANSWER_LINK } from '../src/services/escalationAnswerNotice.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const MIGRATIONS = [259, 261, 288, 296].map((n) => {
  const name = {
    259: '259_hq_escalations', 261: '261_branch_escalations', 288: '288_escalation_delivery', 296: '296_escalation_relation',
  }[n as 259 | 261 | 288 | 296];
  return read(`cloudflare-worker/sql/migrations/${name}.sql`);
});

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 7;        // administers lic_fr
const OTHER_ADMIN = 8;  // administers lic_de
const FOUNDER = 9;      // administers nothing
const SUPER = 10;       // HQ's Super Admin

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

/** HQ: two licences, each with its Administrator, a founder and HQ's Super Admin. */
function hqDb(opts: { frKind?: string; frStatus?: string } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(USERS);
  db.exec(`
    CREATE TABLE territory_licences (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      kind TEXT NOT NULL DEFAULT 'subsidiary', status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE licence_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL UNIQUE, admin_role TEXT NOT NULL DEFAULT 'principal');
    CREATE TABLE licence_deployments (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE, hostname TEXT NOT NULL, worker_name TEXT NOT NULL, d1_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'live', rpc_secret_hash TEXT);
  `);
  for (const m of MIGRATIONS) db.exec(m);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(ADMIN, 'admin', 'Amélie Roux', 'amelie@example.com');
  u.run(OTHER_ADMIN, 'admin', 'Dieter Kraus', 'dieter@example.com');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.com');
  u.run(SUPER, 'admin', 'Sue Hart', 'sue@example.com');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare('INSERT INTO territory_licences (id, uid, kind, status) VALUES (1, ?, ?, ?)')
    .run('lic_fr', opts.frKind ?? 'subsidiary', opts.frStatus ?? 'active');
  db.prepare('INSERT INTO territory_licences (id, uid) VALUES (2, ?)').run('lic_de');
  db.prepare('INSERT INTO licence_admins (licence_id, user_id) VALUES (1, ?)').run(ADMIN);
  db.prepare('INSERT INTO licence_admins (licence_id, user_id) VALUES (2, ?)').run(OTHER_ADMIN);
  return db;
}

async function token(userId: number, role = 'admin') {
  return new SignJWT({ user_id: userId, role })
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
  return async (path: string, init: RequestInit = {}, userId: number | null = ADMIN) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (userId !== null) headers.Authorization = `Bearer ${await token(userId)}`;
    const res = await app.request(`${prefix}${path}`, { ...init, headers }, env);
    return { status: res.status, body: await res.json() as any };
  };
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const rows = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare('SELECT * FROM hq_escalations ORDER BY id').all() as any[];

/** A valid raise of each new kind, and of a seat increase. */
const RAISES: Record<string, Record<string, unknown>> = {
  renewal: { kind: 'renewal', subject: 'Renew for three years', request: { term_years: 3 } },
  terms_change: {
    kind: 'terms_change', subject: 'More founder seats in the territory',
    request: { term: 'seats', current: '20 founder seats', asked: '30 founder seats' }, detail: 'Cohort 4 is larger.',
  },
  delegate: { kind: 'delegate', subject: 'Add a delegate admin', request: { email: 'Lea@Example.com', name: 'Léa Martin' } },
  non_renewal: { kind: 'non_renewal', subject: 'We will not renew', detail: 'Winding down the territory.' },
  seat_increase: { kind: 'seat_increase', subject: 'Ten more investor seats', request: { seat_type: 'investor', seats: 10 } },
};

/* ------------------------------------------------------------------ *
 * The kinds and their response times                                  *
 * ------------------------------------------------------------------ */

test('the four new kinds join the vocabulary with their response times', () => {
  for (const k of ['renewal', 'terms_change', 'delegate', 'non_renewal']) {
    assert.ok((ESCALATION_KINDS as readonly string[]).includes(k), `${k} is not a kind`);
  }
  assert.equal(SLA_HOURS.renewal, 72);
  assert.equal(SLA_HOURS.terms_change, 120);
  assert.equal(SLA_HOURS.delegate, 72);
  assert.equal(SLA_HOURS.non_renewal, 72);
});

test('the response-time bands for the new kinds are measured against their own hours', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const at = (hours: number) => new Date(now + hours * 3600_000).toISOString();
  // A term change has 120 h, so 100 h still to go is well inside it…
  assert.equal(escalationSlaBand({ kind: 'terms_change', due_at: at(100) }, now), 'ok');
  // …and an elapsed due date is past, whatever the kind.
  for (const kind of ['renewal', 'terms_change', 'delegate', 'non_renewal']) {
    assert.equal(escalationSlaBand({ kind, due_at: at(-1) }, now), 'past', kind);
  }
  // Under a day left is due soon for a 72-hour kind.
  assert.equal(escalationSlaBand({ kind: 'delegate', due_at: at(10) }, now), 'due_soon');
});

/* ------------------------------------------------------------------ *
 * The HQ-tier lane                                                     *
 * ------------------------------------------------------------------ */

test('an HQ-tier Administrator raises each new kind, filed against their own licence', async () => {
  const db = hqDb();
  const call = appFor(licenceRequests, '/api/licence', { DB: makeD1(db), JWT_SECRET });
  const before = Date.now();
  for (const [kind, body] of Object.entries(RAISES)) {
    const r = await call('/mine/requests', post(body));
    assert.equal(r.status, 201, `${kind}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.kind, kind);
    assert.equal(r.body.subject_ref, 'lic_fr', `${kind} is not filed against the caller's licence`);
    assert.equal(r.body.status, 'open');
    assert.equal(r.body.raised_by_branch_user_id, ADMIN);
    assert.equal(r.body.raised_by_name, 'Amélie Roux');
    const due = Date.parse(r.body.due_at) - before;
    assert.ok(Math.abs(due - SLA_HOURS[kind as keyof typeof SLA_HOURS] * 3600_000) < 60_000, `${kind}'s due date`);
  }
  const stored = rows(db);
  assert.equal(stored.length, 5);
  for (const row of stored) assert.equal(row.branch_code, HQ_TIER_CODE);
  const byKind = Object.fromEntries(stored.map((row) => [row.kind, decodeRequestDetail(row.detail)]));
  assert.deepEqual(byKind.renewal, { request: { term_years: 3 }, note: null });
  assert.deepEqual(byKind.terms_change, {
    request: { term: 'seats', current: '20 founder seats', asked: '30 founder seats' }, note: 'Cohort 4 is larger.',
  });
  assert.deepEqual(byKind.delegate.request, { email: 'lea@example.com', name: 'Léa Martin' });
  assert.deepEqual(byKind.seat_increase.request, { seat_type: 'investor', seats: 10 });
  // The notice date is the day HQ records the notice.
  assert.equal(byKind.non_renewal.request.notice_given_on, new Date().toISOString().slice(0, 10));
  assert.equal(byKind.non_renewal.note, 'Winding down the territory.');
});

test('the read lists only the caller\'s own licence\'s requests, with each request read out', async () => {
  const db = hqDb();
  const env = { DB: makeD1(db), JWT_SECRET };
  const call = appFor(licenceRequests, '/api/licence', env);
  await call('/mine/requests', post(RAISES.renewal), ADMIN);
  await call('/mine/requests', post(RAISES.delegate), OTHER_ADMIN);
  const mine = await call('/mine/requests', {}, ADMIN);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.licence_uid, 'lic_fr');
  assert.equal(mine.body.items.length, 1, 'another licence\'s request was listed');
  assert.equal(mine.body.items[0].kind, 'renewal');
  assert.deepEqual(mine.body.items[0].request, { term_years: 3 });
  assert.ok(['ok', 'due_soon', 'past'].includes(mine.body.items[0].sla));
  assert.equal(mine.body.response_hours.terms_change, 120);
  const theirs = await call('/mine/requests', {}, OTHER_ADMIN);
  assert.deepEqual(theirs.body.items.map((i: any) => i.kind), ['delegate']);
});

test('a founder administers no licence, gets no_licence, and writes nothing', async () => {
  const db = hqDb();
  const call = appFor(licenceRequests, '/api/licence', { DB: makeD1(db), JWT_SECRET });
  const g = await call('/mine/requests', {}, FOUNDER);
  assert.equal(g.status, 404);
  assert.equal(g.body.error, 'no_licence');
  const p = await call('/mine/requests', post(RAISES.renewal), FOUNDER);
  assert.equal(p.status, 404);
  assert.equal(p.body.error, 'no_licence');
  assert.equal(rows(db).length, 0);
  const anon = await call('/mine/requests', {}, null);
  assert.equal(anon.status, 401);
});

test('a suspended licence can still raise: the request is the way out', async () => {
  const db = hqDb({ frStatus: 'suspended' });
  const call = appFor(licenceRequests, '/api/licence', { DB: makeD1(db), JWT_SECRET });
  const r = await call('/mine/requests', post({ kind: 'other', subject: 'Please review the suspension' }));
  assert.equal(r.status, 201);
  const g = await call('/mine/requests');
  assert.equal(g.body.licence_status, 'suspended');
  assert.equal(g.body.items.length, 1);
});

test('a kind the licence hides is refused with its reason, and writes no row', async () => {
  const db = hqDb({ frKind: 'white_label' });
  const call = appFor(licenceRequests, '/api/licence', { DB: makeD1(db), JWT_SECRET });
  const r = await call('/mine/requests', post({ kind: 'content', subject: 'A brand approval' }));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'kind_not_available');
  assert.match(r.body.message, /no brand desk/);
  assert.equal(r.body.licence_kind, 'white_label');
  assert.equal(rows(db).length, 0);
  const g = await call('/mine/requests');
  assert.deepEqual(g.body.kinds_hidden.map((h: any) => h.kind), ['content']);
});

test('each kind\'s rule refuses with its own sentence, and writes no row', async () => {
  const db = hqDb();
  const call = appFor(licenceRequests, '/api/licence', { DB: makeD1(db), JWT_SECRET });
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ kind: 'terms_change', subject: 'x', request: { current: 'a', asked: 'b' } }, 'term_required'],
    [{ kind: 'terms_change', subject: 'x', request: { term: 'logo', current: 'a', asked: 'b' } }, 'bad_term'],
    [{ kind: 'terms_change', subject: 'x', request: { term: 'fee', current: 'a' } }, 'term_values_required'],
    [{ kind: 'terms_change', subject: 'x' }, 'request_required'],
    [{ kind: 'seat_increase', subject: 'x', request: { seats: 4 } }, 'seat_type_required'],
    [{ kind: 'seat_increase', subject: 'x', request: { seat_type: 'founder', seats: 0 } }, 'seats_required'],
    [{ kind: 'seat_increase', subject: 'x' }, 'request_required'],
    [{ kind: 'delegate', subject: 'x', request: { name: 'No Email' } }, 'delegate_email_required'],
    [{ kind: 'delegate', subject: 'x', request: { email: 'not-an-address' } }, 'bad_delegate_email'],
    [{ kind: 'renewal', subject: 'x', request: { term_years: 0 } }, 'bad_renewal_term'],
    [{ kind: 'non_renewal', subject: 'x', request: { notice_given_on: '2026-01-01' } }, 'notice_date_not_accepted'],
    [{ kind: 'renewal', subject: 'x', request: { term_years: 3, discount: 'yes' } }, 'unknown_request_field'],
    [{ kind: 'other', subject: 'x', request: { term: 'fee' } }, 'request_not_for_kind'],
    [{ kind: 'renewal', subject: 'x', request: 'three years' }, 'bad_request'],
    [{ kind: 'renewal', subject: '' }, 'subject_required'],
    [{ kind: 'upgrade', subject: 'x' }, 'bad_kind'],
    [{ kind: 'other', subject: 'x', subject_ref: 'lic_de' }, 'subject_ref_not_accepted'],
  ];
  for (const [body, error] of cases) {
    const r = await call('/mine/requests', post(body));
    assert.equal(r.status, 400, `${error}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error, error);
    assert.ok(String(r.body.message).length > 20, `${error} has no sentence`);
    if (error in REQUEST_REFUSALS) assert.equal(r.body.message, (REQUEST_REFUSALS as any)[error]);
  }
  assert.equal(rows(db).length, 0, 'a refused request wrote a row');
});

test('one licence holds at most twenty open requests', async () => {
  const db = hqDb();
  const call = appFor(licenceRequests, '/api/licence', { DB: makeD1(db), JWT_SECRET });
  for (let i = 0; i < 20; i += 1) {
    assert.equal((await call('/mine/requests', post({ kind: 'other', subject: `Request ${i}` }))).status, 201);
  }
  const r = await call('/mine/requests', post({ kind: 'other', subject: 'One too many' }));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'too_many_open');
  assert.equal(rows(db).length, 20);
  // Another licence is not counted against this one.
  assert.equal((await call('/mine/requests', post({ kind: 'other', subject: 'Mine' }), OTHER_ADMIN)).status, 201);
});

/* ------------------------------------------------------------------ *
 * HQ's answer, in the bell                                             *
 * ------------------------------------------------------------------ */

test('HQ\'s answer writes one bell notice for the raiser, and nobody else', async () => {
  const db = hqDb();
  const env = { DB: makeD1(db), JWT_SECRET };
  const lane = appFor(licenceRequests, '/api/licence', env);
  const board = appFor(adminEscalations, '/api/admin', env);
  const raised = await lane('/mine/requests', post(RAISES.terms_change));
  assert.equal(raised.status, 201);

  const listed = await board('/escalations?kind=terms_change', {}, SUPER);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.items.length, 1);
  assert.equal(listed.body.items[0].request.term, 'seats', 'HQ\'s board does not read the request out');

  const answered = await board(`/escalations/${raised.body.uid}`, {
    method: 'PATCH', body: JSON.stringify({ answer: 'Agreed: 30 founder seats from 1 November.' }),
  }, SUPER);
  assert.equal(answered.status, 200, JSON.stringify(answered.body));
  assert.equal(answered.body.notified.ok, true);
  assert.equal(answered.body.pushed, undefined, 'an HQ-tier answer was pushed to a branch');

  const inbox = db.prepare('SELECT * FROM notifications_inbox').all() as any[];
  assert.equal(inbox.length, 1, 'not exactly one bell notice');
  assert.equal(inbox[0].user_id, ADMIN);
  assert.equal(inbox[0].type, REQUEST_ANSWER_TYPE);
  assert.equal(inbox[0].link, REQUEST_ANSWER_LINK);
  assert.equal(inbox[0].link, '/admin/my-licence/requests');
  assert.equal(inbox[0].category, 'compliance');
  assert.match(inbox[0].title, /^HQ answered your request: More founder seats/);
  assert.match(inbox[0].body, /30 founder seats/);

  const declined = await lane('/mine/requests', post(RAISES.delegate));
  const d = await board(`/escalations/${declined.body.uid}`, {
    method: 'PATCH', body: JSON.stringify({ answer: 'Not this quarter.', status: 'declined' }),
  }, SUPER);
  assert.equal(d.body.notified.ok, true);
  const titles = (db.prepare('SELECT title FROM notifications_inbox ORDER BY id').all() as any[]).map((r) => r.title);
  assert.match(titles[1], /^HQ declined your request/);
});

test('sending an HQ-tier decision again is the bell notice again', async () => {
  const db = hqDb();
  const env = { DB: makeD1(db), JWT_SECRET };
  const lane = appFor(licenceRequests, '/api/licence', env);
  const board = appFor(adminEscalations, '/api/admin', env);
  const raised = await lane('/mine/requests', post(RAISES.renewal));
  await board(`/escalations/${raised.body.uid}`, { method: 'PATCH', body: JSON.stringify({ answer: 'Renewed.' }) }, SUPER);
  const again = await board(`/escalations/${raised.body.uid}/resend`, { method: 'POST' }, SUPER);
  assert.equal(again.status, 200);
  assert.equal(again.body.notified.ok, true);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM notifications_inbox WHERE user_id = ?').get(ADMIN) as any).n, 2);
});

/* ------------------------------------------------------------------ *
 * The branch path                                                      *
 * ------------------------------------------------------------------ */

test('HQ checks again what a branch sends: a new kind needs its request, an older seat increase may be text', async () => {
  const db = hqDb();
  db.prepare(
    `INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name) VALUES (?,?,?,?,?)`,
  ).run('lic_fr', 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr');
  const env: any = { DB: makeD1(db) };
  const bare = await recordEscalation(env, 'fr', { kind: 'terms_change', subject: 'Seats' });
  assert.equal((bare as any).refused, 'request_required');
  const text = await recordEscalation(env, 'fr', { kind: 'seat_increase', subject: 'Four more seats', detail: 'Cohort 3' });
  assert.equal((text as any).status, 'open');
  const ok = await recordEscalation(env, 'fr', {
    kind: 'non_renewal', subject: 'We will not renew', detail: encodeRequestDetail({}, 'Winding down'),
  });
  assert.equal((ok as any).status, 'open');
  const stored = rows(db);
  assert.equal(stored.length, 2, 'a refused request was recorded');
  assert.equal(stored[0].detail, 'Cohort 3', 'an older text raise was rewritten');
  const notice = decodeRequestDetail(stored[1].detail);
  assert.equal(notice.request?.notice_given_on, new Date().toISOString().slice(0, 10));
  assert.equal(notice.note, 'Winding down');
});

test('on a branch the same call is the branch lane, which stores the request and sends it to HQ', async () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(USERS);
  db.exec('CREATE TABLE branch_licence (id INTEGER PRIMARY KEY, status TEXT, pushed_at TEXT, kind TEXT);');
  for (const m of MIGRATIONS) db.exec(m);
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)').run(ADMIN, 'admin', 'Amélie Roux', 'a@example.com');
  db.prepare('INSERT INTO branch_licence (id, status, pushed_at, kind) VALUES (1, ?, ?, ?)').run('active', '2026-10-01T00:00:00Z', 'subsidiary');
  const seen: any[] = [];
  const HQ = { async escalate(code: string, item: any) { seen.push({ code, item }); return { uid: 'esc_hq1', due_at: '2026-10-25T00:00:00Z', status: 'open' }; } };
  const call = appFor(licenceRequests, '/api/licence', { DB: makeD1(db), JWT_SECRET, BRANCH_CODE: 'fr', HQ });

  const r = await call('/mine/requests', post(RAISES.terms_change));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.hq_uid, 'esc_hq1');
  assert.equal(seen.length, 1);
  assert.deepEqual(decodeRequestDetail(seen[0].item.detail).request, RAISES.terms_change.request);
  const local = db.prepare('SELECT detail FROM branch_escalations').get() as any;
  assert.deepEqual(decodeRequestDetail(local.detail).request, RAISES.terms_change.request);

  const bad = await call('/mine/requests', post({ kind: 'terms_change', subject: 'x', request: { asked: 'more' } }));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'term_required');
  assert.equal(seen.length, 1, 'a refused request reached HQ');

  const lane = await call('/mine/requests');
  assert.equal(lane.status, 200);
  assert.deepEqual(lane.body.items[0].request, RAISES.terms_change.request);
});

test('a branch tells its own raiser when HQ\'s decision lands', async () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(USERS);
  for (const m of MIGRATIONS) db.exec(m);
  db.prepare(
    `INSERT INTO branch_escalations (hq_uid, kind, subject, raised_by_user_id, raised_by_name, status, created_at, updated_at)
     VALUES ('esc_hq2', 'renewal', 'Renew for three years', ?, 'Amélie Roux', 'open', '2026-10-20', '2026-10-20')`,
  ).run(ADMIN);
  const res = await applyEscalationAnswer({ DB: makeD1(db), BRANCH_CODE: 'fr' } as any, {
    hq_uid: 'esc_hq2', answer: 'Renewed to 2029.', answered_by_name: 'Sue Hart',
    answered_at: '2026-10-21T00:00:00Z', status: 'answered', pushed_at: '2026-10-21T00:00:00Z',
  });
  assert.equal(res.ok, true);
  const inbox = db.prepare('SELECT user_id, type, link FROM notifications_inbox').all() as any[];
  assert.deepEqual(inbox.map((n) => ({ ...n })), [{ user_id: ADMIN, type: REQUEST_ANSWER_TYPE, link: REQUEST_ANSWER_LINK }]);
});

test('the rule itself: a kind with no request reads as none, and plain text reads back as a note', () => {
  assert.deepEqual(parseRequest('moderation', undefined), { ok: true, request: null });
  assert.deepEqual(parseRequest('seat_increase', undefined), { ok: true, request: null });
  assert.equal((parseRequest('seat_increase', undefined, { required: true }) as any).error, 'request_required');
  assert.deepEqual(parseRequest('renewal', undefined), { ok: true, request: { term_years: null } });
  assert.deepEqual(decodeRequestDetail('Just a note'), { request: null, note: 'Just a note' });
  assert.deepEqual(decodeRequestDetail('{"v":1,"request":{"term_years":2},"note":"n"}'), { request: { term_years: 2 }, note: 'n' });
});
