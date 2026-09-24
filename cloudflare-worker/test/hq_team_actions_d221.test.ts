/**
 * D221 — the two HQ-only acts on H20 whose record was weaker than the page says.
 *
 * 1. EXTENDING A SUPPORT SESSION ON AN ADMINISTRATOR. D133 made opening one
 *    the holder's alone, and `POST /impersonate-sessions/:id/extend` said in
 *    its own comment that it "re-checks everything the original grant
 *    checked". It re-ran the holder guard and not D133's. So a session the
 *    holder opened on an administrator could be extended, thirty minutes at a
 *    time, by the same account after it had handed the elevation on — an
 *    account that could no longer OPEN that session. The test takes the
 *    elevation away between the grant and the extension, which is the one
 *    order in which the missing guard is observable.
 *
 * 2. TRANSFERRING THE ELEVATION. The most consequential write on the platform
 *    was the one HQ-only act with no typed reason, and its two audit rows were
 *    a raw INSERT that left `viewed_user_id` empty — the column HQ Security's
 *    feed joins to name who an act was about. So the feed showed a transfer
 *    with no target and no why. The transfer now takes a reason and writes
 *    through `logAdminAction`, and both are asserted by reading the rows back.
 *
 * THE TABLES COME FROM THE BASELINE, verbatim, so a fixture narrower than
 * production fails here rather than passing against a shape nothing runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import admin from '../src/routes/admin.ts';
import superAdmins, { HOLDER_REASON_MIN } from '../src/routes/admin_super_admins.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 801;
const SUCCESSOR = 802;
const MEMBER = 803;
const REASON = 'Ticket 5120 — the branch admin asked for help with their seats';
// D248 — Extend asks for its own reason, at least 10 characters.
const EXTEND_REASON = 'Still on the same ticket; the fix needs one more step.';
const HANDOVER = 'Guillaume steps back from operations; Sam runs HQ from October';

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
        __sql: sql,
        __binds: () => b,
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    // The transfer's two writes go in one batch; run them in order, as D1 does.
    async batch(stmts: any[]) {
      const out: any[] = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
}

const BASELINE = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8',
);
/** One table's CREATE TABLE, verbatim. A literal search, never a built regex. */
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  for (const t of [
    'users', 'super_admins', 'user_sessions', 'activity_logs',
    'impersonation_sessions', 'admin_audit_log', 'notifications_inbox',
  ]) db.exec(ddl(t));
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(HOLDER, 'admin', 'Holder Hart', 'holder@axal.example');
  u.run(SUCCESSOR, 'admin', 'Sam Successor', 'sam@axal.example');
  u.run(MEMBER, 'founder', 'Fran Founder', 'fran@example.com');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  // requireFactor wants factor='totp'; requireStepUp wants it RECENT.
  const sess = db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at)
     VALUES (?, ?, 'totp', datetime('now'), datetime('now'))`,
  );
  for (const id of [HOLDER, SUCCESSOR]) sess.run(`totp-${id}`, id);
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) }) as any;

/**
 * An env whose D1 runs `interleave` at the moment the route reads the holder
 * set — AFTER the write bar has read the caller's own row, BEFORE the ceiling
 * decides. That gap is where a concurrent request lands, and a test that
 * cannot put something in it cannot see what the route does there (the D143
 * precedent). The holder read is the only statement that selects FROM
 * super_admins and joins users on its key; `userById` joins the other way.
 */
function racingEnv(db: InstanceType<typeof DatabaseSync>, interleave: () => void) {
  const base = makeD1(db);
  return {
    JWT_SECRET, ENVIRONMENT: 'development',
    DB: {
      ...base,
      prepare(sql: string) {
        if (sql.includes('FROM super_admins s') && sql.includes('JOIN users u ON u.id = s.user_id')) interleave();
        return base.prepare(sql);
      },
    },
  } as any;
}

async function jwtFor(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', jti: `totp-${userId}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  app: any, db: InstanceType<typeof DatabaseSync>, actor: number, path: string,
  body?: Record<string, unknown>, e: any = env(db),
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await jwtFor(actor)}` };
  if (body) headers['content-type'] = 'application/json';
  const res = await app.fetch(
    new Request(`http://x${path}`, {
      method: 'POST', headers, body: body ? JSON.stringify(body) : undefined,
    }),
    e,
  );
  let parsed: any = null;
  try { parsed = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: parsed };
}

const holderIds = (db: any) =>
  (db.prepare('SELECT user_id FROM super_admins ORDER BY user_id').all() as any[]).map((r) => r.user_id);
