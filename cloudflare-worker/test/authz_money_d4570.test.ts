// #4570 slice 6 (S1 of #4554) — money, on the real Worker.
//
// The ledger's `unreviewed` routes that read or reveal where money is sent,
// charge a member, read or settle an invoice, remove a saved card, record the
// signature that binds an LP's capital, or withdraw a commitment. Asked
// through `worker.fetch` on the fully migrated schema:
//
//   GET  /api/closings/company-receiving-accounts/:projectId          the company's wire instructions, masked
//                                                                      (the company's primary-admin founder; an invited investor with a live commitment)
//   POST /api/closings/company-receiving-accounts/:projectId/reveal   the full account number, once, audited
//                                                                      (an investor whose own line on the open closing is signed)
//   POST /api/advisors/bookings/:id/pay                               charge the founder for a session (the booking's founder)
//   POST /api/mentors/bookings/:id/pay                                the same, on the legacy mount
//   GET  /api/engagements/:id/invoice                                 a partner engagement's invoice (the engagement's founder side and partner side)
//   POST /api/engagements/:id/invoice/paid                            mark that invoice paid (the engagement's partner)
//   GET  /api/orders/:order_ref/invoice                               a platform order's invoice PDF (the buyer)
//   DELETE /api/payments/methods/:id                                  detach a saved card (the holder of the card's Stripe customer)
//   POST /api/funds/lps/:lpId/sign-lpa                                record an LP's LPA signature (the LP, KYC approved; an admin)
//   POST /api/deals/:id/commitments/:uid/withdraw                     retired (D4632): nobody may withdraw through it
//
// The callers refused: another venture's founder, another deal's investor,
// an unrelated Operating Partner, an advisor whose grant on the venture was
// revoked, an investor whose commitment was withdrawn, a co-founder who does
// not administer the company, the session's own advisor, another LP in the
// same fund, an investor without KYC, an admin and the Super Admin where the
// record is a member's alone, a support session, a disabled party, and no
// credentials.
//
// Each refusal names nothing of the record (no company, payee, bank, account
// or routing number, amount, invoice or LP), changes no row, writes no audit,
// reveal, activity or notification row, and makes no payment call. The last
// test runs the rightful party on every route, so each refusal is the gate.
// These are the ledger's `verified` entries for these routes.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/authz_money_d4570.test.ts
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import worker from '../src/index.ts';
import { encryptColumn } from '../src/services/columnCipher.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';

const SECRET = 'd4570-money-fixture-only-'.repeat(3); // A fixture signing key; never a service credential.
const KEK = 'd4570-money-cipher-fixture-'.repeat(2); // A fixture column key; never a service credential.

// The parties.
const FOUNDER = 2;          // administers the company behind venture 20; booked the session; the engagement's founder; bought the order; holds the card
const INVESTOR = 3;         // invited to deal 200, committed, line on the open closing signed; LP 901 in the fund
const PARTNER = 12;         // the engagement's Operating Partner
const ADVISOR_SELF = 13;    // the advisor the session was booked with
const PENDING_INVESTOR = 18; // invited to deal 200 and committed; their line's envelope is complete but unsigned by them: reads the masked instructions, may not reveal
// Everyone else.
const OTHER_FOUNDER = 4, OTHER_INVESTOR = 5, OTHER_PARTNER = 6, REVOKED_ADVISOR = 7;
const WITHDRAWN = 17;       // invited to deal 200; their commitment was withdrawn
const CO_FOUNDER = 19;      // same founder entity as FOUNDER, linked to the company but not its primary admin
const NO_KYC = 16;          // an investor LP whose KYC is not approved
const ADMIN = 9, SUPER = 10;
const DISABLED_FOUNDER = 8, DISABLED_INVESTOR = 14, DISABLED_PARTNER = 15;
const SUPPORT = 20;         // marker for INVESTOR's session opened by ADMIN as a support session
const WHO: Record<number, string> = {
  [FOUNDER]: 'the company\'s founder', [INVESTOR]: 'the signed investor', [PARTNER]: 'the engagement\'s partner',
  [ADVISOR_SELF]: 'the session\'s own advisor', [PENDING_INVESTOR]: 'a committed investor with no signed line',
  [OTHER_FOUNDER]: 'another venture\'s founder', [OTHER_INVESTOR]: 'another deal\'s investor (another LP in the same fund)',
  [OTHER_PARTNER]: 'an unrelated Operating Partner', [REVOKED_ADVISOR]: 'an advisor whose grant was revoked',
  [WITHDRAWN]: 'an investor whose commitment was withdrawn', [CO_FOUNDER]: 'a co-founder who does not administer the company',
  [NO_KYC]: 'an investor LP without KYC', [ADMIN]: 'an admin', [SUPER]: 'the Super Admin',
  [DISABLED_FOUNDER]: 'a disabled founder', [DISABLED_INVESTOR]: 'a disabled investor', [DISABLED_PARTNER]: 'a disabled partner',
  [SUPPORT]: 'the signed investor in a support session',
};

// Markers a leak check can find. None is a real person, company, bank or account.
const NUMBER = '1234567890124821', ROUTING = '021000021';
const LEAKS = ['Quokka', 'quokka', 'QUOKKA', NUMBER, ROUTING, '4821', 'INV-QK', 'ORD-QK'];

