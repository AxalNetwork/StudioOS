/**
 * D9067 (#9067): the operator side of introduction requests is worked by a Super Admin's named operator grant and a
 * Network reviewer entitlement, not by every HQ admin (D7678, D7677 Q3; the owner's answer A of 2026-11-27 on #7673).
 * Synthetic records only, on the real migrated schema.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import router, { mount } from '../src/routes/intro_requests.ts';
import { staffKindsOf } from '../src/services/introductionRequests.ts';

// A synthetic signing seed for locally minted test tokens, joined at run time so no key-shaped literal sits here.
const SECRET = ['intro', 'grants', '9067', 'synthetic', 'seed'].join('-');
// Every account and person here is invented; addresses use the reserved example.test domain.
const MEMBER = 906701, ADMIN = 906702, OPERATOR = 906703, REVIEWER = 906704, SUPER = 906705, BOTH = 906706, NOT_ADMIN = 906707;

function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const people: Array<[number, string, string]> = [
    [MEMBER, 'member', 'founder'], [ADMIN, 'admin', 'admin'], [OPERATOR, 'operator', 'admin'], [REVIEWER, 'reviewer', 'admin'],
    [SUPER, 'super', 'admin'], [BOTH, 'both', 'admin'], [NOT_ADMIN, 'investor', 'investor'],
  ];
  db.exec(`INSERT INTO users(id,email,name,role,is_active) VALUES ${people.map(([id, k, role]) => `(${id},'9067-${k}@example.test','Synthetic ${k}','${role}',1)`).join(',')};
    INSERT INTO super_admins(user_id) VALUES (${SUPER});
    INSERT INTO network_intro_staff_grants(uid,user_id,kind,granted_by,reason) VALUES
      ('g-op',${OPERATOR},'operator',${SUPER},'Synthetic grant'),
      ('g-rev',${REVIEWER},'reviewer',${SUPER},'Synthetic grant'),
      ('g-both-op',${BOTH},'operator',${SUPER},'Synthetic grant'),
      ('g-both-rev',${BOTH},'reviewer',${SUPER},'Synthetic grant');
    INSERT INTO network_directory_sources(uid,name,url) VALUES ('src-9067','Synthetic source','https://directory.example.test');
    INSERT INTO network_directory_entries(uid,kind,source_uid,source_external_id,display_name,publication_status,observed_at) VALUES
      ('p-9067','person','src-9067','r1','Ada Example','published','2026-11-01 00:00:00'),
      ('p-9067-b','person','src-9067','r2','Ben Example','published','2026-11-01 00:00:00');
    PRAGMA foreign_keys=ON;`);
  // A TOTP session with a fresh step-up for the Super Admin and for a plain admin (the write bar's first two facts).
  for (const who of [SUPER, ADMIN])
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))").run(who, `totp-9067-${who}`);
  const app = new Hono().route(mount.path, router);
  app.onError((e, c) => {
    const m = e.message;
    const status = m === 'Unauthorized' ? 401 : /required/i.test(m) ? 403 : 500;
    return c.json({ detail: status === 500 ? 'Unavailable' : m }, status);
  });
  return { db, app, env: { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
type F = ReturnType<typeof fixture>;

async function call(f: F, method: string, path: string, body: any, who: number, opts: { support?: boolean; totp?: boolean } = {}) {
  const claims: Record<string, unknown> = { user_id: who, ...(opts.support ? { impersonated_by: SUPER } : {}), ...(opts.totp ? { jti: `totp-9067-${who}` } : {}) };
  const token = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const r = await f.app.request(`/api/intro-requests${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env);
  return { status: r.status, body: (await r.json()) as any };
}

/** A submitted request from the member, with readiness approved by the reviewer. */
async function submitted(f: F, key = `k-9067-${Math.random()}`) {
  for (const [k, v] of [['professional_profile', { headline: 'Synthetic headline' }], ['capacity', { capacity: 'Synthetic capacity' }]] as const) {
    await call(f, 'PUT', `/readiness/${k}`, { value: v }, MEMBER);
    await call(f, 'POST', `/operator/readiness/${MEMBER}/${k}`, { decision: 'approved' }, REVIEWER);
  }
  const d = (await call(f, 'POST', '', { idempotency_key: key, target_entry_uid: 'p-9067', purpose: 'Synthetic purpose', shareable_brief: 'Synthetic brief', private_notes: 'Synthetic private note 9067' }, MEMBER)).body.request;
  const s = await call(f, 'POST', `/${d.uid}/submit`, { expected_revision: d.revision }, MEMBER);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return d.uid as string;
}
const revision = (f: F, uid: string) => (f.db.prepare('SELECT revision FROM network_intro_requests WHERE uid = ?').get(uid) as any).revision;

