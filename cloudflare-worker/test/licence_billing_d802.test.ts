/**
 * D802 (#2238) — HQ's annual licence-fee invoices to a territory licensee:
 * issued once per fee year, paid or voided by HQ, printed with the licensor,
 * the reference and a masked account, and read by the licence's own
 * Administrator. (The per-stream shares and the royalty are pinned in
 * `hq_statements.test.ts`, beside the draw they change.)
 *
 * On node:sqlite, with migrations 260, 472, 512 and 513 read from their files.
 * The bank account is written as the console writes it, with a number drawn at
 * run time, so no account number is in this file; the people are placeholders.
 * Stripe and the bank are never called: nothing here reaches either.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_billing_d802.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomInt } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { PDFDocument } from 'pdf-lib';

import feeInvoices from '../src/routes/admin_licence_fee_invoices.ts';
import licence from '../src/routes/licence.ts';
import { encryptColumn } from '../src/services/columnCipher.ts';
import { addDays, feeInvoiceReference, feePeriod, moneyText } from '../src/services/licenceFeeInvoice.ts';

const JWT_SECRET = 'd802-fixture-only-signing-secret';
const SUPER = 1;
const PRINCIPAL = 2;
const OTHER_PRINCIPAL = 3;
const MEMBER = 4;

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const MIGRATION_512 = read('cloudflare-worker/sql/migrations/512_licence_terms.sql').split(/^ALTER TABLE/m)[0];
const MIGRATIONS = [
  'cloudflare-worker/sql/migrations/260_subsidiary_statements.sql',
  'cloudflare-worker/sql/migrations/472_entity_bank_accounts.sql',
  'cloudflare-worker/sql/migrations/513_licence_fee_invoices.sql',
].map(read);

const accountNumber = () => String(randomInt(1_000_000_000, 9_999_999_999));

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER, name TEXT, email TEXT, uid TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT, note TEXT);
    CREATE TABLE user_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, jti TEXT, factor TEXT,
      assurance_level TEXT, revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT, last_step_up_at TEXT,
      created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT,
      user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE admin_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER, action TEXT,
      viewed_user_id INTEGER, filters_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE territory_licences (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, licence_ref TEXT,
      legal_entity_name TEXT, brand_name TEXT, status TEXT NOT NULL DEFAULT 'active', annual_fee_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'EUR', revenue_share_bps INTEGER, starts_on TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE licence_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL UNIQUE, admin_role TEXT NOT NULL DEFAULT 'principal', granted_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  db.exec(MIGRATION_512);
  for (const m of MIGRATIONS) db.exec(m);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(SUPER, 'admin', 'HQ', 'hq@example.test');
  u.run(PRINCIPAL, 'admin', 'Principal A', 'principal-a@example.test');
  u.run(OTHER_PRINCIPAL, 'admin', 'Principal B', 'principal-b@example.test');
  u.run(MEMBER, 'founder', 'Member', 'member@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, PRINCIPAL, OTHER_PRINCIPAL, MEMBER]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))")
      .run(id, `totp-${id}`);
  }
  const l = db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, annual_fee_cents, currency, revenue_share_bps, starts_on)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'EUR', 3500, ?)`);
  l.run(1, 'lic_a', 'LIC-A', 'Licensee A', 'Brand A', 'active', 1_250_000, '2025-03-15');
  l.run(2, 'lic_b', 'LIC-B', 'Licensee B', 'Brand B', 'active', 900_000, '2024-01-01');
  l.run(3, 'lic_nofee', 'LIC-C', 'Licensee C', 'Brand C', 'active', null, '2024-01-01');
  const a = db.prepare('INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (?, ?, ?)');
  a.run(1, PRINCIPAL, 'principal');
  a.run(2, OTHER_PRINCIPAL, 'principal');
  return db;
}

/** A Browser Run binding that returns a one-page PDF and keeps the HTML it was given. */
function fakeBrowser() {
  const html: string[] = [];
  return {
    html,
    binding: {
      fetch: async () => { throw new Error('BROWSER.fetch must not be called'); },
      quickAction: async (_action: string, options: any) => {
        html.push(String(options.html));
        const doc = await PDFDocument.create();
        doc.addPage();
        return new Response(await doc.save(), { status: 200 });
      },
    },
  };
}

const env = (db: any, extra: Record<string, unknown> = {}) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://app.example.test', DB: makeD1(db), ...extra });

