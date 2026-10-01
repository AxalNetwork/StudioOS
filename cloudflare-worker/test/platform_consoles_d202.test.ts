/**
 * D202 — H17's three consoles on HQ · Platform: Monitoring, Broadcast and
 * Feature flags, served by `GET /api/admin/platform/summary`.
 *
 * WHAT THIS FILE HOLDS THE ROUTE TO, in the order the page draws it:
 *
 *   Monitoring  the dead-letter backlog is BOTH tables summed, and either one
 *               failing makes the whole figure unreadable with the table
 *               named — never half a sum sent as the sum; incidents are the
 *               last seven days, compared through datetime() on both sides.
 *   Broadcast   a channel's state is its own facts; the chat id is reduced to
 *               a boolean in SQL and never reaches the payload; the bot token
 *               and the X client are reported as present or absent, never as
 *               values.
 *   Flags       every switch is read through the predicate the code that
 *               obeys it uses — which is why each test below drives a switch
 *               with the value its predicate disagrees with the others about.
 *               D203 gave one of them an operator half (`platform_switches`,
 *               migration 283) and retired the `flags_available` refusal that
 *               said no such store existed; the store's own behaviour is held
 *               by operator_switches_d203.test.ts.
 *
 * Every table is created from schema_baseline.sql verbatim, for the reason
 * admin_content_platform.test.ts gives: a fixture that invents a schema only
 * confirms its own assumptions. The one table the baseline does not carry,
 * `platform_switches`, is created from its migration file the same way —
 * read off disk, never retyped.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import platform, { INCIDENT_WINDOW_DAYS } from '../src/routes/admin_platform.ts';
import { SWITCH_STATES } from '../src/services/platformSwitches.ts';
import { listSources } from '../src/services/market_intel/registry.ts';
import { CONNECTORS } from '../src/services/dueDiligence.ts';
import {
  loadTrafficByBranch, parseRange, trafficWindow,
} from '../src/services/analyticsReports.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 801;

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

const BASELINE = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8',
);
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

const CONSOLE_TABLES = [
  'dead_letter_queue', 'cf_dlq_mirror', 'status_incidents',
  'telegram_channels', 'telegram_posts', 'x_accounts',
];

/** Migration 283, off disk — the operator switch store post-dates the baseline. */
const SWITCHES_MIGRATION = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/migrations/283_platform_switches.sql'), 'utf8',
);

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  for (const t of ['users', 'super_admins', 'integrations', 'cron_run_history', ...CONSOLE_TABLES]) {
    db.exec(ddl(t));
  }
  db.exec(SWITCHES_MIGRATION);
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

const switchOf = (body: any, key: string) => {
  assert.equal(body.switches?.available, true, `switches unreadable: ${JSON.stringify(body.switches)}`);
  const sw = body.switches.items.find((s: any) => s.key === key);
  assert.ok(sw, `no switch named ${key}`);
  return sw;
};

const tableExists = (db: any, name: string) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

/* ── Monitoring · dead letters ────────────────────────────────────────── */

test('the dead-letter depth is both tables summed, each named', async () => {
  const db = freshDb();
  const legacy = db.prepare("INSERT INTO dead_letter_queue (job_type, last_error) VALUES ('email', 'boom')");
  legacy.run(); legacy.run();
  const mirror = db.prepare("INSERT INTO cf_dlq_mirror (message_id, job_type) VALUES (?, 'email')");
  mirror.run('m1'); mirror.run('m2'); mirror.run('m3');

  const r = await summary(db);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.monitoring.dlq, { available: true, legacy: 2, mirror: 3, total: 5 },
    'the backlog is not the sum of the D1 queue and the Cloudflare Queue mirror');
});

