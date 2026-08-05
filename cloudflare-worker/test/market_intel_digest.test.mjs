/**
 * Market-Intel watchlist digest — pure-logic + integration coverage.
 *
 * Loads the real digest.ts source, strips its few imports (which we
 * stub via locals), transpiles with the worker's tsc devDep, and runs
 * the same source bytes that ship to Cloudflare. Same approach as
 * spinout_lab.test.mjs / projects.test.mjs — no new test deps.
 *
 * Coverage
 * --------
 *   1. isDigestWindow — weekly Mon 09:00 UTC, monthly 1st 09:00 UTC,
 *      and negative cases (off-hour, off-minute, wrong DOW, wrong DOM).
 *   2. buildUnsubscribeToken / verifyUnsubscribeToken — round-trip,
 *      tampered token rejected, mismatched user-id rejected, empty
 *      token rejected.
 *   3. sendMarketIntelDigests integration — seeds an in-memory D1 mock
 *      with a watchlist row + monthly composite indexes + citations,
 *      runs the cron at Mon 09:00 UTC, and asserts:
 *        • email is sent with the cadence-period subject
 *        • watchlist row is stamped with last_period_key + last_sent_at
 *          + last_composite ONLY after the email returned ok=true
 *        • a row whose user is paused (Task #32) is skipped entirely
 *        • when the email send fails, the row is NOT stamped (so the
 *          next cron tick can retry)
 *
 * Run with:  node --test cloudflare-worker/test/market_intel_digest.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* Load digest.ts, strip imports, transpile, and pull out the exports */
/* we test. Stubs (sendNotificationEmail, periodKey, ensureSchema)    */
/* are injected as closure locals so the transpiled code references   */
/* them as free variables.                                            */
/* ------------------------------------------------------------------ */
async function loadDigest({ sendNotificationEmail, periodKey, ensureMarketIntelSchema }) {
  const srcPath = resolve(__dirname, '../src/services/market_intel/digest.ts');
  let src = await readFile(srcPath, 'utf8');

  // Strip all top-of-file imports — the helpers they pull in are
  // injected as free variables by the IIFE wrapper below.
  src = src.replace(/^import[^;]+;\s*$/gm, '');

  // Replace bare `export function` / `export async function` with plain
  // `function` so the IIFE can return them by name.
  src = src.replace(/\bexport\s+(async\s+)?function\b/g, '$1function');
  // `export type` / `export interface` lines are stripped by transpile,
  // but defensive replace in case future edits drop the `type`.

  const wrapped = `
    const __mod = (() => {
      ${src}
      return {
        isDigestWindow,
        isoWeekKey,
        cadencePeriodKey,
        buildUnsubscribeToken,
        verifyUnsubscribeToken,
        sendMarketIntelDigests,
      };
    })();
  `;

  const ts = (await import(resolve(__dirname, '../node_modules/typescript/lib/typescript.js'))).default;
  const { outputText } = ts.transpileModule(wrapped, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });

  // Inject the stubs + return the exports map. `crypto` is available
  // as a Node global (Node 20+), so the HMAC code path runs unchanged.
  // Every import digest.ts makes must be injected here by name — the source is
  // string-extracted with its imports stripped, so a call to anything not in
  // this list is a ReferenceError at run time, not a load error. When digest.ts
  // gains an import, add it here. `stripTrailingSlashes` is the real
  // implementation from util/url.ts (three lines, no deps) rather than a stub,
  // so the URL the digest actually builds is the URL under test.
  const stripTrailingSlashes = (s) => {
    let i = s.length;
    while (i > 0 && s.charCodeAt(i - 1) === 47 /* '/' */) i--;
    return i === s.length ? s : s.slice(0, i);
  };
  const factory = new Function(
    'sendNotificationEmail', 'periodKey', 'ensureMarketIntelSchema', 'stripTrailingSlashes',
    `${outputText}; return __mod;`,
  );
  return factory(sendNotificationEmail, periodKey, ensureMarketIntelSchema, stripTrailingSlashes);
}

