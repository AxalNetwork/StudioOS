/**
 * D213 — H16's four consoles, summarised on HQ · Platform by
 * `GET /api/admin/platform/summary`: Integration keys, GitHub Sync, Payments
 * catalog and Promo codes.
 *
 * WHAT THIS FILE HOLDS THE ROUTE TO. The canvas draws four consoles and the
 * brief says nothing retires, so Platform does not become those consoles: it
 * reads what each one stores and says what none of them stores. Four rules
 * run through every test below.
 *
 *   1. Each block has three states — readable, empty, unreadable — and one
 *      block failing never empties another or fails the route.
 *   2. The GET alters no schema. A summary that bootstraps the tables it reads
 *      turns "unreadable" into "empty", which is the claim this page is built
 *      not to make (D204's rule for GETs).
 *   3. No value of any key or token reaches the payload. A client id is half a
 *      credential pair and is not sent either.
 *   4. A page load reaches neither Stripe nor GitHub. `getCatalog` calls
 *      Stripe when the mirror is empty, which is why the catalog is read
 *      directly and why a stubbed `fetch` here must count zero.
 *
 * Every table is created from schema_baseline.sql verbatim, for the reason
 * admin_content_platform.test.ts gives: a fixture that invents a schema only
 * confirms its own assumptions. Migration 273 (the mirror's status columns)
 * post-dates the baseline and is read off disk, never retyped.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import platform, {
  PROMO_LIST_LIMIT, STRIPE_WEBHOOK_PATH, WEBHOOK_WINDOW_HOURS,
} from '../src/routes/admin_platform.ts';
import {
  KEY_REMOVE_AUDIT_ACTION, KEY_SET_AUDIT_ACTIONS, MANAGED_PROVIDERS, PROVIDER_ENV_VARS,
} from '../src/services/providerOauthKeys.ts';
import { RECENT_SYNC_LIMIT, SYNC_ERROR_CLIP } from '../src/services/supportQueues.ts';
import { maskPublishableKey, publishableKeyMode } from '../src/services/catalog.ts';
import { promoExpired, promoState } from '../src/services/promos.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 801;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

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
    async batch(x: any[]) { return x; },
  };
}

const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

/** Migration 273, off disk — the mirror's status columns post-date the baseline. */
const M273 = read('cloudflare-worker/sql/migrations/273_ticket_sync_status.sql');

/** The tables the four blocks read, and nothing a block reads is missing from it. */
const D213_TABLES = [
  'provider_oauth_keys', 'admin_audit_log', 'tickets', 'stripe_products',
  'activity_logs', 'promo_codes',
];

function freshDb(opts: { without?: string[]; no273?: boolean } = {}) {
  const without = new Set(opts.without ?? []);
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  for (const t of ['users', 'super_admins', 'integrations', 'cron_run_history', ...D213_TABLES]) {
    if (!without.has(t)) db.exec(ddl(t));
  }
  if (!without.has('tickets') && !opts.no273) db.exec(M273);
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)')
    .run(SUPER, 'admin', 'The Holder', 'holder@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  return db;
}

