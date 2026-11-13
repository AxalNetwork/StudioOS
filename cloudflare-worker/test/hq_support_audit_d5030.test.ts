/**
 * The HQ Support audit (#5030–#5035):
 *
 *   D5030 — per-kind escalation counts from the whole board, never the 25 rows
 *           listed; a ticket keeps the support context it was FILED in.
 *   D5031 — HQ's own desk (`GET /local`) never waits on a branch, and the full
 *           read runs HQ's reads and the branch fan-out at once.
 *   D5032 — the ticket SLA policy carries a version, travels in the licence
 *           copy, and each branch's applied version is reported.
 *   D5033 — the save's answer says branch by branch what was applied (the
 *           page's own feedback is in frontend/test/hq_support_audit_d5030.test.mjs).
 *   D5035 — durable recent decisions and the last recorded branch push.
 *
 * REAL SQLITE ON THE REAL SCHEMA (`loadSchema`: the baseline and every
 * migration, these two included), at both tiers. HQ's binding to a branch runs
 * the branch's REAL `applyLicenceCopy` and `branchOpenTickets` on the branch's
 * own database, so what HQ reports is what the branch wrote.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/hq_support_audit_d5030.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';

import supportRoute, {
  escalationKinds, BRANCHES_READ_SEPARATELY, slaPropagation, ALWAYS_OFFERED_KINDS,
} from '../src/routes/admin_hq_support.ts';
import adminEscalations from '../src/routes/admin_escalations.ts';
import tickets from '../src/routes/tickets.ts';
import { applyLicenceCopy, branchOpenTickets } from '../src/rpc/branchOps.ts';
import { readBranchAdminTickets, filingSnapshot, SUPPORT_LIST_LIMIT, queuePersonaOf } from '../src/services/supportQueues.ts';
import {
  readSlaTiers, readSlaPolicyVersion, applySlaPolicyCopy, parseSlaPolicyCopy,
} from '../src/services/supportSlaPolicy.ts';
import { slaForTicket } from '../src/services/ticketScreens.ts';
import { BRANCH_DEADLINE_MS } from '../src/services/branches.ts';
import { SLA_PUSH_DEADLINE_MS } from '../src/routes/admin_hq_support.ts';

type DB = DatabaseSync;
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 1;
const FR_ADMIN = 20;
const WL_ADMIN = 21;
const FOUNDER = 10;
const H = 3_600_000;

function fresh(): DB {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS as any);
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = OFF;');
  return db;
}

/** HQ: a Super Admin, a deployed licence (fr), an undeployed white-label, their administrators. */
function hqDb(opts: { deployed?: boolean } = {}): DB {
  const db = fresh();
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(HOLDER, 'admin', 'The Holder', 'holder@example.test');
  u.run(FR_ADMIN, 'admin', 'K. Weber', 'kw@example.test');
  u.run(WL_ADMIN, 'admin', 'T. Roussel', 'tr@example.test');
  u.run(FOUNDER, 'founder', 'D. Raghunathan', 'dr@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  const l = db.prepare(
    `INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, kind)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
  );
  l.run(1, 'lic_fr', 'AXL-001', 'Axal VC France SAS', 'Axal VC France', 'subsidiary');
  l.run(2, 'lic_wl', 'AXL-002', 'Studio Lyon SARL', 'Studio Lyon', 'white_label');
  db.prepare("INSERT INTO licence_territories (licence_id, country_code) VALUES (1, 'FR')").run();
  const la = db.prepare('INSERT INTO licence_admins (licence_id, user_id) VALUES (?, ?)');
  la.run(1, FR_ADMIN);
  la.run(2, WL_ADMIN);
  if (opts.deployed !== false) {
    db.prepare(
      `INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status)
       VALUES ('lic_fr', 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr', 'live')`,
    ).run();
  }
  return db;
}

/** A branch: its own administrator and member, on its own database. */
function branchDb(): DB {
  const db = fresh();
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, ?)');
  u.run(1, 'admin', 'Branch Admin', 'ba@fr.example', 1);
  u.run(2, 'founder', 'Branch Member', 'bm@fr.example', 1);
  u.run(3, 'founder', 'Demoted Admin', 'da@fr.example', 1);
  return db;
}
const branchEnv = (db: DB) => ({ DB: d1Over(db), BRANCH_CODE: 'fr', JWT_SECRET, ENVIRONMENT: 'development' }) as any;

