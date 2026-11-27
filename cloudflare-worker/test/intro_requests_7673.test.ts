/** D7673 (#7673): role-neutral introduction requests — readiness, lifecycle, visibility, idempotency, races and reconciliation, on synthetic records only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import router, { mount } from '../src/routes/intro_requests.ts';
import {
  NEXT_ACTOR,
  REQUEST_STATES,
  notificationFor,
  readinessGaps,
  recordContactAttempt,
  submitRequest,
} from '../src/services/introductionRequests.ts';

const SECRET = 'intro-requests-7673-synthetic-test-key';
// Every person, organisation and account here is invented; addresses use the reserved example.test domain.
const ROLES = { founder: 767301, investor: 767302, advisor: 767303, partner: 767304, exploring: 767305 } as const;
const OPERATOR = 767310, OPERATOR_2 = 767311;

function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const users = Object.entries(ROLES).map(([role, id]) => `(${id},'7673-${role}@example.test','Synthetic ${role}','${role}',1)`);
  users.push(`(${OPERATOR},'7673-op@example.test','Synthetic operator','admin',1)`, `(${OPERATOR_2},'7673-op2@example.test','Synthetic operator two','admin',1)`);
  db.exec(`INSERT INTO users(id,email,name,role,is_active) VALUES ${users.join(',')};
    -- D9067: the operator side needs a Super Admin's named grant; both operators hold one, the first also reviews.
    INSERT INTO network_intro_staff_grants(uid,user_id,kind,granted_by,reason) VALUES
      ('g7673-op',${OPERATOR},'operator',${OPERATOR},'Synthetic grant'), ('g7673-rev',${OPERATOR},'reviewer',${OPERATOR},'Synthetic grant'),
      ('g7673-op2',${OPERATOR_2},'operator',${OPERATOR},'Synthetic grant');
    INSERT INTO network_directory_sources(uid,name,url) VALUES ('src-7673','Synthetic source','https://directory.example.test');
    INSERT INTO network_directory_entries(uid,kind,source_uid,source_external_id,display_name,publication_status,observed_at) VALUES
      ('p-ada','person','src-7673','r1','Ada Example','published','2026-11-01 00:00:00'),
      ('p-ada-2','person','src-7673','r2','Ada Example','published','2026-11-01 00:00:00'),
      ('p-staged','person','src-7673','r3','Staged Example','staged','2026-11-01 00:00:00'),
      ('o-acme','organization','src-7673','r4','Acme Example Capital','published','2026-11-01 00:00:00');
    PRAGMA foreign_keys=ON;`);
  const app = new Hono().route(mount.path, router);
  app.onError((e, c) => {
    const m = e.message;
    const status = m === 'Unauthorized' ? 401 : /required/i.test(m) ? 403 : 500;
    return c.json({ detail: status === 500 ? 'Unavailable' : m }, status);
  });
  return { db, app, env: { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
type F = ReturnType<typeof fixture>;

async function call(f: F, method: string, path: string, body?: any, who: number | null = ROLES.founder, support = false) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who)
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, ...(support ? { impersonated_by: OPERATOR } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
  const r = await f.app.request(`/api/intro-requests${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, f.env);
  return { status: r.status, body: (await r.json()) as any };
}

async function makeReady(f: F, who: number) {
  assert.equal((await call(f, 'PUT', '/readiness/professional_profile', { value: { headline: 'Synthetic headline' } }, who)).status, 200);
  assert.equal((await call(f, 'PUT', '/readiness/capacity', { value: { capacity: 'Synthetic capacity' } }, who)).status, 200);
  for (const key of ['professional_profile', 'capacity'])
    assert.equal((await call(f, 'POST', `/operator/readiness/${who}/${key}`, { decision: 'approved' }, OPERATOR)).status, 200);
}
async function draft(f: F, who: number, extra: Record<string, unknown> = {}, key = `key-${who}-${Math.random()}`) {
  const r = await call(f, 'POST', '', { idempotency_key: key, target_entry_uid: 'p-ada', purpose: 'Synthetic purpose', shareable_brief: 'Synthetic brief', private_notes: 'Synthetic private note', ...extra }, who);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.request;
}
const stateOf = (f: F, uid: string) => (f.db.prepare('SELECT state, revision FROM network_intro_requests WHERE uid=?').get(uid) as any);

test('the migration builds the tables, the seeded base policy and its guards', () => {
  const f = fixture();
  try {
    const policy = f.db.prepare('SELECT version, requirements_json, validity_days, active FROM network_intro_policies').all() as any[];
    assert.deepEqual(policy.map((p) => ({ ...p })), [{ version: 1, requirements_json: '["professional_profile","capacity"]', validity_days: null, active: 1 }]);
    assert.throws(() => f.db.exec(`INSERT INTO network_intro_policies(uid,version,requirements_json,active) VALUES ('second',2,'[]',1)`), /UNIQUE/);
    f.db.exec(`INSERT INTO network_intro_requests(uid,requester_user_id,idempotency_key,target_entry_uid) VALUES ('r1',${ROLES.founder},'schema-key-1','p-ada')`);
    // A target is a directory person and context a directory organisation; the trigger refuses the swap.
    assert.throws(() => f.db.exec(`INSERT INTO network_intro_requests(uid,requester_user_id,idempotency_key,target_entry_uid) VALUES ('r2',${ROLES.founder},'schema-key-2','o-acme')`), /directory person/);
    assert.throws(() => f.db.exec(`UPDATE network_intro_requests SET organization_entry_uid='p-ada' WHERE uid='r1'`), /directory person/);
    assert.throws(() => f.db.exec(`INSERT INTO network_intro_requests(uid,requester_user_id,idempotency_key) VALUES ('r3',${ROLES.founder},'schema-key-3')`), /CHECK/);
    f.db.exec(`INSERT INTO network_intro_events(request_uid,actor_role,event_type) VALUES ('r1','system','probe')`);
    assert.throws(() => f.db.exec(`UPDATE network_intro_events SET event_type='rewritten'`), /append-only/);
    assert.throws(() => f.db.exec(`DELETE FROM network_intro_events`), /append-only/);
    f.db.exec(`INSERT INTO network_intro_contact_attempts(uid,request_uid,operator_user_id,idempotency_key,channel,delivery_state) VALUES ('a1','r1',${OPERATOR},'attempt-key-1','email','delivered')`);
    assert.throws(() => f.db.exec(`DELETE FROM network_intro_contact_attempts`), /contact history/);
    assert.throws(() => f.db.exec(`UPDATE network_intro_contact_attempts SET delivery_state='failed' WHERE uid='a1'`), /unsettled/);
    assert.throws(() => f.db.exec(`INSERT INTO network_intro_readiness(user_id,requirement_key,status) VALUES (${ROLES.founder},'capacity','approved')`), /CHECK/);
  } finally {
    f.db.close();
  }
});

test('every role asks the same way, and a target needs no account', async () => {
  const f = fixture();
  try {
    for (const [role, id] of Object.entries(ROLES)) {
      await makeReady(f, id);
      const d = await draft(f, id);
      const s = await call(f, 'POST', `/${d.uid}/submit`, { expected_revision: d.revision }, id);
      assert.equal(s.status, 200, role);
      assert.equal(s.body.request.state, 'submitted', role);
      assert.equal(s.body.request.next_actor, 'operator', role);
      assert.equal(s.body.request.service_type, 'directory_introduction');
      assert.equal(s.body.request.target.entry_uid, 'p-ada');
    }
    // The target entry has no platform account: the request never needed one.
    assert.equal((f.db.prepare(`SELECT linked_user_id FROM network_directory_entries WHERE uid='p-ada'`).get() as any).linked_user_id, null);
  } finally {
    f.db.close();
  }
});

test('readiness is checked from stored reviews, never from what the client sends', async () => {
  const f = fixture();
  try {
    const me = ROLES.investor;
    const d = await draft(f, me);
    // A client claiming readiness changes nothing: the submit reads the rows.
    let s = await call(f, 'POST', `/${d.uid}/submit`, { expected_revision: d.revision, ready: true, readiness: { professional_profile: 'met' } }, me);
    assert.equal(s.body.request.state, 'readiness_needed');
    assert.deepEqual(s.body.readiness.requirements.map((r: any) => r.status), ['missing', 'missing']);
    await call(f, 'PUT', '/readiness/professional_profile', { value: { headline: 'Synthetic headline' } }, me);
    await call(f, 'PUT', '/readiness/capacity', { value: { capacity: 'Synthetic capacity', represented_organization: 'Synthetic Org' } }, me);
    s = await call(f, 'POST', `/${d.uid}/submit`, { expected_revision: stateOf(f, d.uid).revision }, me);
    assert.equal(s.body.request.state, 'readiness_needed', 'submitted but unreviewed is not met');
    assert.deepEqual(s.body.readiness.requirements.map((r: any) => r.status), ['awaiting_review', 'awaiting_review']);
    // A reviewer cannot approve their own readiness.
    await call(f, 'PUT', '/readiness/capacity', { value: { capacity: 'Op capacity' } }, OPERATOR);
    assert.equal((await call(f, 'POST', `/operator/readiness/${OPERATOR}/capacity`, { decision: 'approved' }, OPERATOR)).body.error, 'self_review_refused');
    assert.equal((await call(f, 'POST', `/operator/readiness/${me}/capacity`, { decision: 'approved' }, OPERATOR)).status, 200);
    assert.equal((await call(f, 'POST', `/operator/readiness/${me}/professional_profile`, { decision: 'rejected' }, OPERATOR)).status, 200);
    s = await call(f, 'POST', `/${d.uid}/submit`, { expected_revision: stateOf(f, d.uid).revision }, me);
    assert.deepEqual(s.body.readiness.requirements.map((r: any) => r.status), ['rejected', 'met']);
    // Editing an approved requirement sends it back to review.
    await call(f, 'PUT', '/readiness/capacity', { value: { capacity: 'Changed capacity' } }, me);
    assert.equal((await call(f, 'GET', '/readiness', undefined, me)).body.requirements[1].status, 'awaiting_review');
    await call(f, 'PUT', '/readiness/professional_profile', { value: { headline: 'Synthetic headline 2' } }, me);
    for (const k of ['professional_profile', 'capacity']) await call(f, 'POST', `/operator/readiness/${me}/${k}`, { decision: 'approved' }, OPERATOR);
    s = await call(f, 'POST', `/${d.uid}/submit`, { expected_revision: stateOf(f, d.uid).revision }, me);
    assert.equal(s.body.request.state, 'submitted');
    assert.equal(s.body.request.policy_version, 1);
    const snap = JSON.parse((f.db.prepare('SELECT policy_snapshot_json FROM network_intro_requests WHERE uid=?').get(d.uid) as any).policy_snapshot_json);
    assert.deepEqual(snap.requirements, ['professional_profile', 'capacity']);
    assert.equal((await call(f, 'PUT', '/readiness/unknown_requirement', { value: { x: 'y' } }, me)).body.error, 'requirement_unknown');
    assert.equal((await call(f, 'PUT', '/readiness/professional_profile', { value: { headline: 'H', profile_url: 'http://insecure.example.test' } }, me)).body.error, 'profile_url_invalid');
  } finally {
    f.db.close();
  }
});

test('an approval past its validity is expired, and a policy without a validity never expires one', () => {
  const now = new Date('2026-11-22T12:00:00Z');
  assert.deepEqual(
    readinessGaps(['a', 'b', 'c', 'd'], [
      { requirement_key: 'a', status: 'approved', valid_until: '2026-11-22 11:59:59' },
      { requirement_key: 'b', status: 'approved', valid_until: '2026-11-22 12:00:01' },
      { requirement_key: 'c', status: 'approved', valid_until: null },
    ], now).map((g) => g.status),
    ['expired', 'met', 'met', 'missing'],
  );
});

test('idempotency: the same key returns the first request; another member\'s same key is theirs', async () => {
  const f = fixture();
  try {
    const a = await call(f, 'POST', '', { idempotency_key: 'shared-key-1', target_entry_uid: 'p-ada' }, ROLES.founder);
    const again = await call(f, 'POST', '', { idempotency_key: 'shared-key-1', target_entry_uid: 'p-ada-2', purpose: 'different' }, ROLES.founder);
    assert.equal(a.status, 201);
    assert.equal(again.status, 200);
    assert.equal(again.body.request.uid, a.body.request.uid);
    assert.equal(again.body.request.target.entry_uid, 'p-ada', 'a replay never rewrites the first request');
    // A replay is answered from the first request even when its body would now be refused.
    const stale = await call(f, 'POST', '', { idempotency_key: 'shared-key-1', target_entry_uid: 'p-staged', purpose: 'x'.repeat(5000) }, ROLES.founder);
    assert.equal(stale.status, 200);
    assert.equal(stale.body.request.uid, a.body.request.uid);
    const other = await call(f, 'POST', '', { idempotency_key: 'shared-key-1', target_entry_uid: 'p-ada' }, ROLES.investor);
    assert.notEqual(other.body.request.uid, a.body.request.uid);
    // Two creates racing with one key make one request and one draft event.
    const [x, y] = await Promise.all([1, 2].map(() => call(f, 'POST', '', { idempotency_key: 'race-key-01', target_entry_uid: 'p-ada' }, ROLES.advisor)));
    assert.equal(x.body.request.uid, y.body.request.uid);
    assert.equal((f.db.prepare(`SELECT COUNT(*) AS n FROM network_intro_requests WHERE requester_user_id=?`).get(ROLES.advisor) as any).n, 1);
    assert.equal((f.db.prepare(`SELECT COUNT(*) AS n FROM network_intro_events WHERE request_uid=?`).get(x.body.request.uid) as any).n, 1);
    assert.equal((await call(f, 'POST', '', { target_entry_uid: 'p-ada' })).body.error, 'idempotency_key_required');
  } finally {
    f.db.close();
  }
});

test('targets: only published directory people; namesakes stay apart; staged entries do not leak', async () => {
  const f = fixture();
  try {
    for (const target of ['p-staged', 'o-acme', 'p-missing'])
      assert.equal((await call(f, 'POST', '', { idempotency_key: `t-${target}-key`, target_entry_uid: target })).body.error, 'target_not_found', target);
    assert.equal((await call(f, 'POST', '', { idempotency_key: 'org-as-person', organization_entry_uid: 'p-ada' })).body.error, 'organization_not_found');
    const one = await draft(f, ROLES.founder, { target_entry_uid: 'p-ada' });
    const two = await draft(f, ROLES.founder, { target_entry_uid: 'p-ada-2' });
    assert.equal(one.target.display_name, two.target.display_name);
    assert.notEqual(one.target.entry_uid, two.target.entry_uid, 'same name, two people');
    assert.equal((await call(f, 'POST', '', { idempotency_key: 'both-targets', target_entry_uid: 'p-ada', target_provisional_uid: 'x' })).body.error, 'one_target_only');
  } finally {
    f.db.close();
  }
});

test('a provisional target is the creator\'s own until an operator resolves it; the reference stays stable', async () => {
  const f = fixture();
  try {
    const p = await call(f, 'POST', '/provisional-targets', { display_name: 'New Example Person', organization_text: 'Example Ventures' }, ROLES.founder);
    assert.equal(p.status, 201);
    assert.equal((await call(f, 'POST', '', { idempotency_key: 'steal-provisional', target_provisional_uid: p.body.uid }, ROLES.investor)).body.error, 'target_not_found');
    await makeReady(f, ROLES.founder);
    const d = await draft(f, ROLES.founder, { target_entry_uid: undefined, target_provisional_uid: p.body.uid });
    assert.equal(d.target.kind, 'provisional');
    assert.equal(d.target.recipient_identified, false);
    await call(f, 'POST', `/${d.uid}/submit`, { expected_revision: d.revision });
    await call(f, 'POST', `/operator/requests/${d.uid}/assign`, { expected_revision: stateOf(f, d.uid).revision }, OPERATOR);
    assert.equal((await call(f, 'POST', `/operator/requests/${d.uid}/move`, { expected_revision: stateOf(f, d.uid).revision, to: 'outreach_ready' }, OPERATOR)).body.error, 'recipient_required');
    const set = await call(f, 'POST', `/operator/requests/${d.uid}/recipient`, { expected_revision: stateOf(f, d.uid).revision, entry_uid: 'p-ada-2' }, OPERATOR);
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(set.body.request.target.entry_uid, 'p-ada-2');
    assert.equal(set.body.request.target.provisional_uid, p.body.uid, 'the request keeps its own reference');
    assert.equal((await call(f, 'GET', `/${d.uid}`)).body.request.target.entry_uid, 'p-ada-2');
  } finally {
    f.db.close();
  }
});

test('an organisation-only request needs a named person before outreach', async () => {
  const f = fixture();
  try {
    await makeReady(f, ROLES.partner);
    const d = await draft(f, ROLES.partner, { target_entry_uid: undefined, organization_entry_uid: 'o-acme' });
    assert.equal(d.target.kind, 'none');
    assert.equal(d.target.organization_name, 'Acme Example Capital');
    await call(f, 'POST', `/${d.uid}/submit`, { expected_revision: d.revision }, ROLES.partner);
    await call(f, 'POST', `/operator/requests/${d.uid}/assign`, { expected_revision: stateOf(f, d.uid).revision }, OPERATOR);
    assert.equal((await call(f, 'POST', `/operator/requests/${d.uid}/move`, { expected_revision: stateOf(f, d.uid).revision, to: 'outreach_ready' }, OPERATOR)).body.error, 'recipient_required');
    await call(f, 'POST', `/operator/requests/${d.uid}/recipient`, { expected_revision: stateOf(f, d.uid).revision, entry_uid: 'p-ada' }, OPERATOR);
    assert.equal((await call(f, 'POST', `/operator/requests/${d.uid}/move`, { expected_revision: stateOf(f, d.uid).revision, to: 'outreach_ready' }, OPERATOR)).body.request.state, 'outreach_ready');
  } finally {
    f.db.close();
  }
});

test('the whole lifecycle, with distinct events and who acts next at each step', async () => {
  const f = fixture();
  try {
    const me = ROLES.founder;
    await makeReady(f, me);
    const d = await draft(f, me);
    const steps: Array<[string, string, any, number]> = [
      ['POST', `/${d.uid}/submit`, {}, me],
      ['POST', `/operator/requests/${d.uid}/assign`, {}, OPERATOR],
      ['POST', `/operator/requests/${d.uid}/move`, { to: 'needs_information', question: 'Which round is this for?' }, OPERATOR],
      ['POST', `/${d.uid}/submit`, {}, me],
      ['POST', `/operator/requests/${d.uid}/move`, { to: 'outreach_ready' }, OPERATOR],
      ['POST', `/operator/requests/${d.uid}/contact-attempts`, { idempotency_key: 'contact-key-1', channel: 'email' }, OPERATOR],
      ['POST', `/operator/requests/${d.uid}/move`, { to: 'awaiting_target' }, OPERATOR],
      ['POST', `/operator/requests/${d.uid}/move`, { to: 'agreed' }, OPERATOR],
      ['POST', `/operator/requests/${d.uid}/move`, { to: 'introduction_made' }, OPERATOR],
      ['POST', `/operator/requests/${d.uid}/move`, { to: 'closed', outcome_note: 'Synthetic outcome' }, OPERATOR],
    ];
    const seen: string[] = [];
    for (const [m, p, b, who] of steps) {
      const r = await call(f, m, p, { ...b, expected_revision: stateOf(f, d.uid).revision }, who);
      assert.ok(r.status < 300, `${p} ${JSON.stringify(r.body)}`);
      const s = stateOf(f, d.uid).state;
      seen.push(s);
      assert.equal((f.db.prepare('SELECT next_actor FROM network_intro_requests WHERE uid=?').get(d.uid) as any).next_actor, NEXT_ACTOR[s as keyof typeof NEXT_ACTOR]);
    }
    assert.deepEqual(seen, ['submitted', 'in_review', 'needs_information', 'in_review', 'outreach_ready', 'contacted', 'awaiting_target', 'agreed', 'introduction_made', 'closed']);
    const view = (await call(f, 'GET', `/operator/requests/${d.uid}`, undefined, OPERATOR)).body.request;
    assert.equal(view.consent_status, 'granted');
    assert.deepEqual(view.events.map((e: any) => e.type), [
      'draft_created', 'submitted', 'assigned', 'moved_needs_information', 'information_supplied', 'moved_outreach_ready',
      'contact_attempted', 'moved_awaiting_target', 'moved_agreed', 'moved_introduction_made', 'moved_closed',
    ]);
    assert.ok(view.closed_at);
    // A closed request moves nowhere, and an operator cannot jump states.
    assert.equal((await call(f, 'POST', `/operator/requests/${d.uid}/move`, { expected_revision: stateOf(f, d.uid).revision, to: 'agreed' }, OPERATOR)).body.error, 'transition_not_allowed');
    assert.equal((await call(f, 'POST', `/${d.uid}/withdraw`, { expected_revision: stateOf(f, d.uid).revision })).body.error, 'request_not_withdrawable');
  } finally {
    f.db.close();
  }
});

test('races: a stale revision is refused and writes nothing; only the assigned operator acts', async () => {
  const f = fixture();
  try {
    const me = ROLES.founder;
    await makeReady(f, me);
    const d = await draft(f, me);
    const [a, b] = await Promise.all([1, 2].map(() => call(f, 'POST', `/${d.uid}/submit`, { expected_revision: d.revision }, me)));
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal((f.db.prepare(`SELECT COUNT(*) AS n FROM network_intro_events WHERE request_uid=? AND event_type='submitted'`).get(d.uid) as any).n, 1);
    const rev = stateOf(f, d.uid).revision;
    // Withdraw and assign at the same revision: exactly one wins.
    const [w, s] = await Promise.all([
      call(f, 'POST', `/${d.uid}/withdraw`, { expected_revision: rev }, me),
      call(f, 'POST', `/operator/requests/${d.uid}/assign`, { expected_revision: rev }, OPERATOR),
    ]);
    assert.deepEqual([w.status, s.status].sort(), [200, 409]);
    if (s.status === 200) {
      assert.equal((await call(f, 'POST', `/operator/requests/${d.uid}/move`, { expected_revision: stateOf(f, d.uid).revision, to: 'outreach_ready' }, OPERATOR_2)).body.error, 'not_assigned_operator');
    }
    assert.equal((await call(f, 'POST', `/${d.uid}/submit`, {}, me)).body.error, 'expected_revision_required');
  } finally {
    f.db.close();
  }
});

test('a write that loses a race between its read and its update changes nothing and writes no event', async () => {
  const f = fixture();
  try {
    const me = ROLES.founder;
    await makeReady(f, me);
    const d = await draft(f, me);
    // Another writer lands between this call's read and its batch.
    let interleaved = false;
    const db = { ...f.env.DB, prepare: f.env.DB.prepare, batch: async (stmts: any[]) => {
      if (!interleaved) { interleaved = true; f.db.exec(`UPDATE network_intro_requests SET revision = revision + 1 WHERE uid = '${d.uid}'`); }
      return f.env.DB.batch(stmts);
    } };
    await assert.rejects(submitRequest(db, me, d.uid, { expected_revision: d.revision }), { code: 'revision_conflict' });
    assert.equal(stateOf(f, d.uid).state, 'draft');
    assert.equal((f.db.prepare(`SELECT COUNT(*) AS n FROM network_intro_events WHERE request_uid=? AND event_type != 'draft_created'`).get(d.uid) as any).n, 0);
  } finally {
    f.db.close();
  }
});

test('only the operator a request is assigned to moves it, names its recipient or records contact', async () => {
  const f = fixture();
  try {
    await makeReady(f, ROLES.founder);
    const d = await draft(f, ROLES.founder);
    await call(f, 'POST', `/${d.uid}/submit`, { expected_revision: d.revision });
    await call(f, 'POST', `/operator/requests/${d.uid}/assign`, { expected_revision: stateOf(f, d.uid).revision }, OPERATOR);
    const rev = stateOf(f, d.uid).revision;
    assert.equal((await call(f, 'POST', `/operator/requests/${d.uid}/move`, { expected_revision: rev, to: 'outreach_ready' }, OPERATOR_2)).body.error, 'not_assigned_operator');
    assert.equal((await call(f, 'POST', `/operator/requests/${d.uid}/recipient`, { expected_revision: rev, entry_uid: 'p-ada-2' }, OPERATOR_2)).body.error, 'not_assigned_operator');
    assert.equal((await call(f, 'POST', `/operator/requests/${d.uid}/contact-attempts`, { expected_revision: rev, idempotency_key: 'other-op-key', channel: 'email' }, OPERATOR_2)).body.error, 'not_assigned_operator');
    assert.equal(stateOf(f, d.uid).revision, rev);
  } finally {
    f.db.close();
  }
});

test('contact: a replay sends nothing again, a lost response is uncertain until reconciled, never resent blind', async () => {
  const f = fixture();
  try {
    const me = ROLES.founder;
    await makeReady(f, me);
    const d = await draft(f, me);
    await call(f, 'POST', `/${d.uid}/submit`, { expected_revision: d.revision });
    await call(f, 'POST', `/operator/requests/${d.uid}/assign`, { expected_revision: stateOf(f, d.uid).revision }, OPERATOR);
    await call(f, 'POST', `/operator/requests/${d.uid}/move`, { expected_revision: stateOf(f, d.uid).revision, to: 'outreach_ready' }, OPERATOR);
    let sends = 0;
    const lost = { send: async () => { sends++; throw new Error('synthetic timeout'); } };
    const ok = { send: async () => { sends++; return { provider_ref: 'fake-ref-1' }; } };
    const first = await recordContactAttempt(f.env.DB, OPERATOR, d.uid, { idempotency_key: 'attempt-lost-1', channel: 'email', expected_revision: stateOf(f, d.uid).revision }, lost);
    assert.equal(first.attempt.delivery_state, 'uncertain');
    // The same key again: the recorded attempt, and no second send.
    const replay = await recordContactAttempt(f.env.DB, OPERATOR, d.uid, { idempotency_key: 'attempt-lost-1', channel: 'email' }, ok);
    assert.equal(replay.replayed, true);
    assert.equal(sends, 1);
    // A new key while the first is unsettled is refused: reconcile first.
    await assert.rejects(recordContactAttempt(f.env.DB, OPERATOR, d.uid, { idempotency_key: 'attempt-new-02', channel: 'email', expected_revision: stateOf(f, d.uid).revision }, ok), { code: 'attempt_unreconciled' });
    assert.equal(sends, 1);
    assert.equal((await call(f, 'POST', `/operator/contact-attempts/${first.attempt.uid}/reconcile`, { delivery_state: 'delivered', provider_ref: 'fake-ref-0' }, OPERATOR_2)).body.error, 'not_assigned_operator');
    assert.equal((await call(f, 'POST', `/operator/contact-attempts/${first.attempt.uid}/reconcile`, { delivery_state: 'delivered', provider_ref: 'fake-ref-0' }, OPERATOR)).status, 200);
    assert.equal((await call(f, 'POST', `/operator/contact-attempts/${first.attempt.uid}/reconcile`, { delivery_state: 'failed' }, OPERATOR)).body.error, 'attempt_settled');
    const second = await recordContactAttempt(f.env.DB, OPERATOR, d.uid, { idempotency_key: 'attempt-new-02', channel: 'email', expected_revision: stateOf(f, d.uid).revision }, ok);
    assert.equal(second.attempt.delivery_state, 'delivered');
    assert.equal(sends, 2);
    // Withdrawing after contact keeps every attempt and event.
    const before = (f.db.prepare('SELECT COUNT(*) AS n FROM network_intro_events WHERE request_uid=?').get(d.uid) as any).n;
    const w = await call(f, 'POST', `/${d.uid}/withdraw`, { expected_revision: stateOf(f, d.uid).revision });
    assert.equal(w.body.request.state, 'withdrawn');
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM network_intro_contact_attempts WHERE request_uid=?').get(d.uid) as any).n, 2);
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM network_intro_events WHERE request_uid=?').get(d.uid) as any).n, before + 1);
    assert.equal(w.body.request.events.at(-1).detail.after_contact, true);
  } finally {
    f.db.close();
  }
});

test('visibility: each projection carries only its own fields, and no one reads another member\'s request', async () => {
  const f = fixture();
  try {
    const me = ROLES.founder;
    await makeReady(f, me);
    const d = await draft(f, me);
    assert.equal(d.private_notes, 'Synthetic private note');
    assert.equal((await call(f, 'GET', `/${d.uid}`, undefined, ROLES.investor)).body.error, 'request_not_found');
    assert.equal((await call(f, 'GET', `/operator/requests/${d.uid}`, undefined, OPERATOR)).body.error, 'request_not_found', 'a draft is the requester\'s own');
    await call(f, 'POST', `/${d.uid}/submit`, { expected_revision: d.revision });
    await call(f, 'POST', `/operator/requests/${d.uid}/assign`, { expected_revision: stateOf(f, d.uid).revision }, OPERATOR);
    await call(f, 'POST', `/operator/requests/${d.uid}/recipient`, { expected_revision: stateOf(f, d.uid).revision, entry_uid: 'p-ada-2' }, OPERATOR);
    const op = (await call(f, 'GET', `/operator/requests/${d.uid}`, undefined, OPERATOR)).body.request;
    assert.equal(op.private_notes, undefined);
    assert.equal(op.shareable_brief, 'Synthetic brief');
    assert.ok(op.events.some((e: any) => e.visibility === 'operator'));
    const mine = (await call(f, 'GET', `/${d.uid}`)).body.request;
    assert.equal(mine.private_notes, 'Synthetic private note');
    assert.ok(!mine.events.some((e: any) => e.type === 'recipient_identified'), 'operator-only events stay with operators');
    assert.equal(mine.contact_attempts, undefined);
    assert.equal(mine.requester_user_id, undefined);
    assert.equal((await call(f, 'GET', '/operator/queue', undefined, me)).status, 403);
    assert.equal((await call(f, 'GET', '', undefined, null)).status, 401);
    assert.equal((await call(f, 'POST', '', { idempotency_key: 'support-key-1', target_entry_uid: 'p-ada' }, me, true)).body.error, 'support_session_read_only');
    assert.equal((await call(f, 'GET', `/${d.uid}`, undefined, me, true)).status, 200, 'support reads');
  } finally {
    f.db.close();
  }
});

test('pagination: true totals and an exact cursor; the operator queue never lists drafts', async () => {
  const f = fixture();
  try {
    const me = ROLES.advisor;
    await makeReady(f, me);
    for (let i = 0; i < 30; i++) f.db.exec(`INSERT INTO network_intro_requests(uid,requester_user_id,idempotency_key,target_entry_uid,created_at) VALUES ('pg-${String(i).padStart(2, '0')}',${me},'page-key-${String(i).padStart(2, '0')}','p-ada','2026-11-20 10:00:00')`);
    const p1 = (await call(f, 'GET', '?limit=25', undefined, me)).body;
    assert.equal(p1.total, 30);
    assert.equal(p1.items.length, 25);
    const p2 = (await call(f, 'GET', `?limit=25&cursor=${p1.next_cursor}`, undefined, me)).body;
    assert.equal(p2.items.length, 5);
    assert.equal(p2.next_cursor, null);
    assert.equal(new Set([...p1.items, ...p2.items].map((x: any) => x.uid)).size, 30, 'no row twice, none skipped');
    assert.equal((await call(f, 'GET', '?state=submitted', undefined, me)).body.total, 0);
    assert.equal((await call(f, 'GET', '?cursor=not-a-cursor', undefined, me)).body.error, 'cursor_invalid');
    assert.equal((await call(f, 'GET', '?limit=1000', undefined, me)).body.error, 'limit_invalid');
    assert.equal((await call(f, 'GET', '/operator/queue', undefined, OPERATOR)).body.total, 0, 'drafts are not queued');
    f.db.exec(`UPDATE network_intro_requests SET state='submitted', next_actor='operator' WHERE uid IN ('pg-00','pg-01')`);
    const q = (await call(f, 'GET', '/operator/queue?next_actor=operator', undefined, OPERATOR)).body;
    assert.equal(q.total, 2);
    assert.equal(q.items[0].private_notes, undefined);
  } finally {
    f.db.close();
  }
});

test('no message leaves the Worker: no outbound request on read, search, save, review or submit', async () => {
  const f = fixture();
  const original = globalThis.fetch;
  let outbound = 0;
  globalThis.fetch = (async () => { outbound++; throw new Error('no outbound call expected'); }) as any;
  try {
    const me = ROLES.founder;
    await makeReady(f, me);
    const d = await draft(f, me);
    await call(f, 'GET', '');
    await call(f, 'GET', `/${d.uid}`);
    await call(f, 'POST', `/${d.uid}/submit`, { expected_revision: d.revision });
    await call(f, 'POST', `/operator/requests/${d.uid}/assign`, { expected_revision: stateOf(f, d.uid).revision }, OPERATOR);
    await call(f, 'POST', `/operator/requests/${d.uid}/move`, { expected_revision: stateOf(f, d.uid).revision, to: 'outreach_ready' }, OPERATOR);
    await call(f, 'POST', `/operator/requests/${d.uid}/contact-attempts`, { expected_revision: stateOf(f, d.uid).revision, idempotency_key: 'manual-contact-1', channel: 'phone' }, OPERATOR);
    assert.equal(outbound, 0);
  } finally {
    globalThis.fetch = original;
    f.db.close();
  }
});

test('notification payloads: a requester never receives an operator-only event, and draft edits are quiet', () => {
  assert.equal(notificationFor({ event_type: 'recipient_identified', visibility: 'operator', request_uid: 'r' }, 'requester'), null);
  assert.ok(notificationFor({ event_type: 'recipient_identified', visibility: 'operator', request_uid: 'r' }, 'operator'));
  assert.equal(notificationFor({ event_type: 'draft_updated', visibility: 'requester', request_uid: 'r' }, 'requester'), null);
  assert.deepEqual(notificationFor({ event_type: 'submitted', visibility: 'requester', request_uid: 'r', to_state: 'submitted' }, 'requester'), {
    audience: 'requester', request_uid: 'r', event_type: 'submitted', state: 'submitted', link: '/api/intro-requests/r',
  });
  assert.deepEqual(Object.keys(NEXT_ACTOR).sort(), [...REQUEST_STATES].sort());
});
