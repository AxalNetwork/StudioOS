/**
 * D586 (#1213) — a Wyoming C-Corp is formable, priced only from the catalog,
 * and its charter is generated only from a counsel-approved body.
 *
 * The owner chose A: form Wyoming companies; the owner adds the catalog price
 * and counsel approves the Wyoming documents. The real legal router runs over
 * node:sqlite; Stripe is a stubbed fetch. What is pinned:
 *   - the jurisdiction list carries `us_wy_ccorp`, and the name check asks the
 *     Wyoming register through OpenCorporates, or says to verify by hand;
 *   - the quote is the catalog price, or `catalog_price_missing`, never an
 *     estimate;
 *   - an order charges the catalog price, and with no price refuses without
 *     writing an order;
 *   - the wizard writes no Articles of Incorporation until the template store
 *     holds a counsel-approved body, and lists them as pending counsel.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/wyoming_formation_d586.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import legal from '../src/routes/legal.ts';
import { checkCompanyName, JURISDICTION_REGISTRY } from '../src/services/nameCheck.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 10, ADMIN = 1;
const WY_PRICE = 34900;

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

const product = (id: string, jurisdiction: string, amount: number) => ({
  id, name: `Incorporation ${jurisdiction}`, kind: 'alacarte', active: 1,
  metadata_json: JSON.stringify({ jurisdiction_id: jurisdiction }),
  prices_json: JSON.stringify([{ id: `price_${id}`, product: id, unit_amount: amount, currency: 'usd', type: 'one_time', interval: null, active: true }]),
});

function fixture({ wyPrice = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'entities', 'documents']) db.exec(ddl(t));
  db.exec(`CREATE TABLE stripe_products (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'alacarte',
    active INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}', prices_json TEXT NOT NULL DEFAULT '[]',
    synced_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const p = db.prepare('INSERT INTO stripe_products (id, name, kind, active, metadata_json, prices_json) VALUES (?, ?, ?, ?, ?, ?)');
  const de = product('prod_de', 'us_de_ccorp', 50000);
  p.run(de.id, de.name, de.kind, de.active, de.metadata_json, de.prices_json);
  if (wyPrice) {
    const wy = product('prod_wy', 'us_wy_ccorp', WY_PRICE);
    p.run(wy.id, wy.name, wy.kind, wy.active, wy.metadata_json, wy.prices_json);
  }
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, stripe_customer_id) VALUES (?, ?, ?, ?, 1, ?, ?)');
  u.run(ADMIN, 'admin', 'Hq Admin', 'hq@axal.example', null, null);
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001, 'cus_test');
  db.exec("INSERT INTO projects (id, name, founder_id) VALUES (1, 'Acme', 1001)");
  return db;
}

const app = new Hono<any>();
app.route('/legal', legal);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

const kv = () => { const m = new Map<string, string>(); return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); } }; };

async function call(db: any, who: number, method: string, path: string, body?: unknown, extraEnv: Record<string, unknown> = {}) {
  const jwt = await new SignJWT({ user_id: who, role: who === ADMIN ? 'admin' : 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), RATE_LIMITS: kv(), ...extraEnv } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

/** Stripe, stubbed: records each call and answers the invoice flow. */
function stubStripe() {
  const calls: Array<{ path: string; body: Record<string, string> }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const u = new URL(String(url));
    const path = u.pathname.replace(/^\/v1/, '');
    calls.push({ path, body: Object.fromEntries(new URLSearchParams(String(init.body || ''))) });
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (path === '/invoices') return json({ id: 'in_test' });
    if (path === '/invoiceitems') return json({ id: 'ii_test' });
    if (path === '/invoices/in_test/finalize') return json({ id: 'in_test', payment_intent: { id: 'pi_test', client_secret: 'pi_test_secret' } });
    if (path.startsWith('/payment_intents/')) return json({ id: 'pi_test' });
    return json({ id: 'x' });
  }) as any;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error, l = console.log; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; console.log = l; }
};

