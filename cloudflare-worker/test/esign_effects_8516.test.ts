/**
 * #8516 (D8516) part 1 — the staged next-stage effect has a durable record and
 * a replay, over real SQLite: a failure after the signature commit leaves the
 * signature recorded and the effect `failed`; the replay invites the next
 * signer exactly once; the replay stops at the attempt cap; a `done` record is
 * never run again. The e-sign provider and mailer are not configured, so no
 * send leaves the process, and `fetch` throws.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/esign_effects_8516.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import esign from '../src/routes/esign.ts';
import effects from '../src/routes/esign_effects.ts';
import { MAX_EFFECT_ATTEMPTS, runEffect, sweepEffects } from '../src/services/esignEffects.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = (f: string) => readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8');
const TABLES = ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'legal_templates', 'legal_template_versions',
  'esign_envelopes', 'esign_recipients', 'notifications_inbox', 'projects', 'deals', 'commitments'];
const SCHEMA = TABLES.map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n')
  + '\n' + migration('434_contract_template_publications.sql')
  + '\n' + migration('475_legal_document_files.sql')
  + '\n' + migration('479_template_kind_party.sql')
  + '\n' + migration('633_staged_signing.sql')
  + '\n' + readdirSync(new URL('../sql/migrations/', import.meta.url)).filter((f) => /^\d{12}_8516_esign_effects\.sql$/.test(f)).map(migration).join('\n');
const SECRET = ['d8516', 'staged', 'esign', 'fixture', 'secret'].join('-');

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

async function fixture() {
  const { DB, db } = makeD1(SCHEMA);
  const u = db.prepare('INSERT INTO users (id, role, name, email, founder_id) VALUES (?, ?, ?, ?, ?)');
  for (const [id, role, name, email, founderId] of [
    [ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null], [FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 77],
    [INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null], [STRANGER, 'investor', 'Sam Stranger', 'sam@example.test', null],
    [SUPER, 'admin', 'Joseph Signer', 'signer@example.test', null], [OTHER_INVESTOR, 'investor', 'Olu Other', 'olu@example.test', null],
  ] as const) u.run(id, role, name, email, founderId);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  // Both sessions are fresh logins: the database's clock, not the test's.
  db.exec(`INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (${ADMIN}, 'totp-admin', 'totp', datetime('now')), (${SUPER}, 'totp-super', 'totp', datetime('now'))`);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (50, 'Lumen Labs', 77)`);
  db.exec(`INSERT INTO deals (id, project_id, status) VALUES (${DEAL}, 50, 'active')`);
  db.exec(`INSERT INTO commitments (id, deal_id, investor_user_id, amount, status) VALUES (${LINE}, ${DEAL}, ${INVESTOR}, 25000, 'confirmed')`);
  db.prepare(`INSERT INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub)
    VALUES ('spv_joinder', 'SPV Joinder', 'deal', ?, '["closing_date"]', 1, 1, 0)`).run(JOINDER);
  const files = fakeR2();
  const fault = { armed: 0, hits: 0 };
  const FAULTY: any = new Proxy(DB, { get(t: any, k) { return k === 'prepare' ? (sql: string) => { if (fault.armed > 0 && /INSERT INTO esign_envelopes/.test(sql)) { fault.armed -= 1; fault.hits += 1; throw new Error('provider down'); } return t.prepare(sql); } : t[k]; } });
  const env: any = { DB: FAULTY, FILES: files, JWT_SECRET: SECRET, ENVIRONMENT: 'development', APP_URL: 'https://app.example.test' };
  const app = new Hono<any>();
  app.route('/api/legal/esign/effects', effects);
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
  return { db, env, files, call, one, all, fault };
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
const APP = 'https://app.example.test';
const effectRow = (f: F) => f.one("SELECT * FROM esign_effects WHERE effect_kind = 'staged_next_stage' ORDER BY id LIMIT 1");
/** Makes the record due: the tick retries a record only after RETRY_AFTER_MINUTES. */
const age = (f: F) => f.db.exec("UPDATE esign_effects SET updated_at = datetime('now', '-10 minutes')");

async function startedAndCompanySigned(f: F, failures: number) {
  const r = await f.call(FOUNDER, 'POST', '/api/legal/esign/staged', START);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  f.fault.armed = failures; // fails the next stage's envelope insert, after the first stage went out
  return sign(f, FOUNDER, tokenOf(f, 1)!, 'Fay Founder');
}

