/**
 * Task #12 — Stripe payment fulfilment regression (gated, opt-in).
 *
 * Boots the REAL Worker via wrangler `unstable_dev` against a freshly
 * seeded LOCAL D1 (schema.sql + the tier / investor / MI Pro migrations)
 * with `ENVIRONMENT="test"` so `POST /api/billing/stripe/webhook`
 * soft-accepts UNSIGNED JSON events (STRIPE_WEBHOOK_SECRET is left unset,
 * which is the only configuration the route soft-accepts — see the
 * fail-closed guard in routes/billing.ts).
 *
 * The four invariants are all expressed against the MI Pro side table
 * (`mi_pro_subscriptions`) — that's where the trickiest fulfilment logic
 * lives (out-of-order upsert by user_id + subscription_id-scoped cancel):
 *
 *   (1) checkout.session.completed grants the right plan + active status.
 *   (2) a REPLAYED checkout does NOT double-grant — the upsert is keyed on
 *       user_id so a duplicate delivery cannot create a second row.
 *   (3) an OUT-OF-ORDER customer.subscription.created arriving BEFORE
 *       checkout.session.completed keeps `period_end` — the later checkout
 *       event must not clobber the renewal date the subscription set.
 *   (4) customer.subscription.deleted scoped by subscription_id leaves a
 *       CO-EXISTING subscription on the SAME Stripe customer intact.
 *
 * Gating: skipped unless RUN_BILLING_WEBHOOK_TEST is set. A wrangler
 * cold-start plus four CLI seed spawns add ~20-40s and require the
 * wrangler binary + a writable temp dir, so this is opt-in (the same
 * pattern as api_drift_runtime.test.mjs's RUN_RUNTIME_DRIFT gate).
 *
 * Run directly:
 *   RUN_BILLING_WEBHOOK_TEST=1 node --test cloudflare-worker/test/billing_webhook_fulfilment.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = resolve(__dirname, '..'); // cloudflare-worker/
const SQL_DIR = resolve(WORKER_DIR, 'sql');
const ENTRY = resolve(WORKER_DIR, 'src', 'index.ts');
const WRANGLER_BIN = resolve(WORKER_DIR, 'node_modules', '.bin', 'wrangler');
const DB_NAME = 'studioos-test-db';
// Fixed id so the CLI seed/read (via the config file) and the booted Worker
// (via the d1Databases option) resolve to the SAME local sqlite under persistTo.
const DB_ID = '00000000-0000-4000-8000-0000000000c0';

// schema.sql first (base tables incl. users + subscription_plans), then the
// migrations that add the founder-tier / investor columns and the MI Pro side
// table. schema.sql predates these columns so the ALTERs apply cleanly.
const SEED_FILES = [
  resolve(SQL_DIR, 'schema.sql'),
  resolve(SQL_DIR, 'migrations', '011_subscription_tiers.sql'),
  resolve(SQL_DIR, 'migrations', '027_investor_paywall.sql'),
  resolve(SQL_DIR, 'migrations', '103_mi_pro_subscriptions.sql'),
];

/**
 * Config used ONLY by the wrangler CLI for the d1 seed + read commands — it
 * just needs to resolve the DB binding to the local sqlite (by database_id)
 * under persistTo. The booted Worker does NOT use this file; it gets its
 * bindings via unstable_dev OPTIONS instead (see the boot call below), which
 * avoids the temp-dir `main`/node_modules resolution hang.
 */
function writeTestConfig(dir) {
  const cfgPath = join(dir, 'wrangler.test.toml');
  writeFileSync(
    cfgPath,
    [
      'name = "studioos-billing-test"',
      '',
      '[[d1_databases]]',
      'binding = "DB"',
      `database_name = "${DB_NAME}"`,
      `database_id = "${DB_ID}"`,
      '',
    ].join('\n'),
  );
  return cfgPath;
}