let db: any, env: any;
const sessions: Record<number, string> = {};
const pending: Promise<unknown>[] = [];
const ctx: any = { waitUntil(p: Promise<unknown>) { pending.push(p); }, passThroughOnException() {} };
let realFetch: typeof fetch;
const outbound: string[] = [];
// The fake Stripe: which customer each saved card belongs to.
const CARDS: Record<string, string> = { pm_quokka: 'cus_quokka', pm_other: 'cus_other', pm_dis: 'cus_dis' };

const jwt = (claims: Record<string, unknown>) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30m').sign(new TextEncoder().encode(SECRET));

async function call(path: string, who?: number, method = 'GET', body?: unknown) {
  const read = method === 'GET';
  const res = await worker.fetch(new Request(`https://unit.test${path}`, {
    method, redirect: 'manual',
    headers: {
      ...(who ? { authorization: `Bearer ${sessions[who]}` } : {}),
      ...(read ? {} : { 'content-type': 'application/json' }),
    },
    body: read || method === 'DELETE' ? undefined : JSON.stringify(body ?? {}),
  // A fresh limiter per request: this suite is about gates, and the limiter would otherwise answer 429 first.
  }), { ...env, RATE_LIMITS: memKV() }, ctx);
  await Promise.all(pending.splice(0));
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, text, json, type: res.headers.get('content-type'), disposition: res.headers.get('content-disposition') };
}

/** Everything a refused money route could have changed. */
const snapshot = () => JSON.stringify([
  db.prepare('SELECT * FROM company_receiving_accounts ORDER BY id').all(),
  db.prepare('SELECT COUNT(*) AS n FROM company_receiving_account_reveals').get(),
  db.prepare('SELECT * FROM advisor_bookings ORDER BY id').all(),
  db.prepare('SELECT * FROM advisor_office_hour_slots ORDER BY id').all(),
  db.prepare('SELECT * FROM engagements ORDER BY id').all(),
  db.prepare('SELECT * FROM engagement_invoices ORDER BY id').all(),
  db.prepare('SELECT * FROM orders ORDER BY id').all(),
  db.prepare('SELECT * FROM limited_partners ORDER BY id').all(),
  db.prepare('SELECT * FROM vc_funds ORDER BY id').all(),
  db.prepare('SELECT * FROM commitments ORDER BY id').all(),
  db.prepare('SELECT id, stripe_customer_id, is_active FROM users ORDER BY id').all(),
  db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get(),
  // The app-wide request log writes its own `http_*` row for every request, refused or not: not the route's write.
  db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action NOT LIKE 'http\\_%' ESCAPE '\\'").get(),
  db.prepare('SELECT COUNT(*) AS n FROM notifications').get(),
]);
const named = (r: { text: string; disposition: string | null }) => LEAKS.filter((l) => r.text.includes(l) || (r.disposition ?? '').includes(l));
const detaches = () => outbound.filter((u) => u.includes('/detach'));
const reveals = () => (db.prepare('SELECT COUNT(*) AS n FROM company_receiving_account_reveals').get() as any).n as number;

// Every route, each with the record its rightful party holds and one that does not exist.
const R = {
  accountRead: { route: 'GET /api/closings/company-receiving-accounts/:projectId', method: 'GET', path: (id: string | number) => `/api/closings/company-receiving-accounts/${id}` },
  accountReveal: { route: 'POST /api/closings/company-receiving-accounts/:projectId/reveal', method: 'POST', path: (id: string | number) => `/api/closings/company-receiving-accounts/${id}/reveal` },
  payAdvisors: { route: 'POST /api/advisors/bookings/:id/pay', method: 'POST', path: (id: string | number) => `/api/advisors/bookings/${id}/pay` },
  payMentors: { route: 'POST /api/mentors/bookings/:id/pay', method: 'POST', path: (id: string | number) => `/api/mentors/bookings/${id}/pay` },
  invoiceRead: { route: 'GET /api/engagements/:id/invoice', method: 'GET', path: (id: string | number) => `/api/engagements/${id}/invoice` },
  invoicePaid: { route: 'POST /api/engagements/:id/invoice/paid', method: 'POST', path: (id: string | number) => `/api/engagements/${id}/invoice/paid` },
  orderInvoice: { route: 'GET /api/orders/:order_ref/invoice', method: 'GET', path: (id: string | number) => `/api/orders/${id}/invoice` },
  cardDetach: { route: 'DELETE /api/payments/methods/:id', method: 'DELETE', path: (id: string | number) => `/api/payments/methods/${id}` },
  signLpa: { route: 'POST /api/funds/lps/:lpId/sign-lpa', method: 'POST', path: (id: string | number) => `/api/funds/lps/${id}/sign-lpa` },
  withdraw: { route: 'POST /api/deals/:id/commitments/:uid/withdraw', method: 'POST', path: (uid: string | number) => `/api/deals/200/commitments/${uid}/withdraw` },
} as const;

