/**
 * D802 (#2238) — HQ's annual licence-fee invoices to a territory licensee
 * (migration 513): the licence year, issuing once per year, recording payment,
 * the PDF, who may do each, and the Administrator's read.
 *
 * On node:sqlite with the baseline's own DDL and migrations 260, 472 and 513
 * from their files. The bank account is written as the console writes it, with
 * a number drawn at run time, so no account number is in this file; the people
 * and the licensees are placeholders. The PDF renderer is stubbed. Each case
 * names the mutations it was checked against.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_fee_invoices_d802.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { PDFDocument } from 'pdf-lib';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import adminLicences from '../src/routes/admin_licences.ts';
import adminStatements from '../src/routes/admin_statements.ts';
import { drawStatement, shareOf } from '../src/services/statements.ts';
import licence from '../src/routes/licence.ts';
import { encryptColumn } from '../src/services/columnCipher.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { NOTICE_TYPES, buildNoticeFigures, formatMoney, noticeSpecimen } from '../src/services/fundNotices.ts';
import { AXAL_ENTITIES, AXAL_LEGAL_ADDRESS } from '../src/services/legalDocFormat.ts';
import { DEFAULT_PAYMENT_TERMS_DAYS, addDays, licenceYear, paymentTermsDays } from '../src/services/licenceFeeInvoices.ts';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (f: string) => readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8');
const SCHEMA = ['users', 'super_admins', 'user_sessions', 'activity_logs', 'territory_licences', 'licence_admins']
  .map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n')
  + '\n' + ['260_subsidiary_statements.sql', '472_entity_bank_accounts.sql', '513_licence_fee_invoices.sql'].map(mig).join('\n')
  // D797's terms table; its branch-copy column is a branch table this test does not use.
  + '\n' + mig('512_licence_terms.sql').replace(/ALTER TABLE branch_licence[^;]*;/, '');
const SECRET = ['d802', 'invoices', 'fixture', 'signing', 'secret'].join('-');

const SUPER = 1, SUPER_PW = 2, ADMIN = 3, PRINCIPAL = 4, DELEGATE = 5, OTHER_PRINCIPAL = 6, MEMBER = 7;
const TODAY = () => new Date().toISOString().slice(0, 10);
/** A ten-digit number drawn per run: never a literal in this file. */
const accountNumber = () => String(randomInt(1_000_000_000, 9_999_999_999));

