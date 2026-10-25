/**
 * D1003 (#2818), Persona segments part 6: an Admin's suggestions, HQ's accept
 * or decline, and notices both ways (migration 570).
 *
 * What this file holds the Worker to:
 *   · the store's CHECKs: a decline has its line, a suggestion names its segment
 *     unless it is a new one;
 *   · any Admin suggests; a member cannot; each refusal is a code and a sentence;
 *   · HQ's Super Admins are told of a new suggestion; the Admin is told of the
 *     decision, with the line on a decline;
 *   · a plain Admin reads their own suggestions, HQ's Super Admin all of them;
 *   · only HQ's Super Admin decides, once; accept answers with what part 3's
 *     edit opens on; a decline needs one line;
 *   · a subsidiary's Admin: the suggestion is relayed to HQ, stored once on a
 *     retry, kept `undelivered` when HQ cannot be reached, and HQ's decision
 *     is pushed back and told to them there.
 *
 * The real `routes/persona_segments.ts` over HTTP, on node:sqlite with
 * schema_baseline.sql and migrations 559 and 570; the RPC halves through
 * `rpc/segmentSuggestionOps.ts`, wired between two databases.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/segment_suggestions_d1003.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import segmentsRoute from '../src/routes/persona_segments.ts';
import { applySegmentSuggestionAnswer, recordSegmentSuggestion } from '../src/rpc/segmentSuggestionOps.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';

const SECRET = 'segment-suggestion-secret-0123456789-abcdef';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const PROFILES = readFileSync(new URL('../sql/migrations/559_segment_profiles.sql', import.meta.url), 'utf8');
const SUGGESTIONS = readFileSync(new URL('../sql/migrations/570_segment_suggestions.sql', import.meta.url), 'utf8');

const app = new Hono<any>();
app.route('/api/personas/segments', segmentsRoute);
app.onError((err, c) => c.json({ detail: err.message }, AUTH_ERROR_STATUSES[err.message] ?? 500));

const ADMIN = 10, SUPER = 11, OTHER_ADMIN = 12, MEMBER = 20, BRANCH_ADMIN = 30;

function database() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'admin_audit_log', 'activity_logs']) db.exec(tableFromBaseline(BASELINE, t));
  // Migration 258's registry, as far as the code check reads it.
  db.exec('CREATE TABLE licence_deployments (code TEXT PRIMARY KEY, licence_uid TEXT, status TEXT)');
  db.exec(PROFILES);
  db.exec(SUGGESTIONS);
  return db;
}

function hq() {
  const db = database();
  const user = db.prepare(`INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)`);
  user.run(ADMIN, 'admin@example.test', 'Synthetic Admin', 'admin');
  user.run(SUPER, 'hq@example.test', 'Synthetic HQ', 'admin');
  user.run(OTHER_ADMIN, 'other@example.test', 'Other Admin', 'admin');
  user.run(MEMBER, 'member@example.test', 'Synthetic member', 'investor');
  db.prepare(`INSERT INTO super_admins (user_id) VALUES (?)`).run(SUPER);
  db.prepare(`INSERT INTO licence_deployments (code, licence_uid, status) VALUES ('fr', 'lic-fr', 'linked')`).run();
  return { db, env: { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}

function subsidiary(hqEnv: any | null) {
  const db = database();
  db.prepare(`INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)`).run(BRANCH_ADMIN, 'fr@example.test', 'Studio FR Admin', 'admin');
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development', BRANCH_CODE: 'fr' };
  if (hqEnv) env.HQ = { segmentSuggestion: (code: string, input: any) => recordSegmentSuggestion(hqEnv, code, input) };
  return { db, env };
}

async function call(env: any, as: number | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (as !== null) {
    const role = as === MEMBER ? 'investor' : 'admin';
    headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: as, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  }
  const res = await app.request('/api/personas/segments' + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { /* the status says it */ }
  return { status: res.status, body: json };
}

const inbox = (db: DatabaseSync, userId: number) => {
  try { return db.prepare('SELECT type, title, body, link FROM notifications_inbox WHERE user_id = ? ORDER BY id').all(userId) as any[]; } catch { return []; }
};
const NEED = { segment_key: 'angel_scout', kind: 'need', text: 'They ask for deal-flow intros every week; add a need for it.' };