before(async () => {
  db = migratedDatabase();
  db.exec(`INSERT INTO users (id, uid, name, email, role, founder_id, partner_id, is_active, kyc_status, stripe_customer_id, subscription_tier, subscription_status, investor_tier) VALUES
    (${FOUNDER},'u-fdr','Owner Founder','founder@example.test','founder',102,NULL,1,'not_started','cus_quokka','studio','active','free'),
    (${INVESTOR},'u-inv','Signed Investor','investor@example.test','investor',NULL,NULL,1,'approved',NULL,'studio','active','professional'),
    (${PARTNER},'u-ptr','Engaged Partner','partner@example.test','partner',NULL,112,1,'not_started',NULL,'studio','active','free'),
    (${ADVISOR_SELF},'u-adv','Session Advisor','advisor@example.test','advisor',NULL,NULL,1,'not_started',NULL,'studio','active','free'),
    (${PENDING_INVESTOR},'u-pin','Pending Investor','pending@example.test','investor',NULL,NULL,1,'approved',NULL,'studio','active','professional'),
    (${OTHER_FOUNDER},'u-of','Other Founder','of@example.test','founder',103,NULL,1,'not_started','cus_other','studio','active','free'),
    (${OTHER_INVESTOR},'u-oi','Other Investor','oi@example.test','investor',NULL,NULL,1,'approved',NULL,'studio','active','professional'),
    (${OTHER_PARTNER},'u-op','Other Partner','op@example.test','partner',NULL,116,1,'not_started',NULL,'studio','active','free'),
    (${REVOKED_ADVISOR},'u-ra','Revoked Advisor','ra@example.test','advisor',NULL,NULL,1,'not_started',NULL,'studio','active','free'),
    (${WITHDRAWN},'u-wd','Withdrawn Investor','wd@example.test','investor',NULL,NULL,1,'approved',NULL,'studio','active','professional'),
    (${CO_FOUNDER},'u-cof','Co Founder','cof@example.test','founder',102,NULL,1,'not_started',NULL,'studio','active','free'),
    (${NO_KYC},'u-nk','Unverified Investor','nk@example.test','investor',NULL,NULL,1,'not_started',NULL,'studio','active','professional'),
    (${ADMIN},'u-adm','Admin','admin@example.test','admin',NULL,NULL,1,'not_started',NULL,'studio','active','free'),
    (${SUPER},'u-sup','Super Admin','super@example.test','admin',NULL,NULL,1,'not_started',NULL,'studio','active','free'),
    (${DISABLED_FOUNDER},'u-dfd','Disabled Founder','dfd@example.test','founder',104,NULL,1,'not_started','cus_dis','studio','active','free'),
    (${DISABLED_INVESTOR},'u-din','Disabled Investor','din@example.test','investor',NULL,NULL,1,'approved',NULL,'studio','active','professional'),
    (${DISABLED_PARTNER},'u-dpt','Disabled Partner','dpt@example.test','partner',NULL,112,1,'not_started',NULL,'studio','active','free');
    INSERT INTO super_admins (user_id) VALUES (${SUPER});

    INSERT INTO company_profiles (id, uid, company_name) VALUES (100,'co-quokka','Quokka Holdings'), (300,'co-else','Elsewhere Inc'), (400,'co-dis','Disabled Co');
    INSERT INTO user_company_links (uid, company_id, user_id, is_primary_admin) VALUES
      ('link-owner',100,${FOUNDER},1), ('link-cof',100,${CO_FOUNDER},0), ('link-other',300,${OTHER_FOUNDER},1), ('link-dis',400,${DISABLED_FOUNDER},1);
    INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES
      (20,'p-quokka','Quokka venture',102,100), (30,'p-else','Elsewhere venture',103,300), (40,'p-dis','Disabled venture',104,400);
    INSERT INTO deals (id, uid, project_id, status, currency) VALUES (200,'deal-quokka',20,'active','USD'), (300,'deal-else',30,'active','USD');
    INSERT INTO deal_invitations (deal_id, investor_user_id, status) VALUES
      (200,${INVESTOR},'interested'), (200,${PENDING_INVESTOR},'interested'), (200,${WITHDRAWN},'interested'),
      (200,${DISABLED_INVESTOR},'interested'), (300,${OTHER_INVESTOR},'interested');
    INSERT INTO commitments (id, uid, deal_id, investor_user_id, amount, status) VALUES
      (30,'line-quokka',200,${INVESTOR},250,'pending'), (31,'line-disabled',200,${DISABLED_INVESTOR},250,'pending'),
      (32,'line-pending',200,${PENDING_INVESTOR},150,'pending'), (33,'line-withdrawn',200,${WITHDRAWN},100,'withdrawn'),
      (40,'line-else',300,${OTHER_INVESTOR},250,'pending');
    INSERT INTO esign_envelopes (id, envelope_uuid, user_id, deal_id, document_type, document_title, document_body, body_sha256, status, created_by, completed_at) VALUES
      (50,'env-quokka',${FOUNDER},200,'safe','Synthetic SAFE','Synthetic paper','synthetic-hash','completed',${FOUNDER},'2026-10-01'),
      (52,'env-disabled',${FOUNDER},200,'safe','Synthetic SAFE','Synthetic paper','synthetic-hash-2','completed',${FOUNDER},'2026-10-01'),
      -- The pending investor's line has a completed envelope that they never signed: their recipient row is only sent.
      (54,'env-pending',${FOUNDER},200,'safe','Synthetic SAFE','Synthetic paper','synthetic-hash-3','completed',${FOUNDER},'2026-10-01');
    INSERT INTO esign_recipients (id, envelope_id, user_id, recipient_email, signing_token, token_expires_at, status, signed_at) VALUES
      (51,50,${INVESTOR},'investor@example.test','synthetic-signing-1','2027-01-01','signed','2026-10-01'),
      (53,52,${DISABLED_INVESTOR},'din@example.test','synthetic-signing-2','2027-01-01','signed','2026-10-01'),
      (55,54,${PENDING_INVESTOR},'pending@example.test','synthetic-signing-3','2027-01-01','sent',NULL);
    INSERT INTO closings (id, uid, deal_id, project_id, currency, status, created_by) VALUES (500,'closing-quokka',200,20,'USD','open',${ADMIN});
    INSERT INTO closing_lines (id, uid, closing_id, commitment_id, investor_user_id, amount_cents, currency, envelope_id, status, created_by) VALUES
      (501,'cl-quokka',500,30,${INVESTOR},25000,'USD',50,'open',${ADMIN}),
      (502,'cl-disabled',500,31,${DISABLED_INVESTOR},25000,'USD',52,'open',${ADMIN}),
      (503,'cl-pending',500,32,${PENDING_INVESTOR},15000,'USD',54,'open',${ADMIN});
    INSERT INTO advisor_client_grants (uid, project_id, advisor_user_id, granted_by_user_id, scope_project, scope_sessions, status)
      VALUES ('grant-revoked',20,${REVOKED_ADVISOR},${FOUNDER},1,1,'revoked');

    INSERT INTO advisors (id, uid, user_id, display_name) VALUES (61,'adv-quokka',${ADVISOR_SELF},'Quokka Advisor');
    INSERT INTO advisor_office_hour_slots (id, uid, advisor_id, starts_at, ends_at) VALUES
      (62,'slot-quokka',61,'2026-12-01T10:00:00Z','2026-12-01T11:00:00Z'), (63,'slot-dis',61,'2026-12-02T10:00:00Z','2026-12-02T11:00:00Z');
    INSERT INTO advisor_bookings (id, uid, slot_id, advisor_id, founder_user_id, topic, status, amount_cents, billing_state) VALUES
      (701,'bk-quokka',62,61,${FOUNDER},'Quokka pricing topic','completed',30000,'collected'),
      (702,'bk-dis',63,61,${DISABLED_FOUNDER},'Quokka disabled topic','confirmed',30000,'billed');

    INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price, status, invoice_id) VALUES
      (801,'eng-quokka',1,1,112,102,20,4200,'invoiced','INV-QK-0001');
    INSERT INTO engagement_invoices (id, uid, invoice_number, engagement_id, partner_user_id, founder_user_id, bill_from_name, bill_to_name, line_items_json, subtotal_cents, total_cents, status) VALUES
      (811,'einv-quokka','INV-QK-0001',801,${PARTNER},${FOUNDER},'Quokka Partners LLC','Quokka Holdings','[{"label":"Quokka GTM sprint","amount_cents":420000}]',420000,420000,'issued');

    INSERT INTO vc_funds (id, name, slug, status) VALUES (90,'Quokka Fund I','quokka-fund-i','fundraising');
    INSERT INTO limited_partners (id, user_id, fund_id, commitment_amount, status, lpa_signed, name) VALUES
      (901,${INVESTOR},90,500000,'committed',0,'Quokka LP One'),
      (902,${OTHER_INVESTOR},90,250000,'committed',0,'Quokka LP Two'),
      (903,${DISABLED_INVESTOR},90,250000,'committed',0,'Quokka LP Three'),
      (904,${NO_KYC},90,100000,'committed',0,'Quokka LP Four');
    INSERT INTO impersonation_sessions (id, admin_user_id, target_user_id, context) VALUES (71,${ADMIN},${INVESTOR},'d4570 fixture');`);

  env = {
    DB: d1Over(db), JWT_SECRET: SECRET, KEK_PII: KEK, ENVIRONMENT: 'development', RATE_LIMITS: memKV(), TOKENS: memKV(),
    APP_URL: 'https://unit.test',
    // Switched on so the charge and the card routes reach past their "not configured" answers to the gate.
    // The key is a fixture; every Stripe call goes to the fake below.
    STRIPE_SECRET_KEY: 'sk_test_d4570_fixture', ADVISOR_CHARGING_ENABLED: '1',
  };

  // The orders table is created on first use; one read through the Worker makes it.
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const u = String(url instanceof Request ? url.url : url);
    outbound.push(`${init?.method ?? 'GET'} ${u}`);
    const pm = u.match(/\/v1\/payment_methods\/(pm_[A-Za-z0-9_]+)(\/detach)?$/);
    if (pm && CARDS[pm[1]]) return Response.json({ id: pm[1], customer: CARDS[pm[1]] });
    return Response.json({ error: { message: 'not a fixture path' } }, { status: 404 });
  }) as typeof fetch;

  for (const id of [FOUNDER, INVESTOR, PARTNER, ADVISOR_SELF, PENDING_INVESTOR, OTHER_FOUNDER, OTHER_INVESTOR, OTHER_PARTNER,
    REVOKED_ADVISOR, WITHDRAWN, CO_FOUNDER, NO_KYC, ADMIN, SUPER, DISABLED_FOUNDER, DISABLED_INVESTOR, DISABLED_PARTNER]) {
    sessions[id] = await jwt({ user_id: id });
  }
  // A support session: the admin, inside the signed investor's account, on an open session record.
  sessions[SUPPORT] = await jwt({ user_id: INVESTOR, impersonated_by: ADMIN, sid: 71 });

  assert.equal((await call('/api/orders/mine', FOUNDER)).status, 200, 'the fixture: the orders table exists');
  db.exec(`INSERT INTO orders (order_ref, user_id, status, currency, subtotal_cents, total_cents, items_json, invoice_number, paid_at) VALUES
    ('ORD-QK-0001',${FOUNDER},'paid','usd',9900,9900,'[{"price_id":"price_quokka","name":"Quokka studio add-on","quantity":1,"line_total":9900}]','ORD-QK-INV-1','2026-11-01'),
    ('ORD-QK-0002',${DISABLED_FOUNDER},'paid','usd',9900,9900,'[{"price_id":"price_quokka","name":"Quokka studio add-on","quantity":1,"line_total":9900}]','ORD-QK-INV-2','2026-11-01');`);

  // The company's receiving account, stored the way the route stores it: encrypted, with its last four.
  const instructions = JSON.stringify({ payee_name: 'Quokka Holdings', bank_name: 'Quokka Bank', account_number: NUMBER,
    routing_number: ROUTING, swift_code: null, currency: 'USD', payment_reference: 'QUOKKA-SEED' });
  const enc = await encryptColumn(env, 'company_receiving_accounts', 'instructions_enc', 'cra-quokka', instructions);
  db.prepare(`INSERT INTO company_receiving_accounts (uid, company_id, revision, instructions_enc, account_last4, created_by_user_id)
    VALUES ('cra-quokka',100,1,?,'4821',?)`).run(enc, FOUNDER);

  // The disabled parties were active when their records were made.
  db.prepare('UPDATE users SET is_active = 0 WHERE id IN (?, ?, ?)').run(DISABLED_FOUNDER, DISABLED_INVESTOR, DISABLED_PARTNER);
  outbound.length = 0;
});
after(() => { if (realFetch) globalThis.fetch = realFetch; db?.close(); removeMigratedDatabases(); });

