/**
 * D5585 part 20 (#5585, WorkGraph P1): the signed-webhook external distribution channel. A Super Admin registers a
 * company's named webhooks; part 6's `external_distribution` adapter, over this channel, POSTs a release's ids and
 * digests to the webhook, signed, and records what the receiver accepted, and a takedown POSTs its withdrawal. The
 * real router and adapter over the full migrated schema, with a stand-in receiver.
 *
 *   1. What a webhook URL is; the admin routes: gates, register, re-register, disable, stale, absent, limit, another
 *      tenant, replay, audit, and the read (with `signing` and each webhook's ref).
 *   2. Offered only with a signing key: no key, or a short one, offers nothing and the target stays not configured.
 *   3. Publish: one signed POST (event, key, HMAC over "<t>.<body>", ids only); the ledger row; a lookup then confirms
 *      without sending again; a lost answer is sent again under the same key.
 *   4. Refusals: 5xx and unreachable retry; 3xx, 4xx, a refused host, a disabled webhook and an audience the webhook
 *      does not carry are refused and record nothing; another tenant's destination is out of scope.
 *   5. Withdraw: a signed withdrawal for each accepted publication, recorded once; after it nothing is left to
 *      retract.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_release_webhooks_5585.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { T0, clock, newLine, type W } from './_work_graph_release_world_5585.ts';
import releases from '../src/routes/admin_work_graph_releases.ts';
import {
  WEBHOOK_DEPS, WEBHOOK_LIMITS, normaliseWebhookUrl, webhookChannel, webhookSignature,
} from '../src/services/workGraphReleaseWebhooks.ts';
import { externalDistributionAdapter } from '../src/services/workGraphReleaseDistribution.ts';
import { releaseDistributionChannels } from '../src/services/workGraphReleaseAdapters.ts';
import { DeliveryRetry } from '../src/services/workGraphReleaseDelivery.ts';
import { RELEASE_REFUSAL_SENTENCES } from '../src/services/workGraphReleaseAdmin.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
// A synthetic signing key for these tests, joined at run time so no key-shaped literal sits in the source (gitleaks'
// generic-api-key rule flags the literal form, as it did for _venture_stores_8530.ts).
const KEY = ['synthetic', '5585', 'webhook', 'test', 'signing', 'seed', 'not', 'a', 'credential'].join('-');
const SUPER = 1, ADMIN = 2;
const BASE = '/api/admin/work-graph/releases';
const Q = 'tenant_id=7&company_id=70';
const IN = { tenant_id: 7, company_id: 70 };
const HOOK = 'https://partner.example/hooks/release';

function fresh(): W {
  clock.t = T0;
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Super', 'super@axal.example');
  u.run(ADMIN, 'admin', 'Admin', 'admin@axal.example');
  u.run(11, 'founder', 'P11', 'p11@example.test');
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER})`);
  const s = db.prepare("INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES (?, ?, 'totp', datetime('now'), datetime('now'))");
  for (const id of [SUPER, ADMIN]) s.run(`s-${id}`, id);
  return { env: { DB: d1Over(db) } as any, db } as W;
}

const app = new Hono<any>();
app.route(BASE, releases);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, String(err?.message) === 'Unauthorized' ? 401 : 403));
const token = (who: number) => new SignJWT({ user_id: who, role: 'admin', jti: `s-${who}` })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
const envOf = (w: W, over: Record<string, unknown> = {}) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: w.env.DB, WORK_GRAPH_RELEASE_ADMIN: 'on', RELEASE_WEBHOOK_SIGNING_KEY: KEY, ...over } as any);
async function call(env: any, method: string, path: string, opts: { who?: number; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${await token(opts.who ?? SUPER)}` };
  const w = console.warn, e = console.error, i = console.info; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try {
    const res = await app.request(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { console.warn = w; console.error = e; console.info = i; }
}
const change = (env: any, op: string, name: string, seq: number, key: string, over: Record<string, unknown> = {}, who?: number) =>
  call(env, 'POST', '/webhooks', { who, body: { ...IN, op, name, url: HOOK, audiences: ['public', 'investors'], expected_seq: seq, idempotency_key: key, ...over } });
const audits = (w: W) => (w.db.prepare("SELECT filters_json FROM admin_audit_log WHERE action = 'work_graph_release_webhook' ORDER BY id").all() as any[]).map((r) => JSON.parse(r.filters_json).outcome);
const sends = (w: W) => w.db.prepare('SELECT name, event, external_id, release_key, manifest_uid, http_status FROM work_graph_release_webhook_sends ORDER BY id').all().map((r: any) => ({ ...r }));

/** A stand-in receiver: records each request and answers `status`. */
function receiver(status: number | (() => Promise<Response>) = 200) {
  const calls: { url: string; init: any; body: any }[] = [];
  WEBHOOK_DEPS.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    return typeof status === 'function' ? status() : new Response('{}', { status });
  };
  WEBHOOK_DEPS.hostRefusal = async () => null;
  WEBHOOK_DEPS.nowSeconds = () => 1_800_000_000;
  return calls;
}
const D = 'webhook:t7.c70.partner';
const req = (over: Record<string, unknown> = {}) => ({
  op: 'publish', idempotencyKey: 'rk-1', target: 'external_distribution', tenantId: 7, companyId: 70, ref: D, lineAssetUid: 'wga_line',
  manifestUid: 'wgm_m1', digest: 'a'.repeat(64), audience: 'public',
  components: [{ asset: 'wga_a', revision: 'wgr_r', digest: 'b'.repeat(64), role: 'website', source: { store: 'git', locator: 'x', id: 'y', revision: 'z' } }], ...over,
} as any);
const meter = () => { const n = { count: 0 }; return { n, m: { count: () => { n.count++; } } }; };
async function rejects(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: any) => e instanceof DeliveryRetry && e.code === code, code);
}
async function registered(w: W, over: Record<string, unknown> = {}) {
  await newLine(w, 'line-a', 'public');
  const r = await change(envOf(w), 'register', 'partner', 0, 'reg-1', over);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r;
}

