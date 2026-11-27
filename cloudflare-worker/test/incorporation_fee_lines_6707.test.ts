/**
 * D6707 (#6707, plan key E15 of #6680) — the quote's fee lines by payee,
 * collector and currency, and the charge equal to the lines Axal VC collects.
 *
 * The real legal routers run over node:sqlite with the full migrated schema,
 * so catalogue version 1 (the D6690 seed) is present and current, as on every
 * database. What is pinned, one test per "Done when" bullet and then some:
 *   - parity: for the six ids the itemised quote equals the fixture recorded
 *     from main 9b92d09389 before the change, once the added fields are taken
 *     off, and logs no fallback;
 *   - a GBP government line beside a USD service fee gives two totals, never one;
 *   - an order whose Axal-collected lines do not sum to the Stripe price is
 *     refused with 409 `quote_charge_mismatch` before any write and before
 *     Stripe is called, on both order routes; when they do sum (option B on a
 *     form that allows it), the order goes through;
 *   - a partner line collected by Axal on a form with `allow_axal_collection = 0`
 *     is refused (quote, case quote and order);
 *   - no `cost_minor` reaches a founder or a partner, in a response or a snapshot;
 *   - the case quote snapshots its lines, priced by the case's assigned partner.
 *
 * The catalogue's published version is immutable (D6689 triggers). To give
 * version 1 a figure, a test drops those triggers on its own copy of the
 * schema; nothing else about the store changes. Every principal and price is
 * synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/incorporation_fee_lines_6707.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import legal from '../src/routes/legal.ts';
import legalIncorporationQuote from '../src/routes/legal_incorporation_quote.ts';
import { FALLBACK_EVENT } from '../src/services/formationCatalogueReaders.ts';
import { chargeRefusal, collectedByOf, payeeOf, quoteOf, timingOf } from '../src/services/incorporationQuote.ts';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const FIXTURE = JSON.parse(readFileSync(resolve(process.cwd(), 'cloudflare-worker/test/fixtures/incorporation_quote_6707/itemised_quote.json'), 'utf8'));
const IDS = ['us_de_ccorp', 'us_wy_ccorp', 'us_de_llc', 'uk_ltd', 'sg_pte', 'ee_oy'];
const JWT_SECRET = 'unit-test-jwt-secret-6707-fee-lines-0123456789';
const FOUNDER = 10, OTHER = 11, PARTNER_USER = 20;
const COST_A = 777123, COST_B = 555321, COST_C = 333777;
const FIRM_A = 'Synthetic Formation Firm Ltd', FIRM_B = 'Second Synthetic Firm LLP';

const one = (db: DatabaseSync, sql: string, ...a: unknown[]) => { const r = db.prepare(sql).get(...(a as any[])); return r ? { ...(r as any) } : r; };
const all = (db: DatabaseSync, sql: string, ...a: unknown[]) => (db.prepare(sql).all(...(a as any[])) as any[]).map((r) => ({ ...r }));

/** The database the parity fixture was recorded on: the full schema, one founder, a seeded Stripe mirror. */
function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Synthetic Founder', 'founder@example.invalid', 1001);
  u.run(OTHER, 'founder', 'Other Founder', 'other@example.invalid', 2002);
  u.run(PARTNER_USER, 'partner', 'Synthetic Partner Staff', 'staff@example.invalid', null);
  db.exec("INSERT INTO projects (id, name, founder_id) VALUES (1, 'Synthetic Venture', 1001)");
  try { db.exec('ALTER TABLE stripe_products ADD COLUMN livemode INTEGER'); } catch { /* already there */ }
  const p = db.prepare('INSERT INTO stripe_products (id, name, kind, active, metadata_json, prices_json, synced_at, livemode) VALUES (?, ?, ?, 1, ?, ?, ?, 0)');
  const price = (id: string, amount: number, currency: string, interval: string | null) => JSON.stringify([{ id: `price_${id}`, product: id, unit_amount: amount, currency, type: interval ? 'recurring' : 'one_time', interval, active: true }]);
  p.run('prod_de', 'Synthetic incorporation Delaware', 'alacarte', JSON.stringify({ jurisdiction_id: 'us_de_ccorp' }), price('prod_de', 50000, 'usd', null), '2026-11-02 10:00:00');
  p.run('prod_uk', 'Synthetic incorporation UK', 'alacarte', JSON.stringify({ jurisdiction_id: 'uk_ltd' }), price('prod_uk', 40000, 'usd', null), '2026-11-03 09:00:00');
  p.run('prod_ra', 'Synthetic registered agent', 'subscription', JSON.stringify({ category: 'registered_agent' }), price('prod_ra', 24900, 'usd', 'year'), '2026-11-01 08:30:00');
  p.run('prod_ein', 'Synthetic EIN filing', 'alacarte', JSON.stringify({ category: 'incorporation_addon' }), price('prod_ein', 9900, 'usd', null), '2026-10-30 12:00:00');
  return db;
}