test('the store refuses a decline with no line, and a suggestion with no segment unless it is a new one', () => {
  const db = database();
  db.exec(SUGGESTIONS); // applies again without harm
  const ins = db.prepare(`INSERT INTO segment_suggestions (uid, segment_key, kind, text, status, decline_reason) VALUES (?, ?, ?, ?, ?, ?)`);
  assert.throws(() => ins.run('u1', 'angel_scout', 'need', 'x', 'declined', null), /CHECK/);
  assert.throws(() => ins.run('u2', 'angel_scout', 'need', 'x', 'declined', '   '), /CHECK/);
  assert.throws(() => ins.run('u3', null, 'need', 'x', 'open', null), /CHECK/);
  ins.run('u4', null, 'new_segment', 'A segment for corporate venture arms.', 'open', null);
  assert.throws(() => ins.run('u5', 'angel_scout', 'need', 'x'.repeat(501), 'open', null), /CHECK/);
});

test('any Admin suggests; HQ\'s Super Admins are told; each refusal is a code and a sentence', async () => {
  const { db, env } = hq();
  assert.equal((await call(env, null, 'POST', '/suggestions', NEED)).status, 401);
  assert.equal((await call(env, MEMBER, 'POST', '/suggestions', NEED)).status, 403, 'a member suggests nothing');
  const made = await call(env, ADMIN, 'POST', '/suggestions', NEED);
  assert.equal(made.status, 201);
  assert.equal(made.body.suggestion.status, 'open');
  assert.equal(made.body.suggestion.studio, 'hq');
  assert.equal(made.body.suggestion.suggested_by_name, 'Synthetic Admin');
  assert.equal(made.body.notice.told, 1);
  const told = inbox(db, SUPER);
  assert.equal(told.length, 1);
  assert.equal(told[0].type, 'segment_suggestion_new');
  assert.match(told[0].title, /A suggestion for the angel_scout segment/);
  assert.equal(inbox(db, OTHER_ADMIN).length, 0, 'only Super Admins are told');
  for (const [body, code, status] of [
    [{ ...NEED, kind: 'nonsense' }, 'invalid_kind', 400],
    [{ ...NEED, text: '   ' }, 'text_required', 400],
    [{ ...NEED, text: 'x'.repeat(501) }, 'invalid_text', 400],
    [{ kind: 'need', text: 'x' }, 'segment_required', 400],
    [{ ...NEED, segment_key: 'no_such_segment' }, 'not_found', 404],
    [[1, 2], 'invalid_body', 400],
  ] as const) {
    const r = await call(env, ADMIN, 'POST', '/suggestions', body);
    assert.equal(r.status, status, code);
    assert.equal(r.body.code, code);
    assert.ok(r.body.detail, `${code} says why`);
  }
  const fresh = await call(env, ADMIN, 'POST', '/suggestions', { kind: 'new_segment', text: 'Corporate venture arms.' });
  assert.equal(fresh.status, 201, 'a new segment names no segment');
  assert.equal(fresh.body.suggestion.segment_key, null);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM segment_suggestions').get() as any).n, 2, 'a refusal stores nothing');
});

test('a plain Admin reads their own; HQ\'s Super Admin reads all, by status', async () => {
  const { env } = hq();
  await call(env, ADMIN, 'POST', '/suggestions', NEED);
  await call(env, OTHER_ADMIN, 'POST', '/suggestions', { ...NEED, kind: 'offer', text: 'Offer the scouting program.' });
  const mine = await call(env, ADMIN, 'GET', '/suggestions');
  assert.equal(mine.status, 200);
  assert.equal(mine.body.scope, 'mine');
  assert.deepEqual(mine.body.suggestions.map((s: any) => s.kind), ['need']);
  const all = await call(env, SUPER, 'GET', '/suggestions');
  assert.equal(all.body.scope, 'all');
  assert.equal(all.body.suggestions.length, 2);
  assert.ok(all.body.suggestions.every((s: any) => !('suggested_by' in s)), 'no account id in the answer');
  assert.equal((await call(env, SUPER, 'GET', '/suggestions?status=declined')).body.suggestions.length, 0);
  assert.equal((await call(env, MEMBER, 'GET', '/suggestions')).status, 403);
});

