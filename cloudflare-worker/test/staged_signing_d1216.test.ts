/**
 * D1216 (#3213, Closing part 3) — one document signed in order by the
 * company, the investor and Axal, over real SQLite: each stage is its own
 * envelope over the same text, sent only when the stage ahead of it has signed;
 * Axal's stage is released by a Super Admin with a fresh step-up.
 *
 * The issue's tests: the booklet's tests still pass (booklet_esign_d759 is
 * untouched and runs in the same suite); a countersign without step-up is
 * refused; an out-of-order signature is refused.
 *
 * The fixture is the baseline's tables plus migrations 434, 475, 479 and 624,
 * the e-sign routes on one app, an in-memory R2, and no Browser Run binding,
 * so each signed copy is drawn by pdf-lib. `globalThis.fetch` throws, and the
 * file ends by asserting it was never called.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/staged_signing_d1216.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import esign from '../src/routes/esign.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { COUNSEL_DRAFT_LINE, previewText } from '../src/services/stagedSigning.ts';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = (f: string) => readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8');
const TABLES = ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'legal_templates', 'legal_template_versions',
  'esign_envelopes', 'esign_recipients', 'notifications_inbox', 'projects', 'deals', 'commitments'];
const SCHEMA = TABLES.map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n')
  + '\n' + migration('434_contract_template_publications.sql')
  + '\n' + migration('475_legal_document_files.sql')
  + '\n' + migration('479_template_kind_party.sql')
  + '\n' + migration('624_staged_signing.sql');
const SECRET = ['d1216', 'staged', 'esign', 'fixture', 'secret'].join('-');

const ADMIN = 1, FOUNDER = 2, INVESTOR = 3, STRANGER = 4, SUPER = 6, OTHER_INVESTOR = 7;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const DEAL = 30, LINE = 40;
// A synthetic joinder: one slot the closing fills once for everyone.
const JOINDER = '## SPV Joinder\nThe investor joins the SPV for the closing dated {{closing_date}}.';

const realFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async () => { fetchCalls += 1; throw new Error('fetch must not be called'); }) as typeof fetch;
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
    async get(key: string) { const b = objects.get(key); return b ? { arrayBuffer: async () => b.slice().buffer } : null; },
  };
}

async function fixture(opts: { superStepUp?: boolean } = {}) {
  const { DB, db } = makeD1(SCHEMA);
  const u = db.prepare('INSERT INTO users (id, role, name, email, founder_id) VALUES (?, ?, ?, ?, ?)');
  for (const [id, role, name, email, founderId] of [
    [ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null], [FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 77],
    [INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null], [STRANGER, 'investor', 'Sam Stranger', 'sam@example.test', null],
    [SUPER, 'admin', 'Joseph Signer', 'signer@example.test', null], [OTHER_INVESTOR, 'investor', 'Olu Other', 'olu@example.test', null],
  ] as const) u.run(id, role, name, email, founderId);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  const s = db.prepare('INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, ?, ?)');
  s.run(ADMIN, 'totp-admin', 'totp', new Date().toISOString().replace('T', ' ').slice(0, 19));
  // The Super Admin's session: a TOTP login today, or one a day old with no step-up since.
  s.run(SUPER, 'totp-super', 'totp', opts.superStepUp === false
    ? new Date(Date.now() - 86400000).toISOString().replace('T', ' ').slice(0, 19)
    : new Date().toISOString().replace('T', ' ').slice(0, 19));
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (50, 'Lumen Labs', 77)`);
  db.exec(`INSERT INTO deals (id, project_id, status) VALUES (${DEAL}, 50, 'active')`);
  db.exec(`INSERT INTO commitments (id, deal_id, investor_user_id, amount, status) VALUES (${LINE}, ${DEAL}, ${INVESTOR}, 25000, 'confirmed')`);
  db.prepare(`INSERT INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub)
    VALUES ('spv_joinder', 'SPV Joinder', 'deal', ?, '["closing_date"]', 1, 1, 0)`).run(JOINDER);
  const files = fakeR2();
  const env: any = { DB, FILES: files, JWT_SECRET: SECRET, ENVIRONMENT: 'development', APP_URL: 'https://app.example.test' };
  const app = new Hono<any>();
  app.route('/api/legal/esign', esign);
  app.onError((e: any, c) => {
    const m = String(e?.message ?? '');
    if (m === 'Super admin required') return c.json({ code: 'super_admin_required' }, 403);
    if (m === 'step_up_required') return c.json({ detail: 'step_up_required' }, 403);
    if (m === 'Unauthorized') return c.json({ detail: 'Unauthorized' }, 401);
    throw e;
  });
  async function call(who: number | null, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (who) {
      const jti = who === ADMIN ? 'totp-admin' : who === SUPER ? 'totp-super' : undefined;
      headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, ...(jti ? { jti } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
    }
    const res = await withThrownResponses(() => app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env));
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  }
  const one = (sql: string, ...a: unknown[]) => { const r = db.prepare(sql).get(...a); return r ? { ...(r as any) } : null; };
  const all = (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
  return { db, env, files, call, one, all };
}
type F = Awaited<ReturnType<typeof fixture>>;

const START = {
  deal_id: DEAL, commitment_id: LINE, document_type: 'spv_joinder', fields: { closing_date: '2026-11-30' },
  signers: [{ role: 'company', user_id: FOUNDER }, { role: 'investor', user_id: INVESTOR }], countersign: true,
};
const tokenOf = (f: F, position: number) => f.one(`SELECT r.signing_token FROM esign_recipients r JOIN esign_envelopes e ON e.id = r.envelope_id
  JOIN esign_staged_signers s ON s.envelope_uuid = e.envelope_uuid WHERE s.position = ?`, position)?.signing_token as string | undefined;
const sign = (f: F, who: number, token: string, name: string) =>
  f.call(who, 'POST', `/api/legal/esign/sign/${token}`, { accepted: true, typed_name: name, signature_data_url: PNG });

async function started(f: F) {
  const r = await f.call(FOUNDER, 'POST', '/api/legal/esign/staged', START);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.uid as string;
}

// ── the order ─────────────────────────────────────────────────────────────

test('stage 1 goes to the company; the next stage is sent only when it signs; every stage signs the same text', async () => {
  const f = await fixture();
  const uid = await started(f);
  assert.equal(f.all('SELECT * FROM esign_staged_signers ORDER BY position').map((s) => s.role).join(','), 'company,investor,axal');
  assert.ok(tokenOf(f, 1), 'the company is out for signature');
  assert.equal(tokenOf(f, 2), undefined, 'the investor waits');
  const before = await f.call(FOUNDER, 'GET', `/api/legal/esign/staged/${uid}`);
  assert.deepEqual(before.body.stages.map((s: any) => s.state), ['sent', 'waiting', 'waiting']);
  assert.deepEqual(before.body.closing, { deal_id: DEAL, commitment_id: LINE });
  const signed1 = await sign(f, FOUNDER, tokenOf(f, 1)!, 'Fay Founder');
  assert.equal(signed1.status, 200, JSON.stringify(signed1.body));
  assert.ok(tokenOf(f, 2), 'the investor is sent when the company signs');
  lines.length = 0;
  const signed2 = await sign(f, INVESTOR, tokenOf(f, 2)!, 'Ivy Investor');
  assert.equal(signed2.status, 200, JSON.stringify(signed2.body));
  assert.equal(lines.some((l) => l.includes('next stage not sent')), false, 'the completion never tries to send Axal\'s stage');
  const after2 = await f.call(INVESTOR, 'GET', `/api/legal/esign/staged/${uid}`);
  assert.deepEqual(after2.body.stages.map((s: any) => s.state), ['signed', 'signed', 'awaiting_release'], 'Axal\'s stage waits for its release, never sent on its own');
  const digest = f.one('SELECT digest FROM esign_staged_envelopes').digest;
  const hashes = f.all(`SELECT e.body_sha256 FROM esign_envelopes e JOIN esign_staged_signers s ON s.envelope_uuid = e.envelope_uuid`);
  assert.ok(hashes.length === 2 && hashes.every((h) => h.body_sha256 === digest), 'each stage signs exactly the recorded text');
  assert.match(f.one('SELECT body FROM esign_staged_envelopes').body, /dated 2026-11-30/, 'filled once, for everyone');
});

test('an out-of-order signature is refused: a stage cannot be sent, or released, before the one ahead of it signs', async () => {
  const f = await fixture();
  const uid = await started(f);
  // Axal before the investor: refused, nothing sent.
  const early = await f.call(SUPER, 'POST', `/api/legal/esign/staged/${uid}/countersign`);
  assert.equal(early.status, 409, JSON.stringify(early.body));
  assert.equal(early.body.error, 'not_your_turn');
  assert.equal(f.one("SELECT envelope_uuid FROM esign_staged_signers WHERE role = 'axal'").envelope_uuid, null);
  // And the database refuses it even if a route forgot the order.
  assert.throws(() => f.db.prepare("UPDATE esign_staged_signers SET envelope_uuid = 'x' WHERE position = 2").run(), /only after every stage ahead/);
  // The investor cannot sign the company's stage: the token is the company's.
  const wrong = await sign(f, INVESTOR, tokenOf(f, 1)!, 'Ivy Investor');
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.code, 'signer_identity_mismatch');
});

test('a countersign without step-up is refused; with it, Axal signs last and the envelope is complete', async () => {
  const stale = await fixture({ superStepUp: false });
  const uid0 = await started(stale);
  await sign(stale, FOUNDER, tokenOf(stale, 1)!, 'Fay Founder');
  await sign(stale, INVESTOR, tokenOf(stale, 2)!, 'Ivy Investor');
  const refused = await stale.call(SUPER, 'POST', `/api/legal/esign/staged/${uid0}/countersign`);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.detail, 'step_up_required');
  assert.equal(stale.one("SELECT envelope_uuid FROM esign_staged_signers WHERE role = 'axal'").envelope_uuid, null, 'nothing was sent');

  const f = await fixture();
  const uid = await started(f);
  await sign(f, FOUNDER, tokenOf(f, 1)!, 'Fay Founder');
  await sign(f, INVESTOR, tokenOf(f, 2)!, 'Ivy Investor');
  // An admin who is not a Super Admin cannot release it.
  assert.equal((await f.call(ADMIN, 'POST', `/api/legal/esign/staged/${uid}/countersign`)).status, 403);
  const released = await f.call(SUPER, 'POST', `/api/legal/esign/staged/${uid}/countersign`);
  assert.equal(released.status, 200, JSON.stringify(released.body));
  assert.match(released.body.token, /^[A-Za-z0-9_-]{32,}$/);
  assert.equal(f.one("SELECT user_id FROM esign_staged_signers WHERE role = 'axal'").user_id, SUPER, 'the stage names who released it');
  assert.equal((await f.call(SUPER, 'POST', `/api/legal/esign/staged/${uid}/countersign`)).body.error, 'stage_already_sent', 'released once');
  const done = await sign(f, SUPER, released.body.token, 'Joseph Signer');
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const read = await f.call(FOUNDER, 'GET', `/api/legal/esign/staged/${uid}`);
  assert.equal(read.body.complete, true);
  assert.deepEqual(read.body.stages.map((s: any) => s.state), ['signed', 'signed', 'signed']);
  for (const l of lines) assert.equal(l.includes(released.body.token), false, 'a token never reaches a log');
});

// ── who reads, who starts ─────────────────────────────────────────────────

test('the status reads for the founder, the line\'s investor and admins; anyone else reads 404', async () => {
  const f = await fixture();
  const uid = await started(f);
  for (const who of [FOUNDER, INVESTOR, ADMIN]) assert.equal((await f.call(who, 'GET', `/api/legal/esign/staged/${uid}`)).status, 200, String(who));
  for (const who of [STRANGER, OTHER_INVESTOR]) assert.equal((await f.call(who, 'GET', `/api/legal/esign/staged/${uid}`)).status, 404, String(who));
  // Signed envelopes link to their closing line.
  const line = await f.call(INVESTOR, 'GET', `/api/legal/esign/staged/line/${LINE}`);
  assert.equal(line.status, 200, JSON.stringify(line.body));
  assert.deepEqual(line.body.closing, { deal_id: DEAL, commitment_id: LINE });
  assert.deepEqual(line.body.envelopes.map((e: any) => e.uid), [uid]);
  assert.equal((await f.call(STRANGER, 'GET', `/api/legal/esign/staged/line/${LINE}`)).status, 404);
});

test('only the closing\'s founder or an admin starts one; each signer is an account; the investor is the line\'s', async () => {
  const f = await fixture();
  assert.equal((await f.call(INVESTOR, 'POST', '/api/legal/esign/staged', START)).status, 404, 'an investor does not start the paper');
  const other = await f.call(FOUNDER, 'POST', '/api/legal/esign/staged', { ...START, signers: [{ role: 'company', user_id: FOUNDER }, { role: 'investor', user_id: OTHER_INVESTOR }] });
  assert.equal(other.status, 400);
  assert.equal(other.body.error, 'investor_not_on_line');
  const axal = await f.call(FOUNDER, 'POST', '/api/legal/esign/staged', { ...START, signers: [{ role: 'axal', user_id: SUPER }] });
  assert.equal(axal.body.error, 'signer_role', 'Axal is added through countersign, last');
  const unfilled = await f.call(FOUNDER, 'POST', '/api/legal/esign/staged', { ...START, fields: {} });
  assert.equal(unfilled.body.error, 'fields_unfilled');
  assert.deepEqual(unfilled.body.fields, ['closing_date']);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM esign_staged_envelopes').n, 0, 'nothing recorded for a refused start');
  assert.equal((await f.call(ADMIN, 'POST', '/api/legal/esign/staged', START)).status, 201, 'an admin may start it');
  // Without countersign there is no Axal stage, and nothing to release.
  const plain = await f.call(FOUNDER, 'POST', '/api/legal/esign/staged', { ...START, countersign: false, signers: [{ role: 'company', user_id: FOUNDER }] });
  assert.equal(plain.status, 201);
  assert.equal((await f.call(SUPER, 'POST', `/api/legal/esign/staged/${plain.body.uid}/countersign`)).body.error, 'no_countersign');
});

// ── counsel's text ────────────────────────────────────────────────────────

test('a counsel draft (a SAFE, until D578\'s text) is previewed with its sentence, and never sent', async () => {
  const f = await fixture();
  const draft = { document_type: 'safe', title: 'SAFE (post-money, cap)', body: 'DRAFT — The investor pays the purchase amount on {{closing_date}}.', fields: { closing_date: '2026-11-30' } };
  const p = await f.call(FOUNDER, 'POST', '/api/legal/esign/staged/preview', draft);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.sendable, false);
  assert.equal(p.body.line, COUNSEL_DRAFT_LINE);
  assert.match(p.body.body, /on 2026-11-30/);
  const send = await f.call(FOUNDER, 'POST', '/api/legal/esign/staged', { ...START, document_type: 'safe' });
  assert.equal(send.status, 409);
  assert.equal(send.body.error, 'counsel_draft_only');
  assert.equal(send.body.message, COUNSEL_DRAFT_LINE);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM esign_envelopes').n, 0, 'nothing sent');
  // With counsel's text on file, the preview is the text and it is sendable.
  const ok = await previewText(f.env, 'spv_joinder', { closing_date: '2026-11-30' });
  assert.equal(ok.sendable, true);
  assert.equal(ok.line, null);
});

// ── the store ─────────────────────────────────────────────────────────────

test('the store holds the order: an axal stage needs countersign and is last; the text never changes', async () => {
  const f = await fixture();
  const uid = await started(f);
  const id = f.one('SELECT id FROM esign_staged_envelopes WHERE uid = ?', uid).id;
  assert.throws(() => f.db.prepare("INSERT INTO esign_staged_signers (staged_id, position, role) VALUES (?, 9, 'company')").run(id), /axal stage is the last/);
  f.db.exec(`INSERT INTO esign_staged_envelopes (deal_id, document_type, title, body, digest, countersign, created_by)
    VALUES (${DEAL}, 'spv_joinder', 't', 'b', '${'0'.repeat(64)}', 0, 1)`);
  const plain = f.one('SELECT id FROM esign_staged_envelopes WHERE countersign = 0').id;
  assert.throws(() => f.db.prepare("INSERT INTO esign_staged_signers (staged_id, position, role) VALUES (?, 1, 'axal')").run(plain), /needs countersign/);
  assert.throws(() => f.db.prepare("UPDATE esign_staged_envelopes SET body = 'other words' WHERE uid = ?").run(uid), /only voided_at/);
  await sign(f, FOUNDER, tokenOf(f, 1)!, 'Fay Founder');
  assert.throws(() => f.db.prepare('UPDATE esign_staged_signers SET signed_at = datetime(\'now\', \'+1 day\') WHERE position = 1').run(), /signed once/);
});