test('a staged effect that fails after the signature commit leaves the signature recorded; the replay invites the next signer exactly once', async () => {
  const f = await fixture();
  const signed = await startedAndCompanySigned(f, 1);
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  assert.equal(f.fault.hits, 1, 'the next stage\'s send failed once');
  // The signature stays recorded.
  assert.equal(f.one("SELECT COUNT(*) AS n FROM esign_recipients WHERE status = 'signed'").n, 1);
  assert.equal(f.one("SELECT status FROM esign_envelopes ORDER BY id LIMIT 1").status, 'completed');
  assert.ok(f.one('SELECT signed_at FROM esign_staged_signers WHERE position = 1').signed_at, 'stage 1 is stamped signed');
  // The record says what happened, by class and never by message.
  const failed = effectRow(f);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.attempts, 1);
  assert.equal(failed.last_error_class, 'send_failed');
  assert.equal(failed.done_at, null);
  assert.equal(tokenOf(f, 2), undefined, 'the investor was not asked');
  // Not yet due: the tick leaves a record it touched a moment ago.
  assert.equal((await sweepEffects(f.env, APP)).due, 0);
  // Due: the replay sends the next stage.
  age(f);
  const sweep = await sweepEffects(f.env, APP);
  assert.deepEqual({ due: sweep.due, done: sweep.done, failed: sweep.failed }, { due: 1, done: 1, failed: 0 });
  const done = effectRow(f);
  assert.equal(done.state, 'done');
  assert.equal(done.attempts, 2);
  assert.equal(done.last_error_class, null);
  assert.ok(done.done_at);
  assert.ok(tokenOf(f, 2), 'the investor is invited');
  // Exactly once: more ticks and a forced run add nothing.
  age(f);
  await sweepEffects(f.env, APP);
  await runEffect(f.env, done.id, APP, { force: true });
  assert.equal(f.one('SELECT COUNT(*) AS n FROM esign_envelopes').n, 2, 'one envelope per stage, no repeat');
  assert.equal(f.one('SELECT COUNT(*) AS n FROM esign_recipients').n, 2);
  // No second signature is asked of the company: its envelope has its one signed recipient.
  assert.equal(f.one(`SELECT COUNT(*) AS n FROM esign_recipients r JOIN esign_staged_signers s ON s.envelope_uuid = (SELECT envelope_uuid FROM esign_envelopes WHERE id = r.envelope_id)
    WHERE s.position = 1 AND r.status != 'signed'`).n, 0);
  // The investor can sign it, and Axal's stage still waits for its release.
  assert.equal((await sign(f, INVESTOR, tokenOf(f, 2)!, 'Ivy Investor')).status, 200);
  assert.equal(f.one("SELECT envelope_uuid FROM esign_staged_signers WHERE role = 'axal'").envelope_uuid, null);
  for (const l of lines) assert.equal(/provider down|@example/.test(l), false, 'no message text or address reaches a log');
});

test('the replay stops at the attempt cap and leaves the record failed; an operator\'s retry runs one more', async () => {
  const f = await fixture();
  await startedAndCompanySigned(f, 1000);
  assert.equal(effectRow(f).attempts, 1);
  for (let i = 0; i < MAX_EFFECT_ATTEMPTS + 3; i++) { age(f); await sweepEffects(f.env, APP); }
  const capped = effectRow(f);
  assert.equal(capped.attempts, MAX_EFFECT_ATTEMPTS, 'never above the cap');
  assert.equal(capped.state, 'failed');
  assert.equal(capped.last_error_class, 'send_failed');
  assert.equal(f.fault.hits, MAX_EFFECT_ATTEMPTS, 'the send ran once per attempt and no more');
  assert.equal(tokenOf(f, 2), undefined);
  const direct = await runEffect(f.env, capped.id, APP);
  assert.deepEqual({ ran: direct.ran, attempts: direct.attempts }, { ran: false, attempts: MAX_EFFECT_ATTEMPTS }, 'a plain run at the cap runs nothing');
  assert.equal(f.fault.hits, MAX_EFFECT_ATTEMPTS);
  // Only a Super Admin retries by hand.
  assert.equal((await f.call(ADMIN, 'POST', `/api/legal/esign/effects/${capped.id}/retry`)).status, 403);
  assert.equal((await f.call(null, 'POST', `/api/legal/esign/effects/${capped.id}/retry`)).status, 401);
  assert.equal(effectRow(f).attempts, MAX_EFFECT_ATTEMPTS, 'a refused retry runs nothing');
  assert.equal((await f.call(SUPER, 'POST', '/api/legal/esign/effects/999/retry')).body.error, 'effect_not_found');
  f.fault.armed = 0; // the provider is back
  const retry = await f.call(SUPER, 'POST', `/api/legal/esign/effects/${capped.id}/retry`);
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.deepEqual({ ran: retry.body.ran, state: retry.body.state, attempts: retry.body.attempts }, { ran: true, state: 'done', attempts: MAX_EFFECT_ATTEMPTS + 1 });
  assert.ok(tokenOf(f, 2), 'the investor is invited by the operator\'s retry');
});

