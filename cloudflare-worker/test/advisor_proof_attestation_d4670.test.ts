/**
 * D4670 (#4670) — an advisor's proof claim is confirmed by the person named,
 * never by whoever holds the link, and only an Advisor keeps an advisor
 * profile. Synthetic fixtures only: the real router over in-memory SQLite,
 * the tables built from the migration files themselves.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import advisors from '../src/routes/advisors.ts';
import { attestationMailer, claimSha256, consentState, maskEmail, newCode } from '../src/services/advisorProofAttestation.ts';

const SQL = resolve(dirname(fileURLToPath(import.meta.url)), '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const migration = (n: string) => readFileSync(`${SQL}/migrations/${n}.sql`, 'utf8');

const ADA = 80, FOUNDER = 81, DUAL = 82, ADMIN = 83, ADVISOR_NO_PROFILE = 84;

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() { const r = db.prepare(sql).run(...b); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const o = []; for (const st of x || []) o.push(await st.run().catch(() => ({}))); return o; },
  };
}

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: true });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, advisor_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE cohort_cycles (id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER, month INTEGER, start_at TEXT, end_at TEXT, status TEXT);
    CREATE TABLE advisor_bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, slot_id INTEGER NOT NULL,
      advisor_id INTEGER NOT NULL, founder_user_id INTEGER NOT NULL, topic TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'pending',
      cancel_reason TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  for (const m of ['201_advisors_table_in_ledger', '202_advisor_profile_fields', '204_advisor_proof', '202611062216_advisor_proof_attestation', '202611041822_account_licences']) db.exec(migration(m));
  const u = db.prepare('INSERT INTO users (id, role, advisor_id, name, email) VALUES (?,?,?,?,?)');
  u.run(ADA, 'advisor', 1, 'Ada', 'ada@example.com');
  u.run(FOUNDER, 'founder', null, 'Fran', 'fran@example.com');
  u.run(DUAL, 'founder', null, 'Dee', 'dee@example.com');
  u.run(ADMIN, 'admin', null, 'Root', 'root@example.com');
  u.run(ADVISOR_NO_PROFILE, 'advisor', null, 'Nia', 'nia@example.com');
  db.prepare("INSERT INTO account_licences (user_id, licence, source) VALUES (?, 'founder', 'primary'), (?, 'advisor', 'admin_grant')").run(DUAL, DUAL);
  db.prepare('INSERT INTO advisors (id, uid, user_id, display_name, email) VALUES (?,?,?,?,?)').run(1, 'adv-1', ADA, 'Ada', 'ada.work@example.com');
  return { db, env: { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any };
}

const jwt = (id: number, role: string) => new SignJWT({ user_id: id, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function call(env: any, method: string, path: string, who: [number, string] | null, body?: unknown) {
  const headers: Record<string, string> = {};
  if (who) headers.Authorization = `Bearer ${await jwt(who[0], who[1])}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await advisors.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any, headers: res.headers };
}
const ada: [number, string] = [ADA, 'advisor'];

const mailed: Array<{ to: string; code: string }> = [];
attestationMailer.send = async (_env: any, to: string, _name: string, code: string) => { mailed.push({ to, code }); return true; };
const codeFor = async (env: any, tok: string) => { const r = await call(env, 'POST', `/proof-consents/${tok}/code`, null); assert.equal(r.status, 200, JSON.stringify(r.body)); return mailed.at(-1)!.code; };

async function asked(env: any, email = 'sam@example.com') {
  const item = await call(env, 'POST', '/me/proof', ada, { title: 'Led the payments rebuild', organization: 'Acme', period_note: '2024', detail: 'Rebuilt it.' });
  const req = await call(env, 'POST', `/me/proof/${item.body.id}/consent-request`, ada, { attester_name: 'Sam', attester_email: email });
  return { item: item.body, req };
}

test('the requester cannot self-attest: not with the link, not with their own address, not signed in', async () => {
  const { env } = fixture();
  const item = await call(env, 'POST', '/me/proof', ada, { title: 'A claim' });
  for (const own of ['ada@example.com', 'ADA.work@example.com ']) {
    const self = await call(env, 'POST', `/me/proof/${item.body.id}/consent-request`, ada, { attester_name: 'Me', attester_email: own });
    assert.deepEqual([self.status, self.body.error], [422, 'attester_is_requester'], `the advisor's own address (${own.trim()}) is refused`);
  }
  const none = await call(env, 'POST', `/me/proof/${item.body.id}/consent-request`, ada, { attester_name: 'Sam' });
  assert.deepEqual([none.status, none.body.error], [400, 'attester_email_required'], 'an address is required, because the code goes there');

  const { req } = await asked(env);
  const tok = req.body.invite_token;
  // The link the advisor holds, with no code.
  const bare = await call(env, 'POST', `/proof-consents/${tok}/respond`, null, { consent_text: 'Yes' });
  assert.deepEqual([bare.status, bare.body.error], [400, 'code_required']);
  // The code goes to the named address, never to the advisor.
  const code = await codeFor(env, tok);
  assert.equal(mailed.at(-1)!.to, 'sam@example.com');
  // Signed in as the advisor, even holding a code, is refused.
  const asAdvisor = await call(env, 'POST', `/proof-consents/${tok}/respond`, ada, { consent_text: 'Yes', code });
  assert.deepEqual([asAdvisor.status, asAdvisor.body.error], [403, 'requester_cannot_attest']);
  const list = await call(env, 'GET', '/me/proof', ada);
  assert.equal(list.body.items[0].attested, false, 'nothing was recorded');
  // A guessed code is wrong; five wrong tries spend the code.
  for (let i = 0; i < 5; i++) {
    const guess = await call(env, 'POST', `/proof-consents/${tok}/respond`, null, { consent_text: 'Yes', code: code === '000000' ? '111111' : '000000' });
    assert.equal(guess.body.error, 'code_wrong');
  }
  const spent = await call(env, 'POST', `/proof-consents/${tok}/respond`, null, { consent_text: 'Yes', code });
  assert.deepEqual([spent.status, spent.body.error], [401, 'code_expired'], 'after five wrong tries even the right code is spent');
});

test('the recipient sees the exact claim, who asked, and a masked address; never the advisor\'s link list', async () => {
  const { env } = fixture();
  const { req } = await asked(env);
  const view = await call(env, 'GET', `/proof-consents/${req.body.invite_token}/claim`, null);
  assert.equal(view.status, 200);
  assert.deepEqual(view.body.claim, { kind: 'engagement', title: 'Led the payments rebuild', organization: 'Acme', period_note: '2024', detail: 'Rebuilt it.' });
  assert.equal(view.body.advisor_name, 'Ada');
  assert.equal(view.body.email_hint, 's***@example.com');
  assert.equal(view.body.state, 'pending');
  assert.equal(view.headers.get('cache-control'), 'private, no-store');
  const text = JSON.stringify(view.body);
  assert.doesNotMatch(text, /sam@example\.com/, 'the address is never echoed in full');
  assert.doesNotMatch(text, /invite_token|request_token/);
  assert.equal((await call(env, 'GET', '/proof-consents/not-a-token/claim', null)).body.error, 'consent_not_found');
});

test('a withdrawal cannot be silently reversed with what the requester holds; the history keeps every answer', async () => {
  const { env, db } = fixture();
  const { req } = await asked(env);
  const tok = req.body.invite_token;
  assert.equal((await call(env, 'POST', `/proof-consents/${tok}/respond`, null, { consent_text: 'Yes', code: await codeFor(env, tok) })).status, 200);
  const withdraw = await call(env, 'POST', `/proof-consents/${tok}/respond`, null, { consent_given: false, code: await codeFor(env, tok) });
  assert.equal(withdraw.body.state, 'withdrawn');
  // The advisor still holds the link (it is in their list) and a code that was already used.
  const reused = mailed.at(-1)!.code;
  const replay = await call(env, 'POST', `/proof-consents/${tok}/respond`, null, { consent_text: 'Yes', code: reused });
  assert.deepEqual([replay.status, replay.body.error], [401, 'code_expired'], 'a used code answers once');
  let list = await call(env, 'GET', '/me/proof', ada);
  assert.equal(list.body.items[0].attested, false);
  assert.equal(list.body.items[0].consents[0].state, 'withdrawn');
  // Only a fresh code, mailed to the attester, reconfirms.
  const again = await call(env, 'POST', `/proof-consents/${tok}/respond`, null, { consent_text: 'Yes again', code: await codeFor(env, tok) });
  assert.equal(again.body.state, 'confirmed');
  const view = await call(env, 'GET', `/proof-consents/${tok}/claim`, null);
  assert.deepEqual(view.body.history.map((h: any) => h.kind), ['asked', 'confirmed', 'withdrawn', 'reconfirmed']);
  assert.throws(() => db.prepare("UPDATE advisor_proof_consent_events SET kind = 'confirmed'").run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM advisor_proof_consent_events').run(), /append-only/);
  list = await call(env, 'GET', '/me/proof', ada);
  assert.equal(list.body.items[0].attested, true);
});

test('the link survives a refresh of the list until it is answered', async () => {
  const { env } = fixture();
  const { req } = await asked(env);
  for (let i = 0; i < 2; i++) {
    const list = await call(env, 'GET', '/me/proof', ada);
    assert.equal(list.body.items[0].consents[0].invite_token, req.body.invite_token);
  }
  await call(env, 'POST', `/proof-consents/${req.body.invite_token}/respond`, null, { consent_given: false, code: await codeFor(env, req.body.invite_token) });
  const after = await call(env, 'GET', '/me/proof', ada);
  assert.equal(after.body.items[0].consents[0].invite_token, null);
  assert.equal(after.body.items[0].consents[0].state, 'declined');
});

test('a confirmation is bound to the claim as it read, and one from before D4670 needs reconfirming', async () => {
  const { env, db } = fixture();
  const { item, req } = await asked(env);
  const tok = req.body.invite_token;
  // The claim is changed after the ask.
  db.prepare("UPDATE advisor_proof_items SET title = 'Led the whole company' WHERE id = ?").run(item.id);
  const view = await call(env, 'GET', `/proof-consents/${tok}/claim`, null);
  assert.equal(view.body.claim_changed, true);
  assert.equal(view.body.claim.title, 'Led the payments rebuild', 'the attester is shown what they were asked about');
  const changed = await call(env, 'POST', `/proof-consents/${tok}/respond`, null, { consent_text: 'Yes', code: await codeFor(env, tok) });
  assert.deepEqual([changed.status, changed.body.error], [409, 'claim_changed']);
  // Confirmed, then edited: no longer counts.
  db.prepare("UPDATE advisor_proof_items SET title = 'Led the payments rebuild' WHERE id = ?").run(item.id);
  assert.equal((await call(env, 'POST', `/proof-consents/${tok}/respond`, null, { consent_text: 'Yes', code: await codeFor(env, tok) })).status, 200);
  db.prepare("UPDATE advisor_proof_items SET detail = 'Rebuilt it alone.' WHERE id = ?").run(item.id);
  let list = await call(env, 'GET', '/me/proof', ada);
  assert.deepEqual([list.body.items[0].attested, list.body.items[0].consents[0].state], [false, 'needs_reconfirmation']);
  assert.equal(list.body.counts.attested, 0, 'and the whole-list count (#4689) follows the same rule');
  // A row confirmed through the old flow (no pinned claim) is kept and shown, and does not count.
  db.prepare("INSERT INTO advisor_proof_consents (uid, proof_item_id, attester_name, consent_given, consent_given_at, consent_text) VALUES ('legacy', ?, 'Old', 1, '2026-01-01', 'Yes')").run(item.id);
  list = await call(env, 'GET', '/me/proof', ada);
  const legacy = list.body.items[0].consents.find((x: any) => x.uid === 'legacy');
  assert.deepEqual([legacy.state, legacy.consent_given, list.body.items[0].attested], ['needs_reconfirmation', false, false]);
});

test('codes: five an hour per request, and a failed send says so', async () => {
  const { env } = fixture();
  const { req } = await asked(env);
  for (let i = 0; i < 5; i++) assert.equal((await call(env, 'POST', `/proof-consents/${req.body.invite_token}/code`, null)).status, 200);
  const sixth = await call(env, 'POST', `/proof-consents/${req.body.invite_token}/code`, null);
  assert.deepEqual([sixth.status, sixth.body.error], [429, 'code_rate_limited']);
  const { req: other } = await asked(env, 'kim@example.com');
  const send = attestationMailer.send;
  attestationMailer.send = async () => false;
  try {
    const failed = await call(env, 'POST', `/proof-consents/${other.body.invite_token}/code`, null);
    assert.deepEqual([failed.status, failed.body.error], [503, 'code_unsent']);
  } finally { attestationMailer.send = send; }
  // Deleting the claim takes its consents and codes (foreign keys on), and keeps the answer history.
  const del = await call(env, 'DELETE', `/me/proof/${req.body.proof_item_id}`, ada);
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal((await call(env, 'GET', `/proof-consents/${req.body.invite_token}/claim`, null)).body.error, 'consent_not_found');
});

test('an advisor profile needs the Advisor licence: a founder is refused, an additional licence is enough', async () => {
  const { env, db } = fixture();
  const create = await call(env, 'POST', '/me', [FOUNDER, 'founder'], { display_name: 'Fran', bio: 'x' });
  assert.deepEqual([create.status, create.body.error], [403, 'advisor_licence_required']);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM advisors WHERE user_id = ?').get(FOUNDER) as any).n, 0, 'and no profile was made');
  const read = await call(env, 'GET', '/me', [FOUNDER, 'founder']);
  assert.deepEqual([read.status, read.body.error], [403, 'advisor_licence_required'], 'refused, which is not "no profile"');
  const none = await call(env, 'GET', '/me', [ADVISOR_NO_PROFILE, 'advisor']);
  assert.deepEqual([none.status, none.body], [200, null], 'an Advisor without a profile yet reads null');
  const dual = await call(env, 'POST', '/me', [DUAL, 'founder'], { display_name: 'Dee' });
  assert.equal(dual.status, 200, 'a founder holding the additional Advisor licence may');
  assert.equal((await call(env, 'GET', '/me', [DUAL, 'founder'])).body.display_name, 'Dee');
  assert.equal((await call(env, 'GET', '/me', [ADMIN, 'admin'])).status, 200, 'an admin keeps the read it had');
});

test('the pure rules: masked addresses and the consent states', async () => {
  assert.equal(maskEmail('sam@example.com'), 's***@example.com');
  assert.equal(maskEmail(null), null);
  const sha = await claimSha256({ kind: 'role', title: 'T', organization: null, period_note: null, detail: null });
  assert.equal(consentState({ consent_given: 0, withdrawn_at: null, consent_given_at: null, claim_sha256: sha }, sha), 'pending');
  assert.equal(consentState({ consent_given: 1, withdrawn_at: null, consent_given_at: 'x', claim_sha256: sha }, sha), 'confirmed');
  assert.equal(consentState({ consent_given: 1, withdrawn_at: null, consent_given_at: 'x', claim_sha256: null }, sha), 'needs_reconfirmation');
  assert.equal(consentState({ consent_given: 0, withdrawn_at: 'y', consent_given_at: 'x', claim_sha256: sha }, sha), 'withdrawn');
  assert.equal(consentState({ consent_given: 0, withdrawn_at: 'y', consent_given_at: null, claim_sha256: sha }, sha), 'declined');
});

test('a code is six independent digits, each nibble 10 to 15 is redrawn, and no value is remapped', () => {
  // Mutation checked: `nibble % 10` instead of the redraw, or no `< 10` filter -> these exact codes differ.
  const seq = (...n: number[]) => { let i = 0; return () => n[i++]; };
  assert.equal(newCode(seq(0, 1, 2, 3, 4, 5)), '012345', 'a digit below 10 is itself');
  assert.equal(newCode(seq(15, 0, 10, 1, 11, 2, 12, 3, 13, 4, 14, 5)), '012345', 'a nibble of 10 to 15 is thrown away, never remapped');
  assert.equal(newCode(seq(9, 9, 9, 9, 9, 9)), '999999');
  assert.equal(newCode(seq(0, 0, 0, 0, 0, 0)), '000000', 'leading zeros are kept');
  // Each of 0 to 9 maps to itself and each of 10 to 15 is refused: 10 of 16 values are kept, equally.
  for (let v = 0; v < 16; v += 1) {
    const out = newCode(seq(v, 7, 7, 7, 7, 7, 7));
    assert.equal(out, v < 10 ? `${v}77777` : '777777', `nibble ${v}`);
  }
  for (let i = 0; i < 200; i += 1) assert.match(newCode(), /^\d{6}$/);
});