test('either dead-letter table unreadable makes the depth unreadable, names it, and creates nothing', async () => {
  // HALF A SUM IS NOT THE SUM. A total over the one table that answered would
  // understate the backlog by exactly the half nobody could see — and the
  // read must not create the missing table to get a count, which would turn
  // "never set up" into a confident zero.
  for (const [dropped, other] of [['cf_dlq_mirror', 'dead_letter_queue'], ['dead_letter_queue', 'cf_dlq_mirror']]) {
    const db = freshDb();
    // The table that DOES answer holds a row, so a half-sum would read as 1.
    if (other === 'cf_dlq_mirror') db.exec("INSERT INTO cf_dlq_mirror (message_id, job_type) VALUES ('m1', 'email')");
    else db.exec("INSERT INTO dead_letter_queue (job_type) VALUES ('email')");
    db.exec(`DROP TABLE ${dropped}`);

    const r = await summary(db);
    assert.equal(r.status, 200, r.text);
    const dlq = r.body.monitoring.dlq;
    assert.equal(dlq.available, false, `a missing ${dropped} still produced a depth`);
    assert.equal(dlq.total, undefined, `an unreadable backlog was sent as a number (${dropped} missing)`);
    assert.ok(String(dlq.reason).includes(dropped), `the reason does not name ${dropped}: ${dlq.reason}`);
    assert.match(String(dlq.reason), /unknown rather than empty/);
    assert.equal(tableExists(db, dropped), false, `reading the depth created ${dropped}`);
  }
});

/* ── Monitoring · incidents ───────────────────────────────────────────── */

test('incidents count the last seven days, in the format the table is written in', async () => {
  const db = freshDb();
  // Aged with SQLite's own clock, in the format DEFAULT (datetime('now'))
  // writes — the only format the column has ever held.
  const at = (modifier: string) => db.prepare(
    "INSERT INTO status_incidents (title, created_at) VALUES ('t', datetime('now', ?))",
  ).run(modifier);
  at('-1 day');
  at('-167 hours'); // 6 days 23 hours: inside the window by an hour
  at('-8 days');
  at('-30 days');

  const r = await summary(db);
  assert.equal(r.status, 200, r.text);
  const inc = r.body.monitoring.incidents;
  assert.equal(inc.available, true);
  assert.equal(inc.window_days, INCIDENT_WINDOW_DAYS);
  assert.equal(INCIDENT_WINDOW_DAYS, 7, "H17 P5 draws 'Incidents (7d)'");
  assert.equal(inc.count, 2, 'rows outside the seven-day window were counted, or rows inside it were not');
  // A zero here is easy to misread, so the reason travels with the count.
  assert.match(String(inc.basis), /a zero means none was entered, not that nothing went wrong/);
});

test('the incident cutoff goes through datetime() on BOTH sides', () => {
  // WHY THIS ONE IS LEXICAL. The failure it guards is a row stored in ISO
  // form meeting a bare comparison: on the cutoff's own date 'T' sorts above
  // ' ', so an eight-day-old ISO row reads as inside the window. A behavioural
  // test needs a row on the cutoff's date but before it, and at 00:00:00 UTC
  // no such moment exists — so it would fail one second a day. The rows the
  // table actually holds are covered behaviourally above.
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/admin_platform.ts'), 'utf8');
  assert.ok(src.includes("WHERE datetime(created_at) >= datetime('now', ?)"),
    'the incident window no longer normalises the stored value before comparing it');
});

test('an unreadable incident table is unknown, not zero, and is not created', async () => {
  const db = freshDb();
  db.exec('DROP TABLE status_incidents');
  const r = await summary(db);
  assert.equal(r.status, 200, r.text);
  const inc = r.body.monitoring.incidents;
  assert.equal(inc.available, false);
  assert.equal(inc.count, undefined, 'an unreadable incident table reported a count');
  assert.equal(inc.window_days, INCIDENT_WINDOW_DAYS, 'the window is not said with the refusal');
  assert.match(String(inc.reason), /unknown rather than zero/);
  assert.equal(tableExists(db, 'status_incidents'), false, 'the read created the table it could not find');
});

/* ── Broadcast · Telegram ─────────────────────────────────────────────── */

