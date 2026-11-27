/** D1184: the real router and SQLite migrations. All data synthetic; no Mercury/network access. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import bankAccounts from '../src/routes/admin_bank_accounts.ts';
import { createAccount } from '../src/services/entityBankAccounts.ts';
import { payInstructionsFor, PAY_WARNING } from '../src/services/payInstructions.ts';
import { AXAL_ENTITIES } from '../src/services/legalDocFormat.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { freshDb, envFor, tokenFor, SUPER, ADMIN, INVESTOR, FOUNDER, PARTNER, ADVISOR, EXPLORING, JTI } from './_mercury_fixture.ts';

const FULL = '55112233448897', UID = 'a'.repeat(32), OTHER = 'b'.repeat(32), READ_AT = '2026-10-20 08:00:00';
const privateError = 'synthetic-private-store-error';
const originalFetch = globalThis.fetch; let network = 0;
const logs: string[] = [], originalWarn = console.warn;
test.before(() => { globalThis.fetch = async () => { network++; throw Error('unexpected_provider_call'); }; console.warn = (...args) => { logs.push(args.map(String).join(' ')); }; });
test.after(() => { globalThis.fetch = originalFetch; console.warn = originalWarn; assert.equal(network, 0); assert.ok(!logs.join(' ').includes(privateError)); assert.ok(!logs.join(' ').includes(FULL)); });

function input(extra: Record<string, unknown> = {}) {
  return { entity_key: 'gp', label: 'Synthetic operating', bank_name: 'Synthetic bank', bank_address: 'Synthetic address',
    beneficiary_name: AXAL_ENTITIES.gp.name, beneficiary_address: 'Synthetic address', account_kind: 'checking',
    account_number: FULL, account_number_confirm: FULL, routing_number: '121145433', purposes: ['management_fee'], ...extra };
}
function fixture() {
  const db = freshDb(), env = envFor(db), native = env.DB; const queries: string[] = [], bankQueries: string[] = []; let watchRegistry = false;
  let badAudit: 'noop' | 'failed' | null = null;
  env.DB = { ...native, prepare(sql: string) {
    if (sql.includes('INSERT INTO admin_audit_log') && badAudit) return { bind() { return this; }, async run() { return { success: badAudit !== 'failed', meta: { changes: badAudit === 'failed' ? 1 : 0 } }; } };
    if (watchRegistry && /FROM entity_bank_accounts|FROM vc_funds/.test(sql)) {
      bankQueries.push(sql);
      assert.ok((db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='bank_accounts_mercury_read'").get() as any).n > 0);
    }
    if (/\bFROM mercury_accounts\b/.test(sql)) {
      queries.push(sql);
      assert.ok((db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action IN ('bank_accounts_mercury_read','bank_accounts_mercury_source_read')").get() as any).n > 0, 'Mercury SELECT must follow a persisted audit');
    }
    return native.prepare(sql);
  } };
  const app = new Hono<any>(); app.route('/', bankAccounts);
  app.onError((err: any, c) => c.json({ code: 'auth_refused' }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  async function call(method = 'GET', body?: unknown, actor: number | null = SUPER, extra: Record<string, unknown> = {}) {
    watchRegistry = method === 'GET';
    const res = await app.request('/', { method, headers: { ...(actor === null ? {} : { Authorization: `Bearer ${await tokenFor(actor, { jti: actor === SUPER ? JTI.superFresh : actor === ADMIN ? JTI.adminTotp : undefined, ...extra })}` }), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    const text = await res.text(); assert.ok(!text.includes(FULL), 'only Reveal may return the full number'); assert.ok(!text.includes(privateError));
    return { status: res.status, body: JSON.parse(text), headers: res.headers };
  }
  function mercury(uid = UID, entity = 'gp', last4 = '8897', current: number | null = 12345, available: number | null = 12000, readAt: string | null = READ_AT, kind = 'checking') {
    db.prepare("INSERT OR IGNORE INTO mercury_entity_connections(uid,entity_key,status,credentials_enc,connected_by) VALUES (?,?,'active','v1.synthetic-private-token',?)").run('connection-' + entity, entity, SUPER);
    const conn: any = db.prepare('SELECT id FROM mercury_entity_connections WHERE entity_key = ?').get(entity);
    db.prepare(`INSERT INTO mercury_accounts(uid,mercury_account_id,connection_id,entity_key,kind,last_four,nickname,current_cents,available_cents,balance_read_at,registered) VALUES (?,?,?,?,?,?,'synthetic-private-provider-text',?,?,?,0)`).run(uid, 'provider-' + uid, conn.id, entity, kind, last4, current, available, readAt);
  }
  return { db, env, call, mercury, queries, bankQueries, auditMode(value: typeof badAudit) { badAudit = value; }, async add(extra: Record<string, unknown> = {}) { return createAccount(env, input(extra), SUPER); } };
}

test('D1184: exact entity/ending join and resolver-owned masked preview, no credential or provider fields', async () => {
  const f = fixture(); try {
    const account = await f.add(); await f.add({ entity_key: 'holdings', beneficiary_name: AXAL_ENTITIES.holdings.name, purposes: [] }); f.mercury(); f.mercury(OTHER, 'holdings', '8897', 99999); f.mercury('c'.repeat(32), 'gp', '7733', 88888);
    const r = await f.call(); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
    const a = r.body.accounts[0]; assert.equal(a.uid, account.uid);
    assert.deepEqual(a.mercury, { account_uid: UID, kind: 'checking', connected: true, current: { cents: 12345, reason: null }, available: { cents: 12000, reason: null }, read_at: READ_AT, reason: null });
    assert.deepEqual(a.notice_preview, [await payInstructionsFor(f.env, 'gp', 'management_fee')]);
    assert.equal(a.notice_preview[0].instructions.account_masked, '••••8897'); assert.equal(a.notice_preview[0].warning, PAY_WARNING); assert.equal(a.notice_preview_reason, null);
    for (const secret of ['account_number_enc','account_number"','synthetic-private-token','provider-', 'synthetic-private-provider-text']) assert.ok(!JSON.stringify(r.body).includes(secret));
    const audit: any = f.db.prepare("SELECT * FROM admin_audit_log WHERE action = 'bank_accounts_mercury_read'").get();
    assert.equal(audit.admin_user_id, SUPER); assert.deepEqual(JSON.parse(audit.filters_json), { source_check: false }); assert.equal(f.queries.length, 1);
  } finally { f.db.close(); }
});

test('D1184: unmatched and ambiguous facts are null with reasons, never zero or another entity’s balance', async () => {
  const f = fixture(); try {
    await f.add(); f.mercury(OTHER, 'holdings');
    const expected = (reason: string) => ({ account_uid: null, kind: null, connected: null, current: { cents: null, reason }, available: { cents: null, reason }, read_at: null, reason });
    let a = (await f.call()).body.accounts[0]; assert.deepEqual(a.mercury, expected('unmatched')); assert.equal(a.notice_preview[0].ok, true);
    f.mercury(); f.mercury('c'.repeat(32)); a = (await f.call()).body.accounts[0]; assert.deepEqual(a.mercury, expected('ambiguous'));
  } finally { f.db.close(); }
});

test('D1184: real zero, negative, missing, unreadable, unsafe and disconnected cached balances remain distinct', async () => {
  const f = fixture(); try {
    await f.add(); f.mercury(UID, 'gp', '8897', 0, -50);
    let a = (await f.call()).body.accounts[0]; assert.deepEqual(a.mercury.current, { cents: 0, reason: null }); assert.deepEqual(a.mercury.available, { cents: -50, reason: null });
    f.db.exec("UPDATE mercury_accounts SET current_cents=NULL,available_cents=NULL,balance_read_at=NULL");
    a = (await f.call()).body.accounts[0]; assert.deepEqual(a.mercury.current, { cents: null, reason: 'not_recorded' }); assert.deepEqual(a.mercury.available, { cents: null, reason: 'not_recorded' }); assert.equal(a.mercury.read_at, null);
    f.db.prepare('UPDATE mercury_accounts SET balance_read_at=?').run(READ_AT);
    a = (await f.call()).body.accounts[0]; assert.deepEqual(a.mercury.current, { cents: null, reason: 'unreadable' }); assert.deepEqual(a.mercury.available, { cents: null, reason: 'unreadable' });
    f.db.exec("UPDATE mercury_accounts SET current_cents=1.5,available_cents=20; UPDATE mercury_entity_connections SET status='disconnected',credentials_enc=NULL");
    a = (await f.call()).body.accounts[0]; assert.deepEqual(a.mercury.current, { cents: null, reason: 'unreadable' }); assert.deepEqual(a.mercury.available, { cents: 20, reason: null }); assert.equal(a.mercury.read_at, READ_AT);
  } finally { f.db.close(); }
});

test('D1184: a Mercury read failure leaves registry and notice readable; resolver failure has its own refusal', async () => {
  const f = fixture(); try {
    const account = await f.add(); f.db.exec('DROP TABLE mercury_accounts');
    let a = (await f.call()).body.accounts[0]; assert.equal(a.uid, account.uid); assert.equal(a.mercury.reason, 'unreadable'); assert.equal(a.mercury.current.cents, null); assert.equal(a.mercury.available.cents, null); assert.equal(a.notice_preview[0].ok, true);
    // A changed key makes the resolver refuse a stored cipher without revealing it.
    f.env.KEK_PII = 'synthetic-other-key-that-is-at-least-32-characters';
    a = (await f.call()).body.accounts[0]; assert.equal(a.notice_preview[0].ok, false); assert.equal(a.notice_preview[0].code, 'account_unreadable'); assert.equal(a.notice_preview[0].instructions, undefined);
  } finally { f.db.close(); }
});

test('D1184: retired and reserve accounts print no preview; current account alone gets the notice', async () => {
  const f = fixture(); try {
    const old = await f.add(); f.db.prepare("UPDATE entity_bank_accounts SET status='retired',retired_at=datetime('now'),retired_reason='Synthetic retirement' WHERE uid=?").run(old.uid);
    const fresh = await f.add(); const savings = await f.add({ account_number: '551122337733', account_number_confirm: '551122337733', account_kind: 'savings', purposes: [] });
    const r = await f.call(); const by = (uid: string) => r.body.accounts.find((a: any) => a.uid === uid);
    assert.deepEqual(by(old.uid).notice_preview, []); assert.equal(by(old.uid).notice_preview_reason, 'account_retired');
    assert.equal(by(fresh.uid).notice_preview[0].instructions.uid, fresh.uid);
    assert.deepEqual(by(savings.uid).notice_preview, []); assert.equal(by(savings.uid).notice_preview_reason, 'no_notice_purpose');
  } finally { f.db.close(); }
});

test('D1184: audit throw, zero-row and unsuccessful audits refuse before any bank SELECT', async () => {
  for (const mode of ['throw','noop','failed']) {
    const f = fixture(); try {
      await f.add(); f.mercury();
      if (mode === 'throw') f.db.exec(`CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(FAIL,'${privateError}'); END`);
      else f.auditMode(mode as 'noop' | 'failed');
      const r = await f.call(); assert.equal(r.status, 503); assert.equal(r.body.code, 'audit_unavailable'); assert.equal(r.body.accounts, undefined); assert.equal(f.queries.length, 0); assert.equal(f.bankQueries.length, 0);
    } finally { f.db.close(); }
  }
});

test('D1184: empty list is audited and never needs a Mercury SELECT', async () => {
  const f = fixture(); try { const r = await f.call(); assert.equal(r.status, 200); assert.deepEqual(r.body.accounts, []); assert.equal(f.queries.length, 0); assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get() as any).n, 1); } finally { f.db.close(); }
});

test('D1184: source add accepts the stored matching ending after audit; writes only encrypted number', async () => {
  const f = fixture(); try {
    f.mercury(); const r = await f.call('POST', input({ mercury_account_uid: UID })); assert.equal(r.status, 201); assert.equal(r.body.account.account_masked, '••••8897');
    const stored: any = f.db.prepare('SELECT * FROM entity_bank_accounts').get(); assert.ok(stored.account_number_enc.startsWith('v1.')); assert.ok(!stored.account_number_enc.includes(FULL));
    assert.equal(f.queries.length, 1);
    const audit: any = f.db.prepare("SELECT * FROM admin_audit_log WHERE action = 'bank_accounts_mercury_source_read'").get(); assert.equal(audit.admin_user_id, SUPER); assert.deepEqual(JSON.parse(audit.filters_json), { source_check: true });
  } finally { f.db.close(); }
});

test('D1184: source mismatch, wrong entity/kind, absent and malformed UID cannot add or echo input', async () => {
  for (const [extra, code, status] of [
    [{ account_number: '55112233447733', account_number_confirm: '55112233447733' }, 'mercury_last_four_mismatch', 409],
    [{ entity_key: 'holdings', beneficiary_name: AXAL_ENTITIES.holdings.name, purposes: [] }, 'mercury_entity_mismatch', 409],
    [{ account_kind: 'savings', purposes: [] }, 'mercury_kind_mismatch', 409],
    [{ mercury_account_uid: OTHER }, 'mercury_account_not_found', 404],
    [{ mercury_account_uid: FULL }, 'mercury_account_invalid', 400],
    [{ mercury_account_uid: null }, 'mercury_account_invalid', 400],
  ] as const) {
    const f = fixture(); try { f.mercury(); const r = await f.call('POST', input({ mercury_account_uid: UID, ...extra })); assert.equal(r.status, status); assert.equal(r.body.code, code); assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM entity_bank_accounts').get() as any).n, 0); assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action='bank_account_added'").get() as any).n, 0); } finally { f.db.close(); }
  }
});

test('D1184: source unreadable or unauditable refuses safely without inserting an account', async () => {
  for (const mode of ['read','audit','noop','failed']) {
    const f = fixture(); try {
      f.mercury(); if (mode === 'read') f.db.exec('DROP TABLE mercury_accounts');
      else if (mode === 'audit') f.db.exec(`CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(FAIL,'${privateError}'); END`);
      else f.auditMode(mode as 'noop' | 'failed');
      const r = await f.call('POST', input({ mercury_account_uid: UID })); assert.equal(r.status, 503); assert.equal(r.body.code, mode === 'read' ? 'mercury_unreadable' : 'audit_unavailable'); assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM entity_bank_accounts').get() as any).n, 0); assert.equal(f.queries.length, mode === 'read' ? 1 : 0);
    } finally { f.db.close(); }
  }
});

test('D1184: existing manual add remains available without a Mercury read', async () => {
  const f = fixture(); try { const r = await f.call('POST', input()); assert.equal(r.status, 201); assert.equal(f.queries.length, 0); } finally { f.db.close(); }
});

test('D1184: anon, ordinary admin, members, support and branch receive no Mercury/registry data or audit', async () => {
  for (const actor of [null, ADMIN, INVESTOR, FOUNDER, PARTNER, ADVISOR, EXPLORING]) {
    const f = fixture(); try { await f.add(); f.mercury(); const r = await f.call('GET', undefined, actor); assert.equal(r.status, actor === null ? 401 : 403); assert.equal(r.body.accounts, undefined); assert.equal(f.queries.length, 0); assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get() as any).n, 0); } finally { f.db.close(); }
  }
  for (const scope of ['support','branch']) {
    const f = fixture(); try { await f.add(); f.mercury(); if (scope === 'branch') f.env.BRANCH_CODE = 'synthetic';
      for (const method of ['GET','POST']) { const r = await f.call(method, method === 'POST' ? input({ mercury_account_uid: UID, purposes: [] }) : undefined, SUPER, scope === 'support' ? { impersonated: true } : {}); assert.equal(r.status, 403); assert.equal(r.body.accounts, undefined); }
      assert.equal(f.queries.length, 0); assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get() as any).n, 0);
    } finally { f.db.close(); }
  }
});

test('D1184: corrupted connection ownership cannot associate a balance or authorize a source add', async () => {
  const f = fixture(); try {
    await f.add(); f.mercury(); f.mercury(OTHER, 'holdings', '7733');
    f.db.exec("UPDATE mercury_accounts SET connection_id=(SELECT id FROM mercury_entity_connections WHERE entity_key='holdings') WHERE entity_key='gp'");
    const r = await f.call(); assert.equal(r.body.accounts[0].mercury.reason, 'unmatched'); assert.equal(r.body.accounts[0].mercury.account_uid, null);
    const added = await f.call('POST', input({ mercury_account_uid: UID, purposes: [] })); assert.equal(added.status, 404); assert.equal(added.body.code, 'mercury_account_not_found');
  } finally { f.db.close(); }
});

test('D1184: all assigned notice purposes use the shared resolver, while a resolver store failure stays isolated', async () => {
  const f = fixture(); try {
    await f.add({ entity_key: 'holdings', beneficiary_name: AXAL_ENTITIES.holdings.name, purposes: ['platform_licence_fee','territory_licence_fee'] });
    const r = await f.call(); assert.equal(r.status, 200);
    assert.deepEqual(r.body.accounts[0].notice_preview, await Promise.all(['platform_licence_fee','territory_licence_fee'].map(p => payInstructionsFor(f.env, 'holdings', p as any))));
    const realPrepare = f.env.DB.prepare;
    f.env.DB.prepare = (sql: string) => { if (sql.includes('SELECT a.* FROM entity_bank_accounts')) throw Error(privateError); return realPrepare(sql); };
    const failed = await f.call(); assert.equal(failed.status, 200); assert.equal(failed.body.accounts[0].mercury.reason, 'unmatched');
    for (const preview of failed.body.accounts[0].notice_preview) { assert.equal(preview.ok, false); assert.equal(preview.code, 'account_unreadable'); assert.equal(preview.instructions, undefined); }
  } finally { f.db.close(); }
});