test('the jurisdiction list offers a Wyoming C-Corp with its own charter', async () => {
  const db = fixture();
  const r = await call(db, FOUNDER, 'GET', '/legal/jurisdictions');
  const wy = r.body.jurisdictions.find((j: any) => j.id === 'us_wy_ccorp');
  assert.ok(wy, 'no Wyoming jurisdiction');
  assert.equal(wy.label, 'Wyoming C-Corp');
  assert.equal(wy.entity_type, 'C Corporation');
  assert.equal(wy.atlas_supported, false, 'Stripe Atlas forms Delaware companies only');
  assert.deepEqual(wy.templates, ['articles_of_incorporation_wy', 'bylaws', 'stock_purchase_agreement', 'section_83b']);
});

test('the quote is the catalog price for Wyoming, or catalog_price_missing, never an estimate', async () => {
  const priced = await call(fixture(), FOUNDER, 'GET', '/legal/incorporation/quote?jurisdiction_id=us_wy_ccorp');
  assert.equal(priced.status, 200);
  assert.equal(priced.body.amount_cents, WY_PRICE);
  assert.equal(priced.body.source, 'catalog');
  assert.equal(priced.body.label, 'Wyoming C-Corp');

  const missing = await call(fixture({ wyPrice: false }), FOUNDER, 'GET', '/legal/incorporation/quote?jurisdiction_id=us_wy_ccorp');
  assert.equal(missing.status, 200);
  assert.equal(missing.body.amount_cents, null);
  assert.equal(missing.body.reason, 'catalog_price_missing');
});

