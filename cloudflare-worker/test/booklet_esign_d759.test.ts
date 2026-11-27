/**
 * D759 (#1858) — a submitted Subscription Booklet sent for e-signature, over
 * real SQLite: the applicant signs Parts 3 to 8, then the Fund's signatory
 * signs Part 9, each in its own envelope over the booklet's frozen copy, under
 * one hash equal to the booklet's digest.
 *
 * The fixture is the baseline's tables plus migrations 434 (which 479 alters), 472, 475, 478, 479 and
 * 485, read from their files; the booklet routes and the e-sign routes on one
 * app; an in-memory R2; no Browser Run binding, so each signed copy is drawn
 * by pdf-lib. `globalThis.fetch` throws, and the file ends by asserting it was
 * never called.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { PDFDocument, PDFName, PDFRawStream, PDFArray, decodePDFRawStream } from 'pdf-lib';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import booklets from '../src/routes/fund_booklets.ts';
import esign from '../src/routes/esign.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { updateTemplate } from '../src/services/legalTemplateStore.ts';
import { bookletEnvelopeModel, stageTitle } from '../src/services/bookletSigning.ts';
import { paperModel } from '../src/services/legalPaper.ts';
import { RECEIVING_BRACKET } from '../src/services/fundStructure.ts';
import { encryptColumn } from '../src/services/columnCipher.ts';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = (f: string) => readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8');
const TABLES = ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'lp_applications', 'legal_templates',
  'legal_template_versions', 'esign_envelopes', 'esign_recipients', 'notifications_inbox'];
const SCHEMA = TABLES.map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n')
  + '\n' + migration('434_contract_template_publications.sql')
  + '\n' + migration('472_entity_bank_accounts.sql')
  + '\n' + migration('475_legal_document_files.sql')
  + '\n' + migration('478_fund_notices_booklets.sql')
  + '\n' + migration('479_template_kind_party.sql')
  + '\n' + migration('485_fund_booklet_envelopes.sql');
const SECRET = ['d759', 'booklet', 'esign', 'fixture', 'secret'].join('-');

const ADMIN = 1, APPLICANT = 2, STRANGER = 4, SIGNER = 6;
const SIGNER_EMAIL = 'fund.signer@example.test';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const FUND_NUMBER = '8100223344';

const BODIES: Record<string, string> = {
  securities_legend: 'THESE INTERESTS HAVE NOT BEEN REGISTERED.',
  subscription: '## Article 1 Subscription\nThe applicant subscribes.\n- [ ] I have read the Private Placement Memorandum.\n- [ ] I subscribe for the amount below.',
  lp_investor_questionnaire: '- [ ] I am an accredited investor.\n- [ ] I am a qualified purchaser.',
  lp_aml_kyc_certification: '- [ ] The funds are not the proceeds of crime.',
  lp_tax_status_certification: '- [ ] I am a U.S. person.',
  lp_electronic_delivery_consent: '- [ ] I consent to electronic delivery.',
  gp_closing_certificate: 'The General Partner accepts the subscription.',
};

// ── No network, ever ──────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async () => { fetchCalls += 1; throw new Error('fetch must not be called'); }) as typeof fetch;
// Every console line, so a test can prove a token never reached one.
const lines: string[] = [];
const realConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info };
for (const k of ['log', 'warn', 'error', 'info'] as const) {
  (console as any)[k] = (...a: unknown[]) => { lines.push(a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
}
after(() => {
  globalThis.fetch = realFetch;
  Object.assign(console, realConsole);
  assert.equal(fetchCalls, 0, 'nothing reached the network');
});

function fakeR2() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(key: string, bytes: Uint8Array) { objects.set(key, bytes); },
    async get(key: string) {
      const bytes = objects.get(key);
      return bytes ? { arrayBuffer: async () => bytes.slice().buffer } : null;
    },
  };
}

async function fixture(opts: { signer?: boolean } = {}) {
  const { DB, db } = makeD1(SCHEMA);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  for (const [id, role, name, email] of [[ADMIN, 'admin', 'Ada Admin', 'ada@example.test'], [APPLICANT, 'investor', 'Ivy Applicant', 'ivy@example.test'],
    [STRANGER, 'investor', 'Sam Stranger', 'sam@example.test'], [SIGNER, 'admin', 'Joseph Signer', SIGNER_EMAIL]] as const) u.run(id, role, name, email);
  if (opts.signer !== false) db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SIGNER);
  // A Super Admin act needs a TOTP session (D714), as fund_notices_d716.test.ts sets up.
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  s.run(ADMIN, 'totp-admin');
  s.run(SIGNER, 'totp-signer');
  db.exec(`INSERT INTO lp_applications (id, user_id, fund_slug, investor_type, status) VALUES (21, ${APPLICANT}, 'spinout-fund-i', 'individual', 'approved')`);
  const t = db.prepare(`INSERT INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub)
    VALUES (?, ?, 'fund', ?, '[]', 1, 1, 0) ON CONFLICT (slug) DO UPDATE SET body_md = excluded.body_md, is_stub = 0`);
  for (const [slug, body] of Object.entries(BODIES)) t.run(slug, slug, body);
  const files = fakeR2();
  const env: any = { DB, FILES: files, JWT_SECRET: SECRET, ENVIRONMENT: 'development', APP_URL: 'https://app.example.test', AXAL_COUNTERSIGNER_EMAIL: SIGNER_EMAIL };
  // A synthetic Fund account, so an issued map has one to name.
  const uid = '0000bbbb-0000-4000-8000-000000000759';
  const enc = await encryptColumn(env, 'entity_bank_accounts', 'account_number_enc', uid, FUND_NUMBER);
  db.prepare(`INSERT INTO entity_bank_accounts
      (uid, entity_key, label, bank_name, bank_address, beneficiary_name, beneficiary_address, account_kind,
       account_number_enc, account_last4, routing_number, swift_code, purposes_json, recorded_by)
     VALUES (?, 'fund', 'Fund checking', 'Column N.A.', '1 Letterman Drive', 'Axal VC Spin-Out Lab Fund I LP',
             '16192 Coastal Highway', 'checking', ?, ?, '121145433', 'CLNOUS66MER', '["capital_contribution","gp_commitment"]', ?)`)
    .run(uid, enc, FUND_NUMBER.slice(-4), SIGNER);
  const app = new Hono<any>();
  app.route('/api/fund-booklets', booklets);
  app.route('/api/legal/esign', esign);
  app.onError((e: any, c) => {
    const m = String(e?.message ?? '');
    if (m === 'Super admin required') return c.json({ code: 'super_admin_required' }, 403);
    if (m === 'Unauthorized') return c.json({ detail: 'Unauthorized' }, 401);
    throw e;
  });
  async function call(who: number | null, method: string, path: string, body?: unknown, o: { envExtra?: Record<string, unknown>; impersonatedBy?: number } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (who) {
      const jti = who === ADMIN ? 'totp-admin' : who === SIGNER ? 'totp-signer' : undefined;
      const claims: Record<string, unknown> = { user_id: who, ...(jti ? { jti } : {}), ...(o.impersonatedBy ? { impersonated_by: o.impersonatedBy } : {}) };
      headers.Authorization = `Bearer ${await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
    }
    const res = await withThrownResponses(() => app.request(path, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { ...env, ...(o.envExtra || {}) }));
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  }
  const one = (sql: string, ...a: unknown[]) => { const r = db.prepare(sql).get(...a); return r ? { ...(r as any) } : null; };
  const all = (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
  const count = (table: string) => Number(one(`SELECT COUNT(*) AS n FROM ${table}`)!.n);
  return { db, env, files, call, one, all, count };
}
type F = Awaited<ReturnType<typeof fixture>>;

/** Open the applicant's booklet, tick the first field, and submit it. */
async function submitted(f: F) {
  const opened = await f.call(APPLICANT, 'POST', '/api/fund-booklets/mine');
  assert.ok(opened.status === 201 || opened.status === 200, JSON.stringify(opened.body));
  const view = (await f.call(APPLICANT, 'GET', '/api/fund-booklets/mine')).body;
  const first = view.parts.flatMap((p: any) => p.fields)[0];
  const ticked = await f.call(APPLICANT, 'PUT', '/api/fund-booklets/mine/answers', { answers: [{ field_id: first.id, checked: true }] });
  assert.equal(ticked.status, 200, JSON.stringify(ticked.body));
  const sub = await f.call(APPLICANT, 'POST', '/api/fund-booklets/mine/submit', { digest: ticked.body.digest });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  return { uid: view.uid as string, digest: sub.body.digest as string, field: first };
}