test('1. webhook URLs, and the routes: register, re-register, disable, every refusal, the audit and the read', async () => {
  assert.equal(normaliseWebhookUrl(' https://Partner.Example/hooks/release?x=1 '), 'https://partner.example/hooks/release?x=1');
  for (const bad of ['http://partner.example/h', 'https://localhost/h', 'https://10.0.0.1/h', 'https://[::1]/h', 'https://u:p@partner.example/h',
    'https://partner.example/h#x', `https://partner.example/${'a'.repeat(WEBHOOK_LIMITS.urlMax)}`, 'partner.example', 7]) {
    assert.equal(normaliseWebhookUrl(bad as any), null, String(bad));
  }
  const w = fresh();
  const env = envOf(w);
  await newLine(w, 'line-a', 'public');
  assert.ok([401, 403].includes((await change(env, 'register', 'partner', 0, 'k-admin', {}, ADMIN)).status));

  const r1 = await change(env, 'register', 'partner', 0, 'r1');
  assert.deepEqual([r1.status, r1.body.seq, r1.body.ref], [200, 1, D]);
  const stale = await change(env, 'register', 'partner', 0, 'r2');
  assert.deepEqual([stale.status, stale.body.error, stale.body.current.seq], [409, 'stale_webhook', 1]);
  assert.equal(stale.body.message, RELEASE_REFUSAL_SENTENCES.stale_webhook);
  assert.equal((await change(env, 'register', 'partner', 1, 'r3', { url: 'https://partner.example/v2', audiences: ['public'] })).body.seq, 2);
  for (const [k, over] of [['i1', { url: 'http://x.example/h' }], ['i2', { audiences: [] }], ['i3', { audiences: ['everyone'] }], ['i4', { name: 'Bad_Name' }]] as const) {
    assert.equal((await change(env, 'register', (over as any).name ?? 'other', 0, k, over)).body.error, 'webhook_invalid', k);
  }
  assert.equal((await change(env, 'disable', 'nobody', 0, 'd0')).body.error, 'not_registered');
  assert.deepEqual(((r) => [r.status, r.body.error])(await change(env, 'register', 'partner', 0, 'f1', { tenant_id: 8 })), [403, 'wrong_tenant']);
  const rep = await change(env, 'register', 'partner', 0, 'r1');
  assert.deepEqual([rep.body.seq, rep.body.replayed], [1, true]);
  assert.equal((await change(env, 'register', 'partner', 0, 'r1', { url: 'https://other.example/h' })).body.error, 'idempotency_conflict');

  const read = await call(env, 'GET', `/webhooks?${Q}`);
  assert.deepEqual([read.body.signing, read.body.webhooks.map((x: any) => [x.name, x.url, x.audiences, x.active, x.seq, x.ref])],
    [true, [['partner', 'https://partner.example/v2', ['public'], true, 2, D]]]);
  assert.equal(read.body.people[SUPER]?.name, 'Super');
  assert.equal((await call(envOf(w, { RELEASE_WEBHOOK_SIGNING_KEY: undefined }), 'GET', `/webhooks?${Q}`)).body.signing, false);

  assert.equal((await change(env, 'disable', 'partner', 2, 'd1')).body.seq, 3);
  const off = (await call(env, 'GET', `/webhooks?${Q}`)).body.webhooks[0];
  assert.deepEqual([off.active, off.url, off.audiences], [false, null, []]);
  // The limit counts active webhooks only.
  for (let i = 0; i < WEBHOOK_LIMITS.perCompany; i++) assert.equal((await change(env, 'register', `h${i}`, 0, `lim-${i}`)).status, 200);
  assert.equal((await change(env, 'register', 'one-more', 0, 'lim-x')).body.error, 'webhook_limit');
  assert.deepEqual(audits(w).slice(0, 4), ['registered', 'stale_webhook', 'registered', 'webhook_invalid']);
  assert.equal(audits(w).at(-1), 'webhook_limit');
  assert.throws(() => w.db.prepare('UPDATE work_graph_release_webhooks SET url = NULL').run(), /append-only/);
  assert.throws(() => w.db.prepare('DELETE FROM work_graph_release_webhooks').run(), /append-only/);
});

