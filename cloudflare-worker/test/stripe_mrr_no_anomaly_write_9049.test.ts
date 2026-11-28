/**
 * #9049 — the Stripe sync records no MRR mismatch flag.
 *
 * The sync used to compare the latest self-reported MRR with Stripe's and,
 * on a >20% difference, insert into `metric_anomalies` — a table no
 * migration declares, whose runtime CREATE SQLite refuses, and that nothing
 * reads. Every flagged sync's insert failed into a swallowed catch. The
 * write and its bootstrap are gone:
 *
 *   - A sync whose Stripe MRR differs from a recent self-reported MRR by far
 *     more than 20% completes, sends no statement naming `metric_anomalies`,
 *     and leaves no such table behind.
 *   - The rest of the sync is unchanged: today's `stripe` project_metrics row
 *     carries Stripe's MRR, the self-reported row is untouched, and
 *     financial_models.assumptions_json takes the Stripe figures.
 *
 * THE DATABASE IS THE BASELINE PLUS EVERY NUMBERED MIGRATION ABOVE THE CUTOFF,
 * IN ORDER. Stripe is a stub over global fetch: no live call is made. Every
 * name is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/stripe_mrr_no_anomaly_write_9049.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { syncStripeForUser } from '../src/integrations/providers/stripe.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 10, COMPANY = 5, A = 1, INTEGRATION = 3;
// The sync stamps today's row and read a 30-day window from the real clock, so the fixture's dates are relative to it.
const today = () => new Date().toISOString().slice(0, 10); // clock-ok: relative
const daysAgo = (n: number) => new Date(Date.now() - n * 86400 * 1000).toISOString().slice(0, 10); // clock-ok: relative

const BUILT = join(mkdtempSync(join(tmpdir(), 'stripe-9049-')), 'built.db');

/** Every SQL text the code under test sends, through prepare, exec or batch. */
function recording(inner: any, sent: string[]) {
  return new Proxy(inner, {
    get(target, prop) {
      const v = target[prop];
      if (prop === 'prepare') return (sql: string) => { sent.push(String(sql)); return v.call(target, sql); };
      if (prop === 'exec') return (sql: string) => { sent.push(String(sql)); return v.call(target, sql); };
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

async function fixture() {
  if (!existsSync(BUILT)) {
    const db = new DatabaseSync(BUILT, { enableDoubleQuotedStringLiterals: true });
    loadSchema(db);
    db.close();
  }
  const copy = join(mkdtempSync(join(tmpdir(), 'stripe-9049-')), 'test.db');
  copyFileSync(BUILT, copy);
  const db = new DatabaseSync(copy, { enableDoubleQuotedStringLiterals: true });
  const sent: string[] = [];
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: recording(d1Over(db), sent) } as any;
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
  sent.length = 0;
  return { db, env, sent };
}

/** Stripe's subscription listings: `customers` paying customers, one $50/month subscription each. */
function stubStripe(customers: number) {
  const saved = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const u = new URL(String(url));
    if (u.hostname !== 'api.stripe.com') throw new Error(`unexpected fetch ${url}`);
    const data = u.searchParams.get('status') === 'active'
      ? Array.from({ length: customers }, (_, i) => ({
        id: `sub_${i}`, customer: `cus_${i}`, status: 'active', created: 1, canceled_at: null,
        items: { data: [{ quantity: 1, price: { unit_amount: 5000, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } } }] },
      }))
      : [];
    return new Response(JSON.stringify({ object: 'list', data, has_more: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = saved; } };
}

test('#9049: a sync whose MRR differs from the self-reported MRR by far more than 20% sends nothing to metric_anomalies', async () => {
  const { db, env, sent } = await fixture();
  // Self-reported 3 days ago: MRR 100000, against Stripe's 7 × $50.
  db.prepare("INSERT INTO project_metrics (project_id, snapshot_date, mrr, source) VALUES (?, ?, 100000, 'manual')").run(A, daysAgo(3));
  const stripe = stubStripe(7);
  let r: any;
  try { r = await syncStripeForUser(env, FOUNDER, A); } finally { stripe.restore(); }
  assert.equal(r.ok, true, JSON.stringify(r));

  // Mutation checked: restore the anomaly insert (or only its bootstrap) → a statement names metric_anomalies.
  assert.ok(sent.length > 0, 'the recorder saw the sync\'s statements');
  assert.deepEqual(sent.filter((s) => /metric_anomalies/i.test(s)), []);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '%metric_anomalies%'").get()!.n, 0);

  // The rest of the sync is unchanged.
  const metrics = (db.prepare('SELECT snapshot_date, source, mrr FROM project_metrics WHERE project_id = ? ORDER BY source').all(A) as any[])
    .map((x) => ({ ...x }));
  assert.equal(metrics.length, 2, JSON.stringify(metrics));
  assert.deepEqual(metrics[0], { snapshot_date: daysAgo(3), source: 'manual', mrr: 100000 });
  assert.equal(metrics[1].source, 'stripe');
  assert.equal(metrics[1].snapshot_date, today());
  assert.equal(metrics[1].mrr, r.mrr);
  assert.ok(Number(r.mrr) > 0 && Math.abs(100000 - Number(r.mrr)) / 100000 > 0.2, `the difference is over 20%: ${r.mrr}`);
  const fm = db.prepare('SELECT assumptions_json FROM financial_models WHERE project_id = ?').get(A) as any;
  const a = JSON.parse(fm.assumptions_json);
  assert.equal(a.mrr, r.mrr);
  assert.equal(a.paying_customers, 7);
  assert.equal(a._sources.mrr, 'stripe');
});
