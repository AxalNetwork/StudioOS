/**
 * D716 (#1781, PR 1) — fund notices over real SQLite: the baseline's tables
 * plus migrations 312 (the call ledger), 472 (#1773's bank accounts) and 478,
 * read from their files. TOTP sessions follow `fund_reporting_d712.test.ts`.
 *
 * Every account number here is synthetic, and none ends in a real account's
 * last four. Browser Run is a fake `quickAction`; `BROWSER.fetch` throws.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { PDFDocument } from 'pdf-lib';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import notices from '../src/routes/fund_notices.ts';
import { PAY_WARNING } from '../src/services/payInstructions.ts';
import { noticeListFacts } from '../src/services/fundNotices.ts';
import { encryptColumn } from '../src/services/columnCipher.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { NOTICE_TYPES, noticeSpecimen } from '../src/services/fundNotices.ts';
import { RECEIVING_BRACKET } from '../src/services/fundStructure.ts';
import { AXAL_ENTITIES } from '../src/services/legalDocFormat.ts';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (f: string) => readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8');
const TABLES = ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'vc_funds', 'limited_partners',
  'capital_calls', 'fund_distributions', 'legal_templates', 'legal_template_versions', 'lp_applications'];
const SCHEMA = TABLES.map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n')
  + '\n' + ['312_fund_call_ledger.sql', '472_entity_bank_accounts.sql', '473_fund_management_fees.sql', '474_mercury_entity_connections.sql',
    '478_fund_notices_booklets.sql', '483_mercury_not_ours.sql'].map(mig).join('\n');
const SECRET = ['d716', 'notices', 'fixture', 'signing', 'secret'].join('-');

const ADMIN = 1, SUPER = 2, LP_A = 5, LP_B = 6, PLAIN_TOTP = 8;
// Synthetic; ends in no real account's last four.
const FUND_NUMBER = '4400556677';
const PAST = '2026-01-15';
const FUTURE = '2099-06-30';

const BODY = 'Dear {{lp.name}} ({{lp.number}}): call {{call.number}} on {{fund.name}} asks {{call.amount}} by {{call.due_date}}.';

function fixture() {
  const { DB, db } = makeD1(SCHEMA);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  for (const [id, role, name] of [[ADMIN, 'admin', 'Plain Admin'], [SUPER, 'admin', 'Super One'], [LP_A, 'investor', 'Lena LP'],
    [LP_B, 'investor', 'Omar Other'], [PLAIN_TOTP, 'admin', 'Totp Admin']] as const) u.run(id, role, name, `user${id}@example.test`);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER})`);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, ?, datetime('now', ?))");
  s.run(SUPER, 'totp-super', 'totp', '+0 seconds');
  s.run(PLAIN_TOTP, 'totp-plain', 'totp', '+0 seconds');
  s.run(ADMIN, 'pw-plain', 'password', '+0 seconds');
  db.exec(`
    INSERT INTO vc_funds (id, name, slug, status) VALUES (10, 'Fund I', 'spinout-fund-i', 'investing'), (20, 'Other Fund', 'other', 'investing');
    INSERT INTO limited_partners (id, fund_id, user_id, name, commitment_amount, status) VALUES
      (101, 10, ${LP_A}, 'Lena LP', 1000.00, 'committed'),
      (102, 10, ${LP_B}, 'Omar Other', 3000.00, 'committed'),
      (201, 20, NULL, 'Outside LP', 1000.00, 'committed');
    INSERT INTO fund_capital_calls (id, uid, fund_id, call_number, amount_cents, purpose, due_date, line_count, issued_by) VALUES
      (1, 'call-1', 10, 1, 100000, 'Investment in Acme', '${PAST}', 2, ${SUPER}),
      (2, 'call-2', 20, 1, 50000, 'Other', '${PAST}', 1, ${SUPER}),
      (3, 'call-3', 10, 2, 40000, 'Follow-on', '${FUTURE}', 1, ${SUPER});
    INSERT INTO capital_calls (id, limited_partner_id, amount, amount_cents, status, due_date, fund_call_id) VALUES
      (11, 101, 250.00, 25000, 'pending', '${PAST}', 1),
      (12, 102, 750.00, 75000, 'pending', '${PAST}', 1),
      (21, 201, 500.00, 50000, 'pending', '${PAST}', 2),
      (31, 101, 400.00, 40000, 'pending', '${FUTURE}', 3);
    INSERT INTO fund_distributions (id, fund_id, lp_id, amount_cents, distribution_type, status, distributed_at) VALUES
      (41, 10, 101, 5000, 'profit_share', 'paid', '2026-09-15 10:00:00'),
      (42, 10, 101, 7000, 'profit_share', 'pending', NULL);
  `);
  const t = db.prepare(`INSERT INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES (?, ?, 'fund', ?, '[]', 1, 1, ?)`);
  t.run('capital_call_notice', 'Capital Call Notice', '', 1);
  t.run('distribution_notice', 'Distribution Notice', 'Dear {{lp.name}}: {{distribution.amount}} was distributed on {{distribution.date}}.', 0);
  t.run('default_notice', 'Notice of Default', 'Dear {{lp.name}}: {{default.amount}} is overdue; cure by {{default.cure_date}} under {{default.lpa_section}}.', 0);
  const files = new Map<string, Uint8Array>();
  let deleted = 0;
  const FILES = {
    async put(k: string, v: Uint8Array) { files.set(k, new Uint8Array(v)); },
    async get(k: string) { const v = files.get(k); return v ? { arrayBuffer: async () => v.slice().buffer } : null; },
    async delete(k: string) { files.delete(k); deleted++; },
  };
  const browser = { calls: 0, fail: false, fetched: 0 };
  const BROWSER = {
    fetch: async () => { browser.fetched++; throw new Error('BROWSER.fetch must not be called'); },
    quickAction: async () => {
      browser.calls++;
      if (browser.fail) return new Response('down', { status: 500 });
      const d = await PDFDocument.create(); d.addPage([612, 792]);
      return new Response(await d.save());
    },
  };
  const env = { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development', FILES, BROWSER } as any;
  const app = new Hono<any>();
  app.route('/api/fund-notices', notices);
  async function call(who: number, method: string, path: string, body?: unknown, opts: { jti?: string; envExtra?: Record<string, unknown>; impersonatedBy?: number } = {}) {
    const jti = opts.jti ?? (who === SUPER ? 'totp-super' : who === PLAIN_TOTP ? 'totp-plain' : who === ADMIN ? 'pw-plain' : undefined);
    const claims: Record<string, unknown> = { user_id: who, ...(jti ? { jti } : {}), ...(opts.impersonatedBy ? { impersonated_by: opts.impersonatedBy } : {}) };
    const token = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await withThrownResponses(() => app.request(`/api/fund-notices${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { ...env, ...(opts.envExtra || {}) }));
    const buf = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder().decode(buf);
    let json: any = null; try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, body: json, bytes: buf, text, headers: res.headers };
  }
  const one = (sql: string, ...a: unknown[]) => ({ ...(db.prepare(sql).get(...a) as any) });
  const count = (sql: string) => Number((db.prepare(sql).get() as any).n);
  return { db, env, call, one, count, files, browser, deleted: () => deleted };
}
type F = ReturnType<typeof fixture>;

let seq = 0;
async function account(f: F, o: { kind?: string; beneficiary?: string; purposes?: string[]; entity?: string } = {}) {
  const uid = `0000bbbb-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const enc = await encryptColumn(f.env, 'entity_bank_accounts', 'account_number_enc', uid, FUND_NUMBER);
  f.db.prepare(`INSERT INTO entity_bank_accounts
      (uid, entity_key, label, bank_name, bank_address, beneficiary_name, beneficiary_address, account_kind,
       account_number_enc, account_last4, routing_number, swift_code, purposes_json, status, recorded_by)
     VALUES (?, ?, 'Fund operating', 'Column N.A.', '1 Letterman Drive', ?, '16192 Coastal Highway', ?, ?, ?, '121145433', 'CLNOUS66MER', ?, 'active', ?)`)
    .run(uid, o.entity ?? 'fund', o.beneficiary ?? 'Axal VC Spin-Out Lab Fund I LP', o.kind ?? 'checking', enc, FUND_NUMBER.slice(-4),
      JSON.stringify(o.purposes ?? ['capital_contribution']), SUPER);
  return uid;
}
const writeBody = (f: F, slug: string, body: string) =>
  f.db.prepare('UPDATE legal_templates SET body_md = ?, is_stub = 0, version = version + 1 WHERE slug = ?').run(body, slug);
const CALL_LINE = { type: 'capital_call_notice', source: { line_id: 11 } };

async function preview(f: F, req: Record<string, unknown>, who = ADMIN) {
  return f.call(who, 'POST', '/preview', { page_size: 'letter', ...req });
}
async function issue(f: F, req: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const p = await preview(f, req);
  return f.call(SUPER, 'POST', '/issue', { page_size: 'letter', ...req, figures_sha256: p.body.figures_sha256, ...extra });
}

test('D716 no Fund account: the preview prints #1773\'s sentence in the block\'s place, and an issue writes nothing', async () => {
  const f = fixture();
  writeBody(f, 'capital_call_notice', BODY);
  const p = await preview(f, CALL_LINE);
  assert.equal(p.status, 200, p.text);
  assert.equal(p.body.refusal.code, 'fund_account_missing');
  assert.ok(p.body.html.includes('has no bank account for capital contributions yet'));
  assert.ok(!p.body.html.includes('Routing number'), 'no bank lines');
  assert.equal(p.headers.get('cache-control'), 'no-store');
  const r = await f.call(SUPER, 'POST', '/issue', { ...CALL_LINE, page_size: 'letter', figures_sha256: p.body.figures_sha256 });
  assert.deepEqual([r.status, r.body.error], [409, 'fund_account_missing']);
  assert.equal(f.count('SELECT COUNT(*) AS n FROM legal_notices'), 0);
});

test('D716 with a Fund account: the block shows the last four, the routing, SWIFT and the reference, with the phone check above it; no file holds the number', async () => {
  const f = fixture();
  await account(f);
  writeBody(f, 'capital_call_notice', BODY);
  const p = await preview(f, CALL_LINE);
  assert.equal(p.body.refusal, null, JSON.stringify(p.body.refusal));
  const h = p.body.html;
  for (const s of ['ending 6677', '121145433', 'CLNOUS66MER', 'AXAL-CC-10-L101-11', 'Limited partner no. L101', '$250.00']) assert.ok(h.includes(s), s);
  assert.ok(h.indexOf(PAY_WARNING) > 0 && h.indexOf(PAY_WARNING) < h.indexOf('Payment instructions'), 'the phone check sits above the block');
  assert.ok(h.includes('Dear Lena LP (L101): call 1'), 'the prose is merged');
  assert.ok(!h.includes('By: ___'), 'a notice prints no signature line');
  const logs: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  try {
    const r = await f.call(SUPER, 'POST', '/issue', { ...CALL_LINE, page_size: 'letter', figures_sha256: p.body.figures_sha256 });
    assert.equal(r.status, 201, r.text);
    const lp = await f.call(LP_A, 'GET', `/mine/${r.body.notice.uid}/pdf`);
    assert.equal(lp.status, 200);
    for (const text of [JSON.stringify(p.body), JSON.stringify(r.body), JSON.stringify(f.db.prepare('SELECT * FROM legal_notices').all()),
      JSON.stringify(f.db.prepare('SELECT * FROM legal_notice_files').all()), ...[...f.files.values()].map((b) => Buffer.from(b).toString('latin1')),
      JSON.stringify(f.db.prepare('SELECT * FROM admin_audit_log').all()), logs.join('\n')]) {
      assert.ok(!text.includes(FUND_NUMBER), 'a full account number leaked');
    }
  } finally { Object.assign(console, orig); }
  assert.equal(f.one('SELECT account_last4 FROM legal_notices').account_last4, '6677');
});

test('D716 the other refusals give their code and sentence', async () => {
  for (const [opts, code] of [[{ beneficiary: 'Someone Else LLC' }, 'holder_not_payee'], [{ kind: 'savings' }, 'savings_account']] as const) {
    const f = fixture();
    await account(f, opts as any);
    writeBody(f, 'capital_call_notice', BODY);
    const p = await preview(f, CALL_LINE);
    assert.equal(p.body.refusal.code, code);
    assert.ok(p.body.html.includes(p.body.refusal.message));
  }
  const f = fixture();
  await account(f);
  assert.equal((await preview(f, { type: 'capital_call_notice', source: { line_id: 21 } })).body.error, 'not_an_axal_fund');
  const stub = await preview(f, CALL_LINE);
  assert.equal(stub.body.refusal.code, 'notice_body_missing');
  assert.ok(stub.body.html.includes('Stub — counsel to draft'));
  writeBody(f, 'capital_call_notice', BODY + ' See {{lpa.section_unknown}}.');
  const unfilled = await preview(f, CALL_LINE);
  assert.deepEqual([unfilled.body.refusal.code, unfilled.body.refusal.fields ?? unfilled.body.refusal.extra?.fields], ['merge_field_unfilled', ['lpa.section_unknown']]);
  assert.ok(unfilled.body.html.includes('[LPA SECTION UNKNOWN]'), 'the preview prints the bracket label');
  writeBody(f, 'capital_call_notice', BODY);
  f.db.exec("UPDATE capital_calls SET status = 'paid' WHERE id = 11");
  const paid = await issue(f, CALL_LINE);
  assert.deepEqual([paid.status, paid.body.error], [409, 'line_already_paid']);
  assert.equal(f.count('SELECT COUNT(*) AS n FROM legal_notices'), 0);
});

test('D716 a plain Admin\'s issue, on a TOTP or a password session, is 403 super_admin_required and writes nothing', async () => {
  const f = fixture();
  await account(f);
  writeBody(f, 'capital_call_notice', BODY);
  const p = await preview(f, CALL_LINE);
  const calls = await f.call(ADMIN, 'POST', '/calls/call-1/preview');
  for (const who of [ADMIN, PLAIN_TOTP]) {
    const one = await f.call(who, 'POST', '/issue', { ...CALL_LINE, page_size: 'letter', figures_sha256: p.body.figures_sha256 });
    assert.deepEqual([one.status, one.body.code], [403, 'super_admin_required'], `user ${who} /issue`);
    const many = await f.call(who, 'POST', '/calls/call-1/issue', { page_size: 'letter', digest: calls.body.digest });
    assert.deepEqual([many.status, many.body.code], [403, 'super_admin_required'], `user ${who} calls issue`);
  }
  assert.equal(f.count('SELECT COUNT(*) AS n FROM legal_notices'), 0);
  assert.equal(f.count('SELECT COUNT(*) AS n FROM legal_notice_files'), 0);
  assert.equal(f.count("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action LIKE 'fund_admin.fund_notice.issue%'"), 0);
});

test('D716 issue: once, then already_issued; a stale digest is refused; changed figures need a reason and supersede, in one chain', async () => {
  const f = fixture();
  await account(f);
  writeBody(f, 'capital_call_notice', BODY);
  const first = await issue(f, CALL_LINE);
  assert.equal(first.status, 201, first.text);
  const counts = () => [f.count('SELECT COUNT(*) AS n FROM legal_notices'), f.count('SELECT COUNT(*) AS n FROM admin_audit_log')];
  const before = counts();
  const again = await issue(f, CALL_LINE);
  assert.deepEqual([again.status, again.body.already_issued, again.body.notice.uid], [200, true, first.body.notice.uid]);
  assert.deepEqual(counts(), before, 'a second issue writes nothing');
  const stale = await f.call(SUPER, 'POST', '/issue', { ...CALL_LINE, page_size: 'letter', figures_sha256: 'a'.repeat(64) });
  assert.deepEqual([stale.status, stale.body.error], [409, 'content_changed']);
  writeBody(f, 'capital_call_notice', BODY + ' Version B.');
  assert.equal((await issue(f, CALL_LINE)).body.error, 'reason_required');
  const b = await issue(f, CALL_LINE, { reason: 'Counsel revised the notice.' });
  assert.equal(b.status, 201, b.text);
  writeBody(f, 'capital_call_notice', BODY);
  const a2 = await issue(f, CALL_LINE, { reason: 'Back to the first wording.' });
  assert.equal(a2.status, 201, a2.text);
  const chain = f.db.prepare('SELECT id, supersedes_id FROM legal_notices ORDER BY id').all() as any[];
  assert.deepEqual(chain.map((r) => r.supersedes_id), [null, chain[0].id, chain[1].id], 'three rows in one linear chain');
});

test('D716 a call whose second line refuses issues no notice for any line', async () => {
  const f = fixture();
  await account(f);
  writeBody(f, 'capital_call_notice', BODY);
  const p = await f.call(ADMIN, 'POST', '/calls/call-1/preview');
  assert.equal(p.body.lines.length, 2);
  f.db.exec("UPDATE capital_calls SET status = 'paid' WHERE id = 12");
  const r = await f.call(SUPER, 'POST', '/calls/call-1/issue', { page_size: 'letter', digest: p.body.digest });
  assert.deepEqual([r.status, r.body.error], [409, 'line_already_paid']);
  assert.equal(f.count('SELECT COUNT(*) AS n FROM legal_notices'), 0);
  f.db.exec("UPDATE capital_calls SET status = 'pending' WHERE id = 12");
  const fresh = await f.call(ADMIN, 'POST', '/calls/call-1/preview');
  const ok = await f.call(SUPER, 'POST', '/calls/call-1/issue', { page_size: 'letter', digest: fresh.body.digest });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(f.count('SELECT COUNT(*) AS n FROM legal_notices'), 2);
});

test('D716 each type: distribution, default, licence invoice and letter', async () => {
  const f = fixture();
  await account(f);
  const pending = await preview(f, { type: 'distribution_notice', source: { distribution_id: 42 }, inputs: { tax_character: 'ordinary_income' } });
  assert.deepEqual([pending.status, pending.body.error], [409, 'distribution_not_paid']);
  assert.equal((await preview(f, { type: 'distribution_notice', source: { distribution_id: 41 } })).body.error, 'tax_character_missing');
  const dist = await preview(f, { type: 'distribution_notice', source: { distribution_id: 41 }, inputs: { tax_character: 'long_term_capital_gain' } });
  assert.equal(dist.status, 200, dist.text);
  assert.ok(dist.body.html.includes('Tax character') && dist.body.html.includes('Long-term capital gain'));
  assert.ok(!dist.body.html.includes('Payment instructions'), 'the Fund pays the LP: no payment block');
  assert.ok(dist.body.html.includes(PAY_WARNING));

  const notDue = await preview(f, { type: 'default_notice', source: { line_id: 31 }, inputs: { cure_date: FUTURE, lpa_section: '3.4' } });
  assert.deepEqual([notDue.status, notDue.body.error], [409, 'line_not_overdue']);
  const pastCure = await preview(f, { type: 'default_notice', source: { line_id: 11 }, inputs: { cure_date: PAST, lpa_section: '3.4' } });
  assert.deepEqual([pastCure.status, pastCure.body.error], [400, 'cure_date_invalid']);
  const def = await preview(f, { type: 'default_notice', source: { line_id: 11 }, inputs: { cure_date: FUTURE, lpa_section: 'Section 3.4' } });
  assert.equal(def.body.refusal, null, JSON.stringify(def.body.refusal));
  assert.ok(def.body.html.includes('Section 3.4') && def.body.html.includes('AXAL-CC-10-L101-11'));

  const fund = await preview(f, { type: 'platform_licence_fee_invoice', inputs: { licensee: 'fund', period_start: '2026-10-01', period_end: '2026-12-31', amount_cents: 100000, due_date: FUTURE } });
  assert.deepEqual([fund.status, fund.body.error], [400, 'licensee_invalid']);
  const lic = await preview(f, { type: 'platform_licence_fee_invoice', inputs: { licensee: 'gp', period_start: '2026-10-01', period_end: '2026-12-31', amount_cents: 100000, due_date: FUTURE } });
  assert.equal(lic.body.figures.reference, 'AXAL-LIC-GP-20261001');
  assert.equal(lic.body.refusal.code, 'no_active_account', 'Holdings has no account in this fixture');
  assert.ok(lic.body.html.includes('platform_ip_licence_fund_admin'));
  assert.ok(!lic.body.html.includes('class="execution'), 'an invoice prints no sender block');

  const mgmt = await preview(f, { type: 'payment_instructions_letter', inputs: { purpose: 'management_fee', entity: 'management' } });
  assert.deepEqual([mgmt.status, mgmt.body.error], [400, 'letter_payee_invalid']);
  const letter = await preview(f, { type: 'payment_instructions_letter', inputs: { purpose: 'capital_contribution', to: 'Lena LP' } });
  assert.ok(letter.body.html.includes('These are the only instructions on which Axal VC Spin-Out Lab Fund I LP accepts payment.'));
  assert.ok(letter.body.html.includes('ending 6677'));
});

test('D716 reads: an LP lists only their own notices; anyone else gets 404; a branch gets hq_only; a support session cannot issue', async () => {
  const f = fixture();
  await account(f);
  writeBody(f, 'capital_call_notice', BODY);
  const n = (await issue(f, CALL_LINE)).body.notice;
  const mine = await f.call(LP_A, 'GET', '/mine');
  assert.deepEqual(mine.body.notices.map((x: any) => [x.uid, x.instructions_changed]), [[n.uid, false]]);
  assert.equal((await f.call(LP_B, 'GET', '/mine')).body.notices.length, 0);
  for (const who of [LP_B, ADMIN, SUPER]) assert.equal((await f.call(who, 'GET', `/mine/${n.uid}`)).status, 404, `user ${who}`);
  const read = await f.call(LP_A, 'GET', `/mine/${n.uid}`);
  assert.equal(read.body.figures.payment.account_last4, '6677');
  // The frozen account retired and replaced: the LP is told to call first.
  f.db.exec("UPDATE entity_bank_accounts SET status = 'retired', retired_at = '2026-10-01'");
  await account(f);
  assert.equal((await f.call(LP_A, 'GET', '/mine')).body.notices[0].instructions_changed, true);
  const branch = await f.call(ADMIN, 'GET', '', undefined, { envExtra: { BRANCH_CODE: 'sg' } });
  assert.deepEqual([branch.status, branch.body?.error], [403, 'hq_only'], branch.text);
  const support = await f.call(SUPER, 'POST', '/issue', { ...CALL_LINE, page_size: 'letter', figures_sha256: 'b'.repeat(64) }, { impersonatedBy: ADMIN });
  assert.deepEqual([support.status, support.body.code], [403, 'support_session_refused']);
  const supportRead = await f.call(ADMIN, 'GET', `/${n.uid}`, undefined, { impersonatedBy: SUPER });
  assert.deepEqual([supportRead.status, supportRead.body.error], [403, 'support_session_refused'], 'a support session reads no notice either');
});

test('#1860 /mine and /mine/:uid carry call_number and due_date, computed on read; the admin list keeps its shape', async () => {
  const f = fixture();
  await account(f);
  writeBody(f, 'capital_call_notice', BODY);
  writeBody(f, 'default_notice', 'Dear {{lp.name}}: cure {{default.amount}} by {{default.cure_date}}.');
  const call = (await issue(f, CALL_LINE)).body.notice;
  const def = (await issue(f, { type: 'default_notice', source: { line_id: 11 }, inputs: { cure_date: FUTURE, lpa_section: 'Section 3.4' } })).body.notice;
  const dist = (await issue(f, { type: 'distribution_notice', source: { distribution_id: 41 }, inputs: { tax_character: 'long_term_capital_gain' } })).body.notice;
  assert.ok(call?.uid && def?.uid && dist?.uid, 'all three issued');
  const mine = await f.call(LP_A, 'GET', '/mine');
  const by = Object.fromEntries(mine.body.notices.map((x: any) => [x.uid, x]));
  assert.deepEqual([by[call.uid].call_number, by[call.uid].due_date], ['1', PAST]);
  assert.deepEqual([by[def.uid].call_number, by[def.uid].due_date], ['1', FUTURE], 'a default notice gives its cure date');
  assert.deepEqual([by[dist.uid].call_number, by[dist.uid].due_date], [null, null]);
  for (const n of [call, def, dist]) {
    const one = await f.call(LP_A, 'GET', `/mine/${n.uid}`);
    assert.deepEqual([one.body.call_number, one.body.due_date], [by[n.uid].call_number, by[n.uid].due_date]);
    assert.ok(!one.text.includes(FUND_NUMBER), 'a full account number leaked');
  }
  assert.ok(!mine.text.includes(FUND_NUMBER), 'a full account number leaked');
  const notSet = { type: 'capital_call_notice', key_figures: [{ label: 'Call number', value: '2' }, { label: 'Due date', value: 'Not set' }] } as any;
  assert.deepEqual(noticeListFacts(notSet), { call_number: '2', due_date: null });
  const adminList = await f.call(ADMIN, 'GET', '');
  assert.equal(adminList.status, 200, adminList.text);
  assert.ok(adminList.body.notices.length >= 3);
  for (const n of adminList.body.notices) assert.equal('due_date' in n, false, 'noticeSummary is unchanged');
});

test('D716 files: drawn once through Browser Run and kept; a failure keeps nothing; a superseded notice keeps a second file', async () => {
  const f = fixture();
  await account(f);
  writeBody(f, 'capital_call_notice', BODY);
  const n = (await issue(f, CALL_LINE)).body.notice;
  f.browser.fail = true;
  const failed = await f.call(ADMIN, 'GET', `/${n.uid}/pdf`);
  assert.deepEqual([failed.status, failed.body.error], [503, 'notice_render_unavailable']);
  assert.equal(f.files.size, 0);
  assert.equal(f.count('SELECT COUNT(*) AS n FROM legal_notice_files'), 0);
  f.browser.fail = false;
  f.browser.calls = 0;
  const first = await f.call(ADMIN, 'GET', `/${n.uid}/pdf`);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'private, no-store');
  assert.match(first.headers.get('content-disposition')!, /^attachment; filename="[A-Za-z0-9_.-]+"$/);
  assert.equal(f.browser.calls, 1);
  assert.equal(f.files.size, 1);
  const second = await f.call(LP_A, 'GET', `/mine/${n.uid}/pdf`);
  assert.equal(f.browser.calls, 1, 'the second download draws nothing');
  assert.deepEqual(second.bytes, first.bytes);
  writeBody(f, 'capital_call_notice', BODY + ' Revised.');
  await issue(f, CALL_LINE, { reason: 'Counsel revised the notice.' });
  await f.call(ADMIN, 'GET', `/${n.uid}/pdf`);
  assert.deepEqual((f.db.prepare('SELECT stamp FROM legal_notice_files ORDER BY id').all() as any[]).map((r) => r.stamp), ['issued', 'superseded']);
  assert.equal(f.browser.fetched, 0, 'BROWSER.fetch is never called');
});

test('D716 seals: legal_notices and legal_notice_files refuse UPDATE and DELETE', async () => {
  const f = fixture();
  await account(f);
  writeBody(f, 'capital_call_notice', BODY);
  const n = (await issue(f, CALL_LINE)).body.notice;
  await f.call(ADMIN, 'GET', `/${n.uid}/pdf`);
  for (const sql of ["UPDATE legal_notices SET reason = 'x'", 'DELETE FROM legal_notices', "UPDATE legal_notice_files SET r2_key = 'x'", 'DELETE FROM legal_notice_files']) {
    assert.throws(() => f.db.exec(sql), /append-only/, sql);
  }
});

/** #1774's period for 2026-Q3 on Fund I, with two lines; issued unless asked for a draft. */
function seedFees(f: F, status: 'draft' | 'issued' = 'issued') {
  f.db.exec(`
    INSERT INTO fund_mgmt_fee_terms (id, uid, fund_id, fee_start_date, investment_period_end, effective_from, lpa_reference, status, confirmed_at)
      VALUES (1, 'terms-1', 10, '2026-01-01', '2030-12-31', '2026-01-01', 'LPA s. 4.2', 'confirmed', '2026-01-01T00:00:00Z');
    INSERT INTO fund_fee_periods (id, uid, fund_id, quarter, window_start, window_end, terms_id, status, digest, gross_cents, catch_up_cents,
        offset_pool_cents, offset_applied_cents, offset_carried_cents, net_cents, remittance_reference)
      VALUES (1, 'period-1', 10, '2026Q3', '2026-07-01', '2026-09-30', 1, 'draft', '${'d'.repeat(64)}', 2000, 300, 100, 100, 0, 2200, 'AXAL-MF-2026Q3-F10');
    INSERT INTO fund_fee_lines (uid, period_id, fund_id, limited_partner_id, commitment_cents, committed_days, invested_days, gross_fee_cents,
        catch_up_days, catch_up_cents, offset_cents, net_fee_cents, reference_code)
      VALUES ('line-a', 1, 10, 101, 100000, 92, 0, 500, 31, 300, 25, 775, 'AXAL-MF-2026Q3-L101'),
             ('line-b', 1, 10, 102, 300000, 92, 0, 1500, 0, 0, 75, 1425, 'AXAL-MF-2026Q3-L102');
  `);
  if (status === 'issued') {
    f.db.exec("UPDATE fund_fee_periods SET status = 'issued', issued_at = '2026-07-01T00:00:00Z' WHERE id = 1");
    f.db.exec("UPDATE fund_fee_lines SET status = 'issued' WHERE period_id = 1");
  }
}
const STATEMENT = { type: 'management_fee_statement', source: { fund_id: 10, quarter: '2026Q3', lp_id: 101 } };
const INVOICE = { type: 'management_fee_invoice', source: { fund_id: 10, quarter: '2026Q3' } };