/** Each route, asked for the record its rightful party holds. */
const RIGHTFUL_ASKS = [
  [R.accountRead, 20, undefined],
  [R.accountReveal, 20, { commitment_uid: 'line-quokka' }],
  [R.payAdvisors, 701, undefined],
  [R.payMentors, 701, undefined],
  [R.invoiceRead, 801, undefined],
  [R.invoicePaid, 801, undefined],
  [R.orderInvoice, 'ORD-QK-0001', undefined],
  [R.cardDetach, 'pm_quokka', undefined],
  [R.signLpa, 901, undefined],
  [R.withdraw, 'line-quokka', undefined],
] as const;

test('no credentials: every money route is refused 401, names nothing, changes nothing and calls no payment provider', async () => {
  const before = snapshot();
  for (const [r, id, body] of RIGHTFUL_ASKS) {
    const res = await call(r.path(id), undefined, r.method, body);
    // Mutation checked: the receiving-account read's and the order invoice's `requireAuth` replaced by a fixed party → this fails.
    assert.equal(res.status, 401, `${r.route}: ${res.text}`);
    assert.deepEqual(named(res), [], `${r.route}: names nothing`);
  }
  assert.equal(snapshot(), before);
  assert.deepEqual(outbound, []);
});

test('a disabled party: their own instructions, line, booking, invoice, order, card, LPA and commitment are refused 401', async () => {
  const before = snapshot();
  const asks = [
    [R.accountRead, 20, DISABLED_INVESTOR, undefined],
    [R.accountReveal, 20, DISABLED_INVESTOR, { commitment_uid: 'line-disabled' }],
    [R.payAdvisors, 702, DISABLED_FOUNDER, undefined],
    [R.payMentors, 702, DISABLED_FOUNDER, undefined],
    [R.invoiceRead, 801, DISABLED_PARTNER, undefined],
    [R.invoicePaid, 801, DISABLED_PARTNER, undefined],
    [R.orderInvoice, 'ORD-QK-0002', DISABLED_FOUNDER, undefined],
    [R.cardDetach, 'pm_dis', DISABLED_FOUNDER, undefined],
    [R.signLpa, 903, DISABLED_INVESTOR, undefined],
    [R.withdraw, 'line-disabled', DISABLED_INVESTOR, undefined],
  ] as const;
  for (const [r, id, who, body] of asks) {
    const res = await call(r.path(id), who, r.method, body);
    // Mutation checked: getCurrentUser's `is_active` refusal removed → the disabled investor reveals the account number and this fails.
    assert.equal(res.status, 401, `${r.route} as ${WHO[who]}: ${res.text}`);
    assert.deepEqual(named(res), [], `${r.route} as ${WHO[who]}: names nothing`);
  }
  assert.equal(snapshot(), before);
  assert.equal(reveals(), 0, 'no reveal was recorded');
  assert.deepEqual(outbound, []);
});