/** The route, called as the holder, with whatever deployment the test needs. */
async function summary(db: any, extra: Record<string, unknown> = {}) {
  const jwt = await new SignJWT({ user_id: SUPER, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await platform.fetch(
    new Request('http://x/summary', { headers: { Authorization: `Bearer ${jwt}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), ...extra } as any,
  );
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* the status says it */ }
  return { status: res.status, body, text };
}

/** A stamp in SQLite's own `datetime('now', …)` format, as its writers produce it. */
const sqlAgo = (db: any, modifier: string): string =>
  String((db.prepare('SELECT datetime(\'now\', ?) AS t').get(modifier) as any).t);

const schemaOf = (db: any): string => JSON.stringify(
  db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all(),
);

const tableExists = (db: any, name: string) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

// Runs `fn` with the process in another timezone and puts the old one back.
// Node re-reads TZ on assignment, and the body is synchronous, so nothing else
// runs while the zone is changed.
function withZone(zone: string, fn: () => void) {
  const prev = process.env.TZ;
  process.env.TZ = zone;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
}

function audit(db: any, action: string, provider: string, outcome: 'ok' | 'failed', at: string) {
  db.prepare(
    `INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json, exported_at)
     VALUES (?, ?, 'integration_keys', ?, ?)`,
  ).run(SUPER, action, JSON.stringify({ provider, env_vars: ['X'], outcome }), at);
}

const keyOf = (body: any, provider: string) => {
  assert.equal(body.integration_keys?.available, true, JSON.stringify(body.integration_keys));
  const item = body.integration_keys.items.find((i: any) => i.provider_key === provider);
  assert.ok(item, `no managed key named ${provider}`);
  return item;
};

/* ── The whole GET ───────────────────────────────────────────────────── */

test('the summary alters no schema — with every table present, and with none of them', async () => {
  // The tempting way to make a block readable is to create what it reads. On
  // this route that turns "unreadable" into "empty", so the schema must be
  // byte-identical after the GET in both directions: nothing added where the
  // tables are missing, nothing widened where they exist.
  for (const db of [freshDb(), freshDb({ without: D213_TABLES }), freshDb({ no273: true })]) {
    const before = schemaOf(db);
    const r = await summary(db, { STRIPE_SECRET_KEY: 'sk_test_x' });
    assert.equal(r.status, 200, r.text);
    assert.equal(schemaOf(db), before, 'reading the summary changed the schema');
  }
});

test('each block fails on its own: every D213 table missing still answers 200', async () => {
  const db = freshDb({ without: D213_TABLES });
  const r = await summary(db);
  assert.equal(r.status, 200, 'one unreadable console took the whole payload down');
  const b = r.body;
  assert.equal(b.integration_keys.available, true, 'the key list is env facts plus a table; only the table half is unknown');
  assert.equal(b.integration_keys.db_readable, false);
  assert.equal(b.github_sync.window.available, false);
  assert.equal(b.github_sync.recent.available, false);
  assert.equal(b.payments_catalog.catalog.available, false);
  assert.equal(b.payments_catalog.webhook.available, false);
  assert.equal(b.promo_codes.available, false);
  // A block that pre-dates D213 is untouched by the four failing.
  assert.ok(b.integrations, 'the Keys and connections block went missing');
  assert.ok(b.switches, 'the switches block went missing');
});

test('a page load calls neither Stripe nor GitHub', async () => {
  // The configured-and-empty catalog is the case where getCatalog WOULD go to
  // Stripe, and a set GitHub token is the case where the mirror could be
  // probed. Both are here, and fetch must still count zero.
  const db = freshDb();
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; throw new Error('no network in a page load'); }) as any;
  try {
    // getCatalog reaches Stripe for ANY non-empty key, so the value only has to
    // be truthy. It is shaped so a secret scanner cannot read it as a real key:
    // the first draft was key-shaped, and gitleaks refused the commit for it.
    const r = await summary(db, {
      STRIPE_SECRET_KEY: 'sk_live_NETWORK-FIXTURE',
      GITHUB_ACCESS_TOKEN: 'ghp_abcdefghijklmnop', GITHUB_REPO_OWNER: 'acme', GITHUB_REPO_NAME: 'repo',
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.payments_catalog.catalog.available, true);
    assert.deepEqual(r.body.payments_catalog.catalog.products, { all: 0, active: 0 });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls, 0, `the summary made ${calls} network call(s)`);
});

test('no value of any key or token reaches the payload, and no name of one either', async () => {
  const db = freshDb();
  // Key material in the key table: both halves of the pair.
  db.prepare(
    `INSERT INTO provider_oauth_keys (provider_key, client_id, client_secret_enc) VALUES (?, ?, ?)`,
  ).run('hubspot', 'HUB-ID-VALUE-SENTINEL', 'ENC-VALUE-SENTINEL');
  // A ticket whose subject must stay on Support. Its error is GitHub's own
  // message — data, not a sentence this route wrote — so it is kept off the
  // scanned words below ("Bad credentials" is a real one, and would trip them).
  db.prepare(
    `INSERT INTO tickets (title, description, github_sync_status, github_sync_error, github_sync_attempted_at)
     VALUES (?, ?, 'failed', 'Validation Failed', ?)`,
  ).run('TITLE-VALUE-SENTINEL', 'BODY-VALUE-SENTINEL', sqlAgo(db, '-1 hours'));
  db.prepare(
    `INSERT INTO stripe_products (id, name, prices_json) VALUES (?, ?, ?)`,
  ).run('prod_1', 'NAME-VALUE-SENTINEL', JSON.stringify([{ id: 'price_1', active: true }]));
  db.prepare(
    `INSERT INTO promo_codes (id, code, code_normalized, coupon_id) VALUES (?, ?, ?, ?)`,
  ).run('pc1', 'LAUNCH', 'launch', 'COUPON-VALUE-SENTINEL');

  const env: Record<string, string> = {
    GITHUB_ACCESS_TOKEN: 'ghp_VALUE-SENTINEL-TOKEN', GITHUB_REPO_OWNER: 'acme', GITHUB_REPO_NAME: 'repo',
    STRIPE_SECRET_KEY: 'sk_live_VALUE-SENTINEL',
  };
  for (const [provider, pair] of Object.entries(PROVIDER_ENV_VARS)) {
    if (provider === 'hubspot') continue; // held in the table instead
    env[pair.id] = `${provider}-ID-VALUE-SENTINEL`;
    env[pair.secret] = `${provider}-SECRET-VALUE-SENTINEL`;
  }
  const r = await summary(db, env);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.integration_keys.counts.env, MANAGED_PROVIDERS.length - 1);
  assert.equal(r.body.integration_keys.counts.db, 1);

  assert.ok(!r.text.includes('VALUE-SENTINEL'), 'a stored or configured value reached the payload');
  for (const pair of Object.values(PROVIDER_ENV_VARS)) {
    for (const name of [pair.id, pair.secret]) {
      assert.ok(!r.text.includes(name), `the variable name ${name} reached the payload`);
    }
  }
  for (const name of ['GITHUB_', 'STRIPE_', 'client_id', 'client_secret', 'token_preview']) {
    assert.ok(!r.text.includes(name), `${name} reached the payload`);
  }
  // The two existing payload scans (admin_content_platform, platform_consoles_d202)
  // refuse these anywhere; every sentence D213 added has to clear them too.
  for (const leak of ['access_token', 'refresh_token', 'api_key', 'secret_', 'credential']) {
    assert.ok(!r.text.toLowerCase().includes(leak), `"${leak}" appeared in the payload`);
  }
});

/* ── P1 · Integration keys ───────────────────────────────────────────── */

test('P1: every managed key is listed, and a measured absence reads unset', async () => {
  const db = freshDb();
  const r = await summary(db);
  const k = r.body.integration_keys;
  assert.equal(k.available, true);
  assert.equal(k.managed, MANAGED_PROVIDERS.length);
  assert.deepEqual(k.items.map((i: any) => i.provider_key), MANAGED_PROVIDERS);
  assert.equal(k.db_readable, true);
  assert.deepEqual(k.counts, { env: 0, db: 0, unset: MANAGED_PROVIDERS.length, unreadable: 0 });
  for (const item of k.items) {
    // Four fields, and only four: no client id preview, no updated_by.
    assert.deepEqual(Object.keys(item).sort(), ['last_set_at', 'last_set_basis', 'provider_key', 'state']);
    assert.equal(item.state, 'unset');
    assert.equal(item.last_set_at, null);
    assert.equal(item.last_set_basis, null);
  }
  assert.equal(k.notes.length, 2, 'the two keys this list does not hold are not stated');
});

test('P1: a key set as a Worker secret is dated by its last successful console save', async () => {
  const db = freshDb();
  const env = { SLACK_CLIENT_ID: 'id', SLACK_CLIENT_SECRET: 's' };

  // No audit row at all: set at deploy. No date, and the basis says so.
  let slack = keyOf((await summary(db, env)).body, 'slack');
  assert.equal(slack.state, 'env');
  assert.equal(slack.last_set_at, null);
  assert.equal(slack.last_set_basis, 'no_record');

  // A successful push, then a FAILED push later: the refusal is not a set.
  audit(db, 'integration_key_cf_secret_push', 'slack', 'ok', '2026-03-01 09:00:00');
  audit(db, 'integration_key_cf_secret_push', 'slack', 'failed', '2026-03-02 09:00:00');
  slack = keyOf((await summary(db, env)).body, 'slack');
  assert.equal(slack.last_set_at, '2026-03-01 09:00:00', 'a failed save dated the key');
  assert.equal(slack.last_set_basis, 'console_audit');

  // A rotation later still, written as an ISO string: datetime() puts both in
  // one format before MAX compares them, so the rotation wins.
  audit(db, 'integration_key_cf_secret_rotate', 'slack', 'ok', '2026-03-03T08:00:00.000Z');
  slack = keyOf((await summary(db, env)).body, 'slack');
  assert.equal(slack.last_set_at, '2026-03-03 08:00:00');

  // Another provider's save never dates this one.
  audit(db, 'integration_key_cf_secret_push', 'hubspot', 'ok', '2026-04-01 09:00:00');
  slack = keyOf((await summary(db, env)).body, 'slack');
  assert.equal(slack.last_set_at, '2026-03-03 08:00:00');
});

test('P1: a removal after the last save cancels the date; a save after it restores one', async () => {
  const db = freshDb();
  const env = { TELEGRAM_BOT_USERNAME: 'bot', TELEGRAM_BOT_TOKEN: 't' };
  audit(db, 'integration_key_cf_secret_push', 'telegram', 'ok', '2026-03-01 09:00:00');
  audit(db, 'integration_key_cf_secret_delete', 'telegram', 'ok', '2026-03-05 09:00:00');
  let tg = keyOf((await summary(db, env)).body, 'telegram');
  // Present today, removed after its last console save: it was set again some
  // other way, and the save before the removal is not when this key was set.
  assert.equal(tg.state, 'env');
  assert.equal(tg.last_set_at, null, 'a key removed after its last save kept the old date');
  assert.equal(tg.last_set_basis, 'no_record');

  // A removal that FAILED removed nothing, so it cancels nothing.
  const db2 = freshDb();
  audit(db2, 'integration_key_cf_secret_push', 'telegram', 'ok', '2026-03-01 09:00:00');
  audit(db2, 'integration_key_cf_secret_delete', 'telegram', 'failed', '2026-03-05 09:00:00');
  assert.equal(keyOf((await summary(db2, env)).body, 'telegram').last_set_at, '2026-03-01 09:00:00');

  audit(db, 'integration_key_cf_secret_push', 'telegram', 'ok', '2026-03-09 09:00:00');
  tg = keyOf((await summary(db, env)).body, 'telegram');
  assert.equal(tg.last_set_at, '2026-03-09 09:00:00');
  assert.equal(tg.last_set_basis, 'console_audit');
});

test('P1: a key held in the database is dated by its row, and only its row', async () => {
  const db = freshDb();
  db.prepare(
    `INSERT INTO provider_oauth_keys (provider_key, client_id, client_secret_enc, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run('hubspot', 'cid', 'enc', '2026-02-10 12:00:00');
  // An audit row for the same provider must not override the row's own date.
  audit(db, 'integration_key_cf_secret_push', 'hubspot', 'ok', '2026-05-01 09:00:00');
  const hub = keyOf((await summary(db)).body, 'hubspot');
  assert.equal(hub.state, 'db');
  assert.equal(hub.last_set_at, '2026-02-10 12:00:00');
  assert.equal(hub.last_set_basis, 'd1_row');
});

test('P1: a Worker secret wins over a row, as loadOauthCreds decides', async () => {
  const db = freshDb();
  db.prepare(
    `INSERT INTO provider_oauth_keys (provider_key, client_id, client_secret_enc, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run('slack', 'cid', 'enc', '2026-02-10 12:00:00');
  const slack = keyOf((await summary(db, { SLACK_CLIENT_ID: 'id', SLACK_CLIENT_SECRET: 's' })).body, 'slack');
  assert.equal(slack.state, 'env');
  assert.equal(slack.last_set_basis, 'no_record', 'a stale row dated a key that lives as a Worker secret');
  // Half a pair is no key: the id alone does not make it env.
  const half = keyOf((await summary(freshDb(), { SLACK_CLIENT_ID: 'id' })).body, 'slack');
  assert.equal(half.state, 'unset');
});

test('P1: an unreadable key table reads unknown, never unset', async () => {
  const db = freshDb({ without: ['provider_oauth_keys'] });
  const r = await summary(db, { SLACK_CLIENT_ID: 'id', SLACK_CLIENT_SECRET: 's' });
  assert.equal(r.status, 200);
  const k = r.body.integration_keys;
  assert.equal(k.available, true);
  assert.equal(k.db_readable, false);
  assert.match(String(k.db_reason), /could not be read/);
  assert.equal(keyOf(r.body, 'slack').state, 'env', 'a Worker secret is known without the table');
  for (const item of k.items.filter((i: any) => i.provider_key !== 'slack')) {
    assert.equal(item.state, 'unreadable', `${item.provider_key} was drawn as a measured absence`);
  }
  assert.deepEqual(k.counts, { env: 1, db: 0, unset: 0, unreadable: MANAGED_PROVIDERS.length - 1 });
  assert.equal(tableExists(db, 'provider_oauth_keys'), false, 'the read created the key table');
});

test('P1: an unreadable audit log leaves a Worker secret undated, and says why', async () => {
  const db = freshDb({ without: ['admin_audit_log'] });
  const r = await summary(db, { SLACK_CLIENT_ID: 'id', SLACK_CLIENT_SECRET: 's' });
  const k = r.body.integration_keys;
  assert.equal(k.last_set_available, false);
  assert.match(String(k.last_set_reason), /could not be read/);
  const slack = keyOf(r.body, 'slack');
  assert.equal(slack.last_set_at, null);
  assert.equal(slack.last_set_basis, 'unreadable', 'an unread log was reported as no record');
});

test('P1: the audit actions the reader matches are the ones the console writes', () => {
  // The reader filters on action names and on outcome 'ok'. If the console
  // renamed an action, the "last set" read would silently find nothing and
  // every key would read undated — so the two are held equal from the source.
  const route = read('cloudflare-worker/src/routes/admin_integration_keys.ts');
  const written = new Set([...route.matchAll(/action: '(integration_key_[a-z_]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...written].sort(), [...KEY_SET_AUDIT_ACTIONS, KEY_REMOVE_AUDIT_ACTION].sort());
  assert.ok(route.includes("outcome: 'ok'"), "the console no longer writes outcome: 'ok'");
  assert.ok(route.includes("outcome: 'failed'"), 'the console no longer audits a refusal as failed');
});

/* ── P2 · GitHub Sync ────────────────────────────────────────────────── */

test('P2: the repository is named only when both halves are set — never a default', async () => {
  const db = freshDb();
  const cases: Array<[Record<string, string>, { token_set: boolean; repo: string | null; configured: boolean }]> = [
    [{}, { token_set: false, repo: null, configured: false }],
    [{ GITHUB_REPO_OWNER: 'acme' }, { token_set: false, repo: null, configured: false }],
    [{ GITHUB_ACCESS_TOKEN: 't' }, { token_set: true, repo: null, configured: false }],
    [{ GITHUB_REPO_OWNER: 'acme', GITHUB_REPO_NAME: 'repo' }, { token_set: false, repo: 'acme/repo', configured: false }],
    [{ GITHUB_ACCESS_TOKEN: 't', GITHUB_REPO_OWNER: 'acme', GITHUB_REPO_NAME: 'repo' }, { token_set: true, repo: 'acme/repo', configured: true }],
  ];
  for (const [env, want] of cases) {
    const r = await summary(db, env);
    assert.deepEqual(r.body.github_sync.target, want, JSON.stringify(env));
    // The GitHub console displays this default when the variables are unset;
    // the mirror never writes to it, so a summary of the mirror never names it.
    assert.ok(!r.text.includes('AxalNetwork/StudioOS'), 'the console\'s display default reached the summary');
  }
});

test('P2: the window is Support\'s own reader — synced and failed over 24 hours', async () => {
  const db = freshDb();
  const ins = db.prepare(
    `INSERT INTO tickets (title, github_sync_status, github_sync_attempted_at) VALUES ('t', ?, ?)`,
  );
  ins.run('synced', sqlAgo(db, '-1 hours'));
  ins.run('failed', sqlAgo(db, '-2 hours'));
  ins.run('synced', sqlAgo(db, '-30 hours'));
  const w = (await summary(db)).body.github_sync.window;
  assert.equal(w.available, true);
  assert.equal(w.synced, 1, 'an attempt outside the window was counted');
  assert.equal(w.failed, 1);
  assert.equal(w.lag.value, null, 'a mirror lag was drawn from a store that keeps one attempt per ticket');
});

test('P2: the latest attempts, newest first, across both stamp formats', async () => {
  const db = freshDb();
  const ins = db.prepare(
    `INSERT INTO tickets (title, github_issue_number, github_sync_status, github_sync_error, github_sync_attempted_at)
     VALUES ('t', ?, ?, ?, ?)`,
  );
  // Same day: an ISO stamp at 10:00 and a SQL stamp at 11:00. Compared raw the
  // ISO one sorts higher ('T' > ' '); by datetime() the 11:00 one is newer.
  const iso = ins.run(41, 'synced', null, '2026-01-05T10:00:00.000Z').lastInsertRowid;
  const sql = ins.run(null, 'failed', 'x'.repeat(500), '2026-01-05 11:00:00').lastInsertRowid;
  ins.run(null, null, null, null); // never attempted: not listed
  const recent = (await summary(db)).body.github_sync.recent;
  assert.equal(recent.available, true);
  assert.deepEqual(recent.items.map((i: any) => i.ticket_id), [Number(sql), Number(iso)]);
  const failed = recent.items[0];
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.length, SYNC_ERROR_CLIP, 'the error was not clipped');
  assert.equal(failed.issue_number, null);
  assert.equal(recent.items[1].issue_number, 41);
  for (const item of recent.items) {
    assert.deepEqual(Object.keys(item).sort(), ['attempted_at', 'error', 'issue_number', 'status', 'ticket_id']);
  }
});

test('P2: the recent list stops at its limit', async () => {
  const db = freshDb();
  const ins = db.prepare(
    `INSERT INTO tickets (title, github_sync_status, github_sync_attempted_at) VALUES ('t', 'synced', ?)`,
  );
  for (let i = 0; i < RECENT_SYNC_LIMIT + 3; i += 1) ins.run(sqlAgo(db, `-${i + 1} minutes`));
  const recent = (await summary(db)).body.github_sync.recent;
  assert.equal(recent.items.length, RECENT_SYNC_LIMIT);
});

test('P2: without migration 273 both reads say so, and nothing is added to tickets', async () => {
  const db = freshDb({ no273: true });
  const before = schemaOf(db);
  const s = (await summary(db)).body.github_sync;
  assert.equal(s.window.available, false);
  assert.match(String(s.window.reason), /273/);
  assert.equal(s.recent.available, false);
  assert.match(String(s.recent.reason), /273/);
  assert.equal(schemaOf(db), before, 'the read added the mirror\'s columns');
});

/* ── P3 · Payments catalog ───────────────────────────────────────────── */

test('P3: the publishable key checkout is served, masked, with its mode from its own prefix', async () => {
  const db = freshDb();
  let p = (await summary(db)).body.payments_catalog.publishable;
  assert.deepEqual(p, { configured: false, masked: null, mode: null });

  p = (await summary(db, { STRIPE_PUBLISHABLE_KEY: 'pk_live_abcdefghijklmnop' })).body.payments_catalog.publishable;
  assert.deepEqual(p, { configured: true, masked: 'pk_live_••••mnop', mode: 'live' });

  // The KV copy wins, as it does for /api/payments/config.
  const kv = { get: async () => 'pk_test_zyxwvutsrqponm' };
  p = (await summary(db, { RATE_LIMITS: kv, STRIPE_PUBLISHABLE_KEY: 'pk_live_abcdefghijklmnop' }))
    .body.payments_catalog.publishable;
  assert.equal(p.mode, 'test');
  assert.equal(p.masked, 'pk_test_••••ponm');

  // The mode never comes from the SECRET key.
  p = (await summary(db, { STRIPE_PUBLISHABLE_KEY: 'pk_test_abcdefghijkl', STRIPE_SECRET_KEY: 'sk_live_x' }))
    .body.payments_catalog.publishable;
  assert.equal(p.mode, 'test');
});

test('P3: one mask, and a mode that says unknown rather than guessing', () => {
  assert.equal(maskPublishableKey(null), null);
  assert.equal(maskPublishableKey('pk_live_abcdefghijklmnop'), 'pk_live_••••mnop');
  assert.equal(maskPublishableKey('pk_short'), 'pk_s••••');
  assert.equal(publishableKeyMode(null), null);
  assert.equal(publishableKeyMode('pk_live_1'), 'live');
  assert.equal(publishableKeyMode('pk_test_1'), 'test');
  assert.equal(publishableKeyMode('rk_live_1'), 'unknown');
  // The Payments console masks through the same function, not a copy of it.
  const stripeRoute = read('cloudflare-worker/src/routes/admin_stripe.ts');
  assert.ok(stripeRoute.includes('maskPublishableKey(pk)'), 'the Payments console stopped using the shared mask');
  // `pk.slice(-4)` is the mask's own shape. (`pk.slice(0, 8)` also appears there, as
  // the audit row's key prefix on a save — that is not a display mask.)
  assert.ok(!stripeRoute.includes('pk.slice(-4)'), 'the Payments console carries a second mask');
});

test('P3: the catalog counts active products and active prices, and an unparsed list is not zero prices', async () => {
  const db = freshDb();
  const ins = db.prepare(`INSERT INTO stripe_products (id, name, active, prices_json, synced_at) VALUES (?, 'p', ?, ?, ?)`);
  ins.run('prod_a', 1, JSON.stringify([{ id: 'a1', active: true }, { id: 'a2', active: false }]), '2026-01-05T10:00:00.000Z');
  ins.run('prod_b', 0, JSON.stringify([{ id: 'b1', active: true }]), '2026-01-04 09:00:00');
  ins.run('prod_c', 1, 'not json', '2026-01-05 11:00:00');
  ins.run('prod_d', 1, '{}', '2026-01-03 09:00:00');
  const c = (await summary(db)).body.payments_catalog.catalog;
  assert.equal(c.available, true);
  assert.deepEqual(c.products, { all: 4, active: 3 });
  assert.deepEqual(c.prices, { all: 3, active: 2 }, 'an inactive price was counted as active');
  assert.equal(c.unreadable_price_rows, 2, 'a price list that did not parse was read as zero prices');
  // Same day, ISO at 10:00 and SQL at 11:00: the SQL row is the later write.
  assert.equal(c.last_written_at, '2026-01-05 11:00:00');
  assert.match(String(c.sync_basis), /Nothing schedules a sync/);
});

test('P3: an empty mirror is empty; a missing one is unreadable and is not created', async () => {
  const empty = (await summary(freshDb())).body.payments_catalog.catalog;
  assert.deepEqual(
    { available: empty.available, products: empty.products, prices: empty.prices, last: empty.last_written_at },
    { available: true, products: { all: 0, active: 0 }, prices: { all: 0, active: 0 }, last: null },
  );
  const db = freshDb({ without: ['stripe_products'] });
  const gone = (await summary(db, { STRIPE_SECRET_KEY: 'sk_test_x' })).body.payments_catalog.catalog;
  assert.equal(gone.available, false);
  assert.match(String(gone.reason), /could not be read/);
  assert.equal(tableExists(db, 'stripe_products'), false, 'the read created the catalog mirror');
});

test('P3: the webhook path is where billing actually serves it', () => {
  // index.ts mounts billing at /api/billing and billing.ts serves /stripe/webhook.
  // A moved route would leave P3 counting a path nothing is served at.
  const index = read('cloudflare-worker/src/index.ts');
  const billing = read('cloudflare-worker/src/routes/billing.ts');
  assert.ok(index.includes("app.route('/api/billing', billing)"), 'billing is no longer mounted at /api/billing');
  assert.ok(billing.includes("billing.post('/stripe/webhook'"), 'billing no longer serves /stripe/webhook');
  assert.equal(STRIPE_WEBHOOK_PATH, '/api/billing/stripe/webhook');
});

test('P3: webhook deliveries are this endpoint\'s, inside the window, and a missing status is not a refusal', async () => {
  const db = freshDb();
  const ins = db.prepare(
    `INSERT INTO activity_logs (action, endpoint, status_code, latency_ms, created_at) VALUES ('http_post', ?, ?, ?, ?)`,
  );
  ins.run(STRIPE_WEBHOOK_PATH, 400, 30, sqlAgo(db, `-${WEBHOOK_WINDOW_HOURS + 6} hours`)); // outside the window
  ins.run(STRIPE_WEBHOOK_PATH, null, 25, sqlAgo(db, '-3 hours'));   // status never recorded
  ins.run(STRIPE_WEBHOOK_PATH, 500, 90, sqlAgo(db, '-2 hours'));    // refused
  ins.run(STRIPE_WEBHOOK_PATH, 200, 41, sqlAgo(db, '-1 hours'));    // the last delivery
  ins.run('/api/other', 500, 5, sqlAgo(db, '-30 minutes'));          // another endpoint entirely
  const w = (await summary(db)).body.payments_catalog.webhook;
  assert.equal(w.available, true);
  assert.equal(w.window_hours, WEBHOOK_WINDOW_HOURS);
  assert.equal(w.deliveries, 3, 'a delivery outside the window, or to another endpoint, was counted');
  assert.equal(w.not_2xx, 1, 'a delivery with no recorded status was counted as refused');
  assert.equal(w.last.status_code, 200, 'the last delivery is not this endpoint\'s latest');
  assert.equal(w.last.latency_ms, 41);
  assert.deepEqual(Object.keys(w.last).sort(), ['at', 'latency_ms', 'status_code']);
});

test('P3: no delivery is none; an unreadable log is unknown', async () => {
  const none = (await summary(freshDb())).body.payments_catalog.webhook;
  assert.equal(none.available, true);
  assert.equal(none.last, null);
  assert.equal(none.deliveries, 0);
  const gone = (await summary(freshDb({ without: ['activity_logs'] }))).body.payments_catalog.webhook;
  assert.equal(gone.available, false);
  assert.equal(gone.deliveries, undefined, 'an unreadable log was reported as a count');
  assert.match(String(gone.reason), /unknown rather than none/);
});

/* ── P4 · Promo codes ────────────────────────────────────────────────── */

test('P4: one state per code — inactive, then expired, then exhausted, then active', async () => {
  const db = freshDb();
  const ins = db.prepare(
    `INSERT INTO promo_codes (id, code, code_normalized, coupon_id, active, max_redemptions, times_redeemed, expires_at, created_at)
     VALUES (?, ?, ?, 'c', ?, ?, ?, ?, ?)`,
  );
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  ins.run('p1', 'LIVE', 'live', 1, null, 0, null, '2026-01-01 00:00:01');
  ins.run('p2', 'SOON', 'soon', 1, 5, 4, future, '2026-01-01 00:00:02');
  ins.run('p3', 'GONE', 'gone', 1, null, 0, past, '2026-01-01 00:00:03');
  ins.run('p4', 'SQLGONE', 'sqlgone', 1, null, 0, '2020-01-01 00:00:00', '2026-01-01 00:00:04');
  ins.run('p5', 'FULL', 'full', 1, 3, 3, null, '2026-01-01 00:00:05');   // exactly at the cap
  ins.run('p6', 'OVER', 'over', 1, 3, 4, null, '2026-01-01 00:00:06');
  ins.run('p7', 'OFF', 'off', 0, 3, 9, past, '2026-01-01 00:00:07');     // off wins over expired and exhausted
  ins.run('p8', 'LATE', 'late', 1, 3, 9, past, '2026-01-01 00:00:08');   // expired wins over exhausted
  const p = (await summary(db)).body.promo_codes;
  assert.equal(p.available, true);
  const state = Object.fromEntries(p.items.map((i: any) => [i.code, i.state]));
  assert.deepEqual(state, {
    LIVE: 'active', SOON: 'active', GONE: 'expired', SQLGONE: 'expired',
    FULL: 'exhausted', OVER: 'exhausted', OFF: 'inactive', LATE: 'expired',
  });
  assert.deepEqual(p.counts, { active: 2, inactive: 1, expired: 3, exhausted: 2 });
  // Newest first.
  assert.deepEqual(p.items.map((i: any) => i.code).slice(0, 2), ['LATE', 'OFF']);
});

test('P4: terms and product scope, with an unparsed list kept apart from "all products"', async () => {
  const db = freshDb();
  const ins = db.prepare(
    `INSERT INTO promo_codes (id, code, code_normalized, coupon_id, percent_off, amount_off, currency, duration, product_ids_json)
     VALUES (?, ?, ?, 'c', ?, ?, ?, ?, ?)`,
  );
  ins.run('p1', 'PCT', 'pct', 25, null, null, 'once', '[]');
  ins.run('p2', 'AMT', 'amt', null, 500, 'usd', 'repeating', '["prod_a","prod_b"]');
  ins.run('p3', 'BAD', 'bad', 10, null, null, 'forever', 'not json');
  const items = Object.fromEntries((await summary(db)).body.promo_codes.items.map((i: any) => [i.code, i]));
  assert.equal(items.PCT.percent_off, 25);
  assert.equal(items.PCT.product_count, 0, '"every product" was not 0');
  assert.equal(items.AMT.amount_off, 500);
  assert.equal(items.AMT.currency, 'usd');
  assert.equal(items.AMT.duration, 'repeating');
  assert.equal(items.AMT.product_count, 2);
  assert.equal(items.BAD.product_count, null, 'an unparsed product list was read as "every product"');
  assert.deepEqual(Object.keys(items.PCT).sort(), [
    'amount_off', 'code', 'currency', 'duration', 'expires_at', 'max_redemptions',
    'percent_off', 'product_count', 'state', 'times_redeemed',
  ]);
});

test('P4: the list stops at its limit, and the counts cover every code', async () => {
  const db = freshDb();
  const ins = db.prepare(`INSERT INTO promo_codes (id, code, code_normalized, coupon_id) VALUES (?, ?, ?, 'c')`);
  for (let i = 0; i < PROMO_LIST_LIMIT + 5; i += 1) ins.run(`p${i}`, `CODE${i}`, `code${i}`);
  const p = (await summary(db)).body.promo_codes;
  assert.equal(p.items.length, PROMO_LIST_LIMIT);
  assert.equal(p.total, PROMO_LIST_LIMIT + 5);
  assert.equal(p.truncated, true);
  assert.equal(p.counts.active, PROMO_LIST_LIMIT + 5, 'the counts stopped at the listed fifty');
  assert.ok(Array.isArray(p.caveats) && p.caveats.length === 4);
});

test('P4: a missing promo table is unreadable and is not created', async () => {
  const db = freshDb({ without: ['promo_codes'] });
  const p = (await summary(db)).body.promo_codes;
  assert.equal(p.available, false);
  assert.equal(p.total, undefined, 'an unreadable table was reported as a total');
  assert.equal(tableExists(db, 'promo_codes'), false, 'the read created the promo mirror');
});

/* ── One definition of expired, read by three callers ────────────────── */

test('promoExpired: SQL-format stamps are UTC, an unparsed expiry is not expired, and the edge is inclusive', () => {
  const now = Date.parse('2026-06-01T12:00:00.000Z');
  assert.equal(promoExpired(null, now), false);
  assert.equal(promoExpired('', now), false);
  assert.equal(promoExpired('not a date', now), false, 'an unparsed expiry refused the code');
  assert.equal(promoExpired('2026-06-01T12:00:00.000Z', now), true, 'the expiry instant itself is not expired');
  assert.equal(promoExpired('2026-06-01T12:00:01.000Z', now), false);
  assert.equal(promoExpired('2026-06-01 12:00:00', now), true, 'a SQL stamp was not read as UTC');
  assert.equal(promoExpired('2026-06-01 12:00:01', now), false);
  // THE PAIR ABOVE CANNOT FAIL ON THE MACHINES THAT RUN IT. This sandbox and CI
  // both run in UTC, where "read as local time" and "read as UTC" are the same
  // instant — the mutation that drops the `Z` passed it. So the pair is made
  // again under a zone west of UTC and one east of it: west catches the misread
  // on the expiry instant, east catches it one second after. The probe fails
  // first if the runtime ignored the zone, rather than letting the pair pass in
  // UTC and prove nothing.
  for (const zone of ['Etc/GMT+5', 'Asia/Tokyo']) {
    withZone(zone, () => {
      assert.notEqual(
        new Date('2026-06-01T12:00:00').getTime(), Date.parse('2026-06-01T12:00:00Z'),
        `the runtime ignored TZ=${zone}, so this check cannot tell local time from UTC`,
      );
      assert.equal(promoExpired('2026-06-01 12:00:00', now), true, `a SQL stamp was read as local time under ${zone}`);
      assert.equal(promoExpired('2026-06-01 12:00:01', now), false, `a SQL stamp was read as local time under ${zone}`);
    });
  }
  assert.equal(promoState({ active: 1, expires_at: null, max_redemptions: 2 }, 2, now), 'exhausted');
  assert.equal(promoState({ active: 1, expires_at: null, max_redemptions: 2 }, 1, now), 'active');
  assert.equal(promoState({ active: true, expires_at: null, max_redemptions: null }, 99, now), 'active');
  assert.equal(promoState({ active: 0, expires_at: null, max_redemptions: null }, 0, now), 'inactive');
});

test('checkout and Revenue ask promoExpired / promoState, and keep no expiry rule of their own', () => {
  const promos = read('cloudflare-worker/src/services/promos.ts');
  const at = promos.indexOf('export async function validatePromoForProduct');
  assert.ok(at > 0, 'validatePromoForProduct moved');
  const end = promos.indexOf('\n}\n', at);
  const body = promos.slice(at, end);
  assert.ok(body.includes('promoExpired(promo.expires_at'), 'checkout stopped asking promoExpired');
  assert.equal(body.split('expires_at').length - 1, 1, 'checkout carries a second expiry check');
  const revenue = read('cloudflare-worker/src/routes/admin_revenue.ts');
  assert.ok(revenue.includes('promoState(row, redeemed, nowMs)'), 'Revenue stopped counting through promoState');
  assert.ok(!/FROM promo_codes WHERE active = 1/.test(revenue), 'Revenue counts every active code again');
});
