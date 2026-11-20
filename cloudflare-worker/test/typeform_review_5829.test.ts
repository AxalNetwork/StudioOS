/** D5829: synthetic survey review on the actual migrated schema; no provider or Slack calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { setTypeformMappings, syncTypeformForm, withdrawTypeformAnswer, withdrawTypeformResponse } from '../src/services/typeform/importer.ts';
import { mapTypeformEvidence, prepareTypeformReviews, decideTypeformReview, typeformReviews } from '../src/services/typeform/review.ts';
import { evidenceFor } from '../src/services/validateEvidence.ts';
import { mappingSignature } from '../src/services/typeform/signature.ts';
import router from '../src/routes/typeform_validate.ts';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const scope = { projectId: 41, integrationId: 501, userId: 7 };
const other = { projectId: 42, integrationId: 502, userId: 8 };
const fields = [{ id: 'question', type: 'long_text', title: 'Synthetic question', choices: [] }];
const JWT_SECRET = 'synthetic-typeform-5829-test-secret';

async function world() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS); loadSchema(db);
  db.exec(`INSERT INTO users (id, email, name, role, is_active) VALUES
    (7, 'synthetic7@example.invalid', 'Synthetic admin', 'admin', 1), (8, 'synthetic8@example.invalid', 'Synthetic member', 'exploring', 1);
    INSERT INTO projects (id, name, company_id) VALUES (41, 'Synthetic venture', 41), (42, 'Synthetic other venture', 42);
    INSERT INTO integrations (id, uid, user_id, provider_key, auth_type, status, config_json) VALUES
      (501, 'typeform-5829-a', 7, 'typeform', 'oauth2', 'active', '{"region":"us"}'),
      (502, 'typeform-5829-b', 8, 'typeform', 'oauth2', 'active', '{"region":"us"}');
    INSERT INTO typeform_form_syncs (id, integration_id, project_id, form_id) VALUES (1, 501, 41, 'FormTest'), (2, 502, 42, 'OtherForm');
    INSERT INTO hypotheses (id, project_id, code, claim) VALUES (101, 41, 'H1', 'Synthetic claim'), (102, 42, 'H2', 'Other claim');
    INSERT INTO hypothesis_experiments (id, uid, project_id, hypothesis_id, title) VALUES (201, 'ex-a', 41, 101, 'Synthetic experiment'), (202, 'ex-b', 42, 102, 'Other experiment');`);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  await setTypeformMappings(env, 1, fields, [{ field_id: 'question', kind: 'need_to_have', keep_text: true }], new Date(NOW).toISOString());
  const mappingId = Number(db.prepare('SELECT id FROM typeform_field_mappings WHERE sync_id = 1').get()!.id);
  let items: any[] = [1, 2].map(n => ({ response_id: `response${n}`, token: `response${n}`, response_type: 'completed', submitted_at: new Date(NOW).toISOString(),
    answers: [{ field: { id: 'question', type: 'long_text' }, type: 'text', text: `PRIVATE SYNTHETIC ANSWER ${n}` }] }));
  const deps = { now: () => NOW, runId: 'synthetic-run', accessToken: async () => 'not-a-real-token',
    fetch: async (url: string) => Response.json(url.includes('/responses') ? { items } : { fields }) };
  const sync = () => syncTypeformForm(env, deps, { ...scope, formId: 'FormTest' });
  await sync();
  const map = (extra: any = {}) => mapTypeformEvidence(env, scope, { field_mapping_id: mappingId, hypothesis_id: 101, ...extra });
  const prepare = async () => { await map(); return prepareTypeformReviews(env, scope); };
  const one = (table: string) => db.prepare(`SELECT * FROM ${table} ORDER BY id LIMIT 1`).get() as any;
  const count = (table: string) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
  return { db, env, mappingId, sync, map, prepare, one, count, scope, items };
}

test('mapping versions preserve stable rule identity, same-venture targets and an optional experiment', async () => {
  const w = await world();
  const first: any = await w.map({ experiment_id: 201, direction: 'contradicts', strength: 'pattern' });
  const again: any = await w.map({ experiment_id: 201, direction: 'contradicts', strength: 'pattern' });
  const next: any = await w.map({ direction: 'supports' });
  assert.deepEqual([first.version, again.id === first.id, next.version], [1, true, 2]);
  await assert.rejects(w.map({ hypothesis_id: 102 }), /not on this venture/);
  await assert.rejects(w.map({ experiment_id: 202 }), /not on this venture/);
});

test('completed responses, matching answers and confirmed signals stay distinct; proposals remain to_confirm', async () => {
  const w = await world(); await w.prepare();
  w.db.exec(`INSERT INTO typeform_field_mappings (sync_id, field_id, field_type, kind, rule_json) VALUES (1, 'secondQuestion', 'yes_no', 'waitlist', '{"equals":true}');
    INSERT INTO typeform_answers (response_row_id, mapping_id, field_id, created_at)
      SELECT MIN(r.id), m.id, 'secondQuestion', '2026-11-19T12:00:00Z' FROM typeform_responses r CROSS JOIN typeform_field_mappings m WHERE m.field_id = 'secondQuestion';`);
  const read: any = await typeformReviews(w.env, scope);
  assert.deepEqual([{ ...read.counts }, w.one('demand_signals').status, w.count('hypothesis_evidence_links'), w.count('discovery_interviews')],
    [{ completed: 2, matching_answers: 3, confirmed_signals: 0 }, 'to_confirm', 0, 0]);
});

test('confirm explicitly links the shared evidence contract once with direction, strength and observed date', async () => {
  const w = await world(); await w.map({ direction: 'contradicts', strength: 'measured', experiment_id: 201 }); await prepareTypeformReviews(w.env, scope);
  const id = w.one('typeform_reviews').id;
  await Promise.all([decideTypeformReview(w.env, scope, id, 'confirm'), decideTypeformReview(w.env, scope, id, 'confirm')]);
  await decideTypeformReview(w.env, scope, id, 'confirm');
  const evidence = await evidenceFor({ env: w.env, projectId: 41 });
  const read: any = await typeformReviews(w.env, scope);
  assert.deepEqual([w.count('hypothesis_evidence_links'), evidence.map(e => [e.kind, e.direction, e.strength, e.date]), w.one('demand_signals').source_kind, read.counts.confirmed_signals],
    [1, [['signal', 'contradicts', 'measured', '2026-11-19']], 'typeform', 1]);
});

test('dismiss and unlink are repeatable tombstones and neither import nor prepare recreates evidence', async () => {
  const w = await world(); await w.prepare(); const id = w.one('typeform_reviews').id;
  await decideTypeformReview(w.env, scope, id, 'confirm');
  await decideTypeformReview(w.env, scope, id, 'unlink'); await decideTypeformReview(w.env, scope, id, 'unlink');
  const second = Number(w.db.prepare('SELECT id FROM typeform_reviews WHERE id <> ?').get(id)!.id);
  await decideTypeformReview(w.env, scope, second, 'dismiss'); await decideTypeformReview(w.env, scope, second, 'dismiss');
  await w.sync(); await prepareTypeformReviews(w.env, scope);
  assert.deepEqual([w.count('demand_signals'), w.count('hypothesis_evidence_links'), w.count('typeform_reviews')], [0, 0, 2]);
  await assert.rejects(decideTypeformReview(w.env, scope, id, 'confirm'), /already been removed/);
});

test('answer and response withdrawal retract confirmed links atomically and remove private text', async () => {
  const w = await world(); await w.prepare(); const r = w.one('typeform_reviews');
  await decideTypeformReview(w.env, scope, r.id, 'confirm');
  await withdrawTypeformAnswer(w.env, scope, r.answer_id);
  await withdrawTypeformResponse(w.env, scope, 'FormTest', 'response2'); await w.sync(); await prepareTypeformReviews(w.env, scope);
  assert.deepEqual([w.count('demand_signals'), w.count('hypothesis_evidence_links'), w.count('typeform_answers'), w.one('typeform_reviews').status], [0, 0, 0, 'withdrawn']);
});

test('removing a question mapping retracts its derived material; an orphan cannot confirm', async () => {
  const w = await world(); await w.prepare(); const r = w.one('typeform_reviews'); await decideTypeformReview(w.env, scope, r.id, 'confirm');
  await setTypeformMappings(w.env, 1, fields, [], new Date(NOW).toISOString());
  assert.deepEqual([w.count('demand_signals'), w.count('hypothesis_evidence_links'), w.count('typeform_answers')], [0, 0, 0]);
  await assert.rejects(decideTypeformReview(w.env, scope, r.id, 'confirm'), /already been removed/);
});

test('editing a qualifying rule invalidates existing answers without silently remapping them', async () => {
  const w = await world(); await w.prepare();
  await setTypeformMappings(w.env, 1, fields, [{ field_id: 'question', kind: 'would_pay', keep_text: false }], new Date(NOW).toISOString());
  await w.sync();
  assert.deepEqual([w.count('typeform_answers'), w.count('demand_signals'), w.one('typeform_reviews').status], [0, 0, 'withdrawn']);
});

test('superseding a review mapping refuses old pending confirmation and preserves the prior version', async () => {
  const w = await world(); await w.prepare(); await w.map({ direction: 'contradicts' });
  await assert.rejects(decideTypeformReview(w.env, scope, w.one('typeform_reviews').id, 'confirm'), /no longer reviewable/);
  assert.deepEqual([w.one('typeform_reviews').mapping_version, w.one('demand_signals').status, w.count('hypothesis_evidence_links')], [1, 'to_confirm', 0]);
});

test('a removed experiment target remains an orphan and cannot confirm a survey', async () => {
  const w = await world(); await w.map({ experiment_id: 201 }); await prepareTypeformReviews(w.env, scope);
  w.db.exec('DELETE FROM hypothesis_experiments WHERE id = 201');
  await assert.rejects(decideTypeformReview(w.env, scope, w.one('typeform_reviews').id, 'confirm'), /not on this venture/);
});

test('partial proposal writes recover the same signal and a failed confirmation batch rolls back', async () => {
  const w = await world(); await w.map();
  w.db.exec("CREATE TRIGGER fail_review BEFORE INSERT ON typeform_reviews BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END;");
  await assert.rejects(prepareTypeformReviews(w.env, scope), /fixture write failure/);
  w.db.exec('DROP TRIGGER fail_review'); await prepareTypeformReviews(w.env, scope);
  w.db.exec("CREATE TRIGGER fail_evidence BEFORE INSERT ON hypothesis_evidence_links BEGIN SELECT RAISE(ABORT, 'fixture evidence failure'); END;");
  await assert.rejects(decideTypeformReview(w.env, scope, w.one('typeform_reviews').id, 'confirm'), /fixture evidence failure/);
  assert.deepEqual([w.count('demand_signals'), w.one('demand_signals').status, w.one('typeform_reviews').status, w.count('hypothesis_evidence_links')], [2, 'to_confirm', 'pending', 0]);
  w.db.exec('DROP TRIGGER fail_evidence'); await decideTypeformReview(w.env, scope, w.one('typeform_reviews').id, 'confirm');
  assert.equal(w.count('hypothesis_evidence_links'), 1);
});

test('a stale confirmation cannot cross a concurrent source withdrawal', async () => {
  const w = await world(); await w.prepare(); const r = w.one('typeform_reviews'); const batch = w.env.DB.batch.bind(w.env.DB);
  w.env.DB.batch = async (stmts: any[]) => { w.env.DB.batch = batch; await withdrawTypeformAnswer(w.env, scope, r.answer_id); return batch(stmts); };
  await assert.rejects(decideTypeformReview(w.env, scope, r.id, 'confirm'), /no longer reviewable/);
  assert.deepEqual([w.count('hypothesis_evidence_links'), w.count('demand_signals')], [0, 1]);
});

test('shared evidence requires both a confirmed review and confirmed signal; quotes stay private', async () => {
  const w = await world(); await w.prepare(); const r = w.one('typeform_reviews');
  w.db.prepare("INSERT INTO hypothesis_evidence_links (uid, project_id, hypothesis_id, kind, ref_id, direction) VALUES ('unreviewed', 41, 101, 'signal', ?, 'supports')").run(`signal-${r.signal_id}`);
  assert.equal((await evidenceFor({ env: w.env, projectId: 41 })).length, 0);
  w.db.prepare("UPDATE demand_signals SET status = 'confirmed' WHERE id = ?").run(r.signal_id);
  assert.equal((await evidenceFor({ env: w.env, projectId: 41 })).length, 0);
  await decideTypeformReview(w.env, scope, r.id, 'confirm');
  w.db.prepare("UPDATE demand_signals SET status = 'to_confirm' WHERE id = ?").run(r.signal_id);
  assert.equal((await evidenceFor({ env: w.env, projectId: 41 })).length, 0);
  const read: any = await typeformReviews(w.env, scope);
  assert.deepEqual([read.quote_audience, read.publication_permission, w.one('demand_signals').note, w.one('demand_signals').who], ['private', 'not_recorded', null, null]);
});

test('two ventures have isolated review reads and decisions', async () => {
  const w = await world(); await w.prepare();
  assert.deepEqual((await typeformReviews(w.env, other)).rows, []);
  await assert.rejects(decideTypeformReview(w.env, other, w.one('typeform_reviews').id, 'confirm'), /not on this venture/);
});

test('legacy unsigned answers and changed rule signatures are never retroactively attested', async () => {
  const w = await world(); await w.map(); w.db.exec("UPDATE typeform_answers SET mapping_signature = NULL");
  await prepareTypeformReviews(w.env, scope);
  assert.equal(w.count('typeform_reviews'), 0);
  assert.equal(mappingSignature({ field_id: 'x', field_type: 'multiple_choice', kind: 'waitlist', keep_text: 0, rule_json: '{"choices":["b","a"]}' }),
    mappingSignature({ field_id: 'x', field_type: 'multiple_choice', kind: 'waitlist', keep_text: 0, rule_json: '{"choices":["a","b"]}' }));
});

test('router refuses another member, a support session and an unenabled connection before reading private answers', async () => {
  const w = await world(); await w.prepare(); const app = new Hono(); app.route('/api/typeform/validate', router as any);
  const call = async (userId: number, extra: any = {}) => {
    const token = await new SignJWT({ user_id: userId, ...extra }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const res = await app.request('/api/typeform/validate/reviews?project=41', { headers: { Authorization: `Bearer ${token}` } }, w.env);
    return [res.status, (await res.text()).includes('PRIVATE SYNTHETIC ANSWER')];
  };
  assert.deepEqual([await call(8), await call(7, { impersonated_by: 7 }), await call(7)], [[404, false], [403, false], [403, false]]);
  w.db.exec(`INSERT INTO typeform_form_bindings (uid, project_id, integration_id, form_id, bound_by) VALUES ('binding-a', 41, 501, 'FormTest', 7);
    INSERT INTO user_company_links (uid, company_id, user_id) VALUES ('company-member-a', 41, 7);
    INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (501, 41, 1);`);
  assert.deepEqual(await call(7), [200, true]);
  assert.deepEqual(await call(7, { impersonated_by: 7 }), [403, false]);
  w.db.exec('UPDATE integration_companies SET enabled = 0');
  assert.deepEqual(await call(7), [403, false]);
  w.db.exec("UPDATE integration_companies SET enabled = 1; INSERT INTO project_members (project_id, user_id, role, status) VALUES (41, 8, 'cofounder', 'accepted')");
  assert.deepEqual(await call(8), [403, false]);
});