test('the company\'s receiving account: a non-party, a co-founder, a withdrawn investor, an admin and the Super Admin get the answer a missing venture gets', async () => {
  const before = snapshot();
  for (const r of [R.accountRead, R.accountReveal]) {
    const answers = new Set<string>();
    for (const id of [OTHER_FOUNDER, OTHER_INVESTOR, OTHER_PARTNER, REVOKED_ADVISOR, WITHDRAWN, CO_FOUNDER, ADMIN, SUPER]) {
      const real = await call(r.path(20), id, r.method, { commitment_uid: 'line-quokka' });
      const none = await call(r.path(999), id, r.method, { commitment_uid: 'line-quokka' });
      // Mutations checked, one at a time: scopeFor's investor clause losing `k.investor_user_id = u.id` (any investor
      // on any line reads), its `k.status <> 'withdrawn'` test, its `is_primary_admin = 1` test, and its founder clause
      // widened to every founder → the outsider, the withdrawn investor or the co-founder reads the instructions and this fails.
      assert.equal(real.status, 404, `${r.route} as ${WHO[id]}: ${real.text}`);
      assert.deepEqual(named(real), [], `${r.route} as ${WHO[id]}: names nothing`);
      assert.deepEqual([real.status, real.text], [none.status, none.text], `${r.route} as ${WHO[id]}: no existence leak`);
      answers.add(`${real.status} ${real.text}`);
    }
    assert.equal(answers.size, 1, `${r.route}: one answer whoever asks`);
  }
  // Another investor's own line names the right venture, and still reveals nothing to this one.
  const elsewhere = await call(R.accountReveal.path(30), INVESTOR, 'POST', { commitment_uid: 'line-else' });
  assert.equal(elsewhere.status, 404, elsewhere.text);
  assert.equal(snapshot(), before);
  assert.equal(reveals(), 0, 'no reveal was recorded');
  assert.deepEqual(outbound, []);
});

