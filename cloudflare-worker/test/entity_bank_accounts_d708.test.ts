/**
 * D708 (#1773) — the registry of each Axal entity's bank accounts, through the
 * real `/api/admin/bank-accounts` router on node:sqlite with migration 472
 * applied from its own file.
 *
 * WHO. The Super Admin with a fresh TOTP step-up adds, lists, relabels,
 * retires and reveals. The Super Admin with a stale step-up, an LP and a
 * branch Worker are refused and store nothing. A plain Admin is refused 403
 * `super_admin_required` on every write and the reveal, on a TOTP session and
 * on a non-TOTP one, and never asked for a code it cannot use.
 *
 * WHAT IS STORED. Only `v1.` ciphertext, bound to its row. The number is in no
 * response but a reveal's, no table cell, no audit or activity row and no
 * console line.
 *
 * Every account number here is synthetic: none ends in a last four of the
 * owner's real accounts.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/entity_bank_accounts_d708.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import bankAccounts from '../src/routes/admin_bank_accounts.ts';
import { decryptColumn } from '../src/services/columnCipher.ts';
import { BANK_ACCOUNT_WRITES, LP_PAY_INSTRUCTIONS } from '../src/middleware/rateLimit.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 901;
const PLAIN_ADMIN = 902;
const LP = 903;

// Synthetic. Their last fours are none of the owner's real accounts.
const NUMBER_A = '4400118897';
const NUMBER_B = '73302255';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATION_472 = read('cloudflare-worker/sql/migrations/472_entity_bank_accounts.sql');

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'vc_funds']) {
    db.exec(tableFromBaseline(BASELINE, t));
  }
  db.exec(MIGRATION_472);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(HOLDER, 'admin', 'The Holder', 'holder@example.test');
  u.run(PLAIN_ADMIN, 'admin', 'Plain Admin', 'admin@example.test');
  u.run(LP, 'investor', 'An LP', 'lp@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, ?, datetime('now', ?))");
  s.run(HOLDER, 'totp-holder', 'totp', '+0 seconds');
  s.run(HOLDER, 'totp-stale-holder', 'totp', '-2 days');
  s.run(PLAIN_ADMIN, 'totp-plain', 'totp', '+0 seconds');
  s.run(PLAIN_ADMIN, 'totp-stale-plain', 'totp', '-2 days');
  s.run(PLAIN_ADMIN, 'password-plain', 'password', '+0 seconds');
  s.run(LP, 'totp-lp', 'totp', '+0 seconds');
  return db;
}

const envFor = (db: InstanceType<typeof DatabaseSync>, extra: Record<string, unknown> = {}) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...extra }) as any;

const app = new Hono<any>();
app.route('/', bankAccounts);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

/* ── every console line, captured, for the sweep ───────────────────────── */
const consoleLines: string[] = [];
for (const k of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const real = console[k].bind(console);
  console[k] = (...args: unknown[]) => {
    consoleLines.push(args.map((a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' '));
    if (process.env.D708_VERBOSE) real(...args);
  };
}

async function token(userId: number, jti?: string): Promise<string> {
  return new SignJWT({ user_id: userId, role: userId === LP ? 'investor' : 'admin', ...(jti ? { jti } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

const responses: string[] = [];
async function call(env: any, method: string, path: string, as: number, jti: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${await token(as, jti)}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const text = await res.text();
  responses.push(`${method} ${path} ${text}`);
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text, headers: res.headers };
}

const accountRows = (db: any) => db.prepare('SELECT * FROM entity_bank_accounts ORDER BY id').all() as any[];
const revealRows = (db: any) => db.prepare('SELECT * FROM entity_bank_account_reveals ORDER BY id').all() as any[];
const auditRows = (db: any) => db.prepare('SELECT * FROM admin_audit_log ORDER BY id').all() as any[];
const activityRows = (db: any) => db.prepare('SELECT * FROM activity_logs ORDER BY id').all() as any[];

const GP_CHECKING = {
  entity_key: 'gp', label: 'Operating', bank_name: 'Column N.A.',
  bank_address: '1 Letterman Drive, Building A, Suite A4-700, San Francisco, CA 94129',
  beneficiary_name: 'Axal VC GP LLC', beneficiary_address: '16192 Coastal Highway, Lewes, DE 19958',
  account_kind: 'checking', account_number: NUMBER_A, account_number_confirm: NUMBER_A,
  routing_number: '121145433', routing_number_alt: '121145307',
  swift_code: 'CLNOUS66MER', intermediary_swift_code: 'CHASUS33XXX', purposes: ['management_fee'],
};

async function addAccount(env: any, body: Record<string, unknown> = GP_CHECKING) {
  return call(env, 'POST', '/', HOLDER, 'totp-holder', body);
}

// ── The holder ──────────────────────────────────────────────────────────

test('the Super Admin with a fresh step-up adds, lists, relabels, retires and reveals', async () => {
  const db = freshDb();
  const env = envFor(db);
  const added = await addAccount(env);
  assert.equal(added.status, 201, added.text);
  const uid = added.body.account.uid;
  assert.equal(added.body.account.account_masked, `••••${NUMBER_A.slice(-4)}`);
  assert.equal(added.body.account.entity_name, 'Axal VC GP LLC');
  assert.ok(!added.text.includes(NUMBER_A), 'the add answered with the number');

  const list = await call(env, 'GET', '/', HOLDER, 'totp-holder');
  assert.equal(list.status, 200, list.text);
  assert.equal(list.body.accounts.length, 1);
  assert.equal(list.body.fund_i, null, 'no fund carries the slug, so fund_i is null');
  const fee = list.body.coverage.find((r: any) => r.purpose === 'management_fee');
  assert.equal(fee.ok, true, JSON.stringify(fee));
  assert.equal(fee.account_uid, uid);
  const contribution = list.body.coverage.find((r: any) => r.purpose === 'capital_contribution');
  assert.equal(contribution.code, 'fund_account_missing');

  const relabel = await call(env, 'PATCH', `/${uid}`, HOLDER, 'totp-holder', { label: 'GP operating' });
  assert.equal(relabel.status, 200, relabel.text);
  assert.equal(relabel.body.account.label, 'GP operating');

  const reveal = await call(env, 'POST', `/${uid}/reveal`, HOLDER, 'totp-holder', { reason: 'Checking against Mercury' });
  assert.equal(reveal.status, 200, reveal.text);
  assert.equal(reveal.body.account.account_number, NUMBER_A);
  assert.equal(reveal.headers.get('Cache-Control'), 'no-store');

  const retire = await call(env, 'POST', `/${uid}/retire`, HOLDER, 'totp-holder', { reason: 'Account closed' });
  assert.equal(retire.status, 200, retire.text);
  assert.equal(retire.body.account.status, 'retired');
  assert.deepEqual(auditRows(db).map((r) => r.action),
    ['bank_account_added', 'bank_account_updated', 'bank_account_revealed', 'bank_account_retired']);
});

test('fund_i names the fund that carries the spinout-fund-i slug', async () => {
  const db = freshDb();
  db.exec("INSERT INTO vc_funds (id, name, slug) VALUES (7, 'Spin-Out Lab Fund I', 'spinout-fund-i'), (8, 'Other', 'other')");
  const list = await call(envFor(db), 'GET', '/', HOLDER, 'totp-holder');
  assert.deepEqual(list.body.fund_i, { id: 7, name: 'Spin-Out Lab Fund I' });
});

// ── Refused callers ─────────────────────────────────────────────────────

test('the Super Admin with a stale step-up is refused and stores nothing', async () => {
  const db = freshDb();
  const r = await call(envFor(db), 'POST', '/', HOLDER, 'totp-stale-holder', GP_CHECKING);
  assert.equal(r.status, 403, r.text);
  assert.equal(r.body.detail, 'step_up_required');
  assert.equal(accountRows(db).length, 0);
  assert.equal(auditRows(db).length, 0);
});

test('an LP is refused the list and every write, and stores nothing', async () => {
  const db = freshDb();
  const env = envFor(db);
  for (const [m, p, b] of [['GET', '/', undefined], ['POST', '/', GP_CHECKING]] as const) {
    const r = await call(env, m, p, LP, 'totp-lp', b);
    assert.equal(r.status, 403, `${m} ${p}: ${r.text}`);
  }
  assert.equal(accountRows(db).length, 0);
});

test('a branch Worker refuses the holder, read and write', async () => {
  const db = freshDb();
  const env = envFor(db, { BRANCH_CODE: 'quebec' });
  const list = await call(env, 'GET', '/', HOLDER, 'totp-holder');
  assert.ok(list.status >= 400, list.text);
  assert.equal(list.body.accounts, undefined);
  assert.equal(list.body.refusals, undefined);
  const add = await call(env, 'POST', '/', HOLDER, 'totp-holder', GP_CHECKING);
  assert.ok(add.status >= 400, add.text);
  assert.equal(accountRows(db).length, 0);
});

test('a plain Admin does not see even the masked list', async () => {
  const db = freshDb();
  await addAccount(envFor(db));
  const r = await call(envFor(db), 'GET', '/', PLAIN_ADMIN, 'totp-plain');
  assert.equal(r.status, 403, r.text);
  assert.equal(r.body.accounts, undefined);
  assert.equal(r.body.refusals, undefined);
  assert.ok(!r.text.includes(NUMBER_A.slice(-4)));
});

test('#1856 GET / answers the four refusals the console explains, in order, each with the resolver\'s sentence', async () => {
  const db = freshDb();
  const r = await call(envFor(db), 'GET', '/', HOLDER, 'totp-holder');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.refusals.map((x: any) => x.code), ['no_active_account', 'holder_not_payee', 'savings_account', 'fund_account_missing']);
  for (const x of r.body.refusals) {
    assert.deepEqual(Object.keys(x).sort(), ['code', 'message']);
    assert.ok(typeof x.message === 'string' && x.message.length > 20, x.code);
  }
});

// One test per write route and session: 403 super_admin_required, never a TOTP or step-up demand, nothing written.
const PLAIN_ROUTES: Array<{ label: string; method: string; path: (uid: string) => string; body: unknown }> = [
  { label: 'POST /', method: 'POST', path: () => '/', body: { ...GP_CHECKING, purposes: [] } },
  { label: 'PATCH /:uid', method: 'PATCH', path: (uid) => `/${uid}`, body: { label: 'Renamed' } },
  { label: 'POST /:uid/retire', method: 'POST', path: (uid) => `/${uid}/retire`, body: { reason: 'Closing it' } },
  { label: 'POST /:uid/reveal', method: 'POST', path: (uid) => `/${uid}/reveal`, body: { reason: 'Curious' } },
];
const PLAIN_SESSIONS = [
  ['a TOTP session with no fresh step-up', 'totp-stale-plain'],
  ['a fresh TOTP session', 'totp-plain'],
  ['a non-TOTP session', 'password-plain'],
] as const;

for (const route of PLAIN_ROUTES) {
  for (const [session, jti] of PLAIN_SESSIONS) {
    test(`${route.label}: a plain Admin on ${session} gets 403 super_admin_required and nothing is written`, async () => {
      const db = freshDb();
      const added = await addAccount(envFor(db));
      const uid = added.body.account.uid;
      const before = JSON.stringify(accountRows(db));
      const auditBefore = auditRows(db).length;
      const activityBefore = activityRows(db).length;

      const r = await call(envFor(db), route.method, route.path(uid), PLAIN_ADMIN, jti, route.body);
      assert.equal(r.status, 403, r.text);
      assert.equal(r.body.code, 'super_admin_required', r.text);
      assert.equal(r.body.detail, 'Super admin required');
      assert.doesNotMatch(r.text, /step_up_required|totp/i, 'a plain Admin was asked for a code it cannot use');
      assert.ok(!r.text.includes(NUMBER_A), 'the number reached a refused caller');
      assert.equal(JSON.stringify(accountRows(db)), before, 'an account row changed');
      assert.equal(revealRows(db).length, 0, 'a reveal row was written');
      assert.equal(auditRows(db).length, auditBefore, 'an audit entry was written');
      assert.equal(activityRows(db).length, activityBefore, 'an activity row was written');
    });
  }
}

// ── Storage ─────────────────────────────────────────────────────────────

test('only v1. ciphertext is stored, it decrypts with its own AAD, and not when copied onto another row', async () => {
  const db = freshDb();
  const env = envFor(db);
  const a = await addAccount(env);
  const b = await addAccount(env, {
    ...GP_CHECKING, label: 'Reserve', account_kind: 'savings', account_number: NUMBER_B, account_number_confirm: NUMBER_B, purposes: [],
  });
  assert.equal(b.status, 201, b.text);
  const rows = accountRows(db);
  for (const row of rows) {
    assert.match(row.account_number_enc, /^v1\./);
    assert.ok(!row.account_number_enc.includes(NUMBER_A) && !row.account_number_enc.includes(NUMBER_B));
  }
  const [rowA, rowB] = rows;
  assert.equal(rowA.uid, a.body.account.uid);
  assert.equal(await decryptColumn(env, 'entity_bank_accounts', 'account_number_enc', rowA.uid, rowA.account_number_enc), NUMBER_A);
  assert.equal(await decryptColumn(env, 'entity_bank_accounts', 'account_number_enc', rowB.uid, rowA.account_number_enc), null,
    "row A's ciphertext decrypted under row B's AAD");
  assert.equal(rowA.account_last4, NUMBER_A.slice(-4));
  assert.throws(() => db.prepare("INSERT INTO entity_bank_accounts (uid, entity_key, label, bank_name, bank_address, beneficiary_name, beneficiary_address, account_kind, account_number_enc, account_last4, routing_number, recorded_by) VALUES ('x', 'gp', 'l', 'b', 'a', 'n', 'a', 'checking', ?, '8897', '121145433', 901)").run(NUMBER_A),
    /CHECK constraint failed/, 'a plaintext number was accepted');
});

// ── Validation ──────────────────────────────────────────────────────────

const INVALID: Array<[string, Record<string, unknown>, string]> = [
  ['a number with letters', { account_number: '44001A8897', account_number_confirm: '44001A8897' }, 'account_number_invalid'],
  ['a number of three digits', { account_number: '889', account_number_confirm: '889' }, 'account_number_invalid'],
  ['a mismatched confirm copy', { account_number_confirm: '4400118898' }, 'account_number_mismatch'],
  ['a bad ABA checksum', { routing_number: '121145434' }, 'routing_number_invalid'],
  ['a bad SWIFT', { swift_code: 'CLN0US6' }, 'swift_invalid'],
  ['a beneficiary that is not the entity', { beneficiary_name: 'Axal VC Holdings LLC' }, 'beneficiary_not_entity'],
  ['a purpose on savings', { account_kind: 'savings' }, 'purpose_on_savings'],
  ['a purpose for another entity', { purposes: ['platform_licence_fee'] }, 'purpose_wrong_entity'],
];
for (const [label, patch, code] of INVALID) {
  test(`validation: ${label} gets ${code}, stores nothing, and echoes no input`, async () => {
    const db = freshDb();
    const body = { ...GP_CHECKING, ...patch };
    const r = await addAccount(envFor(db), body);
    // A malformed field is 400; a purpose that conflicts with the account or the entity is 409.
    assert.equal(r.status, code.startsWith('purpose_') ? 409 : 400, r.text);
    assert.equal(r.body.code, code, r.text);
    assert.equal(r.body.error, code);
    assert.equal(typeof r.body.message, 'string');
    // What was typed, not a choice from a list (`savings` is a word our own sentence uses).
    for (const [k, v] of Object.entries(patch)) {
      if (k !== 'account_kind' && typeof v === 'string' && v.length > 3) assert.ok(!r.text.includes(v), `the refusal echoed ${v}`);
    }
    assert.ok(!r.text.includes(NUMBER_A), 'the refusal echoed the number');
    assert.equal(accountRows(db).length, 0);
  });
}

test('validation: a purpose another active account of the entity carries gets purpose_taken', async () => {
  const db = freshDb();
  assert.equal((await addAccount(envFor(db))).status, 201);
  const r = await addAccount(envFor(db), { ...GP_CHECKING, label: 'Second', account_number: NUMBER_B, account_number_confirm: NUMBER_B });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.body.code, 'purpose_taken');
  assert.equal(accountRows(db).length, 1);
});

// ── Immutability ────────────────────────────────────────────────────────

test('immutability: a PATCH of a fixed field gets 409 instructions_immutable and changes nothing', async () => {
  const db = freshDb();
  const uid = (await addAccount(envFor(db))).body.account.uid;
  const before = JSON.stringify(accountRows(db));
  for (const patch of [{ routing_number: '121145307' }, { account_number: NUMBER_B }, { beneficiary_name: 'Axal VC GP LLC' }]) {
    const r = await call(envFor(db), 'PATCH', `/${uid}`, HOLDER, 'totp-holder', patch);
    assert.equal(r.status, 409, r.text);
    assert.equal(r.body.code, 'instructions_immutable');
    assert.match(r.body.message, /Retire this account and add the new one\./);
  }
  assert.equal(JSON.stringify(accountRows(db)), before);
});

test('immutability: a raw UPDATE of a fixed column, any UPDATE of a retired row, and a DELETE abort', async () => {
  const db = freshDb();
  const env = envFor(db);
  const uid = (await addAccount(env)).body.account.uid;
  for (const col of ['account_number_enc', 'account_last4', 'routing_number', 'bank_name', 'beneficiary_name', 'entity_key', 'uid', 'recorded_by', 'created_at']) {
    const value = col === 'account_last4' ? '0000' : col === 'routing_number' ? '121145307' : col === 'recorded_by' ? 902
      : col === 'entity_key' ? 'holdings' : col === 'account_number_enc' ? 'v1.copied' : `changed-${col}`;
    assert.throws(() => db.prepare(`UPDATE entity_bank_accounts SET ${col} = ? WHERE uid = ?`).run(value, uid),
      /never change in place/, `${col} changed in place`);
  }
  assert.throws(() => db.prepare('DELETE FROM entity_bank_accounts WHERE uid = ?').run(uid), /Retire it instead/);
  await call(env, 'POST', `/${uid}/retire`, HOLDER, 'totp-holder', { reason: 'Closed' });
  assert.throws(() => db.prepare("UPDATE entity_bank_accounts SET label = 'x' WHERE uid = ?").run(uid), /retired account is never changed/);
  const r = await call(env, 'PATCH', `/${uid}`, HOLDER, 'totp-holder', { label: 'Back' });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.body.code, 'account_retired');
});

// ── Reveal ──────────────────────────────────────────────────────────────

test('reveal: one ledger row with its reason, and one audit entry carrying only the last four', async () => {
  const db = freshDb();
  const env = envFor(db);
  const uid = (await addAccount(env)).body.account.uid;
  const auditBefore = auditRows(db).length;
  const noReason = await call(env, 'POST', `/${uid}/reveal`, HOLDER, 'totp-holder', {});
  assert.equal(noReason.status, 400, noReason.text);
  assert.equal(revealRows(db).length, 0, 'a reveal without a reason was recorded');

  const r = await call(env, 'POST', `/${uid}/reveal`, HOLDER, 'totp-holder', { reason: 'Checking against Mercury' });
  assert.equal(r.status, 200, r.text);
  const reveals = revealRows(db);
  assert.equal(reveals.length, 1);
  assert.equal(reveals[0].context, 'admin_reveal');
  assert.equal(reveals[0].context_ref, 'Checking against Mercury');
  assert.equal(reveals[0].actor_user_id, HOLDER);
  const audit = auditRows(db).slice(auditBefore);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'bank_account_revealed');
  const auditText = JSON.stringify(audit[0]);
  assert.ok(auditText.includes(NUMBER_A.slice(-4)), 'the audit entry lacks the last four');
  assert.ok(!auditText.includes(NUMBER_A), 'the audit entry carries the number');
});

