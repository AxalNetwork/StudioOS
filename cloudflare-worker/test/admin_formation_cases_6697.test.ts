/**
 * D6697 (#6697, H1 of #6680) — HQ's formation case reads, over the full migrated
 * schema (migration 202611231601_6697 included), one test per Done-when item:
 *   - a non-admin gets 403 on every route; a branch gets the named refusal;
 *   - an admin who is not the case's HQ owner gets counts, not people or documents;
 *   - every people or documents read writes the access log;
 *   - list reads return no email;
 *   - a case waiting on the founder adds nothing to the partner's clock;
 * plus the saved views, legacy rows marked, and the filings board.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/admin_formation_cases_6697.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import cases, { formationFilingsRouter, mount } from '../src/routes/admin_formation_cases.ts';
import { AGE_BANDS, VIEWS, bandOf, partyClocks } from '../src/services/formationQueue.ts';

const JWT_SECRET = 'synthetic-6697-only-not-a-real-credential'.repeat(2);
const OWNER = 1, OTHER_ADMIN = 2, SUPER = 3, FOUNDER = 10, LEGACY_FOUNDER = 11;
const NOW = Date.UTC(2026, 10, 23, 12, 0, 0);
const all = (db: DatabaseSync, sql: string, ...a: unknown[]) => (db.prepare(sql).all(...(a as any[])) as any[]).map((r) => ({ ...r }));
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error, l = console.log; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; console.log = l; }
};

/**
 * Three admins (the case's HQ owner, another admin, a Super Admin), two founders.
 * Case fc_a: v2, waiting on the founder for five days after two days on the partner,
 * owned by OWNER, with one document and a recorded answer. Case fc_late: v2,
 * waiting on the partner for ten days, unassigned. Case fc_legacy: legacy_v1.
 */
function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(OWNER, 'admin', 'Owen Owner', 'owner@axal.example', null);
  u.run(OTHER_ADMIN, 'admin', 'Ada Other', 'other@axal.example', null);
  u.run(SUPER, 'admin', 'Sam Super', 'super@axal.example', null);
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(LEGACY_FOUNDER, 'founder', 'Lee Legacy', 'lee@example.test', 2002);
  db.prepare('DELETE FROM super_admins').run();
  db.prepare('INSERT INTO super_admins(user_id) VALUES (?)').run(SUPER);
  const kase = db.prepare(`INSERT INTO formation_cases (id, uid, user_id, intent, track, path, stage, stage_entered_at, waiting_on, hq_owner_user_id, partner_id, created_at, revision)
      VALUES (?, ?, ?, 'new_company', ?, ?, ?, ?, ?, ?, ?, ?, 0)`);
  kase.run(1, 'fc_a', FOUNDER, 'v2', 'simple', 'preparing', '2026-11-16 12:00:00', 'partner', OWNER, 7, '2026-11-16 12:00:00');
  kase.run(2, 'fc_late', FOUNDER, 'v2', 'specialist', 'preparing', '2026-11-13 12:00:00', 'partner', null, 7, '2026-11-13 12:00:00');
  kase.run(3, 'fc_legacy', LEGACY_FOUNDER, 'legacy_v1', null, 'submitted', '2026-11-20 12:00:00', 'registry', null, null, '2026-11-20 12:00:00');
  // The triggers logged each case's creation; fc_a then waited on the founder from 18 Nov.
  db.exec(`DROP TRIGGER formation_cases_waiting_changed;
    CREATE TRIGGER formation_cases_waiting_changed AFTER UPDATE OF waiting_on ON formation_cases WHEN NEW.waiting_on IS NOT OLD.waiting_on
    BEGIN INSERT INTO formation_case_waiting_log (case_id, party, at, source) VALUES (NEW.id, NEW.waiting_on, '2026-11-18 12:00:00', 'changed'); END;`);
  db.prepare("UPDATE formation_cases SET waiting_on = 'founder' WHERE id = 1").run();
  db.exec(`INSERT INTO documents (id, title, doc_type, status) VALUES (51, 'Filing pack', 'other', 'generated');
    INSERT INTO formation_case_documents (uid, case_id, document_id, class, visible_to) VALUES ('fd1', 1, 51, 'filing_pack', 'hq_only');
    INSERT INTO formation_case_answers (uid, case_id, case_revision, answers_json, prefill_json, created_by) VALUES ('fa1', 1, 0, '{"director":"Fay Founder"}', '{}', ${FOUNDER});
    INSERT INTO formation_filings (uid, case_id, kind, state, submitted_on) VALUES ('ff1', 3, 'name_reservation', 'submitted', '2026-11-20');
    INSERT INTO formation_case_events (case_id, party, kind, visibility, detail_json) VALUES (1, 'hq', 'note', 'hq_only', '{"text":"Spoke to Fay on the phone"}');
    INSERT INTO formation_case_requests (uid, case_id, asked_by_party, asked_by_user_id, asked_of_party, asked_of_user_id, kind, title, prior_waiting_on, prior_case_revision)
      VALUES ('fr1', 1, 'hq', ${OWNER}, 'founder', ${FOUNDER}, 'answer', 'Confirm the registered address', 'partner', 0);`);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  return { db, env };
}