test('D716 the fee statement: #1774\'s figures, "Nothing is due from you", no account and no block; it previews and never issues here', async () => {
  const f = fixture();
  seedFees(f);
  await account(f, { purposes: ['capital_contribution'] });
  const p = await preview(f, STATEMENT);
  assert.equal(p.status, 200, p.text);
  assert.equal(p.body.refusal, null);
  const fig = p.body.figures;
  assert.deepEqual([fig.sender, fig.payee, fig.payment, fig.reference, fig.amount_cents], ['fund', null, null, 'AXAL-MF-2026Q3-L101', 775]);
  assert.ok(fig.addressee.includes('Limited partner no. L101'));
  const keys = Object.fromEntries(fig.key_figures.map((k: any) => [k.label, k.value]));
  assert.deepEqual([keys['Fee window'], keys.Rate, keys['Net fee']], ['2026-07-01 to 2026-09-30 (92 days)', '2.00% a year', '$7.75']);
  assert.deepEqual(fig.tables[1].rows, [['Gross fee', '$5.00'], ['Catch-up (31 days)', '$3.00'], ['Offset', '-$0.25'], ['Net fee', '$7.75']]);
  assert.ok(p.body.html.includes('Nothing is due from you against this statement.'));
  assert.ok(!p.body.html.includes('section class="payment"') && !p.body.html.includes('ending ') && !p.body.html.includes(FUND_NUMBER.slice(-4)),
    'no block and no account, masked or not');
  const issued = await f.call(SUPER, 'POST', '/issue', { page_size: 'letter', ...STATEMENT, figures_sha256: p.body.figures_sha256 });
  assert.deepEqual([issued.status, issued.body.error], [409, 'statement_not_issued_here']);
  assert.equal(f.count('SELECT COUNT(*) AS n FROM legal_notices'), 0);
  const other = await preview(f, { ...STATEMENT, source: { fund_id: 10, quarter: '2026Q3', lp_id: 999 } });
  assert.deepEqual([other.status, other.body.error], [404, 'source_not_found']);
  assert.equal((await preview(f, { ...STATEMENT, source: { fund_id: 10, quarter: 'Q3', lp_id: 101 } })).body.error, 'source_invalid');
  assert.equal((await preview(f, { ...STATEMENT, source: { fund_id: 20, quarter: '2026Q3', lp_id: 201 } })).body.error, 'not_an_axal_fund');
});

