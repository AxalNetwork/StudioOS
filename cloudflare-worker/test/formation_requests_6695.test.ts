/**
 * D6695 (#6695, E10 of #6680) — requests on a formation case, notes, and the
 * timeline each party reads.
 *
 * Over the full migrated schema, pinned (one test per Done-when item):
 *   - a founder never receives an hq_only or hq_partner event, nor a request
 *     asked of someone else;
 *   - answering a document request puts the document on the case and notifies
 *     the asker;
 *   - an identity request accepts no file or document (service, route and
 *     store), and records only the partner's reference;
 *   - approving a pack whose hash changed since the request is refused, and an
 *     approval of the current hash sets formation_filings.founder_approved_at;
 *   - waiting_on returns to its prior value when the last open request closes
 *     (and to the new stage's own when the case moved meanwhile);
 *   - a founder cannot read or answer another subject's requests.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/formation_requests_6695.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import router from '../src/routes/formation_requests.ts';
import {
  openRequest, answerRequest, acceptRequest, returnRequest, cancelRequest, addNote, readTimeline,
} from '../src/services/formationRequests.ts';
import { createFiling, setPack } from '../src/services/formationFilings.ts';
import { transition } from '../src/services/formationCase.ts';

const JWT_SECRET = 'synthetic-6695-only-not-a-real-credential'.repeat(2);
const ADMIN = 1, FOUNDER = 10, OTHER = 11, PARTNER = 12;
const HQ = { party: 'hq' as const, userId: ADMIN, email: 'hq@axal.example' };
const PARTNER_ACTOR = { party: 'partner' as const, userId: PARTNER, email: 'partner@firm.example' };
const FOUNDER_ACTOR = { party: 'founder' as const, userId: FOUNDER };
const SHA_A = 'a'.repeat(64), SHA_B = 'b'.repeat(64);
const all = (db: DatabaseSync, sql: string, ...a: unknown[]) => (db.prepare(sql).all(...(a as any[])) as any[]).map((r) => ({ ...r }));
const one = (db: DatabaseSync, sql: string, ...a: unknown[]) => { const r = db.prepare(sql).get(...(a as any[])); return r ? { ...(r as any) } : r; };
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error, l = console.log; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; console.log = l; }
};

/**
 * Two founders, an HQ admin and a partner; Fay's venture (project 1) with
 * documents 51 and 52, Oz's venture (project 2) with document 61; Fay's v2 case
 * 1 at preparing, waiting on `nobody`, with order 7; Oz's case 2.
 */
function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(ADMIN, 'admin', 'Hq Admin', 'hq@axal.example', null);
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Oz Other', 'oz@example.test', 2002);
  u.run(PARTNER, 'partner', 'Pia Partner', 'partner@firm.example', null);
  db.exec(`INSERT INTO projects (id, name, founder_id, slug) VALUES (1, 'Acme', 1001, 'acme'), (2, 'Other', 2002, 'other');
    INSERT INTO documents (id, project_id, title, doc_type, status) VALUES
      (51, 1, 'Filing pack', 'other', 'generated'), (52, 1, 'Proof of address', 'other', 'generated'), (61, 2, 'Oz document', 'other', 'generated');`);
  db.prepare(`INSERT INTO incorporations (id, user_id, project_id, jurisdiction_id, company_name, registered_agent_name, registered_agent_address,
      amount_cents, status, paid_at) VALUES (7, ?, 1, 'us_de_ccorp', 'Acme Inc', 'Agent Co', '1 Agent Way', 50000, 'packet_processing', '2026-10-01 09:00:00')`).run(FOUNDER);
  const kase = db.prepare(`INSERT INTO formation_cases (id, uid, user_id, intent, project_id, track, stage, waiting_on, revision)
      VALUES (?, ?, ?, 'convert_project', ?, 'v2', 'preparing', 'nobody', 0)`);
  kase.run(1, 'fc_fay', FOUNDER, 1);
  kase.run(2, 'fc_oz', OTHER, 2);
  db.exec('INSERT INTO formation_case_orders (case_id, incorporation_id) VALUES (1, 7);');
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  return { db, env };
}
type F = ReturnType<typeof fixture>;
const waiting = (db: DatabaseSync, id = 1) => one(db, 'SELECT waiting_on FROM formation_cases WHERE id = ?', id).waiting_on;