test('2. the channel is offered only with a signing key of 32 characters or more', () => {
  const w = fresh();
  assert.equal(webhookChannel({ DB: w.env.DB } as any), null);
  assert.equal(webhookChannel({ DB: w.env.DB, RELEASE_WEBHOOK_SIGNING_KEY: 'short' } as any), null);
  assert.ok(webhookChannel({ DB: w.env.DB, RELEASE_WEBHOOK_SIGNING_KEY: KEY } as any));
  assert.deepEqual(Object.keys(releaseDistributionChannels({ DB: w.env.DB } as any)), []);
  assert.deepEqual(Object.keys(releaseDistributionChannels({ DB: w.env.DB, RELEASE_WEBHOOK_SIGNING_KEY: KEY } as any)), ['webhook']);
});

test('3. publish: one signed POST of ids only, recorded; the lookup then confirms; a lost answer is sent again', async () => {
  const w = fresh();
  await registered(w);
  const calls = receiver(202);
  const { n, m } = meter();
  const dist = externalDistributionAdapter({ webhook: webhookChannel({ DB: w.env.DB, RELEASE_WEBHOOK_SIGNING_KEY: KEY } as any)! }, m);
  assert.deepEqual(await dist.lookup(req()), { status: 'absent' });
  const out = await dist.send(req());
  assert.equal(out.status, 'confirmed');
  assert.match(String((out as any).externalRef), /^dist:webhook:wh_[0-9a-f]{32}$/);
  assert.equal(calls.length, 1);
  const [c] = calls;
  assert.deepEqual([c.url, c.init.method, c.init.redirect], [HOOK, 'POST', 'manual']);
  assert.equal(c.init.headers['X-StudioOS-Event'], 'release.published');
  assert.equal(c.init.headers['X-StudioOS-Release-Key'], 'rk-1');
  const expected = createHmac('sha256', KEY).update(`1800000000.${c.init.body}`).digest('hex');
  assert.equal(c.init.headers['X-StudioOS-Signature'], `t=1800000000,v1=${expected}`);
  assert.equal(await webhookSignature(KEY, 1_800_000_000, c.init.body), `t=1800000000,v1=${expected}`);
  assert.deepEqual(Object.keys(c.body).sort(), ['audience', 'companyId', 'components', 'digest', 'event', 'id', 'line', 'manifest', 'release_key', 'tenantId', 'v']);
  assert.deepEqual(Object.keys(c.body.components[0]).sort(), ['asset', 'digest', 'revision', 'role'], 'no source locator');
  assert.deepEqual(sends(w).map((s) => [s.event, s.release_key, s.manifest_uid, s.http_status]), [['published', 'rk-1', 'wgm_m1', 202]]);
  // Already delivered: the lookup confirms it, with the same external id, and sends nothing.
  assert.deepEqual(await dist.lookup(req()), out);
  assert.equal(calls.length, 1);
  assert.ok(n.count >= 2);

  // A lost answer (the receiver accepted, the Worker did not hear) records nothing; the retry sends the same key again.
  const w2 = fresh();
  await registered(w2);
  const calls2 = receiver(async () => { throw new Error('connection reset'); });
  const dist2 = externalDistributionAdapter({ webhook: webhookChannel({ DB: w2.env.DB, RELEASE_WEBHOOK_SIGNING_KEY: KEY } as any)! }, meter().m);
  await rejects(dist2.send(req()), 'provider_unavailable');
  assert.deepEqual(sends(w2), []);
  receiver(200);
  assert.equal((await dist2.send(req())).status, 'confirmed');
  assert.equal(calls2[0].init.headers['X-StudioOS-Release-Key'], 'rk-1');
});

