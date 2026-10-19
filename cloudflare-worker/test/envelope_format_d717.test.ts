// D717 (#1782) decision 2 — a send records the kind and Axal party it
// printed on the envelope, and every later copy reads the envelope's values.
//
// The e-sign route on real SQLite (`_esign_harness.ts`). The signed copy is
// read back from the fake R2 and its page text compared, as
// pdf_execution_d705.test.ts reads a preview.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFArray, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { SENDER, RECIPIENT, freshDb, envFor, fakeR2, call } from './_esign_harness.ts';
import { ensureLegalTemplatesSchema } from '../src/services/legalTemplateStore.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { sendDocusignEnvelope } from '../src/integrations/providers/docusign.ts';
import { renderFormat } from '../src/services/templateFormat.ts';
import { AXAL_ENTITIES } from '../src/services/legalDocFormat.ts';

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const raw = page.node.lookup(PDFName.of('Contents'));
    const streams = raw instanceof PDFArray ? raw.asArray().map((r) => doc.context.lookup(r)) : [raw];
    let ops = '';
    for (const s of streams) if (s instanceof PDFRawStream) ops += Buffer.from(decodePDFRawStream(s).decode()).toString('latin1');
    return [...ops.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)].map((m) => Buffer.from(m[1], 'hex').toString('latin1')).join('\n');
  });
}
/** The preamble's party: the Axal entity named before "a Delaware". */
const partyIn = (text: string) => {
  const flat = text.replace(/\s+/g, ' ');
  return Object.values(AXAL_ENTITIES).filter((e) => flat.includes(`by and between ${e.name}`)).map((e) => e.key);
};