/** Holdings' account carrying the territory licence fee, as the console writes it. */
async function holdingsAccount(e: any, db: any) {
  const number = accountNumber();
  const uid = '0000aaaa-0000-4000-8000-000000000802';
  const enc = await encryptColumn(e, 'entity_bank_accounts', 'account_number_enc', uid, number);
  db.prepare(`INSERT INTO entity_bank_accounts
      (uid, entity_key, label, bank_name, bank_address, beneficiary_name, beneficiary_address, account_kind,
       account_number_enc, account_last4, routing_number, swift_code, purposes_json, status, recorded_by)
     VALUES (?, 'holdings', 'Fixture', 'Bank A', 'Bank address A', 'Axal VC Holdings LLC', 'Registered address A', 'checking',
       ?, ?, '000000000', 'BANKAXXX', ?, 'active', ?)`)
    .run(uid, enc, number.slice(-4), JSON.stringify(['territory_licence_fee']), SUPER);
  return number;
}

const ERRORS: Record<string, 401 | 403> = {
  Unauthorized: 401, 'Admin required': 403, 'Super admin required': 403, 'TOTP required': 403, step_up_required: 403,
};
const app = new Hono<any>();
app.route('/admin/licences', feeInvoices);
app.route('/licence', licence);
app.onError((err: any, c) => {
  const s = ERRORS[String(err?.message || '')];
  if (s) return c.json({ detail: err.message, code: err.message }, s);
  throw err;
});

