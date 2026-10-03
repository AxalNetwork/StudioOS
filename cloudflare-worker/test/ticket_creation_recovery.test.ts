import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import tickets from '../src/routes/tickets.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const secret = 'synthetic-ticket-test-secret-0123456789';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const issue = { number: 123, html_url: 'https://github.com/AxalNetwork/StudioOS/issues/123', labels: [], assignees: [], state: 'open' };

async function fixture(t: any) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  t.after(() => db.close());
  for (const name of ['users', 'tickets', 'super_admins', 'mi_pro_subscriptions']) {
    db.exec(tableFromBaseline(baseline, name));
  }
  db.exec(readFileSync('cloudflare-worker/sql/migrations/277_user_recovery_state.sql', 'utf8'));
  db.exec("INSERT INTO users (id, name, email, role) VALUES (1, 'Tester', 'tester@example.test', 'admin'), (2, 'Founder', 'founder@example.test', 'founder')");
  const env: any = { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development',
    GITHUB_ACCESS_TOKEN: 'synthetic-github-token', GITHUB_REPO_OWNER: 'AxalNetwork', GITHUB_REPO_NAME: 'StudioOS' };
  const app = new Hono<any>().route('/api/tickets', tickets);
  app.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e.message];
    if (status) return c.json({ error: e.message }, status);
    throw e;
  });
  const calls: Array<{ url: string; method: string; body: any }> = [];
  let respond = async (_call: any) => Response.json(issue, { status: 201 });
  t.mock.method(globalThis, 'fetch', async (url: any, init: any = {}) => {
    const call = { url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null };
    assert.ok(call.url.startsWith('https://api.github.com/repos/AxalNetwork/StudioOS/'), 'unexpected external request');
    assert.equal(init.headers.Authorization, 'Bearer synthetic-github-token');
    calls.push(call);
    return respond(call);
  });
  async function request(path = '', body: any = { title: 'Studio ticket', priority: 'high', type: 'bug', description: 'Details' }, userId = 1) {
    const jwt = await new SignJWT({ user_id: userId }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
    const res = await app.request(`/api/tickets${path}`, { method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    return { status: res.status, body: await res.json() as any };
  }
  return { db, env, calls, request, respond: (fn: typeof respond) => { respond = fn; } };
}

test('File ticket creates and persists the GitHub issue with labels and source marker', async t => {
  const f = await fixture(t);
  const r = await f.request();
  assert.equal(r.status, 200);
  assert.equal(r.body.github_sync_status, 'synced');
  assert.equal(r.body.github_issue_url, issue.html_url);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://api.github.com/repos/AxalNetwork/StudioOS/issues');
  assert.equal(f.calls[0].method, 'POST');
  assert.equal(f.calls[0].body.title, 'Studio ticket');
  assert.deepEqual(f.calls[0].body.labels, ['support-ticket', 'bug', 'priority:high']);
  assert.match(f.calls[0].body.body, /Details[\s\S]*<!-- axal-sync:ticket-1 -->/);
  const row: any = f.db.prepare('SELECT * FROM tickets').get();
  assert.equal(row.github_issue_number, 123);
  assert.equal(row.github_sync_status, 'synced');
});

test('GitHub permission failure stays saved and can be recovered after permission is repaired', async t => {
  const f = await fixture(t);
  f.respond(async () => Response.json({ message: 'Resource not accessible by personal access token' }, { status: 403 }));
  const failed = await f.request();
  assert.equal(failed.body.github_sync_status, 'failed');
  assert.match(failed.body.github_sync_error, /Resource not accessible/);
  assert.equal((f.db.prepare('SELECT github_sync_status FROM tickets').get() as any).github_sync_status, 'failed');
  // Page refresh, and even a truthy string, must not publish pending tickets.
  await f.request('/sync', {});
  await f.request('/sync', { backfill: 'false' });
  await f.request('/sync', { backfill: true }, 2);
  assert.equal(f.calls.length, 1);
  f.respond(async () => Response.json(issue));
  const recovered = await f.request('/sync', { backfill: true });
  assert.equal(recovered.body.backfilled, 1);
  assert.equal(recovered.body.unsynced_count, 0);
  assert.equal(recovered.body.tickets[0].github_issue_url, issue.html_url);
  assert.equal(recovered.body.tickets[0].github_sync_error, null);
  await f.request('/sync', { backfill: true });
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 2, 'retry duplicated an already linked issue');
});

test('missing configuration keeps the ticket recoverable without contacting GitHub', async t => {
  const f = await fixture(t);
  delete f.env.GITHUB_ACCESS_TOKEN;
  const r = await f.request();
  assert.equal(r.body.github_sync_status, 'not_configured');
  const sync = await f.request('/sync', { backfill: true });
  assert.equal(sync.body.unsynced_count, 1);
  assert.equal(sync.body.github_configured, false);
  assert.equal(f.calls.length, 0);
});

test('overlapping admin retries claim each pending ticket only once', async t => {
  const f = await fixture(t);
  delete f.env.GITHUB_ACCESS_TOKEN;
  await f.request();
  f.env.GITHUB_ACCESS_TOKEN = 'synthetic-github-token';
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  f.respond(async () => { started(); await wait; return Response.json(issue); });
  const first = f.request('/sync', { backfill: true });
  await entered;
  try {
    const second = await f.request('/sync', { backfill: true });
    assert.equal(second.body.backfilled, undefined);
    assert.equal(f.calls.length, 1);
  } finally { release(); }
  assert.equal((await first).body.backfilled, 1);
});

test('a fresh File ticket request is not also created by an admin backfill', async t => {
  const f = await fixture(t);
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  f.respond(async () => { started(); await wait; return Response.json(issue); });
  const created = f.request();
  await entered;
  try {
    await f.request('/sync', { backfill: true });
    assert.equal(f.calls.length, 1);
  } finally { release(); }
  assert.equal((await created).body.github_sync_status, 'synced');
});

test('an interrupted claim can recover, and a retry publishes at most 25 issues', async t => {
  const f = await fixture(t);
  delete f.env.GITHUB_ACCESS_TOKEN;
  await f.request();
  f.db.exec("UPDATE tickets SET github_sync_status = 'syncing', github_sync_attempted_at = datetime('now', '-6 minutes')");
  const insert = f.db.prepare("INSERT INTO tickets (title, user_id) VALUES ('Pending ticket', 1)");
  for (let i = 0; i < 25; i++) insert.run();
  f.env.GITHUB_ACCESS_TOKEN = 'synthetic-github-token';
  f.respond(async () => Response.json({ ...issue, number: 123 + f.calls.length }));
  const result = await f.request('/sync', { backfill: true });
  assert.equal(result.body.backfilled, 25);
  assert.equal(result.body.unsynced_count, 1);
  assert.equal(f.calls.length, 25);
  assert.equal((f.db.prepare('SELECT github_sync_status FROM tickets WHERE id = 1').get() as any).github_sync_status, 'synced');
});