test('an order charges the catalog price', async () => {
  const db = fixture();
  const stripe = stubStripe();
  try {
    const r = await quiet(() => call(db, FOUNDER, 'POST', '/legal/incorporation/order',
      { project_id: 1, jurisdiction_id: 'us_wy_ccorp', company_name: 'Acme, Inc.' },
      { ENVIRONMENT: 'production', STRIPE_SECRET_KEY: 'sk_test_stub', KEK_PII: 'k'.repeat(40) }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.amount_cents, WY_PRICE);
    const item = stripe.calls.find((x) => x.path === '/invoiceitems');
    assert.ok(item, 'no invoice item was created');
    assert.equal(item!.body.amount, String(WY_PRICE));
    assert.match(item!.body.description, /Wyoming C-Corp/);
    const inv = stripe.calls.find((x) => x.path === '/invoices');
    assert.equal(inv!.body['metadata[jurisdiction_id]'], 'us_wy_ccorp');
  } finally { stripe.restore(); }
  const order = db.prepare('SELECT jurisdiction_id, amount_cents, status FROM incorporations').get() as any;
  assert.deepEqual({ ...order }, { jurisdiction_id: 'us_wy_ccorp', amount_cents: WY_PRICE, status: 'pending_payment' });
});

test('with no catalog price an order is refused and nothing is written or charged', async () => {
  const db = fixture({ wyPrice: false });
  const stripe = stubStripe();
  try {
    const r = await quiet(() => call(db, FOUNDER, 'POST', '/legal/incorporation/order',
      { project_id: 1, jurisdiction_id: 'us_wy_ccorp', company_name: 'Acme, Inc.' },
      { ENVIRONMENT: 'production', STRIPE_SECRET_KEY: 'sk_test_stub', KEK_PII: 'k'.repeat(40) }));
    assert.equal(r.status, 502);
    assert.equal(r.body.error, 'catalog_price_missing');
    assert.equal(stripe.calls.filter((x) => x.path.startsWith('/invoice')).length, 0, 'Stripe was asked to charge');
  } finally { stripe.restore(); }
  const n = (() => { try { return Number((db.prepare('SELECT COUNT(*) AS n FROM incorporations').get() as any).n); } catch { return 0; } })();
  assert.equal(n, 0);
});

test('the name check asks the Wyoming register, or says to verify by hand', async () => {
  assert.equal(JURISDICTION_REGISTRY.us_wy_ccorp, 'wy');
  const noKey = await checkCompanyName({} as any, 'us_wy_ccorp', 'Acme Robotics');
  assert.equal(noKey.status, 'unavailable');
  assert.equal(noKey.reason, 'wy_register_requires_manual_check');

  const seen: string[] = [];
  const fetchImpl = (async (url: any) => {
    seen.push(String(url));
    return new Response(JSON.stringify({ results: { companies: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as any;
  await checkCompanyName({ OPENCORPORATES_API_KEY: 'oc_test' } as any, 'us_wy_ccorp', 'Acme Robotics', { fetchImpl });
  assert.ok(seen.some((u) => /jurisdiction_code=us_wy\b/.test(u)), `the Wyoming register was not asked: ${seen.join(' ')}`);
});

test('the wizard writes no Wyoming Articles until counsel approves a body, and says so', async () => {
  const db = fixture();
  const r = await quiet(() => call(db, ADMIN, 'POST', '/legal/incorporate/wizard', { project_id: 1, jurisdiction_id: 'us_wy_ccorp', company_name: 'Acme, Inc.' }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.pending_counsel, [{ template_key: 'articles_of_incorporation_wy', title: 'Articles of Incorporation (Wyoming C-Corp)', reason: 'counsel_approval_pending' }]);
  const names = (db.prepare('SELECT template_name FROM documents ORDER BY id').all() as any[]).map((x) => x.template_name);
  assert.ok(!names.includes('articles_of_incorporation_wy'), 'a stub Wyoming charter was written');
  assert.ok(r.body.handoff.next_steps.some((s: string) => /Wyoming Secretary of State/.test(s)));
  const delaware = await quiet(() => call(db, ADMIN, 'POST', '/legal/incorporate/wizard', { project_id: 1, jurisdiction_id: 'us_de_ccorp', company_name: 'Acme, Inc.' }));
  assert.deepEqual(delaware.body.pending_counsel, [], 'Delaware\'s documents are held for counsel too');
});

test('once counsel\'s body is active in the template store, the wizard writes the Articles from it', async () => {
  const db = fixture();
  await quiet(() => call(db, ADMIN, 'POST', '/legal/incorporate/wizard', { project_id: 1, jurisdiction_id: 'us_wy_ccorp', company_name: 'Acme, Inc.' }));
  const cols = (db.prepare('PRAGMA table_info(legal_templates)').all() as any[]).map((c) => c.name);
  assert.ok(cols.includes('slug') && cols.includes('body_md'), 'the template store was not created');
  db.prepare("INSERT INTO legal_templates (slug, title, category, body_md, is_active, is_stub) VALUES ('articles_of_incorporation_wy', 'Articles of Incorporation (Wyoming)', 'formation', 'APPROVED BODY FOR {{company_name}}', 1, 0)").run();
  const r = await quiet(() => call(db, ADMIN, 'POST', '/legal/incorporate/wizard', { project_id: 1, jurisdiction_id: 'us_wy_ccorp', company_name: 'Acme, Inc.' }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.pending_counsel, []);
  const doc = db.prepare("SELECT content FROM documents WHERE template_name = 'articles_of_incorporation_wy'").get() as any;
  assert.ok(doc, 'the approved Articles were not written');
  assert.match(doc.content, /^APPROVED BODY FOR /);
});

test('the Wyoming price is never an estimate: no JURISDICTION_COSTS or legacy env price', () => {
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/legal.ts'), 'utf8');
  const costs = src.slice(src.indexOf('const JURISDICTION_COSTS'), src.indexOf('};', src.indexOf('const JURISDICTION_COSTS')));
  assert.doesNotMatch(costs, /us_wy/);
  const envs = src.slice(src.indexOf('const JURISDICTION_PRICE_ENV'), src.indexOf('};', src.indexOf('const JURISDICTION_PRICE_ENV')));
  assert.doesNotMatch(envs, /us_wy/);
});