/** HQ's binding to fr: the branch's real writer and reader, on `bdb`. */
function binding(bdb: DB, opts: { applyThrows?: boolean; applyHangs?: boolean; hang?: boolean; oldDeploy?: boolean } = {}) {
  const calls: string[] = [];
  const records: Array<Record<string, unknown>> = [];
  return {
    calls,
    records,
    stub: {
      async applyLicence(record: Record<string, unknown>) {
        calls.push('applyLicence');
        records.push(record);
        if (opts.applyThrows) throw new Error('rpc: fr did not answer');
        if (opts.applyHangs) return new Promise(() => {});
        return applyLicenceCopy(branchEnv(bdb), record);
      },
      async openTickets() {
        calls.push('openTickets');
        if (opts.hang) return new Promise(() => {});
        const ans = await branchOpenTickets(branchEnv(bdb));
        if (opts.oldDeploy) {
          const { sla_policy: _drop, ...rest } = ans as any;
          return rest;
        }
        return ans;
      },
    },
  };
}

const app = new Hono<any>();
app.route('/api/admin/hq-support', supportRoute);
app.route('/api/admin', adminEscalations);
app.route('/api/tickets', tickets);
app.onError((err: any, c) => {
  const s = ({ Unauthorized: 401, 'Admin required': 403, 'Super admin required': 403 } as any)[err?.message];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

async function call(env: any, method: string, path: string, body?: unknown, as = HOLDER, role = 'admin') {
  const jwt = await new SignJWT({ user_id: as, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}
const hqEnv = (db: DB, bindings: Record<string, unknown> = {}) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...bindings }) as any;

const TIERS = (p1: number, p2: number, p3: number) => ({
  tiers: {
    P1: { hours: p1, description: 'Money, access, or data at risk' },
    P2: { hours: p2, description: 'A workflow is blocked, a workaround exists' },
    P3: { hours: p3, description: 'Wrong, but nobody is stopped' },
  },
});

test('D5035: both Support reads return the latest 25 stored decisions, including legacy outcomes, in stable decision order', async () => {
  const db = hqDb();
  const insert = db.prepare(
    `INSERT INTO hq_escalations (uid, branch_code, kind, subject, status, answer, answered_at, push_at)
     VALUES (?, 'fr', 'other', 'A question', ?, ?, ?, ?)`,
  );
  const stamp = '2026-10-01T12:00:00.000Z';
  for (let i = 0; i < 26; i++) {
    insert.run(`esc_${String(i).padStart(2, '0')}`, 'answered', 'Keep it open locally.', stamp, null);
  }
  insert.run('esc_declined', 'declined', 'Keep the current terms.', '2026-11-01T12:00:00.000Z', null);
  // Resending an older decision is not a new decision.
  insert.run('esc_old', 'answered', 'Older answer', '2026-09-01T12:00:00.000Z', '2026-11-11T12:00:00.000Z');
  insert.run('esc_open', 'open', null, null, null);
  insert.run('esc_withdrawn', 'withdrawn', 'Taken back.', '2026-11-11T12:00:00.000Z', null);
  insert.run('esc_empty', 'answered', '', '2026-11-11T12:00:00.000Z', null);
  for (const path of ['/api/admin/hq-support/local', '/api/admin/hq-support']) {
    const { status, body } = await call(hqEnv(db), 'GET', path);
    assert.equal(status, 200);
    const history = body.recent_decisions;
    assert.equal(history.available, true);
    const expected = ['esc_declined', ...Array.from({ length: 24 }, (_, i) => `esc_${String(25 - i).padStart(2, '0')}`)];
    assert.deepEqual(history.items.map((row: any) => row.uid), expected);
    assert.deepEqual(history.items[0], {
      uid: 'esc_declined', branch_code: 'fr', kind: 'other', subject: 'A question', status: 'declined',
      answer: 'Keep the current terms.', answered_at: '2026-11-01T12:00:00.000Z', answered_by_name: null,
      push_ok: null, push_reason: null, push_at: null,
    });
  }
});

test('D5035: a missing delivery column leaves only history unreadable', async () => {
  const db = hqDb();
  db.exec('ALTER TABLE hq_escalations DROP COLUMN push_ok');
  const { body } = await call(hqEnv(db), 'GET', '/api/admin/hq-support/local');
  assert.equal(body.recent_decisions.available, false);
  assert.ok(body.recent_decisions.reason);
  assert.equal(body.escalations.available, true);
  assert.equal(body.tickets.available, true);
});

test('D5035: a refused, unconfirmed and then successful resend is visible on fresh reads of the same decision', async () => {
  const db = hqDb();
  db.exec("INSERT INTO hq_escalations (uid, branch_code, kind, subject) VALUES ('esc_retry', 'fr', 'other', 'An appeal')");
  const acknowledgements = [{ ok: false, reason: 'Branch refused' }, { ok: 'true' }, { ok: true }];
  const env = hqEnv(db, { BRANCH_FR: { applyEscalationAnswer: () => acknowledgements.shift() } });
  const path = '/api/admin/escalations/esc_retry';
  const recorded = await call(hqEnv(db), 'PATCH', path, { answer: 'Allow the appeal.', status: 'answered' });
  assert.equal(recorded.status, 200);
  const decision = {
    uid: 'esc_retry', branch_code: 'fr', kind: 'other', subject: 'An appeal', status: 'answered',
    answer: 'Allow the appeal.', answered_by_name: 'The Holder', answered_at: recorded.body.answered_at,
  };
  const readHistory = async () => (await call(hqEnv(db), 'GET', '/api/admin/hq-support/local')).body.recent_decisions.items;
  assert.match(recorded.body.pushed.reason, /No branch Worker is bound/);
  assert.deepEqual(await readHistory(), [{ ...decision, push_ok: 0, push_reason: recorded.body.pushed.reason, push_at: recorded.body.pushed.push_at }]);
  const refused = await call(env, 'POST', `${path}/resend`);
  assert.equal(refused.body.pushed.ok, false);
  assert.deepEqual(await readHistory(), [{ ...decision, push_ok: 0, push_reason: 'Branch refused', push_at: refused.body.pushed.push_at }]);
  const unconfirmed = await call(env, 'POST', `${path}/resend`);
  assert.equal(unconfirmed.body.pushed.ok, null);
  assert.match(unconfirmed.body.pushed.reason, /no delivery acknowledgement/);
  assert.deepEqual(await readHistory(), [{
    ...decision, push_ok: null, push_reason: unconfirmed.body.pushed.reason, push_at: unconfirmed.body.pushed.push_at,
  }]);
  const received = await call(env, 'POST', `${path}/resend`);
  assert.equal(received.body.pushed.ok, true);
  assert.ok(Date.parse(received.body.pushed.push_at));
  assert.deepEqual(await readHistory(), [{ ...decision, push_ok: 1, push_reason: null, push_at: received.body.pushed.push_at }]);
});

test('D5035: a late reply to an earlier decision cannot confirm its replacement', async () => {
  const db = hqDb();
  db.exec(`INSERT INTO hq_escalations (uid, branch_code, kind, subject, answer, status, answered_at, push_ok, push_at)
    VALUES ('esc_overlap', 'fr', 'other', 'An appeal', 'First answer', 'answered', '2026-10-01', 1, '2026-10-01')`);
  const first = Promise.withResolvers<{ ok: boolean }>();
  const firstStarted = Promise.withResolvers<void>();
  const next = Promise.withResolvers<{ ok: boolean; reason: string }>();
  const nextStarted = Promise.withResolvers<void>();
  const env = hqEnv(db, {
    BRANCH_FR: { applyEscalationAnswer: ({ answer }: { answer: string }) => {
      if (answer === 'First answer') { firstStarted.resolve(); return first.promise; }
      nextStarted.resolve();
      return next.promise;
    } },
  });
  const path = '/api/admin/escalations/esc_overlap';
  const oldResend = call(env, 'POST', `${path}/resend`);
  await firstStarted.promise;
  const replacement = call(env, 'PATCH', path, { answer: 'Second answer', status: 'declined' });
  await nextStarted.promise;
  const read = async () => (await call(hqEnv(db), 'GET', '/api/admin/hq-support/local')).body.recent_decisions.items[0];
  const before = await read();
  assert.equal(before.answer, 'Second answer');
  assert.equal(before.push_ok, null);
  assert.equal(before.push_at, null);
  next.resolve({ ok: false, reason: 'Refused this answer' });
  assert.equal((await replacement).body.pushed.ok, false);
  first.resolve({ ok: true });
  assert.equal((await oldResend).body.pushed.ok, true);
  const after = await read();
  assert.equal(after.push_ok, 0);
  assert.equal(after.push_reason, 'Refused this answer');
});

// ═══════════════════════════════════════════════════════════ D5030 · counts ══

test('D5030: with more than 25 open escalations, every kind is counted from the whole board, not the 25 listed', async () => {
  const db = hqDb();
  const e = db.prepare(
    `INSERT INTO hq_escalations (uid, branch_code, kind, subject, status, due_at, created_at)
     VALUES (?, 'fr', ?, ?, 'open', ?, datetime('now', ?))`,
  );
  // 20 moderation (oldest), then 7 seat increases, then 3 renewals (newest):
  // the renewals are past the 25 listed, so a count made from the list is 0.
  let n = 0;
  const add = (kind: string, count: number) => {
    for (let i = 0; i < count; i++, n++) {
      e.run(`esc_${n}`, kind, `${kind} ${i}`, new Date(Date.now() + 48 * H).toISOString(), `-${300 - n} hours`);
    }
  };
  add('moderation', 20);
  add('seat_increase', 7);
  add('renewal', 3);
  const r = await call(hqEnv(db), 'GET', '/api/admin/hq-support/local');
  assert.equal(r.status, 200);
  const q = r.body.escalations;
  assert.equal(q.count, 30);
  assert.equal(q.items.length, SUPPORT_LIST_LIMIT, 'the card lists the oldest 25');
  assert.equal(q.items.filter((x: any) => x.kind === 'renewal').length, 0, 'the fixture must put renewals past the list');
  const kind = (k: string) => q.kinds.find((x: any) => x.kind === k);
  assert.equal(kind('moderation').count, 20);
  assert.equal(kind('seat_increase').count, 7);
  assert.equal(kind('renewal').count, 3, 'a kind past the 25 listed was counted from the cut list');
  assert.deepEqual(kind('renewal').items.map((x: any) => x.uid), ['esc_27', 'esc_28', 'esc_29'], 'its rows travel with it');
  assert.equal(kind('terms_change').count, 0, 'an always-offered kind with none open is a measured 0 on a whole read');
  const sum = q.kinds.reduce((s: number, k: any) => s + k.count, 0);
  assert.equal(sum, q.count, 'the pills foot to the board');
});

test('D5030: past the read ceiling a per-kind count is withheld, never the length of a cut list; the rows stay exact', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({
    uid: `e${i}`, branch_code: 'fr', kind: i % 2 ? 'moderation' : 'other', subject: 's', subject_ref: null, detail: null,
    raised_by_name: null, status: 'open', due_at: null, created_at: new Date(Date.now() - (40 - i) * H).toISOString(),
    answer: null, answered_at: null, relation: null, sla: 'ok',
  })) as any[];
  const cut = escalationKinds(items, false, Date.now(), ALWAYS_OFFERED_KINDS);
  assert.ok(cut.every((k) => k.count === null), 'a cut read produced a per-kind count');
  assert.equal(cut.find((k) => k.kind === 'moderation')!.items[0].uid, 'e1');
  assert.equal(cut.find((k) => k.kind === 'renewal')!.count, null, 'an absent kind on a cut read is unknown, not 0');
  const whole = escalationKinds(items, true, Date.now(), ALWAYS_OFFERED_KINDS);
  assert.equal(whole.find((k) => k.kind === 'moderation')!.count, 20);
  assert.equal(whole.find((k) => k.kind === 'moderation')!.items.length, SUPPORT_LIST_LIMIT >= 20 ? 20 : SUPPORT_LIST_LIMIT);
});

