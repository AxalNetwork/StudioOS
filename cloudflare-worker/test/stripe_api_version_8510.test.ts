/**
 * D8510 (#8510) — the Stripe API version the Worker's client names, the two
 * invoice payload shapes its renewal webhooks read, and a guard on direct
 * Stripe calls.
 *
 *   - `STRIPE_API_VERSION` is unset until the owner records the account's
 *     version on #8510: `stripeCall()` then sends no `Stripe-Version` header
 *     (the behaviour before D8510), and sends exactly one when it is set.
 *   - `invoice.paid`, `invoice.payment_failed` and
 *     `invoice.payment_action_required` each run through the real webhook route
 *     in the pre-Basil shape (`invoice.subscription`) and the Basil shape
 *     (`invoice.parent.subscription_details.subscription`, from
 *     `2025-03-31.basil`), to the entitlement and the alert each should give.
 *     The fixtures are sanitised: every id is invented.
 *   - A Stripe API call in the Worker outside `stripeCall()` must name its own
 *     version or be on a short allowlist with its reason.
 *
 * No Stripe call is made and no key is read: fetch is stubbed.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/stripe_api_version_8510.test.ts
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';

import billing, { STRIPE_API_VERSION, stripeCall, stripeVersionHeaders } from '../src/routes/billing.ts';
import { invoiceSubscriptionId } from '../src/services/stripeInvoiceShape.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ADA = 71, BEA = 72;

// ── Stripe, stubbed ─────────────────────────────────────────────────────────
let stripe: Record<string, unknown> = {};
let calls: { method: string; path: string; version: string | null }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(typeof input === 'string' ? input : input?.url);
  const path = url.replace('https://api.stripe.com/v1', '').split('?')[0];
  calls.push({ method: String(init?.method || 'GET').toUpperCase(), path, version: new Headers(init.headers).get('Stripe-Version') });
  if (path in stripe) return new Response(JSON.stringify(stripe[path]), { status: 200 });
  if (url.startsWith('https://api.stripe.com/')) return new Response(JSON.stringify({ error: { message: 'no stub' } }), { status: 404 });
  return new Response('unexpected call in test', { status: 599 });
}) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });
beforeEach(() => { stripe = {}; calls = []; });

// ── A database: the full schema, and two members ────────────────────────────
function database() {
  // The whole schema (baseline and every migration), built once per run by _schema_once.mjs (#8437).
  const db = loadSchema(new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true }));
  const u = db.prepare('INSERT INTO users (id, role, name, email, uid, is_active, stripe_customer_id, stripe_subscription_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)');
  // Ada renews and is past due; Bea's first payment left her row at `incomplete`.
  u.run(ADA, 'founder', 'Ada Fixture', 'ada@example.test', 'uid-71', 'cus_fixtureada', 'sub_fixtureada', 'studio', 'past_due');
  u.run(BEA, 'founder', 'Bea Fixture', 'bea@example.test', 'uid-72', 'cus_fixturebea', 'sub_fixturebea', 'studio', 'incomplete');
  return db;
}
const env = (db: DatabaseSync) => ({ JWT_SECRET: 'unit-test-jwt-secret-0123456789-abcdef', ENVIRONMENT: 'test', STRIPE_SECRET_KEY: 'sk_test_sentinel', DB: d1Over(db) } as any);
const app = (() => {
  const a = new Hono<any>();
  a.route('/api/billing', billing);
  a.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    return s ? c.json({ detail: err.message }, s) : c.json({ detail: String(err?.message || '') }, 500);
  });
  return a;
})();
let seq = 0;
async function hook(db: DatabaseSync, type: string, object: Record<string, unknown>) {
  const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await app.request('/api/billing/stripe/webhook', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: `evt_fixture${++seq}`, livemode: false, type, data: { object } }),
    }, env(db));
    return res.status;
  } finally { [console.warn, console.error, console.log] = saved; }
}
const alerts = (db: DatabaseSync) => db.prepare('SELECT user_id, kind, state, object_id, subscription_id, closed_reason FROM billing_alerts ORDER BY id').all() as any[];
const notices = (db: DatabaseSync) => {
  try { return db.prepare("SELECT user_id, payload FROM notifications_inbox WHERE type = 'billing.renewal_failed' ORDER BY id").all() as any[]; }
  catch { return []; }
};

// ── The two invoice shapes (sanitised fixtures) ─────────────────────────────
type Shape = 'pre-basil' | 'basil';
/** An invoice as Stripe sends it in `shape`: the subscription at the location that version uses, and nowhere else. */
function invoice(shape: Shape, sub: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const common = {
    id: 'in_fixture1', object: 'invoice', billing_reason: 'subscription_cycle', customer: 'cus_fixtureada',
    attempt_count: 1, next_payment_attempt: 1_800_000_000, amount_due: 24900, currency: 'usd', livemode: false,
  };
  if (shape === 'pre-basil') {
    return { ...common, subscription: sub, subscription_details: { metadata: {} }, paid: false, ...over };
  }
  return {
    ...common,
    parent: { type: 'subscription_details', quote_details: null, subscription_details: { metadata: {}, subscription: sub } },
    lines: { object: 'list', data: [{ id: 'il_fixture1', parent: { type: 'subscription_item_details', subscription_item_details: { subscription: sub, subscription_item: 'si_fixture1' } } }] },
    ...over,
  };
}