test('reveal: with the ledger unwritable, 503 reveal_unrecorded and no number', async () => {
  const db = freshDb();
  const env = envFor(db);
  const uid = (await addAccount(env)).body.account.uid;
  db.exec("CREATE TRIGGER t_block_reveal BEFORE INSERT ON entity_bank_account_reveals BEGIN SELECT RAISE(ABORT, 'ledger down'); END;");
  const r = await call(env, 'POST', `/${uid}/reveal`, HOLDER, 'totp-holder', { reason: 'Checking' });
  assert.equal(r.status, 503, r.text);
  assert.equal(r.body.code, 'reveal_unrecorded');
  assert.ok(!r.text.includes(NUMBER_A), 'a number was given without its ledger row');
  assert.ok(!r.text.includes('ledger down'), 'the database error reached the body');
});

test('reveal: the ledger refuses UPDATE and DELETE', async () => {
  const db = freshDb();
  const env = envFor(db);
  const uid = (await addAccount(env)).body.account.uid;
  await call(env, 'POST', `/${uid}/reveal`, HOLDER, 'totp-holder', { reason: 'Checking' });
  assert.throws(() => db.exec("UPDATE entity_bank_account_reveals SET context_ref = 'rewritten'"), /append-only/);
  assert.throws(() => db.exec('DELETE FROM entity_bank_account_reveals'), /append-only/);
  assert.equal(revealRows(db).length, 1);
});