/** Every operator write on a request, as [method, path, body]. */
function operatorWrites(f: F, uid: string) {
  return [
    ['POST', `/operator/requests/${uid}/assign`, { expected_revision: revision(f, uid) }],
    ['POST', `/operator/requests/${uid}/move`, { expected_revision: revision(f, uid), to: 'outreach_ready' }],
    ['POST', `/operator/requests/${uid}/recipient`, { expected_revision: revision(f, uid), entry_uid: 'p-9067-b' }],
    ['POST', `/operator/requests/${uid}/contact-attempts`, { expected_revision: revision(f, uid), idempotency_key: 'contact-9067-1', channel: 'email' }],
    ['POST', '/operator/contact-attempts/ica_none/reconcile', { delivery_state: 'delivered' }],
  ] as const;
}
const operatorReads = (uid: string) => ['/operator/queue', `/operator/requests/${uid}`, '/operator/provisional-targets'];

test('the grant table: one grant in force per person and kind, a revoke is whole, and no validity period anywhere', () => {
  const f = fixture();
  try {
    const cols = (f.db.prepare('SELECT name FROM pragma_table_info(?)').all('network_intro_staff_grants') as any[]).map((c) => c.name);
    assert.deepEqual(cols.filter((c) => /valid|expir/.test(c)), [], 'a grant has no validity period');
    assert.throws(() => f.db.exec(`INSERT INTO network_intro_staff_grants(uid,user_id,kind,granted_by,reason) VALUES ('g-dup',${OPERATOR},'operator',${SUPER},'again')`), /UNIQUE/);
    assert.throws(() => f.db.exec(`INSERT INTO network_intro_staff_grants(uid,user_id,kind,granted_by,reason) VALUES ('g-x',${ADMIN},'auditor',${SUPER},'x')`), /CHECK/);
    assert.throws(() => f.db.exec("UPDATE network_intro_staff_grants SET revoked_at = datetime('now') WHERE uid = 'g-op'"), /CHECK/, 'a revoke names who revoked');
    // validity_days stays NULL: the policy owner has set none (D7678).
    assert.deepEqual((f.db.prepare('SELECT validity_days FROM network_intro_policies').all() as any[]).map((r) => r.validity_days), [null]);
  } finally { f.db.close(); }
});

test('an HQ admin without the grant is refused on every operator and reviewer route, and so is a Super Admin', async () => {
  const f = fixture();
  try {
    const uid = await submitted(f);
    for (const who of [ADMIN, SUPER]) {
      for (const p of operatorReads(uid)) assert.equal((await call(f, 'GET', p, undefined, who)).body.error, 'network_staff_required', `${who} GET ${p}`);
      for (const [m, p, b] of operatorWrites(f, uid)) assert.equal((await call(f, m, p, b, who)).body.error, 'operator_grant_required', `${who} ${m} ${p}`);
      assert.equal((await call(f, 'GET', '/operator/readiness', undefined, who)).body.error, 'reviewer_entitlement_required');
      const r = await call(f, 'POST', `/operator/readiness/${MEMBER}/capacity`, { decision: 'approved' }, who);
      assert.deepEqual([r.status, r.body.error], [403, 'reviewer_entitlement_required']);
    }
    assert.equal((await call(f, 'GET', '/operator/queue', undefined, MEMBER)).status, 403, 'a member is not an HQ admin');
    assert.equal(revision(f, uid), revision(f, uid));
    assert.equal((f.db.prepare('SELECT operator_user_id FROM network_intro_requests WHERE uid = ?').get(uid) as any).operator_user_id, null, 'nothing was assigned');
  } finally { f.db.close(); }
});