async function sendBooklet(f: F) {
  const sent = await f.call(APPLICANT, 'POST', '/api/fund-booklets/mine/sign');
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  return sent.body as { uid: string; stage: string; envelope_uuid: string; token: string };
}

const sign = (f: F, who: number, token: string, name = 'Ivy Applicant') =>
  f.call(who, 'POST', `/api/legal/esign/sign/${token}`, { accepted: true, typed_name: name, signature_data_url: PNG });

const gpToken = (f: F) => f.one(`SELECT r.signing_token FROM esign_recipients r JOIN esign_envelopes e ON e.id = r.envelope_id
  JOIN fund_booklet_envelopes b ON b.envelope_uuid = e.envelope_uuid WHERE b.stage = 'gp'`)?.signing_token as string;

/** The PDF's signature images (the fixture's 1×1 PNG; the mark is larger), and its text, from a stored signed copy. */
async function signedCopy(f: F, envelopeUuid: string) {
  const row = f.one(`SELECT d.r2_key FROM legal_document_files d JOIN esign_envelopes e ON e.id = d.envelope_id
    WHERE e.envelope_uuid = ? AND d.kind = 'signed_copy' ORDER BY d.id DESC LIMIT 1`, envelopeUuid);
  assert.ok(row, 'a signed copy is recorded');
  const bytes = f.files.objects.get(row.r2_key);
  assert.ok(bytes, 'the signed copy is stored');
  const doc = await PDFDocument.load(bytes);
  // An alpha PNG embeds as an image plus its SMask image; count the images, not their masks.
  const objects = doc.context.enumerateIndirectObjects();
  const masks = new Set(objects.map(([, o]) => (o instanceof PDFRawStream ? String(o.dict.get(PDFName.of('SMask')) ?? '') : '')).filter(Boolean));
  let images = 0;
  for (const [ref, obj] of objects) {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image') && !masks.has(String(ref))
      && String(obj.dict.get(PDFName.of('Width'))) === '1' && String(obj.dict.get(PDFName.of('Height'))) === '1') images += 1;
  }
  const text = doc.getPages().map((page) => {
    const raw = page.node.lookup(PDFName.of('Contents'));
    const streams = raw instanceof PDFArray ? raw.asArray().map((r) => doc.context.lookup(r)) : [raw];
    let ops = '';
    for (const s of streams) if (s instanceof PDFRawStream) ops += Buffer.from(decodePDFRawStream(s).decode()).toString('latin1');
    return [...ops.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)].map((m) => Buffer.from(m[1], 'hex').toString('latin1')).join('\n');
  }).join('\n');
  return { images, text };
}

