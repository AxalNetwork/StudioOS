/** D6700: real routed sessions, D6699 edits and D1 transactions over a private synthetic SQLite copy. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { openSchema } from './_schema_once.mjs';
import { grantWriteBar } from './_write_bar_session.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import editor from '../src/routes/admin_formation_catalogue.ts';
import reviews from '../src/routes/admin_formation_reviews.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { candidate, publish, submissionPlan, submit } from '../src/services/formationPublish.ts';

const app = new Hono<any>();
app.route('/catalogue', editor);
app.route('/reviews', reviews);
app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
const secret = 'synthetic-formation-review-session-secret-for-local-test';
const publisher = 1, author = 2, gbCounsel = 3, otherCounsel = 4;
const assignments = { GB: gbCounsel, EE: otherCounsel, SG: otherCounsel, US: otherCounsel };
const path = '/reviews/versions/2';
const reason = 'Synthetic test change';

async function fixture(t: TestContext, creator = author) {
  const db = openSchema();
  t.after(() => db.close());
  const env = { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development' } as any;
  const tokens = new Map<string, string>();
  for (const id of [publisher, author, gbCounsel, otherCounsel]) {
    db.prepare('INSERT INTO users (id,email,role,name) VALUES (?,?,?,?)').run(id, `user${id}@example.invalid`, id <= 2 ? 'admin' : 'founder', 'Synthetic');
    const jti = grantWriteBar(db, id);
    for (const bar of [true, false]) {
      tokens.set(`${id}-${bar}`, await new SignJWT({ user_id: id, ...(bar ? { jti } : {}) }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret)));
    }
  }
  db.exec('DELETE FROM super_admins; INSERT INTO super_admins(user_id) VALUES (1); INSERT INTO counsel_members(user_id) VALUES (3),(4)');
  async function call(id: number, method: string, url: string, body?: unknown, bar = true) {
    const res = await app.request(url, { method, headers: { Authorization: `Bearer ${tokens.get(`${id}-${bar}`)}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: res.status, data: await res.json() as any };
  }
  const draft = await call(creator, 'POST', '/catalogue/drafts', { reason });
  assert.equal(draft.status, 201, JSON.stringify(draft.data));
  const plan = async () => (await call(author, 'GET', path)).data;
  async function send(reviewers = assignments, who = author) {
    const { content_sha256 } = await plan();
    return call(who, 'POST', path + '/submit', { reason, content_sha256, reviewers });
  }
  const release = (round: string, who = publisher, bar = true) => call(who, 'POST', path + '/publish', { reason, review_round: round }, bar);
  const admit = (country: string, user_id: number, action = 'grant') => call(publisher, 'POST', '/reviews/admissions', { user_id, country, action, reason });
  const save = (who: number, entity: string, key: object, fields: object) =>
    call(who, 'PUT', '/catalogue/drafts/2/' + entity, { reason, key, fields });
  return { db, env, call, plan, send, release, admit, save };
}

test('fee-only change needs the actual last editor’s second person, fresh TOTP and a reason; concurrent publishers leave one current', async t => {
  const f = await fixture(t, publisher);
  const fee = (who: number, key: string) => f.save(who, 'fees', { form_key: 'uk_ltd', line_key: key },
    { label: 'Synthetic fee', currency: 'GBP', payee: 'Registry', collected_by: 'payee', timing: 'at_formation' });
  const added = await fee(publisher, 'fee_a');
  assert.equal(added.status, 201);
  const unchanged = await f.call(author, 'PUT', '/catalogue/drafts/2/fees', {
    reason, revision: added.data.revision, key: { form_key: 'uk_ltd', line_key: 'fee_a' }, fields: { label: 'Synthetic fee' },
  });
  assert.equal(unchanged.status, 200);
  assert.equal((await f.plan()).last_editor_id, publisher);
  assert.deepEqual((await f.plan()).required_countries, []);
  const submitted = await f.send();
  assert.equal(submitted.status, 201, JSON.stringify(submitted.data));
  const first = submitted.data.review_round;
  assert.equal((await f.release(first)).data.error, 'second_person_required');
  assert.equal((await f.call(author, 'POST', path + '/withdraw', { reason, review_round: first })).status, 200);
  assert.equal((await fee(author, 'fee_b')).status, 201);
  // Creator and submitter are both the publisher, but the last successful editor is a different person.
  const second = (await f.send(assignments, publisher)).data.review_round;
  const checked = (await candidate(f.env, 2))!;
  f.db.prepare('DELETE FROM super_admins WHERE user_id = ?').run(publisher);
  assert.equal(await publish(f.env, checked, second, publisher, reason), false);
  f.db.prepare('INSERT INTO super_admins(user_id) VALUES (?)').run(publisher);
  assert.equal((await f.release(first)).status, 409);
  assert.equal((await f.release(second, author)).status, 403);
  assert.equal((await f.release(second, publisher, false)).status, 403);
  assert.equal((await f.call(publisher, 'POST', path + '/publish', { review_round: second })).data.error, 'reason_required');
  const clone = f.db.prepare("INSERT INTO formation_catalogue_versions (version, draft_base_id) VALUES (?, ?)");
  const base = f.db.prepare('SELECT id FROM formation_catalogue_versions WHERE version = 1').get().id;
  assert.throws(() => clone.run(3, base), /clone conflict/);
  const concurrent = await Promise.all([f.release(second), f.release(second)]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
  assert.throws(() => clone.run(3, base), /clone conflict/);
  const versions = f.db.prepare('SELECT version,status,is_current FROM formation_catalogue_versions ORDER BY version').all();
  assert.deepEqual(versions.map(v => [v.version, v.status, v.is_current]), [[1,'retired',0],[2,'published',1]]);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'formation_catalogue_published'").get().n, 1);
});

test('assigned counsel sees the exact rule set, can decide only once, and needs current admission in every eligible country', async t => {
  const f = await fixture(t);
  const edit = await f.save(author, 'rules', { rule_key: 'example' }, { kind: 'recommend', rule: { then: 'uk_ltd' } });
  assert.equal(edit.status, 201, JSON.stringify(edit.data));
  assert.deepEqual((await f.plan()).required_countries, ['EE','GB','SG','US']);
  const grant = { user_id: gbCounsel, country: 'GB', action: 'grant', reason };
  assert.equal((await f.call(author, 'POST', '/reviews/admissions', grant)).status, 403);
  assert.equal((await f.call(publisher, 'POST', '/reviews/admissions', grant, false)).status, 403);
  assert.equal((await f.call(author, 'GET', '/reviews/assigned')).status, 403);
  for (const [country,id] of Object.entries(assignments)) assert.equal((await f.admit(country,id)).status, 200);
  assert.equal((await f.send({ ...assignments, GB: otherCounsel })).data.error, 'admission_required');
  assert.equal((await f.plan()).status, 'draft');
  const submission = await f.send();
  assert.equal(submission.status, 201, JSON.stringify(submission.data));
  const round = submission.data.review_round;
  assert.equal((await f.release(round)).data.error, 'publication_blocked');
  assert.throws(() => f.db.exec("UPDATE formation_rules SET kind = 'block' WHERE rule_key = 'example'"), /immutable/);
  const queue = await f.call(gbCounsel, 'GET', '/reviews/assigned');
  assert.deepEqual(queue.data.reviews.map(r => r.jurisdiction), ['GB']);
  const review = queue.data.reviews[0];
  const url = `/reviews/assigned/${review.id}`;
  assert.equal((await f.call(otherCounsel, 'GET', url)).status, 404);
  const content = (await f.call(gbCounsel, 'GET', url)).data;
  assert.deepEqual(content.rules.map(r => r.rule_key), ['example']);
  assert.deepEqual(content.forms.map(r => r.form_key), ['uk_ltd']);
  const verdict = { decision: 'approved', content_sha256: review.content_sha256 };
  assert.equal((await f.call(gbCounsel, 'POST', url + '/decision', verdict, false)).status, 403);
  assert.equal((await f.call(otherCounsel, 'POST', url + '/decision', verdict)).status, 409);
  assert.equal((await f.call(gbCounsel, 'POST', url + '/decision', { ...verdict, content_sha256: '0'.repeat(64) })).status, 409);
  assert.equal((await f.call(gbCounsel, 'POST', url + '/decision', verdict)).status, 200);
  assert.equal((await f.call(gbCounsel, 'POST', url + '/decision', verdict)).status, 409);
  assert.throws(() => f.db.prepare('DELETE FROM formation_reviews WHERE id = ?').run(review.id), /cannot be deleted/);
  assert.throws(() => f.db.prepare("UPDATE formation_reviews SET decision = 'not_approved' WHERE id = ?").run(review.id), /immutable/);
  assert.throws(() => f.db.prepare('INSERT OR REPLACE INTO formation_reviews SELECT * FROM formation_reviews WHERE id = ?').run(review.id), /immutable|admitted counsel required/);
  const others = (await f.call(otherCounsel, 'GET', '/reviews/assigned')).data.reviews;
  for (const r of others) assert.equal((await f.call(otherCounsel, 'POST', `/reviews/assigned/${r.id}/decision`, verdict)).status, 200);
  assert.equal((await f.admit('GB',gbCounsel,'revoke')).status, 200);
  assert.equal((await f.release(round)).status, 409);
  assert.equal(f.db.prepare('SELECT version FROM formation_catalogue_versions WHERE is_current = 1').get().version, 1);
  assert.equal((await f.admit('GB',gbCounsel)).status, 200);
  assert.equal((await f.release(round)).status, 200);
});

test('scenario-only changes alter the review hash; an old preview or withdrawn round cannot decide the replacement', async t => {
  const f = await fixture(t);
  const v = (await candidate(f.env, 2))!;
  const oldPlan = (await submissionPlan(f.env, v))!;
  assert.equal((await f.save(author, 'scenarios', { form_key: 'uk_ltd', scenario_key: 'example' }, { route: 'founder_files' })).status, 201);
  const current = await f.plan();
  assert.notEqual(current.review_rules_sha256, oldPlan.review_rules_sha256);
  assert.deepEqual(current.required_countries, ['EE','GB','SG','US']);
  assert.equal(await submit(f.env, v, oldPlan, {}, author, reason), null);
  for (const [country,id] of Object.entries(assignments)) await f.admit(country,id);
  const objectKey = JSON.parse('{"__proto__":{"country":"GB"}}');
  const otherKey = JSON.parse('{"__proto__":{"country":"US"}}');
  assert.equal((await f.save(author, 'rules', { rule_key: 'json_key' }, { kind: 'require', rule: objectKey })).status, 201);
  const withKey = await f.plan();
  f.db.prepare("UPDATE formation_rules SET rule_json = ? WHERE rule_key = 'json_key'").run(JSON.stringify(otherKey));
  const changedKey = await f.plan();
  assert.notEqual(withKey.content_sha256, changedKey.content_sha256);
  assert.notEqual(withKey.review_rules_sha256, changedKey.review_rules_sha256);
  const round = (await f.send()).data.review_round;
  const review = (await f.call(gbCounsel, 'GET', '/reviews/assigned')).data.reviews[0];
  assert.equal((await f.call(author, 'POST', path + '/withdraw', { reason, review_round: round })).status, 200);
  assert.notEqual((await f.send()).data.review_round, round);
  assert.equal((await f.call(gbCounsel, 'POST', `/reviews/assigned/${review.id}/decision`,
    { decision: 'approved', content_sha256: review.content_sha256 })).status, 409);
});

test('D6713 scheduling metadata changes the digest, survives an editor clone and audit failure rolls publication back', async t => {
  const f = await fixture(t);
  // D6699 drafts created before the new base-id column recover their original base from its creation audit.
  f.db.exec('UPDATE formation_catalogue_versions SET draft_base_id = NULL WHERE version = 2');
  const before = await f.plan();
  assert.match(before.content_sha256, /^[0-9a-f]{64}$/);
  f.db.exec(`UPDATE formation_pack_items SET obligation_phase = 'ongoing', source_id = 1, checked_on = '2026-11-01',
    due_rule_json = '{"offset_days":10}', recurrence = 'annual', event_kind = 'annual_report'
    WHERE id = (SELECT MAX(id) FROM formation_pack_items)`);
  const withMetadata = await f.plan();
  assert.notEqual(withMetadata.content_sha256, before.content_sha256);
  assert.deepEqual(withMetadata.required_countries, []);
  const submitted = await f.send();
  const round = submitted.data.review_round;
  f.db.exec(`CREATE TRIGGER fail_publish_audit BEFORE INSERT ON admin_audit_log WHEN NEW.action = 'formation_catalogue_published'
    BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END`);
  assert.equal((await f.release(round)).status, 500);
  assert.equal(f.db.prepare('SELECT version FROM formation_catalogue_versions WHERE is_current = 1').get().version, 1);
  f.db.exec('DROP TRIGGER fail_publish_audit');
  assert.equal((await f.release(round)).status, 200);
  const next = await f.call(author, 'POST', '/catalogue/drafts', { reason });
  assert.equal(next.status, 201);
  assert.equal(next.data.content_sha256, withMetadata.content_sha256);
  const copies = f.db.prepare("SELECT COUNT(*) AS n FROM formation_pack_items WHERE obligation_phase='ongoing' AND checked_on='2026-11-01' AND recurrence='annual' AND source_id=1 AND event_kind='annual_report' AND json_extract(due_rule_json,'$.offset_days')=10").get();
  assert.equal(copies.n, 2);
});