test('D716 the fee invoice: the GP to the Fund, the period\'s lines and remittance reference, the GP\'s masked block; a draft period is refused', async () => {
  const draft = fixture();
  seedFees(draft, 'draft');
  for (const req of [INVOICE, STATEMENT]) {
    const r = await preview(draft, req);
    assert.deepEqual([r.status, r.body.error], [409, 'fee_period_not_issued'], req.type);
  }
  const f = fixture();
  seedFees(f);
  const none = await preview(f, INVOICE);
  assert.equal(none.status, 200, none.text);
  assert.equal(none.body.refusal.code, 'no_active_account', 'no GP account yet: #1773\'s refusal in the block\'s place');
  await account(f, { entity: 'gp', beneficiary: 'Axal VC GP LLC', purposes: ['management_fee'] });
  const p = await preview(f, INVOICE);
  assert.equal(p.body.refusal, null, p.text);
  const fig = p.body.figures;
  assert.deepEqual([fig.sender, fig.payee, fig.purpose, fig.reference, fig.amount_cents], ['gp', 'gp', 'management_fee', 'AXAL-MF-2026Q3-F10', 2200]);
  assert.ok(fig.addressee[0].startsWith('From: Axal VC GP LLC') && fig.addressee[1] === 'To: Axal VC Spin-Out Lab Fund I LP');
  assert.deepEqual(fig.tables[0].rows.map((r: string[]) => r[0]), ['L101', 'L102', 'Total']);
  assert.deepEqual(fig.tables[0].rows[2], ['Total', '', '$20.00', '$3.00', '-$1.00', '$22.00']);
  assert.ok(p.body.html.includes(`ending ${FUND_NUMBER.slice(-4)}`) && p.body.html.includes('AXAL-MF-2026Q3-F10'), 'the GP block and the remittance reference');
  assert.ok(!p.text.includes(FUND_NUMBER), 'no response holds the full number');
  assert.ok(!p.body.html.includes('class="execution'), 'an invoice prints no block');
  // A plain Admin previews; only the Super Admin issues.
  const plain = await f.call(ADMIN, 'POST', '/issue', { page_size: 'letter', ...INVOICE, figures_sha256: p.body.figures_sha256 });
  assert.deepEqual([plain.status, plain.body.code ?? plain.body.error], [403, 'super_admin_required']);
  const done = await issue(f, INVOICE);
  assert.equal(done.status, 201, done.text);
  assert.equal(f.one("SELECT reference FROM legal_notices").reference, 'AXAL-MF-2026Q3-F10');
  assert.equal((await issue(f, INVOICE)).body.already_issued, true);
});