const NDA = 'founder_nda_v1';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function setup(party: string | null) {
  const db = freshDb();
  const files = fakeR2();
  const e = envFor(db, files);
  await ensureLegalTemplatesSchema(e as any);
  // A stub row: the send keeps today's bundled body, and only the stored party differs.
  db.prepare("INSERT INTO legal_templates (slug, title, category, body_md, is_stub, axal_party) VALUES (?, 'Founder NDA', 'portfolio', '', 1, ?)")
    .run(NDA, party);
  return { db, files, e };
}
async function sendAndSign(db: any, files: any, e: any, beforeSign?: () => void) {
  const sent = await call(e, 'POST', '/send', SENDER, { document_type: NDA, recipient_email: 'investor@example.test', recipient_name: 'Ivy Investor', provider: 'native' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const env = db.prepare('SELECT envelope_uuid, doc_kind, axal_party FROM esign_envelopes ORDER BY id DESC LIMIT 1').get();
  beforeSign?.();
  const rec = db.prepare('SELECT signing_token FROM esign_recipients ORDER BY id DESC LIMIT 1').get();
  const signed = await call(e, 'POST', `/sign/${rec.signing_token}`, RECIPIENT, { accepted: true, typed_name: 'Ivy Investor', signature_data_url: PNG });
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  // D711: each signature keeps its own copy, at the key its registry row names.
  const file = db.prepare("SELECT r2_key FROM legal_document_files WHERE kind = 'signed_copy' ORDER BY id DESC LIMIT 1").get();
  const pdf = file && files.objects.get(file.r2_key);
  assert.ok(pdf, 'the signed copy was stored');
  return { env: { ...env }, text: (await pageTexts(pdf)).join('\n') };
}

test('D717 /send records the row\'s override, and the signed copy prints it', async () => {
  const { db, files, e } = await setup('holdings');
  const { env, text } = await sendAndSign(db, files, e);
  assert.deepEqual([env.doc_kind, env.axal_party], ['agreement', 'holdings']);
  assert.deepEqual(partyIn(text), ['holdings']);
});

test('D717 a template edited after the send never changes what that envelope prints', async () => {
  const { db, files, e } = await setup('holdings');
  const { env, text } = await sendAndSign(db, files, e, () => db.exec(`UPDATE legal_templates SET axal_party = 'gp' WHERE slug = '${NDA}'`));
  assert.equal(env.axal_party, 'holdings');
  assert.deepEqual(partyIn(text), ['holdings']);
});

test('D717 a row with no override records the slug\'s pair, and an envelope with NULL columns prints today\'s party', async () => {
  const plain = await setup(null);
  const first = await sendAndSign(plain.db, plain.files, plain.e);
  assert.deepEqual([first.env.doc_kind, first.env.axal_party], ['agreement', 'management']);
  assert.deepEqual(partyIn(first.text), ['management']);
  // An envelope sent before migration 479: both columns NULL. The template's
  // override does not reach it; it renders from the slug, as before.
  const old = await setup('holdings');
  const legacy = await sendAndSign(old.db, old.files, old.e, () => old.db.exec('UPDATE esign_envelopes SET doc_kind = NULL, axal_party = NULL'));
  assert.deepEqual([legacy.env.doc_kind, legacy.env.axal_party], ['agreement', 'holdings']);
  assert.deepEqual(partyIn(legacy.text), ['management']);
});

test('D717 the DocuSign source receives the envelope\'s pair', async () => {
  const env: any = { JWT_SECRET: 'x'.repeat(64), ENVIRONMENT: 'development' };
  const uid = 'd717-docusign-fixture';
  const row: any = { uid, credentials_enc: await encryptCredentials(env, uid, { access_token: 'fixture-token' }),
    config_json: JSON.stringify({ base_uri: 'https://docusign.example.test', account_id: 'acct-fixture' }) };
  const sent: any[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: any, init: any) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ envelopeId: 'ds-1', status: 'sent' }), { status: 201 });
  }) as typeof fetch;
  try {
    const base = { documentTitle: 'Founder NDA', documentBody: 'The parties agree.', documentType: NDA, recipientEmail: 'investor@example.test',
      recipientName: 'Ivy Investor', appUrl: 'https://app.example.test', webhookSecret: 'fixture-secret', integrationUid: uid };
    await sendDocusignEnvelope(env, row, { ...base, ...renderFormat({ doc_kind: 'agreement', axal_party: 'holdings' }) });
    await sendDocusignEnvelope(env, row, { ...base });
  } finally { globalThis.fetch = realFetch; }
  assert.equal(sent.length, 2);
  const parties = await Promise.all(sent.map(async (p) =>
    partyIn((await pageTexts(Uint8Array.from(Buffer.from(p.documents[0].documentBase64, 'base64')))).join('\n'))));
  assert.deepEqual(parties, [['holdings'], ['management']]);
  // createAndSendEnvelope hands DocuSign the same pair it writes on the
  // envelope, and (D758) the same library slug it records.
  const esign = readFileSync('cloudflare-worker/src/routes/esign.ts', 'utf8');
  const call = esign.slice(esign.indexOf('sendDocusignEnvelope(env, dsRow, {'));
  assert.match(call.slice(0, call.indexOf('});')), /\bdocumentType,\s*\.\.\.renderFormat\(format\),/);
});

test('D717 the signer\'s paper prints the envelope\'s pair, not the template\'s later edit', async () => {
  const { db, e } = await setup('holdings');
  const sent = await call(e, 'POST', '/send', SENDER, { document_type: NDA, recipient_email: 'investor@example.test', recipient_name: 'Ivy Investor', provider: 'native' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  db.exec(`UPDATE legal_templates SET axal_party = 'gp' WHERE slug = '${NDA}'`);
  const rec = db.prepare('SELECT signing_token FROM esign_recipients ORDER BY id DESC LIMIT 1').get();
  const paper = await call(e, 'GET', `/sign/${rec.signing_token}/paper`, RECIPIENT);
  assert.equal(paper.status, 200, JSON.stringify(paper.body));
  const text = String(paper.body.html).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&');
  assert.deepEqual(partyIn(text), ['holdings']);
});