async function call(e: any, actor: number, path: string, method = 'GET', body?: unknown) {
  const tok = await new SignJWT({ user_id: actor, role: actor === MEMBER ? 'founder' : 'admin', jti: `totp-${actor}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, e);
  const type = res.headers.get('content-type') || '';
  return { status: res.status, type, body: type.includes('json') ? await res.json() as any : new Uint8Array(await res.arrayBuffer()) };
}
const issue = (e: any, actor = SUPER, uid = 'lic_a', body: unknown = {}) => call(e, actor, `/admin/licences/${uid}/fee-invoices`, 'POST', body);
const patch = (e: any, inv: string, body: unknown, actor = SUPER, uid = 'lic_a') =>
  call(e, actor, `/admin/licences/${uid}/fee-invoices/${inv}`, 'PATCH', body);
const invoices = (db: any) => db.prepare('SELECT * FROM licence_fee_invoices ORDER BY id').all() as any[];
const audits = (db: any) => db.prepare("SELECT action, filters_json FROM admin_audit_log WHERE action LIKE 'licence_fee_invoice_%' ORDER BY id").all() as any[];
const today = () => new Date().toISOString().slice(0, 10);

// ─────────────────────────────────────────────────────────── the period

test('the fee year runs from an anniversary of the start to the day before the next', () => {
  // Mutations checked: the year not stepped back before the anniversary; the end not the day before.
  assert.deepEqual(feePeriod('2025-03-15', '2026-10-20'), { period_start: '2026-03-15', period_end: '2027-03-14', period_label: '2026–27' });
  assert.deepEqual(feePeriod('2025-03-15', '2026-03-14'), { period_start: '2025-03-15', period_end: '2026-03-14', period_label: '2025–26' });
  assert.deepEqual(feePeriod('2025-03-15', '2026-03-15')?.period_start, '2026-03-15');
  assert.deepEqual(feePeriod('2025-03-15', '2024-01-01')?.period_start, '2025-03-15', 'before the start is the first year');
  assert.deepEqual(feePeriod('2024-02-29', '2025-06-01'), { period_start: '2025-02-28', period_end: '2026-02-27', period_label: '2025–26' });
  assert.equal(feePeriod(null, '2026-01-01'), null);
  assert.equal(feeInvoiceReference('LIC-A', '2026–27'), 'AXAL-LIC-LIC-A-2026-27', 'the bank reference carries an ASCII hyphen');
  assert.equal(moneyText(1_250_000, 'eur'), 'EUR 12,500.00');
});

// ─────────────────────────────────────────────────────────── issuing

test('HQ issues the fee year\'s invoice at the ledger\'s fee, due at the terms\' payment days, and it is audited', async () => {
  // Mutations checked: the amount not the ledger's; payment_terms_days ignored; the audit row dropped.
  const db = fixture();
  db.prepare("INSERT INTO licence_terms (licence_uid, payment_terms_days, updated_at) VALUES ('lic_a', 45, '2026-10-01')").run();
  const r = await issue(env(db));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const p = feePeriod('2025-03-15', today())!;
  assert.equal(r.body.period_label, p.period_label);
  assert.equal(r.body.period_start, p.period_start);
  assert.equal(r.body.amount_cents, 1_250_000);
  assert.equal(r.body.currency, 'EUR');
  assert.equal(r.body.status, 'issued');
  assert.equal(r.body.due_at, addDays(today(), 45));
  assert.equal(r.body.pdf_url, `/api/admin/licences/lic_a/fee-invoices/${r.body.uid}/pdf`);
  const [row] = invoices(db);
  assert.equal(row.issued_by_user_id, SUPER);
  const [a] = audits(db);
  assert.equal(a.action, 'licence_fee_invoice_issued');
  assert.equal(JSON.parse(a.filters_json).amount_cents, 1_250_000);
});

test('with no payment terms recorded, the invoice is due in 30 days', async () => {
  // Mutation checked: the default changed to 0 (due on issue).
  const db = fixture();
  const r = await issue(env(db));
  assert.equal(r.body.due_at, addDays(today(), 30));
});

test('issuing twice for one fee year is refused; a voided one can be issued again', async () => {
  // Mutations checked: the pre-check removed (the index then answers); the index's WHERE dropped.
  const db = fixture();
  const first = await issue(env(db));
  assert.equal(first.status, 201);
  const again = await issue(env(db));
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'period_invoiced');
  assert.equal(invoices(db).length, 1);
  assert.equal((await patch(env(db), first.body.uid, { status: 'void', void_reason: 'Issued at the wrong amount' })).status, 200);
  const third = await issue(env(db));
  assert.equal(third.status, 201, JSON.stringify(third.body));
  assert.equal(invoices(db).length, 2);
});

test('the store refuses a second live invoice for one period even if the route did not', () => {
  const db = fixture();
  const ins = db.prepare(`INSERT INTO licence_fee_invoices (uid, licence_uid, period_label, period_start, period_end, amount_cents, currency, issued_at, due_at)
    VALUES (?, 'lic_a', '2026–27', '2026-03-15', '2027-03-14', 100, 'EUR', '2026-10-20', '2026-11-19')`);
  ins.run('i1');
  assert.throws(() => ins.run('i2'), /UNIQUE/);
  assert.throws(() => db.prepare(`INSERT INTO licence_fee_invoices (uid, licence_uid, period_label, period_start, period_end, amount_cents, currency, issued_at, due_at)
    VALUES ('i3', 'lic_a', 'x', '2028-03-15', '2029-03-14', 0, 'EUR', 'x', 'x')`).run(), /CHECK/, 'a zero invoice was stored');
});

test('a period_start that is not an anniversary is refused; one that is invoices that year', async () => {
  const db = fixture();
  assert.equal((await issue(env(db), SUPER, 'lic_a', { period_start: '2026-03-16' })).status, 400);
  const r = await issue(env(db), SUPER, 'lic_a', { period_start: '2025-03-15' });
  assert.equal(r.status, 201);
  assert.equal(r.body.period_label, '2025–26');
});

test('a licence with no annual fee refuses rather than invoicing nothing', async () => {
  const db = fixture();
  const r = await issue(env(db), SUPER, 'lic_nofee');
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'no_annual_fee');
  assert.equal(invoices(db).length, 0);
});

test('an Administrator, a member, and a Super Admin with a stale step-up cannot issue or record', async () => {
  // Mutations checked: requireSuperAdminWriteBar replaced by requireSuperAdmin on POST; on PATCH.
  const db = fixture();
  for (const who of [PRINCIPAL, MEMBER]) {
    assert.equal((await issue(env(db), who)).status, 403, `user ${who} issued`);
  }
  const ok = await issue(env(db));
  for (const who of [PRINCIPAL, MEMBER]) {
    assert.equal((await patch(env(db), ok.body.uid, { paid_cents: 1_250_000, paid_note: 'wire' }, who)).status, 403, `user ${who} recorded`);
  }
  db.prepare("UPDATE user_sessions SET created_at = datetime('now','-3 hours') WHERE user_id = ?").run(SUPER);
  const stale = await patch(env(db), ok.body.uid, { paid_cents: 1_250_000, paid_note: 'wire' });
  assert.equal(stale.status, 403);
  assert.equal(stale.body.code, 'step_up_required');
  assert.equal(invoices(db)[0].paid_cents, 0, 'a refused record wrote');
  const staleIssue = await issue(env(db), SUPER, 'lic_b');
  assert.equal(staleIssue.status, 403, 'a stale step-up issued');
  assert.equal(invoices(db).length, 1);
  assert.equal((await call(env(db), PRINCIPAL, '/admin/licences/lic_a/fee-invoices')).status, 403, 'an Administrator read HQ\'s list');
});

// ─────────────────────────────────────────────────────────── recording

test('payment is recorded with a note; in full it marks the invoice paid; more than invoiced is refused', async () => {
  // Mutations checked: the overpay check removed; status not set to paid at the full amount; the note optional.
  const db = fixture();
  const inv = (await issue(env(db))).body;
  assert.equal((await patch(env(db), inv.uid, { paid_cents: 1_250_001, paid_note: 'x' })).body.error, 'overpaid');
  assert.equal((await patch(env(db), inv.uid, { paid_cents: 100 })).body.error, 'paid_note_required');
  assert.equal((await patch(env(db), inv.uid, { paid_cents: 1.5, paid_note: 'x' })).body.error, 'bad_amount');
  const part = await patch(env(db), inv.uid, { paid_cents: 500_000, paid_note: 'first wire' });
  assert.equal(part.status, 200);
  assert.equal(part.body.status, 'issued');
  const full = await patch(env(db), inv.uid, { paid_cents: 1_250_000, paid_note: 'second wire' });
  assert.equal(full.body.status, 'paid');
  assert.ok(full.body.paid_at);
  assert.equal(invoices(db)[0].recorded_by_user_id, SUPER);
  assert.deepEqual(audits(db).map((a) => a.action), ['licence_fee_invoice_issued', 'licence_fee_invoice_paid', 'licence_fee_invoice_paid']);
});

test('voiding needs a reason, refuses with a payment recorded, and a void invoice takes nothing more', async () => {
  const db = fixture();
  const inv = (await issue(env(db))).body;
  assert.equal((await patch(env(db), inv.uid, { status: 'void', void_reason: 'short' })).body.error, 'void_reason_required');
  await patch(env(db), inv.uid, { paid_cents: 1, paid_note: 'stray' });
  assert.equal((await patch(env(db), inv.uid, { status: 'void', void_reason: 'Issued at the wrong amount' })).body.error, 'paid_recorded');
  await patch(env(db), inv.uid, { paid_cents: 0 });
  assert.equal((await patch(env(db), inv.uid, { status: 'void', void_reason: 'Issued at the wrong amount' })).status, 200);
  assert.equal((await patch(env(db), inv.uid, { paid_cents: 10, paid_note: 'x' })).body.error, 'invoice_void');
  assert.equal((await patch(env(db), inv.uid, { status: 'paid' })).status, 409);
  assert.ok(audits(db).some((a) => a.action === 'licence_fee_invoice_voided'));
});

test('an invoice of another licence is 404 through this licence\'s path', async () => {
  const db = fixture();
  const b = (await issue(env(db), SUPER, 'lic_b')).body;
  assert.equal((await patch(env(db), b.uid, { paid_cents: 1, paid_note: 'x' }, SUPER, 'lic_a')).status, 404);
  assert.equal((await call(env(db), SUPER, `/admin/licences/lic_a/fee-invoices/${b.uid}/pdf`)).status, 404);
});

// ─────────────────────────────────────────────────────────── the PDF

test('the PDF names the IP licensor, the reference, and an account masked to its last four', async () => {
  // Mutations checked: the sender not the licensor; the reference left off; the full number printed.
  const db = fixture();
  const browser = fakeBrowser();
  const e = env(db, { BROWSER: browser.binding });
  const number = await holdingsAccount(e, db);
  db.prepare("INSERT INTO licence_terms (licence_uid, licensor_ip_entity, updated_at) VALUES ('lic_a', 'holdings', '2026-10-01')").run();
  const inv = (await issue(e)).body;
  const pdf = await call(e, SUPER, `/admin/licences/lic_a/fee-invoices/${inv.uid}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.type, 'application/pdf');
  const html = browser.html.join('\n');
  assert.ok(html.includes('Territory Licence Fee Invoice'));
  assert.ok(html.includes('From: Axal VC Holdings LLC'), 'the licensor is not the sender');
  assert.ok(html.includes('Licensee A'));
  const ref = feeInvoiceReference('LIC-A', inv.period_label);
  assert.ok(html.includes(ref), 'the reference is not on the invoice');
  assert.ok(html.includes(`ending ${number.slice(-4)}`), 'the account is not shown masked');
  assert.ok(!html.includes(number), 'the full account number was printed');
  assert.ok(html.includes('EUR 12,500.00'));
});