async function fixture(o: { account?: boolean } = {}) {
  const { DB, db } = makeD1(SCHEMA);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  for (const [id, role] of [[SUPER, 'admin'], [SUPER_PW, 'admin'], [ADMIN, 'admin'], [PRINCIPAL, 'admin'], [DELEGATE, 'admin'],
    [OTHER_PRINCIPAL, 'admin'], [MEMBER, 'founder']] as const) u.run(id, role, `Person ${id}`, `user${id}@example.test`);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER}), (${SUPER_PW})`);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, ?, datetime('now'))");
  s.run(SUPER, 'totp-super', 'totp');
  s.run(SUPER_PW, 'pw-super', 'password');
  for (const id of [ADMIN, PRINCIPAL, DELEGATE, OTHER_PRINCIPAL, MEMBER]) s.run(id, `totp-${id}`, 'totp');
  const l = db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, currency, annual_fee_cents, starts_on)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  l.run(1, 'lic_a', 'LIC-A', 'Licensee A', 'Brand A', 'active', 'EUR', 1200000, '2020-03-15');
  db.prepare('UPDATE territory_licences SET revenue_share_bps = 3000 WHERE uid = ?').run('lic_a');
  l.run(2, 'lic_b', 'LIC-B', 'Licensee B', 'Brand B', 'active', 'USD', 500000, '2021-01-01');
  l.run(3, 'lic_nofee', 'LIC-C', 'Licensee C', 'Brand C', 'active', 'EUR', null, '2021-01-01');
  l.run(4, 'lic_nostart', 'LIC-D', 'Licensee D', 'Brand D', 'active', 'EUR', 100000, null);
  l.run(5, 'lic_draft', 'LIC-E', 'Licensee E', 'Brand E', 'draft', 'EUR', 100000, '2021-01-01');
  const a = db.prepare('INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (?, ?, ?)');
  a.run(1, PRINCIPAL, 'principal');
  a.run(1, DELEGATE, 'delegate');
  a.run(2, OTHER_PRINCIPAL, 'principal');

  const browser = { calls: 0 };
  const BROWSER = {
    fetch: async () => { throw new Error('BROWSER.fetch must not be called'); },
    quickAction: async () => { browser.calls++; const d = await PDFDocument.create(); d.addPage([595, 842]); return new Response(await d.save()); },
  };
  const env = { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development', BROWSER } as any;
  let number: string | null = null;
  if (o.account !== false) {
    number = accountNumber();
    const uid = '0000bbbb-0000-4000-8000-000000000802';
    const enc = await encryptColumn(env, 'entity_bank_accounts', 'account_number_enc', uid, number);
    db.prepare(`INSERT INTO entity_bank_accounts
        (uid, entity_key, label, bank_name, bank_address, beneficiary_name, beneficiary_address, account_kind,
         account_number_enc, account_last4, routing_number, swift_code, purposes_json, status, recorded_by)
       VALUES (?, 'holdings', 'Fixture', 'Bank A', 'Bank address A', 'Axal VC Holdings LLC', 'Registered address A', 'checking',
         ?, ?, '000000000', 'BANKAXXX', '["territory_licence_fee"]', 'active', ?)`)
      .run(uid, enc, number.slice(-4), SUPER);
  }
  const app = new Hono<any>();
  app.route('/api/admin/licences', adminLicences);
  app.route('/api/licence', licence);
  app.route('/api/admin', adminStatements);
  app.onError((err: any, c) => {
    const status = ({ Unauthorized: 401, 'Admin required': 403 } as Record<string, 401 | 403>)[String(err?.message || '')];
    if (status) return c.json({ detail: err.message }, status);
    throw err;
  });
  async function call(who: number, method: string, path: string, body?: unknown) {
    const jti = who === SUPER ? 'totp-super' : who === SUPER_PW ? 'pw-super' : `totp-${who}`;
    const token = await new SignJWT({ user_id: who, jti }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const res = await withThrownResponses(() => app.request(`/api${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env));
    const buf = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder().decode(buf);
    let json: any = null; try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, body: json, text, headers: res.headers };
  }
  const rows = (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
  return { db, env, call, rows, number, browser };
}