// ── the version constant ────────────────────────────────────────────────────

test('STRIPE_API_VERSION is unset until the owner records it, and stripeCall then sends no Stripe-Version header', async () => {
  assert.equal(STRIPE_API_VERSION, null, 'set only to the value read in Stripe Workbench (#8510 step 1), never a guess');
  assert.deepEqual(stripeVersionHeaders(), {});
  assert.deepEqual(stripeVersionHeaders(null), {});
  assert.deepEqual(stripeVersionHeaders('2099-01-01.fixture'), { 'Stripe-Version': '2099-01-01.fixture' });
  stripe['/accounts/acct_fixture'] = { id: 'acct_fixture' };
  await stripeCall({ STRIPE_SECRET_KEY: 'sk_test_sentinel' } as any, '/accounts/acct_fixture', {}, { method: 'GET' });
  assert.deepEqual(calls, [{ method: 'GET', path: '/accounts/acct_fixture', version: null }]);
});

test('stripeCall builds its headers from stripeVersionHeaders, so setting the constant versions every platform call', () => {
  const src = read('cloudflare-worker/src/routes/billing.ts');
  const body = src.slice(src.indexOf('export async function stripeCall'), src.indexOf('billing.post('));
  assert.match(body, /\.\.\.stripeVersionHeaders\(\)/);
});

// ── the shared reader ───────────────────────────────────────────────────────

test('invoiceSubscriptionId reads both shapes, an id or an expanded object, and nothing else', () => {
  assert.equal(invoiceSubscriptionId(invoice('pre-basil', 'sub_a')), 'sub_a');
  assert.equal(invoiceSubscriptionId(invoice('basil', 'sub_b')), 'sub_b');
  assert.equal(invoiceSubscriptionId({ subscription: { id: 'sub_c' } }), 'sub_c');
  assert.equal(invoiceSubscriptionId({ parent: { subscription_details: { subscription: { id: 'sub_d' } } } }), 'sub_d');
  assert.equal(invoiceSubscriptionId({ parent: { type: 'quote_details', subscription_details: null } }), null);
  assert.equal(invoiceSubscriptionId({ subscription: null }), null);
  assert.equal(invoiceSubscriptionId(null), null);
  assert.equal(invoiceSubscriptionId('in_x'), null);
});

// ── the three events, in both shapes, through the real webhook ──────────────

for (const shape of ['pre-basil', 'basil'] as Shape[]) {
  test(`${shape}: invoice.payment_failed opens the renewal alert and tells the member once`, async () => {
    const db = database();
    assert.equal(await hook(db, 'invoice.payment_failed', invoice(shape, 'sub_fixtureada')), 200);
    assert.deepEqual(alerts(db).map((a) => [a.user_id, a.kind, a.state, a.object_id, a.subscription_id]),
      [[ADA, 'payment_failed', 'open', 'in_fixture1', 'sub_fixtureada']]);
    const told = notices(db);
    assert.equal(told.length, 1, 'the D892 renewal notice');
    assert.deepEqual([told[0].user_id, JSON.parse(told[0].payload).subscription], [ADA, 'sub_fixtureada']);
    assert.equal(await hook(db, 'invoice.payment_failed', invoice(shape, 'sub_fixtureada')), 200);
    assert.equal(alerts(db).length, 1, 'a redelivery adds nothing');
    assert.equal(notices(db).length, 1);
    assert.equal(calls.length, 0, 'no Stripe call');
  });

  test(`${shape}: invoice.payment_action_required opens the confirmation alert`, async () => {
    const db = database();
    assert.equal(await hook(db, 'invoice.payment_action_required', invoice(shape, 'sub_fixtureada')), 200);
    assert.deepEqual(alerts(db).map((a) => [a.user_id, a.kind, a.state, a.subscription_id]),
      [[ADA, 'needs_confirmation', 'open', 'sub_fixtureada']]);
    assert.equal(calls.length, 0, 'no Stripe call');
  });

  test(`${shape}: invoice.paid closes the alerts and grants the plan a row left at incomplete`, async () => {
    const db = database();
    await hook(db, 'invoice.payment_failed', invoice(shape, 'sub_fixtureada'));
    await hook(db, 'invoice.payment_action_required', invoice(shape, 'sub_fixtureada'));
    assert.equal(await hook(db, 'invoice.paid', invoice(shape, 'sub_fixtureada', shape === 'pre-basil' ? { paid: true } : {})), 200);
    assert.deepEqual(alerts(db).map((a) => [a.state, a.closed_reason]), [['closed', 'paid'], ['closed', 'paid']]);

    // The entitlement: Bea's first invoice is paid; Stripe says her subscription is active.
    stripe['/subscriptions/sub_fixturebea'] = {
      id: 'sub_fixturebea', object: 'subscription', status: 'active', customer: 'cus_fixturebea',
      current_period_end: 1_800_000_000, metadata: { kind: 'tier', tier: 'growth' },
    };
    const paid = invoice(shape, 'sub_fixturebea', { id: 'in_fixture2', billing_reason: 'subscription_create', customer: 'cus_fixturebea' });
    assert.equal(await hook(db, 'invoice.paid', paid), 200);
    assert.ok(calls.some((c) => c.method === 'GET' && c.path === '/subscriptions/sub_fixturebea'), 'the subscription the invoice names is read');
    assert.ok(calls.every((c) => c.version === null), 'no version header while the constant is unset');
    const bea = db.prepare('SELECT subscription_tier, subscription_status FROM users WHERE id = ?').get(BEA) as any;
    assert.deepEqual([bea.subscription_tier, bea.subscription_status], ['growth', 'active']);
  });
}

