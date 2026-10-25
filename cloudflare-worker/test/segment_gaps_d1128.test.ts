/** D1128: real segment routes on migration 559, with no new schema. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import segments from '../src/routes/persona_segments.ts';
import personas from '../src/routes/personas.ts';
import events from '../src/routes/events.ts';
import { questionsOf } from '../src/services/segmentMembership.ts';
import { registrationEligibility, registrationRulesFromStore } from '../src/services/eventOrganiser.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../sql/migrations/559_segment_profiles.sql', import.meta.url), 'utf8');
const secret = 'synthetic-d1128-auth-key-for-mounted-tests';
const ADMIN = 1, HQ = 2, MEMBER = 3;
const app = new Hono<any>();
app.route('/api/personas/segments', segments); app.route('/api/personas', personas); app.route('/api/events', events);
app.onError((err, c) => c.json({ code: 'refused' }, AUTH_ERROR_STATUSES[err.message] ?? 500));
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const table of ['users', 'super_admins', 'user_personas', 'user_profile_extras', 'activity_logs', 'admin_audit_log', 'events']) db.exec(tableFromBaseline(baseline, table));
  db.exec(migration);
  const add = (id: number, role = 'investor', active = 1) => db.prepare(`INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, ?)`).run(id, `synthetic-${id}@example.test`, 'Synthetic member', role, active);
  add(ADMIN, 'admin'); add(HQ, 'admin'); add(MEMBER); db.prepare(`INSERT INTO super_admins (user_id) VALUES (?)`).run(HQ);
  const env: any = { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development' };
  const tag = (id: number, key = 'corporate_vc', primary = 1, source = 'admin_retag') => db.prepare(`INSERT INTO user_personas (user_id, persona_id, is_primary, source, manual_override) VALUES (?, ?, ?, ?, 1)`).run(id, key, primary, source);
  const answer = (id: number, key: string, value: string, persona = 'corporate_vc') => db.prepare(`INSERT INTO user_profile_extras (user_id, persona_id, key, value) VALUES (?, ?, ?, ?)`).run(id, persona, key, value);
  async function call(as: number | null, method: string, path: string, body?: any) {
    const headers: any = { 'content-type': 'application/json' };
    if (as !== null) headers.authorization = 'Bearer ' + await new SignJWT({ user_id: as }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
    const res = await app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: res.status, body: await res.json() as any };
  }
  return { db, env, add, tag, answer, call };
}
const draft = { key: 'specialist_advisors', name: 'Specialist advisors', profile: 'advisor', status: 'draft', who: 'Synthetic description.' };

test('HQ creates once, recording its actor and empty-before history; other viewers and branches cannot create', async () => {
  const f = fixture(); try {
    for (const as of [null, ADMIN, MEMBER]) assert.ok([401, 403].includes((await f.call(as, 'POST', '/api/personas/segments', draft)).status));
    f.env.BRANCH_CODE = 'synthetic';
    assert.equal((await f.call(HQ, 'POST', '/api/personas/segments', draft)).status, 403);
    delete f.env.BRANCH_CODE;
    const created = await f.call(HQ, 'POST', '/api/personas/segments', draft);
    assert.equal(created.status, 201); assert.equal(created.body.segment.key, draft.key); assert.equal(created.body.segment.profile, 'advisor');
    assert.equal(created.body.segment.sign_up_questions, null); assert.deepEqual(created.body.segment.needs, []);
    const history = f.db.prepare(`SELECT actor_user_id, before_json, after_json, version FROM segment_profile_history WHERE segment_key = ?`).get(draft.key) as any;
    assert.equal(history.actor_user_id, HQ); assert.equal(history.before_json, null); assert.equal(history.version, 1);
    assert.equal(JSON.parse(history.after_json).name, draft.name);
    assert.equal((f.db.prepare(`SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'segment_profile_created'`).get() as any).n, 1);
    assert.equal((await f.call(HQ, 'POST', '/api/personas/segments', draft)).status, 409);
    assert.equal((f.db.prepare(`SELECT COUNT(*) AS n FROM segment_profile_history WHERE segment_key = ?`).get(draft.key) as any).n, 1);
  } finally { f.db.close(); }
});

test('creation checks keys, required fields and read-only questions before writing', async () => {
  const f = fixture(); try {
    for (const body of [null, [], { ...draft, key: 'x;DROP' }, { ...draft, key: '__proto__' }, { ...draft, key: 'constructor' }, { ...draft, key: 'X' }, { ...draft, key: 'a'.repeat(65) }, { key: 'minimal', name: 'Minimal' }, { ...draft, name: 'x'.repeat(81) }, { ...draft, unknown_field: true }, { ...draft, name: '' }, { ...draft, profile: 'admin' }, { ...draft, status: 'invented' }, { ...draft, who: 'x'.repeat(281) }, { ...draft, sign_up_questions: [] }, { ...draft, offers: { sidebar_links: [] } }]) {
      assert.equal((await f.call(HQ, 'POST', '/api/personas/segments', body)).status, 400, JSON.stringify(body));
    }
    assert.equal((f.db.prepare(`SELECT COUNT(*) AS n FROM segment_profiles`).get() as any).n, 12);
  } finally { f.db.close(); }
});

test('profile and creation history roll back together; no raw storage failure escapes', async () => {
  const f = fixture(); try {
    f.db.exec('DROP TABLE segment_profile_history');
    const result = await f.call(HQ, 'POST', '/api/personas/segments', draft);
    assert.equal(result.status, 503); assert.equal(result.body.code, 'write_failed');
    assert.ok(!JSON.stringify(result.body).includes('segment_profile_history'));
    assert.equal(f.db.prepare(`SELECT key FROM segment_profiles WHERE key = ?`).get(draft.key), undefined);
  } finally { f.db.close(); }
});

test('a custom active segment is offered by its stored name and accepted by finalize and retag; drafts and retired are not offered', async () => {
  const f = fixture(); try {
    await f.call(HQ, 'POST', '/api/personas/segments', { ...draft, status: 'active' });
    const taxonomy = await f.call(null, 'GET', '/api/personas/taxonomy');
    const custom = taxonomy.body.personas.find((p: any) => p.id === draft.key);
    assert.equal(custom.label, draft.name); assert.deepEqual(custom.follow_up_questions, []);
    assert.ok([401, 403].includes((await f.call(null, 'GET', '/api/personas/audience-segments')).status));
    assert.equal((await f.call(MEMBER, 'GET', '/api/personas/audience-segments')).body.segments.find((p: any) => p.key === draft.key).name, draft.name);
    assert.equal((await f.call(MEMBER, 'POST', '/api/personas/finalize', { persona_id: draft.key, source: 'self_select' })).status, 200);
    assert.equal((f.db.prepare(`SELECT role FROM users WHERE id = ?`).get(MEMBER) as any).role, 'investor');
    f.db.prepare(`UPDATE segment_profiles SET status = 'draft', name = 'Updated HQ name' WHERE key = ?`).run(draft.key);
    const listed = (await f.call(null, 'GET', '/api/personas/taxonomy')).body.personas;
    assert.ok(!listed.some((p: any) => p.id === draft.key));
    assert.ok(!(await f.call(MEMBER, 'GET', '/api/personas/audience-segments')).body.segments.some((p: any) => p.key === draft.key));
    assert.ok((await f.call(ADMIN, 'GET', '/api/personas/audience-segments')).body.segments.some((p: any) => p.key === draft.key));
    f.add(4); assert.equal((await f.call(4, 'POST', '/api/personas/finalize', { persona_id: draft.key })).status, 409);
    assert.equal((await f.call(ADMIN, 'POST', '/api/personas/admin/4/retag', { persona_id: draft.key })).status, 200);
    f.db.prepare(`UPDATE segment_profiles SET status = 'retired' WHERE key = ?`).run(draft.key);
    f.add(5); assert.equal((await f.call(ADMIN, 'POST', '/api/personas/admin/5/retag', { persona_id: draft.key })).status, 409);
    assert.equal((await f.call(4, 'POST', '/api/personas/finalize', { persona_id: draft.key })).status, 200, 'a held retired segment can be kept');
    assert.equal((await f.call(4, 'POST', '/api/personas/finalize', { persona_id: 'never_recorded' })).status, 400);
    f.db.exec('DROP TABLE segment_profiles');
    assert.equal((await f.call(null, 'GET', '/api/personas/taxonomy')).status, 503, 'no code fallback on a failed store');
  } finally { f.db.close(); }
});

test('a self-selected segment is not mistaken for an admin move', async () => {
  const f = fixture(); try {
    f.tag(MEMBER, 'corporate_vc', 1, 'self_select');
    assert.equal((await f.call(MEMBER, 'GET', '/api/personas/me')).body.follow_up.pending, false);
  } finally { f.db.close(); }
});

test('an admin move asks only the new primary segment missing questions; answering keeps the admin placement intact', async () => {
  const f = fixture(); try {
    f.tag(MEMBER, 'angel_scout', 1, 'self_select');
    f.answer(MEMBER, 'old_private', 'Synthetic private answer', 'angel_scout');
    assert.equal((await f.call(ADMIN, 'POST', `/api/personas/admin/${MEMBER}/retag`, { persona_id: 'corporate_vc' })).status, 200);
    const first = (await f.call(MEMBER, 'GET', '/api/personas/me')).body.follow_up;
    assert.equal(first.pending, true); assert.equal(first.persona_id, 'corporate_vc');
    assert.deepEqual(first.questions.map((q: any) => q.key), questionsOf('corporate_vc').map(q => q.key));
    assert.ok(!JSON.stringify(first).includes('Synthetic private answer'));
    for (const q of first.questions) {
      const value = q.type === 'choice' ? q.choices[0] : q.type === 'number' ? '0' : 'Synthetic response';
      assert.equal((await f.call(MEMBER, 'POST', '/api/personas/answer', { persona_id: 'corporate_vc', key: q.key, value, expected_primary: true })).status, 200);
    }
    const after = (await f.call(MEMBER, 'GET', '/api/personas/me')).body.follow_up;
    assert.equal(after.pending, false); assert.deepEqual(after.questions, []);
    const primary = f.db.prepare(`SELECT persona_id, source, manual_override FROM user_personas WHERE user_id = ? AND is_primary = 1`).get(MEMBER) as any;
    assert.equal(primary.persona_id, 'corporate_vc'); assert.equal(primary.source, 'admin_retag'); assert.equal(primary.manual_override, 1);
    assert.equal((await f.call(ADMIN, 'GET', '/api/personas/me')).body.follow_up.pending, false);
  } finally { f.db.close(); }
});

test('follow-up rejects a stale primary and invalid answers; stored answers from a different segment do not complete it', async () => {
  const f = fixture(); try {
    f.tag(MEMBER); const q = questionsOf('corporate_vc')[0];
    f.answer(MEMBER, q.key, 'old segment answer', 'angel_scout');
    assert.equal((await f.call(MEMBER, 'GET', '/api/personas/me')).body.follow_up.pending, true);
    for (const body of [{ key: 'never_a_question', value: 'x' }, { key: q.key, value: '' }, { key: q.key, value: {} }]) assert.equal((await f.call(MEMBER, 'POST', '/api/personas/answer', { persona_id: 'corporate_vc', ...body })).status, 400);
    assert.equal((await f.call(MEMBER, 'POST', '/api/personas/answer', { persona_id: 'angel_scout', key: questionsOf('angel_scout')[0].key, value: 'x', expected_primary: true })).status, 409);
    const before = (await f.call(MEMBER, 'GET', '/api/personas/me')).body.follow_up.questions;
    f.answer(MEMBER, q.key, 'valid recorded answer');
    assert.equal((await f.call(MEMBER, 'GET', '/api/personas/me')).body.follow_up.questions.length, before.length - 1);
  } finally { f.db.close(); }
});

test('SEG2 completion reads 34 of 61, excluding admin, inactive and secondary memberships and returning no answers', async () => {
  const f = fixture(); try {
    const bank = questionsOf('corporate_vc');
    for (let i = 0; i < 61; i++) {
      const id = 100 + i; f.add(id); f.tag(id);
      if (i < 34) for (const q of bank) f.answer(id, q.key, '0');
    }
    f.tag(ADMIN); for (const q of bank) f.answer(ADMIN, q.key, 'admin-private');
    for (const q of bank) f.answer(134, q.key, ' ');
    for (const q of bank) f.answer(135, q.key, 'old answer', 'angel_scout');
    f.answer(136, bank[0].key, 'partial answer');
    f.add(200, 'investor', 0); f.tag(200); for (const q of bank) f.answer(200, q.key, 'inactive-private');
    f.add(201); f.tag(201, 'corporate_vc', 0);
    const result = await f.call(ADMIN, 'GET', '/api/personas/segments/corporate_vc/completion');
    assert.equal(result.status, 200); assert.equal(result.body.recorded, true);
    assert.deepEqual(result.body.answered, { count: 34, suppressed: false }); assert.deepEqual(result.body.members, { count: 61, suppressed: false });
    assert.equal(result.body.incomplete.count, 27); assert.ok(!JSON.stringify(result.body).includes('private'));
    assert.ok([401, 403].includes((await f.call(null, 'GET', '/api/personas/segments/corporate_vc/completion')).status));
    assert.equal((await f.call(MEMBER, 'GET', '/api/personas/segments/corporate_vc/completion')).status, 403);
  } finally { f.db.close(); }
});

test('completion suppresses a small cell and its complement, distinguishes zero, no question bank, missing segment and failed read', async () => {
  const f = fixture(); try {
    for (let i = 0; i < 10; i++) { f.add(100 + i); f.tag(100 + i); }
    for (const q of questionsOf('corporate_vc')) f.answer(100, q.key, '0');
    let result = await f.call(ADMIN, 'GET', '/api/personas/segments/corporate_vc/completion');
    assert.equal(result.body.answered.count, null); assert.equal(result.body.incomplete.count, null); assert.equal(result.body.members.count, 10);
    assert.equal((await f.call(ADMIN, 'GET', '/api/personas/segments/founder_new/completion')).body.answered.count, 0);
    await f.call(HQ, 'POST', '/api/personas/segments', draft);
    result = await f.call(ADMIN, 'GET', `/api/personas/segments/${draft.key}/completion`);
    assert.equal(result.body.recorded, false); assert.match(result.body.reason, /No questions/); assert.equal(result.body.answered, undefined);
    assert.equal((await f.call(ADMIN, 'GET', '/api/personas/segments/no_segment/completion')).status, 404);
    f.db.exec('DROP TABLE user_profile_extras');
    assert.equal((await f.call(ADMIN, 'GET', '/api/personas/segments/corporate_vc/completion')).status, 503);
  } finally { f.db.close(); }
});

test('Events validates stored custom segments, admits only their members, and never turns an unreadable store into everyone', async () => {
  const f = fixture(); try {
    await f.call(HQ, 'POST', '/api/personas/segments', { ...draft, status: 'active' }); f.tag(MEMBER, draft.key);
    const rule = { mode: 'selected', personas: [draft.key] };
    assert.deepEqual(await registrationRulesFromStore(f.env, rule), rule);
    const event = { id: 1, audience_rules_json: JSON.stringify(rule) };
    assert.equal((await registrationEligibility(f.env, event, MEMBER, null)).eligible, true);
    assert.equal((await registrationEligibility(f.env, event, ADMIN, null)).eligible, false);
    await f.call(ADMIN, 'POST', `/api/personas/admin/${MEMBER}/retag`, { persona_id: 'corporate_vc' });
    assert.equal((await registrationEligibility(f.env, event, MEMBER, null)).eligible, false, 'a former segment closes after a move');
    f.add(7, 'founder'); f.tag(7, 'founder_new'); f.tag(7, 'operator_advisor', 0);
    assert.equal((await registrationEligibility(f.env, { id: 2, audience_rules_json: JSON.stringify({ mode: 'selected', personas: ['operator_advisor'] }) }, 7, null)).eligible, true, 'the allowed Founder/Operator secondary segment still works');
    await assert.rejects(() => registrationRulesFromStore(f.env, { mode: 'selected', personas: ['unknown_segment'] }), /invalid_audience_rules/);
    f.db.exec('DROP TABLE segment_profiles');
    await assert.rejects(() => registrationEligibility(f.env, event, MEMBER, null), /could not be read/);
    const result = await f.call(MEMBER, 'POST', '/api/events', { title: 'Synthetic event', starts_at: '2099-01-01', audience_rules: rule });
    assert.equal(result.status, 503); assert.equal(result.body.error, 'segments_unreadable');
  } finally { f.db.close(); }
});
