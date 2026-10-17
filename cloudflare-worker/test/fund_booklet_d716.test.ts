/**
 * D716 (#1781, PR 2) — the Subscription Booklet's store over real SQLite:
 * field ids, who may open, ticks, submit, the audited admin read, and
 * withdraw. The paper's cases (a page per part, the footer, the contents, the
 * X squares) land with the notices PR, which draws #1776's paper. `main`
 * already tests the part order, the stub and the triggers
 * (`legal_notice_kinds_d716.test.ts`).
 *
 * The store is the baseline's tables plus migration 478, read from its file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import booklets from '../src/routes/fund_booklets.ts';
import { bookletFields } from '../src/services/subscriptionBooklet.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const TABLES = ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'lp_applications', 'legal_templates', 'legal_template_versions'];
const SCHEMA = TABLES.map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n')
  + '\n' + readFileSync(new URL('../sql/migrations/478_fund_notices_booklets.sql', import.meta.url), 'utf8');
const SECRET = ['d716', 'booklet', 'fixture', 'secret'].join('-');

const ADMIN = 1, APPLICANT = 2, PENDING = 3, STRANGER = 4, FOUNDER = 5;

const BODIES: Record<string, string> = {
  subscription: '## Article 1 Subscription\nThe applicant subscribes.\n- [ ] I have read the Private Placement Memorandum.\n- [ ] I subscribe for the amount below.',
  lp_investor_questionnaire: '- [ ] I am an accredited investor.\n- [ ] I am a qualified purchaser.',
  lp_aml_kyc_certification: '- [ ] The funds are not the proceeds of crime.',
  lp_tax_status_certification: '- [ ] I am a U.S. person.',
  lp_electronic_delivery_consent: '- [ ] I consent to electronic delivery.',
  gp_closing_certificate: 'The General Partner accepts the subscription.',
};

function fixture() {
  const { DB, db } = makeD1(SCHEMA);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  for (const [id, role, name] of [[ADMIN, 'admin', 'Ada Admin'], [APPLICANT, 'investor', 'Ivy Applicant'], [PENDING, 'investor', 'Pat Pending'],
    [STRANGER, 'investor', 'Sam Stranger'], [FOUNDER, 'founder', 'Fay Founder']] as const) u.run(id, role, name, `user${id}@example.test`);
  db.exec(`INSERT INTO lp_applications (id, user_id, fund_slug, investor_type, status) VALUES
    (21, ${APPLICANT}, 'spinout-fund-i', 'individual', 'approved'),
    (22, ${PENDING}, 'spinout-fund-i', 'individual', 'pending')`);
  const t = db.prepare(`INSERT INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub)
    VALUES (?, ?, 'fund', ?, '[]', 1, 1, 0)`);
  for (const [slug, body] of Object.entries(BODIES)) t.run(slug, slug, body);
  const env = { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  app.route('/api/fund-booklets', booklets);
  async function call(who: number, method: string, path: string, body?: unknown, opts: { envExtra?: Record<string, unknown>; impersonatedBy?: number } = {}) {
    const claims: Record<string, unknown> = { user_id: who, ...(opts.impersonatedBy ? { impersonated_by: opts.impersonatedBy } : {}) };
    const token = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await withThrownResponses(() => app.request(`/api/fund-booklets${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { ...env, ...(opts.envExtra || {}) }));
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  }
  const one = (sql: string, ...a: unknown[]) => ({ ...(db.prepare(sql).get(...a) as any) });
  return { db, call, one };
}

const fillLegend = (f: ReturnType<typeof fixture>) =>
  f.db.prepare("UPDATE legal_templates SET body_md = 'THESE INTERESTS HAVE NOT BEEN REGISTERED.', is_stub = 0 WHERE slug = 'securities_legend'").run();

test('D716 a field id is <slug>:<n>:<hash>, stable for the same text and new when the text changes', async () => {
  const a = await bookletFields('lp_investor_questionnaire', '- [ ] I am accredited.\n- [x] I am a qualified purchaser.\nPlain line.');
  assert.equal(a.length, 2);
  assert.match(a[0].id, /^lp_investor_questionnaire:1:[0-9a-f]{12}$/);
  assert.match(a[1].id, /^lp_investor_questionnaire:2:[0-9a-f]{12}$/);
  const again = await bookletFields('lp_investor_questionnaire', '- [ ] I am accredited.\n- [ ] I am a qualified purchaser.');
  assert.deepEqual(again.map((x) => x.id), a.map((x) => x.id), 'the same words keep their ids');
  const reworded = await bookletFields('lp_investor_questionnaire', '- [ ] I am an accredited investor.\n- [ ] I am a qualified purchaser.');
  assert.notEqual(reworded[0].id, a[0].id, 'a reworded item gets a new id');
  assert.equal(reworded[1].id, a[1].id);
});

test('D716 only an approved applicant opens a booklet; anyone else gets 404', async () => {
  const f = fixture();
  for (const who of [PENDING, STRANGER, FOUNDER]) {
    assert.equal((await f.call(who, 'POST', '/mine')).status, 404, `user ${who} opens`);
    assert.equal((await f.call(who, 'GET', '/mine')).status, 404, `user ${who} reads`);
  }
  assert.equal((await f.call(APPLICANT, 'GET', '/mine')).status, 404, 'no booklet before it is opened');
  const opened = await f.call(APPLICANT, 'POST', '/mine');
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  assert.deepEqual(opened.body.parts.map((p: any) => p.part), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const fields = opened.body.parts.flatMap((p: any) => p.fields);
  assert.equal(fields.length, 7, 'the task items of Parts 3 to 7');
  assert.ok(fields.every((x: any) => x.checked === false));
  assert.deepEqual(opened.body.missing_parts, [1], 'the cover legend is still a stub');
  const reopened = await f.call(APPLICANT, 'POST', '/mine');
  assert.deepEqual([reopened.status, reopened.body.uid], [200, opened.body.uid], 'a second open returns the live booklet');
  assert.equal(f.one('SELECT COUNT(*) AS n FROM fund_subscription_booklets').n, 1);
});

test('D716 the applicant ticks known fields; an unknown field is 400, and a support session cannot answer', async () => {
  const f = fixture();
  const opened = (await f.call(APPLICANT, 'POST', '/mine')).body;
  const ids = opened.parts.flatMap((p: any) => p.fields.map((x: any) => x.id));
  const r = await f.call(APPLICANT, 'PUT', '/mine/answers', { answers: [{ field_id: ids[0], checked: true }, { field_id: ids[2], checked: true }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ticked = r.body.parts.flatMap((p: any) => p.fields).filter((x: any) => x.checked).map((x: any) => x.id);
  assert.deepEqual(ticked.sort(), [ids[0], ids[2]].sort());
  assert.notEqual(r.body.digest, opened.digest, 'the digest covers the ticks');
  const untick = await f.call(APPLICANT, 'PUT', '/mine/answers', { answers: [{ field_id: ids[2], checked: false }] });
  assert.equal(untick.body.parts.flatMap((p: any) => p.fields).filter((x: any) => x.checked).length, 1);
  const bad = await f.call(APPLICANT, 'PUT', '/mine/answers', { answers: [{ field_id: 'subscription:9:000000000000', checked: true }] });
  assert.deepEqual([bad.status, bad.body.error], [400, 'field_unknown']);
  assert.ok(!JSON.stringify(bad.body).includes('subscription:9'), 'the refusal echoes no input');
  assert.equal((await f.call(APPLICANT, 'PUT', '/mine/answers', { answers: 'all' })).body.error, 'answers_invalid');
  const support = await f.call(APPLICANT, 'PUT', '/mine/answers', { answers: [{ field_id: ids[1], checked: true }] }, { impersonatedBy: ADMIN });
  assert.deepEqual([support.status, support.body.error], [403, 'support_session_refused']);
});

test('D716 submit refuses a stub part by name and a stale digest, then freezes; the ticks are then sealed', async () => {
  const f = fixture();
  const opened = (await f.call(APPLICANT, 'POST', '/mine')).body;
  const ids = opened.parts.flatMap((p: any) => p.fields.map((x: any) => x.id));
  const answered = (await f.call(APPLICANT, 'PUT', '/mine/answers', { answers: ids.map((id: string) => ({ field_id: id, checked: true })) })).body;
  const stub = await f.call(APPLICANT, 'POST', '/mine/submit', { digest: answered.digest });
  assert.deepEqual([stub.status, stub.body.error, stub.body.parts], [409, 'booklet_part_missing', [1]]);
  assert.ok(stub.body.message.includes('Part 1'));

  fillLegend(f);
  const stale = await f.call(APPLICANT, 'POST', '/mine/submit', { digest: answered.digest });
  assert.deepEqual([stale.status, stale.body.error], [409, 'content_changed'], 'the legend changed the parts, so the old digest is stale');
  const fresh = (await f.call(APPLICANT, 'GET', '/mine')).body;
  // A body edited after reading changes the digest too.
  f.db.prepare("UPDATE legal_templates SET body_md = body_md || '\nMore.' WHERE slug = 'gp_closing_certificate'").run();
  assert.equal((await f.call(APPLICANT, 'POST', '/mine/submit', { digest: fresh.digest })).body.error, 'content_changed');
  const current = (await f.call(APPLICANT, 'GET', '/mine')).body;
  const done = await f.call(APPLICANT, 'POST', '/mine/submit', { digest: current.digest });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.digest, current.digest);

  const row = f.one('SELECT status, digest, frozen_json, submitted_at FROM fund_subscription_booklets');
  assert.equal(row.status, 'submitted');
  const frozen = JSON.parse(row.frozen_json);
  assert.equal(frozen.parts.length, 9);
  assert.equal(frozen.ticks.length, 7);
  assert.ok(frozen.ticks.every((t: [string, boolean]) => t[1] === true));
  assert.equal((await f.call(APPLICANT, 'PUT', '/mine/answers', { answers: [{ field_id: ids[0], checked: false }] })).body.error, 'booklet_not_open');
  assert.equal((await f.call(APPLICANT, 'POST', '/mine/submit', { digest: current.digest })).body.error, 'booklet_not_open');
  assert.throws(() => f.db.exec("UPDATE fund_booklet_answers SET checked = 0"), /not open/);
  assert.throws(() => f.db.exec("UPDATE fund_subscription_booklets SET digest = '" + 'e'.repeat(64) + "'"), /frozen/);
  // After submit the reader keeps the frozen digest even if a body changes.
  f.db.prepare("UPDATE legal_templates SET body_md = body_md || '\nLater.' WHERE slug = 'gp_closing_certificate'").run();
  assert.equal((await f.call(APPLICANT, 'GET', '/mine')).body.digest, current.digest);
});

test('D716 the admin reads: the list carries no ticks, one booklet\'s read is audited, and only an Admin on HQ reads', async () => {
  const f = fixture();
  const opened = (await f.call(APPLICANT, 'POST', '/mine')).body;
  const ids = opened.parts.flatMap((p: any) => p.fields.map((x: any) => x.id));
  await f.call(APPLICANT, 'PUT', '/mine/answers', { answers: [{ field_id: ids[0], checked: true }] });
  const list = await f.call(ADMIN, 'GET', '');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.booklets.map((b: any) => [b.uid, b.status, b.user_id]), [[opened.uid, 'open', APPLICANT]]);
  assert.ok(!JSON.stringify(list.body).includes(ids[0]) && !JSON.stringify(list.body).includes('checked'), 'no ticks in the list');
  assert.equal(f.one("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'fund_admin.fund_booklet.read'").n, 0);
  const read = await f.call(ADMIN, 'GET', `/${opened.uid}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.parts.flatMap((p: any) => p.fields).find((x: any) => x.id === ids[0]).checked, true);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'fund_admin.fund_booklet.read'").n, 1, 'the read of ticks is audited');
  for (const who of [APPLICANT, FOUNDER]) assert.equal((await f.call(who, 'GET', '')).status, 403, `user ${who}`);
  const branch = await f.call(ADMIN, 'GET', '', undefined, { envExtra: { BRANCH_CODE: 'sg' } });
  assert.deepEqual([branch.status, branch.body.error], [403, 'hq_only']);
  const support = await f.call(ADMIN, 'GET', `/${opened.uid}`, undefined, { impersonatedBy: ADMIN });
  assert.deepEqual([support.status, support.body.code], [403, 'support_session_refused']);
  assert.equal((await f.call(ADMIN, 'GET', '/no-such-uid')).status, 404);
});

test('D716 withdraw needs a reason of 10 to 200 characters, then lets the applicant open a new booklet', async () => {
  const f = fixture();
  const opened = (await f.call(APPLICANT, 'POST', '/mine')).body;
  for (const reason of [undefined, 'short', 'x'.repeat(201)]) {
    const r = await f.call(ADMIN, 'POST', `/${opened.uid}/withdraw`, { reason });
    assert.deepEqual([r.status, r.body.error], [400, 'reason_invalid'], String(reason));
  }
  assert.equal((await f.call(APPLICANT, 'POST', `/${opened.uid}/withdraw`, { reason: 'The applicant asked to restart.' })).status, 403);
  const done = await f.call(ADMIN, 'POST', `/${opened.uid}/withdraw`, { reason: 'The applicant asked to restart.' });
  assert.deepEqual([done.status, done.body.status], [200, 'withdrawn']);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'fund_admin.fund_booklet.withdraw'").n, 1);
  assert.equal((await f.call(ADMIN, 'POST', `/${opened.uid}/withdraw`, { reason: 'The applicant asked to restart.' })).body.error, 'booklet_withdrawn');
  assert.equal((await f.call(APPLICANT, 'GET', '/mine')).status, 404, 'the withdrawn booklet is no longer theirs to read');
  const again = await f.call(APPLICANT, 'POST', '/mine');
  assert.equal(again.status, 201);
  assert.notEqual(again.body.uid, opened.uid);
  assert.throws(() => f.db.exec('DELETE FROM fund_subscription_booklets'), /never deleted/);
});