/* ------------------------------------------------------------------ */
/* Tiny D1-shaped mock. Each call records its sql + bindings so the   */
/* integration test can assert UPDATE order/timing.                   */
/* ------------------------------------------------------------------ */
function makeDB(handlers) {
  const calls = [];
  function prepare(sqlText) {
    let bindings = [];
    return {
      bind(...args) { bindings = args; return this; },
      async all() { calls.push({ kind: 'all', sql: sqlText, bindings }); return await dispatch('all', sqlText, bindings); },
      async first() { calls.push({ kind: 'first', sql: sqlText, bindings }); return await dispatch('first', sqlText, bindings); },
      async run() { calls.push({ kind: 'run', sql: sqlText, bindings }); return await dispatch('run', sqlText, bindings); },
    };
  }
  async function dispatch(kind, sqlText, bindings) {
    const norm = sqlText.replace(/\s+/g, ' ').trim();
    for (const h of handlers) {
      if (h.match.test(norm)) return await h.handler(bindings, { kind, calls });
    }
    throw new Error(`Unhandled SQL [${kind}]: ${norm.slice(0, 120)}`);
  }
  return {
    prepare,
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
    _calls: calls,
  };
}

/* ================================================================== */
/* 1. isDigestWindow                                                   */
/* ================================================================== */
test('isDigestWindow: weekly fires Mon 09:00 UTC only', async () => {
  const { isDigestWindow } = await loadDigest(stubs());
  // 2026-05-11 is a Monday.
  assert.equal(isDigestWindow('weekly', new Date('2026-05-11T09:00:00Z')), true);
  // Wrong hour
  assert.equal(isDigestWindow('weekly', new Date('2026-05-11T08:00:00Z')), false);
  assert.equal(isDigestWindow('weekly', new Date('2026-05-11T10:00:00Z')), false);
  // Wrong minute
  assert.equal(isDigestWindow('weekly', new Date('2026-05-11T09:01:00Z')), false);
  // Tuesday at the right time
  assert.equal(isDigestWindow('weekly', new Date('2026-05-12T09:00:00Z')), false);
  // Sunday at the right time
  assert.equal(isDigestWindow('weekly', new Date('2026-05-10T09:00:00Z')), false);
});

test('isDigestWindow: monthly fires 1st @ 09:00 UTC only', async () => {
  const { isDigestWindow } = await loadDigest(stubs());
  // 2026-06-01 is a Monday — collides with weekly window, both true.
  assert.equal(isDigestWindow('monthly', new Date('2026-06-01T09:00:00Z')), true);
  assert.equal(isDigestWindow('weekly',  new Date('2026-06-01T09:00:00Z')), true);
  // 2nd of month
  assert.equal(isDigestWindow('monthly', new Date('2026-06-02T09:00:00Z')), false);
  // 1st but wrong hour
  assert.equal(isDigestWindow('monthly', new Date('2026-06-01T10:00:00Z')), false);
});

/* ================================================================== */
/* 2. Unsubscribe token round-trip + tamper rejection                  */
/* ================================================================== */
test('buildUnsubscribeToken / verifyUnsubscribeToken: round-trip', async () => {
  const { buildUnsubscribeToken, verifyUnsubscribeToken } = await loadDigest(stubs());
  const env = { SCORING_HMAC_SECRET: 'x'.repeat(64) };
  const tok = await buildUnsubscribeToken(env, 42);
  assert.match(tok, /^[0-9a-f]{64}$/, 'token should be 64-char hex SHA-256');
  assert.equal(await verifyUnsubscribeToken(env, 42, tok), true);
});