test('the reveal: a party without a signed line of their own, the founder, and a support session are refused, and no number is shown or reveal recorded', async () => {
  const before = snapshot();
  const asks: Array<[string, number, string | undefined, number, string]> = [
    // Mutation checked: recordSignedReveal's `u.id = ?` binding removed → the pending investor reveals through the signed investor's line.
    ['a committed investor naming another investor\'s signed line', PENDING_INVESTOR, 'line-quokka', 403, 'signed_line_required'],
    // Mutation checked: recordSignedReveal's signed-recipient EXISTS removed → the unsigned line reveals and this fails.
    ['a committed investor naming their own line, which they never signed', PENDING_INVESTOR, 'line-pending', 403, 'signed_line_required'],
    ['the signed investor naming a line on another deal', INVESTOR, 'line-else', 403, 'signed_line_required'],
    // Mutation checked: revealCompanyAccount's `scope.role !== 'investor'` test removed → the request reaches the signed-line
    // insert, which still refuses: the founder holds no line. Equivalent here; the insert is the authorization point (D1217).
    ['the company\'s founder', FOUNDER, 'line-quokka', 403, 'signed_line_required'],
  ];
  for (const [label, who, line, status, code] of asks) {
    const r = await call(R.accountReveal.path(20), who, 'POST', { commitment_uid: line });
    assert.equal(r.status, status, `${label}: ${r.text}`);
    assert.equal(r.json?.code ?? r.json?.error, code, `${label}: ${r.text}`);
    assert.ok(!r.text.includes(NUMBER), `${label}: no account number`);
  }
  // A support session reads neither the masked instructions nor the number, even inside the signed investor's account.
  for (const r of [R.accountRead, R.accountReveal]) {
    const res = await call(r.path(20), SUPPORT, r.method, { commitment_uid: 'line-quokka' });
    // Mutation checked: the router's isSupportSession refusal removed → the support session reveals the number and this fails.
    assert.equal(res.status, 403, `${r.route} in a support session: ${res.text}`);
    assert.equal(res.json?.code ?? res.json?.error, 'support_session_refused');
    assert.deepEqual(named(res), []);
  }
  assert.equal(snapshot(), before);
  assert.equal(reveals(), 0, 'no reveal was recorded');
  assert.deepEqual(outbound, []);
});

test('a session charge: only the booking\'s founder may pay it; everyone else, the session\'s advisor included, gets the answer a missing booking gets', async () => {
  const before = snapshot();
  for (const r of [R.payAdvisors, R.payMentors]) {
    const answers = new Set<string>();
    for (const id of [CO_FOUNDER, OTHER_FOUNDER, OTHER_INVESTOR, OTHER_PARTNER, REVOKED_ADVISOR, ADVISOR_SELF, ADMIN, SUPER]) {
      // Each asks for the disabled founder's billed, payable session too: the one a charge that got through would take.
      for (const booking of [701, 702]) {
        const real = await call(r.path(booking), id, 'POST');
        const none = await call(r.path(99999), id, 'POST');
        // Mutation checked: the pay route's `row.founder_user_id !== user.id` test removed → the outsider reaches the
        // billing checks (409 on the paid session; the payout gate on the billed one) and this fails.
        assert.equal(real.status, 404, `${r.route} ${booking} as ${WHO[id]}: ${real.text}`);
        assert.deepEqual(named(real), [], `${r.route} as ${WHO[id]}: names nothing`);
        assert.deepEqual([real.status, real.text], [none.status, none.text], `${r.route} as ${WHO[id]}: no existence leak`);
        answers.add(`${real.status} ${real.text}`);
      }
    }
    assert.equal(answers.size, 1, `${r.route}: one answer whoever asks`);
  }
  assert.equal(snapshot(), before, 'no booking, slot or customer changed');
  assert.deepEqual(outbound, [], 'no payment provider was called');
});