/** Which parts' parties carry an image, by role, in a booklet envelope's model. */
function imagesByPart(model: ReturnType<typeof paperModel>) {
  return (model.parts || []).flatMap((pt) => (pt.execution?.parties || []).filter((p) => p.image).map((p) => `${pt.n}:${p.role}`));
}

// ── Refused, with nothing written ─────────────────────────────────────────

test('D759 a send is refused, with nothing written, for an open booklet, a stub part, a support session, a branch and another user', async () => {
  const f = await fixture();
  assert.equal((await f.call(APPLICANT, 'POST', '/api/fund-booklets/mine')).status, 201);
  const open = await f.call(APPLICANT, 'POST', '/api/fund-booklets/mine/sign');
  assert.equal(open.status, 409);
  assert.equal(open.body.error, 'booklet_not_submitted');
  await submitted(f);
  const support = await f.call(APPLICANT, 'POST', '/api/fund-booklets/mine/sign', undefined, { impersonatedBy: ADMIN });
  assert.equal(support.status, 403);
  const branch = await f.call(APPLICANT, 'POST', '/api/fund-booklets/mine/sign', undefined, { envExtra: { BRANCH_CODE: 'cal' } });
  assert.equal(branch.status, 403);
  assert.equal(branch.body.error, 'hq_only');
  const stranger = await f.call(STRANGER, 'POST', '/api/fund-booklets/mine/sign');
  assert.equal(stranger.status, 404);
  assert.equal(stranger.body.error, 'booklet_not_found');
  f.db.prepare("UPDATE legal_templates SET is_stub = 1 WHERE slug = 'lp_tax_status_certification'").run();
  const stub = await f.call(APPLICANT, 'POST', '/api/fund-booklets/mine/sign');
  assert.equal(stub.status, 409);
  assert.equal(stub.body.error, 'booklet_part_missing');
  assert.deepEqual(stub.body.parts, [6]);
  assert.match(stub.body.message, /Part 6 has no text from counsel/);
  assert.equal(f.count('esign_envelopes'), 0);
  assert.equal(f.count('fund_booklet_envelopes'), 0);
});

// ── The send ──────────────────────────────────────────────────────────────