test('verifyUnsubscribeToken: rejects tampered token', async () => {
  const { buildUnsubscribeToken, verifyUnsubscribeToken } = await loadDigest(stubs());
  const env = { SCORING_HMAC_SECRET: 'x'.repeat(64) };
  const tok = await buildUnsubscribeToken(env, 42);
  // Flip one hex digit
  const tampered = tok[0] === '0' ? '1' + tok.slice(1) : '0' + tok.slice(1);
  assert.equal(await verifyUnsubscribeToken(env, 42, tampered), false);
});

test('verifyUnsubscribeToken: rejects token issued for a different user', async () => {
  const { buildUnsubscribeToken, verifyUnsubscribeToken } = await loadDigest(stubs());
  const env = { SCORING_HMAC_SECRET: 'x'.repeat(64) };
  const tok = await buildUnsubscribeToken(env, 42);
  // Verifying with userId=43 must fail — guards against link swap.
  assert.equal(await verifyUnsubscribeToken(env, 43, tok), false);
});

test('verifyUnsubscribeToken: rejects empty / wrong-length tokens', async () => {
  const { verifyUnsubscribeToken } = await loadDigest(stubs());
  const env = { SCORING_HMAC_SECRET: 'x'.repeat(64) };
  assert.equal(await verifyUnsubscribeToken(env, 42, ''), false);
  assert.equal(await verifyUnsubscribeToken(env, 42, 'abc'), false);
});

/* ================================================================== */
/* 3. sendMarketIntelDigests integration                              */
/* ================================================================== */
function setupCronEnv({ emailOk = true, paused = false } = {}) {
  const sentEmails = [];
  const fakeSendNotificationEmail = async (_env, to, subject, body, opts) => {
    sentEmails.push({ to, subject, body, html: opts?.html });
    return emailOk;
  };
  // periodKey: '2026-05' for May 2026; not exercised heavily, just
  // needs to return a stable YYYY-MM string.
  const fakePeriodKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const fakeEnsureMarketIntelSchema = async () => {};

  // Mock D1 returns one watchlist row for user 7 in the AI sector,
  // weekly cadence, never sent before, and either paused or not.
  // The watchlist SELECT has a pause-filter clause, so paused users
  // simply yield zero rows.
  const watchRow = {
    id: 11, user_id: 7, sector: 'AI', geo: 'global', cadence: 'weekly',
    last_sent_at: null, last_period_key: null, last_composite: null,
    email: 'pin@axal.vc',
  };
  const stamps = [];

  const handlers = [
    // SELECT watchlist join users — paused vs unpaused branch.
    {
      match: /SELECT w\.id, w\.user_id, w\.sector, w\.geo, w\.cadence,/i,
      handler: async () => ({ results: paused ? [] : [watchRow] }),
    },
    // SELECT composite indexes.
    {
      match: /SELECT sector, period_key, value FROM market_intel_indexes/i,
      handler: async () => ({ results: [
        // current month + prior month for AI
        { sector: 'AI', period_key: '2026-05', value: 72.5 },
        { sector: 'AI', period_key: '2026-04', value: 70.0 },
      ] }),
    },
    // SELECT citations.
    {
      match: /SELECT sector, metric_key, metric_value, ts, citation_url FROM market_intel_rows/i,
      handler: async () => ({ results: [
        { sector: 'AI', metric_key: 'arxiv_papers', metric_value: 142,
          ts: '2026-05-09T12:00:00Z', citation_url: 'https://arxiv.org/abs/2505.0001' },
      ] }),
    },
    // UPDATE watchlist stamp.
    {
      match: /UPDATE market_intel_watchlist SET last_sent_at = \?, last_period_key = \?, last_composite = \? WHERE id = \?/i,
      handler: async (bindings) => {
        stamps.push({
          last_sent_at: bindings[0],
          last_period_key: bindings[1],
          last_composite: bindings[2],
          id: bindings[3],
        });
        return { meta: {} };
      },
    },
  ];

  const env = {
    DB: makeDB(handlers),
    SCORING_HMAC_SECRET: 'x'.repeat(64),
    APP_URL: 'https://app.axal.vc',
    GMAIL_CLIENT_ID: 'fake',
    GMAIL_CLIENT_SECRET: 'fake',
    GMAIL_REFRESH_TOKEN: 'fake',
  };

  return {
    env,
    sentEmails,
    stamps,
    stubs: {
      sendNotificationEmail: fakeSendNotificationEmail,
      periodKey: fakePeriodKey,
      ensureMarketIntelSchema: fakeEnsureMarketIntelSchema,
    },
  };
}