test('an engagement invoice: only its two sides read it; only its partner marks it paid', async () => {
  const before = snapshot();
  const outsiders = [OTHER_FOUNDER, OTHER_INVESTOR, OTHER_PARTNER, REVOKED_ADVISOR, ADMIN, SUPER];
  const answers = new Set<string>();
  for (const id of outsiders) {
    const real = await call(R.invoiceRead.path(801), id);
    const none = await call(R.invoiceRead.path(99999), id);
    // Mutation checked, one at a time: the read's partner-side test widened to any partner, and its founder-side
    // `founder_id` match removed → the other partner or the other founder reads the invoice and this fails.
    assert.equal(real.status, 404, `read as ${WHO[id]}: ${real.text}`);
    assert.deepEqual(named(real), [], `read as ${WHO[id]}: names nothing`);
    assert.deepEqual([real.status, real.text], [none.status, none.text], `read as ${WHO[id]}: no existence leak`);
    answers.add(`${real.status} ${real.text}`);
  }
  assert.equal(answers.size, 1, 'the read: one answer whoever asks');
  // Marking paid is the partner's act alone. The founder side is a party and is refused; so is every outsider.
  const paid = new Set<string>();
  for (const id of [FOUNDER, CO_FOUNDER, ...outsiders]) {
    const r = await call(R.invoicePaid.path(801), id, 'POST');
    // Mutations checked, one at a time: the partner test removed, and its `partner_id` match removed → the founder or the
    // other partner marks the invoice paid and this fails.
    assert.equal(r.status, 403, `mark paid as ${WHO[id]}: ${r.text}`);
    assert.deepEqual(named(r), [], `mark paid as ${WHO[id]}: names nothing`);
    paid.add(`${r.status} ${r.text}`);
  }
  assert.equal(paid.size, 1, 'mark paid: one answer whoever is refused');
  assert.equal(snapshot(), before, 'the invoice is still issued');
  assert.deepEqual(outbound, []);
});

test('an order\'s invoice PDF: the buyer\'s alone; a co-founder, an admin and the Super Admin get the answer a missing order gets', async () => {
  const before = snapshot();
  const answers = new Set<string>();
  for (const id of [CO_FOUNDER, OTHER_FOUNDER, OTHER_INVESTOR, OTHER_PARTNER, REVOKED_ADVISOR, ADMIN, SUPER]) {
    const real = await call(R.orderInvoice.path('ORD-QK-0001'), id);
    const none = await call(R.orderInvoice.path('ORD-QK-9999'), id);
    // Mutation checked: the route's `row.user_id !== user.id` test removed → the PDF is served and this fails.
    assert.equal(real.status, 404, `as ${WHO[id]}: ${real.text}`);
    assert.notEqual(real.type, 'application/pdf');
    assert.equal(real.disposition, null, `as ${WHO[id]}: no file named`);
    assert.deepEqual([real.status, real.text], [none.status, none.text], `as ${WHO[id]}: no existence leak`);
    answers.add(`${real.status} ${real.text}`);
  }
  assert.equal(answers.size, 1);
  assert.equal(snapshot(), before);
  assert.deepEqual(outbound, []);
});

test('a saved card: only the holder of its Stripe customer detaches it; nobody else\'s request reaches the detach', async () => {
  const before = snapshot();
  const answers = new Set<string>();
  for (const id of [OTHER_FOUNDER, CO_FOUNDER, OTHER_INVESTOR, OTHER_PARTNER, ADMIN, SUPER]) {
    const r = await call(R.cardDetach.path('pm_quokka'), id, 'DELETE');
    // Mutation checked: the `pm.customer !== user.stripe_customer_id` test removed → another founder (who holds a
    // customer of their own) detaches the owner's card and this fails; so does the detach count below.
    assert.equal(r.status, 404, `as ${WHO[id]}: ${r.text}`);
    assert.deepEqual(named(r), []);
    answers.add(`${r.status} ${r.text}`);
  }
  assert.equal(answers.size, 1, 'one answer whoever asks');
  assert.deepEqual(detaches(), [], 'no card was detached');
  // A caller with no customer of their own never reaches Stripe at all; one with a customer only reads the card.
  assert.deepEqual(outbound, ['GET https://api.stripe.com/v1/payment_methods/pm_quokka'],
    'only the other founder, who holds a customer, read the card');
  outbound.length = 0;
  assert.equal(snapshot(), before);
});

test('an LPA signature: another LP in the same fund, any non-LP, and an LP without KYC are refused; nothing is signed', async () => {
  const before = snapshot();
  const refusals = new Set<string>();
  for (const id of [OTHER_INVESTOR, OTHER_FOUNDER, OTHER_PARTNER, REVOKED_ADVISOR, PENDING_INVESTOR]) {
    const r = await call(R.signLpa.path(901), id, 'POST');
    // Mutation checked: the route's `lp.user_id !== user.id` test removed → another LP signs this LP's LPA and this fails.
    assert.equal(r.status, 403, `as ${WHO[id]}: ${r.text}`);
    assert.deepEqual(named(r), [], `as ${WHO[id]}: names nothing`);
    refusals.add(`${r.status} ${r.text}`);
  }
  assert.equal(refusals.size, 1, 'one answer to every non-LP');
  // The LP's own record, without KYC: a binding signature waits for it.
  const nokyc = await call(R.signLpa.path(904), NO_KYC, 'POST');
  // Mutation checked: requireApprovedKyc's `kyc_status === 'approved'` test removed → the unverified LP signs and this fails.
  assert.equal(nokyc.status, 403, nokyc.text);
  assert.deepEqual(named(nokyc), []);
  assert.equal(snapshot(), before, 'no LPA is signed and no LP changed status');
  assert.deepEqual(outbound, []);
});

