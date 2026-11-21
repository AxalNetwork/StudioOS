/**
 * D5585 part 4 (#5585, WorkGraph P1) — the `signed_document` release adapter: the release owner signs a release
 * through the native e-sign service. Real SQLite (part 2's world plus the e-sign, users and company-link tables from
 * the schema baseline), the real `createAndSendEnvelope` and `voidEnvelopeForResend`, and a stubbed `fetch` for
 * Gmail's token and send calls. No test reaches a provider.
 *
 *   1. The owner (the line's creator) is resolved and one envelope is created for them, ids only, and mailed once;
 *      the drain's cost counts the e-sign calls; a second drain sends nothing.
 *   2. A send whose answer was lost is reconciled by the next lookup, never sent again; an envelope whose mail failed
 *      is voided and sent again, so the owner is asked once, by a link that reached them.
 *   3. An owner who is deactivated, outside the release's company, or whose company is archived is refused
 *      `signer_unavailable`, and nothing is sent; missing Gmail credentials are `target_not_configured`, no call.
 *   4. Another release's envelope still pending for the owner refuses `signer_has_pending_release`.
 *   5. A takedown, a superseded release and another tenant's forged effect are still withheld, with no envelope.
 *   6. A retraction voids the envelope through the service, and a signature being recorded is waited for.
 *   7. An unmailed envelope of the effect is voided and sent again; one the owner has is not.
 *   8. (D5585-p5) The release envelope is mailed the release sign-off email, never the partner agreement email; the
 *      agreement email is unchanged for every other document; the HTML escapes the line name.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_release_signing_5585.test.ts
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { ALICE, CTX, ERIN, OTHER, approvedManifest, attestAll, campaign, clock, publish, revise, type W, world } from './_work_graph_release_world_5585.ts';
import { WORK_GRAPH_EFFECT_LIMITS } from '../src/services/workGraphEffects.ts';
import { takedownRelease } from '../src/services/workGraphReleaseTakedowns.ts';
import { ProviderMeter, drainReleaseEffects } from '../src/services/workGraphReleaseAdapters.ts';
import { RELEASE_SIGN_DOC_TYPE, releaseSignBody, releaseSignFacts, signedDocumentAdapter } from '../src/services/workGraphReleaseSigning.ts';
import { signingEmailFor } from '../src/routes/esign.ts';
import { releaseSignEmailContent } from '../src/services/email.ts';

const OWNER = (ALICE as { userId: number }).userId; // registered the line
const REF = 'owner-signoff';
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, '');
const TABLES = ['users', 'user_company_links', 'company_profiles', 'esign_envelopes', 'esign_recipients', 'esign_audit_events', 'activity_logs'];

// ---- Gmail: a stubbed fetch ----------------------------------------------------------------------------------------
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
class FakeGmail {
  sent: string[] = [];
  tokens = 0;
  failNext = false;
  install() {
    globalThis.fetch = (async (input: any, init: any = {}) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') { this.tokens++; return Response.json({ access_token: 'test-access-token' }); }
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
        if (this.failNext) { this.failNext = false; return new Response('{}', { status: 503 }); }
        this.sent.push(Buffer.from(JSON.parse(init.body).raw, 'base64url').toString('utf8'));
        return Response.json({ id: `msg-${this.sent.length}` });
      }
      throw new Error(`unexpected request ${url}`);
    }) as typeof fetch;
    return this;
  }
  get requests() { return this.tokens + this.sent.length; }
}
/** One sent message's subject, plain text and HTML, decoded from the raw MIME Gmail was given. */
function decoded(raw: string) {
  const subject = Buffer.from(/^Subject: =\?UTF-8\?B\?(.*)\?=\r?$/m.exec(raw)?.[1] ?? '', 'base64').toString('utf8');
  const [text, html] = [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g)].map((m) => Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf8'));
  return { subject, text, html, from: /^From: (.*)\r?$/m.exec(raw)?.[1] ?? '' };
}
const PARTNER_WORDING = /partner profile|Closing Binder|Axal Deals|deal@axal\.vc/;

