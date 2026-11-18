/**
 * D6694 (#6694, E9 of #6680) — a case's filings, and the registration they
 * write to the company.
 *
 * Over the full migrated schema (catalogue version 1 seeded), pinned:
 *   - submitting an incorporation filing without the founder's approval of
 *     that pack hash is refused, by the service and by the store; a new pack
 *     clears an approval;
 *   - accepting without a certificate, without a number, or without a registry
 *     date is refused (three tests), and the store refuses it too;
 *   - a v2 registration moves the case to registered, files the order with
 *     filed_on = the registry's date (the submission date stays on the
 *     filing), and writes the company's four facts: date, number, certificate,
 *     structured address; a company that already has facts keeps them;
 *   - a rejected filing keeps the case at its stage and allows a new attempt;
 *     one live filing per kind;
 *   - two acceptances from one read change the filing and the case once;
 *     filing events are append-only and filings are never deleted;
 *   - the company mapping reads the catalogue's legal_form_family, falling
 *     back to the array;
 *   - legacy: markFiled is unchanged (the D601 test runs as it was), and a
 *     logged correction adds the number later, filling only empty fields.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/formation_filings_6694.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import {
  createFiling, setPack, approvePack, markReadyToFile, submitFiling, queryFiling, answerQuery, rejectFiling, acceptFiling,
  recordLegacyRegistration, attachCaseDocument,
} from '../src/services/formationFilings.ts';
import { legalFor } from '../src/services/incorporationCompany.ts';
import { markFiled } from '../src/services/incorporationFiling.ts';

const ADMIN = 1, FOUNDER = 10, OTHER = 11;
const HQ = { party: 'hq' as const, userId: ADMIN, email: 'hq@axal.example' };
const FOUNDER_ACTOR = { party: 'founder' as const, userId: FOUNDER };
const SHA_A = 'a'.repeat(64), SHA_B = 'b'.repeat(64);
const TODAY = '2026-11-17';
const all = (db: DatabaseSync, sql: string, ...a: unknown[]) => (db.prepare(sql).all(...(a as any[])) as any[]).map((r) => ({ ...r }));
const one = (db: DatabaseSync, sql: string, ...a: unknown[]) => { const r = db.prepare(sql).get(...(a as any[])); return r ? { ...(r as any) } : r; };
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error, l = console.log; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; console.log = l; }
};

/**
 * A founder with an owner account, a venture, documents 51 (pack), 52
 * (certificate), 53 (receipt), and one case with its order:
 *   track v2 at `stage` with order `status`; `companyId` puts the venture in a company.
 */
function fixture(opts: { track?: 'v2' | 'legacy_v1'; stage?: string; status?: string; companyId?: number | null; jurisdiction?: string } = {}) {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(ADMIN, 'admin', 'Hq Admin', 'hq@axal.example', null);
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Oz Other', 'oz@example.test', 2002);
  const companyId = opts.companyId ?? null;
  db.exec(`INSERT INTO projects (id, name, founder_id, slug) VALUES (1, 'Acme', 1001, 'acme');
    INSERT INTO documents (id, project_id, title, doc_type, status, content) VALUES
      (51, 1, 'Filing pack', 'other', 'generated', NULL),
      (52, 1, 'Certificate of incorporation', 'other', 'generated', '{"r2_key":"synthetic/cert-52","content_type":"application/pdf"}'),
      (53, 1, 'Registry receipt', 'other', 'generated', NULL);`);
  if (companyId != null) {
    db.exec(`INSERT INTO company_profiles (id, uid, company_name, legal_name, incorporation_date) VALUES (${companyId}, 'co-${companyId}', 'Acme Inc', 'Acme Holdings Inc', '2020-01-02');
      UPDATE projects SET company_id = ${companyId} WHERE id = 1;`);
  }
  const track = opts.track ?? 'v2', stage = opts.stage ?? 'preparing', status = opts.status ?? 'packet_processing';
  db.prepare(`INSERT INTO incorporations (id, user_id, project_id, jurisdiction_id, company_name, registered_agent_name, registered_agent_address,
      amount_cents, status, paid_at) VALUES (7, ?, 1, ?, 'Acme Inc', 'Agent Co', '1 Agent Way', 50000, ?, '2026-10-01 09:00:00')`)
    .run(FOUNDER, opts.jurisdiction ?? 'us_de_ccorp', status);
  db.prepare(`INSERT INTO formation_cases (id, uid, user_id, intent, project_id, company_id, track, stage, waiting_on, revision)
      VALUES (1, 'fc_one', ?, 'convert_project', 1, ?, ?, ?, 'hq', 0)`).run(FOUNDER, companyId, track, stage);
  db.exec('INSERT INTO formation_case_orders (case_id, incorporation_id) VALUES (1, 7);');
  const env: any = { DB: d1Over(db) };
  return { db, env };
}