test('only HQ\'s Super Admin decides, once; a decline carries its line to the Admin; accept opens part 3\'s edit', async () => {
  const { db, env } = hq();
  const a = (await call(env, ADMIN, 'POST', '/suggestions', NEED)).body.suggestion.uid;
  const b = (await call(env, ADMIN, 'POST', '/suggestions', { ...NEED, kind: 'who', text: 'Say they write first checks.' })).body.suggestion.uid;
  const c = (await call(env, ADMIN, 'POST', '/suggestions', { kind: 'new_segment', text: 'Corporate venture arms.' })).body.suggestion.uid;

  assert.equal((await call(env, ADMIN, 'POST', `/suggestions/${a}/decide`, { decision: 'decline', reason: 'No.' })).status, 403, 'a plain Admin decides nothing');
  const none = await call(env, SUPER, 'POST', `/suggestions/${a}/decide`, { decision: 'decline' });
  assert.equal(none.status, 400);
  assert.equal(none.body.code, 'reason_required');
  assert.equal((await call(env, SUPER, 'POST', `/suggestions/${a}/decide`, { decision: 'maybe' })).body.code, 'invalid_decision');
  assert.equal((await call(env, SUPER, 'POST', `/suggestions/${a}/decide`, { decision: 'decline', reason: 'x'.repeat(201) })).body.code, 'invalid_reason');
  assert.equal((await call(env, SUPER, 'POST', '/suggestions/00000000-0000-0000-0000-000000000000/decide', { decision: 'accept' })).status, 404);

  const declined = await call(env, SUPER, 'POST', `/suggestions/${a}/decide`, { decision: 'decline', reason: 'Intros are\nan event, already offered.' });
  assert.equal(declined.status, 200);
  assert.equal(declined.body.suggestion.status, 'declined');
  assert.equal(declined.body.suggestion.decline_reason, 'Intros are an event, already offered.', 'one line');
  assert.equal(declined.body.edit, null);
  assert.equal(declined.body.notice.ok, true);
  const told = inbox(db, ADMIN).filter((n) => n.type === 'segment_suggestion_decided');
  assert.equal(told.length, 1);
  assert.match(told[0].title, /HQ declined your suggestion/);
  assert.equal(told[0].body, 'Intros are an event, already offered.', 'the Admin reads the line');
  const again = await call(env, SUPER, 'POST', `/suggestions/${a}/decide`, { decision: 'accept' });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'already_decided');

  const accepted = await call(env, SUPER, 'POST', `/suggestions/${b}/decide`, { decision: 'accept' });
  assert.equal(accepted.body.suggestion.status, 'accepted');
  assert.deepEqual(accepted.body.edit, { new_segment: false, segment_key: 'angel_scout', expected_version: 1, field: 'who', text: 'Say they write first checks.' });
  assert.equal((db.prepare(`SELECT version FROM segment_profiles WHERE key = 'angel_scout'`).get() as any).version, 1, 'accepting changes no profile: the edit is HQ\'s write');
  assert.deepEqual((await call(env, SUPER, 'POST', `/suggestions/${c}/decide`, { decision: 'accept' })).body.edit,
    { new_segment: true, segment_key: null, expected_version: null, field: null, text: 'Corporate venture arms.' });
  const audit = db.prepare(`SELECT action FROM admin_audit_log WHERE action = 'segment_suggestion_decided'`).all();
  assert.equal(audit.length, 3, 'each decision is in the audit store');
});

