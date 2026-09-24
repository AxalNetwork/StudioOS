/**
 * D250 — a scheduled Telegram or X post is sent, once, by the clock.
 *
 * Real node:sqlite; both consoles' tables are created by their own runtime
 * bootstraps (and migration 290's column by the same code path the worker
 * runs). Telegram and X are stubbed on `fetch`, and every send is counted,
 * so "sent once" and "never sent" are asserted as calls, not as statuses.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/scheduled_posts_d250.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

import { sweepScheduledPosts, STALE_SENDING_MINUTES } from '../src/services/scheduledPosts.ts';
import { sendTelegramPost } from '../src/routes/admin_telegram.ts';
import { sendXPost } from '../src/routes/admin_x.ts';
import { encryptString } from '../src/services/cryptoBox.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const DRAFTER = 11;
const SCHEDULER = 12;
// The tick's minute, and its SQL-format stamp: what the sweep binds.
const TICK = new Date('2026-09-24T10:00:00Z');

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const d1: any = {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v)); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(xs: any[]) { const out = []; for (const s of xs) out.push(await s.run()); return out; },
  };
  return d1;
}

function kv() {
  const m = new Map<string, string>();
  return {
    async get(k: string) { return m.get(k) ?? null; },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
  };
}

async function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, email TEXT, name TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE admin_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER, action TEXT,
      report_type TEXT, format TEXT, filters_json TEXT, storage_key TEXT, download_url TEXT,
      exported_at TEXT DEFAULT (datetime('now')), viewed_user_id INTEGER, conversation_id INTEGER, viewed_at TEXT, actor TEXT);
  `);
  db.prepare("INSERT INTO users (id, role, email) VALUES (?, 'admin', 'drafter@axal.example')").run(DRAFTER);
  db.prepare("INSERT INTO users (id, role, email) VALUES (?, 'admin', 'scheduler@axal.example')").run(SCHEDULER);
  const env: any = {
    JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), RATE_LIMITS: kv(),
    TELEGRAM_BOT_TOKEN: 'test-bot-token', X_CLIENT_ID: 'id', X_CLIENT_SECRET: 'secret',
  };
  // The consoles' own bootstraps build their tables (and 290's column).
  const { ensureTelegramSchema } = await import('../src/services/telegramSchema.ts');
  const { ensureXSchema } = await import('../src/services/xSchema.ts');
  await ensureTelegramSchema(env);
  await ensureXSchema(env);
  db.exec(`DELETE FROM telegram_channels;`);
  db.prepare(`INSERT INTO telegram_channels (id, slug, label, chat_id, audience, enabled) VALUES (1, 'hq', 'HQ', '-100123', 'public', 1)`).run();
  db.prepare(`INSERT INTO telegram_channels (id, slug, label, chat_id, audience, enabled) VALUES (2, 'off', 'Off', '-100999', 'public', 0)`).run();
  const token = await encryptString(env, 'x-access-token');
  db.prepare(`INSERT INTO x_accounts (id, handle, access_token_ct, expires_at, enabled) VALUES (1, 'axal', ?, '2099-01-01T00:00:00.000Z', 1)`).run(token);
  db.prepare(`INSERT INTO x_accounts (id, handle, access_token_ct, expires_at, enabled) VALUES (2, 'axaloff', ?, '2099-01-01T00:00:00.000Z', 0)`).run(token);
  return { db, env };
}

/** Telegram and X, stubbed. Every send is counted. */
function stubProviders() {
  const sends: string[] = [];
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/api\.telegram\.org\/bot[^/]+\/send(Message|Photo|Document)/.test(url)) {
      sends.push('telegram'); n += 1;
      return json({ ok: true, result: { message_id: n, chat: { id: -100123 } } });
    }
    if (/api\.telegram\.org\/bot[^/]+\/getChat/.test(url)) {
      return json({ ok: true, result: { id: -100123, type: 'channel', username: 'axalhq' } });
    }
    if (/api\.twitter\.com\/2\/tweets/.test(url)) {
      sends.push('x'); n += 1;
      return json({ data: { id: `t${n}`, text: 'x' } });
    }
    return new Response('not stubbed', { status: 500 });
  }) as any;
  return { sends, restore: () => { globalThis.fetch = real; } };
}