test('a licensor that is not the fee\'s payee prints the refusal, never an account', async () => {
  // Mutation checked: licensorRefusal not consulted.
  const db = fixture();
  const browser = fakeBrowser();
  const e = env(db, { BROWSER: browser.binding });
  const number = await holdingsAccount(e, db);
  db.prepare("INSERT INTO licence_terms (licence_uid, licensor_ip_entity, updated_at) VALUES ('lic_a', 'management', '2026-10-01')").run();
  const inv = (await issue(e)).body;
  assert.equal((await call(e, SUPER, `/admin/licences/lic_a/fee-invoices/${inv.uid}/pdf`)).status, 200);
  const html = browser.html.join('\n');
  assert.ok(html.includes('From: Axal VC Management LLC') || html.includes('From: Axal VC Management'), 'the named licensor is not the sender');
  assert.ok(html.includes('no payment instructions are given'));
  assert.ok(!html.includes(`ending ${number.slice(-4)}`), 'Holdings\' account was paired with another licensor');
});

test('a void invoice is not printed, and no renderer means 503, never a lesser page', async () => {
  const db = fixture();
  const inv = (await issue(env(db))).body;
  assert.equal((await call(env(db), SUPER, `/admin/licences/lic_a/fee-invoices/${inv.uid}/pdf`)).status, 503);
  await patch(env(db), inv.uid, { status: 'void', void_reason: 'Issued at the wrong amount' });
  const v = await call(env(db, { BROWSER: fakeBrowser().binding }), SUPER, `/admin/licences/lic_a/fee-invoices/${inv.uid}/pdf`);
  assert.equal(v.status, 409);
  assert.equal(v.body.error, 'invoice_void');
});