function signingWorld() {
  const w = world();
  for (const t of TABLES) w.db.exec(stripForeignKeys(tableFromBaseline(baseline, t)));
  w.db.exec(`INSERT INTO users (id, email, name, role, is_active) VALUES (${OWNER}, 'Alice@Example.test', 'Alice Author', 'founder', 1), (99, 'x@example.test', 'X', 'founder', 1)`);
  w.db.exec(`ALTER TABLE company_profiles ADD COLUMN archived_at TEXT`); // migration 597
  w.db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (70, 'co-70', 'Acme'), (80, 'co-80', 'Other Co')`);
  w.db.exec(`INSERT INTO user_company_links (uid, company_id, user_id) VALUES ('ucl-1', 70, ${OWNER})`);
  return w;
}
function live(w: W, over: Record<string, unknown> = {}) {
  const gmail = new FakeGmail().install();
  const env = {
    DB: w.env.DB, WORK_GRAPH_RELEASE_DELIVERY: 'preview', APP_URL: 'https://app.example.test',
    GMAIL_CLIENT_ID: 'cid', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh', ...over,
  } as any;
  return { gmail, env };
}
async function shipped(w: W, ref = REF) {
  const c = await campaign(w);
  const m = await approvedManifest(w, c.line, c.p, 'm1', c.p.evidence.rev);
  const r = await publish(w, c.line, m.manifestUid, null, 'pub-m1', CTX, [{ target: 'signed_document', ref }]);
  assert.ok(r.ok, JSON.stringify(r));
  return { c, m, effectIds: r.effectIds };
}
const envelopes = (w: W) => w.db.prepare('SELECT * FROM esign_envelopes ORDER BY id').all() as any[];
const recipients = (w: W) => w.db.prepare('SELECT * FROM esign_recipients ORDER BY id').all() as any[];
const audit = (w: W, action: string) => (w.db.prepare('SELECT envelope_id FROM esign_audit_events WHERE action = ? ORDER BY id').all(action) as any[]).map((r) => r.envelope_id);
const deliveries = (w: W) => w.db.prepare('SELECT * FROM work_graph_release_deliveries ORDER BY effect_id').all() as any[];
const effectRows = (w: W) => w.db.prepare('SELECT id, effect_kind, state, attempts, last_error_code FROM work_graph_effects ORDER BY id').all() as any[];
const later = (ms: number) => { clock.t += ms; };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const lineOf = (w: W) => (w.db.prepare('SELECT line_asset_uid AS l FROM work_graph_release_lines').get() as any).l as string;
const request = (w: W, manifestUid: string, digest: string, ref = REF) => ({
  op: 'publish', idempotencyKey: `release:${manifestUid}:signed_document:${ref}`, target: 'signed_document', ref, lineAssetUid: lineOf(w),
  manifestUid, digest, audience: 'investors', components: [],
}) as any;
async function drain(env: any, opts = {}) {
  const r = await drainReleaseEffects(env, opts);
  assert.ok(r.ok, JSON.stringify(r));
  return r;
}

test('1. the release owner is resolved and one envelope is created and mailed once, ids only, with its cost', async () => {
  const w = signingWorld();
  const { c, m, effectIds } = await shipped(w);
  const { gmail, env } = live(w);
  const r = await drain(env);
  assert.deepEqual(r.results.map((x) => x.status), ['applied']);
  // Lookup (one read), send (one read, one create).
  assert.equal(r.providerRequests, 3);
  assert.equal(r.providerRequestsByTarget.signed_document, 3);
  const [e] = envelopes(w);
  assert.equal(envelopes(w).length, 1);
  assert.deepEqual([e.user_id, e.created_by, e.document_type, e.status], [OWNER, OWNER, RELEASE_SIGN_DOC_TYPE, 'sent']);
  const key = `release:${m.manifestUid}:signed_document:${REF}`;
  assert.equal(e.document_body, releaseSignBody({ idempotencyKey: key, lineAssetUid: c.line, manifestUid: m.manifestUid, digest: m.digest, ref: REF }));
  assert.equal(e.body_sha256, sha(e.document_body), 'the body hash names the effect');
  assert.ok(e.document_body.includes(m.manifestUid) && e.document_body.includes(`sha256:${m.digest}`) && e.document_body.includes(key));
  assert.ok(!/acme\/site|COMPANY_LOGOS|pitch_decks|quote_versions|vid-/.test(e.document_body), 'ids only: no source locators');
  assert.deepEqual(recipients(w).map((x) => [x.envelope_id, x.user_id, x.recipient_email, x.status]), [[e.id, OWNER, 'alice@example.test', 'pending']]);
  assert.equal(gmail.sent.length, 1);
  assert.match(gmail.sent[0], /To: alice@example\.test/i);
  assert.deepEqual(audit(w, 'email_sent'), [e.id]);
  assert.deepEqual(deliveries(w).map((d) => [d.effect_id, d.target, d.outcome, d.reconciled, d.provider_calls, d.external_ref]), [
    [effectIds[0], 'signed_document', 'confirmed', 0, 2, `esign:${e.envelope_uuid}`],
  ]);
  const again = await drain(env);
  assert.equal(again.results.length + again.providerRequests, 0);
  assert.equal(envelopes(w).length + gmail.sent.length, 2);
});

test('2. a lost answer is reconciled by lookup; a failed mail is voided and sent again, once', async () => {
  // The envelope was created and mailed, but the answer never reached the outbox.
  let w = signingWorld();
  let s = await shipped(w);
  let x = live(w);
  const real = signedDocumentAdapter(x.env, new ProviderMeter());
  let r = await drain(x.env, { adapters: { signed_document: { lookup: real.lookup, send: async (q: any) => { await real.send(q); throw new Error('socket hang up'); } } } });
  assert.deepEqual(r.results.map((e) => e.status), ['retry']);
  assert.equal(deliveries(w).length, 0, 'an answer that never came is not a delivery');
  later(WORK_GRAPH_EFFECT_LIMITS.baseBackoffMs);
  r = await drain(x.env);
  assert.deepEqual(r.results.map((e) => e.status), ['applied']);
  assert.equal(r.providerRequests, 1, 'the lookup only');
  assert.equal(envelopes(w).length, 1);
  assert.equal(x.gmail.sent.length, 1, 'never mailed twice');
  assert.deepEqual(deliveries(w).map((d) => [d.effect_id, d.outcome, d.reconciled, d.attempt, d.external_ref]), [
    [s.effectIds[0], 'confirmed', 1, 2, `esign:${envelopes(w)[0].envelope_uuid}`],
  ]);

  // Gmail refused the mail: that envelope is voided, and the next attempt sends a fresh one.
  w = signingWorld();
  await shipped(w);
  x = live(w);
  x.gmail.failNext = true;
  await drain(x.env);
  assert.deepEqual(effectRows(w).map((e) => [e.state, e.last_error_code]), [['pending', 'provider_unavailable']]);
  assert.deepEqual(envelopes(w).map((e) => e.status), ['void']);
  assert.deepEqual(recipients(w).map((e) => e.status), ['void'], 'the unmailed link cannot be used');
  later(WORK_GRAPH_EFFECT_LIMITS.baseBackoffMs);
  r = await drain(x.env);
  assert.deepEqual(r.results.map((e) => e.status), ['applied']);
  assert.deepEqual(envelopes(w).map((e) => e.status), ['void', 'sent']);
  assert.equal(envelopes(w)[0].body_sha256, envelopes(w)[1].body_sha256, 'the same effect, the same body');
  assert.equal(x.gmail.sent.length, 1);
  assert.deepEqual(deliveries(w).map((d) => [d.outcome, d.reconciled, d.external_ref]), [['confirmed', 0, `esign:${envelopes(w)[1].envelope_uuid}`]]);
});

test('3. an owner who cannot sign is refused signer_unavailable; missing credentials are target_not_configured', async () => {
  const cases: [string, (w: W) => void, string][] = [
    ['deactivated', (w) => w.db.exec(`UPDATE users SET is_active = 0 WHERE id = ${OWNER}`), 'signer_unavailable'],
    ['outside the company', (w) => w.db.exec(`UPDATE user_company_links SET company_id = 80 WHERE user_id = ${OWNER}`), 'signer_unavailable'],
    ['company archived', (w) => w.db.exec(`UPDATE company_profiles SET archived_at = '2026-11-01' WHERE id = 70`), 'signer_unavailable'],
    ['no email', (w) => w.db.exec(`UPDATE users SET email = '  ' WHERE id = ${OWNER}`), 'signer_unavailable'],
    ['no Gmail credentials', () => {}, 'target_not_configured'],
  ];
  for (const [name, arrange, code] of cases) {
    const w = signingWorld();
    await shipped(w);
    arrange(w);
    const x = live(w, code === 'target_not_configured' ? { GMAIL_REFRESH_TOKEN: undefined } : {});
    const r = await drain(x.env);
    assert.deepEqual(effectRows(w).map((e) => e.last_error_code), [code], name);
    assert.equal(r.providerRequests + x.gmail.requests + envelopes(w).length + deliveries(w).length, 0, `${name}: nothing called`);
  }
});

test('4. another release still pending for the owner refuses signer_has_pending_release', async () => {
  const w = signingWorld();
  await shipped(w);
  const x = live(w);
  // Another release's envelope (another body) waits on the owner.
  const other = signedDocumentAdapter(x.env, new ProviderMeter());
  assert.equal((await other.send(request(w, 'other', 'a'.repeat(64), 'r'))).status, 'confirmed');
  await drain(x.env);
  assert.deepEqual(effectRows(w).map((e) => e.last_error_code), ['signer_has_pending_release']);
  assert.equal(envelopes(w).length, 1);
  assert.equal(x.gmail.sent.length, 1);
});

test('5. a takedown, a superseded release and another tenant are withheld, with no envelope', async () => {
  let w = signingWorld();
  let s = await shipped(w);
  const td = await takedownRelease(w.env, CTX, {
    lineAssetUid: s.c.line, manifestUid: s.m.manifestUid, digest: s.m.digest, reasonCode: 'rights_withdrawn',
    evidenceRef: 'notice:rights-2026-11-19', authority: 'counsel', actor: ERIN, idempotencyKey: 'td-1',
  });
  assert.ok(td.ok, JSON.stringify(td));
  let x = live(w);
  let r = await drain(x.env);
  assert.deepEqual(deliveries(w).map((d) => [d.outcome, d.reason_code, d.provider_calls]), [['withheld', 'taken_down', 0]]);
  assert.equal(r.providerRequests + x.gmail.requests + envelopes(w).length, 0);

  w = signingWorld();
  s = await shipped(w);
  const copy2 = await revise(w, s.c.p.copy, 'copy-v2');
  await attestAll(w, copy2, ['marketing']);
  const m2 = await approvedManifest(w, s.c.line, { ...s.c.p, copy: copy2 }, 'm2', s.c.p.evidence.rev);
  assert.ok((await publish(w, s.c.line, m2.manifestUid, s.m.manifestUid, 'pub-m2', CTX, [])).ok);
  const forge = w.db.prepare(
    `INSERT INTO work_graph_effects (tenant_id, company_id, asset_uid, effect_kind, idempotency_key, request_hash, payload_json, max_attempts, next_attempt_ms, created_at)
     VALUES (?, ?, ?, 'release_signed_document', ?, ?, ?, 5, 0, '2026-11-19T09:00:00Z')`,
  );
  forge.run(OTHER.tenantId, OTHER.companyId, s.c.line, 'forged', 'f'.repeat(64), JSON.stringify({ audience: 'investors', digest: m2.digest, line: s.c.line, manifest: m2.manifestUid, ref: REF, target: 'signed_document' }));
  forge.run(7, 70, s.c.line, 'stale', 'e'.repeat(64), JSON.stringify({ audience: 'investors', digest: 'b'.repeat(64), line: s.c.line, manifest: m2.manifestUid, ref: REF, target: 'signed_document' }));
  x = live(w);
  r = await drain(x.env);
  assert.deepEqual(deliveries(w).map((d) => [d.tenant_id, d.outcome, d.reason_code, d.provider_calls]), [
    [7, 'superseded', 'not_head', 0], [8, 'withheld', 'wrong_tenant', 0], [7, 'withheld', 'stale_digest', 0],
  ]);
  assert.equal(r.providerRequests + x.gmail.requests + envelopes(w).length, 0);
});

test('6. a retraction voids the envelope through the service, waiting for a signature being recorded', async () => {
  const w = signingWorld();
  const s = await shipped(w);
  const x = live(w);
  await drain(x.env);
  const [e] = envelopes(w);
  // Another release's envelope for the same owner, still out for signature: a retraction of this one leaves it.
  w.db.prepare(`INSERT INTO esign_envelopes (envelope_uuid, user_id, document_type, document_title, document_body, body_sha256, status, created_by)
                VALUES ('other-env', ?, ?, 't', ?, 'x', 'sent', ?)`).run(OWNER, RELEASE_SIGN_DOC_TYPE, releaseSignBody({ ...request(w, 'other-manifest', 'c'.repeat(64)) }), OWNER);
  // The owner is mid-signature when the takedown lands: the envelope cannot be voided under them.
  w.db.exec(`UPDATE esign_recipients SET status = 'signing' WHERE envelope_id = ${e.id}`);
  const td = await takedownRelease(w.env, CTX, {
    lineAssetUid: s.c.line, manifestUid: s.m.manifestUid, digest: s.m.digest, reasonCode: 'legal_order',
    evidenceRef: 'notice:order-1', authority: 'counsel', actor: ERIN, idempotencyKey: 'td-2',
  });
  assert.ok(td.ok && td.retractEffectIds.length === 1, JSON.stringify(td));
  let r = await drain(x.env);
  assert.deepEqual(r.results.map((y) => y.status), ['retry']);
  assert.equal(effectRows(w).at(-1).last_error_code, 'signature_in_progress');
  assert.deepEqual(envelopes(w).map((y) => y.status), ['sent', 'sent']);
  w.db.exec(`UPDATE esign_recipients SET status = 'pending' WHERE envelope_id = ${e.id}`);
  later(WORK_GRAPH_EFFECT_LIMITS.baseBackoffMs);
  r = await drain(x.env);
  assert.deepEqual(r.results.map((y) => y.status), ['applied']);
  assert.deepEqual(envelopes(w).map((y) => [y.envelope_uuid, y.status, y.last_error]), [
    [e.envelope_uuid, 'void', `release ${s.m.manifestUid} retracted`], ['other-env', 'sent', null],
  ]);
  assert.deepEqual(recipients(w).map((y) => y.status), ['void']);
  assert.deepEqual(audit(w, 'envelope_voided'), [e.id]);
  const back = deliveries(w).filter((d) => d.op === 'retract');
  assert.deepEqual(back.map((d) => [d.target, d.outcome, d.reconciled, d.manifest_uid, d.external_ref]), [
    ['signed_document', 'retracted', 0, s.m.manifestUid, `esign:${e.envelope_uuid}`],
  ]);
  assert.equal(x.gmail.sent.length, 1, 'a retraction mails nobody');
});

test('7. an envelope of the effect whose mail is not recorded is voided and sent again; one the owner has is not', async () => {
  const w = signingWorld();
  const { m } = await shipped(w);
  const x = live(w);
  const meter = new ProviderMeter();
  const a = signedDocumentAdapter(x.env, meter);
  const req = request(w, m.manifestUid, m.digest);
  const first = await a.send(req);
  // The worker died between creating the envelope and recording its mail: nothing says the owner got the link.
  w.db.exec(`DELETE FROM esign_audit_events WHERE action = 'email_sent'`);
  assert.deepEqual(await a.lookup(req), { status: 'absent' });
  const second = await a.send(req);
  assert.notEqual(second.externalRef, first.externalRef);
  assert.deepEqual(envelopes(w).map((e) => [`esign:${e.envelope_uuid}`, e.status]), [[first.externalRef, 'void'], [second.externalRef, 'sent']]);
  // Sent and mailed: a later send finds it and sends nothing.
  assert.deepEqual(await a.send(req), { status: 'confirmed', externalRef: second.externalRef });
  assert.deepEqual(await a.lookup(req), { status: 'confirmed', externalRef: second.externalRef });
  assert.equal(envelopes(w).length, 2);
  assert.equal(x.gmail.sent.length, 2);
  assert.equal(meter.requests, 8, 'reads, voids and creates, each counted');
});

test('8. the release envelope is mailed the release email; the agreement email is unchanged; the HTML escapes the line', async () => {
  const w = signingWorld();
  const { c, m } = await shipped(w);
  const x = live(w);
  await drain(x.env);
  assert.equal(x.gmail.sent.length, 1);
  const mail = decoded(x.gmail.sent[0]);
  assert.equal(mail.subject, `Sign release ${c.line} (sha256:${m.digest.slice(0, 12)})`);
  assert.equal(mail.from, 'StudioOS releases <noreply@axal.vc>');
  const tok = recipients(w)[0].signing_token;
  for (const part of [mail.text, mail.html]) {
    assert.ok(part.includes(c.line) && part.includes(m.manifestUid) && part.includes(`sha256:${m.digest}`), 'names line, manifest and digest');
    assert.ok(part.includes(`https://app.example.test/esign/${tok}`), 'carries the signer\u2019s link');
    assert.ok(part.includes('Signing records your signature against this manifest digest'), 'says what signing does');
    assert.ok(part.includes('expires in 7 days'));
    assert.ok(!PARTNER_WORDING.test(part), 'a release was mailed the partner agreement wording');
  }
  assert.ok(!PARTNER_WORDING.test(mail.subject));
  assert.ok(!/acme\/site|COMPANY_LOGOS|pitch_decks|vid-/.test(mail.text + mail.html), 'ids only: no release content');

  // The body is read back exactly; a body that names no release is never sent the agreement email instead.
  assert.deepEqual(releaseSignFacts(envelopes(w)[0].document_body), { lineAssetUid: c.line, manifestUid: m.manifestUid, digest: m.digest });
  const facts = (body: string) => signingEmailFor(x.env, { documentType: RELEASE_SIGN_DOC_TYPE, documentBody: body, title: 'T' }, 'a@example.test', 'A', 'https://l', 'S');
  assert.deepEqual(await facts(envelopes(w)[0].document_body.replace('# StudioOS release sign-off', '# Something else')), { ok: false, reason: 'refused' });
  assert.deepEqual(await facts(envelopes(w)[0].document_body.replace(`sha256:${m.digest}`, 'sha256:abc')), { ok: false, reason: 'refused' });
  assert.equal(x.gmail.sent.length, 1, 'nothing mailed for a body that names no release');

  // Every other document keeps the agreement email, subject and words as before.
  assert.deepEqual(await signingEmailFor(x.env, { documentType: 'founder_nda_v1', documentBody: 'b', title: 'Mutual NDA' }, 'b@example.test', 'Bo Smith', 'https://l/esign/t', 'Sam'), { ok: true, reason: null });
  const agreement = decoded(x.gmail.sent[1]);
  assert.equal(agreement.subject, 'Your Closing Binder is ready: Mutual NDA');
  assert.equal(agreement.from, 'Axal Deals <deal@axal.vc>');
  assert.ok(agreement.text.startsWith('Hi Bo,\n\nSam has verified your partner profile and assigned your Closing Binder:'));

  // The line name is the line's uid, which the caller chose: the HTML escapes it, the subject and text carry it as is.
  const evil = releaseSignEmailContent({ recipientName: '<i>Al</i>', lineAssetUid: `l<u>"&'`, manifestUid: 'm<b>', digest: m.digest, signLink: 'https://l/esign/t' });
  assert.ok(evil.html.includes('l&lt;u&gt;&quot;&amp;&#39;') && evil.html.includes('m&lt;b&gt;') && evil.html.includes('&lt;i&gt;Al&lt;/i&gt;'));
  assert.ok(!/<u>|<b>|<i>/.test(evil.html), 'unescaped markup in the HTML');
  assert.equal(evil.subject, `Sign release l<u>"&' (sha256:${m.digest.slice(0, 12)})`);
});