test('a granted operator works the request, and is not a readiness reviewer', async () => {
  const f = fixture();
  try {
    const uid = await submitted(f);
    for (const p of operatorReads(uid)) assert.equal((await call(f, 'GET', p, undefined, OPERATOR)).status, 200, p);
    assert.equal((await call(f, 'POST', `/operator/requests/${uid}/assign`, { expected_revision: revision(f, uid) }, OPERATOR)).status, 200);
    assert.equal((await call(f, 'POST', `/operator/requests/${uid}/recipient`, { expected_revision: revision(f, uid), entry_uid: 'p-9067-b' }, OPERATOR)).status, 200);
    const moved = await call(f, 'POST', `/operator/requests/${uid}/move`, { expected_revision: revision(f, uid), to: 'outreach_ready' }, OPERATOR);
    assert.equal(moved.body.request.state, 'outreach_ready');
    const contact = await call(f, 'POST', `/operator/requests/${uid}/contact-attempts`, { expected_revision: revision(f, uid), idempotency_key: 'contact-9067-ok', channel: 'phone' }, OPERATOR);
    assert.equal(contact.status, 201, JSON.stringify(contact.body));
    // The operator's projection never carries the requester's private notes (D7678).
    const view = await call(f, 'GET', `/operator/requests/${uid}`, undefined, OPERATOR);
    assert.ok(!JSON.stringify(view.body).includes('Synthetic private note 9067'));
    assert.ok(!('private_notes' in view.body.request));
    // Readiness is the reviewer's: the operator grant does not open it.
    assert.equal((await call(f, 'GET', '/operator/readiness', undefined, OPERATOR)).body.error, 'reviewer_entitlement_required');
    assert.equal((await call(f, 'POST', `/operator/readiness/${MEMBER}/capacity`, { decision: 'rejected' }, OPERATOR)).body.error, 'reviewer_entitlement_required');
  } finally { f.db.close(); }
});

test('a reviewer decides readiness and reads the operator side, but changes no request', async () => {
  const f = fixture();
  try {
    const uid = await submitted(f);
    assert.equal((await call(f, 'GET', '/operator/readiness', undefined, REVIEWER)).status, 200);
    await call(f, 'PUT', '/readiness/capacity', { value: { capacity: 'Changed capacity' } }, MEMBER);
    assert.equal((await call(f, 'POST', `/operator/readiness/${MEMBER}/capacity`, { decision: 'approved' }, REVIEWER)).status, 200);
    for (const p of operatorReads(uid)) assert.equal((await call(f, 'GET', p, undefined, REVIEWER)).status, 200, p);
    const before = JSON.stringify(f.db.prepare('SELECT * FROM network_intro_requests WHERE uid = ?').get(uid));
    for (const [m, p, b] of operatorWrites(f, uid)) {
      const r = await call(f, m, p, b, REVIEWER);
      assert.deepEqual([r.status, r.body.error], [403, 'operator_grant_required'], `${m} ${p}`);
    }
    assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM network_intro_requests WHERE uid = ?').get(uid)), before);
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM network_intro_contact_attempts').get() as any).n, 0);
  } finally { f.db.close(); }
});

test('a support session reads with the grant but never writes', async () => {
  const f = fixture();
  try {
    const uid = await submitted(f);
    for (const p of operatorReads(uid)) assert.equal((await call(f, 'GET', p, undefined, BOTH, { support: true })).status, 200, p);
    assert.equal((await call(f, 'GET', '/operator/readiness', undefined, BOTH, { support: true })).status, 200);
    for (const [m, p, b] of operatorWrites(f, uid)) {
      const r = await call(f, m, p, b, BOTH, { support: true });
      assert.deepEqual([r.status, r.body.error], [403, 'support_session_read_only'], `${m} ${p}`);
    }
    await call(f, 'PUT', '/readiness/capacity', { value: { capacity: 'Changed again' } }, MEMBER);
    const r = await call(f, 'POST', `/operator/readiness/${MEMBER}/capacity`, { decision: 'approved' }, BOTH, { support: true });
    assert.deepEqual([r.status, r.body.error], [403, 'support_session_read_only']);
    // The same person outside a support session may.
    assert.equal((await call(f, 'POST', `/operator/readiness/${MEMBER}/capacity`, { decision: 'approved' }, BOTH)).status, 200);
    assert.equal((await call(f, 'POST', `/operator/requests/${uid}/assign`, { expected_revision: revision(f, uid) }, BOTH)).status, 200);
  } finally { f.db.close(); }
});