/** A prepared incorporation filing with pack A, approved by the founder unless `approve` is false. */
async function prepared(env: any, approve = true) {
  const made = await createFiling(env, 1, { kind: 'incorporation', authorityName: 'Delaware Division of Corporations', submittedByParty: 'hq', packDocumentId: 51, packSha256: SHA_A }, HQ);
  assert.equal(made.ok, true, JSON.stringify(made));
  const id = (made as any).filing.id;
  if (approve) assert.equal((await approvePack(env, id, { packSha256: SHA_A }, FOUNDER_ACTOR)).ok, true);
  return id as number;
}

/** A v2 case at submitted, its incorporation filing submitted on 2026-11-02. */
async function submitted(env: any) {
  const id = await prepared(env);
  assert.equal((await quiet(() => markReadyToFile(env, id, HQ))).ok, true);
  const s = await quiet(() => submitFiling(env, id, { submittedOn: '2026-11-02', reference: 'SR-1', evidenceDocumentId: 53 }, HQ, TODAY));
  assert.equal(s.ok, true, JSON.stringify(s));
  return id;
}

const ACCEPT = { decidedOn: '2026-11-10', registrationNumber: 'DE-7781234', certificateDocumentId: 52,
  address: { line1: '251 Little Falls Drive', city: 'Wilmington', region: 'DE', postal_code: '19808', country: 'US' } };

// Mutation checked: the approval test dropped from submitFiling (fails: submitted without approval); the approval kept
// across a new pack (fails: submitted with a stale approval); the store's approval CHECK removed (fails: the raw UPDATE goes through).
test('submitting without the founder approving that pack hash is refused; a new pack clears the approval', async () => {
  const { db, env } = fixture();
  const id = await prepared(env, false);
  assert.equal((await quiet(() => markReadyToFile(env, id, HQ))).ok, true);
  assert.deepEqual(await submitFiling(env, id, { submittedOn: '2026-11-02' }, HQ, TODAY), { ok: false, status: 409, error: 'founder_approval_required' });

  assert.deepEqual(await approvePack(env, id, { packSha256: SHA_B }, FOUNDER_ACTOR), { ok: false, status: 409, error: 'pack_changed' }, 'an approval of another hash');
  assert.deepEqual(await approvePack(env, id, { packSha256: SHA_A }, HQ), { ok: false, status: 403, error: 'founder_only' });
  assert.deepEqual(await approvePack(env, id, { packSha256: SHA_A }, { party: 'founder', userId: OTHER }), { ok: false, status: 403, error: 'founder_only' }, 'another founder');
  assert.equal((await approvePack(env, id, { packSha256: SHA_A }, FOUNDER_ACTOR)).ok, true);

  // A new pack clears it: the founder approved pack A, not pack B.
  assert.equal((await setPack(env, id, { packDocumentId: 51, packSha256: SHA_B }, HQ)).ok, true);
  assert.equal(one(db, 'SELECT founder_approved_at FROM formation_filings WHERE id = ?', id).founder_approved_at, null);
  assert.deepEqual(await submitFiling(env, id, { submittedOn: '2026-11-02' }, HQ, TODAY), { ok: false, status: 409, error: 'founder_approval_required' });

  // The store holds the rule too: a raw write cannot submit an unapproved incorporation filing.
  assert.throws(() => db.prepare("UPDATE formation_filings SET state = 'submitted' WHERE id = ?").run(id), /CHECK/);

  assert.equal((await approvePack(env, id, { packSha256: SHA_B }, FOUNDER_ACTOR)).ok, true);
  const s = await quiet(() => submitFiling(env, id, { submittedOn: '2026-11-02', evidenceDocumentId: 53 }, HQ, TODAY));
  assert.equal(s.ok, true);
  assert.equal((s as any).case.stage, 'submitted', 'the v2 case moves with its incorporation filing');
  assert.deepEqual(one(db, 'SELECT state, submitted_on, founder_approved_sha256 FROM formation_filings WHERE id = ?', id),
    { state: 'submitted', submitted_on: '2026-11-02', founder_approved_sha256: SHA_B });
  assert.deepEqual(one(db, 'SELECT stage FROM formation_cases WHERE id = 1'), { stage: 'submitted' });
  assert.deepEqual(all(db, 'SELECT from_state, to_state, to_revision FROM formation_filing_events WHERE filing_id = ? ORDER BY id', id).map((e) => `${e.from_state}>${e.to_state}@${e.to_revision}`),
    ['null>prepared@0', 'prepared>prepared@1', 'prepared>prepared@2', 'prepared>prepared@3', 'prepared>submitted@4']);
  assert.deepEqual(all(db, 'SELECT document_id, class FROM formation_case_documents WHERE case_id = 1 ORDER BY id'),
    [{ document_id: 51, class: 'filing_pack' }, { document_id: 53, class: 'registry_receipt' }]);
});