// ═════════════════════════════════════════════════ D5030 · filing snapshot ══

test('D5030: the filing snapshot records the standing at filing, by personaOf’s rules, on HQ and on a branch', async () => {
  const db = hqDb();
  assert.deepEqual(await filingSnapshot(hqEnv(db), FR_ADMIN, null), {
    filed_persona: 'admin_product', filed_role: 'admin', filed_licence_uid: 'lic_fr', filed_branch_code: 'fr',
  });
  assert.deepEqual(await filingSnapshot(hqEnv(db), WL_ADMIN, null), {
    filed_persona: 'admin_product', filed_role: 'admin', filed_licence_uid: 'lic_wl', filed_branch_code: null,
  });
  assert.deepEqual(await filingSnapshot(hqEnv(db), FOUNDER, null), {
    filed_persona: 'hq_held', filed_role: 'founder', filed_licence_uid: null, filed_branch_code: null,
  });
  assert.equal((await filingSnapshot(hqEnv(db), HOLDER, null)).filed_persona, 'hq_staff');
  assert.equal((await filingSnapshot(hqEnv(db), 999, null)).filed_persona, null, 'an unknown account is not given a persona');
  const b = branchDb();
  assert.deepEqual(await filingSnapshot(branchEnv(b), 1, 'fr'), {
    filed_persona: 'admin_product', filed_role: 'admin', filed_licence_uid: null, filed_branch_code: 'fr',
  });
  assert.equal((await filingSnapshot(branchEnv(b), 2, 'fr')).filed_persona, 'branch_member');
});

