/**
 * D711 (#1776) — migration 475 and the file registry: each signature keeps
 * its own copy and row, each signer downloads their own, the paper choice
 * travels from the send to the paper, and the admin read shows ids and hashes
 * only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { tableFromBaseline } from './_baseline.mjs';
import { freshDb, envFor, call as esignCall, fakeR2, SENDER, app as esignApp } from './_esign_harness.ts';
import { fixture, call as adminCall, M475 } from './_legal_paper_harness.ts';
import { createAndSendEnvelope } from '../src/routes/esign.ts';
import { recordDocusignSignedFile } from '../src/integrations/providers/docusign.ts';
import { sha256HexBytes } from '../src/services/pdf.ts';

const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const DOC = 'founder_nda_v1';

function baselineDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['esign_envelopes', 'esign_recipients']) db.exec(tableFromBaseline(baseline, t));
  db.exec(`INSERT INTO esign_envelopes(envelope_uuid,document_type,document_title,document_body,body_sha256,created_by)
    VALUES('old','t','T','b','h',1)`);
  db.exec(M475);
  return db;
}

test('D711 existing envelopes read letter, dark and no version; a5 and grey are refused', () => {
  const db = baselineDb();
  assert.deepEqual({ ...db.prepare("SELECT page_size, cover, template_version FROM esign_envelopes WHERE envelope_uuid='old'").get() },
    { page_size: 'letter', cover: 'dark', template_version: null });
  const ins = (col: string, v: string) => () => db.exec(`INSERT INTO esign_envelopes(envelope_uuid,document_type,document_title,document_body,body_sha256,created_by,${col})
    VALUES('n-${v}','t','T','b','h',1,'${v}')`);
  assert.throws(ins('page_size', 'a5'), /CHECK constraint failed/);
  assert.throws(ins('cover', 'grey'), /CHECK constraint failed/);
  ins('page_size', 'a4')();
});

test('D711 legal_document_files refuses UPDATE and DELETE, and its checks hold', () => {
  const db = baselineDb();
  const row = (kind: string, extra = '', vals = '') => `INSERT INTO legal_document_files(uid,kind,file_sha256,file_bytes,content_type,renderer,paper_sha256${extra})
    VALUES('${crypto.randomUUID()}','${kind}','${'f'.repeat(64)}',10,'application/pdf','browser_run','p'${vals})`;
  db.exec(row('signed_copy', ',envelope_id,recipient_id', ',1,1'));
  assert.throws(() => db.exec("UPDATE legal_document_files SET r2_key = 'x'"), /append-only/);
  assert.throws(() => db.exec('DELETE FROM legal_document_files'), /append-only/);
  assert.throws(() => db.exec(row('signed_copy', ',envelope_id', ',1')), /CHECK/, 'a signed copy names its signer');
  assert.throws(() => db.exec(row('docx_export')), /CHECK/, 'an export names its template');
  assert.throws(() => db.exec(row('docusign_source')), /CHECK/, 'a DocuSign file names its envelope');
});

async function threeRecipientEnvelope() {
  const db = freshDb();
  const files = fakeR2();
  const e = envFor(db, files);
  const sent = await esignCall(e, 'POST', '/send', SENDER, { document_type: DOC, recipient_email: 'ada@nowhere.test', recipient_name: 'Ada Founder', provider: 'native' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const envId = sent.body.envelope_id;
  const add = db.prepare(`INSERT INTO esign_recipients (envelope_id, recipient_email, recipient_name, signing_token, token_expires_at, status)
    VALUES (?, ?, ?, ?, ?, 'pending')`);
  add.run(envId, 'ivan@nowhere.test', 'Ivan Investor', 'ivan-'.padEnd(48, 'i'), '2999-01-01T00:00:00Z');
  add.run(envId, 'legal@axal.vc', 'Axal Legal', 'axal-'.padEnd(48, 'a'), '2999-01-01T00:00:00Z');
  const recs = db.prepare('SELECT id, signing_token FROM esign_recipients WHERE envelope_id = ? ORDER BY id').all(envId) as any[];
  const uuid = (db.prepare('SELECT envelope_uuid FROM esign_envelopes WHERE id = ?').get(envId) as any).envelope_uuid;
  return { db, files, e, envId, recs, uuid };
}

test('D711 a three-recipient envelope keeps three copies and three rows, none overwritten, and each signer downloads their own', async () => {
  const { db, files, e, envId, recs, uuid } = await threeRecipientEnvelope();
  const keys: string[] = [];
  let first: Uint8Array | null = null;
  for (const [i, r] of recs.entries()) {
    const signed = await esignCall(e, 'POST', `/sign/${r.signing_token}`, null, { accepted: true, typed_name: `Signer ${i + 1}`, signature_data_url: PNG });
    assert.equal(signed.status, 200, JSON.stringify(signed.body));
    const row = db.prepare("SELECT * FROM legal_document_files WHERE recipient_id = ? AND kind = 'signed_copy'").get(r.id) as any;
    assert.ok(row, `a row for signer ${i + 1}`);
    assert.equal(row.envelope_id, envId);
    assert.ok(row.r2_key.startsWith(`esign/signed/${uuid}/`) && row.r2_key.endsWith('.pdf'));
    assert.equal(row.file_sha256, await sha256HexBytes(files.objects.get(row.r2_key)!));
    assert.equal(row.renderer, 'pdf_lib', 'no binding here, so the fallback drew it');
    for (const banned of ['@', 'Signer ']) assert.ok(!JSON.stringify(row).includes(banned), banned);
    keys.push(row.r2_key);
    if (i === 0) first = files.objects.get(row.r2_key)!.slice();
  }
  assert.equal(new Set(keys).size, 3);
  assert.equal([...files.objects.keys()].filter((k) => k.startsWith(`esign/signed/${uuid}/`)).length, 3);
  assert.deepEqual(files.objects.get(keys[0]), first, 'the first copy is unchanged');
  // Each download is that signer's own bytes.
  for (const [i, r] of recs.entries()) {
    const res = await esignApp.request(`/sign/${r.signing_token}/document`, {}, e);
    assert.equal(res.status, 200);
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), files.objects.get(keys[i]));
  }
  // A recipient with no row (signed before 475) keeps getting signed_r2_key.
  db.prepare("UPDATE esign_envelopes SET signed_r2_key = 'esign/signed/legacy.pdf' WHERE id = ?").run(envId);
  const legacy = db.prepare(`INSERT INTO esign_recipients (envelope_id, recipient_email, signing_token, token_expires_at, status)
    VALUES (?, 'old@nowhere.test', ?, '2999-01-01T00:00:00Z', 'signed')`).run(envId, 'old-'.padEnd(48, 'o'));
  assert.ok(legacy.changes);
  const old = await esignApp.request(`/sign/${'old-'.padEnd(48, 'o')}/document`, {}, e);
  assert.equal(new TextDecoder().decode(await old.arrayBuffer()), '%PDF-1.4 placeholder');
});

test('D711 a failed registry write puts the signature back to pending', async () => {
  const { db, e, recs } = await threeRecipientEnvelope();
  db.exec('DROP TRIGGER legal_document_files_block_delete; DROP TRIGGER legal_document_files_block_update; DROP TABLE legal_document_files');
  const r = await esignCall(e, 'POST', `/sign/${recs[0].signing_token}`, null, { accepted: true, typed_name: 'A', signature_data_url: PNG });
  assert.deepEqual([r.status, r.body.error], [500, 'signed_pdf_failed']);
  assert.equal((db.prepare('SELECT status FROM esign_recipients WHERE id = ?').get(recs[0].id) as any).status, 'pending');
});

test('D711 reconciling one DocuSign envelope twice leaves one docusign_signed row, hashed over the returned bytes', async () => {
  const db = freshDb();
  const e: any = envFor(db);
  const bytes = new TextEncoder().encode('%PDF-1.7 signed by docusign é');
  await recordDocusignSignedFile(e, 7, 'esign/signed/u.pdf.enc', bytes);
  await recordDocusignSignedFile(e, 7, 'esign/signed/u.pdf.enc', bytes);
  const rows = db.prepare("SELECT * FROM legal_document_files WHERE kind = 'docusign_signed'").all() as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].file_sha256, await sha256HexBytes(bytes));
  assert.deepEqual([rows[0].renderer, rows[0].paper_sha256, rows[0].file_bytes], ['docusign', null, bytes.length]);
});

test('D711 page size, cover and template version travel from the send to the envelope to the paper', async () => {
  const db = freshDb();
  const e: any = envFor(db);
  const bad = await esignCall(e, 'POST', '/send', SENDER, { document_type: DOC, recipient_email: 'x@nowhere.test', page_size: 'a5' });
  assert.deepEqual([bad.status, bad.body.error], [400, 'page_size_invalid']);
  const badCover = await esignCall(e, 'POST', '/send', SENDER, { document_type: DOC, recipient_email: 'x@nowhere.test', cover: 'grey' });
  assert.deepEqual([badCover.status, badCover.body.error], [400, 'cover_invalid']);
  const sent = await esignCall(e, 'POST', '/send', SENDER, { document_type: DOC, recipient_email: 'x@nowhere.test', recipient_name: 'X', page_size: 'a4', cover: 'light' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.deepEqual({ ...db.prepare('SELECT page_size, cover, template_version FROM esign_envelopes WHERE id = ?').get(sent.body.envelope_id) },
    { page_size: 'a4', cover: 'light', template_version: null });

  const out = await createAndSendEnvelope(e, {
    adminUserId: SENDER, adminName: 'Sam', recipientUserId: null, recipientEmail: 'v3@nowhere.test', recipientName: 'Vera',
    documentType: DOC, appUrl: 'https://app.example.test', renderedBody: { title: 'Founder NDA', body: 'The parties agree.' },
    pageSize: 'a4', cover: 'light', templateVersion: 3,
  });
  const tok = (db.prepare('SELECT signing_token FROM esign_recipients WHERE envelope_id = ?').get(out!.envelope_id) as any).signing_token;
  const paper = await esignCall(e, 'GET', `/sign/${tok}/paper`, null);
  assert.equal(paper.status, 200);
  assert.equal(paper.body.page_size, 'a4');
  assert.ok(paper.body.html.includes('Founder NDA — v3'), 'the footer prints the sent version');
  assert.ok(paper.body.html.includes('Vera'), 'the signer is named in the preamble');
  assert.ok(!paper.body.html.includes('v3@nowhere.test'), 'no email on paper');
});

test('D711 /sign/:token/paper refuses an expired and a voided envelope, as /sign/:token does', async () => {
  const { db, e, envId, recs } = await threeRecipientEnvelope();
  db.prepare("UPDATE esign_recipients SET token_expires_at = '2000-01-01T00:00:00Z' WHERE id = ?").run(recs[1].id);
  for (const path of [`/sign/${recs[1].signing_token}`, `/sign/${recs[1].signing_token}/paper`]) {
    assert.equal((await esignCall(e, 'GET', path, null)).status, 410, path);
  }
  db.prepare("UPDATE esign_envelopes SET status = 'void' WHERE id = ?").run(envId);
  for (const path of [`/sign/${recs[0].signing_token}`, `/sign/${recs[0].signing_token}/paper`]) {
    const r = await esignCall(e, 'GET', path, null);
    assert.deepEqual([r.status, r.body.error], [410, 'envelope_voided'], path);
  }
  const audits = (db.prepare("SELECT COUNT(*) AS n FROM esign_audit_events WHERE action = 'envelope_viewed'").get() as any).n;
  assert.equal(audits, 0, 'neither refused read recorded a view');
});

test('D711 /:uid/files answers the creator and the Super Admin, refuses another admin, and holds no storage key or email', async () => {
  const db = fixture();
  db.prepare(`INSERT INTO legal_document_files(uid,kind,envelope_id,recipient_id,file_sha256,file_bytes,content_type,page_size,renderer,paper_sha256,r2_key)
    VALUES('f1','signed_copy',1,12,?,1234,'application/pdf','a4','browser_run','p','esign/signed/env-1/f1.pdf')`).run('9'.repeat(64));
  for (const who of [2, 1]) {
    const r = await adminCall(db, '/env-1/files', who);
    assert.equal(r.status, 200, `user ${who}`);
    assert.deepEqual(r.body.files.map((f: any) => [f.kind, f.signer, f.renderer, f.page_size, f.bytes, f.sha256, f.stored]),
      [['signed_copy', 2, 'browser_run', 'a4', 1234, '9'.repeat(64), false]]);
    const text = JSON.stringify(r.body);
    assert.ok(!text.includes('r2_key') && !text.includes('esign/signed') && !text.includes('@'), `user ${who}`);
  }
  assert.equal((await adminCall(db, '/env-1/files', 6)).status, 403);
  const stored = await adminCall(db, '/env-1/files', 2, 'GET', undefined, { FILES: { head: async (k: string) => (k.endsWith('f1.pdf') ? { size: 1 } : null) } });
  assert.equal(stored.body.files[0].stored, true);
});