// ─────────────────────────────────────────────────────────── the Administrator's read

test('the Administrator reads only their own licence\'s invoices, newest first, each with its PDF', async () => {
  // Mutations checked: the read not scoped to the caller's licence; ordered oldest first.
  const db = fixture();
  const browser = fakeBrowser();
  const e = env(db, { BROWSER: browser.binding });
  await holdingsAccount(e, db);
  const older = (await issue(e, SUPER, 'lic_a', { period_start: '2025-03-15' })).body;
  const newer = (await issue(e)).body;
  const b = (await issue(e, SUPER, 'lic_b')).body;
  const mine = await call(e, PRINCIPAL, '/licence/mine/statements');
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.deepEqual(mine.body.fee_invoices.map((i: any) => i.uid), [newer.uid, older.uid]);
  assert.equal(mine.body.fee_invoices[0].pdf_url, `/api/licence/mine/fee-invoices/${newer.uid}/pdf`);
  assert.equal(mine.body.fee_invoices[0].payment_reference, feeInvoiceReference('LIC-A', newer.period_label));
  assert.ok(!JSON.stringify(mine.body.fee_invoices).includes(b.uid), 'another licence\'s invoice was read');

  assert.equal((await call(e, PRINCIPAL, `/licence/mine/fee-invoices/${newer.uid}/pdf`)).status, 200);
  assert.equal((await call(e, PRINCIPAL, `/licence/mine/fee-invoices/${b.uid}/pdf`)).status, 404, 'another licence\'s PDF was printed');
  assert.equal((await call(e, OTHER_PRINCIPAL, `/licence/mine/fee-invoices/${newer.uid}/pdf`)).status, 404);
  assert.equal((await call(e, MEMBER, '/licence/mine/statements')).status, 404, 'a member who administers nothing read invoices');
});

test('an invoice store that cannot be read says so, never "none issued"', async () => {
  const db = fixture();
  db.exec('DROP TABLE licence_fee_invoices');
  const mine = await call(env(db), PRINCIPAL, '/licence/mine/statements');
  assert.equal(mine.status, 200);
  assert.equal(mine.body.fee_invoices, null);
  assert.match(String(mine.body.fee_invoices_reason), /could not be read/);
});
