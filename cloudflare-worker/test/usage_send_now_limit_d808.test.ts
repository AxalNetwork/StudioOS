/**
 * D808 (#2250) — Send now is limited: once per five minutes per branch,
 * through RATE_LIMITS, as the licence pull is. The window is written before HQ
 * is called, and a missing or unreadable store refuses without calling HQ.
 *
 * On node:sqlite with the baseline's users and sessions. HQ's RPC and the
 * throttle store are stubbed; the people are placeholders.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/usage_send_now_limit_d808.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import licence from '../src/routes/licence.ts';
import { SEND_NOW_WINDOW_SECONDS, sendUsageReportNow } from '../src/services/usageReport.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'd808-send-now-fixture-only-secret';
const ADMIN = 31;
const MEMBER = 32;
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');

/** A KV stand-in for RATE_LIMITS, recording what was written and in what order. */
function kvStub(log: string[], o: { getThrows?: boolean; putThrows?: boolean } = {}) {
  const m = new Map<string, string>();
  return {
    m,
    get: async (k: string) => { if (o.getThrows) throw new Error('kv down'); return m.get(k) ?? null; },
    put: async (k: string, v: string, opts?: { expirationTtl?: number }) => {
      if (o.putThrows) throw new Error('kv read-only');
      log.push(`put:${opts?.expirationTtl}`); m.set(k, v);
    },
  };
}

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'user_sessions']) db.exec(tableFromBaseline(BASELINE, t));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(ADMIN, 'admin', 'Branch admin', 'branch-admin@example.test');
  u.run(MEMBER, 'founder', 'Member', 'member@example.test');
  const log: string[] = [];
  const env: any = {
    DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', BRANCH_CODE: 'fr', RPC_SECRET: 'fixture-rpc-secret',
    HQ: { reportUsage: async (_c: string, _s: string, period: string) => { log.push(`hq:${period}`); return { ok: true, period, streams: 1 }; } },
  };
  return { env, log };
}

const ERRORS: Record<string, 401 | 403> = { Unauthorized: 401, 'Admin required': 403 };
const app = new Hono<any>();
app.route('/licence', licence);
app.onError((err: any, c) => {
  const s = ERRORS[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

async function press(env: any, userId = ADMIN) {
  const jwt = await new SignJWT({ user_id: userId }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request('/licence/mine/usage/send', { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } }, env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const quietly = async <T>(fn: () => Promise<T>) => {
  const saved = [console.warn, console.error, console.info]; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try { return await fn(); } finally { [console.warn, console.error, console.info] = saved; }
};
const hqCalls = (log: string[]) => log.filter((l) => l.startsWith('hq:')).length;

test('a press calls HQ once; a second press inside five minutes is refused with when to retry, and HQ is not called', async () => {
  const { env, log } = fixture();
  env.RATE_LIMITS = kvStub(log);
  const first = await quietly(() => press(env));
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.called, true);
  assert.equal(first.body.sent, true);
  assert.equal(hqCalls(log), 2, 'the previous and current quarter, as the daily run sends');
  assert.equal(log[0], `put:${SEND_NOW_WINDOW_SECONDS}`, 'the window is written before HQ is called');
  assert.equal(SEND_NOW_WINDOW_SECONDS, 300);

  const second = await quietly(() => press(env));
  assert.equal(second.status, 429);
  assert.equal(second.body.error, 'send_now_refused');
  assert.equal(second.body.called, false);
  assert.ok(second.body.retry_after, 'it says when to try again');
  assert.equal(hqCalls(log), 2, 'the second press did not call HQ');
});

test('with no throttle store, or one that cannot be read or written, a press refuses and HQ is not called', async () => {
  const { env, log } = fixture();
  const none = await quietly(() => press(env));
  assert.equal(none.status, 503);
  assert.match(none.body.reason, /RATE_LIMITS/);

  env.RATE_LIMITS = kvStub(log, { getThrows: true });
  const unreadable = await quietly(() => press(env));
  assert.equal(unreadable.status, 503);
  assert.match(unreadable.body.reason, /could not be read/);

  env.RATE_LIMITS = kvStub(log, { putThrows: true });
  const unwritable = await quietly(() => press(env));
  assert.equal(unwritable.status, 503);
  assert.match(unwritable.body.reason, /could not be recorded/);
  assert.equal(hqCalls(log), 0);
});

test('a window record that cannot be parsed still waits; HQ, a member and HQ\'s own deployment are refused as before', async () => {
  const { env, log } = fixture();
  const kv = kvStub(log);
  kv.m.set('usage_send_now:fr', 'not json');
  env.RATE_LIMITS = kv;
  const r = await quietly(() => press(env));
  assert.equal(r.status, 429);
  assert.equal(hqCalls(log), 0);

  assert.equal((await press(env, MEMBER)).status, 403);
  const hq = await sendUsageReportNow({ ...env, BRANCH_CODE: undefined });
  assert.equal(hq.called, false);
  assert.equal(hqCalls(log), 0);
});