const auditRows = (db: any) =>
  db.prepare('SELECT action, admin_user_id, viewed_user_id, filters_json FROM admin_audit_log ORDER BY id').all() as any[];
const actions = (db: any) =>
  (db.prepare('SELECT action FROM activity_logs ORDER BY id').all() as any[]).map((r) => r.action);

/** The holder opens a support session on SUCCESSOR, an administrator. */
async function openOnAdmin(db: InstanceType<typeof DatabaseSync>): Promise<number> {
  const r = await call(admin, db, HOLDER, `/impersonate/${SUCCESSOR}?context=${encodeURIComponent(REASON)}`);
  assert.equal(r.status, 200, `the holder could not open a session on an administrator: ${JSON.stringify(r.body)}`);
  const id = Number(r.body?.impersonation_session_id);
  assert.ok(id > 0, 'the grant returned no session id to extend');
  return id;
}

/* ------------------------------------------------------------------ *
 * 1. Extending a session on an administrator                          *
 * ------------------------------------------------------------------ */

test('the holder can still extend a session they opened on an administrator', async () => {
  // THE CONTROL. Without it the refusal below could pass because the route
  // refuses every extension on an administrator, which would be a different
  // defect wearing the same status code.
  const db = freshDb();
  const id = await openOnAdmin(db);
  const r = await call(admin, db, HOLDER, `/impersonate-sessions/${id}/extend`, { reason: EXTEND_REASON });
  assert.equal(r.status, 200, `the holder was refused: ${JSON.stringify(r.body)}`);
  assert.ok(typeof r.body?.token === 'string' && r.body.token.length > 20, 'no token was minted');
});

test('an account that handed the elevation on cannot extend a session on an administrator', async () => {
  const db = freshDb();
  const id = await openOnAdmin(db);
  // The elevation moves on between the grant and the extension — the one
  // order in which a missing re-check is observable.
  // Nobody else is elevated in its place: were the SUCCESSOR elevated, the
  // older holder-vs-holder guard would refuse first, under a different code,
  // and this test would stop seeing the guard it exists for.
  db.prepare('DELETE FROM super_admins WHERE user_id = ?').run(HOLDER);
  const before = actions(db).length;
  const r = await call(admin, db, HOLDER, `/impersonate-sessions/${id}/extend`, { reason: EXTEND_REASON });
  assert.equal(r.status, 403, 'an account that can no longer open this session extended it');
  assert.equal(r.body?.code, 'super_admin_required', 'the refusal does not name the line crossed');
  assert.equal(r.body?.token, undefined, 'a token was minted on a refused extension');
  assert.equal(actions(db).length, before, 'a refused extension still wrote an extend row');
});

test('extending a session on an ordinary account is unchanged', async () => {
  // D133 left impersonating a non-admin to every admin, pinned by its own
  // test; the guard must not have widened into that.
  const db = freshDb();
  db.prepare('DELETE FROM super_admins').run();
  const open = await call(admin, db, SUCCESSOR, `/impersonate/${MEMBER}?context=${encodeURIComponent(REASON)}`);
  assert.equal(open.status, 200, `a plain admin could not open a session on a founder: ${JSON.stringify(open.body)}`);
  const r = await call(admin, db, SUCCESSOR, `/impersonate-sessions/${open.body.impersonation_session_id}/extend`, { reason: EXTEND_REASON });
  assert.equal(r.status, 200, 'the new guard refuses an ordinary extension');
});

/* ------------------------------------------------------------------ *
 * 2. Transferring the elevation                                      *
 * ------------------------------------------------------------------ */

test('a transfer without a reason is refused and moves nothing', async () => {
  const db = freshDb();
  for (const body of [undefined, { reason: '' }, { reason: '   ok   ' }, { reason: 'x'.repeat(HOLDER_REASON_MIN - 1) }]) {
    const r = await call(superAdmins, db, HOLDER, `/${SUCCESSOR}?transfer=1`, body as any);
    assert.equal(r.status, 400, `a transfer with reason ${JSON.stringify(body)} was accepted`);
    assert.equal(r.body?.code, 'reason_too_short');
    assert.deepEqual(holderIds(db), [HOLDER], 'the elevation moved on a refused transfer');
    assert.equal(auditRows(db).length, 0, 'a refused transfer was recorded as a change');
  }
});