test('only a Super Admin past the write bar grants or revokes, and each change leaves an audit receipt', async () => {
  const f = fixture();
  try {
    const audit = () => (f.db.prepare("SELECT admin_user_id, action, viewed_user_id, filters_json FROM admin_audit_log WHERE action LIKE 'network_intro_%' ORDER BY id").all() as any[]).map((r) => ({ ...r, filters_json: JSON.parse(r.filters_json) }));
    const grant = { kind: 'operator', reason: 'Covers the Tuesday queue' };
    // A plain HQ admin, even with a fresh TOTP step-up, cannot grant; a Super Admin without the step-up cannot either.
    assert.equal((await call(f, 'POST', `/operator/grants/${ADMIN}`, grant, ADMIN, { totp: true })).status, 403);
    assert.equal((await call(f, 'POST', `/operator/grants/${ADMIN}`, grant, SUPER)).status, 403);
    assert.equal((await call(f, 'GET', '/operator/grants', undefined, ADMIN)).status, 403);
    assert.deepEqual(audit(), []);
    // Refusals before any write.
    assert.equal((await call(f, 'POST', `/operator/grants/${ADMIN}`, { kind: 'auditor', reason: 'x' }, SUPER, { totp: true })).body.error, 'grant_kind_invalid');
    assert.equal((await call(f, 'POST', `/operator/grants/${ADMIN}`, { kind: 'operator', reason: ' ' }, SUPER, { totp: true })).body.error, 'grant_reason_required');
    assert.equal((await call(f, 'POST', `/operator/grants/${NOT_ADMIN}`, grant, SUPER, { totp: true })).body.error, 'grantee_not_hq_admin');
    assert.deepEqual(audit(), []);
    // The grant: the admin becomes an operator, with a receipt.
    const g = await call(f, 'POST', `/operator/grants/${ADMIN}`, grant, SUPER, { totp: true });
    assert.equal(g.status, 201, JSON.stringify(g.body));
    assert.deepEqual([g.body.grant.kind, g.body.grant.user.id, g.body.grant.granted_by, g.body.grant.reason, g.body.already], ['operator', ADMIN, SUPER, 'Covers the Tuesday queue', false]);
    assert.deepEqual([...(await staffKindsOf(f.env.DB, ADMIN))], ['operator']);
    assert.deepEqual(audit(), [{ admin_user_id: SUPER, action: 'network_intro_grant', viewed_user_id: ADMIN, filters_json: { target_user_id: ADMIN, kind: 'operator', grant_uid: g.body.grant.uid, reason: 'Covers the Tuesday queue' } }]);
    assert.equal((await call(f, 'GET', '/operator/queue', undefined, ADMIN)).status, 200, 'the grant opens the queue');
    // Granting again changes nothing and records nothing.
    const again = await call(f, 'POST', `/operator/grants/${ADMIN}`, grant, SUPER, { totp: true });
    assert.deepEqual([again.status, again.body.already, again.body.grant.uid], [200, true, g.body.grant.uid]);
    assert.equal(audit().length, 1);
    const list = await call(f, 'GET', '/operator/grants', undefined, SUPER);
    assert.ok(list.body.grants.some((x: any) => x.uid === g.body.grant.uid));
    // The revoke: same bar, its own receipt, and the queue closes at once.
    assert.equal((await call(f, 'DELETE', `/operator/grants/${ADMIN}/operator`, { reason: 'Rotation ended' }, ADMIN, { totp: true })).status, 403);
    const rv = await call(f, 'DELETE', `/operator/grants/${ADMIN}/operator`, { reason: 'Rotation ended' }, SUPER, { totp: true });
    assert.equal(rv.status, 200, JSON.stringify(rv.body));
    assert.deepEqual([rv.body.grant.revoked_by, rv.body.already], [SUPER, false]);
    assert.ok(rv.body.grant.revoked_at);
    assert.deepEqual(audit().at(-1), { admin_user_id: SUPER, action: 'network_intro_revoke', viewed_user_id: ADMIN, filters_json: { target_user_id: ADMIN, kind: 'operator', grant_uid: g.body.grant.uid, reason: 'Rotation ended' } });
    assert.equal((await call(f, 'GET', '/operator/queue', undefined, ADMIN)).body.error, 'network_staff_required');
    const twice = await call(f, 'DELETE', `/operator/grants/${ADMIN}/operator`, { reason: 'Rotation ended' }, SUPER, { totp: true });
    assert.deepEqual([twice.status, twice.body.already], [200, true]);
    assert.equal(audit().length, 2);
  } finally { f.db.close(); }
});
