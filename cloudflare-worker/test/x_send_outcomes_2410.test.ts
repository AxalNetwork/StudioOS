/** #2410: real SQLite, synthetic X only. No request can reach a provider. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import x, { sendXPost } from '../src/routes/admin_x.ts';
import { ensureXSchema } from '../src/services/xSchema.ts';
import { encryptString } from '../src/services/cryptoBox.ts';
import { sweepScheduledPosts } from '../src/services/scheduledPosts.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const actor = { id: 1, email: 'owner@example.test' };
async function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const table of ['users', 'super_admins', 'user_sessions', 'admin_audit_log', 'activity_logs', 'x_accounts', 'x_posts']) db.exec(tableFromBaseline(baseline, table));
  db.exec("INSERT INTO users(id,role,name,email) VALUES(1,'admin','Fixture Owner','owner@example.test'),(2,'admin','Fixture Admin','admin@example.test'); INSERT INTO super_admins(user_id) VALUES(1)");
  const kvRows = new Map<string, string>();
  const kv = { get: async (k: string) => kvRows.get(k) ?? null, put: async (k: string, v: string) => { kvRows.set(k, v); }, delete: async (k: string) => { kvRows.delete(k); } };
  const writes: Array<{sql: string; args: any[]}> = [];
  let fault: ((sql: string, args: any[]) => boolean) | undefined;
  let beforeWrite: ((sql: string, args: any[]) => void) | undefined;
  const real = d1Over(db);
  const DB = { ...real, prepare(sql: string) {
    const statement = real.prepare(sql); let args: any[] = [];
    const check = () => { writes.push({ sql, args }); beforeWrite?.(sql, args); if (fault?.(sql, args)) throw new Error('synthetic_storage_failure'); };
    const wrapped: any = { ...statement,
      bind(...values: any[]) { args = values; statement.bind(...values); return wrapped; },
      async run() { check(); return statement.run(); },
      runSync() { check(); return statement.runSync(); },
    };
    return wrapped;
  }};
  const env: any = { DB, RATE_LIMITS: kv, TOKENS: kv, JWT_SECRET: randomBytes(32).toString('hex'), ENVIRONMENT: 'development', X_CLIENT_ID: 'fixture', X_CLIENT_SECRET: 'fixture', FILES: { get: async () => null, delete: async () => {}, put: async () => {} } };
  await ensureXSchema(env);
  db.prepare("INSERT INTO x_accounts(id,handle,access_token_ct,expires_at,enabled) VALUES(1,'fixture',?,'2099-01-01T00:00:00Z',1)").run(await encryptString(env, 'synthetic-access'));
  const app = new Hono<any>();
  app.route('/', x);
  app.onError((e: any, c) => c.json({ error: e.message }, (AUTH_ERROR_STATUSES[e.message] || 500) as any));
  return { db, env, writes, fail(fn?: typeof fault) { fault = fn; }, beforeWrite(fn?: typeof beforeWrite) { beforeWrite = fn; },
    post(status = 'draft', extra: {parent?: number; tweet?: string; media?: string[]} = {}) {
      return Number(db.prepare('INSERT INTO x_posts(account_id,status,body,created_by,thread_continuation_of,thread_position,tweet_id,media_r2_keys) VALUES(1,?,?,1,?,?,?,?)')
        .run(status, 'A product update.', extra.parent ?? null, extra.parent ? 1 : 0, extra.tweet ?? null, JSON.stringify(extra.media || [])).lastInsertRowid);
    },
    row(id: number) { return db.prepare('SELECT * FROM x_posts WHERE id=?').get(id) as any; },
    send(id: number, mode: 'click'|'clock' = 'click') { return sendXPost(env, id, { actor, mode, dueBy: '2099-01-01 00:00:00' }); },
    async request(method: string, path: string, body?: any, user = 1) {
      const token = await new SignJWT({ user_id: user, role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
      const response = await app.request(path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
      return { status: response.status, body: await response.json() as any };
    },
  };
}
function provider() {
  const real = globalThis.fetch;
  const calls: any[] = [], created: string[] = [], signals: unknown[] = [];
  let next = 'accept';
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'upload.twitter.com') return Response.json({ media_id_string: 'media-fixture' });
    assert.equal(url.hostname, 'api.twitter.com'); assert.equal(url.pathname, '/2/tweets'); assert.equal(init.method, 'POST');
    signals.push(init.signal);
    calls.push(JSON.parse(init.body));
    const mode = next; next = 'accept';
    if (mode === 'reject') return Response.json({ detail: 'Forbidden' }, { status: 403 });
    const id = String(100000 + calls.length);
    if (mode !== 'lost_not_created') created.push(id);
    if (mode === 'lost' || mode === 'lost_not_created') throw new DOMException('synthetic timeout', 'TimeoutError');
    if (mode === 'upstream') return Response.json({}, { status: 503 });
    if (mode === 'malformed') return Response.json({ data: {} });
    return Response.json({ data: { id } });
  }) as typeof fetch;
  return { calls, created, signals, next(mode: string) { next = mode; }, restore() { globalThis.fetch = real; } };
}
const checked = (outcome: 'sent'|'not_sent', tweet_id?: string) => ({ outcome, checked_x: true, reason: 'Checked the X account directly.', ...(tweet_id ? { tweet_id } : {}) });

test('#2410 accepted ID is saved before metadata; its later failure cannot permit another send', async () => {
  const w = await world(), p = provider(), id = w.post();
  w.fail(sql => sql.includes('SET body_hash = ?'));
  try {
    const out = await w.send(id);
    assert.equal(out.status, 200); assert.ok(p.signals[0] instanceof AbortSignal, 'post creation has a deadline'); assert.equal(w.row(id).status, 'sent'); assert.equal(w.row(id).tweet_id, '100001');
    const receipt = w.writes.findIndex(write => write.sql.includes('SET tweet_id = ?'));
    const metadata = w.writes.findIndex(write => write.sql.includes('SET body_hash = ?'));
    assert.ok(receipt >= 0 && metadata > receipt);
    assert.equal((await w.send(id)).status, 409); assert.equal(p.calls.length, 1);
    w.db.prepare("UPDATE x_posts SET status='failed' WHERE id=?").run(id);
    assert.equal((await w.send(id)).status, 409); assert.equal(p.calls.length, 1, 'even a legacy failed row with an ID cannot post twice');
  } finally { p.restore(); w.db.close(); }
});

test('#2410 receipt save failure preserves the accepted ID, including when every subsequent write fails', async () => {
  for (const all of [false, true]) {
    const w = await world(), p = provider(), id = w.post(), logs: string[] = [];
    const warn = console.warn; console.warn = (...args: any[]) => { logs.push(args.join(' ')); };
    w.fail(sql => sql.includes('SET tweet_id = ?') || all && p.calls.length > 0);
    try {
      const out = await w.send(id);
      assert.equal(out.body.code, 'x_sent_not_saved'); assert.equal(out.body.tweet_id, '100001');
      assert.equal(w.row(id).status, all ? 'sending' : 'unknown');
      if (!all) assert.equal(w.row(id).tweet_id, '100001');
      assert.ok(logs.some(line => line.includes('100001')));
      assert.equal(logs.some(line => /synthetic-access|A product update|Bearer/.test(line)), false);
      assert.equal((await w.send(id)).status, 409); assert.equal(p.calls.length, 1);
      w.fail();
      if (all) {
        w.db.prepare("UPDATE x_posts SET updated_at=datetime('now','-40 minutes') WHERE id=?").run(id);
        await sweepScheduledPosts(w.env, new Date());
        assert.equal(w.row(id).status, 'unknown'); assert.equal((await w.send(id)).status, 409);
      }
    } finally { console.warn = warn; p.restore(); w.db.close(); }
  }
});

test('#2410 timeout after acceptance, 5xx and malformed success are quarantined and never blindly retried', async () => {
  const w = await world(), p = provider();
  try {
    for (const mode of ['lost', 'upstream', 'malformed']) {
      const id = w.post(); p.next(mode);
      const out = await w.send(id);
      assert.equal(out.body.code, 'x_outcome_unknown'); assert.equal(w.row(id).status, 'unknown');
      const count = p.calls.length;
      assert.equal((await w.send(id)).status, 409); assert.equal(p.calls.length, count);
      await sweepScheduledPosts(w.env, new Date()); assert.equal(p.calls.length, count);
    }
  } finally { p.restore(); w.db.close(); }
});

test('#2410 unknown and legacy failed rows cannot be edited, deleted, scheduled, sent or hidden by account deletion', async () => {
  const w = await world(), p = provider();
  try {
    for (const state of ['unknown', 'failed']) {
      const id = w.post(state);
      assert.equal((await w.send(id)).status, 409);
      for (const [method, path, body] of [
        ['PUT', `/posts/${id}`, { body: 'Changed' }], ['DELETE', `/posts/${id}`, undefined],
        ['POST', `/posts/${id}/schedule`, { scheduled_for: '2099-01-01T00:00:00Z' }],
        ['POST', `/posts/${id}/media`, {}], ['PUT', `/posts/${id}/alt-text`, { index: 0, alt_text: 'Changed' }],
      ] as const) assert.equal((await w.request(method, path, body)).status, 409, path);
      assert.equal(w.row(id).status, state);
    }
    assert.equal((await w.request('DELETE', '/accounts/1')).status, 409); assert.equal(p.calls.length, 0);
  } finally { p.restore(); w.db.close(); }
});

test('#2410 an explicit checked outcome resolves without sending, is audited, and cannot erase an accepted ID', async () => {
  const w = await world(), p = provider();
  try {
    const lost = w.post(); p.next('lost'); await w.send(lost);
    const resolved = await w.request('POST', `/posts/${lost}/resolve`, checked('sent', p.created[0]));
    assert.equal(resolved.status, 200); assert.equal(w.row(lost).status, 'sent'); assert.equal(w.row(lost).tweet_id, p.created[0]);
    assert.equal(p.calls.length, 1); assert.equal((await w.send(lost)).status, 409);
    const rejected = w.post('failed');
    assert.equal(w.row(rejected).status, 'failed'); assert.equal((await w.send(rejected)).status, 409);
    assert.equal((await w.request('POST', `/posts/${rejected}/resolve`, checked('not_sent'))).status, 200);
    assert.equal(w.row(rejected).status, 'draft'); assert.equal(p.calls.length, 1);
    assert.equal((await w.send(rejected)).status, 200); assert.equal(p.calls.length, 2);
    const known = w.post('unknown', { tweet: '999001' });
    assert.equal((await w.request('POST', `/posts/${known}/resolve`, checked('not_sent'))).status, 409);
    assert.equal((await w.request('POST', `/posts/${known}/resolve`, checked('sent', '999002'))).status, 409);
    assert.equal(w.row(known).tweet_id, '999001');
    assert.equal((await w.request('POST', `/posts/${known}/resolve`, checked('sent'))).status, 200);
    const audit: any[] = w.db.prepare("SELECT admin_user_id,filters_json FROM admin_audit_log WHERE action='x_post_outcome_checked'").all();
    assert.equal(audit.length, 3); assert.equal(audit.every(row => row.admin_user_id === actor.id), true);
    assert.deepEqual(audit.map(row => JSON.parse(row.filters_json).outcome), ['sent', 'not_sent', 'sent']);
  } finally { p.restore(); w.db.close(); }
});

test('#2410 reconciliation requires the Super Admin, a checked reason and valid post ID; audit failure rolls it back', async () => {
  const w = await world(), p = provider(), id = w.post('unknown');
  try {
    assert.equal((await w.request('POST', `/posts/${id}/resolve`, checked('not_sent'), 2)).status, 403);
    for (const body of [{ outcome: 'not_sent' }, { ...checked('not_sent'), checked_x: false }, { ...checked('not_sent'), reason: 'short' }, checked('sent', '../other'), { ...checked('sent', '123'), reason: 'x'.repeat(501) }]) {
      assert.equal((await w.request('POST', `/posts/${id}/resolve`, body)).status, 400);
      assert.equal(w.row(id).status, 'unknown');
    }
    w.fail(sql => sql.includes("'x_post_outcome_checked'"));
    assert.equal((await w.request('POST', `/posts/${id}/resolve`, checked('not_sent'))).status, 500);
    assert.equal(w.row(id).status, 'unknown'); assert.equal(p.calls.length, 0);
    w.fail();
    const outcomes = await Promise.all([w.request('POST', `/posts/${id}/resolve`, checked('not_sent')), w.request('POST', `/posts/${id}/resolve`, checked('sent', '123'))]);
    assert.deepEqual(outcomes.map(out => out.status).sort(), [200, 409]);
    assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='x_post_outcome_checked'").get()!.n, 1);
  } finally { p.restore(); w.db.close(); }
});

test('#2410 a thread stops at an uncertain child, preserving head and child receipts without reposting', async () => {
  const w = await world(), p = provider(), head = w.post(), child = w.post('draft', { parent: head }), last = w.post('draft', { parent: head });
  w.fail((sql, args) => sql.includes('SET tweet_id = ?') && args.at(-1) === child);
  try {
    const out = await w.send(head);
    assert.equal(out.body.code, 'x_sent_not_saved'); assert.equal(p.calls.length, 2);
    assert.equal(w.row(head).status, 'sent'); assert.equal(w.row(child).status, 'unknown'); assert.equal(w.row(child).tweet_id, '100002');
    assert.equal(w.row(last).status, 'draft'); assert.equal(p.calls[1].reply.in_reply_to_tweet_id, '100001');
    assert.equal((await w.send(head)).status, 409); assert.equal((await w.send(last)).status, 400); assert.equal(p.calls.length, 2);
  } finally { p.restore(); w.db.close(); }
});

test('#2410 a stale X send becomes unknown, and a delayed media preflight cannot post after reconciliation', async () => {
  const w = await world(), p = provider(), id = w.post('draft', { media: ['x/fixture.png'] });
  let release!: (value: any) => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  w.env.FILES.get = async () => { entered(); return new Promise(resolve => { release = resolve; }); };
  try {
    const sending = w.send(id); await waiting;
    w.db.prepare("UPDATE x_posts SET updated_at=datetime('now','-40 minutes') WHERE id=?").run(id);
    const swept = await sweepScheduledPosts(w.env, new Date());
    assert.equal(swept.stale_unknown, 1); assert.equal(w.row(id).status, 'unknown');
    assert.equal((await w.request('POST', `/posts/${id}/resolve`, checked('not_sent'))).status, 200);
    release({ arrayBuffer: async () => new Uint8Array([1]).buffer });
    await sending; assert.equal(p.calls.length, 0); assert.equal(w.row(id).status, 'draft');
  } finally { p.restore(); w.db.close(); }
});

test('#2410 Schedule rechecks the current state, and unknown sends retain daily-cap reservations', async () => {
  const w = await world(), p = provider(), id = w.post();
  try {
    w.beforeWrite(sql => { if (sql.includes("SET status = 'scheduled'")) w.db.prepare("UPDATE x_posts SET status='unknown' WHERE id=?").run(id); });
    assert.equal((await w.request('POST', `/posts/${id}/schedule`, { scheduled_for: '2099-01-01T00:00:00Z' })).status, 409);
    assert.equal(w.row(id).status, 'unknown'); w.beforeWrite();
    w.env.X_DAILY_CAP = '1';
    const another = w.post();
    assert.equal((await w.send(another)).status, 429); assert.equal(p.calls.length, 0);
  } finally { p.restore(); w.db.close(); }
});


test('#2410 an unknown non-delivery needs an explicit check before a single intentional send', async () => {
  const w = await world(), p = provider(), id = w.post();
  try {
    p.next('lost_not_created');
    assert.equal((await w.send(id)).body.code, 'x_outcome_unknown');
    assert.equal(w.row(id).status, 'unknown'); assert.equal(p.created.length, 0);
    assert.equal((await w.send(id)).status, 409); assert.equal(p.calls.length, 1);
    assert.equal((await w.request('POST', `/posts/${id}/resolve`, checked('not_sent'))).status, 200);
    assert.equal(p.calls.length, 1); assert.equal(w.row(id).status, 'draft');
    assert.equal((await w.send(id)).status, 200); assert.equal(p.calls.length, 2); assert.equal(p.created.length, 1);
    assert.equal((await w.send(id)).status, 409); assert.equal(p.calls.length, 2);
  } finally { p.restore(); w.db.close(); }
});

test('#2410 a receipted thread child is skipped and remains the parent of the next new post', async () => {
  const w = await world(), p = provider(), head = w.post();
  const child = w.post('sent', { parent: head, tweet: '999001' });
  const last = w.post('draft', { parent: head });
  w.db.prepare('UPDATE x_posts SET thread_position=2 WHERE id=?').run(last);
  try {
    assert.equal((await w.send(head)).status, 200); assert.equal(p.calls.length, 2);
    assert.equal(w.row(child).tweet_id, '999001'); assert.equal(w.row(child).status, 'sent');
    assert.equal(p.calls[1].reply.in_reply_to_tweet_id, '999001'); assert.equal(w.row(last).status, 'sent');
  } finally { p.restore(); w.db.close(); }
});


test('#2410 regression: a failed receipt save cannot make a second Send publish again', async () => {
  const w = await world(), p = provider(), id = w.post();
  w.fail(sql => p.calls.length > 0 && /^UPDATE x_posts/.test(sql.trim()) && /tweet_id\s*=/.test(sql));
  try {
    await w.send(id);
    const firstState = w.row(id).status;
    await w.send(id);
    assert.equal(p.created.length, 1, 'a second Send must not publish another post after the receipt save failed');
    assert.ok(['unknown', 'sending'].includes(firstState), 'an accepted post never becomes failed');
  } finally { p.restore(); w.db.close(); }
});

test('#2410 proven non-deliveries return to draft without a checked-X attestation', async () => {
  const w = await world(), p = provider();
  try {
    const rejected = w.post(); p.next('reject');
    assert.equal((await w.send(rejected)).body.code, 'x_forbidden');
    assert.equal(w.row(rejected).status, 'draft'); assert.equal(p.created.length, 0);
    assert.equal((await w.send(rejected)).status, 200); assert.equal(p.created.length, 1);
    const missing = w.post('draft', { media: ['x/missing.png'] });
    await w.send(missing); assert.equal(w.row(missing).status, 'draft'); assert.equal(p.calls.length, 2);
    const disabled = w.post('scheduled');
    w.db.prepare('UPDATE x_accounts SET enabled=0 WHERE id=1').run();
    await w.send(disabled, 'clock'); assert.equal(w.row(disabled).status, 'draft');
    w.db.prepare('UPDATE x_accounts SET enabled=1 WHERE id=1').run();
    const capped = w.post('scheduled'); w.env.X_DAILY_CAP = '1';
    w.db.prepare("UPDATE x_posts SET scheduled_for='2020-01-01' WHERE id=?").run(capped);
    assert.equal((await w.send(capped, 'clock')).status, 429); assert.equal(w.row(capped).status, 'draft');
    delete w.env.X_DAILY_CAP;
    const unreadable = w.post('scheduled');
    w.db.prepare("UPDATE x_posts SET scheduled_for='not a date' WHERE id=?").run(unreadable);
    const sweep = await sweepScheduledPosts(w.env, new Date());
    assert.equal(sweep.unreadable_draft, 1); assert.equal(w.row(unreadable).status, 'draft');
    const token = w.post(); w.db.prepare("UPDATE x_accounts SET access_token_ct='broken' WHERE id=1").run();
    await w.send(token); assert.equal(w.row(token).status, 'draft'); assert.equal(p.calls.length, 2);
    assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='x_post_outcome_checked'").get()!.n, 0);
  } finally { p.restore(); w.db.close(); }
});

test('#2410 account deletion preserves every draft on a racing outcome or database error, and cleans deleted media after commit', async () => {
  const w = await world(), p = provider(), first = w.post('draft', { media: ['x/fixture.png', 'another/path'] }), second = w.post();
  const removed: string[] = []; w.env.FILES.delete = async (key: string) => { removed.push(key); };
  try {
    w.beforeWrite(sql => { if (sql.startsWith('DELETE FROM x_posts WHERE account_id')) w.db.prepare("UPDATE x_posts SET status='unknown' WHERE id=?").run(second); });
    assert.equal((await w.request('DELETE', '/accounts/1')).status, 409);
    assert.equal(w.row(first)?.status, 'draft'); assert.equal(w.row(second)?.status, 'unknown'); assert.deepEqual(removed, []);
    w.beforeWrite(); w.db.prepare("UPDATE x_posts SET status='draft' WHERE id=?").run(second);
    w.fail(sql => sql.startsWith('DELETE FROM x_accounts'));
    assert.equal((await w.request('DELETE', '/accounts/1')).status, 500);
    assert.equal(w.row(first)?.status, 'draft'); assert.equal(w.row(second)?.status, 'draft'); assert.deepEqual(removed, []);
    w.fail(); assert.equal((await w.request('DELETE', '/accounts/1')).status, 200);
    assert.equal(w.row(first), undefined); assert.equal(w.row(second), undefined);
    assert.equal(w.db.prepare('SELECT id FROM x_accounts WHERE id=1').get(), undefined);
    assert.deepEqual(removed, ['x/fixture.png']); assert.equal(p.calls.length, 0);
  } finally { p.restore(); w.db.close(); }
});


test('#2410 a preclaim clock refusal cannot release an active Send reservation', async () => {
  const w = await world(), p = provider(), id = w.post('scheduled');
  try {
    w.db.prepare('UPDATE x_accounts SET enabled=0 WHERE id=1').run();
    w.beforeWrite(sql => { if (sql.includes("SET status = 'draft'")) w.db.prepare("UPDATE x_posts SET status='sending' WHERE id=?").run(id); });
    assert.equal((await w.send(id, 'clock')).status, 409);
    assert.equal(w.row(id).status, 'sending'); assert.equal(p.calls.length, 0);
    w.beforeWrite(); assert.equal((await w.send(id)).status, 409); assert.equal(w.row(id).status, 'sending');
  } finally { p.restore(); w.db.close(); }
});