test('D759 the send: one envelope over the frozen copy, its hash the booklet\'s digest, to the applicant, recorded once', async () => {
  const f = await fixture();
  const { digest } = await submitted(f);
  const sent = await sendBooklet(f);
  assert.equal(sent.stage, 'applicant');
  assert.match(sent.token, /^[A-Za-z0-9_-]{32,}$/);
  const env = f.one('SELECT * FROM esign_envelopes');
  assert.equal(env.document_type, 'subscription_booklet');
  assert.equal(env.doc_kind, 'booklet');
  assert.equal(env.axal_party, 'fund');
  assert.equal(env.document_title, stageTitle(1, 'applicant'));
  assert.equal(env.document_title, 'Subscription Booklet · v1 · Parts 3 to 8');
  assert.equal(env.body_sha256, digest);
  const booklet = f.one('SELECT frozen_json, digest FROM fund_subscription_booklets');
  assert.equal(env.document_body, booklet.frozen_json);
  const { sha256Hex } = await import('../src/services/subscriptionBooklet.ts');
  assert.equal(await sha256Hex(env.document_body), digest);
  const rcpt = f.one('SELECT user_id, recipient_email, recipient_name, signing_token FROM esign_recipients');
  assert.deepEqual([rcpt.user_id, rcpt.recipient_email, rcpt.recipient_name], [APPLICANT, 'ivy@example.test', 'Ivy Applicant']);
  assert.equal(rcpt.signing_token, sent.token);
  assert.deepEqual(f.all('SELECT stage, envelope_uuid, digest FROM fund_booklet_envelopes'), [{ stage: 'applicant', envelope_uuid: env.envelope_uuid, digest }]);

  const again = await f.call(APPLICANT, 'POST', '/api/fund-booklets/mine/sign');
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'booklet_already_sent');
  assert.equal(again.body.state, 'sent');
  assert.equal(f.count('esign_envelopes'), 1);
  assert.equal(f.count('fund_booklet_envelopes'), 1);
});

test('D759 two sends started together land one envelope and one row', async () => {
  const f = await fixture();
  await submitted(f);
  const both = await Promise.all([f.call(APPLICANT, 'POST', '/api/fund-booklets/mine/sign'), f.call(APPLICANT, 'POST', '/api/fund-booklets/mine/sign')]);
  assert.deepEqual(both.map((r) => r.status).sort(), [201, 409]);
  assert.equal(f.count('esign_envelopes'), 1);
  assert.equal(f.count('fund_booklet_envelopes'), 1);
});

test('D759 an envelope a concurrent send landed without its row is recorded as the applicant stage, once, and the route says it is already out', async () => {
  const f = await fixture();
  const { digest } = await submitted(f);
  const booklet = f.one('SELECT frozen_json FROM fund_subscription_booklets');
  // The other request's envelope: same sender, recipient and document, over the frozen copy, but its row not yet written.
  const { createAndSendEnvelope } = await import('../src/routes/esign.ts');
  const other = await createAndSendEnvelope(f.env, {
    adminUserId: APPLICANT, adminName: 'Axal VC Spin-Out Lab Fund I LP', recipientUserId: APPLICANT, recipientEmail: 'ivy@example.test',
    recipientName: 'Ivy Applicant', documentType: 'subscription_booklet', appUrl: 'https://app.example.test', viaProvider: 'native',
    renderedBody: { title: stageTitle(1, 'applicant'), body: booklet.frozen_json }, format: { kind: 'booklet', party: 'fund' },
  });
  assert.ok(other?.envelope_uuid);
  const res = await f.call(APPLICANT, 'POST', '/api/fund-booklets/mine/sign');
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'booklet_already_sent');
  assert.ok(!('token' in res.body), 'the loser is handed no token');
  assert.equal(f.count('esign_envelopes'), 1);
  assert.deepEqual(f.all('SELECT stage, envelope_uuid, digest FROM fund_booklet_envelopes'), [{ stage: 'applicant', envelope_uuid: other!.envelope_uuid, digest }]);
});

// ── The frozen text ───────────────────────────────────────────────────────

