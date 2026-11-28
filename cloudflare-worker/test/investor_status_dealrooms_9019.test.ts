/**
 * #9019 — `GET /api/billing/investor/status` reports deal rooms used as
 * unknown (null), not 0, when the count cannot be read.
 *
 *  - A readable count is the number of the investor's deal-room memberships.
 *  - With `investor_dealroom_members` unreadable, `quotas.dealroom_used` is
 *    null (the key is kept) and every other field is what the readable
 *    response says.
 *
 * Real SQLite (the D640 budget fixture), synthetic users; no call leaves the
 * process.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/investor_status_dealrooms_9019.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import billing from '../src/routes/billing.ts';

const JWT_SECRET = 'i9019-dealrooms-fixture-only-secret-0123456789';
const INVESTOR = 3;
const OTHER_INVESTOR = 5;

function world() {
  const f = aiBudgetFixture();
  const env = { DB: f.DB, JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://app.example.test' } as any;
  f.db.exec(`CREATE TABLE IF NOT EXISTS user_sessions (jti TEXT PRIMARY KEY, user_id INTEGER, factor TEXT, created_at TEXT DEFAULT (datetime('now')),
    last_step_up_at TEXT, revoked_at TEXT, expires_at TEXT, last_seen_at TEXT, ip TEXT, user_agent TEXT)`);
  f.db.prepare("UPDATE users SET role = 'investor' WHERE id IN (?, ?)").run(INVESTOR, OTHER_INVESTOR);
  return { ...f, env };
}

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'error' }, 500);
  });
  a.route('/api/billing', billing);
  return a;
}

async function status(f: any, user: number) {
  const jti = `jti-${user}-${Math.random().toString(36).slice(2)}`;
  f.db.prepare("INSERT INTO user_sessions(jti,user_id,factor,created_at) VALUES(?,?, 'password', datetime('now'))").run(jti, user);
  const token = await new SignJWT({ user_id: user, jti }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app().request('/api/billing/investor/status', { headers: { Authorization: `Bearer ${token}` } }, f.env);
  const text = await r.text();
  return { status: r.status, text, body: JSON.parse(text) };
}

test('#9019: a readable count is the investor\'s own memberships; an unreadable one is null, and nothing else changes', async () => {
  const f = world();
  try {
    // The first read creates the paywall schema (investor_dealroom_members among it).
    const empty = await status(f, INVESTOR);
    assert.equal(empty.status, 200, empty.text);
    // A readable empty count is a measured 0.
    assert.equal(empty.body.quotas.dealroom_used, 0);

    const add = f.db.prepare('INSERT INTO investor_dealroom_members (deal_id, investor_user_id) VALUES (?, ?)');
    add.run(101, INVESTOR); add.run(102, INVESTOR); add.run(103, OTHER_INVESTOR);
    const readable = await status(f, INVESTOR);
    assert.equal(readable.status, 200, readable.text);
    // Mutation checked: return null on success too → reads null, not 2; drop the WHERE (count everyone's) → the bind fails and reads null.
    assert.equal(readable.body.quotas.dealroom_used, 2);

    // The table becomes unreadable; the schema bootstrap is cached for this binding and does not recreate it.
    f.db.exec('DROP TABLE investor_dealroom_members');
    const unreadable = await status(f, INVESTOR);
    assert.equal(unreadable.status, 200, unreadable.text);
    // Mutation checked: `() => 0` (the old `?? 0` on a failed read) → reads 0, not null.
    assert.ok('dealroom_used' in unreadable.body.quotas, 'the key is kept');
    assert.equal(unreadable.body.quotas.dealroom_used, null);
    // Every other field is the readable response's, in the same order.
    // Mutation checked: omit the key on a failed read, or zero dealroom_max with it → the bodies differ.
    assert.equal(unreadable.text, readable.text.replace('"dealroom_used":2', '"dealroom_used":null'));
  } finally { f.db.close(); }
});