test('D5030: filing a ticket stores its filing context once, and a later demotion and detachment do not move its queue', async () => {
  const db = hqDb({ deployed: false });
  const env = hqEnv(db);
  const filed = await call(env, 'POST', '/api/tickets', { title: 'Seat count wrong', description: 'x', priority: 'high', type: 'bug' }, WL_ADMIN, 'admin');
  assert.equal(filed.status, 200, JSON.stringify(filed.body));
  const id = Number(filed.body.id ?? filed.body.ticket?.id);
  const row = db.prepare('SELECT filed_persona, filed_role, filed_licence_uid, filed_branch_code FROM tickets WHERE id = ?').get(id) as any;
  assert.deepEqual({ ...row }, { filed_persona: 'admin_product', filed_role: 'admin', filed_licence_uid: 'lic_wl', filed_branch_code: null });

  // A ticket filed before the record existed: no snapshot.
  db.prepare(`INSERT INTO tickets (id, title, status, priority, user_id, created_at) VALUES (900, 'legacy', 'open', 'low', ?, datetime('now', '-5 hours'))`).run(FOUNDER);

  // The administrator is demoted and detached (D134/D145).
  db.prepare("UPDATE users SET role = 'founder' WHERE id = ?").run(WL_ADMIN);
  db.prepare('DELETE FROM licence_admins WHERE user_id = ?').run(WL_ADMIN);

  const r = (await call(env, 'GET', '/api/admin/hq-support')).body;
  const about = r.tickets.buckets.admin_product;
  assert.equal(about.count, 1, 'the demoted administrator’s ticket left the About-Admin queue');
  const item = about.items[0];
  assert.equal(item.id, id);
  assert.equal(item.basis, 'as_filed');
  assert.equal(item.standing_changed, true);
  assert.equal(item.current.persona, 'hq_held', 'current standing is shown beside the filing');
  assert.equal(item.licence.uid, 'lic_wl', 'the queue keeps the licence it was filed under');
  assert.equal(r.tickets.buckets.hq_held.count, 1, 'only the legacy ticket is HQ-held');
  const legacy = r.tickets.buckets.hq_held.items[0];
  assert.equal(legacy.basis, 'current_standing', 'a ticket with no filing record must say its queue is current standing');
  assert.equal(legacy.filed, null, 'nothing was inferred into the filing record');
  assert.equal(r.tickets.buckets.hq_held.from_current_standing, 1);
  assert.equal(about.from_current_standing, 0);
  const cell = r.matrix.rows.find((x: any) => x.key === 'lic_wl').about_admin;
  assert.equal(cell.value, 1, 'the matrix moved the ticket off the licence it was filed under');
  // The row itself was never rewritten.
  assert.equal((db.prepare('SELECT filed_persona FROM tickets WHERE id = ?').get(id) as any).filed_persona, 'admin_product');
});