test('the refusals that name a real obstacle answer before the reason is asked for', async () => {
  // A request the role check or the ceiling would refuse anyway must say THAT,
  // not demand a sentence that would change nothing.
  const db = freshDb();
  const notAdmin = await call(superAdmins, db, HOLDER, `/${MEMBER}?transfer=1`);
  assert.equal(notAdmin.status, 409);
  assert.equal(notAdmin.body?.code, 'not_an_admin');
  const second = await call(superAdmins, db, HOLDER, `/${SUCCESSOR}`);
  assert.equal(second.status, 409, 'a second holder without the transfer flag was not refused by the ceiling');
  assert.equal(second.body?.code, 'super_admin_exists');
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(SUCCESSOR);
  const inactive = await call(superAdmins, db, HOLDER, `/${SUCCESSOR}?transfer=1`);
  assert.equal(inactive.status, 409, 'a deactivated successor was asked for a reason instead of refused');
  assert.equal(inactive.body?.code, 'not_active');
});

test('a deactivated administrator cannot receive the elevation, so it cannot be handed where nobody can use it', async () => {
  // The INSERT filters on role, not on `is_active`, and nothing else checked.
  // A transfer to an account that cannot sign in leaves the old holder without
  // the elevation and the new one unable to use it — and re-activating an
  // administrator is the holder's act alone, so nothing inside the product
  // could undo it. The reason is supplied, so the refusal is the one this
  // test is about and not the reason floor.
  const db = freshDb();
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(SUCCESSOR);
  const r = await call(superAdmins, db, HOLDER, `/${SUCCESSOR}?transfer=1`, { reason: HANDOVER });
  assert.equal(r.status, 409, `a transfer to a deactivated account was not refused: ${JSON.stringify(r.body)}`);
  assert.equal(r.body?.code, 'not_active');
  assert.deepEqual(holderIds(db), [HOLDER], 'the elevation left the one account able to use it');
  assert.equal(auditRows(db).length, 0, 'a refused transfer was recorded as a change');
});