test('sendMarketIntelDigests: success path stamps row + sends html email', async () => {
  const ctx = setupCronEnv({ emailOk: true });
  const { sendMarketIntelDigests } = await loadDigest(ctx.stubs);
  const now = new Date('2026-05-11T09:00:00Z'); // Monday → weekly window
  const result = await sendMarketIntelDigests(ctx.env, now);

  assert.equal(result.users, 1, 'one grouped user');
  assert.equal(result.sent,  1, 'one send recorded');
  assert.equal(result.failed, 0);
  assert.equal(ctx.sentEmails.length, 1);
  const mail = ctx.sentEmails[0];
  assert.equal(mail.to, 'pin@axal.vc');
  assert.match(mail.subject, /weekly sector digest/);
  assert.ok(mail.html && mail.html.includes('Axal Market Intel'),
            'designed HTML body should be present');
  assert.ok(mail.html.includes('arxiv.org'), 'citation link should be in HTML');

  assert.equal(ctx.stamps.length, 1, 'row stamped once after email ok');
  const s = ctx.stamps[0];
  assert.equal(s.id, 11);
  assert.equal(s.last_period_key, '2026-W20', 'ISO week for 2026-05-11 is W20');
  assert.equal(s.last_composite, 72.5);
  assert.match(s.last_sent_at, /^2026-05-11T09:00:00\.000Z$/);
});

test('sendMarketIntelDigests: paused user is skipped — no email, no stamp', async () => {
  const ctx = setupCronEnv({ paused: true });
  const { sendMarketIntelDigests } = await loadDigest(ctx.stubs);
  const now = new Date('2026-05-11T09:00:00Z');
  const result = await sendMarketIntelDigests(ctx.env, now);

  assert.equal(result.scanned, 0, 'paused user yields zero watchlist rows');
  assert.equal(result.sent, 0);
  assert.equal(ctx.sentEmails.length, 0);
  assert.equal(ctx.stamps.length, 0);
});

test('sendMarketIntelDigests: failed email leaves row un-stamped for retry', async () => {
  const ctx = setupCronEnv({ emailOk: false });
  const { sendMarketIntelDigests } = await loadDigest(ctx.stubs);
  const now = new Date('2026-05-11T09:00:00Z');
  const result = await sendMarketIntelDigests(ctx.env, now);

  assert.equal(result.failed, 1, 'failed send counted');
  assert.equal(result.sent, 0, 'sent counter not bumped');
  assert.equal(ctx.sentEmails.length, 1, 'send was attempted');
  assert.equal(ctx.stamps.length, 0,
    'row NOT stamped — next cron tick should retry');
});

test('sendMarketIntelDigests: outside the cron window is a cheap no-op', async () => {
  const ctx = setupCronEnv();
  const { sendMarketIntelDigests } = await loadDigest(ctx.stubs);
  // Tuesday — neither weekly nor monthly window.
  const now = new Date('2026-05-12T09:00:00Z');
  const result = await sendMarketIntelDigests(ctx.env, now);
  assert.deepEqual(result, { scanned: 0, users: 0, sent: 0, rows: 0, failed: 0 });
  assert.equal(ctx.env.DB._calls.length, 0, 'no DB queries when no cadence is in window');
});

/* ------------------------------------------------------------------ */
/* default stubs for the pure-logic loaders that don't need the cron  */
/* ------------------------------------------------------------------ */
function stubs() {
  return {
    sendNotificationEmail: async () => true,
    periodKey: (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
    ensureMarketIntelSchema: async () => {},
  };
}