// Mutation checked, one per refusal: each check dropped from acceptanceFacts (each test fails on its own), and the
// store's acceptance CHECK removed (the raw UPDATE goes through).
test('accepting without a certificate is refused', async () => {
  const { db, env } = fixture();
  const id = await submitted(env);
  assert.deepEqual(await acceptFiling(env, id, { ...ACCEPT, certificateDocumentId: undefined }, HQ, TODAY), { ok: false, status: 400, error: 'certificate_required' });
  assert.deepEqual(await acceptFiling(env, id, { ...ACCEPT, certificateDocumentId: 999 }, HQ, TODAY), { ok: false, status: 400, error: 'certificate_document_not_found' });
  assert.throws(() => db.prepare("UPDATE formation_filings SET state = 'accepted', registration_number = 'X', decided_on = '2026-11-10' WHERE id = ?").run(id), /CHECK/);
  assert.equal(one(db, 'SELECT state FROM formation_filings WHERE id = ?', id).state, 'submitted');
});

test('accepting without a registration number is refused', async () => {
  const { db, env } = fixture();
  const id = await submitted(env);
  assert.deepEqual(await acceptFiling(env, id, { ...ACCEPT, registrationNumber: '   ' }, HQ, TODAY), { ok: false, status: 400, error: 'registration_number_required' });
  assert.throws(() => db.prepare("UPDATE formation_filings SET state = 'accepted', certificate_document_id = 52, decided_on = '2026-11-10' WHERE id = ?").run(id), /CHECK/);
  assert.equal(one(db, 'SELECT stage FROM formation_cases WHERE id = 1').stage, 'submitted');
});

test('accepting without the registry date is refused', async () => {
  const { db, env } = fixture();
  const id = await submitted(env);
  assert.deepEqual(await acceptFiling(env, id, { ...ACCEPT, decidedOn: undefined }, HQ, TODAY), { ok: false, status: 400, error: 'registry_date_invalid' });
  assert.deepEqual(await acceptFiling(env, id, { ...ACCEPT, decidedOn: '2026-11-30' }, HQ, TODAY), { ok: false, status: 400, error: 'registry_date_future' });
  assert.deepEqual(await acceptFiling(env, id, { ...ACCEPT, decidedOn: '2026-11-01' }, HQ, TODAY), { ok: false, status: 400, error: 'registry_date_before_submission' });
  assert.throws(() => db.prepare("UPDATE formation_filings SET state = 'accepted', certificate_document_id = 52, registration_number = 'X' WHERE id = ?").run(id), /CHECK/);
});