const iso = (s: string) => new Date(s).toISOString(); // the writer's format since D250
function tgPost(db: InstanceType<typeof DatabaseSync>, o: { status: string; scheduled_for?: string | null; channel?: number; body?: string; updated_at?: string }) {
  const r = db.prepare(
    `INSERT INTO telegram_posts (channel_id, audience, status, body_md, scheduled_for, scheduled_by, created_by, updated_at)
     VALUES (?, 'public', ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
  ).run(o.channel ?? 1, o.status, o.body ?? 'Office hours move to Thursday.', o.scheduled_for ?? null, SCHEDULER, DRAFTER, o.updated_at ?? null);
  return Number(r.lastInsertRowid);
}
function xPost(db: InstanceType<typeof DatabaseSync>, o: { status: string; scheduled_for?: string | null; account?: number; body?: string }) {
  const r = db.prepare(
    `INSERT INTO x_posts (account_id, status, body, scheduled_for, scheduled_by, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(o.account ?? 1, o.status, o.body ?? 'Demo Day is on Thursday.', o.scheduled_for ?? null, SCHEDULER, DRAFTER);
  return Number(r.lastInsertRowid);
}
const row = (db: InstanceType<typeof DatabaseSync>, table: string, id: number) =>
  db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as any;

test('a due post is sent once and marked sent; a post due later is untouched', async () => {
  const { db, env } = await world();
  const s = stubProviders();
  try {
    const due = tgPost(db, { status: 'scheduled', scheduled_for: iso('2026-09-24T09:30:00Z') });
    const later = tgPost(db, { status: 'scheduled', scheduled_for: iso('2026-09-24T11:00:00Z') });
    const xDue = xPost(db, { status: 'scheduled', scheduled_for: iso('2026-09-24T10:00:00Z') });
    const r = await sweepScheduledPosts(env, TICK);
    assert.equal(r.sent, 2);
    assert.deepEqual(s.sends.sort(), ['telegram', 'x']);
    assert.equal(row(db, 'telegram_posts', due).status, 'sent');
    assert.equal(row(db, 'x_posts', xDue).status, 'sent');
    assert.equal(row(db, 'telegram_posts', later).status, 'scheduled', 'a post due later was touched');
    // A second tick finds nothing more to send.
    await sweepScheduledPosts(env, TICK);
    assert.equal(s.sends.length, 2, 'a sent post was sent again');
  } finally { s.restore(); }
});

test('the clock send is recorded as the admin who scheduled it, not who drafted it', async () => {
  const { db, env } = await world();
  const s = stubProviders();
  try {
    tgPost(db, { status: 'scheduled', scheduled_for: iso('2026-09-24T09:30:00Z') });
    await sweepScheduledPosts(env, TICK);
    const a = db.prepare("SELECT admin_user_id, filters_json FROM admin_audit_log WHERE action = 'telegram_post_sent'").get() as any;
    assert.equal(a.admin_user_id, SCHEDULER);
    assert.equal(JSON.parse(a.filters_json).via, 'clock');
  } finally { s.restore(); }
});

test('two overlapping ticks send a due post once', async () => {
  const { db, env } = await world();
  const s = stubProviders();
  try {
    const id = tgPost(db, { status: 'scheduled', scheduled_for: iso('2026-09-24T09:59:00Z') });
    const xid = xPost(db, { status: 'scheduled', scheduled_for: iso('2026-09-24T09:59:00Z') });
    await Promise.all([sweepScheduledPosts(env, TICK), sweepScheduledPosts(env, TICK)]);
    assert.equal(s.sends.filter((x) => x === 'telegram').length, 1, 'two ticks sent the Telegram post twice');
    assert.equal(s.sends.filter((x) => x === 'x').length, 1, 'two ticks sent the X post twice');
    assert.equal(row(db, 'telegram_posts', id).status, 'sent');
    assert.equal(row(db, 'x_posts', xid).status, 'sent');
  } finally { s.restore(); }
});

test('a disabled channel refuses the clock and the click; the clock records why', async () => {
  const { db, env } = await world();
  const s = stubProviders();
  try {
    const sched = tgPost(db, { status: 'scheduled', scheduled_for: iso('2026-09-24T09:00:00Z'), channel: 2 });
    await sweepScheduledPosts(env, TICK);
    assert.equal(row(db, 'telegram_posts', sched).status, 'failed');
    assert.match(row(db, 'telegram_posts', sched).send_error, /disabled/);
    const draft = tgPost(db, { status: 'draft', channel: 2 });
    const click = await sendTelegramPost(env, draft, { actor: { id: SCHEDULER, email: 'scheduler@axal.example' }, mode: 'click' });
    assert.equal(click.status, 409);
    assert.equal(click.body.error, 'channel_disabled');
    assert.equal(row(db, 'telegram_posts', draft).status, 'draft', 'a refused click changed the draft');
    assert.equal(s.sends.length, 0);
    // Not retried every minute: the next tick leaves the failed row alone.
    await sweepScheduledPosts(env, TICK);
    assert.equal(s.sends.length, 0);
  } finally { s.restore(); }
});

test('a disabled X account refuses the clock and the click — X checks it now', async () => {
  const { db, env } = await world();
  const s = stubProviders();
  try {
    const sched = xPost(db, { status: 'scheduled', scheduled_for: iso('2026-09-24T09:00:00Z'), account: 2 });
    await sweepScheduledPosts(env, TICK);
    assert.equal(row(db, 'x_posts', sched).status, 'failed');
    assert.match(row(db, 'x_posts', sched).send_error, /disabled/);
    const draft = xPost(db, { status: 'draft', account: 2 });
    const click = await sendXPost(env, draft, { actor: { id: SCHEDULER, email: 'scheduler@axal.example' }, mode: 'click' });
    assert.equal(click.status, 409);
    assert.equal(click.body.error, 'account_disabled');
    assert.equal(row(db, 'x_posts', draft).status, 'draft');
    assert.equal(s.sends.length, 0, 'a disabled X account posted');
  } finally { s.restore(); }
});

test('ISO with a Z, SQL format and an offset each come due at the right instant; an unreadable time fails with its reason', async () => {
  const { db, env } = await world();
  const s = stubProviders();
  try {
    // All three stand for 10:00 UTC.
    const isoZ = tgPost(db, { status: 'scheduled', scheduled_for: '2026-09-24T10:00:00.000Z' });
    const sqlFmt = tgPost(db, { status: 'scheduled', scheduled_for: '2026-09-24 10:00:00' });
    const offset = tgPost(db, { status: 'scheduled', scheduled_for: '2026-09-24T12:00:00+02:00' });
    const bad = tgPost(db, { status: 'scheduled', scheduled_for: 'Thu Sep 24 2026 10:00' });

    await sweepScheduledPosts(env, new Date('2026-09-24T09:59:00Z'));
    for (const id of [isoZ, sqlFmt, offset]) {
      assert.equal(row(db, 'telegram_posts', id).status, 'scheduled', `row ${row(db, 'telegram_posts', id).scheduled_for} went early`);
    }
    assert.equal(row(db, 'telegram_posts', bad).status, 'failed');
    assert.match(row(db, 'telegram_posts', bad).send_error, /"Thu Sep 24 2026 10:00" could not be read as a time/);

    await sweepScheduledPosts(env, TICK);
    for (const id of [isoZ, sqlFmt, offset]) {
      assert.equal(row(db, 'telegram_posts', id).status, 'sent', `row ${row(db, 'telegram_posts', id).scheduled_for} was not sent at 10:00`);
    }
    assert.equal(s.sends.length, 3);
  } finally { s.restore(); }
});

test('a stale sending row becomes failed and is never re-sent; a fresh one is left alone', async () => {
  const { db, env } = await world();
  const s = stubProviders();
  try {
    const stamp = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
    const stale = tgPost(db, {
      status: 'sending', scheduled_for: iso('2026-09-24T09:00:00Z'),
      updated_at: stamp(TICK.getTime() - (STALE_SENDING_MINUTES + 10) * 60_000),
    });
    const fresh = tgPost(db, {
      status: 'sending', scheduled_for: iso('2026-09-24T09:55:00Z'),
      updated_at: stamp(TICK.getTime() - 5 * 60_000),
    });
    await sweepScheduledPosts(env, TICK);
    assert.equal(row(db, 'telegram_posts', stale).status, 'failed');
    assert.match(row(db, 'telegram_posts', stale).send_error, /never finished\. It is not re-sent automatically/);
    assert.equal(row(db, 'telegram_posts', fresh).status, 'sending', 'a send still in flight was failed');
    await sweepScheduledPosts(env, TICK);
    assert.equal(s.sends.length, 0, 'a stale sending row was sent');
  } finally { s.restore(); }
});

test('a scheduled post the PII lint blocks fails with the reason and is not retried', async () => {
  const { db, env } = await world();
  const s = stubProviders();
  try {
    const id = tgPost(db, { status: 'scheduled', scheduled_for: iso('2026-09-24T09:00:00Z'), body: 'Call me on founder@example.com for the deck.' });
    await sweepScheduledPosts(env, TICK);
    assert.equal(row(db, 'telegram_posts', id).status, 'failed');
    assert.match(row(db, 'telegram_posts', id).send_error, /pii_linter_blocked/);
    await sweepScheduledPosts(env, TICK);
    assert.equal(s.sends.length, 0);
  } finally { s.restore(); }
});

test('X\'s daily cap fails a scheduled post with the reason; it is not retried every minute', async () => {
  const { db, env } = await world();
  env.X_DAILY_CAP = '1';
  const s = stubProviders();
  try {
    db.prepare(`INSERT INTO x_posts (account_id, status, body, sent_at, created_by) VALUES (1, 'sent', 'earlier', datetime('now'), ?)`).run(DRAFTER);
    const id = xPost(db, { status: 'scheduled', scheduled_for: iso('2026-09-24T09:00:00Z') });
    await sweepScheduledPosts(env, TICK);
    assert.equal(row(db, 'x_posts', id).status, 'failed');
    assert.match(row(db, 'x_posts', id).send_error, /daily_cap_reached/);
    await sweepScheduledPosts(env, TICK);
    assert.equal(s.sends.length, 0);
  } finally { s.restore(); }
});

test('the sweep is wired into the scheduled handler under hqCadences, every minute', () => {
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const at = src.indexOf("await import('./services/scheduledPosts')");
  assert.ok(at > 0, 'the scheduled-post sweep is not wired into the cron');
  assert.match(src.slice(at, at + 200), /sweepScheduledPosts\(env, now\)/, 'the sweep is not called with the tick clock');
  const before = src.slice(Math.max(0, at - 700), at);
  assert.match(before, /if \(hqCadences\) \{\s*\n\s*try \{\s*\n\s*const \{ sweepScheduledPosts \} = $/, 'the sweep is not gated on hqCadences, so a branch would run it');
});

test('the schedule and PUT routes store one format and name who scheduled', () => {
  for (const f of ['admin_telegram.ts', 'admin_x.ts']) {
    const src = readFileSync(new URL(`../src/routes/${f}`, import.meta.url), 'utf8');
    assert.match(src, /scheduled_by = \?, send_error = NULL,/, `${f}: the schedule route does not record scheduled_by`);
    assert.match(src, /args\.push\(v \? new Date\(Date\.parse\(v\)\)\.toISOString\(\) : null\)/, `${f}: PUT stores scheduled_for verbatim`);
  }
  const guard = readFileSync(new URL('../../scripts/check-timestamp-comparisons.mjs', import.meta.url), 'utf8');
  assert.match(guard, /const TTL_COLUMN = '\(\?:[^']*\|scheduled_for\)';/, 'scheduled_for left TTL_COLUMN');
});

test('the clock claims only a row still scheduled: a due draft or failed row is not sent by it', async () => {
  // The sweep selects 'scheduled' rows, but an admin can move a row out of
  // 'scheduled' between that read and the claim. The claim's own status
  // conjunct is what stops the clock sending it — deterministically, unlike
  // the overlapping-ticks case, which depends on how two ticks interleave.
  const { db, env } = await world();
  const s = stubProviders();
  const dueBy = '2026-09-24 10:00:00';
  const actor = { id: SCHEDULER, email: 'scheduler@axal.example' };
  try {
    for (const status of ['draft', 'failed']) {
      const tg = tgPost(db, { status, scheduled_for: iso('2026-09-24T09:00:00Z') });
      const x = xPost(db, { status, scheduled_for: iso('2026-09-24T09:00:00Z') });
      const a = await sendTelegramPost(env, tg, { actor, mode: 'clock', dueBy });
      const b = await sendXPost(env, x, { actor, mode: 'clock', dueBy });
      assert.equal(a.body.error, 'already_sending_or_sent', `the clock claimed a ${status} Telegram row`);
      assert.equal(b.body.error, 'already_sending_or_sent', `the clock claimed a ${status} X row`);
      assert.equal(row(db, 'telegram_posts', tg).status, status);
      assert.equal(row(db, 'x_posts', x).status, status);
    }
    assert.equal(s.sends.length, 0, 'the clock sent a row that was no longer scheduled');
  } finally { s.restore(); }
});
