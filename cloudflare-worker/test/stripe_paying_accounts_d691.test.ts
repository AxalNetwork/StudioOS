/**
 * D691 follow-up (#2180) — Stripe's paying customers reach Grow's Customers figure.
 *
 * Stripe's daily `project_metrics` upsert wrote its paying-customer count only
 * to `active_users`, while Grow's Customers figure, the Revenue funnel's
 * Paying stage and Enter a KPI's Customers chip read `paying_accounts`. The
 * upsert now writes both; `active_users` stays for the founder's desk
 * (`routes/progress.ts`).
 *
 *   - A sync with 7 paying customers leaves today's `stripe` row with
 *     `paying_accounts = 7` and `active_users = 7`.
 *   - Grow's Customers figure then reads 7, from Stripe.
 *   - A same-day `manual` row's `paying_accounts` is untouched, and a second
 *     sync overwrites the Stripe row's count rather than adding a row.
 *
 * THE DATABASE IS THE BASELINE PLUS EVERY NUMBERED MIGRATION ABOVE THE CUTOFF,
 * IN ORDER. Stripe is a stub over global fetch: no live call is made. Every
 * name is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/stripe_paying_accounts_d691.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { syncStripeForUser } from '../src/integrations/providers/stripe.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { growFigures } from '../src/services/growCycle.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const ROOT = process.cwd();
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 10, COMPANY = 5, A = 1, INTEGRATION = 3;
const today = () => new Date().toISOString().slice(0, 10);

const BUILT = join(mkdtempSync(join(tmpdir(), 'stripe-paying-')), 'built.db');
async function fixture() {
  if (!existsSync(BUILT)) {
    const db = new DatabaseSync(BUILT, { enableDoubleQuotedStringLiterals: true });
    db.exec(BASELINE);
    for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
    db.close();
  }
  const copy = join(mkdtempSync(join(tmpdir(), 'stripe-paying-')), 'test.db');
  copyFileSync(BUILT, copy);
  const db = new DatabaseSync(copy, { enableDoubleQuotedStringLiterals: true });
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any;
  db.exec(`INSERT INTO founders (id, name, email) VALUES (${FOUNDER}, 'Ana Wren', 'ana@example.test')`);
  db.exec(`INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (${FOUNDER}, 'founder', 'Ana Wren', 'ana@example.test', ${FOUNDER}, 1)`);
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (${COMPANY}, 'cp_harbour', 'Harbour Lantern')`);
  db.exec(`INSERT INTO projects (id, name, founder_id, company_id) VALUES (${A}, 'Harbour Lantern', ${FOUNDER}, ${COMPANY})`);
  db.exec(`INSERT INTO user_company_links (uid, company_id, user_id) VALUES ('ucl_1', ${COMPANY}, ${FOUNDER})`);
  const uid = 'int_stripe_10';
  const enc = await encryptCredentials(env, uid, { access_token: 'sk_test_harbour' });
  db.prepare(`INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type, credentials_enc)
    VALUES (?, ?, ?, 'stripe', 'active', 'oauth2', ?)`).run(INTEGRATION, uid, FOUNDER, enc);
  db.exec(`INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (${INTEGRATION}, ${COMPANY}, 1)`);
  return { db, env };
}

/** Stripe's subscription listings: `customers` paying customers, one $50 subscription each. */
function stubStripe(customers: number) {
  const calls: string[] = [];
  const saved = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    const u = new URL(String(url));
    if (!u.hostname.endsWith('stripe.com')) throw new Error(`unexpected fetch ${url}`);
    const data = u.searchParams.get('status') === 'active'
      ? Array.from({ length: customers }, (_, i) => ({
        id: `sub_${i}`, customer: `cus_${i}`, status: 'active', created: 1, canceled_at: null,
        items: { data: [{ quantity: 1, price: { unit_amount: 5000, recurring: { interval: 'month', interval_count: 1 } } }] },
      }))
      : [];
    return new Response(JSON.stringify({ object: 'list', data, has_more: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = saved; } };
}

const rows = (db: DatabaseSync) => (db.prepare(
  'SELECT snapshot_date, source, active_users, paying_accounts, headcount FROM project_metrics WHERE project_id = ? ORDER BY source',
).all(A) as any[]).map((r) => ({ ...r }));

test('a Stripe sync with 7 paying customers writes paying_accounts and active_users on today\'s stripe row', async () => {
  const { db, env } = await fixture();
  const stripe = stubStripe(7);
  try {
    const r = await syncStripeForUser(env, FOUNDER, A);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.customers, 7);
    assert.ok(stripe.calls.length > 0 && stripe.calls.every((u) => u.startsWith('https://api.stripe.com/')), 'Stripe is the stub');
  } finally { stripe.restore(); }
  assert.deepEqual(rows(db), [{ snapshot_date: today(), source: 'stripe', active_users: 7, paying_accounts: 7, headcount: null }]);
});

test('Grow\'s Customers figure then reads 7, from Stripe', async () => {
  const { env } = await fixture();
  const stripe = stubStripe(7);
  try { await syncStripeForUser(env, FOUNDER, A); } finally { stripe.restore(); }
  const figures = await growFigures({ env, projectId: A, now: Date.now(), href: (slug) => `/grow/${slug}` });
  const customers = figures.find((f) => f.key === 'customers')!;
  // One day of history is `too_little` for a trend; the figure itself is recorded.
  assert.notEqual(customers.state, 'not_recorded', JSON.stringify(customers));
  assert.equal(customers.value, 7);
  assert.equal(customers.as_of, today());
  assert.match(String(customers.source), /stripe/i);
});

test('a same-day manual row keeps its paying_accounts; a second sync updates the stripe row in place', async () => {
  const { db, env } = await fixture();
  db.prepare("INSERT INTO project_metrics (project_id, snapshot_date, paying_accounts, headcount, source) VALUES (?, ?, 3, 4, 'manual')").run(A, today());
  let stripe = stubStripe(7);
  try { await syncStripeForUser(env, FOUNDER, A); } finally { stripe.restore(); }
  stripe = stubStripe(9);
  try { await syncStripeForUser(env, FOUNDER, A); } finally { stripe.restore(); }
  assert.deepEqual(rows(db), [
    { snapshot_date: today(), source: 'manual', active_users: null, paying_accounts: 3, headcount: 4 },
    { snapshot_date: today(), source: 'stripe', active_users: 9, paying_accounts: 9, headcount: null },
  ]);
});