const app = new Hono<any>();
for (const m of mount) app.route(m.path, m.router as any);
app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function get(env: any, path: string, who: number | null) {
  const headers: Record<string, string> = {};
  if (who != null) {
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res = await quiet(() => app.request(path, { headers }, env));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const ROUTES = ['/api/admin/formation/cases', '/api/admin/formation/cases/fc_a', '/api/admin/formation/filings'];

test('mounted at its two paths, nothing else', () => {
  assert.deepEqual(mount.map((m) => [m.path, m.router]), [['/api/admin/formation/cases', cases], ['/api/admin/formation/filings', formationFilingsRouter]]);
});

test('a non-admin gets 403 on every route, a signed-out caller 401, and a branch the named refusal', async () => {
  const { env } = fixture();
  for (const p of ROUTES) {
    assert.equal((await get(env, p, FOUNDER)).status, 403, p);
    assert.equal((await get(env, p, null)).status, 401, p);
    const branch = await get({ ...env, BRANCH_CODE: 'uk' }, p, OWNER);
    assert.equal(branch.status, 403, p);
    assert.match(String(branch.body.detail), /HQ|branch/i, p);
  }
});

test('the queue returns no email, no name and no document, for any admin', async () => {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  try {
    const { env } = fixture();
    for (const who of [OWNER, OTHER_ADMIN, SUPER]) {
      const r = await get(env, '/api/admin/formation/cases', who);
      assert.equal(r.status, 200);
      const text = JSON.stringify(r.body);
      for (const secret of ['@', 'Fay', 'Lee', 'Owen', 'filing_pack', 'director']) assert.ok(!text.includes(secret), `${who} ${secret}`);
      assert.deepEqual(Object.keys(r.body.items[0]).filter((k) => /email|name|user_id|document/.test(k)), []);
    }
    const filings = JSON.stringify((await get(env, '/api/admin/formation/filings', OTHER_ADMIN)).body);
    assert.ok(!filings.includes('@') && !filings.includes('Lee'), 'the filings board names no one');
  } finally { mock.timers.reset(); }
});

test('an admin who is not the HQ owner gets counts, not people, documents or answers, and writes no access log', async () => {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  try {
    const { db, env } = fixture();
    const r = await get(env, '/api/admin/formation/cases/fc_a', OTHER_ADMIN);
    assert.equal(r.status, 200);
    assert.equal(r.body.access, 'counts');
    assert.deepEqual(r.body.people, { count: 2 });
    assert.deepEqual(r.body.documents, { count: 1 });
    assert.equal('answers' in r.body.choice, false);
    assert.equal(r.body.timeline[0].detail, undefined, 'a note\'s text is the owner\'s to read');
    assert.deepEqual(Object.keys(r.body.requests[0]).filter((k) => k.endsWith('user_id')), [], 'who was asked is a person');
    assert.equal(r.body.requests[0].title, 'Confirm the registered address');
    assert.ok(!JSON.stringify(r.body).includes('@') && !JSON.stringify(r.body).includes('Fay'));
    assert.equal(all(db, 'SELECT * FROM formation_case_access_log').length, 0);
  } finally { mock.timers.reset(); }
});

test('every people or documents read writes the access log: the HQ owner and a Super Admin', async () => {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  try {
    const { db, env } = fixture();
    const owner = await get(env, '/api/admin/formation/cases/fc_a', OWNER);
    assert.equal(owner.body.access, 'full');
    assert.deepEqual(owner.body.people.find((p: any) => p.role === 'founder'), { role: 'founder', user_id: FOUNDER, name: 'Fay Founder', email: 'fay@example.test' });
    assert.equal(owner.body.people.find((p: any) => p.role === 'hq_owner').email, null, 'an HQ owner\'s email is not a case fact');
    assert.equal(owner.body.documents.length, 1);
    assert.deepEqual([owner.body.requests[0].asked_by_user_id, owner.body.requests[0].asked_of_user_id], [OWNER, FOUNDER]);
    assert.deepEqual(owner.body.choice.answers, { director: 'Fay Founder' });
    const sup = await get(env, '/api/admin/formation/cases/fc_a', SUPER);
    assert.equal(sup.body.access, 'full');
    assert.deepEqual(all(db, 'SELECT case_id, viewer_user_id, what FROM formation_case_access_log ORDER BY id'), [
      { case_id: 1, viewer_user_id: OWNER, what: 'people' }, { case_id: 1, viewer_user_id: OWNER, what: 'documents' }, { case_id: 1, viewer_user_id: OWNER, what: 'answers' },
      { case_id: 1, viewer_user_id: SUPER, what: 'people' }, { case_id: 1, viewer_user_id: SUPER, what: 'documents' }, { case_id: 1, viewer_user_id: SUPER, what: 'answers' },
    ]);
    assert.throws(() => db.prepare('DELETE FROM formation_case_access_log').run(), /append only/);
    assert.throws(() => db.prepare("UPDATE formation_case_access_log SET what = 'people'").run(), /append only/);
  } finally { mock.timers.reset(); }
});

test('the age of a case waiting on the founder does not count against the partner', async () => {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  try {
    const { env } = fixture();
    const items = (await get(env, '/api/admin/formation/cases', OTHER_ADMIN)).body.items;
    const a = items.find((i: any) => i.uid === 'fc_a');
    assert.equal(a.waiting_on, 'founder');
    assert.deepEqual([a.clocks.days.partner, a.clocks.days.founder], [2, 5], 'two days on the partner, then five on the founder');
    assert.equal(a.clocks.bands.partner, 'new');
    assert.equal(a.clocks.clocks_complete, true);
    assert.equal(a.age_days, 7);
    const late = items.find((i: any) => i.uid === 'fc_late');
    assert.deepEqual([late.clocks.days.partner, late.clocks.bands.partner], [10, 'late']);
  } finally { mock.timers.reset(); }
});

test('the saved views, the filters, and legacy rows marked in the same queue', async () => {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  try {
    const { db, env } = fixture();
    const q = (s: string) => get(env, `/api/admin/formation/cases${s}`, OTHER_ADMIN);
    const all = await q('');
    assert.deepEqual(all.body.items.map((i: any) => [i.uid, i.legacy]), [['fc_late', false], ['fc_a', false], ['fc_legacy', true]]);
    assert.deepEqual(Object.keys(all.body.views), [...VIEWS]);
    const uids = async (s: string) => (await q(s)).body.items.map((i: any) => i.uid);
    assert.deepEqual(await uids('?view=unassigned'), ['fc_late', 'fc_legacy']);
    assert.deepEqual(await uids('?view=partner_late'), ['fc_late']);
    assert.deepEqual(await uids('?view=waiting_on_founder'), ['fc_a']);
    assert.deepEqual(await uids('?view=with_registry'), ['fc_legacy']);
    assert.deepEqual(await uids('?track=legacy_v1'), ['fc_legacy']);
    assert.deepEqual(await uids('?route=specialist'), ['fc_late']);
    assert.deepEqual(await uids('?partner=7'), ['fc_late', 'fc_a']);
    assert.equal(all.body.items.find((i: any) => i.uid === 'fc_a').mine, false);
    assert.equal((await get(env, '/api/admin/formation/cases', OWNER)).body.items.find((i: any) => i.uid === 'fc_a').mine, true);
    // A case waiting on the partner for one day is not late.
    db.prepare(`INSERT INTO formation_cases (id, uid, user_id, intent, track, stage, stage_entered_at, waiting_on, hq_owner_user_id, created_at)
      VALUES (4, 'fc_fresh', ?, 'new_company', 'v2', 'preparing', '2026-11-22 12:00:00', 'partner', ?, '2026-11-22 12:00:00')`).run(FOUNDER, OWNER);
    assert.deepEqual(await uids('?view=partner_late'), ['fc_late'], 'a partner one day in is not late');
    for (const [s, code] of [['?view=everything', 'invalid_view'], ['?country=Germany', 'invalid_country'], ['?route=fast', 'invalid_route'], ['?track=v3', 'invalid_track'], ['?partner=-1', 'invalid_partner']]) {
      const r = await q(s);
      assert.deepEqual([r.status, r.body.error], [400, code], s);
    }
  } finally { mock.timers.reset(); }
});

test('the case read: eight recorded stages and the rest unrecorded, and an unknown case is 404', async () => {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  try {
    const { db, env } = fixture();
    db.exec("INSERT INTO formation_case_stages (case_id, stage, responsible_role) VALUES (1, 'preparing', 'hq')");
    const r = await get(env, '/api/admin/formation/cases/fc_a', OTHER_ADMIN);
    const byStage = Object.fromEntries(r.body.stages.map((s: any) => [s.stage, s]));
    assert.equal(byStage.preparing.current, true);
    assert.equal(byStage.preparing.record.responsible_role, 'hq');
    assert.equal('completed_by' in byStage.preparing.record, false);
    assert.equal(byStage.draft.record, null, 'a stage before paid keeps no record');
    assert.equal((await get(env, '/api/admin/formation/cases/fc_none', OTHER_ADMIN)).status, 404);
    assert.equal((await get(env, '/api/admin/formation/cases/bad%20uid', OTHER_ADMIN)).status, 404);
  } finally { mock.timers.reset(); }
});

test('the filings board: by state, with days since submitted', async () => {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  try {
    const { env } = fixture();
    const r = await get(env, '/api/admin/formation/filings', OTHER_ADMIN);
    assert.equal(r.body.total, 1);
    assert.deepEqual(r.body.by_state.submitted.map((f: any) => [f.uid, f.case_uid, f.legacy, f.days_since_submitted, f.age_band]), [['ff1', 'fc_legacy', true, 3, 'aging']]);
    assert.deepEqual((await get(env, '/api/admin/formation/filings?state=accepted', OTHER_ADMIN)).body.total, 0);
    assert.equal((await get(env, '/api/admin/formation/filings?state=lost', OTHER_ADMIN)).body.error, 'invalid_state');
  } finally { mock.timers.reset(); }
});

test('clocks: spans per party, none before the history starts, a migration start is not complete; bands', () => {
  const rows = [
    { party: 'hq', at: '2026-11-01 00:00:00', source: 'migration' },
    { party: 'partner', at: '2026-11-02 00:00:00', source: 'changed' },
    { party: 'founder', at: '2026-11-05 00:00:00', source: 'changed' },
  ];
  const c = partyClocks(rows, Date.UTC(2026, 10, 9));
  assert.deepEqual([c.days.hq, c.days.partner, c.days.founder, c.days.registry], [1, 3, 4, 0]);
  assert.equal(c.clocks_complete, false, 'history from the migration says so');
  assert.equal(partyClocks(rows, Date.UTC(2026, 10, 9), '2026-11-06 00:00:00').days.founder, 1, 'a closed case stops its clock');
  assert.deepEqual(partyClocks([], Date.now()).days.partner, null);
  assert.deepEqual(AGE_BANDS.map((b) => b.band), ['new', 'aging', 'late']);
  assert.deepEqual([bandOf(0), bandOf(2), bandOf(3), bandOf(7), bandOf(8), bandOf(null)], ['new', 'new', 'aging', 'aging', 'late', null]);
});

test('the migration logs a new case and each change of waiting_on, and keeps the log', () => {
  const { db } = fixture();
  db.exec("INSERT INTO formation_cases (id, uid, user_id, intent, track, stage, waiting_on, created_at) VALUES (9, 'fc_new', 10, 'new_company', 'v2', 'draft', 'founder', '2026-11-22 00:00:00')");
  assert.deepEqual(all(db, 'SELECT party, at, source FROM formation_case_waiting_log WHERE case_id = 9'), [{ party: 'founder', at: '2026-11-22 00:00:00', source: 'created' }]);
  db.prepare("UPDATE formation_cases SET stage = 'chosen' WHERE id = 9").run();
  assert.equal(all(db, 'SELECT * FROM formation_case_waiting_log WHERE case_id = 9').length, 1, 'no change of party, no row');
  assert.throws(() => db.prepare('DELETE FROM formation_case_waiting_log').run(), /append only/);
});