test('4. refusals: retry on 5xx, refuse 3xx, 4xx, a refused host, a disabled webhook, another audience or tenant', async () => {
  const w = fresh();
  await registered(w, { audiences: ['public'] });
  const ch = () => externalDistributionAdapter({ webhook: webhookChannel({ DB: w.env.DB, RELEASE_WEBHOOK_SIGNING_KEY: KEY } as any)! }, meter().m);
  receiver(503); await rejects(ch().send(req()), 'provider_unavailable');
  receiver(429); await rejects(ch().send(req()), 'provider_unavailable');
  receiver(302); await rejects(ch().send(req()), 'provider_rejected');
  receiver(400); await rejects(ch().send(req()), 'provider_rejected');
  receiver(401); await rejects(ch().send(req()), 'provider_unauthorized');
  const calls = receiver(200);
  WEBHOOK_DEPS.hostRefusal = async () => 'host_refused';
  await rejects(ch().send(req()), 'provider_rejected');
  assert.equal(calls.length, 0, 'a refused host is never fetched');
  receiver(200);
  await rejects(ch().send(req({ audience: 'investors' })), 'provider_rejected');
  await rejects(ch().send(req({ ref: 'webhook:t8.c80.partner' })), 'ref_out_of_scope');
  await rejects(ch().send(req({ ref: 'webhook:t8.c70.partner' })), 'ref_out_of_scope'); // the same company under another tenant
  await rejects(ch().send(req({ ref: 'webhook:t7.c70.nobody' })), 'provider_rejected');
  assert.equal((await change(envOf(w), 'disable', 'partner', 1, 'd1')).status, 200);
  await rejects(ch().send(req()), 'provider_rejected');
  assert.deepEqual(sends(w), []);
});

test('5. withdraw: a signed withdrawal for each accepted publication, recorded once; then nothing to retract', async () => {
  const w = fresh();
  await registered(w);
  const calls = receiver(200);
  const dist = externalDistributionAdapter({ webhook: webhookChannel({ DB: w.env.DB, RELEASE_WEBHOOK_SIGNING_KEY: KEY } as any)! }, meter().m);
  await dist.send(req());
  await dist.send(req({ idempotencyKey: 'rk-2', manifestUid: 'wgm_m1' }));
  const retract = req({ op: 'retract', idempotencyKey: 'rt-1', audience: null, components: [] });
  assert.deepEqual(await dist.lookup(retract), { status: 'absent' }, 'two publications to withdraw');
  assert.equal((await dist.send(retract)).status, 'confirmed');
  const withdrawals = calls.filter((c) => c.init.headers['X-StudioOS-Event'] === 'release.withdrawn');
  assert.deepEqual(withdrawals.map((c) => c.body.release_key).sort(), ['rk-1', 'rk-2']);
  for (const c of withdrawals) {
    assert.equal(c.init.headers['X-StudioOS-Signature'], `t=1800000000,v1=${createHmac('sha256', KEY).update(`1800000000.${c.init.body}`).digest('hex')}`);
  }
  assert.deepEqual(sends(w).map((s) => s.event), ['published', 'published', 'withdrawn', 'withdrawn']);
  assert.throws(() => w.db.prepare("UPDATE work_graph_release_webhook_sends SET http_status = 204").run(), /append-only/);
  assert.throws(() => w.db.prepare('DELETE FROM work_graph_release_webhook_sends').run(), /append-only/);
  assert.deepEqual(await dist.lookup(retract), { status: 'confirmed', externalRef: null });
  // A second retraction finds nothing to withdraw and sends nothing.
  const before = calls.length;
  assert.deepEqual(await dist.send(retract), { status: 'absent' });
  assert.equal(calls.length, before);
});
