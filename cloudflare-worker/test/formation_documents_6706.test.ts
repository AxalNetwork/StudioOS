/**
 * D6706 (#6706, E14 of #6680) — a formation case's documents, signing, and
 * the consent-to-act gate on filing. Over the full migrated schema (catalogue
 * version 1 seeded), pinned (the issue's "Done when"):
 *   - a GB (non-legacy) form's case generates only the templates whose counsel
 *     review names GB; the others are `pending_counsel`; a token the case does
 *     not hold is `pending_fields`, never a placeholder; a second run reuses;
 *   - submitting (and reaching ready_to_file) with one appointee not
 *     consented is refused, by the service and by the store's trigger; an
 *     uploaded consent opens it;
 *   - a pack changed after the founder's approval is refused at submission,
 *     and the pack set through the documents service asks the founder again,
 *     bound to the new hash;
 *   - a signed envelope's document appears on the case with its SHA-256, by
 *     the owed esign effect, which waits until the envelope completes; a
 *     consent envelope sets consent_to_act_at, unless the person changed;
 *   - the six legacy forms generate the same documents as the wizard
 *     (routes/legal.ts POST /incorporate/wizard) — the parity test.
 *
 * Synthetic template bodies only: they test the filling, they are not legal text.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/formation_documents_6706.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import {
  generateCaseDocuments, sendForSignature, recordConsentUpload, setPackForApproval, readDocCase, percent,
} from '../src/services/formationDocuments.ts';
import { createFiling, approvePack, markReadyToFile, submitFiling, setPack } from '../src/services/formationFilings.ts';
import { answerRequest } from '../src/services/formationRequests.ts';
import { runEnvelopeEffects, sweepEffects } from '../src/services/esignEffects.ts';
import router from '../src/routes/formation_case_documents.ts';
import legal from '../src/routes/legal.ts';

const ADMIN = 1, FOUNDER = 10, OTHER = 11;
const HQ = { party: 'hq' as const, userId: ADMIN, email: 'hq@axal.example' };
const FOUNDER_ACTOR = { party: 'founder' as const, userId: FOUNDER };
const SHA_A = 'a'.repeat(64), SHA_B = 'b'.repeat(64), SHA_FILE = 'f'.repeat(64);
const TODAY = '2026-11-20';
const APP = 'https://axal.example';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const all = (db: DatabaseSync, sql: string, ...a: unknown[]) => (db.prepare(sql).all(...(a as any[])) as any[]).map((r) => ({ ...r }));
const one = (db: DatabaseSync, sql: string, ...a: unknown[]) => { const r = db.prepare(sql).get(...(a as any[])); return r ? { ...(r as any) } : r; };
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error, l = console.log; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; console.log = l; }
};

// Synthetic bodies: tokens and filler, no clause.
const ARTICLES = 'ARTICLES-FIXTURE {{company_name}} | {{form.label}} | {{country.code}} | {{people.director}} | {{ownership.summary}} | {{registered_office.address}}';
const RESOLUTION = 'RESOLUTION-FIXTURE {{company_name}}';
const CAPITAL = 'CAPITAL-FIXTURE {{capital.amount}} / {{capital.share_count}}';
const CONSENT = 'CONSENT-FIXTURE {{person.name}} ({{person.roles}}) for {{company_name}}';

function template(db: DatabaseSync, slug: string, body: string) {
  db.prepare(`INSERT INTO legal_templates (slug, title, category, body_md, is_active, is_stub) VALUES (?, ?, 'formation', ?, 1, 0)
    ON CONFLICT(slug) DO UPDATE SET body_md = excluded.body_md, is_active = 1, is_stub = 0`).run(slug, slug, body);
}
function review(db: DatabaseSync, slug: string, body: string, jurisdiction: string) {
  db.prepare(`INSERT INTO legal_reviews (object_kind, object_ref, version, version_sha256, review_type, jurisdiction, reviewer_id, requested_by, decision, decided_by, decided_at)
    VALUES ('template', ?, 1, ?, 'initial', ?, ?, ?, 'approved', ?, '2026-11-02T00:00:00Z')`).run(slug, sha(body), jurisdiction, ADMIN, ADMIN, ADMIN);
}

/**
 * A founder, a venture, documents 51 (pack) and 52 (an uploaded consent), and
 * one v2 case at preparing on a non-legacy GB form (catalogue version 900)
 * with its order. People: Dana (director, 60%) and Sam (shareholder, 40%)
 * unless `appointee` is false (then Sam alone, 100%).
 */