// Mutation checked: filed_on bound to the submission date (fails); the registration number not written (fails); the
// certificate not copied (fails); the structured address dropped for the agent line (fails); the COALESCE on
// legal_name or incorporation_date dropped (fails: the existing company's facts change).
test('a v2 registration files the order on the registry date and writes the four company facts', async () => {
  const { db, env } = fixture();
  const id = await submitted(env);
  const r = await quiet(() => acceptFiling(env, id, ACCEPT, HQ, TODAY));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal((r as any).case.stage, 'registered');
  assert.equal((r as any).company.created, true);
  assert.deepEqual(one(db, 'SELECT state, submitted_on, decided_on, registration_number, certificate_document_id FROM formation_filings WHERE id = ?', id),
    { state: 'accepted', submitted_on: '2026-11-02', decided_on: '2026-11-10', registration_number: 'DE-7781234', certificate_document_id: 52 });
  const order = one(db, 'SELECT status, filed_on, filed_by, company_id, packet_document_id, packet_ready_at IS NOT NULL AS ready FROM incorporations WHERE id = 7');
  assert.deepEqual({ ...order, company_id: undefined }, { status: 'filed', filed_on: '2026-11-10', filed_by: ADMIN, company_id: undefined, packet_document_id: 51, ready: 1 },
    'filed_on is the registry date; ready_to_file stamped packet_ready_at with the pack');
  assert.ok(order.company_id);
  const co = one(db, 'SELECT legal_name, legal_form, jurisdiction, incorporation_date, registration_number FROM company_profiles WHERE id = ?', order.company_id);
  assert.deepEqual(co, { legal_name: 'Acme Inc', legal_form: 'c_corp', jurisdiction: 'US-DE', incorporation_date: '2026-11-10', registration_number: 'DE-7781234' });
  assert.deepEqual(all(db, "SELECT title, doc_type, project_id, content FROM documents WHERE company_id = ?", order.company_id),
    [{ title: 'Certificate of incorporation', doc_type: 'certificate_of_incorporation', project_id: null, content: '{"r2_key":"synthetic/cert-52","content_type":"application/pdf"}' }]);
  assert.deepEqual(one(db, "SELECT line1, line2, city, region, postal_code, country FROM company_locations WHERE company_id = ? AND kind = 'registered'", order.company_id),
    { line1: '251 Little Falls Drive', line2: null, city: 'Wilmington', region: 'DE', postal_code: '19808', country: 'US' });
  assert.deepEqual(one(db, 'SELECT stage FROM formation_cases WHERE id = 1'), { stage: 'registered' });
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM formation_case_documents WHERE case_id = 1 AND class = 'certificate'").n, 1);
});

test('a company that already has facts keeps them: only empty fields are filled', async () => {
  const { db, env } = fixture({ companyId: 40 });
  db.exec(`UPDATE company_profiles SET registration_number = 'OLD-1' WHERE id = 40;
    INSERT INTO documents (project_id, company_id, title, doc_type, status) VALUES (NULL, 40, 'Earlier certificate', 'certificate_of_incorporation', 'signed');
    INSERT INTO company_locations (uid, company_id, kind, line1, country, created_by) VALUES ('loc-1', 40, 'registered', '9 Old Road', 'US', ${ADMIN});`);
  const id = await submitted(env);
  const r = await quiet(() => acceptFiling(env, id, ACCEPT, HQ, TODAY));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual((r as any).company, { uid: 'co-40', created: false, filled: ['legal_form', 'jurisdiction', 'registered_agent_name'] });
  assert.deepEqual(one(db, 'SELECT legal_name, incorporation_date, registration_number, legal_form, jurisdiction FROM company_profiles WHERE id = 40'),
    { legal_name: 'Acme Holdings Inc', incorporation_date: '2020-01-02', registration_number: 'OLD-1', legal_form: 'c_corp', jurisdiction: 'US-DE' });
  assert.deepEqual(all(db, "SELECT title FROM documents WHERE company_id = 40 AND doc_type = 'certificate_of_incorporation'"), [{ title: 'Earlier certificate' }]);
  assert.deepEqual(all(db, "SELECT line1 FROM company_locations WHERE company_id = 40 AND kind = 'registered'"), [{ line1: '9 Old Road' }]);
  assert.equal(one(db, 'SELECT company_id FROM incorporations WHERE id = 7').company_id, 40);
});