test('D5030: queuePersonaOf ignores a value outside the persona vocabulary and falls back to current standing, flagged', () => {
  const base = {
    id: 1, title: 't', status: 'open', priority: 'low', created_at: '', account_id: 5, requester_name: null,
    requester_email: null, requester_role: 'founder', requester_active: 1, licence_uid: null, licence_ref: null, licence_brand: null,
  };
  assert.deepEqual(queuePersonaOf({ ...base, filed_persona: 'branch_member' }), { persona: 'hq_held', basis: 'current_standing', licence_uid: null });
  assert.deepEqual(queuePersonaOf({ ...base, filed_persona: 'account_closed' }), { persona: 'account_closed', basis: 'as_filed', licence_uid: null });
});

test('D5030: on a branch, a ticket an administrator filed stays HQ’s after the demotion; a member’s never travels', async () => {
  const b = branchDb();
  const t = b.prepare(
    `INSERT INTO tickets (id, title, status, priority, user_id, created_at, filed_persona, filed_role, filed_branch_code)
     VALUES (?, ?, 'open', 'high', ?, datetime('now', ?), ?, ?, 'fr')`,
  );
  t.run(1, 'filed as admin, since demoted', 3, '-40 hours', 'admin_product', 'admin');
  t.run(2, 'filed as member, since promoted', 2, '-30 hours', 'branch_member', 'founder');
  b.prepare(`INSERT INTO tickets (id, title, status, priority, user_id, created_at) VALUES (3, 'legacy by an admin', 'open', 'low', 1, datetime('now', '-20 hours'))`).run();
  b.prepare("UPDATE users SET role = 'admin' WHERE id = 2").run();
  const r = await readBranchAdminTickets(branchEnv(b));
  assert.equal(r.available, true);
  if (!r.available) return;
  assert.deepEqual(r.items.map((x) => x.id), [1, 3]);
  assert.equal(r.count, 2);
});

// ════════════════════════════════════════════════════ D5031 · progressive ══