function seedChannels(db: any) {
  const ch = db.prepare(
    `INSERT INTO telegram_channels (id, slug, label, chat_id, audience, enabled)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  ch.run(1, 'founders', 'Founders', '-1001234567890', 'founder', 1);
  ch.run(2, 'lps', 'LPs', null, 'investor', 1);
  ch.run(3, 'advisors', 'Advisors', '', 'advisor', 1);
  ch.run(4, 'old', 'Old channel', '-1009876543210', 'partner', 0);
  const post = db.prepare(
    `INSERT INTO telegram_posts (channel_id, audience, status, body_md, sent_at, created_by)
     VALUES (?, 'founder', ?, 'b', ?, ${SUPER})`,
  );
  post.run(1, 'sent', '2026-09-20 10:00:00');
  post.run(1, 'sent', '2026-09-21 11:30:00');
  post.run(1, 'draft', null);
  post.run(1, 'failed', null);
  post.run(4, 'sent', '2026-08-01 09:00:00');
}

test("each channel's state is its own facts, with what it has actually sent", async () => {
  const db = freshDb();
  seedChannels(db);
  // Disabled AND unbound: the one channel that tells the two orders of the
  // state expression apart. Channel 4 is disabled but bound, so it reads
  // `disabled` whichever test runs first.
  db.prepare(
    `INSERT INTO telegram_channels (id, slug, label, chat_id, audience, enabled)
     VALUES (5, 'shelved', 'Shelved', NULL, 'founder', 0)`,
  ).run();
  const r = await summary(db, { TELEGRAM_BOT_TOKEN: 'set' });
  assert.equal(r.status, 200, r.text);
  const tg = r.body.broadcast.telegram;
  assert.equal(tg.available, true);
  const by = Object.fromEntries(tg.channels.map((c: any) => [c.id, c]));
  assert.equal(by[5].state, 'disabled',
    'a disabled channel with no chat reads as unbound — being switched off is the operator\'s decision and outranks it');
  assert.equal(by[5].chat_bound, false);

  assert.equal(by[1].state, 'ready');
  assert.equal(by[2].state, 'unbound', 'a channel with no chat id reads as ready');
  assert.equal(by[3].state, 'unbound', "an empty-string chat id — the test /send applies — reads as bound");
  assert.equal(by[4].state, 'disabled', 'a disabled channel reads as ready because it has a chat');
  assert.equal(by[4].chat_bound, true, 'disabled and unbound are different facts, and both are kept');

  assert.equal(by[1].sent_count, 2, 'drafts or failures were counted as sent');
  assert.equal(by[1].last_sent_at, '2026-09-21 11:30:00');
  assert.equal(by[2].sent_count, 0, 'a channel that never sent is not a measured zero');
  assert.equal(by[2].last_sent_at, null);
  assert.equal(by[4].sent_count, 1);
});

test('the chat id never leaves the database', async () => {
  // A chat id is no posting right on its own — a bot must hold the token and
  // be a member of the channel — but it addresses a private audience, and
  // nobody reading this summary needs it. The SELECT reduces it to a
  // boolean, so it is not merely stripped on the way out — it is never read.
  const db = freshDb();
  seedChannels(db);
  const r = await summary(db, { TELEGRAM_BOT_TOKEN: 'set' });
  for (const id of ['-1001234567890', '-1009876543210']) {
    assert.ok(!r.text.includes(id), `a chat id (${id}) reached the payload`);
  }
  for (const ch of r.body.broadcast.telegram.channels) {
    assert.ok(!('chat_id' in ch), 'a chat_id key reached the payload');
  }
});

test('the bot token is reported as present or absent, never as a value', async () => {
  const db = freshDb();
  seedChannels(db);
  const none = await summary(db);
  assert.equal(none.body.broadcast.telegram.token_configured, false);

  const token = '123456:TELEGRAM-TOKEN-SENTINEL-do-not-echo';
  const set = await summary(db, { TELEGRAM_BOT_TOKEN: token });
  assert.equal(set.body.broadcast.telegram.token_configured, true);
  assert.ok(!set.text.includes(token), 'the bot token reached the payload');
  assert.ok(!set.text.includes('TELEGRAM-TOKEN-SENTINEL'), 'part of the bot token reached the payload');
});

test('member counts are stated as not recorded, never drawn', async () => {
  const db = freshDb();
  seedChannels(db);
  const tg = (await summary(db)).body.broadcast.telegram;
  assert.equal(tg.members_available, false);
  assert.match(String(tg.members_reason), /never asks Telegram/);
  for (const ch of tg.channels) {
    assert.equal(ch.members, undefined, 'a member count appeared on a channel');
  }
});

test('an unreadable channel table keeps the token fact and sends no channels', async () => {
  const db = freshDb();
  db.exec('DROP TABLE telegram_channels');
  const r = await summary(db, { TELEGRAM_BOT_TOKEN: 'set' });
  assert.equal(r.status, 200, r.text);
  const tg = r.body.broadcast.telegram;
  assert.equal(tg.available, false);
  assert.equal(tg.channels, undefined, 'an unreadable table was sent as an empty channel list');
  assert.equal(tg.token_configured, true, 'the token is a deployment fact and stands whatever the table says');
  assert.match(String(tg.reason), /could not be read/);
});

/* ── Broadcast · X ────────────────────────────────────────────────────── */

test('X is configured only when BOTH halves of the OAuth client are present', async () => {
  const db = freshDb();
  // The rule admin_x.ts applies before it will start an OAuth flow — one
  // predicate, so the console and the flow cannot disagree.
  const cases: Array<[Record<string, string>, boolean]> = [
    [{}, false],
    [{ X_CLIENT_ID: 'id' }, false],
    [{ X_CLIENT_SECRET: 'secret' }, false],
    [{ X_CLIENT_ID: 'id', X_CLIENT_SECRET: 'secret' }, true],
  ];
  for (const [env, want] of cases) {
    const x = (await summary(db, env)).body.broadcast.x;
    assert.equal(x.client_configured, want, `client_configured wrong for ${Object.keys(env).join('+') || 'neither'}`);
  }
});

test('X accounts are counted, and nothing about their tokens is sent', async () => {
  const db = freshDb();
  const acct = db.prepare(
    `INSERT INTO x_accounts (handle, access_token_ct, refresh_token_ct, enabled) VALUES (?, ?, ?, ?)`,
  );
  acct.run('axalvc', 'CIPHERTEXT-SENTINEL-access', 'CIPHERTEXT-SENTINEL-refresh', 1);
  acct.run('axal_eu', 'CIPHERTEXT-SENTINEL-access-2', null, 0);
  const secret = 'X-CLIENT-SECRET-SENTINEL';
  const r = await summary(db, { X_CLIENT_ID: 'id', X_CLIENT_SECRET: secret });
  const x = r.body.broadcast.x;
  assert.equal(x.available, true);
  assert.equal(x.accounts, 2);
  assert.equal(x.enabled_accounts, 1, 'a disabled account was counted as enabled');
  assert.ok(!r.text.includes('CIPHERTEXT-SENTINEL'), 'token ciphertext reached the payload');
  assert.ok(!r.text.includes(secret), 'the X client secret reached the payload');
  assert.ok(!('has_token' in x) && !('token_state' in x), 'a token state was reported');
});

test('an unreadable X table keeps the client fact and sends no count', async () => {
  const db = freshDb();
  db.exec('DROP TABLE x_accounts');
  const x = (await summary(db, { X_CLIENT_ID: 'id', X_CLIENT_SECRET: 's' })).body.broadcast.x;
  assert.equal(x.available, false);
  assert.equal(x.accounts, undefined, 'an unreadable table reported an account count');
  assert.equal(x.client_configured, true);
});

/* ── Feature flags · the switches ─────────────────────────────────────── */

test('the switches are listed in one order, each in a state the page has a tone for', async () => {
  const db = freshDb();
  const r = await summary(db);
  assert.equal(r.status, 200, r.text);
  const items = r.body.switches.items;
  assert.deepEqual(items.map((s: any) => s.key), [
    'eadwyn_off', 'eadwyn_rerank_off', 'ai_budget_trip', 'session_charging',
    'stripe_tax', 'cf_queue', 'market_sources_live', 'diligence_connectors_live',
  ]);
  for (const s of items) {
    assert.ok((SWITCH_STATES as readonly string[]).includes(s.state), `${s.key} is in an unknown state: ${s.state}`);
    // 'operator' since D203: a switch HQ can throw from the product as well as
    // at deploy. Exactly the keys the store admits carry it — asserted in
    // operator_switches_d203.test.ts against OPERATOR_SWITCH_KEYS.
    assert.ok(['deploy', 'runtime', 'operator'].includes(s.set_by), `${s.key} does not say what sets it`);
    assert.ok(typeof s.effect === 'string' && s.effect.length > 10, `${s.key} does not say what "on" does`);
  }
  // A bare deployment with an empty operator store: nothing is thrown.
  for (const s of items) assert.equal(s.state, 'off', `${s.key} reads on with no variable set`);
});

test("Eadwyn's switch follows its own predicate: '1' or 'true', and nothing looser", async () => {
  const db = freshDb();
  // 'yes' is on for Stripe Tax and OFF for Eadwyn — the disagreement a second
  // parser would paper over, so the same value drives both in one deployment.
  const r = await summary(db, { ADVISOR_DISABLED: 'yes', STRIPE_TAX_ENABLED: 'yes' });
  assert.equal(switchOf(r.body, 'eadwyn_off').state, 'off', "'yes' switched Eadwyn off; its reader only honours '1' and 'true'");
  assert.equal(switchOf(r.body, 'stripe_tax').state, 'on', "'yes' left Stripe Tax off; its reader honours it");

  const v2 = await summary(db, { ADVISOR_V2_DISABLED: 'true' });
  assert.equal(switchOf(v2.body, 'eadwyn_off').state, 'on');
  const rr = await summary(db, { ADVISOR_RERANK_DISABLED: '1' });
  assert.equal(switchOf(rr.body, 'eadwyn_rerank_off').state, 'on');
  const rrYes = await summary(db, { ADVISOR_RERANK_DISABLED: 'on' });
  assert.equal(switchOf(rrYes.body, 'eadwyn_rerank_off').state, 'off');
  const taxCase = await summary(db, { STRIPE_TAX_ENABLED: '  ON ' });
  assert.equal(switchOf(taxCase.body, 'stripe_tax').state, 'on', 'Stripe Tax trims and ignores case');
});

test("a market source is live only on 'live'; '1' and 'on' are the stub", async () => {
  const db = freshDb();
  const total = listSources().length;
  assert.ok(total > 1, 'no market-intelligence sources are registered, so this test would pass vacuously');
  for (const v of ['on', '1', 'true']) {
    const sw = switchOf((await summary(db, { MI_FLAG_ARXIV: v })).body, 'market_sources_live');
    assert.equal(sw.state, 'off', `MI_FLAG_ARXIV='${v}' read as live; the source serves its stub`);
    assert.deepEqual(sw.count, { on: 0, of: total });
  }
  const live = switchOf((await summary(db, { MI_FLAG_ARXIV: 'LIVE' })).body, 'market_sources_live');
  assert.equal(live.state, 'on');
  assert.deepEqual(live.count, { on: 1, of: total });
  assert.match(String(live.detail), /arXiv preprints/, 'the live source is not named');
});

test("a diligence connector is on for 1, true, on or yes — the rule its runner uses", async () => {
  const db = freshDb();
  const total = CONNECTORS.length;
  const on = switchOf((await summary(db, { DD_FLAG_GITHUB: 'on' })).body, 'diligence_connectors_live');
  assert.equal(on.state, 'on', "DD_FLAG_GITHUB='on' left the connector off");
  assert.deepEqual(on.count, { on: 1, of: total });
  assert.match(String(on.detail), /GitHub/);
  const off = switchOf((await summary(db, { DD_FLAG_GITHUB: 'enabled' })).body, 'diligence_connectors_live');
  assert.equal(off.state, 'off', "a value the runner does not honour switched a connector on");
});

test('the Cloudflare queue is on only with the flag AND the binding', async () => {
  const db = freshDb();
  const binding = { send: async () => {} };
  const noBinding = switchOf((await summary(db, { USE_CF_QUEUE: 'true' })).body, 'cf_queue');
  assert.equal(noBinding.state, 'off', 'the flag alone read as on, though enqueueJob would fall back to D1');
  const both = switchOf((await summary(db, { USE_CF_QUEUE: 'true', JOB_QUEUE: binding })).body, 'cf_queue');
  assert.equal(both.state, 'on');
  const upper = switchOf((await summary(db, { USE_CF_QUEUE: 'TRUE', JOB_QUEUE: binding })).body, 'cf_queue');
  assert.equal(upper.state, 'off', "'TRUE' read as on; the queue reader compares exactly");
});

test('session charging needs the flag AND a Stripe key, and says which mode it would settle in', async () => {
  const db = freshDb();
  const key = 'sk_test_STRIPE-SENTINEL-do-not-echo';
  const noKey = switchOf((await summary(db, { ADVISOR_CHARGING_ENABLED: '1' })).body, 'session_charging');
  assert.equal(noKey.state, 'off', 'charging read as on with no Stripe key to charge with');
  assert.equal(noKey.detail, undefined);

  const trueWord = switchOf((await summary(db, { ADVISOR_CHARGING_ENABLED: 'true', STRIPE_SECRET_KEY: key })).body, 'session_charging');
  assert.equal(trueWord.state, 'off', "'true' switched charging on; its reader honours '1' only");

  const testMode = await summary(db, { ADVISOR_CHARGING_ENABLED: '1', STRIPE_SECRET_KEY: key });
  const sw = switchOf(testMode.body, 'session_charging');
  assert.equal(sw.state, 'on');
  assert.equal(sw.detail, 'Stripe test mode');
  assert.ok(!testMode.text.includes(key) && !testMode.text.includes('STRIPE-SENTINEL'), 'the Stripe key reached the payload');

  const live = switchOf((await summary(db, {
    ADVISOR_CHARGING_ENABLED: '1', STRIPE_SECRET_KEY: key, ENVIRONMENT: 'production',
  })).body, 'session_charging');
  assert.equal(live.detail, 'Stripe live mode');
});

test('the AI budget trip is read in all four of its answers', async () => {
  const db = freshDb();
  const kvWith = (value: string | null) => ({ get: async () => value, put: async () => {} });

  const noStore = switchOf((await summary(db)).body, 'ai_budget_trip');
  assert.equal(noStore.state, 'off');
  assert.equal(noStore.set_by, 'runtime', 'the router throws this one; no deployment does');
  assert.match(String(noStore.reason), /No spend store is bound/);

  const tripped = switchOf((await summary(db, { TOKENS: kvWith('1') })).body, 'ai_budget_trip');
  assert.equal(tripped.state, 'on', 'the router would refuse every AI call and the console says it is off');
  // D242 — the trip is keyed by month, so it lasts for the rest of the month
  // it measured and not the 35 days its old key did. Re-aimed, not loosened:
  // the reason must still say how long it lasts, and the old length is refused.
  assert.match(String(tripped.reason), /rest of the calendar month/, 'the trip does not say how long it lasts');
  assert.match(String(tripped.reason), /lifts on the 1st/, 'the trip does not say when it ends');
  assert.doesNotMatch(String(tripped.reason), /35 days/, 'the trip still claims the old 35-day life');
  assert.match(String(tripped.reason), /nothing in the product clears it sooner/, 'the reason implies a runtime clear exists');

  const trueWord = switchOf((await summary(db, { AI_SPEND: kvWith('true') })).body, 'ai_budget_trip');
  assert.equal(trueWord.state, 'on');

  const clear = switchOf((await summary(db, { AI_SPEND: kvWith(null) })).body, 'ai_budget_trip');
  assert.equal(clear.state, 'off');
  assert.equal(clear.reason, undefined, 'a clear trip carries a reason meant for another state');

  const throwing = { get: async () => { throw new Error('KV unavailable'); }, put: async () => {} };
  const unknown = switchOf((await summary(db, { AI_SPEND: throwing })).body, 'ai_budget_trip');
  assert.equal(unknown.state, 'unreadable', 'a spend store that did not answer was reported as off');
  assert.match(String(unknown.reason), /fails open/);
});

test('the payload carries switch states, never a variable value or a variable name', async () => {
  const db = freshDb();
  const r = await summary(db, {
    ADVISOR_DISABLED: '1', ADVISOR_RERANK_DISABLED: 'true', STRIPE_TAX_ENABLED: 'yes',
    USE_CF_QUEUE: 'true', JOB_QUEUE: { send: async () => {} },
    MI_FLAG_ARXIV: 'live', DD_FLAG_GITHUB: 'yes',
    ADVISOR_CHARGING_ENABLED: '1', STRIPE_SECRET_KEY: 'sk_live_VALUE-SENTINEL',
    TELEGRAM_BOT_TOKEN: 'TG-VALUE-SENTINEL', X_CLIENT_ID: 'XID-VALUE-SENTINEL', X_CLIENT_SECRET: 'XS-VALUE-SENTINEL',
  });
  assert.equal(r.status, 200, r.text);
  assert.ok(!r.text.includes('VALUE-SENTINEL'), 'a variable value reached the payload');
  for (const name of [
    'ADVISOR_', 'STRIPE_', 'MI_FLAG_', 'DD_FLAG_', 'USE_CF_QUEUE', 'JOB_QUEUE',
    'TELEGRAM_BOT_TOKEN', 'X_CLIENT_', 'AI_SPEND',
  ]) {
    assert.ok(!r.text.includes(name), `a variable name (${name}) reached the payload`);
  }
  // The leak scan admin_content_platform.test.ts runs over the whole payload.
  for (const leak of ['access_token', 'refresh_token', 'api_key', 'secret_', 'credential']) {
    assert.ok(!r.text.includes(leak), `the payload carries a ${leak} field`);
  }
});

/* ── Feature flags · the reason ───────────────────────────────────────── */

test('the flags refusal is gone, not reworded, now the operator store exists (D203)', async () => {
  // D202 corrected this refusal once — it said "what the codebase calls flags
  // is per-user settings", and MI_FLAG_* and DD_FLAG_* are platform switches.
  // D203 retired it: `flags_available: false` said there was no operator store,
  // and migration 283 is one. Nothing on the page read the pair once the
  // switches block could say the same thing switch by switch, so the pair went
  // rather than being reworded into a second copy of that block.
  const r = await summary(freshDb());
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.flags_available, undefined, 'the retired flags pair came back');
  assert.equal(r.body.flags_reason, undefined, 'the retired flags pair came back');
  assert.equal(r.body.flags, undefined, 'a flags list appeared beside the switches');
  assert.doesNotMatch(r.text, /per-user settings/i, 'the sentence D202 found false is back in the payload');
  assert.doesNotMatch(r.text, /no feature-flag store/i, 'the payload still says no operator store exists');
  const eadwyn = switchOf(r.body, 'eadwyn_off');
  assert.equal(eadwyn.writable, true, 'the switch HQ can throw is not marked as one');
  assert.equal(eadwyn.set_by, 'operator');
});

/* ── Isolation ────────────────────────────────────────────────────────── */

test('every console table missing at once takes nothing else down', async () => {
  const db = freshDb();
  for (const t of CONSOLE_TABLES) db.exec(`DROP TABLE ${t}`);
  const r = await summary(db);
  assert.equal(r.status, 200, `the summary failed outright: ${r.text}`);
  assert.equal(r.body.integrations.available, true, 'the keys block was dragged down');
  assert.equal(r.body.jobs.available, true, 'the jobs block was dragged down');
  assert.equal(r.body.monitoring.dlq.available, false);
  assert.equal(r.body.monitoring.incidents.available, false);
  assert.equal(r.body.broadcast.telegram.available, false);
  assert.equal(r.body.broadcast.x.available, false);
  assert.equal(r.body.switches.available, true, 'the switches need no table and should stand');
});

test('a count that comes back null is unreadable, not a zero', async () => {
  // WHY A STUB HERE, in a file that otherwise refuses them. SQLite's COUNT()
  // never returns NULL, so no real table can reach this path — but a driver
  // or a changed query can, and `Number(null)` is 0: the one conversion that
  // would turn "no answer" into a measured nothing. The route claims it
  // refuses null before Number() sees it; only a read that returns null can
  // hold it to that. Everything but the three count reads is the real db.
  const db = freshDb();
  seedChannels(db);
  db.prepare("INSERT INTO x_accounts (handle) VALUES ('axal')").run();
  const real = makeD1(db);
  const nulled = {
    ...real,
    prepare(sql: string) {
      const stmt = real.prepare(sql);
      if (sql.includes('FROM status_incidents')) {
        return { ...stmt, bind: () => ({ ...stmt, first: async () => ({ n: null }) }) };
      }
      if (sql.includes('FROM x_accounts')) {
        return { ...stmt, first: async () => ({ accounts: null, enabled: null }) };
      }
      if (sql.includes('FROM telegram_channels c')) {
        return {
          ...stmt,
          all: async () => ({ results: (await stmt.all()).results.map((row: any) => ({ ...row, sent_count: null })) }),
        };
      }
      return stmt;
    },
  };
  const jwt = await new SignJWT({ user_id: SUPER, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await platform.fetch(
    new Request('http://x/summary', { headers: { Authorization: `Bearer ${jwt}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: nulled } as any,
  );
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.monitoring.incidents.available, false, 'a null incident count read as a number');
  assert.equal(body.monitoring.incidents.count, undefined);
  assert.equal(body.broadcast.x.available, false, 'a null account count read as a number');
  assert.equal(body.broadcast.x.accounts, undefined);
  assert.equal(body.broadcast.telegram.available, false, 'a null sent count read as a number');
  assert.equal(body.broadcast.telegram.channels, undefined);
  // The three stubs were the only change, so everything else still answers.
  assert.equal(body.monitoring.dlq.available, true);
  assert.equal(body.jobs.available, true);
});