async function open(env: any, input: Record<string, unknown>, actor: any = HQ, caseId = 1) {
  const res = await quiet(() => openRequest(env, caseId, { askedOf: 'founder', title: 'A request', ...input } as any, actor));
  assert.equal(res.ok, true, JSON.stringify(res));
  return (res as any).request;
}

const app = new Hono<any>();
app.route('/api/formation/case-requests', router);
app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function call(f: F, who: number | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (who !== null) {
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res = await quiet(() => app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, f.env));
  const text = await res.text();
  let json: any; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, text };
}

// Mutation checked: the founder timeline's `visibility = 'all'` filter widened to every row (fails: hq_only and
// hq_partner events reach the founder); the list's asked_of_party = 'founder' term dropped (fails: the partner's request listed).
test('a founder never receives an hq_only or hq_partner event, nor a request asked of someone else', async () => {
  const f = fixture();
  await open(f.env, { kind: 'answer', title: 'Who are the directors?' });
  await open(f.env, { askedOf: 'partner', askedOfUserId: PARTNER, kind: 'document', title: 'Partner: send the engagement letter' });
  assert.equal((await quiet(() => addNote(f.env, 1, { text: 'HQ ONLY: pricing exception', visibility: 'hq_only' }, HQ))).ok, true);
  assert.equal((await quiet(() => addNote(f.env, 1, { text: 'HQ+PARTNER: registry slow', visibility: 'hq_partner' }, PARTNER_ACTOR))).ok, true);
  assert.equal((await quiet(() => addNote(f.env, 1, { text: 'For everyone: we have started', visibility: 'all' }, HQ))).ok, true);
  f.db.exec(`INSERT INTO formation_case_events (case_id, party, kind, visibility, detail_json) VALUES (1, 'system', 'case_opened', 'hq_only', '{"secret":"x"}')`);
  assert.deepEqual(await addNote(f.env, 1, { text: 'founder hiding', visibility: 'hq_only' }, FOUNDER_ACTOR), { ok: false, status: 400, error: 'visibility_not_allowed' });
  assert.deepEqual(await addNote(f.env, 1, { text: 'partner hiding', visibility: 'hq_only' }, PARTNER_ACTOR), { ok: false, status: 400, error: 'visibility_not_allowed' });

  const res = await call(f, FOUNDER, 'GET', '/api/formation/case-requests/cases/fc_fay/timeline');
  assert.equal(res.status, 200);
  assert.ok(res.body.events.length >= 2);
  assert.deepEqual([...new Set(res.body.events.map((e: any) => e.visibility))], ['all']);
  assert.doesNotMatch(res.text, /HQ ONLY|HQ\+PARTNER|Partner: send|secret/);
  assert.match(res.text, /For everyone: we have started/);
  assert.match(res.text, /Who are the directors\?/);

  // A partner reads all and hq_partner, never hq_only; HQ reads every row.
  const partnerView = await readTimeline(f.env, 1, 'partner');
  assert.deepEqual([...new Set(partnerView.map((e) => e.visibility))].sort(), ['all', 'hq_partner']);
  assert.equal((await readTimeline(f.env, 1, 'hq')).some((e) => e.visibility === 'hq_only'), true);

  const list = await call(f, FOUNDER, 'GET', '/api/formation/case-requests');
  assert.deepEqual(list.body.requests.map((r: any) => r.title), ['Who are the directors?']);
  assert.doesNotMatch(list.text, /partner_reference|asked_by_user_id|prior_waiting_on/);
});