test('D759 the envelope prints the frozen text after counsel edits a part, and refuses when the frozen version cannot be rebuilt', async () => {
  const f = await fixture();
  await submitted(f);
  const sent = await sendBooklet(f);
  const current = f.one("SELECT * FROM legal_templates WHERE slug = 'lp_investor_questionnaire'");
  await updateTemplate(f.env, 'lp_investor_questionnaire', { title: current.title, category: current.category, body_md: '- [ ] I am a new kind of investor.' } as any, ADMIN);
  assert.equal(f.one("SELECT version FROM legal_templates WHERE slug = 'lp_investor_questionnaire'").version, 2);
  const paper = await f.call(APPLICANT, 'GET', `/api/legal/esign/sign/${sent.token}/paper`);
  assert.equal(paper.status, 200, JSON.stringify(paper.body));
  assert.ok(paper.body.html.includes('I am an accredited investor.'), 'the signer page prints the frozen text');
  assert.ok(!paper.body.html.includes('a new kind of investor'), 'never the edit');
  const mine = await f.call(APPLICANT, 'GET', '/api/fund-booklets/mine/paper');
  assert.equal(mine.status, 200);
  assert.ok(mine.body.html.includes('I am an accredited investor.') && !mine.body.html.includes('a new kind of investor'), 'the submitted booklet\'s own paper is frozen too');
  // The tick frozen at submit still prints as an X square, the rest empty.
  assert.equal((paper.body.html.match(/class="box x"/g) || []).length, 1, 'the one frozen tick prints');

  f.db.prepare("UPDATE legal_template_versions SET body_md = 'Rewritten.' WHERE slug = 'lp_investor_questionnaire' AND version = 1").run();
  const changed = await f.call(APPLICANT, 'GET', `/api/legal/esign/sign/${sent.token}/paper`);
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error, 'booklet_text_changed');
  const refused = await sign(f, APPLICANT, sent.token);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'booklet_text_changed');
  assert.equal(f.one('SELECT status FROM esign_recipients').status, 'pending', 'the refusal changed nothing');
  assert.equal(f.count('legal_document_files'), 0);
});

// ── The applicant signs, then the General Partner ─────────────────────────

test('D759 the applicant signs: their image on Parts 3 to 8 only, the GP stage sent to the Super Admin, and no contract_signed notice yet', async () => {
  const f = await fixture();
  const { digest } = await submitted(f);
  const sent = await sendBooklet(f);
  const before = await f.call(APPLICANT, 'GET', `/api/legal/esign/sign/${sent.token}/paper`);
  assert.ok(before.body.html.includes(RECEIVING_BRACKET), 'before acceptance the map prints the bracket');
  assert.ok(!before.body.html.includes(FUND_NUMBER.slice(-4)), 'and no account');

  // The model the signed copy is drawn from: the applicant's lines, never the Fund's.
  const rec = f.one('SELECT envelope_uuid, document_body, body_sha256 FROM esign_envelopes');
  const model = paperModel(await bookletEnvelopeModel(f.env, rec, { signature: { imageDataUrl: PNG, signedAt: '2026-10-18T09:05:41Z' } }));
  assert.deepEqual(imagesByPart(model), ['3:counterparty', '4:counterparty', '5:counterparty', '6:counterparty', '7:counterparty', '8:counterparty']);

  const signed = await sign(f, APPLICANT, sent.token);
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  assert.equal(signed.body.completed, true);
  const copy = await signedCopy(f, sent.envelope_uuid);
  assert.equal(copy.images, 6, 'one image on each applicant line: Parts 3 to 8');
  assert.ok(copy.text.includes(`Envelope ${sent.envelope_uuid}`));
  const flat = copy.text.replace(/\s+/g, ' ');
  assert.ok(flat.includes('I am an accredited investor.'), 'the fallback copy carries the parts');
  assert.ok(flat.includes('PART 9 ACCEPTANCE BY THE GENERAL PARTNER'), 'every part, to the last');

  const gp = f.one(`SELECT e.*, b.digest AS link_digest FROM fund_booklet_envelopes b JOIN esign_envelopes e ON e.envelope_uuid = b.envelope_uuid WHERE b.stage = 'gp'`);
  assert.ok(gp, 'the GP stage was sent');
  assert.equal(gp.body_sha256, digest);
  assert.equal(gp.link_digest, digest);
  assert.equal(gp.created_by, APPLICANT, 'the applicant stays the sender');
  assert.equal(gp.document_title, 'Subscription Booklet · v1 · Part 9');
  const gpRcpt = f.one('SELECT user_id, recipient_email, recipient_name FROM esign_recipients WHERE envelope_id = ?', gp.id);
  assert.deepEqual([gpRcpt.user_id, gpRcpt.recipient_email], [SIGNER, SIGNER_EMAIL]);
  assert.equal(gpRcpt.recipient_name, 'Joseph Gabriel Guillaume Lauzier');
  assert.equal(f.count("notifications_inbox WHERE type = 'contract_signed'"), 0, 'the Fund has not signed: no "fully signed" notice');
  const mine = await f.call(APPLICANT, 'GET', '/api/fund-booklets/mine');
  assert.equal(mine.body.signing.state, 'awaiting_gp');
  assert.ok(mine.body.signing.signed_at);
});