// ── No key ──────────────────────────────────────────────────────────────

test('production without KEK_PII: 503 cipher_key_missing, nothing stored, no error text', async () => {
  const db = freshDb();
  const r = await addAccount(envFor(db, { ENVIRONMENT: 'production' }));
  assert.equal(r.status, 503, r.text);
  assert.equal(r.body.code, 'cipher_key_missing');
  assert.doesNotMatch(r.text, /KEK_PII is required/, 'the cipher\'s error text reached the body');
  assert.equal(accountRows(db).length, 0);
  assert.equal(auditRows(db).length, 0);
});

// ── Limits ──────────────────────────────────────────────────────────────

test('limits: the two patterns match every write, the reveal, the bare path and the LP GET, and nothing else', () => {
  for (const p of ['/api/admin/bank-accounts', '/api/admin/bank-accounts/abc-123', '/api/admin/bank-accounts/abc-123/retire', '/api/admin/bank-accounts/abc-123/reveal']) {
    assert.match(p, BANK_ACCOUNT_WRITES, p);
  }
  for (const p of ['/api/admin/bank-accounts/abc/other', '/api/admin/bank-accountsx', '/api/admin/stripe', '/api/admin/bank-accounts/a/reveal/x']) {
    assert.doesNotMatch(p, BANK_ACCOUNT_WRITES, p);
  }
  assert.match('/api/funds/7/capital-calls/lines/42/pay-instructions', LP_PAY_INSTRUCTIONS);
  for (const p of ['/api/funds/7/capital-calls/lines/42/receipts', '/api/funds/7/capital-calls', '/api/funds/lp-portal']) {
    assert.doesNotMatch(p, LP_PAY_INSTRUCTIONS, p);
  }
  const rl = read('cloudflare-worker/src/middleware/rateLimit.ts');
  const at = rl.indexOf("name: 'bank_accounts'");
  assert.ok(at > 0, 'the bank_accounts bucket is gone');
  const bucket = rl.slice(rl.lastIndexOf('{', at), rl.indexOf('},', at) + 1);
  assert.match(bucket, /limit: 10\b/);
  assert.match(bucket, /windowSec: 60\b|window: 60\b/);
  assert.match(bucket, /failClosed: true/);
  assert.match(bucket, /m !== 'GET' && BANK_ACCOUNT_WRITES\.test/);
  assert.match(bucket, /m === 'GET' && LP_PAY_INSTRUCTIONS\.test/);
  const index = read('cloudflare-worker/src/index.ts');
  const cool = index.slice(index.indexOf('const COOL_OFF_PREFIXES = ['), index.indexOf('];', index.indexOf('const COOL_OFF_PREFIXES = [')));
  assert.match(cool, /'\/api\/admin\/bank-accounts'/);
});