// ── the guard: no unversioned Stripe call outside stripeCall() ──────────────

/** Files that call the Stripe API directly without `Stripe-Version`, and why that is allowed. Keep it short. */
const UNVERSIONED_ALLOWLIST: Record<string, string> = {
  // Probes a pasted secret key with GET /v1/account and reads only the HTTP
  // status; it is not the platform key, so it cannot go through stripeCall().
  'src/services/providerOauthTest.ts': 'credential probe on a key that is not the platform key; reads the status code only',
  // Names the API host as text on the connector's page; it makes no call.
  'src/integrations/connectorPages.ts': 'a displayed endpoint, not a call',
};
const STRIPE_CLIENT = 'src/routes/billing.ts';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|mjs|js)$/.test(n) && !/\.generated\./.test(n) ? [p] : [];
  });
}
type Source = { file: string; text: string };
function workerSources(root: string): Source[] {
  return sources(join(root, 'src')).map((p) => ({ file: relative(root, p).split('\\').join('/'), text: readFileSync(p, 'utf8') }));
}
/**
 * The files that address the Stripe REST API — its `/v1` URL, or its host as a
 * string a path is appended to — and whether each names a version. A host
 * inside other text (the CSP's connect-src) is not a call. Pure.
 */
function stripeCallers(files: Source[]): { file: string; versioned: boolean }[] {
  return files
    .filter(({ text }) => /https:\/\/api\.stripe\.com(\/v1|['"`])/.test(text))
    .map(({ file, text }) => ({ file, versioned: /['"`]Stripe-Version['"`]\s*:/.test(text) }));
}
/** Callers outside stripeCall() that name no version and are not allowlisted. Pure. */
function unversionedStripeCallers(files: Source[]): string[] {
  return stripeCallers(files)
    .filter(({ file, versioned }) => file !== STRIPE_CLIENT && !versioned && !(file in UNVERSIONED_ALLOWLIST))
    .map(({ file }) => file);
}

test('guard: every Stripe API call outside stripeCall() names its version or is allowlisted with a reason', () => {
  const files = workerSources(resolve(process.cwd(), 'cloudflare-worker'));
  assert.deepEqual(unversionedStripeCallers(files), [], 'route the call through stripeCall(), or send its own Stripe-Version');
  const callers = stripeCallers(files).map((c) => c.file);
  for (const f of Object.keys(UNVERSIONED_ALLOWLIST)) assert.ok(callers.includes(f), `${f} no longer calls Stripe: drop it from the allowlist`);
  assert.ok(Object.keys(UNVERSIONED_ALLOWLIST).length <= 2, 'the allowlist stays short');
  assert.ok(callers.includes('src/integrations/providers/stripe.ts'), 'the connector client is scanned, and passes because it pins its own version');
  assert.ok(callers.includes(STRIPE_CLIENT));
});

test('guard: a new unversioned fetch to the Stripe API is caught; a versioned one, the client and the allowlist are not', () => {
  const bare = { file: 'src/routes/new_thing.ts', text: "await fetch('https://api.stripe.com/v1/customers', { headers: { Authorization: `Bearer ${k}` } });" };
  const pinned = { file: 'src/routes/pinned.ts', text: "await fetch(`https://api.stripe.com/v1/customers`, { headers: { 'Stripe-Version': '2099-01-01' } });" };
  const client = { file: STRIPE_CLIENT, text: 'let url = `https://api.stripe.com/v1${path}`;' };
  const probe = { file: 'src/services/providerOauthTest.ts', text: "safeFetch('https://api.stripe.com/v1/account', {})" };
  const comment = { file: 'src/middleware/securityHeaders.ts', text: "`connect-src 'self' https://api.stripe.com https://x.example; ` // allows `api.stripe.com`" };
  const viaBase = { file: 'src/routes/via_base.ts', text: "const API = 'https://api.stripe.com'; await fetch(`${API}/v1/customers`);" };
  assert.deepEqual(unversionedStripeCallers([bare, pinned, client, probe, comment, viaBase]), ['src/routes/new_thing.ts', 'src/routes/via_base.ts']);
});
