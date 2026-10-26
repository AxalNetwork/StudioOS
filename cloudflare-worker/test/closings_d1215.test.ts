/**
 * D1215 (#3212, part 2 of #2424) — closings as a record, over migration 612:
 *
 *   · the migration: one open closing per deal, a line is a commitment or a
 *     prospect, money is integer cents, `commitments.amount_cents` copied and
 *     kept in step, `closing_events` append-only;
 *   · an investor reads their own line and the round's total only; a founder
 *     reads their own venture's closings only; anyone else gets 404;
 *   · a line is Received only on the receiving side's evidence; the sender's
 *     alone reads Sent;
 *   · every write appends exactly one event, and a refused write none; no event
 *     carries an amount, a name or an account number;
 *   · the acts: evidence is `closing.evidence` (an Admin's), a support session
 *     and an Operating Partner are refused, the founder decides the cap-table
 *     proposal, and the closing closes only when every line is settled and
 *     the proposal is decided; the admin desk names lines waiting and the next
 *     actor; `POST /api/positions` takes `position.record` and the line it
 *     records.
 *
 * Mercury, DocuSign and every bank read stay stubbed: `fetch` throws and is
 * counted. Every name, email and figure here is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/closings_d1215.test.ts
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import closings, { adminClosings } from '../src/routes/closings.ts';
import positions from '../src/routes/positions.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { captableState, nextActor } from '../src/services/closings.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIG = (f: string) => read(`cloudflare-worker/sql/migrations/${f}`);
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const app = new Hono<any>();
app.route('/api/closings', closings);
app.route('/api/admin/closings', adminClosings);
app.route('/api/positions', positions);
app.onError((err: any, c) => {
  if (err instanceof Response) return err;
  const status = AUTH_ERROR_STATUSES[err?.message ?? ''];
  return c.json({ detail: err?.message }, status ?? 500);
});

let fetches = 0;
const realFetch = globalThis.fetch;
beforeEach(() => { fetches = 0; globalThis.fetch = (async () => { fetches += 1; throw new Error('no network in D1215'); }) as any; });
afterEach(() => { globalThis.fetch = realFetch; assert.equal(fetches, 0, 'fetch was called'); });

const ADMIN = 1, SUPER = 2, FOUNDER = 3, OTHER_FOUNDER = 4, PARTNER = 5, INV_A = 6, INV_B = 7, INV_C = 8;
const ROLE: Record<number, string> = { 1: 'admin', 2: 'admin', 3: 'founder', 4: 'founder', 5: 'partner', 6: 'investor', 7: 'investor', 8: 'investor' };
const DEAL = 41, OTHER_DEAL = 42, PROJECT = 7, OTHER_PROJECT = 8;

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of ['312_fund_call_ledger.sql', '335_deal_transfers_and_closing_checklists.sql', '340_deal_transfer_company.sql',
    '410_safe_issuances.sql', '599_deal_currency.sql']) db.exec(MIG(f));
  // Migration 607's prospect cents, the one column of it a closing reads.
  db.exec('ALTER TABLE raise_prospects ADD COLUMN amount_cents INTEGER');
  // Rows written BEFORE 612: the copy must give them cents.
  db.exec(`
    INSERT INTO founders (id, name, email) VALUES (31, 'Fay Founder', 'fay@example.test'), (32, 'Otis Other', 'otis@example.test');
    INSERT INTO users (id, role, name, email, founder_id) VALUES
      (1, 'admin', 'Ada Admin', 'ada@example.test', NULL), (2, 'admin', 'Sam Super', 'sam@example.test', NULL),
      (3, 'founder', 'Fay Founder', 'fay@example.test', 31), (4, 'founder', 'Otis Other', 'otis@example.test', 32),
      (5, 'partner', 'Pia Partner', 'pia@example.test', NULL), (6, 'investor', 'Ivy Alpha', 'ivy@example.test', NULL),
      (7, 'investor', 'Ben Beta', 'ben@example.test', NULL), (8, 'investor', 'Cal Gamma', 'cal@example.test', NULL);
    INSERT INTO super_admins (user_id) VALUES (2);
    INSERT INTO projects (id, name, founder_id) VALUES (7, 'Fixture Venture', 31), (8, 'Other Venture', 32);
    INSERT INTO deals (id, uid, project_id, status, instrument, closing_deadline) VALUES
      (41, 'd-41', 7, 'active', 'safe', '2026-12-01'), (42, 'd-42', 8, 'active', 'spa', NULL);
    INSERT INTO commitments (id, uid, deal_id, investor_user_id, amount, status) VALUES
      (101, 'cm-a', 41, 6, 250000.5, 'confirmed'), (102, 'cm-b', 41, 7, 125000, 'pending'), (103, 'cm-c', 41, 8, 50000, 'withdrawn'),
      (104, 'cm-o', 42, 8, 70000, 'confirmed');
  `);
  db.exec(MIG('612_closings.sql'));
  return db;
}

async function token(user: number, impersonated = false) {
  return new SignJWT({ user_id: user, role: ROLE[user], ...(impersonated ? { impersonated_by: SUPER } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(db: DatabaseSync, method: string, path: string, as: number, body?: unknown, impersonated = false) {
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${await token(as, impersonated)}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}

const events = (db: DatabaseSync) => Number((db.prepare('SELECT COUNT(*) AS n FROM closing_events').get() as any).n);
const all = (db: DatabaseSync, sql: string) => JSON.parse(JSON.stringify(db.prepare(sql).all()));

async function opened(db = freshDb()) {
  const r = await call(db, 'POST', '/api/closings', ADMIN, { deal_id: DEAL, round_label: 'Seed' });
  assert.equal(r.status, 201, r.text);
  const lines = Object.fromEntries(r.body.lines.map((l: any) => [l.investor_user_id, l.uid]));
  return { db, uid: r.body.uid as string, lines };
}

// ---------------------------------------------------------------- the migration

test('612: commitments get cents, copied once and kept in step; a missing amount stays NULL', () => {
  const db = freshDb();
  assert.deepEqual(all(db, 'SELECT id, amount_cents FROM commitments ORDER BY id'),
    [{ id: 101, amount_cents: 25000050 }, { id: 102, amount_cents: 12500000 }, { id: 103, amount_cents: 5000000 }, { id: 104, amount_cents: 7000000 }]);
  db.exec("INSERT INTO commitments (id, uid, deal_id, investor_user_id, amount, status) VALUES (105, 'cm-n', 41, 8, 1.239, 'pending')");
  db.exec('UPDATE commitments SET amount = 2.5 WHERE id = 102');
  assert.deepEqual(all(db, 'SELECT id, amount_cents FROM commitments WHERE id IN (102, 105) ORDER BY id'),
    [{ id: 102, amount_cents: 250 }, { id: 105, amount_cents: 124 }]);
  db.exec('UPDATE commitments SET amount = -1 WHERE id = 105');
  assert.equal((db.prepare('SELECT amount_cents FROM commitments WHERE id = 105').get() as any).amount_cents, null, 'never a guessed or negative amount');
  for (const t of ['fund_capital_calls', 'portfolio_positions', 'safe_issuances', 'deal_transfers']) {
    assert.ok(all(db, `PRAGMA table_info(${t})`).some((c: any) => c.name === 'closing_line_uid'), t);
  }
});

test('612: one open closing per deal, a line is a commitment or a prospect in whole cents, and the events are append-only', async () => {
  const { db } = await opened();
  assert.throws(() => db.exec("INSERT INTO closings (deal_id, project_id, created_by) VALUES (41, 7, 1)"), /UNIQUE/);
  assert.throws(() => db.exec('INSERT INTO closing_lines (closing_id, amount_cents, created_by) VALUES (1, 100, 1)'), /CHECK/);
  assert.throws(() => db.exec('INSERT INTO closing_lines (closing_id, commitment_id, amount_cents, created_by) VALUES (1, 104, 1.5, 1)'), /CHECK/);
  assert.throws(() => db.exec('INSERT INTO closing_lines (closing_id, commitment_id, amount_cents, created_by) VALUES (1, 104, 0, 1)'), /CHECK/);
  assert.throws(() => db.exec("UPDATE closing_events SET event = 'closed'"), /append-only/);
  assert.throws(() => db.exec('DELETE FROM closing_events'), /append-only/);
  assert.deepEqual(all(db, 'PRAGMA table_info(closing_events)').map((c: any) => c.name),
    ['id', 'closing_id', 'line_id', 'actor_user_id', 'event', 'source_ref', 'created_at'], 'no amount, name or account column');
});

// ---------------------------------------------------------------- opening

test('an Admin opens a closing with one line per live commitment; anyone else is refused, and a second open is 409', async () => {
  const db = freshDb();
  for (const who of [FOUNDER, PARTNER, INV_A]) {
    const r = await call(db, 'POST', '/api/closings', who, { deal_id: DEAL });
    assert.equal(r.status, 403, `${ROLE[who]} ${r.text}`);
  }
  const support = await call(db, 'POST', '/api/closings', ADMIN, { deal_id: DEAL }, true);
  assert.deepEqual([support.status, support.body?.error], [403, 'support_session_refused']);
  assert.equal(events(db), 0, 'a refused open writes nothing');

  const r = await call(db, 'POST', '/api/closings', ADMIN, { deal_id: DEAL, round_label: 'Seed' });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual([r.body.status, r.body.instrument, r.body.deadline, r.body.currency, r.body.round_label], ['open', 'safe', '2026-12-01', 'USD', 'Seed']);
  assert.deepEqual(r.body.lines.map((l: any) => [l.investor_user_id, l.amount_cents, l.status, l.route]),
    [[INV_A, 25000050, 'open', null], [INV_B, 12500000, 'open', null]], 'the withdrawn commitment has no line');
  assert.deepEqual([r.body.total_cents, r.body.line_count], [37500050, 2]);
  assert.deepEqual(all(db, 'SELECT event FROM closing_events'), [{ event: 'opened' }], 'one write, one event');

  const again = await call(db, 'POST', '/api/closings', ADMIN, { deal_id: DEAL });
  assert.deepEqual([again.status, again.body?.error], [409, 'closing_open']);
  const badDate = await call(db, 'POST', '/api/closings', ADMIN, { deal_id: OTHER_DEAL, deadline: 'next Friday' });
  assert.deepEqual([badDate.status, badDate.body?.error], [400, 'deadline_invalid']);
  db.exec("UPDATE deals SET closing_deadline = 'end of Q4' WHERE id = 42");
  const noGuess = await call(db, 'POST', '/api/closings', ADMIN, { deal_id: OTHER_DEAL });
  assert.equal(noGuess.status, 201, noGuess.text);
  assert.equal(noGuess.body.deadline, null, 'a deal deadline that is not a date is not guessed into one');
  const nodeal = await call(db, 'POST', '/api/closings', ADMIN, { deal_id: 999 });
  assert.deepEqual([nodeal.status, nodeal.body?.error], [404, 'deal_not_found']);
  assert.equal(events(db), 2, 'two opens, two events; every refusal none');
});

// ---------------------------------------------------------------- who reads what

test('an investor reads their own line and the round total only; no other line, name, amount or event', async () => {
  const { db, uid } = await opened();
  const r = await call(db, 'GET', `/api/closings/${uid}`, INV_A);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.reach, 'own');
  assert.deepEqual(r.body.lines.map((l: any) => [l.investor_user_id, l.amount_cents]), [[INV_A, 25000050]]);
  assert.equal(r.body.total_cents, 37500050, 'the round total');
  assert.equal(r.body.events, null, 'no events');
  assert.doesNotMatch(r.text, /Ben Beta|12500000|"investor_user_id":7/);

  const outsider = await call(db, 'GET', `/api/closings/${uid}`, INV_C);
  assert.equal(outsider.status, 404, 'an investor with no line on it: the 404 of one that does not exist');
  assert.doesNotMatch(outsider.text, /Fixture Venture|25000050/);

  const list = await call(db, 'GET', '/api/closings', INV_A);
  assert.deepEqual(list.body.closings.map((c: any) => [c.uid, c.reach]), [[uid, 'own']]);
  assert.deepEqual((await call(db, 'GET', '/api/closings', INV_C)).body.closings, []);
});

test('a founder reads their own venture\'s closings only, every line and the events; another founder gets 404', async () => {
  const { db, uid } = await opened();
  await call(db, 'POST', '/api/closings', ADMIN, { deal_id: OTHER_DEAL });
  const mine = await call(db, 'GET', `/api/closings/${uid}`, FOUNDER);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.reach, 'all');
  assert.equal(mine.body.lines.length, 2);
  assert.ok(Array.isArray(mine.body.events));
  const list = await call(db, 'GET', '/api/closings', FOUNDER);
  assert.deepEqual(list.body.closings.map((c: any) => c.project_id), [PROJECT], 'only their own venture');

  const other = await call(db, 'GET', `/api/closings/${uid}`, OTHER_FOUNDER);
  assert.equal(other.status, 404);
  assert.deepEqual((await call(db, 'GET', '/api/closings', OTHER_FOUNDER)).body.closings.map((c: any) => c.project_id), [OTHER_PROJECT]);
  assert.equal((await call(db, 'GET', `/api/closings/${uid}`, PARTNER)).status, 404, 'an Operating Partner has no reach');
  // A converted account keeps a residual founder_id: the role decides, as projectOwnerScope's rule does.
  db.exec('UPDATE users SET founder_id = 31 WHERE id = 8');
  assert.equal((await call(db, 'GET', `/api/closings/${uid}`, INV_C)).status, 404, 'an investor with a residual founder_id owns nothing');
  assert.deepEqual((await call(db, 'GET', '/api/closings', INV_C)).body.closings.map((c: any) => [c.project_id, c.reach]), [[OTHER_PROJECT, 'own']],
    'only the closing it has a line on, as its own; never venture 31\'s as a founder');
  assert.equal((await call(db, 'GET', '/api/closings', ADMIN)).body.closings.length, 2, 'an Admin reads every closing');
});

// ---------------------------------------------------------------- evidence

test('a line is Received only on the receiving side\'s evidence; the sender\'s alone reads Sent', async () => {
  const { db, uid, lines } = await opened();
  const line = lines[INV_A];
  const add = (body: any) => call(db, 'POST', `/api/closings/${uid}/lines/${line}/evidence`, ADMIN, body);
  const status = () => (db.prepare('SELECT status FROM closing_lines WHERE uid = ?').get(line) as any).status;

  const sent = await add({ kind: 'investor_mercury', source_ref: 'mercury:txn-a1' });
  assert.equal(sent.status, 201, sent.text);
  assert.equal(status(), 'sent', 'the investor’s own Mercury is the sending side');

  const got = await add({ kind: 'company_mercury', source_ref: 'mercury:txn-c1' });
  assert.equal(status(), 'received');
  const w = await call(db, 'POST', `/api/closings/${uid}/evidence/${got.body.uid}/withdraw`, ADMIN, { reason: 'Matched the wrong credit line.' });
  assert.equal(w.status, 200, w.text);
  assert.equal(status(), 'sent', 'withdrawing the receiving evidence takes Received away');

  const noTransfer = await add({ kind: 'phone_verified_record', source_ref: 'deal_transfer:nope' });
  assert.deepEqual([noTransfer.status, noTransfer.body?.error], [404, 'transfer_not_found']);
  db.exec("INSERT INTO deal_transfers (uid, deal_id, amount_cents, phone_verified, recorded_by) VALUES ('tr-unverified', 41, 100, 0, 1), ('tr-1', 41, 25000050, 1, 1)");
  assert.equal((await add({ kind: 'phone_verified_record', source_ref: 'deal_transfer:tr-unverified' })).status, 404, 'only a phone-verified record');
  assert.equal((await add({ kind: 'phone_verified_record', source_ref: 'deal_transfer:tr-1' })).status, 201);
  assert.equal(status(), 'received');

  for (const bad of [{ kind: 'company_mercury', source_ref: 'Acct 0123456789 Ivy Alpha' }, { kind: 'company_mercury', source_ref: 'file:x' },
    { kind: 'investor_says_so', source_ref: 'mercury:t' }, { kind: 'bank_confirmation', source_ref: 'mercury:t' }]) {
    const r = await add(bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.doesNotMatch(r.text, /0123456789|Ivy Alpha/, 'a refusal echoes no input');
  }
  const short = await call(db, 'POST', `/api/closings/${uid}/evidence/${sent.body.uid}/withdraw`, ADMIN, { reason: 'too short' });
  assert.deepEqual([short.status, short.body?.error], [400, 'reason_invalid']);
});

test('recording evidence is closing.evidence: an Admin\'s act, never a partner\'s, an investor\'s or a support session\'s', async () => {
  const { db, uid, lines } = await opened();
  const path = `/api/closings/${uid}/lines/${lines[INV_A]}/evidence`;
  const body = { kind: 'company_mercury', source_ref: 'mercury:txn-c1' };
  for (const who of [PARTNER, INV_A, FOUNDER]) assert.equal((await call(db, 'POST', path, who, body)).status, 403, ROLE[who]);
  const support = await call(db, 'POST', path, ADMIN, body, true);
  assert.deepEqual([support.status, support.body?.error], [403, 'support_session_refused']);
  assert.equal((await call(db, 'POST', path, ADMIN, body)).status, 201, 'a plain Admin records evidence');
  assert.equal(all(db, "SELECT action FROM admin_audit_log WHERE action = 'fund_admin.closing.evidence'").length, 1, 'the act is audited');
  assert.doesNotMatch(JSON.stringify(all(db, 'SELECT * FROM admin_audit_log')), /mercury:txn|25000050/, 'no source or amount in the audit row');
});

// ---------------------------------------------------------------- events

test('every write appends exactly one event, a refused write none, and no event carries an amount, name or account number', async () => {
  const db = freshDb();
  let n = events(db);
  const step = async (method: string, path: string, as: number, body: unknown, ok: number, name: string) => {
    const r = await call(db, method, path, as, body);
    assert.equal(r.status, ok, `${name}: ${r.text}`);
    const now = events(db);
    assert.equal(now - n, ok < 300 ? 1 : 0, `${name} appends ${ok < 300 ? 'one event' : 'none'}`);
    n = now;
    return r;
  };
  const open = await step('POST', '/api/closings', ADMIN, { deal_id: DEAL }, 201, 'open');
  const uid = open.body.uid;
  const [a, b] = open.body.lines.map((l: any) => l.uid);
  db.exec("INSERT INTO raise_prospects (uid, project_id, name, amount, amount_cents) VALUES ('rp-1', 7, 'Pru Prospect', 3000, 300000)");
  const pid = (db.prepare("SELECT id FROM raise_prospects WHERE uid = 'rp-1'").get() as any).id;
  const p = await step('POST', `/api/closings/${uid}/lines`, ADMIN, { prospect_id: pid }, 201, 'add a prospect line');
  await step('POST', `/api/closings/${uid}/lines`, ADMIN, { prospect_id: pid }, 409, 'the same prospect twice');
  await step('PUT', `/api/closings/${uid}/lines/${a}/route`, ADMIN, { route: 'direct' }, 200, 'route');
  await step('PUT', `/api/closings/${uid}/lines/${a}/route`, ADMIN, { route: 'wire_it_anywhere' }, 400, 'a bad route');
  await step('POST', `/api/closings/${uid}/lines/${b}/withdraw`, ADMIN, {}, 200, 'withdraw a line');
  await step('POST', `/api/closings/${uid}/lines/${p.body.uid}/withdraw`, ADMIN, {}, 200, 'withdraw the prospect');
  const ev = await step('POST', `/api/closings/${uid}/lines/${a}/evidence`, ADMIN, { kind: 'company_mercury', source_ref: 'mercury:txn-9' }, 201, 'evidence');
  await step('POST', `/api/closings/${uid}/captable/accept`, FOUNDER, {}, 200, 'the founder accepts');
  await step('POST', `/api/closings/${uid}/captable/dismiss`, FOUNDER, {}, 409, 'decided twice');
  await step('POST', `/api/closings/${uid}/complete`, ADMIN, {}, 200, 'complete');
  await step('POST', `/api/closings/${uid}/evidence/${ev.body.uid}/withdraw`, ADMIN, { reason: 'After the closing closed.' }, 409, 'a write on a closed closing');

  const rows = all(db, 'SELECT * FROM closing_events ORDER BY id');
  assert.deepEqual(rows.map((r: any) => r.event),
    ['opened', 'line_added', 'route_set', 'line_withdrawn', 'line_withdrawn', 'evidence_added', 'captable_accepted', 'closed']);
  const text = JSON.stringify(rows);
  for (const leak of ['25000050', '250000', '12500000', '300000', 'Ivy Alpha', 'Ben Beta', 'Pru Prospect', 'mercury:txn-9', 'txn-9']) {
    assert.ok(!text.includes(leak), `an event carries ${leak}`);
  }
  assert.ok(rows.every((r: any) => r.source_ref === null || /^(deal|route|closing_evidence):[A-Za-z0-9_-]+$/.test(r.source_ref)), text);
});

// ---------------------------------------------------------------- the cap table and the close

test('the founder decides the cap-table proposal once every line is settled; the closing closes only after', async () => {
  const { db, uid, lines } = await opened();
  const accept = () => call(db, 'POST', `/api/closings/${uid}/captable/accept`, FOUNDER, {});
  assert.deepEqual([(await accept()).status, (await accept()).body?.error], [409, 'captable_not_ready']);
  assert.deepEqual((await call(db, 'POST', `/api/closings/${uid}/complete`, ADMIN, {})).body?.error, 'lines_not_settled');

  for (const who of [INV_A, INV_B]) {
    await call(db, 'POST', `/api/closings/${uid}/lines/${lines[who]}/evidence`, ADMIN, { kind: 'axal_mercury', source_ref: `mercury:t-${who}` });
  }
  assert.equal((await call(db, 'GET', `/api/closings/${uid}`, FOUNDER)).body.captable.state, 'proposed');
  assert.deepEqual((await call(db, 'POST', `/api/closings/${uid}/complete`, ADMIN, {})).body?.error, 'captable_undecided');
  const byAdmin = await call(db, 'POST', `/api/closings/${uid}/captable/accept`, ADMIN, {});
  assert.deepEqual([byAdmin.status, byAdmin.body?.error], [403, 'founder_decides']);
  const byInvestor = await call(db, 'POST', `/api/closings/${uid}/captable/accept`, INV_A, {});
  assert.deepEqual([byInvestor.status, byInvestor.body?.error], [403, 'founder_decides']);
  assert.equal((await call(db, 'POST', `/api/closings/${uid}/captable/accept`, OTHER_FOUNDER, {})).status, 404);

  assert.equal((await accept()).status, 200);
  const done = await call(db, 'POST', `/api/closings/${uid}/complete`, ADMIN, {});
  assert.equal(done.status, 200, done.text);
  const r = await call(db, 'GET', `/api/closings/${uid}`, INV_A);
  assert.deepEqual([r.body.status, r.body.captable.state], ['closed', 'accepted']);
  assert.equal((await call(db, 'POST', `/api/closings/${uid}/lines/${lines[INV_A]}/withdraw`, ADMIN, {})).body?.error, 'closing_not_open');
});

test('captableState and nextActor: never proposed before every line settles; the desk names who it waits on', () => {
  assert.equal(captableState({ captable_state: null }, []), 'not_ready');
  assert.equal(captableState({ captable_state: null }, ['withdrawn']), 'not_ready', 'nothing received');
  assert.equal(captableState({ captable_state: null }, ['received', 'sent']), 'not_ready');
  assert.equal(captableState({ captable_state: null }, ['received', 'withdrawn']), 'proposed');
  assert.equal(captableState({ captable_state: 'dismissed' }, ['open']), 'dismissed');
  assert.equal(nextActor([], 'not_ready').who, 'admin');
  assert.equal(nextActor([{ status: 'open', route: null }], 'not_ready').who, 'admin');
  assert.equal(nextActor([{ status: 'open', route: 'direct' }], 'not_ready').who, 'investor');
  assert.equal(nextActor([{ status: 'sent', route: 'direct' }, { status: 'open', route: 'direct' }], 'not_ready').who, 'admin');
  assert.equal(nextActor([{ status: 'received', route: 'direct' }], 'proposed').who, 'founder');
  assert.equal(nextActor([{ status: 'received', route: 'direct' }], 'accepted').who, 'admin');
});

test('the admin desk: every open closing with lines waiting, its next actor and owner; an Admin\'s only', async () => {
  const { db, uid, lines } = await opened();
  await call(db, 'PUT', `/api/closings/${uid}/lines/${lines[INV_A]}/route`, ADMIN, { route: 'direct' });
  await call(db, 'PUT', `/api/closings/${uid}/lines/${lines[INV_B]}/route`, ADMIN, { route: 'axal_fund', vehicle_ref: 'fund:1' });
  await call(db, 'POST', `/api/closings/${uid}/lines/${lines[INV_A]}/evidence`, ADMIN, { kind: 'company_mercury', source_ref: 'mercury:t1' });
  const r = await call(db, 'GET', '/api/admin/closings', ADMIN);
  assert.equal(r.status, 200, r.text);
  const [row] = r.body.closings;
  assert.deepEqual([row.uid, row.project_name, row.owner_name, row.lines, row.lines_waiting, row.total_cents, row.received_cents, row.next_actor.who],
    [uid, 'Fixture Venture', 'Ada Admin', 2, 1, 37500050, 25000050, 'investor']);
  for (const who of [FOUNDER, PARTNER, INV_A]) assert.equal((await call(db, 'GET', '/api/admin/closings', who)).status, 403, ROLE[who]);
});

// ---------------------------------------------------------------- the links and the position act

test('POST /api/positions is position.record and records the closing line it serves, of that venture only', async () => {
  const { db, lines } = await opened();
  const body = { project_id: PROJECT, round_name: 'Seed', invested_amount: 250000.5 };
  assert.equal((await call(db, 'POST', '/api/positions', PARTNER, body)).status, 403);
  assert.equal((await call(db, 'POST', '/api/positions', ADMIN, body, true)).status, 403, 'a support session never records a position');
  const ok = await call(db, 'POST', '/api/positions', ADMIN, { ...body, closing_line_uid: lines[INV_A] });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.body.closing_line_uid, lines[INV_A]);
  const wrong = await call(db, 'POST', '/api/positions', ADMIN, { ...body, project_id: OTHER_PROJECT, closing_line_uid: lines[INV_A] });
  assert.deepEqual([wrong.status, wrong.body?.code], [404, 'closing_line_not_found']);
  assert.equal((await call(db, 'POST', '/api/positions', ADMIN, body)).status, 201, 'with no line, as before');
});

test('index.ts mounts /api/closings, and the desk before the /api/admin catch-all that would shadow it', () => {
  const index = read('cloudflare-worker/src/index.ts');
  const desk = index.indexOf("app.route('/api/admin/closings', adminClosings);");
  const catchAll = index.indexOf("app.route('/api/admin', admin);");
  assert.ok(desk > 0 && catchAll > 0 && desk < catchAll, 'the desk is mounted before the catch-all');
  assert.ok(index.includes("app.route('/api/closings', closings);"));
});
