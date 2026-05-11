/**
 * Task #50 — End-to-end test for the rev-share attribution-window
 * warning cron (`notifyExpiringRevshareWindows` in
 * cloudflare-worker/src/services/partnerDeals.ts).
 *
 * Loads the real partnerDeals.ts source, strips top-level imports,
 * rewrites the two `await import('./notify')` / `await import('./email')`
 * dynamic imports into module-shaped Promises that resolve to injected
 * stubs, transpiles with the worker's tsc devDep, and runs the same
 * source bytes that ship to Cloudflare. Same harness style as
 * market_intel_digest.test.mjs / spinout_lab.test.mjs — no new test
 * deps.
 *
 * Coverage
 * --------
 *   1. Seed three partner_referral_redemptions rows with
 *      redeemed_at = now - 335d / -358d / -364d (= 30 / 7 / 1 days
 *      remaining in the 365-day window) and run the cron once. Assert:
 *        • exactly 3 partner notify() calls fire (one per threshold)
 *        • each call carries the matching threshold_days payload
 *        • each call is `category: 'deals'` on `in_app + email`
 *        • return counters are { warnings_sent: 3,
 *          partner_emails_sent: 3, admin_digest_sent: 1 }
 *   2. Admin digest email content mentions every fired redemption
 *      (line per warning + redeemer label + threshold + close date).
 *   3. Re-running the same cron in the same harness fires zero
 *      additional partner notifies and zero admin digest sends — the
 *      INSERT OR IGNORE / meta.changes === 1 contract holds.
 *
 * Run with:
 *   node --test cloudflare-worker/test/revshare_window_warnings.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* Source loader: read partnerDeals.ts, strip side-effecting top      */