function fixture(opts: { appointee?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(ADMIN, 'admin', 'Hq Admin', 'hq@axal.example', null);
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Oz Other', 'oz@example.test', 2002);
  db.exec(`INSERT INTO projects (id, name, founder_id, slug) VALUES (1, 'Acme', 1001, 'acme');
    INSERT INTO documents (id, project_id, title, doc_type, status, content) VALUES
      (51, 1, 'Filing pack', 'other', 'generated', NULL),
      (52, 1, 'Signed consent', 'other', 'generated', '{"r2_key":"synthetic/consent-52","content_type":"application/pdf","sha256":"${'c'.repeat(64)}"}');
    INSERT INTO formation_catalogue_versions (id, version) VALUES (900, 900);
    INSERT INTO formation_jurisdictions (id, version_id, country, registry_name) VALUES (900, 900, 'GB', 'Companies House');
    INSERT INTO formation_entity_forms (id, version_id, jurisdiction_id, form_key, label, legal_form_family) VALUES (900, 900, 900, 'gb_private_v2', 'Private company limited by shares', 'ltd');
    INSERT INTO formation_pack_items (version_id, form_id, item_key, phase, kind, acting_party, title, template_key, counsel_required, position) VALUES
      (900, 900, 'articles', 'before_filing', 'document', 'axal', 'Articles', 'gb_fixture_articles', 1, 0),
      (900, 900, 'resolution', 'before_filing', 'document', 'axal', 'First resolution', 'gb_fixture_resolution', 1, 1),
      (900, 900, 'capital', 'before_filing', 'document', 'axal', 'Statement of capital', 'gb_fixture_capital', 1, 2),
      (900, 900, 'consent_to_act', 'before_filing', 'document', 'founder', 'Consent to act', 'gb_fixture_consent', 1, 3),
      (900, 900, 'next_step_1', 'after_filing', 'step', 'founder', 'A step', NULL, 0, 100);`);
  template(db, 'gb_fixture_articles', ARTICLES); review(db, 'gb_fixture_articles', ARTICLES, 'GB');
  template(db, 'gb_fixture_resolution', RESOLUTION); review(db, 'gb_fixture_resolution', RESOLUTION, 'US-DE');
  template(db, 'gb_fixture_capital', CAPITAL); review(db, 'gb_fixture_capital', CAPITAL, 'GB');
  template(db, 'gb_fixture_consent', CONSENT); review(db, 'gb_fixture_consent', CONSENT, 'gb');
  db.prepare(`INSERT INTO incorporations (id, user_id, project_id, jurisdiction_id, company_name, registered_agent_name, registered_agent_address,
      amount_cents, status, paid_at) VALUES (7, ?, 1, 'gb_private_v2', 'Acme Ltd', 'Office Co', '1 Office Row, London', 5000, 'packet_processing', '2026-10-01 09:00:00')`).run(FOUNDER);
  db.prepare(`INSERT INTO formation_cases (id, uid, user_id, intent, project_id, track, stage, waiting_on, revision, form_key, catalogue_version_id)
      VALUES (1, 'fc_doc', ?, 'convert_project', 1, 'v2', 'preparing', 'hq', 0, 'gb_private_v2', 900)`).run(FOUNDER);
  db.exec('INSERT INTO formation_case_orders (case_id, incorporation_id) VALUES (1, 7);');
  if (opts.appointee !== false) {
    db.exec(`INSERT INTO formation_case_people (id, uid, case_id, name, ownership_bps, is_entity, notice_email) VALUES
        (101, 'p_dana', 1, 'Dana Director', 6000, 0, 'dana@example.test'), (102, 'p_sam', 1, 'Sam Shareholder', 4000, 0, NULL);
      INSERT INTO formation_case_person_roles (person_id, role) VALUES (101, 'director'), (102, 'shareholder');`);
  } else {
    db.exec(`INSERT INTO formation_case_people (id, uid, case_id, name, ownership_bps, is_entity) VALUES (102, 'p_sam', 1, 'Sam Shareholder', 10000, 0);
      INSERT INTO formation_case_person_roles (person_id, role) VALUES (102, 'shareholder');`);
  }
  // Offline, non-matching sanctions lists, as formationScreeningFixture gives a stage move.
  const TOKENS = { get: async (key: string) => [{ source: key.split(':').at(-1), name: 'unrelated listed entity', aliases: [], ref: 'test-list', dob: null, nationality: null }] };
  const env: any = { DB: d1Over(db), JWT_SECRET: randomUUID(), TOKENS };
  return { db, env };
}

// Mutation checked: the country review check dropped (fails: the US-DE resolution is generated); the unfilled-token check
// dropped (fails: the capital statement is written with its tokens); the reuse lookup dropped (fails: the rerun lists none reused).
test('a GB form generates only the templates counsel reviewed for GB; a missing value is pending_fields; a rerun reuses', async () => {
  const { db, env } = fixture();
  const r = await generateCaseDocuments(env, 1, HQ, { today: TODAY });
  assert.equal(r.ok, true, JSON.stringify(r));
  const set = r as any;
  assert.deepEqual(set.documents.map((d: any) => [d.template_key, d.person_uid]), [['gb_fixture_articles', null], ['gb_fixture_consent', 'p_dana']]);
  assert.deepEqual(set.pending_counsel, [{ template_key: 'gb_fixture_resolution', title: 'First resolution', reason: 'not_reviewed_for_country', country: 'GB' }]);
  assert.deepEqual(set.pending_fields, [{ template_key: 'gb_fixture_capital', title: 'Statement of capital', person_uid: null, fields: ['capital.amount', 'capital.share_count'] }]);
  const articles = one(db, `SELECT d.content, d.status, d.template_name, cd.sha256, cd.visible_to, cd.origin FROM formation_case_documents cd
    JOIN documents d ON d.id = cd.document_id WHERE cd.template_key = 'gb_fixture_articles'`);
  assert.equal(articles.content, 'ARTICLES-FIXTURE Acme Ltd | Private company limited by shares | GB | Dana Director | Dana Director 60%, Sam Shareholder 40% | 1 Office Row, London');
  assert.deepEqual([articles.sha256, articles.visible_to, articles.origin, articles.status], [sha(articles.content), 'all', 'generated', 'generated']);
  assert.equal(one(db, "SELECT d.content FROM formation_case_documents cd JOIN documents d ON d.id = cd.document_id WHERE cd.template_key = 'gb_fixture_consent'").content,
    'CONSENT-FIXTURE Dana Director (director) for Acme Ltd');
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM formation_case_events WHERE case_id = 1 AND kind = 'documents_generated'").n, 1);

  // The case now holds its capital: the statement is generated; the others are reused, not rewritten.
  db.exec("INSERT INTO formation_case_capital (case_id, amount_minor, currency, share_count) VALUES (1, 10000, 'GBP', 100)");
  const before = one(db, 'SELECT COUNT(*) AS n FROM documents').n;
  const again = await generateCaseDocuments(env, 1, HQ, { today: TODAY }) as any;
  assert.deepEqual(again.documents.map((d: any) => [d.template_key, d.reused]),
    [['gb_fixture_articles', true], ['gb_fixture_capital', false], ['gb_fixture_consent', true]]);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM documents').n, before + 1);
  assert.equal(one(db, "SELECT d.content FROM formation_case_documents cd JOIN documents d ON d.id = cd.document_id WHERE cd.template_key = 'gb_fixture_capital'").content,
    'CAPITAL-FIXTURE £100.00 / 100');
  assert.deepEqual(await generateCaseDocuments(env, 1, FOUNDER_ACTOR, { today: TODAY }), { ok: false, status: 403, error: 'party_cannot_generate' });
  assert.equal(percent(3333), '33.33%');
});

// Mutation checked: the consent check dropped from filingReadiness (fails: markReadyToFile goes through with Dana unconsented).
test('submitting, or reaching ready_to_file, with one appointee not consented is refused; an uploaded consent opens it', async () => {
  const { db, env } = fixture();
  const made = await createFiling(env, 1, { kind: 'incorporation', submittedByParty: 'hq', packDocumentId: 51, packSha256: SHA_A }, HQ);
  assert.equal(made.ok, true, JSON.stringify(made));
  const id = (made as any).filing.id;
  assert.equal((await approvePack(env, id, { packSha256: SHA_A }, FOUNDER_ACTOR)).ok, true);
  assert.deepEqual(await markReadyToFile(env, id, HQ), { ok: false, status: 409, error: 'consent_to_act_required' });
  db.exec("UPDATE formation_cases SET stage = 'ready_to_file' WHERE id = 1");
  assert.deepEqual(await submitFiling(env, id, { submittedOn: '2026-11-18' }, HQ, TODAY), { ok: false, status: 409, error: 'consent_to_act_required' });
  assert.throws(() => db.prepare("UPDATE formation_filings SET state = 'submitted' WHERE id = ?").run(id), /formation_consent_to_act_missing/, 'the store refuses too');
  db.exec("UPDATE formation_cases SET stage = 'preparing' WHERE id = 1");

  assert.deepEqual(await recordConsentUpload(env, 1, 101, { documentId: 52 }, FOUNDER_ACTOR), { ok: false, status: 403, error: 'party_cannot_record_consent' });
  assert.deepEqual(await recordConsentUpload(env, 1, 102, { documentId: 52 }, HQ), { ok: false, status: 409, error: 'not_an_appointee' });
  assert.equal((await recordConsentUpload(env, 1, 101, { documentId: 52 }, HQ)).ok, true);
  assert.ok(one(db, 'SELECT consent_to_act_at FROM formation_case_people WHERE id = 101').consent_to_act_at);
  assert.deepEqual(one(db, "SELECT document_id, class, origin, person_id, sha256, visible_to FROM formation_case_documents WHERE origin = 'consent_upload'"),
    { document_id: 52, class: 'evidence', origin: 'consent_upload', person_id: 101, sha256: 'c'.repeat(64), visible_to: 'all' });
  assert.deepEqual(await recordConsentUpload(env, 1, 101, { documentId: 52 }, HQ), { ok: false, status: 409, error: 'consent_already_recorded' });

  assert.equal((await quiet(() => markReadyToFile(env, id, HQ))).ok, true);
  const s = await quiet(() => submitFiling(env, id, { submittedOn: '2026-11-18' }, HQ, TODAY));
  assert.equal(s.ok, true, JSON.stringify(s));
  assert.equal((s as any).case.stage, 'submitted');
});

// Mutation checked: openPackApproval's cancel of a request bound to another hash removed (fails: the request for B stays open).
// Equivalent, each alone: setPack's approval clearing, or filingReadiness's hash comparison, removed (the other still refuses).
test('a pack changed after the founder approved it is refused; the documents service asks again, bound to the new hash', async () => {
  const { db, env } = fixture({ appointee: false });
  const made = await createFiling(env, 1, { kind: 'incorporation', submittedByParty: 'hq' }, HQ);
  const id = (made as any).filing.id;
  const a = await quiet(() => setPackForApproval(env, id, { packDocumentId: 51, packSha256: SHA_A }, HQ));
  assert.equal(a.ok, true, JSON.stringify(a));
  const reqA = one(db, 'SELECT id, uid, kind, bound_sha256, filing_id, asked_of_party, state FROM formation_case_requests WHERE uid = ?', (a as any).request_uid);
  assert.deepEqual([reqA.kind, reqA.bound_sha256, reqA.filing_id, reqA.asked_of_party, reqA.state], ['approval', SHA_A, id, 'founder', 'open']);
  assert.equal((await quiet(() => answerRequest(env, reqA.id, { sha256: SHA_A }, FOUNDER_ACTOR))).ok, true);
  assert.equal(one(db, 'SELECT founder_approved_sha256 FROM formation_filings WHERE id = ?', id).founder_approved_sha256, SHA_A);

  // The pack changes after the approval: submission is refused, and the founder is asked about the new hash.
  const b = await quiet(() => setPackForApproval(env, id, { packDocumentId: 51, packSha256: SHA_B }, HQ));
  assert.equal(b.ok, true);
  assert.deepEqual(await markReadyToFile(env, id, HQ), { ok: false, status: 409, error: 'founder_approval_required' });
  db.exec("UPDATE formation_cases SET stage = 'ready_to_file' WHERE id = 1");
  assert.deepEqual(await submitFiling(env, id, { submittedOn: '2026-11-18' }, HQ, TODAY), { ok: false, status: 409, error: 'founder_approval_required' });
  const reqB = one(db, 'SELECT bound_sha256, state FROM formation_case_requests WHERE uid = ?', (b as any).request_uid);
  assert.deepEqual(reqB, { bound_sha256: SHA_B, state: 'open' });

  // Another change before the founder answers: the request for B is cancelled, one for A opened.
  await quiet(() => setPack(env, id, { packDocumentId: 51, packSha256: SHA_A }, HQ));
  const c = await quiet(() => setPackForApproval(env, id, { packDocumentId: 51, packSha256: SHA_B }, HQ));
  assert.equal((c as any).request_uid, (b as any).request_uid, 'a request already bound to this hash is kept');
  const d = await quiet(() => setPackForApproval(env, id, { packDocumentId: 51, packSha256: SHA_A }, HQ));
  assert.equal(one(db, 'SELECT state FROM formation_case_requests WHERE uid = ?', (b as any).request_uid).state, 'cancelled');
  assert.equal(one(db, 'SELECT state FROM formation_case_requests WHERE uid = ?', (d as any).request_uid).state, 'open');
});

/** A fake e-sign send: writes the envelope row the real one would, and nothing else. */
function fakeSend(db: DatabaseSync, calls: any[]) {
  return async (_env: any, o: any) => {
    calls.push(o);
    const uuid = randomUUID();
    db.prepare(`INSERT INTO esign_envelopes (envelope_uuid, user_id, document_type, document_title, document_body, body_sha256, created_by, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'sent')`).run(uuid, o.recipientUserId, o.documentType, o.renderedBody.title, o.renderedBody.body, sha(o.renderedBody.body), o.adminUserId);
    const id = Number(one(db, 'SELECT id FROM esign_envelopes WHERE envelope_uuid = ?', uuid).id);
    return { envelope_id: id, envelope_uuid: uuid, signing_url: `${APP}/sign/x`, email_sent: true };
  };
}
/** What the signature completion leaves: the envelope completed, and its signed copy's file row. */
function complete(db: DatabaseSync, uuid: string, fileSha = SHA_FILE) {
  const key = `esign/signed/${uuid}/copy.pdf`;
  db.prepare(`UPDATE esign_envelopes SET status = 'completed', signed_r2_key = ?, completed_at = '2026-11-20 10:00:00' WHERE envelope_uuid = ?`).run(key, uuid);
  const env = one(db, 'SELECT id FROM esign_envelopes WHERE envelope_uuid = ?', uuid);
  db.prepare(`INSERT INTO legal_document_files (uid, kind, envelope_id, recipient_id, file_sha256, file_bytes, content_type, renderer, paper_sha256, r2_key)
    VALUES (?, 'signed_copy', ?, 1, ?, 2048, 'application/pdf', 'pdf_lib', ?, ?)`).run(randomUUID(), env.id, fileSha, 'e'.repeat(64), key);
  return Number(env.id);
}

const token = (env: any, user_id: number) => new SignJWT({ user_id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
  .setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
async function call(env: any, who: number, method: string, path: string, body?: unknown) {
  const res = await router.request(path, {
    method, headers: { authorization: `Bearer ${await token(env, who)}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env);
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}

// Mutation checked: another hash written on the signed copy's case row (fails: sha256 differs); the claim's
// completed-envelope condition dropped (fails: the owed record runs, and fails, before the signature).
test('a signed envelope\'s document appears on the case with its SHA-256; a consent envelope records the consent', async () => {
  const { db, env } = fixture();
  await generateCaseDocuments(env, 1, HQ, { today: TODAY });
  const consentDoc = one(db, "SELECT uid FROM formation_case_documents WHERE template_key = 'gb_fixture_consent'").uid;
  const k = (await readDocCase(env, 1))!;
  const calls: any[] = [];
  const send = fakeSend(db, calls);

  assert.deepEqual(await sendForSignature(env, k, { documentUid: consentDoc, purpose: 'consent_to_act' }, { send }), { ok: false, status: 400, error: 'person_required' });
  assert.deepEqual(await sendForSignature(env, k, { documentUid: consentDoc, personUid: 'p_sam', purpose: 'consent_to_act' }, { send }),
    { ok: false, status: 409, error: 'recipient_has_no_address' });
  const sent = await sendForSignature(env, k, { documentUid: consentDoc, personUid: 'p_dana', purpose: 'consent_to_act' }, { send });
  assert.equal(sent.ok, true, JSON.stringify(sent));
  assert.equal(calls[0].recipientEmail, 'dana@example.test');
  assert.equal(calls[0].renderedBody.body, 'CONSENT-FIXTURE Dana Director (director) for Acme Ltd', 'the generated text is what is signed');
  assert.equal((sent as any).signing_url, null, 'another signer\'s link is not the founder\'s');
  const uuid = (sent as any).envelope_uuid;
  const envId = Number(one(db, 'SELECT id FROM esign_envelopes WHERE envelope_uuid = ?', uuid).id);
  assert.deepEqual(one(db, 'SELECT effect_kind, state, attempts FROM esign_effects WHERE envelope_id = ?', envId), { effect_kind: 'formation_case_signed', state: 'pending', attempts: 0 });

  // Owed, not due: before the signature completes, nothing runs.
  await runEnvelopeEffects(env, envId, APP);
  db.exec("UPDATE esign_effects SET updated_at = datetime('now', '-10 minutes')");
  assert.equal((await sweepEffects(env, APP)).due, 0);
  assert.deepEqual(one(db, 'SELECT state, attempts FROM esign_effects WHERE envelope_id = ?', envId), { state: 'pending', attempts: 0 });

  complete(db, uuid);
  await runEnvelopeEffects(env, envId, APP);
  assert.deepEqual(one(db, 'SELECT state, attempts FROM esign_effects WHERE envelope_id = ?', envId), { state: 'done', attempts: 1 });
  const signed = one(db, `SELECT cd.uid, cd.class, cd.origin, cd.sha256, cd.person_id, cd.visible_to, d.status, d.signed_at FROM formation_case_documents cd
    JOIN documents d ON d.id = cd.document_id WHERE cd.origin = 'signed_copy'`);
  assert.deepEqual({ ...signed, uid: undefined }, { uid: undefined, class: 'evidence', origin: 'signed_copy', sha256: SHA_FILE, person_id: 101, visible_to: 'all', status: 'signed', signed_at: '2026-11-20 10:00:00' });
  assert.equal(one(db, 'SELECT consent_to_act_at FROM formation_case_people WHERE id = 101').consent_to_act_at, '2026-11-20 10:00:00');

  // A replay changes nothing.
  db.exec("UPDATE esign_effects SET state = 'failed', updated_at = datetime('now', '-10 minutes')");
  await sweepEffects(env, APP);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM formation_case_documents WHERE origin = 'signed_copy'").n, 1);

  // The founder reads it, with its hash; another founder's read is 404.
  const list = await call(env, FOUNDER, 'GET', '/fc_doc/documents');
  assert.equal(list.status, 200, list.text);
  const row = list.body.documents.find((d: any) => d.origin === 'signed_copy');
  assert.deepEqual([row.sha256, row.person], [SHA_FILE, { uid: 'p_dana', name: 'Dana Director' }]);
  assert.equal(list.body.documents.find((d: any) => d.uid === consentDoc).signing.status, 'completed');
  assert.deepEqual(list.body.plan.pending_counsel.map((p: any) => p.template_key), ['gb_fixture_resolution']);
  assert.doesNotMatch(list.text, /r2_key|esign\/signed/);
  const opened = await call(env, FOUNDER, 'GET', `/fc_doc/documents/${row.uid}`);
  assert.deepEqual([opened.status, opened.body.document.sha256, opened.body.document.body], [200, SHA_FILE, null]);
  assert.equal((await call(env, OTHER, 'GET', '/fc_doc/documents')).status, 404);
  assert.equal((await call(env, FOUNDER, 'POST', '/fc_doc/documents/sign', {})).body.error, 'document_required');
});

// Mutation checked: the revision guard on the consent stamp dropped (fails: the stale consent is recorded).
test('a consent signed after the person was changed does not record the consent', async () => {
  const { db, env } = fixture();
  await generateCaseDocuments(env, 1, HQ, { today: TODAY });
  const consentDoc = one(db, "SELECT uid FROM formation_case_documents WHERE template_key = 'gb_fixture_consent'").uid;
  const sent = await sendForSignature(env, (await readDocCase(env, 1))!, { documentUid: consentDoc, personUid: 'p_dana', purpose: 'consent_to_act' }, { send: fakeSend(db, []) });
  db.exec('UPDATE formation_case_people SET revision = revision + 1 WHERE id = 101');
  const envId = complete(db, (sent as any).envelope_uuid);
  await runEnvelopeEffects(env, envId, APP);
  assert.equal(one(db, 'SELECT consent_to_act_at FROM formation_case_people WHERE id = 101').consent_to_act_at, null);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM formation_case_documents WHERE origin = 'signed_copy'").n, 1, 'the signed copy still lands');
  assert.equal(JSON.parse(one(db, "SELECT detail_json FROM formation_case_events WHERE kind = 'document_signed'").detail_json).consent_recorded, false);
});

// ── Legacy parity ───────────────────────────────────────────────────────────

const LEGACY = ['us_de_ccorp', 'us_wy_ccorp', 'us_de_llc', 'uk_ltd', 'sg_pte', 'ee_oy'] as const;
// Bodies for some templates (each with all five tokens); the rest have none.
const LEGACY_BODY = 'LEGACY-FIXTURE {{company_name}} / {{jurisdiction}} / {{incorporation_date}} / {{registered_agent_name}} / {{registered_agent_address}}';
const WITH_BODY = ['certificate_of_incorporation_de', 'ein_application_kit', 'uk_memorandum_of_association', 'uk_form_in01_kit', 'sg_constitution', 'ee_founding_resolution'];

function legacyDb(formKey: string, agent: boolean) {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(ADMIN, 'admin', 'Hq Admin', 'hq@axal.example', null);
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  db.exec("INSERT INTO projects (id, name, founder_id, slug) VALUES (1, 'Acme', 1001, 'acme')");
  for (const slug of WITH_BODY) template(db, slug, LEGACY_BODY);
  db.prepare(`INSERT INTO incorporations (id, user_id, project_id, jurisdiction_id, company_name, registered_agent_name, registered_agent_address,
      amount_cents, status, paid_at) VALUES (7, ?, 1, ?, 'Acme, Inc.', ?, ?, 5000, 'packet_processing', '2026-10-01 09:00:00')`)
    .run(FOUNDER, formKey, agent ? 'Agent Co' : null, agent ? '1 Agent Way' : null);
  db.prepare(`INSERT INTO formation_cases (id, uid, user_id, intent, project_id, track, stage, waiting_on, revision, form_key, catalogue_version_id)
      VALUES (1, 'fc_legacy_parity', ?, 'convert_project', 1, 'v2', 'preparing', 'hq', 0, ?, (SELECT id FROM formation_catalogue_versions WHERE version = 1))`).run(FOUNDER, formKey);
  db.exec('INSERT INTO formation_case_orders (case_id, incorporation_id) VALUES (1, 7);');
  return db;
}

const wizardApp = new Hono<any>();
wizardApp.route('/legal', legal);
wizardApp.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

const docsOf = (db: DatabaseSync) => all(db, 'SELECT project_id, title, doc_type, status, content, template_name FROM documents WHERE id > 100 OR template_name IS NOT NULL ORDER BY template_name');

// Mutation checked: the legacy fill's placeholder dropped (fails: '[Registered Agent]' missing on the agentless forms); the
// legacy branch sent through the country review (fails: every legacy document pending_counsel); the contract check moved
// after the body read (fails: bylaws is pending_body, not pending_esign); COUNSEL_REQUIRED_TEMPLATES ignored (fails: Wyoming pending_body).
test('the six legacy forms generate the same documents as the wizard', async () => {
  // A fixed clock (D5614): the wizard stamps incorporation_date from Date; both sides read the same day.
  mock.timers.enable({ apis: ['Date'], now: Date.parse(`${TODAY}T12:00:00Z`) });
  try {
    for (const [i, formKey] of LEGACY.entries()) {
      const agent = i % 2 === 0;
      const wizardDb = legacyDb(formKey, agent);
      const wenv: any = { DB: d1Over(wizardDb), JWT_SECRET: 'unit-test-jwt-secret-0123456789-abcdef' };
      const jwt = await new SignJWT({ user_id: ADMIN, role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
        .sign(new TextEncoder().encode(wenv.JWT_SECRET));
      const res = await quiet(() => wizardApp.request('/legal/incorporate/wizard', {
        method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: 1, jurisdiction_id: formKey, company_name: 'Acme, Inc.',
          ...(agent ? { registered_agent_name: 'Agent Co', registered_agent_address: '1 Agent Way' } : {}) }),
      }, wenv));
      const wizard: any = await res.json();
      assert.equal(res.status, 200, `${formKey}: ${JSON.stringify(wizard)}`);

      const caseDb = legacyDb(formKey, agent);
      const cenv: any = { DB: d1Over(caseDb) };
      const mine = await quiet(() => generateCaseDocuments(cenv, 1, HQ, { today: TODAY })) as any;
      assert.equal(mine.ok, true, `${formKey}: ${JSON.stringify(mine)}`);

      assert.deepEqual(docsOf(caseDb), docsOf(wizardDb), `${formKey}: the documents written`);
      assert.deepEqual(mine.documents.map((d: any) => ({ title: d.title, doc_type: d.template_key })),
        wizard.documents.map((d: any) => ({ title: d.title, doc_type: d.doc_type })), `${formKey}: the documents listed`);
      assert.deepEqual(mine.pending_esign, wizard.pending_esign, `${formKey}: pending_esign`);
      assert.deepEqual(mine.pending_counsel, wizard.pending_counsel, `${formKey}: pending_counsel`);
      assert.deepEqual(mine.pending_body, wizard.pending_body, `${formKey}: pending_body`);
      assert.deepEqual([mine.pending_fields, mine.pending_people], [[], []]);
      if (formKey === 'us_wy_ccorp') assert.equal(mine.pending_counsel[0]?.template_key, 'articles_of_incorporation_wy');
      if (!agent && mine.documents.length) assert.match(docsOf(caseDb)[0].content, /\[Registered Agent\] \/ \[Registered Agent Address\]/);
    }
  } finally {
    mock.timers.reset();
  }
});