test('the retired withdraw: nobody withdraws through it, the commitment\'s own investor and an admin included', async () => {
  const before = snapshot();
  for (const id of [INVESTOR, PENDING_INVESTOR, OTHER_INVESTOR, ADMIN, SUPER]) {
    const r = await call(R.withdraw.path('line-quokka'), id, 'POST', { reason: 'fixture' });
    // Mutation checked: the route made to withdraw (`UPDATE commitments SET status = 'withdrawn' WHERE uid = ?`) → the snapshot below fails.
    assert.equal(r.status, 410, `as ${WHO[id]}: ${r.text}`);
    assert.deepEqual(named(r), []);
  }
  for (const id of [FOUNDER, OTHER_FOUNDER, OTHER_PARTNER, REVOKED_ADVISOR]) {
    const r = await call(R.withdraw.path('line-quokka'), id, 'POST', { reason: 'fixture' });
    // Mutation checked: the route's `requireRole(c, 'investor')` replaced by `requireAuth` → a founder gets 410 and this fails.
    assert.equal(r.status, 403, `as ${WHO[id]}: ${r.text}`);
  }
  assert.equal(snapshot(), before, 'every commitment is as it was');
  assert.deepEqual(outbound, []);
});

test('the rightful parties: each route answers its own party, so every refusal above is the gate', async () => {
  // The masked instructions: the company's founder, the signed investor and a committed investor without a line.
  for (const id of [FOUNDER, INVESTOR, PENDING_INVESTOR]) {
    const r = await call(R.accountRead.path(20), id);
    assert.equal(r.status, 200, `masked read as ${WHO[id]}: ${r.text}`);
    assert.equal(r.json.recorded, true);
    assert.equal(r.json.account.account_number, '••••4821');
    assert.ok(!r.text.includes(NUMBER), 'the read is masked');
  }
  // The reveal: the signed investor, on their own line, once, audited before the number is shown.
  const shown = await call(R.accountReveal.path(20), INVESTOR, 'POST', { commitment_uid: 'line-quokka' });
  assert.equal(shown.status, 200, shown.text);
  assert.equal(shown.json.account.account_number, NUMBER);
  assert.equal(reveals(), 1, 'the reveal was recorded');
  const log = db.prepare('SELECT actor_user_id, commitment_id, outcome FROM company_receiving_account_reveals').get() as any;
  assert.deepEqual({ ...log }, { actor_user_id: INVESTOR, commitment_id: 30, outcome: 'prepared' });

  // The charge: the booking's founder gets past the gate to the billing state (this session is already paid).
  for (const r of [R.payAdvisors, R.payMentors]) {
    const res = await call(r.path(701), FOUNDER, 'POST');
    assert.equal(res.status, 409, `${r.route}: ${res.text}`);
    assert.match(res.json.detail, /already paid/);
  }
  assert.deepEqual(outbound, [], 'a paid session is never charged again');

  // The invoice: both sides read it; the partner marks it paid.
  for (const id of [FOUNDER, CO_FOUNDER, PARTNER]) {
    const r = await call(R.invoiceRead.path(801), id);
    assert.equal(r.status, 200, `invoice read as ${WHO[id]}: ${r.text}`);
    assert.equal(r.json.invoice_number, 'INV-QK-0001');
  }
  const settled = await call(R.invoicePaid.path(801), PARTNER, 'POST');
  assert.equal(settled.status, 200, settled.text);
  assert.equal(settled.json.status, 'paid');

  // The order invoice: the buyer gets the PDF.
  const pdf = await call(R.orderInvoice.path('ORD-QK-0001'), FOUNDER);
  assert.equal(pdf.status, 200, pdf.text.slice(0, 200));
  assert.equal(pdf.type, 'application/pdf');
  assert.match(pdf.disposition ?? '', /invoice-ORD-QK-0001\.pdf/);

  // The card: its holder detaches it, and the detach reaches Stripe.
  const card = await call(R.cardDetach.path('pm_quokka'), FOUNDER, 'DELETE');
  assert.equal(card.status, 200, card.text);
  assert.deepEqual(card.json, { detached: true, id: 'pm_quokka' });
  assert.deepEqual(detaches(), ['POST https://api.stripe.com/v1/payment_methods/pm_quokka/detach']);

  // The LPA: the LP signs their own.
  const signed = await call(R.signLpa.path(901), INVESTOR, 'POST');
  assert.equal(signed.status, 200, signed.text);
  assert.equal(signed.json.lp.lpa_signed, 1);
  assert.equal(signed.json.lp.status, 'active');
  // The other LPs in the fund are untouched.
  assert.deepEqual(db.prepare('SELECT id FROM limited_partners WHERE lpa_signed = 1').all().map((x: any) => x.id), [901]);

  // The retired withdraw refuses its own investor too: the commitment is still pending.
  assert.equal((db.prepare("SELECT status FROM commitments WHERE uid = 'line-quokka'").get() as any).status, 'pending');
});