/** Lets a test give the published version 1 a figure: drops the immutability triggers on this copy only. */
function editable(db: DatabaseSync) {
  for (const t of all(db, "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name LIKE 'formation_%'")) db.exec(`DROP TRIGGER "${t.name}"`);
  return db;
}
const formId = (db: DatabaseSync, key: string) => one(db, "SELECT id FROM formation_entity_forms WHERE form_key = ? AND version_id = (SELECT id FROM formation_catalogue_versions WHERE version = 1)", key).id;
const versionId = (db: DatabaseSync) => one(db, 'SELECT id FROM formation_catalogue_versions WHERE version = 1').id;
function source(db: DatabaseSync, title: string): number {
  db.prepare("INSERT INTO formation_sources (kind, title, url) VALUES ('other', ?, 'https://example.invalid/fees')").run(title);
  return Number(one(db, 'SELECT last_insert_rowid() AS id').id);
}
function feeLine(db: DatabaseSync, form: string, f: { key: string; label: string; payee: string; collected: string; currency: string; amount?: number | null; timing?: string }) {
  const sourced = f.amount != null;
  db.prepare(`INSERT INTO formation_fee_lines (version_id, form_id, line_key, label, payee, collected_by, currency, amount_cents, timing, source_id, checked_on)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(versionId(db), formId(db, form), f.key, f.label, f.payee, f.collected, f.currency,
    f.amount ?? null, f.timing ?? 'at_formation', sourced ? source(db, `${f.label} schedule`) : null, sourced ? '2026-11-20' : null);
}

/** A verified partner firm with formation coverage for a form, a credential and a signed data agreement, and its prices. */
function partner(db: DatabaseSync, o: { id: number; name: string; country: string; form: string; priority?: number; prices: { service: string; founder: number; cost: number; currency: string; cadence: string }[] }) {
  db.prepare("INSERT INTO partners (id, name, company, email) VALUES (?, 'Synthetic Person', ?, ?)").run(o.id + 100, o.name, `firm${o.id}@example.invalid`);
  db.prepare("INSERT INTO formation_partners (id, partner_id, status, dpa_signed_on) VALUES (?, ?, 'verified', '2026-10-01')").run(o.id, o.id + 100);
  db.prepare("INSERT INTO formation_partner_credentials (formation_partner_id, country, licence_type, licence_number, regulator, valid_until) VALUES (?, ?, 'acsp', 'X1', 'Synthetic regulator', '2027-12-31')").run(o.id, o.country);
  for (const pr of o.prices) {
    db.prepare('INSERT INTO formation_partner_coverage (formation_partner_id, country, form_key, service, priority, is_on) VALUES (?, ?, ?, ?, ?, 1)').run(o.id, o.country, o.form, pr.service, o.priority ?? 100);
    const cov = Number(one(db, 'SELECT last_insert_rowid() AS id').id);
    db.prepare("INSERT INTO formation_partner_prices (coverage_id, founder_price_minor, cost_minor, currency, cadence, effective_from) VALUES (?, ?, ?, ?, ?, '2026-01-01')")
      .run(cov, pr.founder, pr.cost, pr.currency, pr.cadence);
  }
}
const ukPartners = (db: DatabaseSync) => {
  partner(db, { id: 1, name: FIRM_A, country: 'GB', form: 'uk_ltd', priority: 10, prices: [
    { service: 'formation', founder: 30000, cost: COST_A, currency: 'GBP', cadence: 'one_time' },
    { service: 'registered_office', founder: 12000, cost: COST_B, currency: 'GBP', cadence: 'annual' },
  ] });
  partner(db, { id: 2, name: FIRM_B, country: 'GB', form: 'uk_ltd', priority: 50, prices: [
    { service: 'formation', founder: 45000, cost: COST_C, currency: 'GBP', cadence: 'one_time' },
  ] });
  db.prepare("INSERT INTO formation_partner_members (formation_partner_id, user_id, role) VALUES (1, ?, 'staff')").run(PARTNER_USER);
};

const kv = () => { const m = new Map<string, string>(); return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); } }; };
const envOf = (db: DatabaseSync, extra: Record<string, unknown> = {}) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', STRIPE_SECRET_KEY: 'sk_test_fixture', DB: d1Over(db), RATE_LIMITS: kv(), ...extra } as any);

const app = new Hono<any>();
app.route('/api/legal', legalIncorporationQuote);
app.route('/api/legal', legal);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(env: any, who: number, method: string, path: string, body?: unknown) {
  const role = who === PARTNER_USER ? 'partner' : 'founder';
  const jwt = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}
const quote = (env: any, id: string, who = FOUNDER) => call(env, who, 'GET', `/api/legal/incorporation/itemised-quote?jurisdiction_id=${id}`);

/**
 * Runs `fn` with the console captured and `fetch` counted; returns its result, the fallback lines and the fetch count.
 * With `stripe`, every call answers as a synthetic Stripe object would (an invoice whose PaymentIntent is minted), so
 * an order that passes the price check completes; without it, a call fails as an unreachable network.
 */
async function watched<T>(fn: () => Promise<T>, { stripe = false } = {}): Promise<{ value: T; fallbacks: any[]; fetches: number }> {
  const w = console.warn, e = console.error, l = console.log, f = globalThis.fetch;
  const fallbacks: any[] = [];
  let fetches = 0;
  console.warn = (...a: unknown[]) => { try { const o = JSON.parse(String(a[0])); if (o?.event === FALLBACK_EVENT) fallbacks.push(o); } catch { /* not ours */ } };
  console.error = () => {}; console.log = () => {};
  globalThis.fetch = (async () => {
    fetches += 1;
    if (!stripe) throw new Error('no network in this test');
    return new Response(JSON.stringify({ id: `obj_${fetches}`, client_secret: 'pi_secret_synthetic', payment_intent: { id: 'pi_synthetic', client_secret: 'pi_secret_synthetic' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as any;
  try { return { value: await fn(), fallbacks, fetches }; } finally { console.warn = w; console.error = e; console.log = l; globalThis.fetch = f; }
}

const ADDED_LINE = ['payee', 'payee_name', 'collected_by', 'timing', 'billed_by'];
const withoutAdded = (body: any) => {
  const { totals: _t, charge: _c, ...rest } = body;
  return { ...rest, lines: rest.lines.map((l: any) => Object.fromEntries(Object.entries(l).filter(([k]) => !ADDED_LINE.includes(k)))) };
};

// Mutation checked: the government line read with its catalogue currency upper case ('USD', fails); its label read from
// the payee instead of the line (fails); `total` summing per currency instead of D4357's rule (fails uk_ltd's total).
test('parity: for the six ids the quote is the recorded fixture once the added fields are off, read from the catalogue', async () => {
  const db = fixture();
  const env = envOf(db);
  const { value, fallbacks } = await watched(async () => {
    const out: Record<string, unknown> = {};
    for (const id of IDS) { const r = await quote(env, id); out[id] = { status: r.status, body: r.body }; }
    return out as Record<string, { status: number; body: any }>;
  });
  for (const id of IDS) {
    assert.equal(value[id].status, FIXTURE[id].status, id);
    assert.deepEqual(withoutAdded(value[id].body), FIXTURE[id].body, `${id}: only fields were added`);
  }
  assert.deepEqual(fallbacks, [], 'the quote read the catalogue, not the frozen table');
  // The added fields, on Delaware.
  const de = value.us_de_ccorp.body;
  const by = (k: string) => de.lines.find((l: any) => l.key === k);
  assert.deepEqual(['payee', 'payee_name', 'collected_by', 'timing', 'billed_by'].map((k) => by('state_filing_fee')[k]),
    ['government', 'Delaware Division of Corporations', 'government', 'at_filing', null]);
  assert.deepEqual(['payee', 'collected_by', 'timing'].map((k) => by('service_fee')[k]), ['axal', 'axal', 'at_order']);
  assert.equal(by('registered_agent').timing, 'yearly');
  assert.deepEqual(de.totals, [{ amount_cents: 50000, currency: 'usd', complete: false, unknown: ['State filing fee'] }]);
  assert.deepEqual(de.charge, { currency: 'usd', amount_cents: 50000, lines: ['service_fee'] });
  // A form with no Stripe price has no charge to make.
  assert.deepEqual(value.ee_oy.body.charge, { currency: 'eur', amount_cents: null, lines: ['service_fee'] });
});

// Mutation checked: `totals` holding only the quote's currency (fails: one total); every line counted in each
// currency's total (fails: the GBP line in the USD total).
test('a GBP government line beside a USD service fee gives two totals, never one sum', async () => {
  const db = editable(fixture());
  const src = source(db, 'Companies House, incorporation fee (synthetic)');
  db.prepare("UPDATE formation_fee_lines SET amount_cents = 5000, source_id = ?, checked_on = '2026-11-20' WHERE line_key = 'state_filing_fee' AND form_id = ?").run(src, formId(db, 'uk_ltd'));
  const { value: r } = await watched(() => quote(envOf(db), 'uk_ltd'));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.totals, [
    { amount_cents: 40000, currency: 'usd', complete: true, unknown: [] },
    { amount_cents: 5000, currency: 'gbp', complete: true, unknown: [] },
  ]);
  const gov = r.body.lines.find((l: any) => l.key === 'state_filing_fee');
  assert.deepEqual([gov.amount_cents, gov.currency, gov.source, gov.checked_on], [5000, 'gbp', 'Companies House, incorporation fee (synthetic)', '2026-11-20']);
  // D4357's single total still counts the GBP line as not known in the quote's currency.
  assert.deepEqual(r.body.total, { amount_cents: 40000, currency: 'usd', complete: false, unknown: ['State filing fee'] });
});

// Mutation checked: the order route's check removed (fails: 200 and a row); the checkout route's check removed
// (fails: 200 and a row); chargeRefusal comparing with `>=` (fails: the extra line passes).
test('an order whose Axal-collected lines do not sum to the Stripe price is refused before any write, on both routes', async () => {
  const db = editable(fixture());
  feeLine(db, 'us_de_ccorp', { key: 'expedite', label: 'Expedited filing', payee: 'Delaware Division of Corporations', collected: 'axal', currency: 'USD', amount: 5000 });
  const count = () => [one(db, 'SELECT COUNT(*) AS n FROM incorporations').n, one(db, 'SELECT COUNT(*) AS n FROM formation_cases').n];
  const before = count();
  const order = { jurisdiction_id: 'us_de_ccorp', company_name: 'Synthetic Co', project_id: 1 };

  const q = await watched(() => quote(envOf(db), 'us_de_ccorp'));
  assert.deepEqual(q.value.body.charge, { currency: 'usd', amount_cents: 55000, lines: ['expedite', 'service_fee'] }, 'the quote shows what Axal would collect');

  const live = await watched(() => call(envOf(db), FOUNDER, 'POST', '/api/legal/incorporation/order', order), { stripe: true });
  assert.equal(live.value.status, 409, live.value.text);
  assert.equal(live.value.body.error, 'quote_charge_mismatch');
  assert.match(live.value.body.message, /nothing was saved or charged/);
  assert.equal(live.fetches, 0, 'Stripe is never called');
  const checkout = await watched(() => call(envOf(db), FOUNDER, 'POST', '/api/legal/incorporate/checkout', order), { stripe: true });
  assert.equal(checkout.value.status, 409, checkout.value.text);
  assert.equal(checkout.value.body.error, 'quote_charge_mismatch');
  assert.equal(checkout.fetches, 0, 'no Checkout session is opened');
  assert.deepEqual(count(), before, 'no order and no case written');

  // Without the extra line the same orders go through to Stripe and write their rows.
  db.prepare("DELETE FROM formation_fee_lines WHERE line_key = 'expedite'").run();
  const ok = await watched(() => call(envOf(db), FOUNDER, 'POST', '/api/legal/incorporation/order', order), { stripe: true });
  assert.equal(ok.value.status, 200, ok.value.text);
  assert.equal(ok.value.body.amount_cents, 50000);
  const okCheckout = await watched(() => call(envOf(db), FOUNDER, 'POST', '/api/legal/incorporate/checkout', order), { stripe: true });
  assert.equal(okCheckout.value.status, 200, okCheckout.value.text);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM incorporations').n, before[0] + 2);
});

// Mutation checked: collectionRefusal ignoring allow_axal_collection (fails the allowed case); the partner rule's
// collected_by not mapped (fails: the line reads partner and the order passes at 50000 + 31000).
test('a partner fee collected by Axal: the order passes only on a form that allows it and when the lines sum to the price', async () => {
  const db = editable(fixture());
  db.prepare("UPDATE formation_entity_forms SET allow_axal_collection = 1 WHERE id = ?").run(formId(db, 'us_de_ccorp'));
  feeLine(db, 'us_de_ccorp', { key: 'service_fee', label: 'Axal VC service fee', payee: 'Axal VC', collected: 'axal', currency: 'USD', amount: 20000 });
  feeLine(db, 'us_de_ccorp', { key: 'formation', label: 'Partner formation service', payee: 'partner', collected: 'axal', currency: 'USD' });
  partner(db, { id: 3, name: 'Synthetic Delaware Agent Inc', country: 'US', form: 'us_de_ccorp', prices: [{ service: 'formation', founder: 30000, cost: COST_A, currency: 'USD', cadence: 'one_time' }] });
  const order = { jurisdiction_id: 'us_de_ccorp', company_name: 'Synthetic Co', project_id: 1 };
  const q = await watched(() => quote(envOf(db), 'us_de_ccorp'));
  assert.equal(q.value.status, 200, q.value.text);
  assert.deepEqual(q.value.body.charge, { currency: 'usd', amount_cents: 50000, lines: ['service_fee', 'partner:formation'] });
  const svc = q.value.body.lines.find((l: any) => l.key === 'service_fee');
  assert.equal(svc.amount_cents, 20000, "Axal's own fee, from the catalogue");
  const ok = await watched(() => call(envOf(db), FOUNDER, 'POST', '/api/legal/incorporation/order', order), { stripe: true });
  assert.equal(ok.value.status, 200, ok.value.text);
  db.prepare('UPDATE formation_partner_prices SET founder_price_minor = 31000').run();
  const off = await watched(() => call(envOf(db), FOUNDER, 'POST', '/api/legal/incorporation/order', order), { stripe: true });
  assert.equal(off.value.status, 409, off.value.text);
  assert.equal(off.value.body.error, 'quote_charge_mismatch');
});

// Mutation checked: the collection check dropped from the order route (fails: 200); dropped from the GET (fails: 200);
// payeeOf reading 'partner' as government (fails: no partner line collected by Axal, so nothing refused).
test('a partner line collected by Axal is refused on a form whose allow_axal_collection is 0', async () => {
  const db = editable(fixture());
  ukPartners(db);
  feeLine(db, 'uk_ltd', { key: 'formation', label: 'Partner formation service', payee: 'partner', collected: 'axal', currency: 'GBP' });
  assert.equal(one(db, 'SELECT allow_axal_collection AS a FROM formation_entity_forms WHERE id = ?', formId(db, 'uk_ltd')).a, 0);
  const before = one(db, 'SELECT COUNT(*) AS n FROM incorporations').n;
  const q = await watched(() => quote(envOf(db), 'uk_ltd'));
  assert.equal(q.value.status, 409, q.value.text);
  assert.equal(q.value.body.error, 'partner_collection_not_allowed');
  for (const path of ['/api/legal/incorporation/order', '/api/legal/incorporate/checkout']) {
    const r = await watched(() => call(envOf(db), FOUNDER, 'POST', path, { jurisdiction_id: 'uk_ltd', company_name: 'Synthetic Ltd', project_id: 1 }), { stripe: true });
    assert.equal(r.value.status, 409, `${path}: ${r.value.text}`);
    assert.equal(r.value.body.error, 'partner_collection_not_allowed');
    assert.equal(r.fetches, 0);
  }
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM incorporations').n, before, 'nothing written');
  // Collected by the partner instead, the same line is quoted, billed by the firm.
  db.prepare("UPDATE formation_fee_lines SET collected_by = 'provider' WHERE line_key = 'formation'").run();
  const fine = await watched(() => quote(envOf(db), 'uk_ltd'));
  assert.equal(fine.value.status, 200, fine.value.text);
  const line = fine.value.body.lines.find((l: any) => l.key === 'partner:formation');
  assert.deepEqual([line.label, line.collected_by, line.billed_by, line.amount_cents, line.currency], ['Partner formation service', 'partner', FIRM_A, 30000, 'gbp']);
});

// Mutation checked: the partner price read from `cost_minor` (fails: the cost shows); the default partner ordered by
// priority DESC (fails: FIRM_B priced).
test('no cost_minor reaches a founder or a partner: quote, case quote and snapshot carry the founder price only', async () => {
  const db = fixture();
  ukPartners(db);
  db.prepare("INSERT INTO formation_cases (id, uid, user_id, intent, project_id, track, stage, form_key) VALUES (7, 'fc_synthetic', ?, 'convert_project', 1, 'v2', 'details', 'uk_ltd')").run(FOUNDER);
  const env = envOf(db);
  const reads = [await quote(env, 'uk_ltd', FOUNDER), await quote(env, 'uk_ltd', PARTNER_USER),
    await watched(() => call(env, FOUNDER, 'POST', '/api/legal/incorporation/cases/fc_synthetic/itemised-quote')).then((w) => w.value)];
  for (const r of reads) {
    assert.equal(r.status, 200, r.text);
    assert.doesNotMatch(r.text, /cost/i);
    for (const cost of [COST_A, COST_B, COST_C]) assert.ok(!r.text.includes(String(cost)), `cost ${cost} leaked`);
  }
  const lines = reads[0].body.lines;
  const p = (k: string) => lines.find((l: any) => l.key === k);
  assert.deepEqual([p('partner:formation').amount_cents, p('partner:formation').payee_name, p('partner:formation').timing], [30000, FIRM_A, 'at_filing'], 'the default partner: the lowest priority');
  assert.deepEqual([p('partner:registered_office').timing, p('partner:registered_office').billed_by, p('partner:registered_office').interval], ['yearly', FIRM_A, 'year'], 'billed by the partner, yearly');
  assert.deepEqual(reads[0].body.totals.map((t: any) => [t.currency, t.amount_cents]), [['usd', 40000], ['gbp', 30000]], 'the yearly line is not in a total');
  const snap = all(db, 'SELECT * FROM formation_case_fee_lines WHERE case_id = 7');
  assert.ok(snap.length > 0);
  assert.ok(!Object.keys(snap[0]).some((k) => /cost/.test(k)), 'no cost column');
  assert.ok(!JSON.stringify(snap).includes(String(COST_A)) && !JSON.stringify(snap).includes(String(COST_B)));
});

// Mutation checked: the assignment ignored (fails: FIRM_A priced); the ownership check dropped (fails: OTHER 200);
// the stage check dropped (fails: a paid case quoted); snapshotStatements writing one quote_uid per line (fails).
test('the case quote snapshots its lines on the case, priced by the case\'s assigned partner, for its founder only', async () => {
  // editable(): the assignment's own triggers (D6705's ownership gate) are not what this test is about.
  const db = editable(fixture());
  ukPartners(db);
  db.prepare("INSERT INTO formation_cases (id, uid, user_id, intent, project_id, track, stage, form_key) VALUES (7, 'fc_synthetic', ?, 'convert_project', 1, 'v2', 'details', 'uk_ltd')").run(FOUNDER);
  db.prepare(`INSERT INTO formation_case_assignments (case_id, formation_partner_id, partner_id, service, state, offered_by, expires_at)
    VALUES (7, 2, 102, 'formation', 'accepted', ?, '2026-12-31 00:00:00')`).run(FOUNDER);
  const env = envOf(db);
  const path = '/api/legal/incorporation/cases/fc_synthetic/itemised-quote';
  const { value: r } = await watched(() => call(env, FOUNDER, 'POST', path));
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.case_uid, 'fc_synthetic');
  const partnerLine = r.body.lines.find((l: any) => l.key === 'partner:formation');
  assert.deepEqual([partnerLine.amount_cents, partnerLine.payee_name], [45000, FIRM_B], 'the assigned partner, not the default');
  const snap = all(db, 'SELECT quote_uid, position, line_key, payee, collected_by, timing, currency, amount_minor, formation_partner_id FROM formation_case_fee_lines WHERE case_id = 7 ORDER BY position');
  assert.equal(snap.length, r.body.lines.length);
  assert.ok(snap.every((s) => s.quote_uid === r.body.quote_uid));
  assert.deepEqual(snap.map((s) => s.line_key), r.body.lines.map((l: any) => l.key));
  assert.deepEqual(snap.find((s) => s.line_key === 'partner:formation'),
    { quote_uid: r.body.quote_uid, position: snap.findIndex((s) => s.line_key === 'partner:formation'), line_key: 'partner:formation', payee: 'partner', collected_by: 'partner', timing: 'at_filing', currency: 'gbp', amount_minor: 45000, formation_partner_id: 2 });
  const gov = snap.find((s) => s.line_key === 'state_filing_fee');
  assert.deepEqual([gov.payee, gov.collected_by, gov.amount_minor], ['government', 'government', null], 'not recorded stays null');
  // A second quote adds a snapshot; the first is kept.
  const again = await watched(() => call(env, FOUNDER, 'POST', path));
  assert.equal(again.value.status, 200);
  assert.equal(one(db, 'SELECT COUNT(DISTINCT quote_uid) AS n FROM formation_case_fee_lines WHERE case_id = 7').n, 2);
  // Someone else's case, and a paid case, are refused and write nothing.
  const n = one(db, 'SELECT COUNT(*) AS n FROM formation_case_fee_lines').n;
  const other = await watched(() => call(env, OTHER, 'POST', path));
  assert.equal(other.value.status, 404);
  assert.equal(other.value.body.error, 'formation_case_not_found');
  db.prepare("UPDATE formation_cases SET stage = 'paid' WHERE id = 7").run();
  const paid = await watched(() => call(env, FOUNDER, 'POST', path));
  assert.equal(paid.value.status, 409);
  assert.equal(paid.value.body.error, 'formation_case_quote_locked');
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM formation_case_fee_lines').n, n);
});

// Mutation checked: timingOf putting an Axal one-off at filing (fails); collectedByOf dropping its 'axal' case (fails);
// chargeRefusal ignoring the currency (fails the EUR case); the vocabulary's fee_labels ignored (fails).
test('the vocabulary: payee, collector and timing from the catalogue, and the charge compared in its own currency', () => {
  assert.deepEqual(['Axal VC', 'axal', 'partner', 'Companies House'].map(payeeOf), ['axal', 'axal', 'partner', 'government']);
  assert.deepEqual([collectedByOf('axal', 'government'), collectedByOf('provider', 'government'), collectedByOf('payee', 'government'), collectedByOf('payee', 'partner')],
    ['axal', 'partner', 'government', 'partner']);
  assert.deepEqual([timingOf('at_formation', 'axal'), timingOf('one_off', 'government'), timingOf('annual', 'axal'), timingOf('monthly', 'partner')],
    ['at_order', 'at_filing', 'yearly', 'monthly']);
  const q = quoteOf({ jurisdictionId: 'us_de_ccorp', service: { amount_cents: 50000, currency: 'usd' }, agent: null, feeLines: [] });
  assert.equal(chargeRefusal(q, { amountCents: 50000, currency: 'usd' }), null);
  assert.equal(chargeRefusal(q, { amountCents: 50000, currency: 'eur' })?.code, 'quote_charge_mismatch');
  assert.equal(chargeRefusal(q, { amountCents: 49999, currency: 'usd' })?.code, 'quote_charge_mismatch');
  const named = quoteOf({ jurisdictionId: 'uk_ltd', service: null, agent: null, vocabulary: { fee_labels: { state_filing_fee: 'Companies House fee' } },
    feeLines: [{ key: 'state_filing_fee', label: 'State filing fee', payee: 'Companies House', collected_by: 'payee', currency: 'GBP', amount_cents: null, timing: 'at_formation', source: null, checked_on: null }] });
  assert.equal(named.lines[0].label, 'Companies House fee', "the form's vocabulary names the line");
  const unknown = quoteOf({ jurisdictionId: 'x', service: null, agent: null, feeLines: [] });
  assert.equal(chargeRefusal(unknown, { amountCents: 50000, currency: 'usd' })?.code, 'quote_charge_mismatch', 'an unknown Axal line never matches');
});