// 1 ───────────────────────────────────────────────────────────────────────────
test('the licence year runs from the anniversary; a licence not started yet is invoiced its first year; terms default to 30 days', () => {
  // Mutations checked: the year taken from today's calendar year; the end on the anniversary itself; 29 Feb unclamped; the first year refused.
  assert.deepEqual(licenceYear('2020-03-15', '2026-10-20'), { label: '2026–27', key: '2026-27', start: '2026-03-15', end: '2027-03-14' });
  assert.deepEqual(licenceYear('2020-03-15', '2026-03-14'), { label: '2025–26', key: '2025-26', start: '2025-03-15', end: '2026-03-14' });
  assert.equal(licenceYear('2020-03-15', '2026-03-15').start, '2026-03-15', 'the anniversary opens the new year');
  assert.deepEqual(licenceYear('2024-02-29', '2025-03-01'), { label: '2025–26', key: '2025-26', start: '2025-02-28', end: '2026-02-27' });
  assert.equal(licenceYear('2027-06-01', '2026-10-20').start, '2027-06-01', 'before the start: the first year, invoiced in advance');
  assert.equal(licenceYear('2099-12-31', '2026-01-01').label, '2099–00');
  assert.equal(addDays('2026-12-15', 30), '2027-01-14');
  assert.equal(paymentTermsDays(), DEFAULT_PAYMENT_TERMS_DAYS);
  assert.equal(paymentTermsDays({ paymentTermsDays: 45 }), 45);
  assert.equal(paymentTermsDays({ paymentTermsDays: null }), 30);
  assert.equal(formatMoney(1200000, 'EUR'), '€12,000.00');
  assert.equal(formatMoney(1200000, 'usd'), '$12,000.00');
  assert.equal(formatMoney(5, 'CHF'), 'CHF 0.05');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('a Super Admin issues one invoice per licence year: the ledger\'s fee, the anniversary year, due in 30 days, audited; a second is refused', async () => {
  // Mutations checked: the duplicate check removed (and the index dropped); the amount not the ledger's; the due date not today + 30; no audit row.
  const f = await fixture();
  const year = licenceYear('2020-03-15', TODAY());
  const r = await f.call(SUPER, 'POST', '/admin/licences/lic_a/fee-invoices');
  assert.equal(r.status, 201, r.text);
  const inv = r.body.invoice;
  assert.deepEqual([inv.amount_cents, inv.currency, inv.period_label, inv.period_start, inv.period_end, inv.status, inv.paid_cents, inv.outstanding_cents],
    [1200000, 'EUR', year.label, year.start, year.end, 'issued', 0, 1200000]);
  assert.equal(inv.reference, `AXAL-LIC-LIC-A-${year.key}`);
  assert.equal(inv.issued_at, TODAY());
  assert.equal(inv.due_at, addDays(TODAY(), 30));
  assert.equal(inv.pdf_url, `/api/admin/licences/lic_a/fee-invoices/${inv.uid}/pdf`);
  const audit = f.rows("SELECT action, details FROM activity_logs WHERE action = 'licence_fee_invoice_issued'");
  assert.equal(audit.length, 1);
  assert.equal(JSON.parse(audit[0].details).invoice_uid, inv.uid);

  const again = await f.call(SUPER, 'POST', '/admin/licences/lic_a/fee-invoices');
  assert.equal(again.status, 409);
  assert.deepEqual([again.body.error, again.body.invoice_uid], ['invoice_exists', inv.uid]);
  assert.equal(f.rows('SELECT uid FROM licence_fee_invoices').length, 1);
  // The index holds even past the route's read.
  assert.throws(() => f.db.prepare(`INSERT INTO licence_fee_invoices (uid, licence_uid, period_label, period_start, period_end, amount_cents, currency,
    reference, issued_at, due_at, figures_json, figures_sha256) VALUES ('x', 'lic_a', 'x', ?, ?, 1, 'EUR', 'r', 'd', 'd', '{}', 'h')`).run(year.start, year.end), /UNIQUE/);

  const list = await f.call(SUPER, 'GET', '/admin/licences/lic_a/fee-invoices');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.invoices.map((i: any) => i.uid), [inv.uid]);
  assert.equal((await f.call(SUPER, 'GET', '/admin/licences/lic_b/fee-invoices')).body.invoices.length, 0, 'per licence');
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('nothing is invoiced without a fee, a start date, a billable status or the bank account for the purpose', async () => {
  // Mutations checked: the fee check removed; the status check removed; the payment refusal ignored.
  const f = await fixture({ account: false });
  for (const [uid, code] of [['lic_nofee', 'no_annual_fee'], ['lic_nostart', 'no_start_date'], ['lic_draft', 'licence_not_billable']]) {
    const r = await f.call(SUPER, 'POST', `/admin/licences/${uid}/fee-invoices`);
    assert.deepEqual([r.status, r.body.error], [409, code], uid);
  }
  const noAccount = await f.call(SUPER, 'POST', '/admin/licences/lic_a/fee-invoices');
  assert.equal(noAccount.status, 409);
  assert.notEqual(noAccount.body.error, 'invoice_exists');
  assert.equal(f.rows('SELECT uid FROM licence_fee_invoices').length, 0);
  assert.equal((await f.call(SUPER, 'POST', '/admin/licences/nope/fee-invoices')).status, 404);
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('only a Super Admin with a TOTP session and a fresh step-up issues or records; an Admin or a member cannot', async () => {
  // Mutations checked: the write bar replaced by plain Super Admin; the read open to any admin.
  const f = await fixture();
  for (const who of [ADMIN, PRINCIPAL, MEMBER, SUPER_PW]) {
    const r = await f.call(who, 'POST', '/admin/licences/lic_a/fee-invoices');
    assert.ok(r.status === 401 || r.status === 403, `${who}: ${r.status}`);
  }
  assert.equal(f.rows('SELECT uid FROM licence_fee_invoices').length, 0);
  const inv = (await f.call(SUPER, 'POST', '/admin/licences/lic_a/fee-invoices')).body.invoice;
  for (const who of [ADMIN, PRINCIPAL, SUPER_PW]) {
    const r = await f.call(who, 'PATCH', `/admin/licences/lic_a/fee-invoices/${inv.uid}`, { paid_cents: 100 });
    assert.ok(r.status === 401 || r.status === 403, `${who}: ${r.status}`);
  }
  assert.equal(f.rows('SELECT paid_cents FROM licence_fee_invoices')[0].paid_cents, 0);
  for (const who of [ADMIN, PRINCIPAL]) {
    assert.ok([401, 403].includes((await f.call(who, 'GET', '/admin/licences/lic_a/fee-invoices')).status));
    assert.ok([401, 403].includes((await f.call(who, 'GET', `/admin/licences/lic_a/fee-invoices/${inv.uid}/pdf`)).status));
  }
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('HQ records the running total received, never above the amount; a full payment marks it paid; a void needs nothing paid and a reason', async () => {
  // Mutations checked: the over-amount check removed; the paid status not set; a void with a payment allowed; a void edited afterwards.
  const f = await fixture();
  const inv = (await f.call(SUPER, 'POST', '/admin/licences/lic_a/fee-invoices')).body.invoice;
  const path = `/admin/licences/lic_a/fee-invoices/${inv.uid}`;
  const part = await f.call(SUPER, 'PATCH', path, { paid_cents: 400000, paid_note: 'Bank ref 1' });
  assert.equal(part.status, 200, part.text);
  assert.deepEqual([part.body.invoice.status, part.body.invoice.paid_cents, part.body.invoice.outstanding_cents, part.body.invoice.paid_note],
    ['issued', 400000, 800000, 'Bank ref 1']);
  assert.ok(part.body.invoice.paid_at);
  const over = await f.call(SUPER, 'PATCH', path, { paid_cents: 1200001 });
  assert.deepEqual([over.status, over.body.error, over.body.field], [409, 'over_amount', 'paid_cents']);
  assert.equal((await f.call(SUPER, 'PATCH', path, { paid_cents: -1 })).body.error, 'bad_amount');
  assert.equal((await f.call(SUPER, 'PATCH', path, { status: 'void', void_note: 'Issued in error to the wrong year' })).body.error, 'paid_not_void');
  const full = await f.call(SUPER, 'PATCH', path, { paid_cents: 1200000 });
  assert.deepEqual([full.body.invoice.status, full.body.invoice.outstanding_cents], ['paid', 0]);
  assert.equal((await f.call(SUPER, 'PATCH', path, { paid_cents: 0 })).body.invoice.status, 'issued', 'the status follows the total');
  assert.equal((await f.call(SUPER, 'PATCH', path, { status: 'void', void_note: 'short' })).body.error, 'void_note_required');
  const v = await f.call(SUPER, 'PATCH', path, { status: 'void', void_note: 'Issued in error to the wrong year' });
  assert.deepEqual([v.body.invoice.status, v.body.invoice.outstanding_cents, v.body.invoice.pdf_url], ['void', 0, null]);
  assert.equal((await f.call(SUPER, 'PATCH', path, { paid_cents: 100 })).body.error, 'invoice_void');
  assert.equal((await f.call(SUPER, 'GET', `${path}/pdf`)).status, 409, 'a void invoice is not printed');
  assert.equal((await f.call(SUPER, 'POST', '/admin/licences/lic_a/fee-invoices')).body.error, 'invoice_exists', 'a void year still holds its period');
  const actions = f.rows("SELECT action FROM activity_logs WHERE action LIKE 'licence_fee_invoice_%' ORDER BY id").map((r) => r.action);
  assert.deepEqual(actions, ['licence_fee_invoice_issued', 'licence_fee_invoice_payment', 'licence_fee_invoice_payment',
    'licence_fee_invoice_payment', 'licence_fee_invoice_void']);
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('the invoice names the licensor, the licensee, the reference and a masked account, and the PDF is drawn from what was issued', async () => {
  // Mutations checked: the reference not on the figures; the account unmasked; the addressee without the licensor; the PDF from today's ledger.
  const f = await fixture();
  const inv = (await f.call(SUPER, 'POST', '/admin/licences/lic_a/fee-invoices')).body.invoice;
  const row = f.rows('SELECT figures_json, figures_sha256 FROM licence_fee_invoices')[0];
  const figures = JSON.parse(row.figures_json);
  assert.equal(figures.type, 'territory_licence_fee_invoice');
  assert.deepEqual(figures.addressee, [`From: ${AXAL_ENTITIES.holdings.name}, ${AXAL_LEGAL_ADDRESS}`, 'To: Licensee A']);
  assert.equal(figures.reference, inv.reference);
  assert.equal(figures.payment.reference, inv.reference);
  assert.equal(figures.purpose, 'territory_licence_fee');
  assert.ok(figures.key_figures.some((k: any) => k.label === 'Amount due' && k.value === '€12,000.00'));
  assert.ok(figures.key_figures.some((k: any) => k.label === 'Licence' && k.value === 'LIC-A'));
  const account = figures.payment.lines.find((l: any) => l.label === 'Account');
  assert.match(account.value, new RegExp(`${f.number!.slice(-4)}$`));
  assert.equal(row.figures_json.includes(f.number!), false, 'the full number is never on the invoice');
  assert.match(row.figures_sha256, /^[0-9a-f]{64}$/);

  f.db.prepare('UPDATE territory_licences SET annual_fee_cents = 999 WHERE uid = ?').run('lic_a');
  const pdf = await f.call(SUPER, 'GET', `/admin/licences/lic_a/fee-invoices/${inv.uid}/pdf`);
  assert.equal(pdf.status, 200, pdf.text);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(pdf.headers.get('content-disposition')!, new RegExp(`filename="${inv.reference}\\.pdf"`));
  assert.ok(pdf.text.startsWith('%PDF'));
  assert.equal(f.rows('SELECT amount_cents FROM licence_fee_invoices')[0].amount_cents, 1200000, 'frozen at issue');
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('the Administrator reads only their own licence\'s invoices, without HQ\'s notes, and prints only their own', async () => {
  // Mutations checked: the read not scoped to the caller's licence; the PDF looked up by uid alone; HQ's paid note leaked.
  const f = await fixture();
  const a = (await f.call(SUPER, 'POST', '/admin/licences/lic_a/fee-invoices')).body.invoice;
  const b = (await f.call(SUPER, 'POST', '/admin/licences/lic_b/fee-invoices')).body.invoice;
  await f.call(SUPER, 'PATCH', `/admin/licences/lic_a/fee-invoices/${a.uid}`, { paid_cents: 100, paid_note: 'HQ-ONLY-NOTE' });
  for (const who of [PRINCIPAL, DELEGATE]) {
    const r = await f.call(who, 'GET', '/licence/mine/statements');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.fee_invoices.map((i: any) => i.uid), [a.uid]);
    assert.equal(r.body.fee_invoices_reason, null);
    assert.equal(r.body.fee_invoices[0].pdf_url, `/api/licence/mine/fee-invoices/${a.uid}/pdf`);
    assert.equal(r.body.fee_invoices[0].paid_cents, 100);
    assert.equal(JSON.stringify(r.body).includes('HQ-ONLY-NOTE'), false);
  }
  assert.deepEqual((await f.call(OTHER_PRINCIPAL, 'GET', '/licence/mine/statements')).body.fee_invoices.map((i: any) => i.uid), [b.uid]);
  const own = await f.call(PRINCIPAL, 'GET', `/licence/mine/fee-invoices/${a.uid}/pdf`);
  assert.equal(own.status, 200, own.text);
  assert.equal(own.headers.get('content-type'), 'application/pdf');
  assert.equal((await f.call(PRINCIPAL, 'GET', `/licence/mine/fee-invoices/${b.uid}/pdf`)).status, 404, 'another licence\'s invoice is not found');
  assert.equal((await f.call(MEMBER, 'GET', `/licence/mine/fee-invoices/${a.uid}/pdf`)).status, 404);
});

// 8 ───────────────────────────────────────────────────────────────────────────
test('the generated-document type: registered, drawn as a specimen, and never issued through the generic notice routes', async () => {
  // Mutations checked: the generic builder accepting the type; the specimen's labels differing from a real build's.
  const def = NOTICE_TYPES.find((t) => t.type === 'territory_licence_fee_invoice')!;
  assert.deepEqual([def.title, def.sender, def.prose, def.senderBlock], ['Territory Licence Fee Invoice', 'holdings', false, false]);
  const f = await fixture();
  await assert.rejects(buildNoticeFigures(f.env, { type: 'territory_licence_fee_invoice', inputs: {} } as any, TODAY()),
    (e: any) => e.code === 'issued_from_licence');
  await f.call(SUPER, 'POST', '/admin/licences/lic_a/fee-invoices');
  const real = JSON.parse(f.rows('SELECT figures_json FROM licence_fee_invoices')[0].figures_json);
  const spec = await noticeSpecimen(f.env, 'territory_licence_fee_invoice');
  assert.deepEqual(spec.key_figures.map((k) => k.label), real.key_figures.map((k: any) => k.label));
  assert.deepEqual(spec.tables[0].columns, real.tables[0].columns);
  assert.equal(spec.purpose, real.purpose);
  const optional = new Set(['Alternate routing number', 'SWIFT', 'Intermediary SWIFT']);
  assert.deepEqual(spec.payment!.lines!.map((l) => l.label), real.payment.lines.map((l: any) => l.label).filter((l: string) => !optional.has(l)));
  assert.equal(spec.addressee[0], real.addressee[0], 'the sender line');
  assert.equal(spec.reference, '[Reference]');
  assert.doesNotMatch(JSON.stringify(spec), /\u20ac\d|\$\d|LIC-A/, 'no figure');
});

// 9 ───────────────────────────────────────────────────────────────────────────
test('part 1 and 2: each stream is owed at its own share, a missing share falls back and says so, and the royalty is drawn on the licence fees', () => {
  // Mutations checked: every stream at the fallback; the fallback not named; the royalty on the gross total; an unrecorded royalty owed at 0% as if recorded; the royalty added to the gross; one rounding over the total.
  const F = (stream: string, gross: number | null) => ({ stream, gross_cents: gross, currency: 'EUR', available: gross !== null });
  const streams = [F('subscriptions', 1000001), F('licence_fees', 400000), F('token_margin', 250003), F('other', 50000)];
  const d = drawStatement(streams, { fallback_bps: 3000, subscriptions: 2500, licence_fees: 1000, token_margin: 4000, royalty_bps: 500 }, 'EUR');
  const by = Object.fromEntries(d.streams.map((s) => [s.stream, s]));
  assert.deepEqual([by.subscriptions.share_bps, by.subscriptions.owed_cents, by.subscriptions.share_source], [2500, 250000, 'terms']);
  assert.deepEqual([by.licence_fees.share_bps, by.licence_fees.owed_cents], [1000, 40000]);
  assert.deepEqual([by.token_margin.share_bps, by.token_margin.owed_cents], [4000, 100001]);
  assert.deepEqual([by.other.share_bps, by.other.owed_cents, by.other.share_source], [3000, 15000, 'ledger']);
  assert.match(by.other.share_note!, /licence's revenue share is used/);
  assert.equal(by.subscriptions.share_note, undefined);
  const royalty = by.platform_licence_royalties;
  assert.deepEqual([royalty.gross_cents, royalty.royalty_bps, royalty.owed_cents, royalty.not_recorded, royalty.available], [400000, 500, 20000, false, true]);
  assert.equal(d.gross_cents, 1000001 + 400000 + 250003 + 50000, 'the royalty adds nothing to the gross');
  assert.equal(d.owed_cents, 250000 + 40000 + 100001 + 15000 + 20000, 'the total owed is each stream\'s owed, summed');
  assert.equal(d.revenue_share_bps, 3000);
  assert.equal(d.per_stream, true);

  const noRoyalty = drawStatement(streams, { fallback_bps: 3000 }, 'EUR');
  const r2 = noRoyalty.streams.find((s) => s.stream === 'platform_licence_royalties')!;
  assert.deepEqual([r2.not_recorded, r2.owed_cents, r2.royalty_bps, r2.available], [true, 0, null, false]);
  assert.match(r2.reason!, /^Not recorded/);
  assert.equal(noRoyalty.unreported, 0, 'an unset royalty is not an unreported stream');
  assert.equal(noRoyalty.complete, true);
  assert.ok(noRoyalty.streams.filter((s) => s.stream !== 'platform_licence_royalties').every((s) => s.share_source === 'ledger' && s.share_bps === 3000));
  // The single-share draw is unchanged: one rounding over the total.
  const legacy = drawStatement(streams, 3000, 'EUR');
  assert.equal(legacy.owed_cents, shareOf(1700004, 3000));
  assert.equal(legacy.streams.length, 4);
});

// 10 ──────────────────────────────────────────────────────────────────────────
test('the draw reads D797\'s shares and royalty from the terms, falls back without them, and a re-draw below what was recorded is refused', async () => {
  // Mutations checked: the draw ignoring the terms; the royalty not read; the recorded-above-owed refusal removed.
  const f = await fixture();
  const report = f.db.prepare(`INSERT INTO subsidiary_usage_reports (licence_uid, branch_code, period, stream, gross_cents, currency, is_estimate, reported_at)
    VALUES ('lic_a', 'a', '2026-Q3', ?, ?, 'EUR', 0, '2026-10-01')`);
  report.run('subscriptions', 1000000); report.run('licence_fees', 400000); report.run('token_margin', 200000); report.run('other', 0);
  f.db.prepare(`INSERT INTO licence_terms (licence_uid, share_subscriptions_bps, share_licence_fees_bps, royalty_platform_licence_bps) VALUES ('lic_a', 2500, 1000, 500)`).run();
  const d = await f.call(SUPER, 'POST', '/admin/statements/draw', { licence_uid: 'lic_a', period: '2026-Q3' });
  assert.equal(d.status, 201, d.text);
  const by = Object.fromEntries(d.body.streams.map((s: any) => [s.stream, s]));
  assert.deepEqual([by.subscriptions.share_bps, by.licence_fees.share_bps, by.token_margin.share_bps, by.token_margin.share_source], [2500, 1000, 3000, 'ledger']);
  assert.equal(by.platform_licence_royalties.owed_cents, 20000);
  assert.equal(d.body.owed_cents, 250000 + 40000 + 60000 + 0 + 20000);
  const stored = JSON.parse(f.rows("SELECT streams_json FROM subsidiary_statements WHERE licence_uid = 'lic_a'")[0].streams_json);
  assert.equal(stored.find((s: any) => s.stream === 'token_margin').share_source, 'ledger', 'the row says it was drawn on the fallback');

  f.db.prepare("UPDATE subsidiary_statements SET paid_cents = ? WHERE licence_uid = 'lic_a'").run(d.body.owed_cents);
  f.db.prepare("UPDATE licence_terms SET share_subscriptions_bps = 100 WHERE licence_uid = 'lic_a'").run();
  const lower = await f.call(SUPER, 'POST', '/admin/statements/draw', { licence_uid: 'lic_a', period: '2026-Q3' });
  assert.deepEqual([lower.status, lower.body.error], [409, 'recorded_above_owed']);

  f.db.prepare("DELETE FROM licence_terms").run();
  f.db.prepare("DELETE FROM subsidiary_statements").run();
  const none = await f.call(SUPER, 'POST', '/admin/statements/draw', { licence_uid: 'lic_a', period: '2026-Q3' });
  assert.equal(none.status, 201, none.text);
  assert.equal(none.body.streams.find((s: any) => s.stream === 'platform_licence_royalties').not_recorded, true);
  assert.equal(none.body.owed_cents, shareOf(1000000, 3000) + shareOf(400000, 3000) + shareOf(200000, 3000));
});

// 11 ──────────────────────────────────────────────────────────────────────────
test('an invoice is due after D797\'s payment terms, and a licence whose terms name another licensor is not invoiced', async () => {
  // Mutations checked: the payment terms not read; the licensor not checked.
  const f = await fixture();
  f.db.prepare("INSERT INTO licence_terms (licence_uid, payment_terms_days) VALUES ('lic_a', 45)").run();
  const r = await f.call(SUPER, 'POST', '/admin/licences/lic_a/fee-invoices');
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.invoice.due_at, addDays(TODAY(), 45));
  f.db.prepare("INSERT INTO licence_terms (licence_uid, licensor_ip_entity) VALUES ('lic_b', 'management')").run();
  const other = await f.call(SUPER, 'POST', '/admin/licences/lic_b/fee-invoices');
  assert.deepEqual([other.status, other.body.error], [409, 'licensor_not_payee']);
  assert.equal(f.rows("SELECT uid FROM licence_fee_invoices WHERE licence_uid = 'lic_b'").length, 0);
});