test('D5031: GET /local asks no branch, withholds the total while a branch is deployed, and answers HQ’s queues', async () => {
  const db = hqDb();
  db.prepare(`INSERT INTO tickets (id, title, status, priority, user_id, created_at) VALUES (1, 'export', 'open', 'medium', ?, datetime('now', '-3 hours'))`).run(FOUNDER);
  const bb = binding(branchDb(), { hang: true });
  const r = await call(hqEnv(db, { BRANCH_FR: bb.stub }), 'GET', '/api/admin/hq-support/local');
  assert.equal(r.status, 200);
  assert.deepEqual(bb.calls, [], 'the local read called a branch');
  assert.equal(r.body.scope, 'hq_local');
  assert.equal(r.body.tickets.buckets.hq_held.count, 1);
  assert.equal(r.body.escalations.available, true);
  assert.equal(r.body.total.value, null, 'a total without the deployed branch’s tickets would be a part');
  assert.equal(r.body.total.reason, BRANCHES_READ_SEPARATELY);
  assert.equal(r.body.branch_tickets, undefined);
  assert.equal(r.body.sla_policy.branch_copy.propagation, null, 'the local read claims no branch coverage');

  const solo = hqDb({ deployed: false });
  const s = await call(hqEnv(solo), 'GET', '/api/admin/hq-support/local');
  assert.equal(s.body.total.value, 0, 'with no branch deployed the local total is the whole total, measured');
});

test('D5031: one hung branch costs its own line; the full read still answers within the branch deadline with HQ’s queues', async () => {
  const db = hqDb();
  db.prepare(
    `INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status)
     VALUES ('lic_wl', 'ly', 'ly.axal.vc', 'studioos-ly', 'studioos-ly', 'live')`,
  ).run();
  db.prepare(`INSERT INTO tickets (id, title, status, priority, user_id, created_at) VALUES (1, 'export', 'open', 'medium', ?, datetime('now', '-3 hours'))`).run(FOUNDER);
  const fast = binding(branchDb());
  const hung = binding(branchDb(), { hang: true });
  const t0 = Date.now();
  const r = await call(hqEnv(db, { BRANCH_FR: fast.stub, BRANCH_LY: hung.stub }), 'GET', '/api/admin/hq-support');
  const took = Date.now() - t0;
  assert.equal(r.status, 200);
  assert.ok(took < BRANCH_DEADLINE_MS + 1500, `the read took ${took}ms`);
  const line = (code: string) => r.body.branch_tickets.lines.find((l: any) => l.code === code);
  assert.equal(line('fr').state, 'ok');
  assert.equal(line('ly').state, 'unreadable');
  assert.deepEqual(r.body.branch_tickets.coverage.unreadable, ['ly']);
  assert.equal(r.body.branch_tickets.coverage.complete, false);
  assert.equal(r.body.tickets.buckets.hq_held.count, 1, 'HQ’s queue was lost with the branch');
  assert.equal(r.body.total.value, null, 'an aggregate claimed completeness with a branch unreadable');
  const ly = r.body.sla_policy.branch_copy.propagation.branches.find((b: any) => b.code === 'ly');
  assert.equal(ly.state, 'unreadable');
});

test('D5031: an unreadable deployment registry withholds the full total rather than summing the branches that answered', async () => {
  const db = hqDb({ deployed: false });
  db.exec('DROP TABLE licence_deployments');
  const r = await call(hqEnv(db), 'GET', '/api/admin/hq-support');
  assert.equal(r.status, 200);
  assert.equal(r.body.total.value, null);
  assert.match(r.body.total.reason, /deployment registry/);
});

// ═══════════════════════════════════════════════ D5032 · versioned policy ══

test('D5032: an HQ tier change advances the version, reaches the branch in its licence copy, and the branch bands with it', async () => {
  const db = hqDb();
  const bdb = branchDb();
  const bb = binding(bdb);
  const env = hqEnv(db, { BRANCH_FR: bb.stub });

  // A 30-hour-old urgent ticket on the branch: past a 24h P1, due soon under 36h.
  const ticket = { priority: 'urgent', status: 'open', created_at: new Date(Date.now() - 30 * H).toISOString() };
  const bandOnBranch = async () => {
    const tiers = await readSlaTiers(branchEnv(bdb));
    return slaForTicket(ticket, tiers.available ? tiers.hours : null, Date.now());
  };
  assert.equal((await bandOnBranch()).band, 'past', 'the branch starts on the seed hours');
  assert.deepEqual(await readSlaPolicyVersion(branchEnv(bdb)), { available: true, version: null, source: null, applied_at: null });

  const put = await call(env, 'PUT', '/api/admin/hq-support/sla-tiers', TIERS(36, 48, 96));
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.deepEqual(put.body.changed, ['P1']);
  assert.equal(put.body.distribution.version, 1);
  assert.deepEqual(put.body.distribution.branches.map((b: any) => [b.code, b.state]), [['fr', 'applied']]);
  assert.equal(put.body.distribution.complete, true);
  assert.equal(put.body.sla_policy.version.value, 1);

  const held = await readSlaPolicyVersion(branchEnv(bdb));
  assert.equal(held.available && held.version, 1);
  assert.equal(held.available && held.source, 'pushed');
  const bt = await readSlaTiers(branchEnv(bdb));
  assert.equal(bt.available && bt.hours.P1, 36, 'the branch did not receive HQ’s P1 hours');
  assert.equal((await bandOnBranch()).band, 'due_soon', 'the branch bands its tickets with hours HQ no longer holds');

  const second = await call(env, 'PUT', '/api/admin/hq-support/sla-tiers', TIERS(36, 60, 96));
  assert.equal(second.body.distribution.version, 2, 'a second change did not advance the version');
  const g = (await call(env, 'GET', '/api/admin/hq-support')).body;
  const p = g.sla_policy.branch_copy.propagation;
  assert.equal(p.version, 2);
  assert.deepEqual([p.current, p.total, p.complete], [1, 1, true]);
  assert.equal(p.branches[0].state, 'current');
  assert.equal(g.sla_policy.branch_copy.held, false);
  // Escalation-kind hours are a separate promise: the copy carries the three
  // ticket tiers and their version, nothing else.
  const sent = JSON.parse(String(bb.records.at(-1)!.support_sla_json));
  assert.deepEqual(Object.keys(sent).sort(), ['tiers', 'version']);
  assert.deepEqual(sent.tiers.map((t: any) => t.id), ['P1', 'P2', 'P3']);
  assert.deepEqual(sent.tiers.map((t: any) => t.hours), [36, 60, 96]);
});