test('a subsidiary\'s Admin: relayed to HQ once, HQ decides, and the decision is pushed back and told there', async () => {
  const H = hq();
  const S = subsidiary(H.env);
  H.env.BRANCH_FR = { applySegmentSuggestionAnswer: (a: any) => applySegmentSuggestionAnswer(S.env, a) };

  const made = await call(S.env, BRANCH_ADMIN, 'POST', '/suggestions', NEED);
  assert.equal(made.status, 201);
  assert.equal(made.body.suggestion.delivery, 'delivered');
  const copy = S.db.prepare('SELECT uid, hq_uid, origin_code FROM segment_suggestions').get() as any;
  assert.equal(copy.origin_code, 'fr');
  const atHq = H.db.prepare('SELECT uid, origin_code, origin_ref, suggested_by, suggested_by_name FROM segment_suggestions').get() as any;
  assert.equal(atHq.uid, copy.hq_uid, 'the copy carries HQ\'s uid');
  assert.deepEqual([atHq.origin_code, atHq.origin_ref, atHq.suggested_by, atHq.suggested_by_name], ['fr', copy.uid, null, 'Studio FR Admin'],
    'HQ holds the studio and the name, never a subsidiary\'s account id');
  assert.equal(inbox(H.db, SUPER).length, 1, 'HQ is told');

  // A retry after a lost response stores one row.
  const retry = await recordSegmentSuggestion(H.env, 'fr', { uid: copy.uid, ...NEED, suggested_by_name: 'Studio FR Admin' }) as any;
  assert.equal(retry.uid, atHq.uid);
  assert.equal((H.db.prepare('SELECT COUNT(*) AS n FROM segment_suggestions').get() as any).n, 1);
  assert.equal(inbox(H.db, SUPER).length, 1, 'a retry tells nobody twice');
  await assert.rejects(() => recordSegmentSuggestion(H.env, 'zz', { uid: copy.uid, ...NEED }), /not a provisioned subsidiary/);
  assert.deepEqual(await recordSegmentSuggestion(H.env, 'fr', { uid: 'not a uid', ...NEED }), { refused: 'invalid_uid', reason: 'The suggestion has no id to store it under.' });

  // The subsidiary's Super Admin route is HQ's alone.
  assert.equal((await call(S.env, BRANCH_ADMIN, 'POST', `/suggestions/${copy.uid}/decide`, { decision: 'accept' })).status, 403);

  const declined = await call(H.env, SUPER, 'POST', `/suggestions/${atHq.uid}/decide`, { decision: 'decline', reason: 'Covered by events.' });
  assert.equal(declined.status, 200);
  assert.equal(declined.body.notice.ok, true);
  assert.equal(declined.body.suggestion.pushed, true);
  const after = S.db.prepare('SELECT status, decline_reason, decided_by_name FROM segment_suggestions').get() as any;
  assert.deepEqual([after.status, after.decline_reason, after.decided_by_name], ['declined', 'Covered by events.', 'Synthetic HQ']);
  const told = inbox(S.db, BRANCH_ADMIN);
  assert.equal(told.length, 1);
  assert.equal(told[0].body, 'Covered by events.', 'told on the subsidiary, where the account is');
  assert.equal((await call(S.env, BRANCH_ADMIN, 'GET', '/suggestions')).body.suggestions[0].status, 'declined');
  assert.deepEqual(await applySegmentSuggestionAnswer(S.env, { hq_uid: '11111111-1111-1111-1111-111111111111', status: 'accepted' }),
    { ok: false, reason: 'This subsidiary sent no suggestion with HQ uid 11111111-1111-1111-1111-111111111111, so there is nothing to answer.' });
});

test('a relay HQ cannot take is kept undelivered; HQ\'s refusal stores nothing; a push with no binding says so', async () => {
  const lone = subsidiary(null);
  const kept = await call(lone.env, BRANCH_ADMIN, 'POST', '/suggestions', NEED);
  assert.equal(kept.status, 201);
  assert.equal(kept.body.suggestion.delivery, 'undelivered');
  assert.match(kept.body.suggestion.delivery_reason, /no HQ service binding/);

  const H = hq();
  const S = subsidiary(H.env);
  S.env.HQ = { segmentSuggestion: async () => { throw new Error('HQ is down'); } };
  const down = await call(S.env, BRANCH_ADMIN, 'POST', '/suggestions', NEED);
  assert.equal(down.body.suggestion.delivery, 'undelivered');
  assert.match(down.body.suggestion.delivery_reason, /HQ did not accept the suggestion: HQ is down/);

  const S2 = subsidiary(H.env);
  S2.env.HQ = { segmentSuggestion: async () => ({ refused: 'not_found', reason: 'No segment is recorded with that key.' }) };
  const refused = await call(S2.env, BRANCH_ADMIN, 'POST', '/suggestions', NEED);
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, 'not_found');
  assert.equal((S2.db.prepare('SELECT COUNT(*) AS n FROM segment_suggestions').get() as any).n, 0, 'HQ\'s refusal is not retried');

  // HQ holds a subsidiary's suggestion but has no Worker bound for it.
  const S3 = subsidiary(H.env);
  await call(S3.env, BRANCH_ADMIN, 'POST', '/suggestions', NEED);
  const uid = (H.db.prepare(`SELECT uid FROM segment_suggestions WHERE origin_code = 'fr' ORDER BY id DESC`).get() as any).uid;
  const decided = await call(H.env, SUPER, 'POST', `/suggestions/${uid}/decide`, { decision: 'accept' });
  assert.equal(decided.status, 200, 'the decision stands');
  assert.equal(decided.body.notice.ok, false);
  assert.match(decided.body.notice.reason, /No Worker is bound for fr/);
  assert.equal(decided.body.suggestion.pushed, false);
});

test('a read that fails is a 503, never an empty list', async () => {
  const { db, env } = hq();
  db.exec('DROP TABLE segment_suggestions');
  const r = await call(env, SUPER, 'GET', '/suggestions');
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'unreadable');
  const w = await call(env, ADMIN, 'POST', '/suggestions', NEED);
  assert.equal(w.status, 503);
});