test('D759 the General Partner signs: only the Super Admin, the Fund\'s lines carry the image, the applicant\'s print as signed, and the booklet is accepted', async () => {
  const f = await fixture();
  await submitted(f);
  const sent = await sendBooklet(f);
  assert.equal((await sign(f, APPLICANT, sent.token)).status, 200);
  const token = gpToken(f);
  assert.ok(token);
  const wrong = await sign(f, APPLICANT, token);
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.code, 'signer_identity_mismatch');

  const gpUuid = f.one("SELECT envelope_uuid FROM fund_booklet_envelopes WHERE stage = 'gp'").envelope_uuid;
  const rec = f.one('SELECT envelope_uuid, document_body, body_sha256 FROM esign_envelopes WHERE envelope_uuid = ?', gpUuid);
  const model = paperModel(await bookletEnvelopeModel(f.env, rec, { signature: { imageDataUrl: PNG, signedAt: '2026-10-18T10:00:00Z' } }));
  assert.deepEqual(imagesByPart(model), ['3:axal', '9:axal']);
  const part4 = model.parts!.find((p) => p.n === 4)!.execution!.parties[0];
  assert.match(String(part4.signedLine), new RegExp(`^Signed .* · Envelope ${sent.envelope_uuid}$`), 'the applicant\'s line prints as signed, in its own envelope');
  assert.equal(part4.image, null, 'with no image: none is stored');

  const signed = await sign(f, SIGNER, token, 'Joseph Gabriel Guillaume Lauzier');
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  assert.equal(f.one('SELECT status FROM esign_envelopes WHERE envelope_uuid = ?', gpUuid).status, 'completed');
  const copy = await signedCopy(f, gpUuid);
  assert.equal(copy.images, 2, 'the GP image on Part 3\'s Fund line and Part 9');
  assert.ok(copy.text.includes(`Envelope ${sent.envelope_uuid}`), 'the applicant\'s lines print as signed');

  const mine = await f.call(APPLICANT, 'GET', '/api/fund-booklets/mine');
  assert.equal(mine.body.signing.state, 'accepted');
  assert.ok(mine.body.signing.accepted_at);
  const notice = f.one("SELECT user_id, payload FROM notifications_inbox WHERE type = 'contract_signed' AND user_id = ?", APPLICANT);
  assert.ok(notice, 'the applicant, as sender, hears it is executed');
  assert.equal(JSON.parse(notice.payload).role, 'sender');

  // The map names the receiving account only now.
  const paper = await f.call(APPLICANT, 'GET', '/api/fund-booklets/mine/paper');
  assert.ok(paper.body.html.includes(FUND_NUMBER.slice(-4)), 'an accepted booklet\'s map names the account');
  assert.ok(!paper.body.html.includes(FUND_NUMBER), 'masked, never the full number');
});

test('D759 with no Super Admin at the countersigner address the applicant\'s signature stands, and a Super Admin sends the acceptance once it exists', async () => {
  const f = await fixture({ signer: false });
  const { uid } = await submitted(f);
  const sent = await sendBooklet(f);
  const early = await f.call(SIGNER, 'POST', `/api/fund-booklets/${uid}/acceptance`);
  // No elevation yet: the act refuses before the booklet is read.
  assert.equal(early.status, 403);
  f.db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(ADMIN);
  const notSigned = await f.call(ADMIN, 'POST', `/api/fund-booklets/${uid}/acceptance`);
  assert.equal(notSigned.status, 409);
  assert.equal(notSigned.body.error, 'booklet_not_signed');

  assert.equal((await sign(f, APPLICANT, sent.token)).status, 200, 'the signature stands');
  assert.equal(f.count("fund_booklet_envelopes WHERE stage = 'gp'"), 0);
  assert.ok(lines.some((l) => l.includes('fund_signer_missing')), 'the hook logs its code');
  const missing = await f.call(ADMIN, 'POST', `/api/fund-booklets/${uid}/acceptance`);
  assert.equal(missing.status, 409);
  assert.equal(missing.body.error, 'fund_signer_missing');

  f.db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SIGNER);
  const ok = await f.call(ADMIN, 'POST', `/api/fund-booklets/${uid}/acceptance`);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.stage, 'gp');
  assert.ok(!('token' in ok.body), 'no token for an Admin');
  assert.equal(f.count("fund_booklet_envelopes WHERE stage = 'gp'"), 1);
  const twice = await f.call(ADMIN, 'POST', `/api/fund-booklets/${uid}/acceptance`);
  assert.equal(twice.status, 409);
  assert.equal(twice.body.error, 'booklet_already_sent');
  const audit = f.all("SELECT filters_json FROM admin_audit_log WHERE action = 'fund_admin.fund_booklet.accept'");
  assert.equal(audit.length, 1, 'the acceptance is audited');
  assert.ok(!audit[0].filters_json.includes('token'), 'with uids only');

  // A plain Admin and a branch never reach it.
  f.db.prepare('DELETE FROM super_admins WHERE user_id = ?').run(ADMIN);
  const plain = await f.call(ADMIN, 'POST', `/api/fund-booklets/${uid}/acceptance`);
  assert.equal(plain.status, 403);
  assert.equal(plain.body.code ?? plain.body.error, 'super_admin_required');
  const branch = await f.call(ADMIN, 'POST', `/api/fund-booklets/${uid}/acceptance`, undefined, { envExtra: { BRANCH_CODE: 'cal' } });
  assert.equal(branch.status, 403);
  assert.equal(branch.body.error, 'hq_only');
});

