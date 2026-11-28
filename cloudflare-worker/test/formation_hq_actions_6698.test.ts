/** D6698 (#6698) — exercise HQ writes through the mounted router and the common Approvals assignment path.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): `formation_hq_actions_6698.test.ts`
 * exercises HQ authorization, evidence gates, atomic conflict refusal, case ownership, audit
 * attribution and the Formation Approvals lane against the migrated schema.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cases from '../src/routes/admin_formation_cases.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { HQ_ACTIONS } from '../src/services/formationHqActions.ts';
import { hqLanes, HQ_APPROVAL_SOURCES } from '../src/services/hqApprovalSources.ts';
import { assignFromBody } from '../src/services/approvalAssignments.ts';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { formationScreeningFixture } from './_formation_screening_fixture.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { grantWriteBar } from './_write_bar_session.mjs';

const SECRET = 'fixture-only-formation-case-action-key-6698';
const admin = 1, other = 2, founder = 10;
const app = new Hono<any>();
app.route('/cases', cases);
app.onError((e, c) => c.json({ error: e.message }, (AUTH_ERROR_STATUSES[e.message] || 500) as any));
const proxy = { filing_uid: 'filing', recorded_for_partner_id: 7, reason: 'Verified the partner record.' };
const acceptance = { registry_date: '2026-10-04', registration_number: 'EX-001', certificate_document_id: 52 };
const ref = { event: 'submitted', submitted_on: '2026-10-01', ...proxy };

function fixture(legacy = false) {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const user = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  user.run(admin, 'admin', 'Owner', 'owner@example.test', null);
  user.run(other, 'admin', 'Reviewer', 'reviewer@example.test', null);
  user.run(founder, 'founder', 'Founder', 'founder@example.test', 100);
  db.exec(`DELETE FROM super_admins;
    INSERT INTO projects (id, name, founder_id) VALUES (1, 'Example venture', 100);
    INSERT INTO documents (id, project_id, title, doc_type, status) VALUES (51, 1, 'Pack', 'other', 'generated'), (52, 1, 'Certificate', 'other', 'generated'), (53, NULL, 'Unrelated', 'other', 'generated');`);
  db.prepare(`INSERT INTO formation_cases (id, uid, user_id, intent, project_id, track, stage, waiting_on, hq_owner_user_id, partner_id)
    VALUES (1, 'fc', ?, 'convert_project', 1, ?, ?, 'hq', ?, 7)`).run(founder, legacy ? 'legacy_v1' : 'v2', legacy ? 'registered' : 'ready_to_file', admin);
  db.prepare(`INSERT INTO incorporations (id, user_id, project_id, jurisdiction_id, company_name, registered_agent_name, registered_agent_address,
    amount_cents, status, paid_at, stripe_payment_intent, filed_on) VALUES (1, ?, 1, 'us_de_ccorp', 'Example', 'Agent', '1 Example Way', 500, ?, '2026-09-10', 'pi_fixture', ?)`)
    .run(founder, legacy ? 'filed' : 'packet_ready', legacy ? '2026-10-01' : null);
  db.exec('INSERT INTO formation_case_orders (case_id, incorporation_id) VALUES (1, 1)');
  if (!legacy) db.prepare(`INSERT INTO formation_filings (id, uid, case_id, kind, state, pack_document_id, pack_sha256)
    VALUES (1, 'filing', 1, 'incorporation', 'prepared', 51, ?)`).run('a'.repeat(64));
  const jti = grantWriteBar(db, admin);
  const env = { TOKENS: formationScreeningFixture(db, 1), DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const one = (sql: string, ...args: any[]) => ({ ...db.prepare(sql).get(...args) }) as any;
  async function post(action: string, body: any, who: number | null = admin, target = env, strong = true) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (who != null) {
      const claims = who === admin && strong ? { user_id: who, jti } : { user_id: who };
      headers.Authorization = 'Bearer ' + await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    }
    const res = await app.request('/cases/fc/' + action, { method: 'POST', headers, body: JSON.stringify(body) }, target);
    return { status: res.status, body: await res.json() as any };
  }
  const approve = () => db.exec("UPDATE formation_filings SET founder_approved_at = datetime('now'), founder_approved_sha256 = pack_sha256 WHERE id = 1");
  const audit = (action: string, actor = admin) => {
    const name = 'formation_hq_' + action.replaceAll('-', '_');
    assert.equal(one('SELECT COUNT(*) n FROM admin_audit_log WHERE action = ? AND admin_user_id = ?', name, actor).n, 1, action);
    assert.equal(one('SELECT COUNT(*) n FROM activity_logs WHERE action = ? AND user_id = ?', name, actor).n, 1, action);
  };
  return { db, env, one, post, audit, approve };
}
const ok = async (p: Promise<{ status: number; body: any }>) => { const r = await p; assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const refused = async (p: Promise<{ status: number; body: any }>, status: number, code?: string) => {
  const r = await p; assert.equal(r.status, status, JSON.stringify(r.body)); if (code) assert.equal(r.body.error ?? r.body.code, code);
};

test('all actions require HQ admin; case evidence is assigned-owner only and confirmation needs a recent strong factor', async () => {
  const { env, post } = fixture();
  for (const action of HQ_ACTIONS) {
    await refused(post(action, {}, founder), 403);
    await refused(post(action, {}, null), 401);
    await refused(post(action, {}, admin, { ...env, BRANCH_CODE: 'test' }), 403);
  }
  await refused(post('notes', { text: 'private' }, other), 403, 'case_owner_required');
  await refused(post('confirm-registration', proxy, admin, env, false), 403);
});

test('HQ owner, request, note, hold, release and cancellation record actor and visibility with both audits', async () => {
  const { db, one, post, audit } = fixture();
  db.exec('UPDATE formation_cases SET hq_owner_user_id = NULL');
  await refused(post('assign', { owner_user_id: founder }), 400);
  await ok(post('assign', { owner_user_id: admin }));
  assert.equal(one("SELECT assignee_user_id FROM approval_assignments WHERE lane = 'formation_cases'").assignee_user_id, admin);
  await refused(post('requests', { asked_of: 'partner', asked_of_user_id: other, kind: 'answer', title: 'Private case data' }), 400, 'asked_of_user_invalid');
  await ok(post('requests', { asked_of: 'founder', kind: 'answer', title: 'Confirm name', recorded_for_partner_id: 7, reason: 'HQ only proxy rationale' }));
  assert.doesNotMatch(one("SELECT detail_json FROM formation_case_events WHERE kind='request_opened'").detail_json, /HQ only proxy rationale/);
  await ok(post('notes', { text: 'Private note', visibility: 'hq_only', recorded_for_partner_id: 7, reason: 'Partner clarification' }));
  await ok(post('hold', { waiting_on: 'counsel', reason: 'Counsel reviewing' }));
  assert.equal(one('SELECT waiting_on FROM formation_cases').waiting_on, 'counsel');
  await ok(post('release', {}));
  assert.equal(one('SELECT waiting_on FROM formation_cases').waiting_on, 'founder');
  await ok(post('cancel', { reason: 'Founder withdrew' }));
  assert.equal(one('SELECT close_reason FROM formation_cases').close_reason, 'cancelled');
  for (const action of ['assign','requests','notes','hold','release','cancel']) audit(action);
  for (const kind of ['hq_owner_assigned','request_opened','note','case_held','case_released','case_cancelled']) {
    const event = one('SELECT actor_user_id, detail_json, visibility FROM formation_case_events WHERE kind = ?', kind);
    assert.equal(event.actor_user_id, admin, kind);
    assert.equal(event.visibility, kind === 'request_opened' ? 'all' : 'hq_only', kind);
    assert.equal(JSON.parse(event.detail_json).partner_id, 7, kind);
  }
  assert.equal(JSON.parse(one("SELECT detail_json FROM formation_case_events WHERE kind='note'").detail_json).recorded_for_partner_id, 7);
  await refused(post('notes', { text: 'Closed' }), 409, 'case_closed');
});

test('a manual release cannot clear intake screening holds', async () => {
  const { db, post, one } = fixture();
  await ok(post('hold', { waiting_on: 'hq', reason: 'Manual review' }));
  db.exec("UPDATE formation_cases SET hold_reason = 'restricted_place'");
  await refused(post('release', {}), 409, 'hold_requires_review');
  assert.equal(one('SELECT hold_reason FROM formation_cases').hold_reason, 'restricted_place');
});

test('on-behalf submit and accept enforce partner, reason, founder approval and every registry fact before confirmation', async () => {
  const { one, post, audit, approve } = fixture();
  await refused(post('filing-events', { ...ref, reason: ' ' }), 400, 'reason_required');
  await refused(post('filing-events', { ...ref, recorded_for_partner_id: 8 }), 409, 'partner_not_assigned');
  await refused(post('filing-events', ref), 409, 'founder_approval_required');
  approve();
  await ok(post('filing-events', ref));
  for (const field of ['registry_date', 'registration_number', 'certificate_document_id']) {
    const b: any = { ...proxy, event: 'accepted', ...acceptance };
    delete b[field]; await refused(post('filing-events', b), 400);
  }
  await refused(post('filing-events', { ...proxy, event: 'accepted', ...acceptance, certificate_document_id: 53 }), 400, 'document_not_on_case');
  await ok(post('filing-events', { ...proxy, event: 'accepted', ...acceptance }));
  assert.deepEqual(one('SELECT stage, waiting_on FROM formation_cases'), { stage: 'submitted', waiting_on: 'hq' });
  assert.equal(one('SELECT state FROM formation_filings').state, 'accepted');
  assert.equal(one('SELECT COUNT(*) n FROM company_profiles').n, 0);
  await ok(post('confirm-registration', proxy));
  assert.equal(one('SELECT stage FROM formation_cases').stage, 'registered');
  assert.equal(one('SELECT filed_on FROM incorporations').filed_on, acceptance.registry_date);
  assert.equal(one('SELECT registration_number FROM company_profiles').registration_number, acceptance.registration_number);
  for (const kind of ['registration_confirmed','partner_filing_event','stage_change']) {
    const event = one('SELECT actor_user_id, detail_json FROM formation_case_events WHERE kind = ?', kind);
    assert.equal(event.actor_user_id, admin); assert.equal(JSON.parse(event.detail_json).recorded_for_partner_id, 7);
  }
  const logs = one("SELECT COUNT(*) n FROM admin_audit_log WHERE action='formation_hq_filing_events' AND json_extract(filters_json,'$.recorded_for_partner_id')=7 AND json_extract(filters_json,'$.reason') = ?", proxy.reason);
  assert.equal(logs.n, 2);
  audit('confirm-registration');
  await refused(post('confirm-registration', proxy), 409);
});

test('a competing stage change between read and batch returns 409 with no filing, event, evidence or audit writes', async () => {
  const { db, env, one, post, approve } = fixture();
  approve();
  let raced = false;
  const target = { ...env, DB: { prepare: (sql: string) => env.DB.prepare(sql), batch(stmts: any[]) {
    if (!raced) { raced = true; db.exec("UPDATE formation_cases SET stage = 'preparing', revision = revision + 1"); }
    return env.DB.batch(stmts);
  } } };
  await refused(post('filing-events', { ...ref, evidence_document_id: 52 }, admin, target), 409, 'case_moved');
  assert.equal(raced, true);
  assert.equal(one('SELECT state FROM formation_filings').state, 'prepared');
  for (const table of ['formation_case_events','formation_filing_events','formation_case_documents','admin_audit_log']) {
    assert.equal(one('SELECT COUNT(*) n FROM ' + table).n, 0, table);
  }
  assert.equal(one('SELECT status FROM incorporations').status, 'packet_ready');
});

test('a stage change also refuses an HQ hold without overwriting the winning wait', async () => {
  const { env, db, one, post } = fixture();
  const target = { ...env, DB: { prepare: (sql: string) => env.DB.prepare(sql), batch(stmts: any[]) {
    db.exec("UPDATE formation_cases SET revision = revision + 1, stage = 'submitted', waiting_on = 'registry'");
    return env.DB.batch(stmts);
  } } };
  await refused(post('hold', { reason: 'Awaiting counsel', waiting_on: 'counsel' }, admin, target), 409, 'case_moved');
  assert.deepEqual(one('SELECT hold_reason, waiting_on FROM formation_cases'), { hold_reason: null, waiting_on: 'registry' });
  assert.equal(one('SELECT COUNT(*) n FROM formation_case_events').n, 0);
  assert.equal(one('SELECT COUNT(*) n FROM admin_audit_log').n, 0);
});

test('a committed submission returns its own result if the following registry query has already been recorded', async () => {
  const { env, one, post, approve } = fixture();
  approve();
  let advanced = false;
  const target = { ...env, DB: { prepare: (sql: string) => env.DB.prepare(sql), async batch(stmts: any[]) {
    const results = await env.DB.batch(stmts);
    if (!advanced && one('SELECT state FROM formation_filings').state === 'submitted') {
      advanced = true;
      await ok(post('filing-events', { ...proxy, event: 'queried', occurred_on: '2026-10-02' }));
    }
    return results;
  } } };
  const submitted = await ok(post('filing-events', ref, admin, target));
  assert.equal(advanced, true); assert.equal(submitted.state, 'submitted');
  assert.equal(one('SELECT state FROM formation_filings').state, 'queried');
  assert.equal(one("SELECT COUNT(*) n FROM activity_logs WHERE action='formation_hq_filing_events'").n, 2);
  await ok(post('filing-events', { ...proxy, event: 'answered', occurred_on: '2026-10-03' }));
  await ok(post('filing-events', { ...proxy, event: 'withdrawn' }));
  assert.equal(one('SELECT state FROM formation_filings').state, 'withdrawn');
});

test('failed audit storage rolls back the case action and receipt', async () => {
  const { db, one, post } = fixture();
  db.exec("CREATE TRIGGER fixture_audit_unavailable BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(ABORT, 'fixture audit unavailable'); END");
  await refused(post('hold', { waiting_on: 'counsel', reason: 'Fixture hold' }), 500);
  assert.deepEqual(one('SELECT hold_reason, waiting_on FROM formation_cases'), { hold_reason: null, waiting_on: 'hq' });
  assert.equal(one('SELECT COUNT(*) n FROM formation_case_events').n, 0);
});

test('a declined filing can be handed to the existing refund review once, and legacy correction keeps the original filing date', async () => {
  const { post, one, audit, approve } = fixture();
  const body = { reason: 'Registry rejected the application.' };
  await refused(post('refund-review', body), 409, 'registry_rejection_required');
  approve(); await ok(post('filing-events', ref));
  await ok(post('filing-events', { ...proxy, event: 'rejected', registry_date: '2026-10-03', rejection_reason: 'Name unavailable' }));
  const result = await ok(post('refund-review', body));
  assert.deepEqual(result.review, { path: '/api/admin/billing/refund/review', payment_intent: 'pi_fixture' });
  assert.equal(one("SELECT visibility FROM formation_case_events WHERE kind='refund_review_requested'").visibility, 'hq_only');
  await refused(post('refund-review', body), 409, 'refund_review_already_requested');
  audit('refund-review');
  const legacy = fixture(true);
  await ok(legacy.post('legacy-correction', { ...acceptance, reason: 'Registry certificate supplied later.' }));
  assert.equal(legacy.one('SELECT filed_on FROM incorporations').filed_on, '2026-10-01');
  assert.equal(legacy.one('SELECT recorded_after_the_fact FROM formation_filings').recorded_after_the_fact, 1);
  assert.equal(legacy.one("SELECT actor_user_id FROM formation_case_events WHERE kind='legacy_registration_corrected'").actor_user_id, admin);
  legacy.audit('legacy-correction');
});

test('the HQ glance matches the open HQ wait and inbox assignment updates the case owner and its timeline', async () => {
  const { db, env, one } = fixture();
  db.exec("UPDATE formation_cases SET stage_entered_at='2026-01-01', waiting_on='founder'");
  const lane = async () => (await hqLanes(env)).lanes.find(l => l.key === 'formation_cases')!;
  assert.equal((await lane()).count, 0);
  db.exec("UPDATE formation_cases SET waiting_on='hq'");
  const current = await lane();
  assert.equal(current.count, 1);
  assert.equal(current.oldest_age_hours, 0, 'the HQ wait began just now during an older stage');
  const r = await assignFromBody(env, { id: admin }, { assignee_user_id: other, items: [{ lane: 'formation_cases', item_id: 1 }] }, { sources: HQ_APPROVAL_SOURCES });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(one('SELECT hq_owner_user_id FROM formation_cases').hq_owner_user_id, other);
  assert.equal(one("SELECT actor_user_id FROM formation_case_events WHERE kind='hq_owner_assigned'").actor_user_id, admin);
  db.exec("UPDATE formation_cases SET closed_at = datetime('now')");
  assert.equal((await lane()).count, 0);
});