test('a replay on a done record changes nothing', async () => {
  const f = await fixture();
  const signed = await startedAndCompanySigned(f, 0);
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  const done = effectRow(f);
  assert.equal(done.state, 'done', 'the first attempt, run right after the completion, did it');
  assert.equal(done.attempts, 1);
  assert.ok(tokenOf(f, 2));
  const before = { effects: f.all('SELECT * FROM esign_effects'), envelopes: f.one('SELECT COUNT(*) AS n FROM esign_envelopes').n, stages: f.all('SELECT * FROM esign_staged_signers') };
  age(f);
  const agedRow = f.all('SELECT * FROM esign_effects');
  const sweep = await sweepEffects(f.env, APP);
  assert.equal(sweep.due, 0, 'the tick does not pick a done record up');
  const direct = await runEffect(f.env, done.id, APP);
  assert.deepEqual({ ran: direct.ran, state: direct.state }, { ran: false, state: 'done' });
  const forced = await f.call(SUPER, 'POST', `/api/legal/esign/effects/${done.id}/retry`);
  assert.deepEqual({ status: forced.status, ran: forced.body.ran, state: forced.body.state, attempts: forced.body.attempts }, { status: 200, ran: false, state: 'done', attempts: 1 });
  assert.deepEqual(f.all('SELECT * FROM esign_effects'), agedRow, 'the record is byte for byte as it was');
  assert.equal(f.one('SELECT COUNT(*) AS n FROM esign_envelopes').n, before.envelopes);
  assert.deepEqual(f.all('SELECT * FROM esign_staged_signers'), before.stages);
  assert.equal(before.effects.length, 1);
});

test('an envelope that is not a stage gets no record', async () => {
  const f = await fixture();
  const { recordRequiredEffects, requiredEffects } = await import('../src/services/esignEffects.ts');
  assert.deepEqual(requiredEffects('spv_joinder'), ['staged_next_stage']);
  f.db.exec(`INSERT INTO esign_envelopes (envelope_uuid, document_type, document_title, document_body, body_sha256, created_by, status) VALUES ('11111111-1111-4111-8111-111111111111', 'nda', 't', 'b', 'x', 1, 'completed')`);
  const id = f.one('SELECT id FROM esign_envelopes').id;
  await f.env.DB.batch(recordRequiredEffects(f.env, id, 'nda'));
  assert.equal(f.one('SELECT COUNT(*) AS n FROM esign_effects').n, 0);
});

test('a record replayed after its send already happened invites nobody again', async () => {
  const f = await fixture();
  await startedAndCompanySigned(f, 0);
  const id = effectRow(f).id;
  const invited = tokenOf(f, 2);
  assert.ok(invited);
  // The send went out but the record never learned it (a crash before the write): it reads failed.
  f.db.exec(`UPDATE esign_effects SET state = 'failed', attempts = 1, last_error_class = 'error', done_at = NULL, updated_at = datetime('now', '-10 minutes')`);
  const sweep = await sweepEffects(f.env, APP);
  assert.deepEqual({ due: sweep.due, done: sweep.done }, { due: 1, done: 1 });
  assert.equal(f.one('SELECT state FROM esign_effects WHERE id = ?', id).state, 'done');
  assert.equal(f.one('SELECT COUNT(*) AS n FROM esign_envelopes').n, 2, 'no third envelope');
  assert.equal(tokenOf(f, 2), invited, 'the investor\'s link is the one already sent');
  const { runStagedNextStage } = await import('../src/services/stagedSigning.ts');
  const uuid = f.one('SELECT envelope_uuid FROM esign_staged_signers WHERE position = 1').envelope_uuid;
  assert.equal(await runStagedNextStage(f.env, uuid, APP), 'already_sent');
  assert.equal(f.one('SELECT COUNT(*) AS n FROM esign_envelopes').n, 2);
});