function runWrangler(args) {
  try {
    return execFileSync(WRANGLER_BIN, args, {
      cwd: WORKER_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const out = `${e.stdout ?? ''}\n${e.stderr ?? ''}`.trim();
    throw new Error(`wrangler ${args.join(' ')} failed:\n${out}`);
  }
}

function seedFile(cfgPath, persistTo, file) {
  runWrangler([
    'd1', 'execute', DB_NAME,
    '--config', cfgPath,
    '--local', '--persist-to', persistTo,
    '--file', file,
  ]);
}

function parseD1Json(out) {
  const s = out.indexOf('[');
  const e = out.lastIndexOf(']');
  if (s === -1 || e === -1) {
    throw new Error(`no JSON array in wrangler --json output:\n${out.slice(0, 800)}`);
  }
  return JSON.parse(out.slice(s, e + 1));
}

function query(cfgPath, persistTo, sql) {
  const out = runWrangler([
    'd1', 'execute', DB_NAME,
    '--config', cfgPath,
    '--local', '--persist-to', persistTo,
    '--json', '--command', sql,
  ]);
  const parsed = parseD1Json(out);
  return parsed[0]?.results ?? [];
}

// Like query() but for writes (seeding) where we don't care about the result
// payload. The founder-tier / investor webhook branches UPDATE `users` WHERE
// id = ?, so those rows must exist BEFORE the webhook fires (unlike MI Pro,
// which INSERTs ... ON CONFLICT and needs no pre-seeded row).
function execSql(cfgPath, persistTo, sql) {
  runWrangler([
    'd1', 'execute', DB_NAME,
    '--config', cfgPath,
    '--local', '--persist-to', persistTo,
    '--command', sql,
  ]);
}

/* ---------------------------- event factories --------------------------- */

function checkoutEvent({ userId, plan = 'mi_pro_monthly', subscription, customer }) {
  return {
    type: 'checkout.session.completed',
    // kind:'mi' mirrors the real session (billing.ts sets metadata[kind]='mi')
    // and proves the webhook disambiguator routes into the MI Pro branch rather
    // than the founder-tier / investor branches.
    data: { object: { metadata: { kind: 'mi', user_id: String(userId), plan }, customer, subscription } },
  };
}

function subscriptionCreatedEvent({ subId, userId, plan = 'mi_pro_monthly', customer, periodEndUnix, status = 'active' }) {
  return {
    type: 'customer.subscription.created',
    data: {
      object: {
        id: subId,
        metadata: { kind: 'mi', user_id: String(userId), plan },
        customer,
        status,
        current_period_end: periodEndUnix,
      },
    },
  };
}

function subscriptionDeletedEvent({ subId, customer }) {
  return { type: 'customer.subscription.deleted', data: { object: { id: subId, customer } } };
}

// Founder-tier checkout — metadata.kind='tier' routes into the users
// subscription_tier / stripe_* columns (NOT the MI Pro side table).
function tierCheckoutEvent({ userId, tier = 'growth', subscription, customer }) {
  return {
    type: 'checkout.session.completed',
    data: { object: { metadata: { kind: 'tier', user_id: String(userId), tier }, customer, subscription } },
  };
}

// Investor checkout — metadata.kind='investor' routes into the users
// investor_tier / investor_stripe_* columns and sets investor_dealroom_max.
function investorCheckoutEvent({ userId, investorTier = 'professional', subscription, customer }) {
  return {
    type: 'checkout.session.completed',
    data: { object: { metadata: { kind: 'investor', user_id: String(userId), investor_tier: investorTier }, customer, subscription } },
  };
}

// Founder-tier subscription.updated — carries the renewal date; metadata.tier
// echoes the tier so the handler re-aligns subscription_tier + renews_at.
function tierSubscriptionUpdatedEvent({ subId, tier = 'growth', customer, periodEndUnix, status = 'active' }) {
  return {
    type: 'customer.subscription.updated',
    data: { object: { id: subId, metadata: { kind: 'tier', tier }, customer, status, current_period_end: periodEndUnix } },
  };
}

async function postWebhook(worker, event) {
  return worker.fetch('/api/billing/stripe/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
}

/* -------------------------------- the test ------------------------------ */

test('Stripe webhook fulfilment invariants (MI Pro)', { skip: !process.env.RUN_BILLING_WEBHOOK_TEST, timeout: 120000 }, async (t) => {
  let unstable_dev;
  try {
    ({ unstable_dev } = await import('wrangler'));
  } catch {
    t.skip('wrangler unavailable in this environment');
    return;
  }
  if (typeof unstable_dev !== 'function') {
    t.skip('wrangler does not expose unstable_dev');
    return;
  }

  const tmp = mkdtempSync(join(tmpdir(), 'billing-webhook-'));
  // Guarantee temp-dir cleanup on EVERY exit path (seed / boot / query / assert
  // failures included), not just the happy path at the end of the test.
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const persistTo = join(tmp, 'state');
  const cfgPath = writeTestConfig(tmp);

  // Seed the local D1 with the real prod schema + migrations.
  for (const f of SEED_FILES) seedFile(cfgPath, persistTo, f);

  // NOTE: bindings are wired via OPTIONS, not `config`. Passing a `config`
  // that lives in a temp dir makes wrangler resolve `main` / node_modules
  // relative to that dir and hang. The entry is absolute (so bundling finds
  // cloudflare-worker/node_modules) and the D1 binding shares persistTo +
  // database_id with the CLI-seeded sqlite. vars sets ENVIRONMENT=test so the
  // webhook soft-accepts unsigned events and the prod secret guard stands down.
  const worker = await unstable_dev(ENTRY, {
    persistTo,
    local: true,
    ip: '127.0.0.1',
    vars: { ENVIRONMENT: 'test' },
    d1Databases: [{ binding: 'DB', database_name: DB_NAME, database_id: DB_ID }],
    experimental: { disableExperimentalWarning: true },
  });

  // current_period_end is delivered as Unix seconds; the handler stores the
  // ISO string. Pick a fixed future timestamp so the assertion is exact.
  const PERIOD_END_UNIX = 1800000000; // 2027-01-15T08:00:00.000Z
  const PERIOD_END_ISO = new Date(PERIOD_END_UNIX * 1000).toISOString();

  try {
    // (1) checkout grants the plan.
    assert.equal(
      (await postWebhook(worker, checkoutEvent({ userId: 101, subscription: 'sub_grant', customer: 'cus_1' }))).status,
      200,
      'webhook must soft-accept unsigned checkout in ENVIRONMENT=test (got non-200 → ENVIRONMENT/secret misconfig)',
    );

    // (2) replayed checkout must NOT double-grant — send the identical event twice.
    const replay = checkoutEvent({ userId: 102, subscription: 'sub_replay', customer: 'cus_2' });
    assert.equal((await postWebhook(worker, replay)).status, 200);
    assert.equal((await postWebhook(worker, replay)).status, 200);

    // (3) out-of-order: subscription.created (carries period_end) BEFORE checkout.
    assert.equal(
      (await postWebhook(worker, subscriptionCreatedEvent({
        subId: 'sub_ooo', userId: 103, customer: 'cus_3', periodEndUnix: PERIOD_END_UNIX,
      }))).status,
      200,
    );
    assert.equal(
      (await postWebhook(worker, checkoutEvent({ userId: 103, subscription: 'sub_ooo', customer: 'cus_3' }))).status,
      200,
    );

    // (4) two MI Pro subscriptions on the SAME customer; delete only one.
    assert.equal(
      (await postWebhook(worker, checkoutEvent({ userId: 104, subscription: 'sub_keep_a', customer: 'cus_shared' }))).status,
      200,
    );
    assert.equal(
      (await postWebhook(worker, checkoutEvent({ userId: 105, subscription: 'sub_keep_b', customer: 'cus_shared' }))).status,
      200,
    );
    assert.equal(
      (await postWebhook(worker, subscriptionDeletedEvent({ subId: 'sub_keep_a', customer: 'cus_shared' }))).status,
      200,
    );
  } finally {
    // Stop the Worker before reading so miniflare flushes the local sqlite and
    // the CLI reader opens it without contending with the dev server.
    await worker.stop();
  }

  const rows = query(
    cfgPath,
    persistTo,
    'SELECT user_id, status, plan, subscription_id, period_end FROM mi_pro_subscriptions ORDER BY user_id',
  );
  const byUser = Object.fromEntries(rows.map((r) => [Number(r.user_id), r]));

  // (1) right plan granted, active.
  assert.ok(byUser[101], 'checkout must create the MI Pro row');
  assert.equal(byUser[101].status, 'active');
  assert.equal(byUser[101].plan, 'mi_pro_monthly');
  assert.equal(byUser[101].subscription_id, 'sub_grant');

  // (2) replay is idempotent — exactly one row for the user, still active.
  const replayed = rows.filter((r) => Number(r.user_id) === 102);
  assert.equal(replayed.length, 1, 'a replayed checkout must not create a second grant');
  assert.equal(replayed[0].status, 'active');
  assert.equal(replayed[0].subscription_id, 'sub_replay');

  // (3) out-of-order subscription.created period_end survives the later checkout.
  assert.ok(byUser[103], 'out-of-order subscription.created must create the row');
  assert.equal(byUser[103].status, 'active');
  assert.equal(byUser[103].subscription_id, 'sub_ooo');
  assert.equal(
    byUser[103].period_end,
    PERIOD_END_ISO,
    'period_end set by subscription.created must survive the later checkout.session.completed',
  );

  // (4) scoped delete cancels only the targeted subscription.
  assert.equal(byUser[104].status, 'cancelled', 'the deleted subscription must be cancelled');
  assert.equal(
    byUser[105].status,
    'active',
    'a co-existing subscription on the same Stripe customer must stay active',
  );
});

/* -------------------- founder-tier + investor pipes --------------------- */

/**
 * Task #21 — extend the fulfilment regression to the OTHER two paid pipes the
 * same webhook handler fans out to via `metadata.kind`, both of which write to
 * the `users` table (not the MI Pro side table):
 *
 *   kind='tier'     → founder tier  (subscription_tier / subscription_status /
 *                                    stripe_customer_id / stripe_subscription_id)
 *   kind='investor' → investor tier (investor_tier / investor_subscription_status /
 *                                    investor_dealroom_max / investor_stripe_*)
 *
 * Invariants:
 *   (1) a founder-tier checkout grants the tier + active status + stripe ids.
 *   (2) an investor checkout grants the tier + active status + dealroom cap +
 *       stripe ids — including the institutional cap (1_000_000) so a regression
 *       in INVESTOR_QUOTAS routing is caught.
 *   (3) CROSS-PIPE ISOLATION A: one customer with BOTH a founder-tier sub and an
 *       MI Pro sub; deleting the MI Pro sub must NOT touch the founder columns.
 *   (4) CROSS-PIPE ISOLATION B: the mirror — deleting the founder-tier sub must
 *       drop the founder columns to free but leave the co-existing MI Pro row
 *       active.
 *   (5) a founder-tier customer.subscription.updated re-aligns the renewal date
 *       on the tier columns (the created/updated branch, scoped to isTier).
 */
test('Stripe webhook fulfilment invariants (founder tier + investor)', { skip: !process.env.RUN_BILLING_WEBHOOK_TEST, timeout: 120000 }, async (t) => {
  let unstable_dev;
  try {
    ({ unstable_dev } = await import('wrangler'));
  } catch {
    t.skip('wrangler unavailable in this environment');
    return;
  }
  if (typeof unstable_dev !== 'function') {
    t.skip('wrangler does not expose unstable_dev');
    return;
  }

  const tmp = mkdtempSync(join(tmpdir(), 'billing-webhook-tier-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const persistTo = join(tmp, 'state');
  const cfgPath = writeTestConfig(tmp);

  for (const f of SEED_FILES) seedFile(cfgPath, persistTo, f);

  // The tier/investor branches UPDATE users WHERE id = ?, so the rows must
  // exist first. (email + name are NOT NULL; everything else defaults.)
  execSql(
    cfgPath,
    persistTo,
    `INSERT INTO users (id, email, name) VALUES
       (201, 'tier201@test.dev', 'Tier 201'),
       (202, 'inv202@test.dev', 'Investor 202'),
       (203, 'mixA203@test.dev', 'Mix A 203'),
       (204, 'mixB204@test.dev', 'Mix B 204'),
       (205, 'inv205@test.dev', 'Investor 205')`,
  );

  const worker = await unstable_dev(ENTRY, {
    persistTo,
    local: true,
    ip: '127.0.0.1',
    vars: { ENVIRONMENT: 'test' },
    d1Databases: [{ binding: 'DB', database_name: DB_NAME, database_id: DB_ID }],
    experimental: { disableExperimentalWarning: true },
  });

  const PERIOD_END_UNIX = 1800000000; // 2027-01-15T08:00:00.000Z
  const PERIOD_END_ISO = new Date(PERIOD_END_UNIX * 1000).toISOString();
  const ok = (res, msg) => assert.equal(res.status, 200, msg);

  try {
    // (1) founder-tier checkout.
    ok(
      await postWebhook(worker, tierCheckoutEvent({ userId: 201, tier: 'growth', subscription: 'sub_tier_201', customer: 'cus_201' })),
      'webhook must soft-accept unsigned tier checkout in ENVIRONMENT=test',
    );
    // (5) founder-tier subscription.updated sets the renewal date.
    ok(await postWebhook(worker, tierSubscriptionUpdatedEvent({
      subId: 'sub_tier_201', tier: 'growth', customer: 'cus_201', periodEndUnix: PERIOD_END_UNIX,
    })));

    // (2) investor checkout — professional + institutional.
    ok(await postWebhook(worker, investorCheckoutEvent({ userId: 202, investorTier: 'professional', subscription: 'sub_inv_202', customer: 'cus_202' })));
    ok(await postWebhook(worker, investorCheckoutEvent({ userId: 205, investorTier: 'institutional', subscription: 'sub_inv_205', customer: 'cus_205' })));

    // (3) ISOLATION A: user 203 has a founder-tier sub AND an MI Pro sub on the
    // SAME Stripe customer. Delete the MI Pro sub → founder columns must survive.
    ok(await postWebhook(worker, tierCheckoutEvent({ userId: 203, tier: 'studio', subscription: 'sub_tier_A', customer: 'cus_mixA' })));
    ok(await postWebhook(worker, checkoutEvent({ userId: 203, subscription: 'sub_mi_A', customer: 'cus_mixA' })));
    ok(await postWebhook(worker, subscriptionDeletedEvent({ subId: 'sub_mi_A', customer: 'cus_mixA' })));

    // (4) ISOLATION B: the mirror — delete the founder-tier sub → founder columns
    // drop to free, but the co-existing MI Pro row must stay active.
    ok(await postWebhook(worker, tierCheckoutEvent({ userId: 204, tier: 'growth', subscription: 'sub_tier_B', customer: 'cus_mixB' })));
    ok(await postWebhook(worker, checkoutEvent({ userId: 204, subscription: 'sub_mi_B', customer: 'cus_mixB' })));
    ok(await postWebhook(worker, subscriptionDeletedEvent({ subId: 'sub_tier_B', customer: 'cus_mixB' })));
  } finally {
    await worker.stop();
  }

  const users = query(
    cfgPath,
    persistTo,
    `SELECT id, subscription_tier, subscription_status, subscription_renews_at,
            stripe_customer_id, stripe_subscription_id,
            investor_tier, investor_subscription_status, investor_dealroom_max,
            investor_stripe_customer_id, investor_stripe_subscription_id
       FROM users ORDER BY id`,
  );
  const byId = Object.fromEntries(users.map((r) => [Number(r.id), r]));
  const mi = query(
    cfgPath,
    persistTo,
    'SELECT user_id, status, subscription_id FROM mi_pro_subscriptions ORDER BY user_id',
  );
  const miByUser = Object.fromEntries(mi.map((r) => [Number(r.user_id), r]));

  // (1) founder-tier checkout landed in the tier columns.
  assert.equal(byId[201].subscription_tier, 'growth', 'founder-tier checkout must set subscription_tier');
  assert.equal(byId[201].subscription_status, 'active');
  assert.equal(byId[201].stripe_customer_id, 'cus_201');
  assert.equal(byId[201].stripe_subscription_id, 'sub_tier_201');
  // ...and the tier checkout must NOT bleed into the MI Pro side table.
  assert.equal(miByUser[201], undefined, 'a founder-tier checkout must not create an MI Pro row');

  // (5) subscription.updated re-aligned the renewal date on the tier columns.
  assert.equal(
    byId[201].subscription_renews_at,
    PERIOD_END_ISO,
    'founder-tier subscription.updated must set subscription_renews_at',
  );

  // (2) investor checkout landed in the investor columns with the right cap.
  assert.equal(byId[202].investor_tier, 'professional', 'investor checkout must set investor_tier');
  assert.equal(byId[202].investor_subscription_status, 'active');
  assert.equal(Number(byId[202].investor_dealroom_max), 5, 'professional dealroom cap');
  assert.equal(byId[202].investor_stripe_customer_id, 'cus_202');
  assert.equal(byId[202].investor_stripe_subscription_id, 'sub_inv_202');
  assert.equal(miByUser[202], undefined, 'an investor checkout must not create an MI Pro row');
  // institutional grant routes the higher dealroom cap.
  assert.equal(byId[205].investor_tier, 'institutional');
  assert.equal(Number(byId[205].investor_dealroom_max), 1_000_000, 'institutional dealroom cap');

  // (3) ISOLATION A — deleting the MI Pro sub left the founder tier intact.
  assert.equal(miByUser[203].status, 'cancelled', 'the deleted MI Pro sub must be cancelled');
  assert.equal(byId[203].subscription_tier, 'studio', 'deleting an MI Pro sub must NOT clobber the founder tier');
  assert.equal(byId[203].subscription_status, 'active');
  assert.equal(byId[203].stripe_subscription_id, 'sub_tier_A', 'founder stripe_subscription_id must survive an MI Pro deletion');

  // (4) ISOLATION B — deleting the founder-tier sub dropped the tier to free but
  // left the co-existing MI Pro row active.
  assert.equal(byId[204].subscription_tier, 'free', 'deleting the founder-tier sub must drop the tier to free');
  assert.equal(byId[204].subscription_status, 'cancelled');
  assert.equal(byId[204].stripe_subscription_id, null, 'founder stripe_subscription_id must be nulled on tier deletion');
  assert.equal(miByUser[204].status, 'active', 'a co-existing MI Pro sub must survive a founder-tier deletion');
});
