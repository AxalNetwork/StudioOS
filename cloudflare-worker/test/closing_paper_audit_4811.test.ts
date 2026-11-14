/**
 * D4811 (#4811) part 24 — a closing's paper is on the agreement lifecycle
 * (part 22), so its transitions are audited as an agreement's are, over real
 * SQLite with D1216's routes:
 *   - an admin who starts the paper on a founder's closing writes
 *     `closing_paper_sent` through `logAdminAction` (both audit stores);
 *     the founder starting their own paper writes only the e-sign trail;
 *   - the Super Admin who releases Axal's countersign writes
 *     `closing_paper_countersign_released` under their own id; a refused
 *     release writes nothing;
 *   - an envelope voided because its text did not match the recorded digest
 *     writes `envelope_voided` to its own trail, as a sender's void does.
 * No row carries a token, a name, an email or the text.
 * Every name and address is synthetic.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/closing_paper_audit_4811.test.ts
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

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = (f: string) => readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8');
const TABLES = ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'legal_templates', 'legal_template_versions',
  'esign_envelopes', 'esign_recipients', 'notifications_inbox', 'projects', 'deals', 'commitments'];
const SCHEMA = TABLES.map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n')
  + '\n' + migration('434_contract_template_publications.sql')
  + '\n' + migration('475_legal_document_files.sql')
  + '\n' + migration('479_template_kind_party.sql')
  + '\n' + migration('633_staged_signing.sql');
const SECRET = ['d4811', 'p23', 'audit', 'fixture'].join('-');

const ADMIN = 1, FOUNDER = 2, INVESTOR = 3, SUPER = 6;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const DEAL = 30, LINE = 40;
const JOINDER = '## SPV Joinder\nThe investor joins the SPV for the closing dated {{closing_date}}.';
const START = {
  deal_id: DEAL, commitment_id: LINE, document_type: 'spv_joinder', fields: { closing_date: '2026-11-30' },
  signers: [{ role: 'company', user_id: FOUNDER }, { role: 'investor', user_id: INVESTOR }], countersign: true,
};

const realFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async () => { fetchCalls += 1; throw new Error('fetch must not be called'); }) as typeof fetch;
const realConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info };
for (const k of ['log', 'warn', 'error', 'info'] as const) (console as any)[k] = () => {};
after(() => {
  globalThis.fetch = realFetch;
  Object.assign(console, realConsole);
  assert.equal(fetchCalls, 0, 'nothing reached the network');
});

function fakeR2() {
  const objects = new Map<string, Uint8Array>();
  return {
    async put(key: string, bytes: Uint8Array) { objects.set(key, bytes); },
    async get(key: string) { const b = objects.get(key); return b ? { arrayBuffer: async () => b.slice().buffer } : null; },
  };
}

async function fixture() {
  const { DB, db } = makeD1(SCHEMA);
  const u = db.prepare('INSERT INTO users (id, role, name, email, founder_id) VALUES (?, ?, ?, ?, ?)');
  for (const [id, role, name, email, founderId] of [
    [ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null], [FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 77],
    [INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null], [SUPER, 'admin', 'Joseph Signer', 'signer@example.test', null],
  ] as const) u.run(id, role, name, email, founderId);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  // The step-up gate compares a session's TOTP login with the Worker's own clock, so the session is minted from it.
  const today = new Date().toISOString().replace('T', ' ').slice(0, 19); // clock-ok: relative
  const s = db.prepare('INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, ?, ?)');
  s.run(ADMIN, 'totp-admin', 'totp', today);
  s.run(SUPER, 'totp-super', 'totp', today);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (50, 'Synthetic Labs', 77)`);
  db.exec(`INSERT INTO deals (id, project_id, status) VALUES (${DEAL}, 50, 'active')`);
  db.exec(`INSERT INTO commitments (id, deal_id, investor_user_id, amount, status) VALUES (${LINE}, ${DEAL}, ${INVESTOR}, 25000, 'confirmed')`);
  db.prepare(`INSERT INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub)
    VALUES ('spv_joinder', 'SPV Joinder', 'deal', ?, '["closing_date"]', 1, 1, 0)`).run(JOINDER);
  const env: any = { DB, FILES: fakeR2(), JWT_SECRET: SECRET, ENVIRONMENT: 'development', APP_URL: 'https://app.example.test' };
  const app = new Hono<any>();
  app.route('/api/legal/esign', esign);
  app.onError((e: any, c) => {
    const m = String(e?.message ?? '');
    if (m === 'Super admin required') return c.json({ code: 'super_admin_required' }, 403);
    if (m === 'step_up_required') return c.json({ detail: 'step_up_required' }, 403);
    throw e;
  });
  async function call(who: number, method: string, path: string, body?: unknown) {
    const jti = who === ADMIN ? 'totp-admin' : who === SUPER ? 'totp-super' : undefined;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await new SignJWT({ user_id: who, ...(jti ? { jti } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`,
    };
    const res = await withThrownResponses(() => app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env));
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  }
  const one = (sql: string, ...a: unknown[]) => { const r = db.prepare(sql).get(...a); return r ? { ...(r as any) } : null; };
  const all = (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
  return { db, call, one, all };
}
type F = Awaited<ReturnType<typeof fixture>>;

const tokenOf = (f: F, position: number) => f.one(`SELECT r.signing_token FROM esign_recipients r JOIN esign_envelopes e ON e.id = r.envelope_id
  JOIN esign_staged_signers s ON s.envelope_uuid = e.envelope_uuid WHERE s.position = ?`, position)?.signing_token as string | undefined;
const sign = (f: F, who: number, token: string, name: string) =>
  f.call(who, 'POST', `/api/legal/esign/sign/${token}`, { accepted: true, typed_name: name, signature_data_url: PNG });
const rows = (f: F, action: string) => ({
  activity: f.all('SELECT user_id, details, actor FROM activity_logs WHERE action = ?', action),
  admin: f.all('SELECT admin_user_id, filters_json FROM admin_audit_log WHERE action = ?', action),
});
const SECRETS = /ada@|fay@|ivy@|signer@|Fay Founder|Ivy Investor|Joseph Signer|joins the SPV|signing_token/;

test('an admin starting the paper on a founder\'s closing writes closing_paper_sent in both stores; the founder\'s own start does not', async () => {
  // Mutation checked: drop the `caller.role === 'admin'` audit → the admin rows fail;
  // write it for every caller → the founder's zero fails; drop `lifecycle` → the details fail.
  const f = await fixture();
  const own = await f.call(FOUNDER, 'POST', '/api/legal/esign/staged', START);
  assert.equal(own.status, 201, JSON.stringify(own.body));
  assert.deepEqual(rows(f, 'closing_paper_sent'), { activity: [], admin: [] }, 'the founder acts for no one else');
  assert.ok(f.all("SELECT 1 FROM activity_logs WHERE action = 'esign_envelope_created'").length >= 1, 'the stage\'s own e-sign trail is written');

  const byAdmin = await f.call(ADMIN, 'POST', '/api/legal/esign/staged', START);
  assert.equal(byAdmin.status, 201, JSON.stringify(byAdmin.body));
  const { activity, admin } = rows(f, 'closing_paper_sent');
  assert.equal(activity.length, 1);
  assert.equal(admin.length, 1);
  assert.equal(activity[0].user_id, ADMIN);
  assert.equal(admin[0].admin_user_id, ADMIN);
  const details = JSON.parse(activity[0].details);
  const envelope = f.one('SELECT s.envelope_uuid FROM esign_staged_signers s JOIN esign_staged_envelopes e ON e.id = s.staged_id WHERE e.uid = ? AND s.position = 1', byAdmin.body.uid);
  assert.deepEqual(details, {
    uid: byAdmin.body.uid, deal_id: DEAL, commitment_id: LINE, document_type: 'spv_joinder',
    stages: 3, countersign: true, position: 1, envelope_uuid: envelope.envelope_uuid, lifecycle: 'sent',
  });
  assert.equal(admin[0].filters_json, activity[0].details, 'both stores hold the same row');
  assert.doesNotMatch(activity[0].details + activity[0].actor, SECRETS);
});

test('a start refused after its paper is recorded writes no audit row', async () => {
  // Mutation checked: audit before `sendStage` → the refused send leaves a row and fails.
  const f = await fixture();
  f.db.exec(`CREATE TRIGGER t_text_changed AFTER INSERT ON esign_envelopes BEGIN
    UPDATE esign_envelopes SET body_sha256 = '${'f'.repeat(64)}' WHERE id = NEW.id; END;`);
  const refused = await f.call(ADMIN, 'POST', '/api/legal/esign/staged', START);
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal(f.one('SELECT COUNT(*) AS n FROM esign_staged_envelopes').n, 1, 'the paper was recorded before the send failed');
  assert.deepEqual(rows(f, 'closing_paper_sent'), { activity: [], admin: [] });
});

test('the Super Admin\'s countersign release is audited under their own id; a release out of turn writes nothing', async () => {
  // Mutation checked: drop the release audit → the rows fail; log it with `staged.created_by` → the actor fails;
  // audit before `sendStage` → the early release leaves a row and fails.
  const f = await fixture();
  const started = await f.call(FOUNDER, 'POST', '/api/legal/esign/staged', START);
  const uid = started.body.uid as string;
  const early = await f.call(SUPER, 'POST', `/api/legal/esign/staged/${uid}/countersign`);
  assert.equal(early.status, 409);
  assert.deepEqual(rows(f, 'closing_paper_countersign_released'), { activity: [], admin: [] }, 'nothing released, nothing recorded');

  await sign(f, FOUNDER, tokenOf(f, 1)!, 'Fay Founder');
  await sign(f, INVESTOR, tokenOf(f, 2)!, 'Ivy Investor');
  const released = await f.call(SUPER, 'POST', `/api/legal/esign/staged/${uid}/countersign`);
  assert.equal(released.status, 200, JSON.stringify(released.body));
  const { activity, admin } = rows(f, 'closing_paper_countersign_released');
  assert.equal(activity.length, 1);
  assert.equal(activity[0].user_id, SUPER, 'the stage\'s e-sign trail names the paper\'s creator; this row names who released it');
  assert.equal(admin[0].admin_user_id, SUPER);
  const axal = f.one("SELECT envelope_uuid, position FROM esign_staged_signers WHERE role = 'axal'");
  assert.deepEqual(JSON.parse(activity[0].details), {
    uid, deal_id: DEAL, commitment_id: LINE, position: axal.position, envelope_uuid: axal.envelope_uuid, lifecycle: 'sent',
  });
  assert.doesNotMatch(activity[0].details + activity[0].actor, SECRETS);
  assert.equal(activity[0].details.includes(released.body.token), false, 'the signing token is never audited');
});

test('an envelope voided because its text changed is audited as a sender\'s void is; the stage records nothing', async () => {
  // Mutation checked: drop the appendAudit call → the trail fails; write it as 'envelope_created' → the trail fails;
  // drop `reason` from its meta → the reason fails.
  const f = await fixture();
  // Every envelope's stored digest is altered on insert, as if the text had changed on its way out.
  f.db.exec(`CREATE TRIGGER t_text_changed AFTER INSERT ON esign_envelopes BEGIN
    UPDATE esign_envelopes SET body_sha256 = '${'f'.repeat(64)}' WHERE id = NEW.id; END;`);
  const r = await f.call(FOUNDER, 'POST', '/api/legal/esign/staged', START);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, 'text_changed');
  const envelope = f.one('SELECT id, status FROM esign_envelopes');
  assert.equal(envelope.status, 'void');
  const trail = f.all("SELECT signer_id, signer_email, action, ip, meta FROM esign_audit_events WHERE envelope_id = ? AND action = 'envelope_voided'", envelope.id);
  assert.equal(trail.length, 1);
  assert.equal(trail[0].signer_id, FOUNDER);
  assert.equal(trail[0].signer_email, null);
  assert.equal(trail[0].ip, 'system', 'as the workflow void writes it');
  const meta = JSON.parse(trail[0].meta);
  assert.equal(meta.by, 'system');
  assert.equal(meta.reason, 'text_changed');
  assert.equal(meta.position, 1);
  assert.equal(meta.staged_uid, f.one('SELECT uid FROM esign_staged_envelopes').uid);
  assert.equal(f.all("SELECT 1 FROM activity_logs WHERE action = 'esign_envelope_voided'").length, 1, 'mirrored to the global feed');
  assert.equal(f.one('SELECT envelope_uuid FROM esign_staged_signers WHERE position = 1').envelope_uuid, null, 'the stage records no envelope');
});
