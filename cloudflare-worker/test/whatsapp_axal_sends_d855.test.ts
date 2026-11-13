/**
 * D855 §5 question 4 (#3733 part 3) — Axal's own WhatsApp number's sends this
 * month, against Meta's 1,000 free service messages.
 *
 *   1. The threshold: 999 is within, 1,000 has used the allowance up, 1,001
 *      is over.
 *   2. The window is the calendar month in UTC, December into January included.
 *   3. The count reads the outbound ledger: Axal's number's keys only, this
 *      month only, a failed send not counted, a lost answer counted.
 *   4. Every send from Axal's number carries a counted key; one that would not
 *      be counted is never sent.
 *   5. The Super Admin's read: counts only, refused to anyone else.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/whatsapp_axal_sends_d855.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import {
  AXAL_FREE_SERVICE_MESSAGES, AXAL_NUMBER_KEY_PREFIXES, allowanceOf, isAxalNumberKey, monthWindow, readAxalSends,
} from '../src/services/channels/axalSends.ts';
import { ADMIN, JWT_SECRET, ME, send, world } from './_channels_fixture.ts';

// ── 1. The threshold ─────────────────────────────────────────────────────

test('1. 999 sends are within the allowance, 1,000 use it up, 1,001 are over', () => {
  assert.equal(AXAL_FREE_SERVICE_MESSAGES, 1000);
  assert.deepEqual(allowanceOf('2026-11', 999), { month: '2026-11', sent: 999, free: 1000, remaining: 1, state: 'within' });
  assert.deepEqual(allowanceOf('2026-11', 1000), { month: '2026-11', sent: 1000, free: 1000, remaining: 0, state: 'used_up' });
  assert.deepEqual(allowanceOf('2026-11', 1001), { month: '2026-11', sent: 1001, free: 1000, remaining: 0, state: 'over' });
  assert.equal(allowanceOf('2026-11', 0).state, 'within');
});

// ── 2. The window ────────────────────────────────────────────────────────

test('2. the window is the calendar month in UTC', () => {
  assert.deepEqual(monthWindow(new Date('2026-11-01T00:00:00Z')), { month: '2026-11', from: '2026-11-01 00:00:00', to: '2026-12-01 00:00:00' });
  assert.deepEqual(monthWindow(new Date('2026-12-31T23:59:59Z')), { month: '2026-12', from: '2026-12-01 00:00:00', to: '2027-01-01 00:00:00' });
});

// ── 3. The count ─────────────────────────────────────────────────────────

let seq = 0;
function sent(db: any, o: { key: string; at: string; status?: string; provider?: string; thread?: number | null }) {
  seq += 1;
  db.prepare(`INSERT INTO channel_outbound (uid, provider, user_id, thread_id, client_key, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(`out-${seq}`, o.provider ?? 'whatsapp', ME, o.thread ?? null, o.key, o.status ?? 'submitted', o.at);
}

test('3. the count reads Axal\'s number\'s sends this month: failed ones out, lost answers in, members\' own sends out', async () => {
  const { env, db } = await world();
  const NOV = '2026-11-14 09:00:00';
  sent(db, { key: 'wblink:a', at: NOV });
  sent(db, { key: 'wbstop:b', at: NOV, status: 'delivered' });
  sent(db, { key: 'wbcapture:c', at: NOV, status: 'read' });
  sent(db, { key: 'wbcapture-saved:d', at: NOV, status: 'pending' });
  sent(db, { key: 'wbunsupported:e', at: '2026-11-01 00:00:00' });
  // Not counted: failed, another month, a member's own number, Telegram.
  sent(db, { key: 'wblink:f', at: NOV, status: 'failed' });
  sent(db, { key: 'wblink:g', at: '2026-10-31 23:59:59' });
  sent(db, { key: 'wblink:h', at: '2026-12-01 00:00:00' });
  sent(db, { key: 'composer-uuid-1', at: NOV });
  sent(db, { key: 'consent:thread:1', at: NOV });
  sent(db, { key: 'wblink:i', at: NOV, provider: 'telegram' });
  assert.deepEqual(await readAxalSends(env, new Date('2026-11-20T12:00:00Z')),
    { month: '2026-11', sent: 5, free: 1000, remaining: 995, state: 'within' });
});

test('3. the statement counts exactly the listed prefixes', () => {
  const src = readFileSync('cloudflare-worker/src/services/channels/axalSends.ts', 'utf8');
  const inSql = [...src.matchAll(/client_key LIKE '([^']+)%'/g)].map((m) => m[1]);
  assert.deepEqual(inSql, [...AXAL_NUMBER_KEY_PREFIXES]);
  assert.ok(Object.isFrozen(AXAL_NUMBER_KEY_PREFIXES));
});

// ── 4. Every send is counted ─────────────────────────────────────────────

test('4. every send from Axal\'s number carries a counted key, and an uncounted one is not sent', () => {
  const src = readFileSync('cloudflare-worker/src/routes/channels.ts', 'utf8');
  const keys = [...src.matchAll(/await axal(?:Reply|Ask)\(env, [^,]+, `([^`$]+)\$\{/g)].map((m) => m[1]);
  assert.ok(keys.length >= 7, `found ${keys.length} sends from Axal's number`);
  for (const k of keys) assert.ok(isAxalNumberKey(k), `${k} is counted`);
  assert.equal(isAxalNumberKey('composer-uuid-1'), false);
  for (const fn of ['axalReply', 'axalAsk']) {
    const body = src.slice(src.indexOf(`async function ${fn}(`));
    assert.match(body.slice(0, body.indexOf('\n}')), /if \(!axalKeyCounted\(clientKey\)\) return;\n\s+const \{ row, existing \} = await beginOutbound/,
      `${fn} checks its key before it claims or sends`);
  }
});

// ── 5. The Super Admin's read ────────────────────────────────────────────

async function get(env: any, user: number, role: string) {
  const tok = await new SignJWT({ user_id: user, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  return send(env, '/api/admin/channels/whatsapp/axal-sends', { method: 'GET', headers: { authorization: `Bearer ${tok}` } });
}

test('5. a Super Admin reads the month\'s counts only; anyone else is refused', async () => {
  const { env, db } = await world();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  for (let i = 0; i < 3; i += 1) sent(db, { key: `wblink:r${i}`, at: now });
  const ok = await get(env, ADMIN, 'admin');
  assert.equal(ok.status, 200);
  assert.deepEqual(Object.keys(ok.body).sort(), ['checked_at', 'free', 'month', 'remaining', 'sent', 'state']);
  assert.equal(ok.body.sent, 3);
  assert.equal(ok.body.state, 'within');
  assert.equal((await get(env, ME, 'founder')).status, 403);
});