// ── Withdraw ──────────────────────────────────────────────────────────────

test('D759 withdrawing voids the pending envelopes, the next booklet is v2, and an accepted booklet cannot be withdrawn', async () => {
  const f = await fixture();
  const first = await submitted(f);
  const sent = await sendBooklet(f);
  const w = await f.call(ADMIN, 'POST', `/api/fund-booklets/${first.uid}/withdraw`, { reason: 'The applicant asked to correct an answer.' });
  assert.equal(w.status, 200, JSON.stringify(w.body));
  assert.equal(f.one('SELECT status FROM esign_envelopes WHERE envelope_uuid = ?', sent.envelope_uuid).status, 'void');
  const voided = await f.call(APPLICANT, 'GET', `/api/legal/esign/sign/${sent.token}`);
  assert.equal(voided.status, 410);
  assert.equal(voided.body.error, 'envelope_voided');

  const second = await submitted(f);
  const resent = await sendBooklet(f);
  assert.notEqual(resent.envelope_uuid, sent.envelope_uuid);
  assert.equal(f.one('SELECT document_title FROM esign_envelopes WHERE envelope_uuid = ?', resent.envelope_uuid).document_title, 'Subscription Booklet · v2 · Parts 3 to 8');
  assert.equal((await f.call(APPLICANT, 'GET', '/api/fund-booklets/mine')).body.edition, 2);
  const info = await f.call(APPLICANT, 'GET', `/api/legal/esign/sign/${resent.token}`);
  assert.deepEqual(info.body.booklet, { stage: 'applicant', edition: 2 });

  // The applicant signs; withdrawing now voids the GP's pending envelope and leaves theirs completed.
  assert.equal((await sign(f, APPLICANT, resent.token)).status, 200);
  const gpUuid = f.one("SELECT b.envelope_uuid FROM fund_booklet_envelopes b JOIN fund_subscription_booklets s ON s.id = b.booklet_id WHERE s.uid = ? AND b.stage = 'gp'", second.uid).envelope_uuid;
  const w2 = await f.call(ADMIN, 'POST', `/api/fund-booklets/${second.uid}/withdraw`, { reason: 'The Fund asked for a corrected booklet.' });
  assert.equal(w2.status, 200);
  assert.equal(f.one('SELECT status FROM esign_envelopes WHERE envelope_uuid = ?', resent.envelope_uuid).status, 'completed', 'a completed envelope is evidence');
  assert.equal(f.one('SELECT status FROM esign_envelopes WHERE envelope_uuid = ?', gpUuid).status, 'void');

  // An accepted booklet: the GP signs, then a withdrawal is refused.
  const third = await submitted(f);
  const t3 = await sendBooklet(f);
  assert.equal((await sign(f, APPLICANT, t3.token)).status, 200);
  const gp3 = f.one(`SELECT r.signing_token FROM esign_recipients r JOIN esign_envelopes e ON e.id = r.envelope_id
    JOIN fund_booklet_envelopes b ON b.envelope_uuid = e.envelope_uuid JOIN fund_subscription_booklets s ON s.id = b.booklet_id
    WHERE s.uid = ? AND b.stage = 'gp'`, third.uid).signing_token;
  assert.equal((await sign(f, SIGNER, gp3, 'Joseph Gabriel Guillaume Lauzier')).status, 200);
  const refused = await f.call(ADMIN, 'POST', `/api/fund-booklets/${third.uid}/withdraw`, { reason: 'Trying to undo an accepted booklet.' });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'booklet_accepted');
  assert.equal(f.one('SELECT status FROM fund_subscription_booklets WHERE uid = ?', third.uid).status, 'submitted');
});

// ── The triggers ──────────────────────────────────────────────────────────