// Mutation checked: the formation_case_documents insert dropped from the document answer (fails: no row on the case);
// the asker's notify removed (fails: no formation_request_answered in the asker's inbox); the venture term of the
// document check widened to any document (fails: Oz's document 61 accepted).
test('answering a document request stores the document on the case and notifies the asker', async () => {
  const f = fixture();
  const req = await open(f.env, { kind: 'document', title: 'Proof of address for the registered office' });
  assert.equal(one(f.db, "SELECT COUNT(*) AS n FROM notifications_inbox WHERE user_id = ? AND type = 'formation_request_opened' AND category = 'formation'", FOUNDER).n, 1,
    'the founder is told a request was opened');

  const path = `/api/formation/case-requests/${req.uid}/answer`;
  assert.equal((await call(f, FOUNDER, 'POST', path, {})).body.error, 'document_required');
  const foreign = await call(f, FOUNDER, 'POST', path, { document_id: 61 });
  assert.deepEqual([foreign.status, foreign.body.error], [400, 'document_not_on_case'], "another venture's document is refused");
  assert.equal((await call(f, FOUNDER, 'POST', path, { file: 'data:application/pdf;base64,AAAA' })).body.error, 'file_not_accepted');

  const ok = await call(f, FOUNDER, 'POST', path, { document_id: 52, text: 'Attached.' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.request.state, 'answered');
  assert.equal(ok.body.request.answer_document_id, 52);
  assert.deepEqual(all(f.db, 'SELECT case_id, document_id, class, visible_to, added_by FROM formation_case_documents'),
    [{ case_id: 1, document_id: 52, class: 'evidence', visible_to: 'all', added_by: FOUNDER }]);
  const notice = one(f.db, "SELECT type, category, payload FROM notifications_inbox WHERE user_id = ? AND type = 'formation_request_answered'", ADMIN);
  assert.equal(notice?.category, 'formation', 'the asker is notified');
  assert.equal(JSON.parse(notice.payload).request_uid, req.uid);
  assert.equal(one(f.db, "SELECT COUNT(*) AS n FROM formation_case_events WHERE case_id = 1 AND kind = 'request_answered' AND visibility = 'all'").n, 1);

  // Answered once: a second answer is refused; the asker takes it, and the write is logged.
  assert.equal((await call(f, FOUNDER, 'POST', path, { document_id: 51 })).body.error, 'request_not_open');
  assert.equal((await quiet(() => acceptRequest(f.env, req.id, {}, HQ))).ok, true);
  assert.equal(one(f.db, "SELECT COUNT(*) AS n FROM activity_logs WHERE action IN ('formation_request_opened', 'formation_request_accepted') AND user_id = ?", ADMIN).n, 2);
});

// Mutation checked: the identity branch of answerRequest removed (fails: the document is taken on an identity request);
// the store's identity CHECK removed (fails: the raw UPDATE goes through); the reference requirement on accept dropped
// (fails: accepted with no reference).
test('an identity request accepts no file, and records only the partner reference', async () => {
  const f = fixture();
  const req = await open(f.env, { kind: 'identity', title: 'Identity check with the partner' }, PARTNER_ACTOR);
  const path = `/api/formation/case-requests/${req.uid}/answer`;
  for (const body of [{ document_id: 52 }, { documentId: 52 }, { file: 'data:image/png;base64,AAAA' }, { data_uri: 'data:image/png;base64,AAAA' }]) {
    const res = await call(f, FOUNDER, 'POST', path, body);
    assert.deepEqual([res.status, res.body.error], [400, 'identity_takes_no_file'], JSON.stringify(body));
  }
  assert.deepEqual(await answerRequest(f.env, req.id, { documentId: 52 }, FOUNDER_ACTOR), { ok: false, status: 400, error: 'identity_takes_no_file' });
  assert.equal(one(f.db, 'SELECT COUNT(*) AS n FROM formation_case_documents').n, 0);
  assert.throws(() => f.db.prepare('UPDATE formation_case_requests SET answer_document_id = 52 WHERE id = ?').run(req.id), /CHECK/);

  const done = await call(f, FOUNDER, 'POST', path, { text: 'Done with the partner on a call.' });
  assert.equal(done.status, 200, done.text);
  assert.deepEqual(await acceptRequest(f.env, req.id, {}, PARTNER_ACTOR), { ok: false, status: 400, error: 'partner_reference_required' });
  assert.equal((await quiet(() => acceptRequest(f.env, req.id, { partnerReference: 'KYC-REF-0042' }, PARTNER_ACTOR))).ok, true);
  assert.deepEqual(one(f.db, 'SELECT state, partner_reference, answer_document_id FROM formation_case_requests WHERE id = ?', req.id),
    { state: 'accepted', partner_reference: 'KYC-REF-0042', answer_document_id: null });
  const founderRead = await call(f, FOUNDER, 'GET', `/api/formation/case-requests/${req.uid}`);
  assert.doesNotMatch(founderRead.text, /KYC-REF-0042/, "the partner's reference is not the founder's to read");
});

// Mutation checked: the pack_sha256 = bound_sha256 check in answerRequest removed (equivalent: approvePack refuses the
// same pack_changed); that and approvePack's own hash check removed together (fails: filing_moved, not pack_changed);
// the bound-hash comparison to the founder's sha256 removed (fails: pack_changed, not approval_hash_mismatch).
test('approving a pack whose hash changed since the request is refused; the current one sets founder_approved_at', async () => {
  const f = fixture();
  const made = await quiet(() => createFiling(f.env, 1, { kind: 'incorporation', authorityName: 'Delaware Division of Corporations', submittedByParty: 'hq', packDocumentId: 51, packSha256: SHA_A }, HQ));
  assert.equal(made.ok, true, JSON.stringify(made));
  const filingId = (made as any).filing.id;
  assert.deepEqual(await openRequest(f.env, 1, { askedOf: 'founder', kind: 'approval', title: 'Approve', boundSha256: SHA_B, filingId } as any, HQ),
    { ok: false, status: 409, error: 'pack_changed' }, 'a request bound to a hash that is not the pack');
  const req = await open(f.env, { kind: 'approval', title: 'Approve the filing pack', boundSha256: SHA_A, filingId });

  assert.equal((await quiet(() => setPack(f.env, filingId, { packDocumentId: 51, packSha256: SHA_B }, HQ))).ok, true);
  const path = `/api/formation/case-requests/${req.uid}/answer`;
  const stale = await call(f, FOUNDER, 'POST', path, { sha256: SHA_A });
  assert.deepEqual([stale.status, stale.body.error], [409, 'pack_changed']);
  assert.equal(one(f.db, 'SELECT founder_approved_at FROM formation_filings WHERE id = ?', filingId).founder_approved_at, null);
  assert.equal(one(f.db, 'SELECT state FROM formation_case_requests WHERE id = ?', req.id).state, 'open');
  assert.equal((await call(f, FOUNDER, 'POST', path, { sha256: SHA_B })).body.error, 'approval_hash_mismatch', 'the hash the request was bound to');

  const fresh = await open(f.env, { kind: 'approval', title: 'Approve the new pack', boundSha256: SHA_B, filingId });
  const okRes = await call(f, FOUNDER, 'POST', `/api/formation/case-requests/${fresh.uid}/answer`, { sha256: SHA_B });
  assert.equal(okRes.status, 200, okRes.text);
  assert.equal(okRes.body.request.state, 'accepted');
  const filing = one(f.db, 'SELECT founder_approved_at, founder_approved_sha256, founder_approval_request_id FROM formation_filings WHERE id = ?', filingId);
  assert.ok(filing.founder_approved_at);
  assert.deepEqual([filing.founder_approved_sha256, filing.founder_approval_request_id], [SHA_B, fresh.id]);
  assert.deepEqual(await openRequest(f.env, 1, { askedOf: 'founder', kind: 'document', title: 'x', boundSha256: SHA_A } as any, HQ),
    { ok: false, status: 400, error: 'bound_only_on_approval' });
});

// Mutation checked: the restore bind replaced with the case's current waiting_on (fails: not restored on the last
// close); prior_waiting_on taken from the case on every open instead of from the window's first request (fails: the
// second request's prior is founder, restored instead of nobody); the stage fallback dropped (fails: nobody, not hq).
test('waiting_on returns to its prior value when the last open request closes', async () => {
  const f = fixture();
  assert.equal(waiting(f.db), 'nobody');
  const a = await open(f.env, { kind: 'answer', title: 'Question for the founder' });
  assert.equal(waiting(f.db), 'founder');
  const b = await open(f.env, { askedOf: 'partner', askedOfUserId: PARTNER, kind: 'document', title: 'Partner letter' });
  assert.equal(waiting(f.db), 'partner', 'the newest active request');
  assert.equal((await quiet(() => answerRequest(f.env, a.id, { text: 'Two directors.' }, FOUNDER_ACTOR))).ok, true);
  assert.equal(waiting(f.db), 'partner');
  assert.equal((await quiet(() => cancelRequest(f.env, b.id, HQ))).ok, true);
  assert.equal(waiting(f.db), 'hq', 'answered: the case waits on the asker');
  assert.equal((await quiet(() => returnRequest(f.env, a.id, { reason: 'Name them, please.' }, HQ))).ok, true);
  assert.equal(waiting(f.db), 'founder', 'returned: back with the founder');
  assert.equal((await quiet(() => answerRequest(f.env, a.id, { text: 'Fay and Oz.' }, FOUNDER_ACTOR))).ok, true);
  assert.equal((await quiet(() => acceptRequest(f.env, a.id, {}, HQ))).ok, true);
  assert.equal(waiting(f.db), 'nobody', 'the last request closed: the prior value is back');

  // The last to close was opened second: it restores the window's prior, not the founder it found on opening.
  const d = await open(f.env, { kind: 'answer', title: 'First of two' });
  const e = await open(f.env, { askedOf: 'partner', askedOfUserId: PARTNER, kind: 'answer', title: 'Second of two' });
  assert.equal((await quiet(() => cancelRequest(f.env, d.id, HQ))).ok, true);
  assert.equal(waiting(f.db), 'partner');
  assert.equal((await quiet(() => cancelRequest(f.env, e.id, HQ))).ok, true);
  assert.equal(waiting(f.db), 'nobody', 'the window began at nobody');

  // The case moved stage while a request was open: the new stage's own waiting_on, not the stale prior.
  const c = await open(f.env, { kind: 'answer', title: 'One more' });
  assert.equal(waiting(f.db), 'founder');
  assert.equal((await quiet(() => transition(f.env, 1, 'ready_to_file', HQ))).ok, true);
  f.db.exec("UPDATE formation_cases SET waiting_on = 'founder' WHERE id = 1");
  assert.equal((await quiet(() => cancelRequest(f.env, c.id, HQ))).ok, true);
  assert.equal(waiting(f.db), 'hq', 'ready_to_file waits on hq');
});

// Mutation checked: the c.user_id = ? term of the founder read dropped (fails: Oz reads and answers Fay's request);
// the timeline's case ownership check removed (fails: Oz reads Fay's timeline).
test("a founder cannot read another subject's requests", async () => {
  const f = fixture();
  const req = await open(f.env, { kind: 'answer', title: "Fay's question" });
  await open(f.env, { kind: 'answer', title: "Oz's question" }, HQ, 2);

  assert.equal((await call(f, FOUNDER, 'GET', `/api/formation/case-requests/${req.uid}`)).status, 200);
  const read = await call(f, OTHER, 'GET', `/api/formation/case-requests/${req.uid}`);
  assert.deepEqual([read.status, read.body.error], [404, 'request_not_found']);
  const list = await call(f, OTHER, 'GET', '/api/formation/case-requests');
  assert.deepEqual(list.body.requests.map((r: any) => r.title), ["Oz's question"]);
  assert.deepEqual((await call(f, OTHER, 'GET', '/api/formation/case-requests?case=fc_fay')).body.requests, []);
  const answer = await call(f, OTHER, 'POST', `/api/formation/case-requests/${req.uid}/answer`, { text: 'Not mine' });
  assert.equal(answer.status, 404);
  assert.equal(one(f.db, 'SELECT state FROM formation_case_requests WHERE id = ?', req.id).state, 'open');
  assert.equal((await call(f, OTHER, 'GET', '/api/formation/case-requests/cases/fc_fay/timeline')).status, 404);
  assert.deepEqual(await answerRequest(f.env, req.id, { text: 'x' }, { party: 'founder', userId: OTHER }), { ok: false, status: 403, error: 'not_asked_of_you' });
  assert.equal((await call(f, null, 'GET', '/api/formation/case-requests')).status, 401);
});