test('D5032: a save that changes nothing makes no version and sends nothing', async () => {
  const db = hqDb();
  const bb = binding(branchDb());
  const env = hqEnv(db, { BRANCH_FR: bb.stub });
  const same = await call(env, 'PUT', '/api/admin/hq-support/sla-tiers', TIERS(24, 48, 96));
  assert.equal(same.status, 200);
  assert.deepEqual(same.body.changed, []);
  assert.equal(same.body.distribution, null);
  assert.equal(same.body.sla_policy.version.value, null, 'an unchanged save numbered the policy');
  assert.deepEqual(bb.calls, []);
});

test('D5032: a branch that fails the push is reported as not applied, stays owed, and reads as stale afterwards', async () => {
  const db = hqDb();
  const bdb = branchDb();
  const down = binding(bdb, { applyThrows: true });
  const put = await call(hqEnv(db, { BRANCH_FR: down.stub }), 'PUT', '/api/admin/hq-support/sla-tiers', TIERS(12, 48, 96));
  assert.equal(put.status, 200);
  assert.equal(put.body.distribution.complete, false, 'a save claimed platform-wide application on a failed push');
  assert.equal(put.body.distribution.applied, 0);
  assert.equal(put.body.distribution.branches[0].state, 'failed');
  assert.match(put.body.distribution.branches[0].reason, /stays queued/);
  const owed = db.prepare('SELECT code FROM licence_push_pending').all() as any[];
  assert.deepEqual(owed.map((x) => x.code), ['fr'], 'the failed push is not owed to the retry');

  const g = (await call(hqEnv(db, { BRANCH_FR: binding(bdb).stub }), 'GET', '/api/admin/hq-support')).body;
  const fr = g.sla_policy.branch_copy.propagation.branches[0];
  assert.equal(fr.state, 'stale');
  assert.equal(fr.version, null);
  assert.match(fr.reason, /holds no version/);
  assert.equal(g.sla_policy.branch_copy.propagation.complete, false);
});

test('D5032: a branch on an older deploy is unreported, an unbound one not deployed — neither is current', async () => {
  const db = hqDb();
  db.prepare(
    `INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status)
     VALUES ('lic_wl', 'ly', 'ly.axal.vc', 'studioos-ly', 'studioos-ly', 'live')`,
  ).run();
  await call(hqEnv(db), 'PUT', '/api/admin/hq-support/sla-tiers', TIERS(30, 48, 96));
  const g = (await call(hqEnv(db, { BRANCH_FR: binding(branchDb(), { oldDeploy: true }).stub }), 'GET', '/api/admin/hq-support')).body;
  const p = g.sla_policy.branch_copy.propagation;
  const by = Object.fromEntries(p.branches.map((b: any) => [b.code, b.state]));
  assert.deepEqual(by, { fr: 'unreported', ly: 'not_deployed' });
  assert.equal(p.current, 0);
  assert.equal(p.complete, false);
});

test('D5032: an older policy never replaces a newer one on a branch, and a malformed copy is refused', async () => {
  const b = branchDb();
  const env = branchEnv(b);
  const copy = (v: number, p1: number) => ({ version: v, tiers: [
    { id: 'P1', hours: p1, description: 'a' }, { id: 'P2', hours: 48, description: 'b' }, { id: 'P3', hours: 96, description: 'c' },
  ] });
  assert.equal((await applySlaPolicyCopy(env, copy(3, 20))).applied, true);
  const stale = await applySlaPolicyCopy(env, copy(2, 10));
  assert.deepEqual([stale.applied, stale.stale, stale.version], [false, true, 3]);
  const t = await readSlaTiers(env);
  assert.equal(t.available && t.hours.P1, 20, 'an older copy overwrote newer hours');
  assert.equal(parseSlaPolicyCopy(JSON.stringify(copy(4, 60))).ok, false, 'P1 above P2 was accepted');
  assert.equal(parseSlaPolicyCopy('{"version":0}').ok, false);
  assert.equal(parseSlaPolicyCopy('not json').ok, false);
});