/* imports, rewrite the two dynamic imports to injected stubs, and    */
/* hand back just `notifyExpiringRevshareWindows` so the test focuses */
/* on this one cron.                                                  */
/* ------------------------------------------------------------------ */
async function loadCron({ notifyStub, emailStub }) {
  const srcPath = resolve(__dirname, '../src/services/partnerDeals.ts');
  let src = await readFile(srcPath, 'utf8');

  // Strip `import type` (non-runtime) and runtime imports — the
  // helpers they pull in (`hashEmail`, `INVESTOR_QUOTAS`) are not
  // referenced by `notifyExpiringRevshareWindows`, so a no-op
  // declaration is enough to keep the IIFE compiling.
  src = src.replace(/^import\s+type[^;]+;\s*$/gm, '');
  src = src.replace(/^import[^;]+;\s*$/gm, '');

  // Rewrite the two lazy imports inside the cron so they resolve to
  // module-shaped objects backed by the injected stubs. Source format:
  //   const { notify } = await import('./notify');
  //   const { sendNotificationEmail } = await import('./email');
  // Keep the `await` so the destructuring still sees a resolved value
  // (`const { notify } = await Promise.resolve({...})`).
  src = src.replace(
    /import\(\s*['"]\.\/notify['"]\s*\)/g,
    "Promise.resolve({ notify: __notify })",
  );
  src = src.replace(
    /import\(\s*['"]\.\/email['"]\s*\)/g,
    "Promise.resolve({ sendNotificationEmail: __sendNotificationEmail })",
  );

  // Promote `export async function` → `async function` so the IIFE can
  // close over them and return the one we care about.
  src = src.replace(/\bexport\s+(async\s+)?function\b/g, '$1function');
  // Drop `export const`/`export type`/`export interface` decorations.
  src = src.replace(/\bexport\s+const\b/g, 'const');
  src = src.replace(/\bexport\s+(type|interface)\b/g, '$1');

  // Stub out the unresolved free names that survive the import strip.
  // None of these are reached by notifyExpiringRevshareWindows, but
  // top-level definitions reference their types/values.
  const prelude = `
    const hashEmail = async (s) => s;
    const INVESTOR_QUOTAS = { free: { dealroom_max: 1 }, professional: { dealroom_max: 5 }, institutional: { dealroom_max: 1_000_000 } };
  `;

  const wrapped = `
    const __mod = (() => {
      ${prelude}
      ${src}
      return { notifyExpiringRevshareWindows };
    })();
  `;

  const ts = (await import(resolve(__dirname, '../node_modules/typescript/lib/typescript.js'))).default;
  const { outputText } = ts.transpileModule(wrapped, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });

  const factory = new Function('__notify', '__sendNotificationEmail', `${outputText}; return __mod;`);
  return factory(notifyStub, emailStub);
}

/* ------------------------------------------------------------------ */
/* In-memory D1 mock tailored to the cron's three SQL shapes:         */
/*   (a) CREATE TABLE / CREATE INDEX (schema bootstrap, no-op)         */
/*   (b) SELECT prr.id … due-lookup, parameterised on threshold        */
/*   (c) INSERT OR IGNORE INTO partner_revshare_window_notifications  */
/*   (d) SELECT id, email, name FROM users WHERE role='admin'         */
/*                                                                    */
/* The mock interprets the threshold from the third bind parameter of */
/* the due-lookup so we can answer all three threshold queries with   */
/* the same handler. Notifications are tracked in a Set so the second */
/* invocation observes the dedupe table the way the real D1 would.    */
/* ------------------------------------------------------------------ */
function makeDb({ redemptions, admins }) {
  const notifications = new Set(); // `${redemption_id}:${threshold}`

  const handlers = [
    {
      match: /^CREATE\s+TABLE/i,
      handler: async () => ({ meta: { changes: 0 } }),
    },
    {
      match: /^CREATE\s+INDEX/i,
      handler: async () => ({ meta: { changes: 0 } }),
    },
    {
      match: /SELECT\s+prr\.id\s+AS\s+redemption_id/i,
      handler: async (bindings) => {
        // bindings = [365, 365 - threshold, threshold]
        const threshold = Number(bindings[2]);
        const results = redemptions
          .filter((r) => {
            // Mirror the SQL semantics:
            //   redeemed_at + 365d > now           → window not closed
            //   redeemed_at + (365-threshold) <= now → past warn mark
            const remaining = 365 - r.days_ago;
            const dueForThreshold = remaining > 0 && remaining <= threshold;
            const alreadyNotified = notifications.has(`${r.id}:${threshold}`);
            return dueForThreshold && !alreadyNotified;
          })
          .map((r) => ({
            redemption_id: r.id,
            redeemed_at: new Date(Date.now() - r.days_ago * 86400_000).toISOString(),
            partner_deal_id: r.partner_deal_id,
            partner_user_id: r.partner_user_id,
            partner_email: r.partner_email,
            partner_name: r.partner_name,
            redeemer_name: r.redeemer_name,
            redeemer_email: r.redeemer_email,
            referral_code: r.referral_code,
          }));
        return { results };
      },
    },
    {
      match: /^INSERT\s+OR\s+IGNORE\s+INTO\s+partner_revshare_window_notifications/i,
      handler: async (bindings) => {
        const key = `${bindings[0]}:${bindings[1]}`;
        if (notifications.has(key)) return { meta: { changes: 0 } };
        notifications.add(key);
        return { meta: { changes: 1 } };
      },
    },
    {
      match: /SELECT\s+id,\s+email,\s+name\s+FROM\s+users\s+WHERE\s+role\s*=\s*'admin'/i,
      handler: async () => ({ results: admins }),
    },
  ];

  function prepare(sqlText) {
    let bindings = [];
    return {
      bind(...args) { bindings = args; return this; },
      async run() { return await dispatch(sqlText, bindings); },
      async all() { return await dispatch(sqlText, bindings); },
      async first() {
        const r = await dispatch(sqlText, bindings);
        return r?.results?.[0] ?? null;
      },
    };
  }
  async function dispatch(sqlText, bindings) {
    const norm = sqlText.replace(/\s+/g, ' ').trim();
    for (const h of handlers) {
      if (h.match.test(norm)) return await h.handler(bindings);
    }
    throw new Error(`Unhandled SQL: ${norm.slice(0, 160)}`);
  }
  return { prepare, _notifications: notifications };
}

/* ------------------------------------------------------------------ */
/* Shared fixture: three redemptions whose remaining-days hit each   */
/* of the 30 / 7 / 1 thresholds exactly. days_ago = 365 - threshold. */
/* ------------------------------------------------------------------ */
function fixture() {
  const redemptions = [
    { id: 101, days_ago: 335, partner_deal_id: 1, partner_user_id: 51,
      partner_email: 'partner@axal.vc', partner_name: 'Pat Partner',
      redeemer_name: 'Riley Redeemer 30', redeemer_email: 'riley30@example.com',
      referral_code: 'CODE30' },
    { id: 102, days_ago: 358, partner_deal_id: 1, partner_user_id: 51,
      partner_email: 'partner@axal.vc', partner_name: 'Pat Partner',
      redeemer_name: 'Riley Redeemer 7', redeemer_email: 'riley7@example.com',
      referral_code: 'CODE07' },
    { id: 103, days_ago: 364, partner_deal_id: 1, partner_user_id: 51,
      partner_email: 'partner@axal.vc', partner_name: 'Pat Partner',
      redeemer_name: 'Riley Redeemer 1', redeemer_email: 'riley1@example.com',
      referral_code: 'CODE01' },
  ];
  const admins = [
    { id: 1, email: 'admin@axal.vc', name: 'Admin One' },
  ];
  return { redemptions, admins };
}

function setup() {
  const notifyCalls = [];
  const emailCalls = [];
  const { redemptions, admins } = fixture();
  const db = makeDb({ redemptions, admins });
  // Pre-seed the dedupe table to simulate prior cron sweeps. Without
  // this, a row that's 364d old (=1d remaining) would naturally
  // qualify for ALL three thresholds at once on the first sweep
  // because the SQL filter is `remaining <= threshold`. In production
  // the cron runs daily and the older thresholds were already
  // claimed on prior days, so the realistic "today" sweep is exactly
  // one warning per redemption — the threshold whose mark the row
  // just crossed. We mirror that history here so the assertions read
  // as one notify per threshold (30 → row 101, 7 → row 102, 1 → row 103).
  db._notifications.add('102:30');
  db._notifications.add('103:30');
  db._notifications.add('103:7');
  const env = { DB: db };
  return { env, notifyCalls, emailCalls, db };
}

/* ================================================================== */
/* 1. First-run: one warning per threshold, admin digest mentions all */
/* ================================================================== */
test('notifyExpiringRevshareWindows: fires one warning per threshold + one admin digest', async () => {
  const ctx = setup();
  const { notifyExpiringRevshareWindows } = await loadCron({
    notifyStub: async (_env, opts) => { ctx.notifyCalls.push(opts); },
    emailStub: async (_env, to, subject, body) => {
      ctx.emailCalls.push({ to, subject, body });
      return true;
    },
  });

  const result = await notifyExpiringRevshareWindows(ctx.env);

  assert.deepEqual(
    result,
    { warnings_sent: 3, partner_emails_sent: 3, admin_digest_sent: 1 },
    'one warning per threshold + one admin digest',
  );

  // One partner notify per threshold, in threshold order [30, 7, 1].
  assert.equal(ctx.notifyCalls.length, 3, 'three partner notify() calls');
  const thresholdsFired = ctx.notifyCalls.map((c) => c.payload.threshold_days);
  assert.deepEqual(thresholdsFired, [30, 7, 1],
    'partner warnings fire in 30 → 7 → 1 threshold order');

  for (const call of ctx.notifyCalls) {
    assert.equal(call.userId, 51, 'partner_user_id wired through');
    assert.equal(call.type, 'partner_revshare_window_closing');
    assert.equal(call.category, 'deals');
    assert.deepEqual(call.channels, ['in_app', 'email']);
    assert.equal(call.link, '/partners/portal');
    assert.ok(call.payload.closes_at, 'closes_at populated in payload');
    assert.ok(call.payload.referral_code, 'referral_code populated');
  }

  // Admin digest: exactly one email, mentioning every fired redemption.
  assert.equal(ctx.emailCalls.length, 1, 'one admin digest email');
  const digest = ctx.emailCalls[0];
  assert.equal(digest.to, 'admin@axal.vc');
  assert.match(digest.subject, /3 sent/, 'digest subject reports the count');
  assert.match(digest.body, /Riley Redeemer 30/);
  assert.match(digest.body, /Riley Redeemer 7/);
  assert.match(digest.body, /Riley Redeemer 1/);
  assert.match(digest.body, /CODE30/);
  assert.match(digest.body, /CODE07/);
  assert.match(digest.body, /CODE01/);
  assert.match(digest.body, /30d remaining/);
  assert.match(digest.body, /7d remaining/);
  assert.match(digest.body, /1d remaining/);
});

/* ================================================================== */
/* 2. Idempotency: a second invocation in the same harness is a no-op */
/* ================================================================== */
test('notifyExpiringRevshareWindows: re-running is a no-op (dedupe table holds)', async () => {
  const ctx = setup();
  const notifyCalls = [];
  const emailCalls = [];
  const { notifyExpiringRevshareWindows } = await loadCron({
    notifyStub: async (_env, opts) => { notifyCalls.push(opts); },
    emailStub: async (_env, to, subject, body) => {
      emailCalls.push({ to, subject, body });
      return true;
    },
  });

  // First sweep populates the in-memory dedupe set.
  const first = await notifyExpiringRevshareWindows(ctx.env);
  assert.equal(first.warnings_sent, 3);
  assert.equal(notifyCalls.length, 3);
  assert.equal(emailCalls.length, 1);

  // Second sweep — same data, same harness, same dedupe set. Every
  // INSERT OR IGNORE returns meta.changes === 0, so the cron must not
  // notify partners again, and `fired.length === 0` must skip the
  // admin digest send entirely.
  const second = await notifyExpiringRevshareWindows(ctx.env);
  assert.deepEqual(
    second,
    { warnings_sent: 0, partner_emails_sent: 0, admin_digest_sent: 0 },
    'second invocation: no warnings, no partner emails, no admin digest',
  );
  assert.equal(notifyCalls.length, 3, 'no extra partner notifies on re-run');
  assert.equal(emailCalls.length, 1, 'no extra admin digest emails on re-run');
});