test('D759 migration 485 refuses a row for an open booklet, under another digest, a GP row first, and any UPDATE or DELETE', async () => {
  const f = await fixture();
  assert.equal((await f.call(APPLICANT, 'POST', '/api/fund-booklets/mine')).status, 201);
  const id = f.one('SELECT id FROM fund_subscription_booklets').id;
  const ins = (stage: string, digest: string, uuid: string) =>
    () => f.db.prepare('INSERT INTO fund_booklet_envelopes (booklet_id, envelope_uuid, stage, digest) VALUES (?, ?, ?, ?)').run(id, uuid, stage, digest);
  assert.throws(ins('applicant', 'a'.repeat(64), 'u-open'), /only a submitted booklet/);
  const { digest } = await submitted(f);
  assert.throws(ins('applicant', 'b'.repeat(64), 'u-digest'), /under its own digest/);
  assert.throws(ins('gp', digest, 'u-gp-first'), /needs the applicant stage first/);
  ins('applicant', digest, 'u-ok')();
  assert.throws(() => f.db.prepare("UPDATE fund_booklet_envelopes SET envelope_uuid = 'x'").run(), /append-only \(D759\)/);
  assert.throws(() => f.db.prepare('DELETE FROM fund_booklet_envelopes').run(), /append-only \(D759\)/);
});

// ── Who sees what, and the token never copied ─────────────────────────────

test('D759 the reads: GET /mine has edition and signing and no token, the Admin\'s read has gp_sent, and only a booklet envelope says booklet', async () => {
  const f = await fixture();
  const { uid } = await submitted(f);
  const before = (await f.call(APPLICANT, 'GET', '/api/fund-booklets/mine')).body;
  assert.equal(before.edition, 1);
  assert.deepEqual(before.signing, { state: 'not_sent', signed_at: null, accepted_at: null });
  const sent = await sendBooklet(f);
  const mine = await f.call(APPLICANT, 'GET', '/api/fund-booklets/mine');
  assert.equal(mine.body.signing.state, 'sent');
  assert.ok(!JSON.stringify(mine.body).includes(sent.token), 'GET /mine never carries the token');
  const adminRead = await f.call(ADMIN, 'GET', `/api/fund-booklets/${uid}`);
  assert.equal(adminRead.status, 200);
  assert.equal(adminRead.body.gp_sent, false);
  assert.ok(!JSON.stringify(adminRead.body).includes(sent.token));
  const info = await f.call(APPLICANT, 'GET', `/api/legal/esign/sign/${sent.token}`);
  assert.deepEqual(info.body.booklet, { stage: 'applicant', edition: 1 });

  // Any other envelope answers exactly as before: no booklet field.
  f.db.prepare(`INSERT INTO esign_envelopes (envelope_uuid, user_id, document_type, document_title, document_body, body_sha256, status, created_by, audit_log)
    VALUES ('plain-envelope', ?, 'founder_nda_v1', 'Founder NDA', 'The parties agree.', ?, 'sent', ?, '[]')`).run(APPLICANT, 'c'.repeat(64), ADMIN);
  const plainToken = 'p'.repeat(43);
  f.db.prepare(`INSERT INTO esign_recipients (envelope_id, user_id, recipient_email, recipient_name, signing_token, token_expires_at, status)
    SELECT id, ?, 'ivy@example.test', 'Ivy Applicant', ?, ?, 'pending' FROM esign_envelopes WHERE envelope_uuid = 'plain-envelope'`)
    .run(APPLICANT, plainToken, new Date(Date.now() + 86_400_000).toISOString());
  const plain = await f.call(APPLICANT, 'GET', `/api/legal/esign/sign/${plainToken}`);
  assert.equal(plain.status, 200);
  assert.ok(!('booklet' in plain.body));

  // The applicant signs, the GP signs: the tokens reach no audit row and no console line.
  assert.equal((await sign(f, APPLICANT, sent.token)).status, 200);
  const gp = gpToken(f);
  assert.equal((await sign(f, SIGNER, gp, 'Joseph Gabriel Guillaume Lauzier')).status, 200);
  const tables = ['activity_logs', 'admin_audit_log'];
  try { f.one('SELECT 1 FROM esign_audit_events LIMIT 1'); tables.push('esign_audit_events'); } catch { /* not created here */ }
  for (const t of tables) {
    const rows = JSON.stringify(f.all(`SELECT * FROM ${t}`));
    assert.ok(!rows.includes(sent.token) && !rows.includes(gp), `${t} holds no token`);
  }
  assert.ok(!lines.some((l) => l.includes(sent.token) || l.includes(gp)), 'no console line holds a token');
});