test('D5032: slaPropagation never calls a branch current while HQ’s own version is unknown', () => {
  const ok = (v: number | null) => ({ code: 'fr', binding: 'BRANCH_FR', status: 'ok' as const, data: { sla_policy: { available: true as const, version: v, source: 'pushed' as const, applied_at: null } } });
  const unnumbered = slaPropagation({ available: true, version: null, source: null, applied_at: null }, [ok(null)], (c) => c);
  assert.equal(unnumbered.current, 0);
  assert.equal(unnumbered.complete, false);
  assert.match(unnumbered.reason || '', /numbered 1/);
  const unreadable = slaPropagation({ available: false, reason: 'gone' }, [ok(2)], (c) => c);
  assert.equal(unreadable.branches[0].state, 'stale');
  assert.equal(unreadable.complete, false);
  const current = slaPropagation({ available: true, version: 2, source: 'hq', applied_at: null }, [ok(2)], (c) => c);
  assert.deepEqual([current.current, current.complete], [1, true]);
});

test('D5032: a branch that does not answer the save’s push is "not yet known", and the push is owed from the commit', async () => {
  const db = hqDb();
  const hung = binding(branchDb(), { applyHangs: true });
  const t0 = Date.now();
  const put = await call(hqEnv(db, { BRANCH_FR: hung.stub }), 'PUT', '/api/admin/hq-support/sla-tiers', TIERS(20, 48, 96));
  assert.ok(Date.now() - t0 < SLA_PUSH_DEADLINE_MS + 1500, 'the save waited past its deadline');
  assert.equal(put.status, 200);
  assert.equal(put.body.distribution.branches[0].state, 'unknown');
  assert.equal(put.body.distribution.complete, false);
  // Nothing recorded an outcome (the push never answered): the row is the one
  // the save's own batch wrote, so the cron sends it.
  const owed = db.prepare('SELECT code, reason FROM licence_push_pending').all() as any[];
  assert.deepEqual(owed.map((x) => [x.code, x.reason]), [['fr', 'queued with the change']]);
});

test('D5032: two copies racing cannot leave older hours under a newer version (the guard inside the batch)', async () => {
  const b = branchDb();
  const env = branchEnv(b);
  const copy = (v: number, p1: number) => ({ version: v, tiers: [
    { id: 'P1' as const, hours: p1, description: 'a' }, { id: 'P2' as const, hours: 48, description: 'b' }, { id: 'P3' as const, hours: 96, description: 'c' },
  ] });
  await applySlaPolicyCopy(env, copy(3, 20));
  // The older copy's first read saw the world before v3 landed: it answers "no row".
  const base = d1Over(b);
  let raced = false;
  const racing = {
    ...base,
    prepare(sql: string) {
      if (!raced && /FROM support_sla_policy_state WHERE id = 1/.test(sql) && /SELECT version, source/.test(sql)) {
        raced = true;
        const api: any = { bind: () => api, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) };
        return api;
      }
      return base.prepare(sql);
    },
    batch: base.batch,
  };
  const res = await applySlaPolicyCopy({ DB: racing } as any, copy(2, 10));
  assert.ok(raced);
  assert.equal(res.stale, true);
  const t = await readSlaTiers(env);
  assert.equal(t.available && t.hours.P1, 20, 'the older copy overwrote the newer hours inside the batch');
  const v = await readSlaPolicyVersion(env);
  assert.equal(v.available && v.version, 3);
});

test('D5032: with no version and no branch, the propagation is still not complete', () => {
  const p = slaPropagation({ available: true, version: null, source: null, applied_at: null }, [], (c) => c);
  assert.equal(p.complete, false, 'an unnumbered policy was called applied everywhere');
});

test('D5032: a tier store without all three tiers sends no SLA section, and the licence push is not made partial by it', async () => {
  const db = hqDb();
  db.exec("DELETE FROM hq_support_sla_tiers WHERE tier = 'P3'");
  const bb = binding(branchDb());
  const { pushLicenceToBranch } = await import('../src/services/licencePush.ts');
  const res = await pushLicenceToBranch(hqEnv(db, { BRANCH_FR: bb.stub }), 1);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal('support_sla_json' in bb.records[0], false, 'a partial policy was sent');
});