// Mutation checked: rejectFiling moving the case (fails: the stage changes). Dropping createFiling's live-filing check is
// equivalent: the store's live-filing index refuses the insert and the service answers filing_live all the same.
test('a rejected filing keeps the case at its stage and allows a new attempt; one live filing per kind', async () => {
  const { db, env } = fixture();
  const first = await submitted(env);
  assert.deepEqual(await createFiling(env, 1, { kind: 'incorporation' }, HQ), { ok: false, status: 409, error: 'filing_live' });
  assert.deepEqual(await rejectFiling(env, first, { decidedOn: '2026-11-05', reason: '' }, HQ, TODAY), { ok: false, status: 400, error: 'rejection_reason_required' });
  const rej = await rejectFiling(env, first, { decidedOn: '2026-11-05', reason: 'Name not available', evidenceDocumentId: 53 }, HQ, TODAY);
  assert.equal(rej.ok, true);
  assert.equal(one(db, 'SELECT stage FROM formation_cases WHERE id = 1').stage, 'submitted', 'the case stays where it was');

  const again = await createFiling(env, 1, { kind: 'incorporation', packDocumentId: 51, packSha256: SHA_B }, HQ);
  assert.equal(again.ok, true);
  const second = (again as any).filing;
  assert.deepEqual({ attempt: second.attempt, state: second.state }, { attempt: 2, state: 'prepared' });
  assert.equal(one(db, 'SELECT supersedes_filing_id FROM formation_filings WHERE id = ?', second.id).supersedes_filing_id, first);
  assert.equal((await approvePack(env, second.id, { packSha256: SHA_B }, FOUNDER_ACTOR)).ok, true);
  // The case is already at submitted: the second attempt's submission moves only the filing.
  const s = await submitFiling(env, second.id, { submittedOn: '2026-11-06' }, HQ, TODAY);
  assert.equal(s.ok, true);
  assert.equal((s as any).case, undefined);
  assert.deepEqual(all(db, 'SELECT attempt, state FROM formation_filings WHERE case_id = 1 ORDER BY attempt'),
    [{ attempt: 1, state: 'rejected' }, { attempt: 2, state: 'submitted' }]);
  const done = await quiet(() => acceptFiling(env, second.id, ACCEPT, HQ, TODAY));
  assert.equal(done.ok, true);
  assert.equal(one(db, 'SELECT stage FROM formation_cases WHERE id = 1').stage, 'registered');
});

test('a registry query moves the v2 case to registry_query and back', async () => {
  const { db, env } = fixture();
  const id = await submitted(env);
  assert.equal((await queryFiling(env, id, { occurredOn: '2026-11-04', note: 'Officer address' }, HQ, TODAY)).ok, true);
  assert.equal(one(db, 'SELECT stage FROM formation_cases WHERE id = 1').stage, 'registry_query');
  assert.equal((await answerQuery(env, id, { occurredOn: '2026-11-05' }, HQ, TODAY)).ok, true);
  assert.equal(one(db, 'SELECT stage FROM formation_cases WHERE id = 1').stage, 'submitted');
  assert.equal(one(db, 'SELECT state FROM formation_filings WHERE id = ?', id).state, 'submitted');
});