/* ── The traffic window the Monitoring rate is divided by ─────────────── */

test('the traffic window is the minutes the AE query was bound to', () => {
  assert.equal(trafficWindow(parseRange('2026-09-01', '2026-09-01')).window_minutes, 1440,
    'a one-day range is not 1440 minutes');
  assert.equal(trafficWindow(parseRange(null, null)).window_minutes, 30 * 24 * 60,
    'the default thirty-day range is not 43200 minutes');
  const w = trafficWindow(parseRange('2026-09-01', '2026-09-18'));
  assert.deepEqual(w.range, { from: '2026-09-01 00:00:00', to: '2026-09-18 23:59:59' });
});

const AE_CREDS = {
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CLOUDFLARE_AE_API_TOKEN: 'unit-test-ae-token',
};

test('the traffic split carries its window whether it answered or not', async () => {
  // A rate needs a window, and an unreadable split still says which window it
  // could not read — so the page never divides by a number it had to guess.
  const range = parseRange('2026-09-01', '2026-09-18');
  const want = trafficWindow(range);

  const unconfigured = await loadTrafficByBranch({} as any, range);
  assert.equal(unconfigured.available, false);
  assert.equal(unconfigured.window_minutes, want.window_minutes, 'the unreadable split lost its window');
  assert.deepEqual(unconfigured.range, want.range);

  const real = globalThis.fetch;
  (globalThis as any).fetch = async () => new Response(JSON.stringify({
    data: [{ branch: 'hq', hits: 1200, avg_latency_ms: 30, p95: 90, errors_5xx: 0 }],
  }), { status: 200 });
  try {
    const ok = await loadTrafficByBranch({ ...AE_CREDS } as any, range);
    assert.equal(ok.available, true);
    assert.equal(ok.window_minutes, want.window_minutes, 'the answered split lost its window');
    assert.deepEqual(ok.range, want.range);
    assert.equal(ok.rows[0].hits, 1200);
  } finally {
    (globalThis as any).fetch = real;
  }
});