// ── The sweep ───────────────────────────────────────────────────────────

test('the sweep: the number is in no response but the reveals\', no table cell and no console line', async () => {
  // Every response, row and console line from this file's run so far, plus a
  // full pass here.
  const db = freshDb();
  const env = envFor(db);
  const uid = (await addAccount(env)).body.account.uid;
  await call(env, 'GET', '/', HOLDER, 'totp-holder');
  await call(env, 'PATCH', `/${uid}`, HOLDER, 'totp-holder', { purposes: [] });
  await call(env, 'POST', `/${uid}/reveal`, HOLDER, 'totp-holder', { reason: 'Sweep' });
  await call(env, 'POST', `/${uid}/retire`, HOLDER, 'totp-holder', { reason: 'Sweep' });

  const leaking = responses.filter((r) => (r.includes(NUMBER_A) || r.includes(NUMBER_B)) && !/^POST \/[^ ]+\/reveal /.test(r));
  assert.deepEqual(leaking, [], 'a response other than a reveal carried a number');

  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as any[]).map((t) => t.name);
  for (const t of tables) {
    for (const row of db.prepare(`SELECT * FROM "${t}"`).all() as any[]) {
      for (const [col, v] of Object.entries(row)) {
        assert.ok(!String(v).includes(NUMBER_A), `${t}.${col} holds the number`);
      }
    }
  }
  const lines = consoleLines.filter((l) => l.includes(NUMBER_A) || l.includes(NUMBER_B));
  assert.deepEqual(lines, [], 'a console line carried a number');
});