// D758 (#1864): the catalog's thumbnail of each type is its specimen. It must
// print what the builder prints, with brackets where the builder prints a figure.
const OPTIONAL_LINES = new Set(['Alternate routing number', 'SWIFT', 'Intermediary SWIFT']);
function noticeShape(f: any) {
  return {
    title: f.title, sender: f.sender, payee: f.payee, purpose: f.purpose,
    key_figures: f.key_figures.map((k: any) => [k.label, !!k.mono]),
    tables: f.tables.map((t: any) => ({ title: t.title ?? null, columns: t.columns, total: !!t.total })),
    warning: f.warning,
    payment: f.payment ? f.payment.lines.filter((l: any) => !OPTIONAL_LINES.has(l.label)).map((l: any) => [l.label, !!l.mono]) : null,
    reference: f.reference != null,
    prose: f.prose ? f.prose.slug : null,
    closing: f.closing.length,
  };
}

test('D758 each type\'s specimen prints what its builder prints, in brackets, and no figure', async () => {
  const f = fixture();
  seedFees(f);
  await account(f);
  await account(f, { entity: 'gp', beneficiary: AXAL_ENTITIES.gp.name, purposes: ['management_fee'] });
  await account(f, { entity: 'holdings', beneficiary: AXAL_ENTITIES.holdings.name, purposes: ['platform_licence_fee'] });
  const REAL: Record<string, Record<string, unknown>> = {
    capital_call_notice: CALL_LINE,
    distribution_notice: { type: 'distribution_notice', source: { distribution_id: 41 }, inputs: { tax_character: 'long_term_capital_gain' } },
    default_notice: { type: 'default_notice', source: { line_id: 11 }, inputs: { cure_date: FUTURE, lpa_section: 'Section 3.4' } },
    management_fee_statement: STATEMENT,
    management_fee_invoice: INVOICE,
    platform_licence_fee_invoice: { type: 'platform_licence_fee_invoice', inputs: { licensee: 'gp', period_start: '2026-10-01', period_end: '2026-12-31', amount_cents: 100000, due_date: FUTURE } },
    payment_instructions_letter: { type: 'payment_instructions_letter', inputs: { purpose: 'capital_contribution', to: 'Lena LP' } },
  };
  // D802's territory licence fee invoice is issued only from its licence, never through this preview; licence_fee_invoices_d802.test.ts holds its specimen to a real invoice.
  assert.deepEqual(Object.keys(REAL).sort(), NOTICE_TYPES.map((t) => t.type).filter((t) => t !== 'territory_licence_fee_invoice').sort(), 'every type is held to a real build');
  const bracket = /^\[[^\]\d]+\]$/;
  for (const [type, req] of Object.entries(REAL)) {
    const real = await preview(f, req);
    assert.equal(real.status, 200, `${type}: ${real.text}`);
    assert.ok(real.body.figures.payment === null || real.body.figures.payment.lines, `${type}: the real build has its block`);
    const spec = await noticeSpecimen(f.env, type);
    assert.deepEqual(noticeShape(spec), noticeShape(real.body.figures), type);
    for (const k of spec.key_figures) assert.match(k.value, bracket, `${type}: ${k.label}`);
    for (const t of spec.tables) {
      for (const row of t.rows) for (const cell of row) assert.ok(cell === 'Total' || cell === '' || bracket.test(cell), `${type}: ${cell}`);
      if (t.total) assert.equal(t.rows[t.rows.length - 1][0], 'Total', `${type}: the total row`);
    }
    for (const l of spec.payment?.lines ?? []) {
      assert.ok(bracket.test(l.value) || l.value === RECEIVING_BRACKET || l.label === 'Full account number', `${type}: ${l.label}`);
    }
    if (spec.reference !== null) assert.equal(spec.reference, '[Reference]');
    assert.ok(spec.addressee.includes('To: [Addressee]'), `${type}: the addressee`);
    if (real.body.figures.addressee[0].startsWith('From:')) assert.equal(spec.addressee[0], real.body.figures.addressee[0], `${type}: the sender line`);
    assert.deepEqual([spec.fund_id, spec.limited_partner_id, spec.amount_cents], [null, null, null], type);
    const text = JSON.stringify(spec);
    assert.doesNotMatch(text, /\$\d|ending \d|4400556677|6677|121145433|L101/, `${type}: no figure, no account`);
  }
});