// Mutation checked: the event's as-read guard dropped (fails: two events for one change); filingAsRead not passed to
// the transition (fails: the case moves on a filing another call already accepted).
test('two acceptances from one read change the filing and the case once; events are append-only, filings kept', async () => {
  const { db, env } = fixture();
  const id = await submitted(env);
  const [a, b] = await quiet(() => Promise.all([acceptFiling(env, id, ACCEPT, HQ, TODAY), acceptFiling(env, id, ACCEPT, HQ, TODAY)]));
  assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
  assert.equal(((a.ok ? b : a) as any).status, 409);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM formation_filing_events WHERE filing_id = ? AND to_state = 'accepted'", id).n, 1);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM formation_case_events WHERE case_id = 1 AND to_stage = 'registered'").n, 1);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM company_profiles').n, 1, 'one company');
  assert.throws(() => db.prepare('UPDATE formation_filing_events SET to_state = ? WHERE filing_id = ?').run('rejected', id), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM formation_filing_events WHERE filing_id = ?').run(id), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM formation_filings WHERE id = ?').run(id), /kept/);
});

test('a filing changed between the read and the case move moves nothing', async () => {
  const { db, env } = fixture();
  const id = await submitted(env);
  // A writer that rejects the filing just before the acceptance batch runs.
  const inner = env.DB;
  let fired = false;
  const racing: any = {
    prepare: (sql: string) => inner.prepare(sql),
    batch: async (stmts: any[]) => {
      if (!fired) { fired = true; db.prepare("UPDATE formation_filings SET state = 'rejected', decided_on = '2026-11-09', revision = revision + 1 WHERE id = ?").run(id); }
      return inner.batch(stmts);
    },
  };
  const r = await quiet(() => acceptFiling({ DB: racing } as any, id, ACCEPT, HQ, TODAY));
  assert.equal(r.ok, false);
  assert.equal(one(db, 'SELECT stage FROM formation_cases WHERE id = 1').stage, 'submitted', 'the case did not move');
  assert.equal(one(db, 'SELECT status, company_id FROM incorporations WHERE id = 7').status, 'packet_ready', 'the order was not filed');
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM company_profiles').n, 0, 'no company');
});

// Mutation checked: legalFor ignoring the catalogue (fails: the edited family is not read); the fallback dropped (fails
// with no current version).
test('the company mapping reads the catalogue legal_form_family, with the array as fallback', async () => {
  const { db, env } = fixture();
  assert.deepEqual(await legalFor(env, 'us_de_llc'), { jurisdiction: 'US-DE', legal_form: 'llc' }, 'version 1 holds the array');
  // A version 2 beside the seed, as #6693's test builds one: a published version is never edited (D6689).
  // Its Delaware LLC names another family; its UK form names none; Wyoming is not in it.
  db.exec(`UPDATE formation_catalogue_versions SET is_current = 0 WHERE is_current = 1;
    INSERT INTO formation_catalogue_versions (id, version, status, is_current) VALUES (9001, 2, 'draft', 0);
    INSERT INTO formation_jurisdictions (id, version_id, country, subdivision) VALUES (9011, 9001, 'US', 'DE'), (9012, 9001, 'GB', NULL);
    INSERT INTO formation_entity_forms (id, version_id, jurisdiction_id, form_key, label, offer_mode, legal_form_family, legacy_gate) VALUES
      (9021, 9001, 9011, 'us_de_llc', 'Delaware LLC', 'orderable', 'series_llc', '1'),
      (9022, 9001, 9012, 'uk_ltd', 'UK Ltd', 'orderable', NULL, '1');
    UPDATE formation_catalogue_versions SET status = 'published', is_current = 1, published_by = ${ADMIN}, published_at = '2026-11-17T00:00:00Z' WHERE id = 9001;`);
  assert.deepEqual(await legalFor(env, 'us_de_llc'), { jurisdiction: 'US-DE', legal_form: 'series_llc' }, 'the catalogue is read');
  assert.deepEqual(await legalFor(env, 'uk_ltd'), { jurisdiction: 'GB', legal_form: 'ltd' }, 'a form with no family falls back to the array');
  assert.deepEqual(await legalFor(env, 'us_wy_ccorp'), { jurisdiction: 'US-WY', legal_form: 'c_corp' }, 'a form the version lacks falls back');
  db.exec('UPDATE formation_catalogue_versions SET is_current = 0');
  assert.deepEqual(await legalFor(env, 'us_de_llc'), { jurisdiction: 'US-DE', legal_form: 'llc' }, 'no current version: the array');
  assert.deepEqual(await legalFor(env, 'nowhere'), { jurisdiction: null, legal_form: null });
});