test('an elevation that leaves while the request is in flight is refused, and nothing is granted into the gap', async () => {
  // The one way the active set reads EMPTY past the write bar: the gate and the
  // holder read are separate reads, and the elevation can leave between them.
  // Before D221 an empty set fell through to an unconditional grant, so this
  // request would have elevated SUCCESSOR into the gap. Both request shapes are
  // run, because that branch served both.
  for (const path of [`/${SUCCESSOR}?transfer=1`, `/${SUCCESSOR}`]) {
    const db = freshDb();
    let fired = 0;
    const e = racingEnv(db, () => { fired += 1; db.prepare('DELETE FROM super_admins').run(); });
    const r = await call(superAdmins, db, HOLDER, path, { reason: HANDOVER }, e);
    assert.equal(fired, 1, `${path}: the shim never saw the holder read, so it interleaved nothing`);
    assert.equal(r.status, 409, `${path}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body?.code, 'no_active_holder', `${path}: the refusal does not say the holder changed`);
    assert.deepEqual(holderIds(db), [], `${path}: the successor was granted into the gap`);
    assert.equal(auditRows(db).length, 0, `${path}: a refused request was recorded as a change`);
  }
});

test('a transfer with a reason moves the elevation and names who received it, and why', async () => {
  const db = freshDb();
  const r = await call(superAdmins, db, HOLDER, `/${SUCCESSOR}?transfer=1`, { reason: HANDOVER });
  assert.equal(r.status, 200, `the transfer failed: ${JSON.stringify(r.body)}`);
  assert.deepEqual(holderIds(db), [SUCCESSOR], 'the set is not exactly the successor');

  const rows = auditRows(db);
  const grant = rows.find((x) => x.action === 'super_admin_grant');
  const revoke = rows.find((x) => x.action === 'super_admin_revoke');
  assert.ok(grant && revoke, `both halves were not recorded: ${JSON.stringify(rows)}`);
  // `viewed_user_id` is the column the Security feed joins to name the target.
  assert.equal(grant.viewed_user_id, SUCCESSOR, 'the grant row does not name who received the elevation');
  assert.equal(revoke.viewed_user_id, HOLDER, 'the revoke row does not name who gave it up');
  for (const row of [grant, revoke]) {
    assert.equal(row.admin_user_id, HOLDER, 'the row names the wrong actor');
    const meta = JSON.parse(row.filters_json || '{}');
    assert.equal(meta.reason, HANDOVER, 'the reason did not reach the record');
    assert.equal(meta.transfer, true, 'the row does not say it was one act');
  }
});

test('the Security feed joins the column the transfer now fills', () => {
  // The feed reads `admin_audit_log` in full and names the target through
  // `viewed_user_id`. Pinned here beside the write, because the two are one
  // claim: a record the feed cannot name is not "recorded in Security".
  const feed = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/admin_security.ts'), 'utf8');
  assert.ok(feed.includes('LEFT JOIN users t ON t.id = a.viewed_user_id'),
    'the governance feed no longer names an audit row\'s target');
  const route = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/admin_super_admins.ts'), 'utf8');
  assert.ok(!route.includes('INSERT INTO admin_audit_log'),
    'the holder console writes its audit by hand again, beside the shared writer');
  assert.ok(route.includes("from '../services/adminAudit'"),
    'the holder console no longer records through logAdminAction');
});

/* ------------------------------------------------------------------ *
 * 3. D240 — two overlapping transfers                                 *
 * ------------------------------------------------------------------ */

const CONTENDER = 804;
/** A second eligible administrator, so two transfers can name different successors. */
function withContender(db: InstanceType<typeof DatabaseSync>) {
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)')
    .run(CONTENDER, 'admin', 'Cam Contender', 'cam@axal.example');
  return db;
}

/**
 * An env whose D1 parks THIS request at its batch and runs `competitor` there
 * first — after this request has passed the write bar AND read the holder set,
 * before it writes. That is the window D240 closes: both requests have read
 * the set before either writes, so no read can tell them apart and only the
 * write can. `racingEnv` above lands its competitor one step earlier, at the
 * holder read; both windows are driven.
 *
 * The competitor is a WHOLE request through the real route, not a hand-typed
 * copy of its writes, so what lands in the gap is what production would land.
 */
function racingBatchEnv(db: InstanceType<typeof DatabaseSync>, competitor: () => Promise<void>) {
  const base = makeD1(db);
  const state = { fired: 0 };
  const e = {
    JWT_SECRET, ENVIRONMENT: 'development',
    DB: {
      ...base,
      async batch(stmts: any[]) {
        if (state.fired === 0) { state.fired += 1; await competitor(); }
        return base.batch(stmts);
      },
    },
  } as any;
  return { e, state };
}

test('D240: two overlapping transfers leave exactly one holder, and the loser moves nothing', async () => {
  // A→B and A→C, both past the gate and the holder read before either writes.
  // Before D240 each batch wrote its own successor: {B, C}, two holders.
  const db = withContender(freshDb());
  let first: { status: number; body: any } | null = null;
  const { e, state } = racingBatchEnv(db, async () => {
    first = await call(superAdmins, db, HOLDER, `/${SUCCESSOR}?transfer=1`, { reason: HANDOVER });
  });
  const second = await call(superAdmins, db, HOLDER, `/${CONTENDER}?transfer=1`, { reason: HANDOVER }, e);

  assert.equal(state.fired, 1, 'the competing transfer never ran in the gap, so nothing raced');
  assert.equal(first!.status, 200, `the first transfer failed: ${JSON.stringify(first!.body)}`);
  assert.deepEqual(holderIds(db), [SUCCESSOR], 'two overlapping transfers did not leave exactly the first successor');
  assert.equal(second.status, 409, `the losing transfer was answered as a success: ${JSON.stringify(second.body)}`);
  assert.equal(second.body?.code, 'holder_changed');
  assert.match(second.body?.error, /nothing was moved/);
  assert.deepEqual(second.body?.holders, [SUCCESSOR], 'the refusal does not say who holds it now');

  // Only the first transfer is on the record: two rows, neither about C.
  const rows = auditRows(db);
  assert.equal(rows.length, 2, `the losing transfer wrote audit rows: ${JSON.stringify(rows)}`);
  assert.ok(!rows.some((r: any) => r.viewed_user_id === CONTENDER), 'a transfer that moved nothing named C as a recipient');
});

test('D240: the same race landing at the holder read is refused the same way', async () => {
  // The earlier window: the competitor has landed by the time the set is read,
  // so the reads see B holding and let the request through to the write —
  // which is where it must be stopped. The competitor here is its two writes,
  // which is all `racingEnv`'s synchronous hook can land.
  const db = withContender(freshDb());
  // The competitor lands ONCE, at the first holder read. The route reads the
  // set a second time on a refusal, to say who holds it now; that read must
  // see the landed state, not a second copy of the competitor.
  let fired = 0;
  const e = racingEnv(db, () => {
    fired += 1;
    if (fired > 1) return;
    db.prepare('INSERT INTO super_admins (user_id, granted_by_user_id) VALUES (?, ?)').run(SUCCESSOR, HOLDER);
    db.prepare('DELETE FROM super_admins WHERE user_id = ?').run(HOLDER);
  });
  const r = await call(superAdmins, db, HOLDER, `/${CONTENDER}?transfer=1`, { reason: HANDOVER }, e);
  assert.ok(fired >= 1, 'the shim never saw the holder read, so it interleaved nothing');
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body?.code, 'holder_changed');
  assert.deepEqual(holderIds(db), [SUCCESSOR], 'a request whose caller no longer held the elevation granted it anyway');
  assert.equal(auditRows(db).length, 0, 'a transfer that moved nothing was recorded as a change');
});

test('D240: a double-click is answered as the transfer it repeats, not as a failure', async () => {
  // The same transfer sent twice. The second finds the caller gone and the
  // successor holding — the end state the operator asked for — so it gets the
  // `already` answer a transfer to a current holder gets, and writes nothing.
  const db = freshDb();
  let first: { status: number; body: any } | null = null;
  const { e, state } = racingBatchEnv(db, async () => {
    first = await call(superAdmins, db, HOLDER, `/${SUCCESSOR}?transfer=1`, { reason: HANDOVER });
  });
  const second = await call(superAdmins, db, HOLDER, `/${SUCCESSOR}?transfer=1`, { reason: HANDOVER }, e);
  assert.equal(state.fired, 1);
  assert.equal(first!.status, 200);
  assert.equal(second.status, 200, `a repeated transfer read as a failure: ${JSON.stringify(second.body)}`);
  assert.equal(second.body?.already, true, 'the repeat is not answered as already done');
  assert.equal(second.body?.holder?.id, SUCCESSOR);
  assert.equal(second.body?.transferred_from, undefined, 'the repeat claims to have moved the elevation itself');
  assert.deepEqual(holderIds(db), [SUCCESSOR]);
  assert.equal(auditRows(db).length, 2, 'the repeat wrote audit rows of its own');
});

test('D240: a successor who stops being eligible mid-flight takes nothing from the caller', async () => {
  // The grant cannot land (the successor is no longer an administrator), so the
  // caller's row must stay. This is the case the DELETE's own condition exists
  // for: without it the batch would drop the caller and leave nobody holding.
  const db = freshDb();
  const { e, state } = racingBatchEnv(db, async () => {
    db.prepare("UPDATE users SET role = 'founder' WHERE id = ?").run(SUCCESSOR);
  });
  const r = await call(superAdmins, db, HOLDER, `/${SUCCESSOR}?transfer=1`, { reason: HANDOVER }, e);
  assert.equal(state.fired, 1);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body?.code, 'successor_changed', 'the refusal blames the holder, who did not change');
  assert.deepEqual(holderIds(db), [HOLDER], 'a grant that did not land still took the caller\'s elevation');
  assert.equal(auditRows(db).length, 0);
});

test('D240: a plain transfer through the racing env still lands, audited once each way', async () => {
  // The control for the four above: with nothing in the gap, the conditioned
  // writes still move the elevation, so the refusals are about the race.
  const db = freshDb();
  const { e, state } = racingBatchEnv(db, async () => { /* nothing competes */ });
  const r = await call(superAdmins, db, HOLDER, `/${SUCCESSOR}?transfer=1`, { reason: HANDOVER }, e);
  assert.equal(state.fired, 1);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body?.transferred_from, HOLDER);
  assert.deepEqual(holderIds(db), [SUCCESSOR]);
  assert.deepEqual(auditRows(db).map((x: any) => x.action), ['super_admin_grant', 'super_admin_revoke']);
});

/* ------------------------------------------------------------------ *
 * 4. D241 — both parties are told, and only when it moved             *
 * ------------------------------------------------------------------ */

// Nothing may leave the machine: a notice's email half has no provider here,
// and a test that let it try the network would be testing the network.
const outbound: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any) => {
  outbound.push(String(typeof input === 'string' ? input : input?.url));
  return new Response('no network in tests', { status: 599 });
}) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });

const notices = (db: any) =>
  db.prepare('SELECT user_id, type, title, body, link, category, severity FROM notifications_inbox ORDER BY id').all() as any[];

test('D241: a transfer that lands tells the successor and the former holder, as a security notice', async () => {
  const db = freshDb();
  const before = outbound.length;
  const r = await call(superAdmins, db, HOLDER, `/${SUCCESSOR}?transfer=1`, { reason: HANDOVER });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body?.notified, { successor: true, former: true }, 'the response does not report both notices');

  const rows = notices(db);
  assert.deepEqual(rows.map((n: any) => n.user_id).sort(), [HOLDER, SUCCESSOR].sort(), 'not exactly one notice to each party');
  for (const n of rows) {
    assert.equal(n.type, 'super_admin_transfer');
    // `security` is a CRITICAL category: quiet hours and the digest cannot hold it.
    assert.equal(n.category, 'security');
    assert.equal(n.severity, 'critical');
    assert.equal(n.link, '/admin/accounts', 'the notice does not lead to the holder console');
    assert.ok(n.body.includes(HANDOVER), 'the notice does not carry the reason the holder typed');
    assert.doesNotMatch(`${n.title} ${n.body}`, /advis|advice|recommend|fiduciar/i);
  }
  assert.match(rows.find((n: any) => n.user_id === SUCCESSOR).title, /You now hold/);
  assert.match(rows.find((n: any) => n.user_id === HOLDER).title, /You handed on/);
  assert.equal(outbound.length, before, `a notice reached the network: ${outbound.slice(before).join(', ')}`);
});

test('D241: a transfer that moves nothing tells nobody', async () => {
  // A missing reason, a lost race, a successor who stopped being eligible: each
  // is refused before or at the write, and none of them may send a notice
  // saying the elevation moved.
  const noReason = freshDb();
  await call(superAdmins, noReason, HOLDER, `/${SUCCESSOR}?transfer=1`, { reason: 'short' });
  assert.equal(notices(noReason).length, 0, 'a transfer refused for its reason sent a notice');

  const race = withContender(freshDb());
  const { e } = racingBatchEnv(race, async () => {
    await call(superAdmins, race, HOLDER, `/${SUCCESSOR}?transfer=1`, { reason: HANDOVER });
  });
  const lost = await call(superAdmins, race, HOLDER, `/${CONTENDER}?transfer=1`, { reason: HANDOVER }, e);
  assert.equal(lost.status, 409);
  assert.equal(lost.body?.notified, undefined, 'a refusal reports notices');
  assert.deepEqual(notices(race).map((n: any) => n.user_id).sort(), [HOLDER, SUCCESSOR].sort(),
    'the losing transfer sent notices of its own — only the one that landed may');

  const repeat = freshDb();
  const { e: e2 } = racingBatchEnv(repeat, async () => {
    await call(superAdmins, repeat, HOLDER, `/${SUCCESSOR}?transfer=1`, { reason: HANDOVER });
  });
  const again = await call(superAdmins, repeat, HOLDER, `/${SUCCESSOR}?transfer=1`, { reason: HANDOVER }, e2);
  assert.equal(again.body?.already, true);
  assert.equal(notices(repeat).length, 2, 'the double-click told both parties a second time');

  const demoted = freshDb();
  const { e: e3 } = racingBatchEnv(demoted, async () => {
    demoted.prepare("UPDATE users SET role = 'founder' WHERE id = ?").run(SUCCESSOR);
  });
  const refused = await call(superAdmins, demoted, HOLDER, `/${SUCCESSOR}?transfer=1`, { reason: HANDOVER }, e3);
  assert.equal(refused.body?.code, 'successor_changed');
  assert.equal(notices(demoted).length, 0, 'a transfer that did not land sent a notice');
});

test('D241: a notice that cannot be written never makes a landed transfer read as failed', async () => {
  // The inbox refuses every write. The transfer has already moved and been
  // recorded, so it answers 200 and says, per party, that the notice did not
  // go — reported, not assumed.
  const db = freshDb();
  const base = makeD1(db);
  const e = {
    JWT_SECRET, ENVIRONMENT: 'development',
    DB: {
      ...base,
      prepare(sql: string) {
        if (/notifications_inbox/.test(sql)) throw new Error('D1_ERROR: inbox unavailable');
        return base.prepare(sql);
      },
    },
  } as any;
  const r = await call(superAdmins, db, HOLDER, `/${SUCCESSOR}?transfer=1`, { reason: HANDOVER }, e);
  assert.equal(r.status, 200, `a failed notice failed the transfer: ${JSON.stringify(r.body)}`);
  assert.deepEqual(r.body?.notified, { successor: false, former: false }, 'an unsent notice was reported as sent');
  assert.deepEqual(holderIds(db), [SUCCESSOR]);
  assert.equal(auditRows(db).length, 2, 'the record of the transfer depended on the notice');
});