test('legacy: markFiled is unchanged, and a logged correction adds the number later, filling only empty fields', async () => {
  const { db, env } = fixture({ track: 'legacy_v1', stage: 'ready_to_file', status: 'packet_ready' });
  const filed = await quiet(() => markFiled(env, 7, '2026-11-03', ADMIN, TODAY, 'hq@axal.example'));
  assert.equal(filed.ok, true, JSON.stringify(filed));
  const co = one(db, 'SELECT company_id, filed_on FROM incorporations WHERE id = 7');
  assert.equal(co.filed_on, '2026-11-03');
  assert.deepEqual(one(db, 'SELECT incorporation_date, registration_number FROM company_profiles WHERE id = ?', co.company_id),
    { incorporation_date: '2026-11-03', registration_number: null }, 'D601: the submission date, no number');
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM formation_filings').n, 0, 'markFiled writes no filing');

  // The legacy incorporation filing cannot go through acceptFiling's v2 path.
  assert.deepEqual(await recordLegacyRegistration(env, 1, ACCEPT, FOUNDER_ACTOR, TODAY), { ok: false, status: 403, error: 'hq_only' });
  assert.deepEqual(await recordLegacyRegistration(env, 1, { ...ACCEPT, registrationNumber: '' }, HQ, TODAY), { ok: false, status: 400, error: 'registration_number_required' });
  const r = await quiet(() => recordLegacyRegistration(env, 1, ACCEPT, HQ, TODAY));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(one(db, 'SELECT state, recorded_after_the_fact, submitted_on, decided_on, registration_number FROM formation_filings WHERE id = ?', (r as any).filing.id),
    { state: 'accepted', recorded_after_the_fact: 1, submitted_on: '2026-11-03', decided_on: '2026-11-10', registration_number: 'DE-7781234' });
  assert.deepEqual(one(db, 'SELECT incorporation_date, registration_number FROM company_profiles WHERE id = ?', co.company_id),
    { incorporation_date: '2026-11-03', registration_number: 'DE-7781234' }, 'the number is added; the date written at filing stays');
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM documents WHERE company_id = ? AND doc_type = 'certificate_of_incorporation'", co.company_id).n, 1);
  assert.deepEqual(one(db, 'SELECT stage FROM formation_cases WHERE id = 1'), { stage: 'registered' }, 'the case does not move');
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'formation_legacy_registration'").n, 1, 'logged');
  assert.deepEqual(await recordLegacyRegistration(env, 1, ACCEPT, HQ, TODAY), { ok: false, status: 409, error: 'filing_live' }, 'once');
});

test('a case document is recorded once, by class and visibility', async () => {
  const { db, env } = fixture();
  assert.deepEqual(await attachCaseDocument(env, 1, { documentId: 53, class: 'evidence', visibleTo: 'everyone' }, HQ), { ok: false, status: 400, error: 'visible_to_invalid' });
  assert.deepEqual(await attachCaseDocument(env, 1, { documentId: 999, class: 'evidence' }, HQ), { ok: false, status: 400, error: 'document_not_found' });
  assert.deepEqual(await attachCaseDocument(env, 1, { documentId: 53, class: 'evidence', visibleTo: 'hq_partner' }, HQ), { ok: true });
  assert.deepEqual(await attachCaseDocument(env, 1, { documentId: 53, class: 'evidence', visibleTo: 'hq_partner' }, HQ), { ok: true });
  assert.deepEqual(all(db, 'SELECT document_id, class, visible_to FROM formation_case_documents WHERE case_id = 1'), [{ document_id: 53, class: 'evidence', visible_to: 'hq_partner' }]);
});
