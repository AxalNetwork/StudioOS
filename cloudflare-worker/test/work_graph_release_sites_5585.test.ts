/**
 * D5585 part 9 (#5585, WorkGraph P1) — the public read of a published release's site record, and revoked people in the
 * Super-Admin release context. The real routers over the full migrated schema, part 2's synthetic campaign world, the
 * real `website_cdn` adapter over a fake `FILES` bucket that records every request. No test reaches a provider.
 *
 *   1. Flag off (absent, or any value but `on`): 404 `release_sites_off` with no D1 and no R2 read, never cached; the
 *      router mounts ahead of the `/api/public` routers whose middleware reads D1; the rate-limit bucket covers the path.
 *   2. It follows the line's publication pointer: nothing before delivery, the pointer's manifest once delivered, and
 *      after the pointer moves never the older manifest's record (`not_delivered` until the new one is delivered, or
 *      when the new one was published without the site). Ids and digests only; every answer carries its cost.
 *   3. A takedown (`withdrawn`, before its retraction is even delivered, with no R2 read) and a tombstoned pin.
 *   4. Tenants: another tenant or company never sees the record; two tenants' sites of the same name each see their
 *      own; a record whose metadata or body does not match D1 is refused and its extra fields never echoed; a non-public
 *      line is never shown.
 *   5. Malformed paths, a missing bucket and a failing bucket.
 *   6. Revoked people (`users.is_active = 0`) in the Super-Admin context: resolved per scope; a revoked reviewer's
 *      approval stops counting at publication and in the evaluation, and a revoked reviewer cannot decide;
 *      reactivation restores it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_release_sites_5585.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import {
  CTX, OTHER, OTHER_CTX, SAM, T0, attestAll, clock, decision, headOf, hex, newLine, piece, published, revise, type Piece, type W,
} from './_work_graph_release_world_5585.ts';
import sites, { mount } from '../src/routes/release_sites_public.ts';
import eventsPublic from '../src/routes/events_public.ts';
import releases from '../src/routes/admin_work_graph_releases.ts';
import { RELEASE_SITE_READ } from '../src/middleware/rateLimit.ts';
import {
  attestComponent, cutManifest, decideRelease, publishRelease, registerReleaseLine, type ReleaseContext,
} from '../src/services/workGraphReleases.ts';
import { takedownRelease } from '../src/services/workGraphReleaseTakedowns.ts';
import { advanceHead, createRevision, tombstoneRevision } from '../src/services/workGraphRevisions.ts';
import { drainReleaseEffects } from '../src/services/workGraphReleaseAdapters.ts';
import { SITE_META, siteRecordKey } from '../src/services/workGraphReleaseDistribution.ts';
import { RELEASE_ADMIN_DEPS, releaseAdminContext } from '../src/services/workGraphReleaseAdmin.ts';
import { revokedReleaseUsers } from '../src/services/workGraphReleaseAuthorities.ts';

const SITE = 'campaign-site';
const PUBLIC_BASE = '/api/public/release-sites';
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;
const ALICE = 11, BOB = 12, CAROL = 13, DAVE = 14, ERIN = 15, SAM_ID = 16, NOBODY_ID = 17;
const IN = { tenant_id: 7, company_id: 70 };

function fresh(): W {
  clock.t = T0;
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Super', 'super@axal.example');
  for (const id of [ALICE, BOB, CAROL, DAVE, ERIN, SAM_ID, NOBODY_ID, 21, 22]) u.run(id, 'founder', `P${id}`, `p${id}@example.test`);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER})`);
  db.prepare("INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES (?, ?, 'totp', datetime('now'), datetime('now'))").run(`s-${SUPER}`, SUPER);
  const link = db.prepare('INSERT INTO user_company_links (uid, company_id, user_id) VALUES (?, ?, ?)');
  for (const id of [BOB, CAROL, 21]) link.run(`l-70-${id}`, 70, id);
  link.run('l-80-22', 80, 22);
  return { env: { DB: d1Over(db) } as any, db } as W;
}
const deactivate = (w: W, id: number, active = 0) => w.db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(active, id);

/** A fake R2 bucket: what it holds, and every request. `fail` makes every request throw. */
class FakeBucket {
  objects = new Map<string, { body: string; customMetadata: Record<string, string> }>();
  requests: { fn: string; key: string }[] = [];
  fail = false;
  private rec(fn: string, key: string) { this.requests.push({ fn, key }); if (this.fail) throw new Error('r2 down'); }
  async head(key: string) { this.rec('head', key); const o = this.objects.get(key); return o ? { key, customMetadata: { ...o.customMetadata } } : null; }
  async get(key: string) {
    this.rec('get', key);
    const o = this.objects.get(key);
    return o ? { key, customMetadata: { ...o.customMetadata }, text: async () => o.body } : null;
  }
  async put(key: string, body: string, opts: any) { this.rec('put', key); this.objects.set(key, { body, customMetadata: { ...opts.customMetadata } }); return { key }; }
  async delete(key: string) { this.rec('delete', key); this.objects.delete(key); }
  count(fn: string) { return this.requests.filter((r) => r.fn === fn).length; }
}

/** A binding that fails the test on any use. */
function untouchable() {
  const touched: string[] = [];
  const b = new Proxy({}, { get(_t, k) { touched.push(String(k)); throw new Error(`touched: ${String(k)}`); } });
  return { b, touched };
}

const app = new Hono<any>();
app.route(PUBLIC_BASE, sites);
app.route('/api/admin/work-graph/releases', releases);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, String(err?.message) === 'Unauthorized' ? 401 : 403));

function envOf(w: W | null, over: Record<string, unknown> = {}) {
  return {
    JWT_SECRET, ENVIRONMENT: 'development', DB: w?.env.DB, WORK_GRAPH_RELEASE_SITES: 'on', WORK_GRAPH_RELEASE_ADMIN: 'on',
    WORK_GRAPH_RELEASE_DELIVERY: 'preview', ...over,
  } as any;
}
async function quiet<T>(f: () => Promise<T>): Promise<T> {
  const w = console.warn, e = console.error, i = console.info; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try { return await f(); } finally { console.warn = w; console.error = e; console.info = i; }
}
async function read(env: any, tenant: string | number = 7, company: string | number = 70, site = SITE) {
  return quiet(async () => {
    const res = await app.request(`${PUBLIC_BASE}/${tenant}/${company}/${site}`, { method: 'GET' }, env);
    return { status: res.status, cache: res.headers.get('cache-control'), text: await res.clone().text(), body: await res.json().catch(() => null) as any };
  });
}
const token = (who: number) => new SignJWT({ user_id: who, role: 'admin', jti: `s-${who}` })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function admin(env: any, method: string, path: string, body?: unknown) {
  return quiet(async () => {
    const res = await app.request(`/api/admin/work-graph/releases${path}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token(SUPER)}` }, body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  });
}
async function drain(env: any) {
  const r = await quiet(() => drainReleaseEffects(env, { limit: 25 }));
  assert.ok(r.ok);
  return r;
}

/** A public line of two public pieces (website: code, copy: marketing), in `ctx`'s scope. */
async function publicLine(w: W, ctx: ReleaseContext = CTX, tag = '') {
  const scope = ctx === CTX ? undefined : OTHER;
  const website = await piece(w, `pub-website${tag}`, 'code', 'public', { scope, ctx });
  const copy = await piece(w, `pub-copy${tag}`, 'document', 'public', { scope, ctx });
  if (ctx === CTX) { await attestAll(w, website, ['code']); await attestAll(w, copy, ['marketing']); }
  return { website, copy };
}
async function cutPublic(w: W, line: string, website: Piece, copy: Piece, key: string, ctx: ReleaseContext = CTX) {
  const m = await cutManifest(w.env, ctx, {
    lineAssetUid: line, partial: false, author: { kind: 'person', userId: ALICE }, idempotencyKey: key,
    components: [
      { assetUid: website.asset, revisionUid: website.rev, digest: website.digest, role: 'website', profile: 'code' },
      { assetUid: copy.asset, revisionUid: copy.rev, digest: copy.digest, role: 'copy', profile: 'marketing' },
    ],
  });
  assert.ok(m.ok, JSON.stringify(m));
  for (const prof of ['code', 'marketing'] as const) {
    const d = await decideRelease(w.env, ctx, decision(m.manifestUid, m.digest, prof, `${key}-${prof}`, {}, 'public'));
    assert.ok(d.ok, JSON.stringify(d));
  }
  return m;
}
/** A new accepted head of `p`, approved by `approver` at its exact bytes. */
async function reviseBy(w: W, p: Piece, key: string, approver: number, ctx: ReleaseContext = CTX): Promise<Piece> {
  const digest = await hex(key);
  const source = { ...p.source, revision: key };
  const r = await createRevision(w.env, ctx, {
    assetUid: p.asset, parents: [p.rev], digest, byteLength: 10, mediaProfile: 'application/octet-stream', source, author: { kind: 'person', userId: ALICE },
    idempotencyKey: `rev-${key}`,
  });
  assert.ok(r.ok, JSON.stringify(r));
  const h = await advanceHead(w.env, ctx, {
    assetUid: p.asset, expectedRevisionUid: p.rev, revisionUid: r.revisionUid, actor: { kind: 'person', userId: ALICE }, idempotencyKey: `adv-${key}`,
    approval: { ref: `approvals:item-${key}`, contentDigest: digest, reviewer: { kind: 'person', userId: approver }, decidedAt: '2026-11-19T09:00:00Z' },
  });
  assert.ok(h.ok, JSON.stringify(h));
  return { ...p, rev: r.revisionUid, digest, key, source };
}
const toSite = (site = SITE) => [{ target: 'website_cdn' as const, ref: site }];
async function pub(w: W, line: string, m: { manifestUid: string }, expected: string | null, key: string, effects = toSite(), ctx = CTX) {
  const r = await publishRelease(w.env, ctx, { lineAssetUid: line, manifestUid: m.manifestUid, expectedManifestUid: expected, effects, actor: { kind: 'person', userId: ALICE }, idempotencyKey: key });
  assert.ok(r.ok, JSON.stringify(r));
}

// -------------------------------------------------------------------------------------------------------------------

test('1. flag off: 404 before any D1 or R2 read, never cached; mounted ahead of the /api/public middleware; rate-limited', async () => {
  for (const flag of [undefined, '', 'true', 'ON', 'On', 'preview', 'off', '1']) {
    const d = untouchable(), f = untouchable();
    const r = await read({ DB: d.b, FILES: f.b, WORK_GRAPH_RELEASE_SITES: flag });
    assert.deepEqual([r.status, r.body?.error], [404, 'release_sites_off'], String(flag));
    assert.equal(typeof r.body.message, 'string');
    assert.equal(r.cache, 'no-store');
    assert.deepEqual([d.touched, f.touched], [[], []], `${flag} touched a binding`);
  }
  // Off, a malformed path is refused the same way, before it is even parsed.
  const d = untouchable();
  assert.equal((await read({ DB: d.b, WORK_GRAPH_RELEASE_SITES: undefined }, 'x', 'y', 'Bad_Site')).body.error, 'release_sites_off');
  assert.deepEqual(d.touched, []);

  // Three /api/public routers run a schema bootstrap on every request under the prefix; this one mounts ahead of them.
  assert.equal(mount.path, PUBLIC_BASE);
  assert.ok(mount.before?.includes(eventsPublic), 'mounted before the legacy /api/public routers');

  // The per-IP bucket covers the route, and only it.
  for (const p of [`${PUBLIC_BASE}/7/70/${SITE}`, `${PUBLIC_BASE}/x/y/z`, `${PUBLIC_BASE}/7/70/${SITE}/`]) assert.ok(RELEASE_SITE_READ.test(p), p);
  for (const p of [`${PUBLIC_BASE}/7/70`, `${PUBLIC_BASE}/7/70/${SITE}/more`, `/api/public/trust`, `/api/x${PUBLIC_BASE}/7/70/s`]) assert.ok(!RELEASE_SITE_READ.test(p), p);
});

test('2. it follows the publication pointer and never an older manifest; ids only, with its cost', async () => {
  const w = fresh();
  const files = new FakeBucket();
  const env = envOf(w, { FILES: files });
  assert.deepEqual([(await read(env)).status, (await read(env)).body.error], [404, 'not_found'], 'no line has ever published to the site');

  const { website, copy } = await publicLine(w);
  const line = await newLine(w, 'line-public', 'public');
  const m1 = await cutPublic(w, line, website, copy, 'm1');
  await pub(w, line, m1, null, 'pub-m1');
  let r = await read(env);
  assert.deepEqual([r.status, r.body.error], [404, 'not_delivered'], 'published, not yet delivered');

  await drain(env);
  r = await read(env);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.cache, 'no-store');
  assert.deepEqual(Object.keys(r.body).sort(), ['company_id', 'cost', 'digest', 'head_seq', 'line', 'manifest_uid', 'record', 'site', 'state', 'tenant_id']);
  assert.deepEqual([r.body.state, r.body.site, r.body.tenant_id, r.body.company_id, r.body.line, r.body.manifest_uid, r.body.digest],
    ['ok', SITE, 7, 70, line, m1.manifestUid, m1.digest]);
  assert.equal(r.body.head_seq, headOf(w, line).s);
  assert.deepEqual(r.body.record, {
    v: 1, line, manifest: m1.manifestUid, digest: m1.digest, audience: 'public',
    components: [
      { asset: website.asset, revision: website.rev, digest: website.digest, role: 'website' },
      { asset: copy.asset, revision: copy.rev, digest: copy.digest, role: 'copy' },
    ],
  });
  // No content and no source locator: the stored record's key, the pieces' sources and kinds never leave.
  for (const leak of ['acme/site', 'documents', 'source', 'locator', 'release_key', 'release:', '"kind"']) assert.ok(!r.text.includes(leak), `leaked ${leak}`);
  assert.ok(r.body.cost.d1Statements === 5 && r.body.cost.d1Batches === 0 && r.body.cost.r2Requests === 1, JSON.stringify(r.body.cost));
  assert.equal(files.count('get'), 2, 'one get for the undelivered read, one for this one');

  // The pointer moves to m2: m1's record is still in the bucket (write-once), and is never shown again.
  const website2 = await revise(w, website, 'pub-website-v2');
  await attestAll(w, website2, ['code']);
  const m2 = await cutPublic(w, line, website2, copy, 'm2');
  await pub(w, line, m2, m1.manifestUid, 'pub-m2');
  r = await read(env);
  assert.deepEqual([r.status, r.body.error], [404, 'not_delivered'], 'the pointer names m2, whose record is not there yet');
  assert.ok(files.objects.has(siteRecordKey({ tenantId: 7, companyId: 70, ref: SITE, manifestUid: m1.manifestUid })));
  await drain(env);
  r = await read(env);
  assert.deepEqual([r.status, r.body.manifest_uid, r.body.digest, r.body.head_seq, r.body.record.components[0].revision],
    [200, m2.manifestUid, m2.digest, headOf(w, line).s, website2.rev]);

  // m3 is published without this site: the site shows nothing rather than m2's record.
  const website3 = await revise(w, website2, 'pub-website-v3');
  await attestAll(w, website3, ['code']);
  const m3 = await cutPublic(w, line, website3, copy, 'm3');
  await pub(w, line, m3, m2.manifestUid, 'pub-m3', toSite('other-site'));
  await drain(env);
  r = await read(env);
  assert.deepEqual([r.status, r.body.error], [404, 'not_delivered']);
  assert.equal((await read(env, 7, 70, 'other-site')).body.manifest_uid, m3.manifestUid, 'the other site shows m3');

  // Another line of the company publishes to the site later: the site follows that line's pointer from then on.
  const line2 = await newLine(w, 'line-public-2', 'public');
  const n1 = await cutPublic(w, line2, website3, copy, 'n1');
  await pub(w, line2, n1, null, 'pub-n1');
  await drain(env);
  r = await read(env);
  assert.deepEqual([r.status, r.body.line, r.body.manifest_uid], [200, line2, n1.manifestUid]);
  assert.equal((await read(env, 7, 70, 'other-site')).body.manifest_uid, m3.manifestUid, 'each site follows its own line');
});

test('3. a takedown or a tombstoned pin withdraws the record at once, before its retraction is delivered', async () => {
  const w = fresh();
  const files = new FakeBucket();
  const env = envOf(w, { FILES: files });
  const { website, copy } = await publicLine(w);
  const line = await newLine(w, 'line-public', 'public');
  const m1 = await cutPublic(w, line, website, copy, 'm1');
  await pub(w, line, m1, null, 'pub-m1');
  await drain(env);
  assert.equal((await read(env)).status, 200);

  // A tombstoned pin: the copy moves on, and its pinned revision is tombstoned.
  const copy2 = await revise(w, copy, 'pub-copy-v2');
  assert.ok((await tombstoneRevision(w.env, CTX, { revisionUid: copy.rev, actor: { kind: 'person', userId: BOB }, reason: 'retired' })).ok);
  const gets = files.count('get');
  let r = await read(env);
  assert.deepEqual([r.status, r.body.error, r.cache], [410, 'withdrawn', 'no-store']);
  assert.equal(files.count('get'), gets, 'a withdrawn release is not even read from R2');
  assert.ok(files.objects.has(siteRecordKey({ tenantId: 7, companyId: 70, ref: SITE, manifestUid: m1.manifestUid })), 'the record is still in the bucket');
  for (const leak of [m1.manifestUid, m1.digest, copy.rev]) assert.ok(!r.text.includes(leak), 'a withdrawn answer names nothing');

  // A takedown of the next release, before the retraction effect is drained.
  await attestAll(w, copy2, ['marketing']);
  const m2 = await cutPublic(w, line, website, copy2, 'm2');
  await pub(w, line, m2, m1.manifestUid, 'pub-m2');
  await drain(env);
  assert.equal((await read(env)).body.manifest_uid, m2.manifestUid);
  const td = await takedownRelease(w.env, CTX, {
    lineAssetUid: line, manifestUid: m2.manifestUid, digest: m2.digest, reasonCode: 'rights_withdrawn', evidenceRef: 'notice:1',
    authority: 'security_officer', actor: SAM, idempotencyKey: 'td-m2',
  });
  assert.ok(td.ok, JSON.stringify(td));
  const key2 = siteRecordKey({ tenantId: 7, companyId: 70, ref: SITE, manifestUid: m2.manifestUid });
  assert.ok(files.objects.has(key2), 'the retraction is not delivered yet');
  r = await read(env);
  assert.deepEqual([r.status, r.body.error], [410, 'withdrawn']);
  await drain(env);
  assert.ok(!files.objects.has(key2), 'the drain retracts the record');
  assert.deepEqual([(await read(env)).status, (await read(env)).body.error], [410, 'withdrawn']);
});

test('4. tenants: never another tenant\'s record; a mismatched record is refused; a non-public line is never shown', async () => {
  const w = fresh();
  const files = new FakeBucket();
  const env = envOf(w, { FILES: files });
  const { website, copy } = await publicLine(w);
  const line = await newLine(w, 'line-public', 'public');
  const m1 = await cutPublic(w, line, website, copy, 'site-m1');
  await pub(w, line, m1, null, 'site-pub-m1');
  await drain(env);

  // Another tenant or company asking for the same site name reads no line and no R2 object.
  const gets = files.count('get');
  for (const [t, co] of [[8, 80], [8, 70], [7, 71], [70, 7]]) {
    const r = await read(env, t, co);
    assert.deepEqual([r.status, r.body.error], [404, 'not_found'], `${t}/${co}`);
    assert.ok(!r.text.includes(m1.manifestUid));
  }
  assert.equal(files.count('get'), gets);

  // Tenant 8 publishes its own site of the same name: each tenant sees its own release.
  const other = await publicLine(w, OTHER_CTX, '-8');
  const l8 = await registerReleaseLine(w.env, OTHER_CTX, { scope: OTHER, audience: 'public', actor: { kind: 'person', userId: ALICE }, idempotencyKey: 'line-8' });
  assert.ok(l8.ok);
  // Tenant 8's pieces carry part 1's attestations under its own scope.
  for (const [p, prof] of [[other.website, 'code'], [other.copy, 'marketing']] as const) {
    const reqs = prof === 'code' ? [['pr_validated', null], ['ci_passed', null]] : [['brand_rights', 'brand_owner'], ['claims_review', 'brand_owner']];
    for (const [req, authority] of reqs) {
      const actor = authority ? { kind: 'person' as const, userId: CAROL } : { kind: 'agent' as const, agentRunId: 'run_ci', onBehalfOfUserId: BOB, chargeId: null };
      const a = await attestComponent(w.env, OTHER_CTX, { revisionUid: p.rev, digest: p.digest, requirement: req as any, evidenceRef: `ev:${p.key}:${req}`, authority, actor, idempotencyKey: `att8-${p.key}-${req}` });
      assert.ok(a.ok, JSON.stringify(a));
    }
  }
  const m8 = await cutPublic(w, l8.lineAssetUid, other.website, other.copy, 'm8', OTHER_CTX);
  await pub(w, l8.lineAssetUid, m8, null, 'pub-m8', toSite(), OTHER_CTX);
  await drain(env);
  const r7 = await read(env, 7, 70), r8 = await read(env, 8, 80);
  assert.deepEqual([r7.body.manifest_uid, r7.body.tenant_id], [m1.manifestUid, 7]);
  assert.deepEqual([r8.body.manifest_uid, r8.body.tenant_id, r8.body.company_id], [m8.manifestUid, 8, 80]);
  assert.ok(!r8.text.includes(m1.manifestUid) && !r7.text.includes(m8.manifestUid));

  // Later outbox rows naming the site in another tenant, another company, or for another target never pick the line.
  const plant = w.db.prepare(`INSERT INTO work_graph_effects (tenant_id, company_id, asset_uid, effect_kind, idempotency_key, request_hash,
    payload_json, max_attempts, next_attempt_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 5, 0, '2026-11-19T10:00:00Z')`);
  for (const [t, co, kind] of [[8, 70, 'release_website_cdn'], [7, 71, 'release_website_cdn'], [7, 70, 'release_stream']] as const) {
    plant.run(t, co, l8.lineAssetUid, kind, `planted-${t}-${co}-${kind}`, 'b'.repeat(64), JSON.stringify({ target: kind.slice(8), ref: SITE }));
    const r = await read(env, 7, 70);
    assert.deepEqual([r.status, r.body.manifest_uid], [200, m1.manifestUid], `${t}/${co} ${kind}`);
  }

  // A record whose metadata names another tenant, or whose digest or pins differ from D1, is refused.
  const key = siteRecordKey({ tenantId: 7, companyId: 70, ref: SITE, manifestUid: m1.manifestUid });
  const good = structuredClone(files.objects.get(key)!);
  const tamper = async (f: (o: { body: string; customMetadata: Record<string, string> }) => void, code = 'record_mismatch') => {
    const o = structuredClone(good); f(o); files.objects.set(key, o);
    const r = await read(env);
    assert.deepEqual([r.status, r.body.error], [code === 'record_mismatch' ? 409 : 200, code === 'record_mismatch' ? code : undefined], code);
    files.objects.set(key, structuredClone(good));
    return r;
  };
  await tamper((o) => { o.customMetadata[SITE_META.tenant] = '8'; });
  await tamper((o) => { o.customMetadata[SITE_META.company] = '80'; });
  await tamper((o) => { o.customMetadata[SITE_META.manifest] = m8.manifestUid; });
  await tamper((o) => { o.customMetadata[SITE_META.digest] = m8.digest; });
  await tamper((o) => { o.body = 'not json'; });
  const edit = (f: (b: any) => void) => (o: { body: string }) => { const b = JSON.parse(o.body); f(b); o.body = JSON.stringify(b); };
  await tamper(edit((b) => { b.digest = m8.digest; }));
  await tamper(edit((b) => { b.manifest = m8.manifestUid; }));
  await tamper(edit((b) => { b.line = l8.lineAssetUid; }));
  await tamper(edit((b) => { b.audience = 'investors'; }));
  await tamper(edit((b) => { b.v = 2; }));
  await tamper(edit((b) => { b.components[1].digest = b.components[0].digest; }));
  await tamper(edit((b) => { b.components[0].revision = other.website.rev; }));
  await tamper(edit((b) => { b.components[0].asset = other.website.asset; }));
  await tamper(edit((b) => { b.components[1].role = 'website'; }));
  await tamper(edit((b) => { b.components.pop(); }));
  await tamper(edit((b) => { b.components.push(b.components[0]); }));
  await tamper(edit((b) => { b.components = null; }));
  // Extra fields in a matching record are never echoed: the answer is rebuilt from the checked ids.
  const extra = await tamper(edit((b) => { b.secret = 'draft copy'; b.components[0].body = 'content'; }), 'ok');
  assert.ok(!extra.text.includes('draft copy') && !extra.text.includes('content'));

  // A non-public line is never shown, even with an outbox row and a record for the site.
  const inv = await published(w);
  const invMan = inv.m;
  w.db.prepare(`INSERT INTO work_graph_effects (tenant_id, company_id, asset_uid, effect_kind, idempotency_key, request_hash, payload_json, max_attempts, next_attempt_ms, created_at)
    VALUES (7, 70, ?, 'release_website_cdn', 'planted', ?, ?, 5, 0, '2026-11-19T10:00:00Z')`)
    .run(inv.c.line, 'a'.repeat(64), JSON.stringify({ manifest: invMan.manifestUid, digest: invMan.digest, line: inv.c.line, audience: 'investors', target: 'website_cdn', ref: 'investor-site' }));
  files.objects.set(siteRecordKey({ tenantId: 7, companyId: 70, ref: 'investor-site', manifestUid: invMan.manifestUid }), {
    body: JSON.stringify({ v: 1, line: inv.c.line, manifest: invMan.manifestUid, digest: invMan.digest, audience: 'investors', components: [] }),
    customMetadata: { [SITE_META.tenant]: '7', [SITE_META.company]: '70', [SITE_META.manifest]: invMan.manifestUid, [SITE_META.digest]: invMan.digest },
  });
  const r = await read(env, 7, 70, 'investor-site');
  assert.deepEqual([r.status, r.body.error], [404, 'not_found']);
  assert.ok(!r.text.includes(invMan.manifestUid));
});

test('5. malformed paths, a missing bucket and a failing bucket', async () => {
  for (const [t, co, s] of [['0', '70', SITE], ['7', '0', SITE], ['x', '70', SITE], ['7', '-1', SITE], ['07', '70', SITE], ['7', '70', 'Bad_Site'],
    ['7', '70', '-site'], ['7', '70', 'a'.repeat(64)], ['99999999999999999', '70', SITE]] as const) {
    const d = untouchable();
    const r = await read({ DB: d.b, WORK_GRAPH_RELEASE_SITES: 'on' }, t, co, s);
    assert.deepEqual([r.status, r.body.error], [400, 'malformed'], `${t}/${co}/${s}`);
    assert.deepEqual(d.touched, [], 'a malformed path reads nothing');
  }
  const w = fresh();
  const files = new FakeBucket();
  const { website, copy } = await publicLine(w);
  const line = await newLine(w, 'line-public', 'public');
  const m1 = await cutPublic(w, line, website, copy, 'm1');
  await pub(w, line, m1, null, 'pub-m1');
  await drain(envOf(w, { FILES: files }));
  const none = await read(envOf(w, { FILES: undefined }));
  assert.deepEqual([none.status, none.body.error, none.body.cost.r2Requests], [503, 'unavailable', 0]);
  files.fail = true;
  const down = await read(envOf(w, { FILES: files }));
  assert.deepEqual([down.status, down.body.error, down.body.cost.r2Requests], [503, 'unavailable', 1]);
  assert.ok(!down.text.includes('r2 down'), 'the thrown text is never sent');
  files.fail = false;
  assert.equal((await read(envOf(w, { FILES: files }))).status, 200);
  // A failing D1 is 503 too, and its text is never sent either.
  const broken = { prepare() { throw new Error('d1 down: SELECT secret'); } };
  const d1 = await read(envOf(null, { DB: broken, FILES: files }));
  assert.deepEqual([d1.status, d1.body.error], [503, 'unavailable']);
  assert.ok(!d1.text.includes('d1 down') && !d1.text.includes('secret'));
});

test('6. revoked people: resolved per scope; their decisions stop counting and they cannot decide; reactivation restores', async () => {
  const w = fresh();
  const env = envOf(w, { FILES: new FakeBucket() });
  const scope = { tenantId: 7, companyId: 70, projectId: null };
  // The real context, with the authorities replaced by part 2's people (part 8's store is tested on its own).
  const realAuthorities = RELEASE_ADMIN_DEPS.authorities;
  RELEASE_ADMIN_DEPS.authorities = async () => CTX.authorities!;
  try {
    assert.deepEqual([...(await releaseAdminContext(w.env, scope)).revokedUserIds!], []);
    // Linked, but in no release record yet: still resolved. Another company's revoked person is not.
    deactivate(w, 21); deactivate(w, 22);
    // 22 also approved a head in tenant 8: that names them there, never here.
    await reviseBy(w, await piece(w, 'x8', 'document', 'public', { scope: OTHER, ctx: OTHER_CTX }), 'x8-v2', 22, OTHER_CTX);
    assert.deepEqual([...(await revokedReleaseUsers(w.env, scope))], [21]);
    assert.deepEqual([...(await revokedReleaseUsers(w.env, { tenantId: 8, companyId: 80 }))], [22]);
    assert.deepEqual([...(await revokedReleaseUsers(w.env, { tenantId: 0, companyId: 70 }))], [], 'a bad scope resolves nobody');

    const { website, copy } = await publicLine(w);
    const line = await newLine(w, 'line-public', 'public');
    const m = await cutPublic(w, line, website, copy, 'm1');
    // ALICE is linked to no company but authored the manifest: resolved. ERIN is named by no record of this scope: not.
    deactivate(w, ALICE); deactivate(w, ERIN);
    assert.deepEqual([...(await revokedReleaseUsers(w.env, scope))].sort((a, b) => a - b), [ALICE, 21]);
    deactivate(w, ALICE, 1);

    // Unlinked people named only as a reviewer (ERIN), an agent's sponsor on an attestation (DAVE) or the approver of a
    // component head (NOBODY) are resolved too, each from their own record.
    const aux = await newLine(w, 'line-aux', 'public');
    const mAux = await cutManifest(w.env, CTX, {
      lineAssetUid: aux, partial: false, author: { kind: 'person', userId: ALICE }, idempotencyKey: 'aux',
      components: [{ assetUid: website.asset, revisionUid: website.rev, digest: website.digest, role: 'website', profile: 'code' }],
    });
    assert.ok(mAux.ok);
    const asErin = { ...CTX, authorities: new Map([[ERIN, ['maintainer']]]) };
    assert.ok((await decideRelease(w.env, asErin, decision(mAux.manifestUid, mAux.digest, 'code', 'erin', { reviewer: { kind: 'person', userId: ERIN } }, 'public'))).ok);
    assert.ok((await attestComponent(w.env, CTX, {
      revisionUid: website.rev, digest: website.digest, requirement: 'pr_validated', evidenceRef: 'ev:dave', authority: null,
      actor: { kind: 'agent', agentRunId: 'run_dave', onBehalfOfUserId: DAVE, chargeId: null }, idempotencyKey: 'att-dave',
    })).ok);
    const extra = await reviseBy(w, await piece(w, 'pub-extra', 'document', 'public'), 'pub-extra-v2', NOBODY_ID);
    await attestAll(w, extra, ['marketing']);
    for (const id of [ERIN, DAVE, NOBODY_ID]) {
      deactivate(w, id);
      assert.ok((await revokedReleaseUsers(w.env, scope)).has(id), `${id} resolved`);
    }
    // A revoked approver of a pinned head refuses publication outright.
    const mNobody = await cutPublic(w, await newLine(w, 'line-nobody', 'public'), website, extra, 'm-nobody');
    const viaNobody = await admin(env, 'POST', `/manifests/${mNobody.manifestUid}/publish`, { ...IN, digest: mNobody.digest, expected_manifest_uid: null, effects: [], idempotency_key: 'p-nobody' });
    assert.deepEqual([viaNobody.status, viaNobody.body.error], [409, 'revoked_author']);
    for (const id of [ERIN, DAVE, NOBODY_ID]) deactivate(w, id, 1);

    // CAROL (brand owner, the marketing reviewer) is revoked: her approval stops counting, everywhere it is read.
    deactivate(w, CAROL);
    const ctx = await releaseAdminContext(w.env, scope);
    assert.ok(ctx.revokedUserIds!.has(CAROL) && !ctx.revokedUserIds!.has(BOB));
    const status = await admin(env, 'GET', `/manifests/${m.manifestUid}?tenant_id=7&company_id=70`);
    assert.deepEqual([status.status, status.body.release.missingApprovals, status.body.release.approvals.map((a: any) => a.reviewerUserId)], [200, ['marketing'], [BOB]]);
    const body = (key: string) => ({ ...IN, digest: m.digest, expected_manifest_uid: null, effects: toSite(), idempotency_key: key });
    const refused = await admin(env, 'POST', `/manifests/${m.manifestUid}/publish`, body('p-1'));
    assert.deepEqual([refused.status, refused.body.error], [409, 'approval_required']);
    // A revoked reviewer cannot record a decision.
    const d = await decideRelease(w.env, ctx, decision(m.manifestUid, m.digest, 'marketing', 'carol-again', {}, 'public'));
    assert.equal(!d.ok && d.code, 'revoked_author');

    // CAROL back, BOB (the maintainer, the code reviewer) revoked: now the code approval is the one that is missing.
    deactivate(w, CAROL, 1); deactivate(w, BOB);
    const swapped = await admin(env, 'GET', `/manifests/${m.manifestUid}?tenant_id=7&company_id=70`);
    assert.deepEqual(swapped.body.release.missingApprovals, ['code']);
    const blocked = await admin(env, 'POST', `/manifests/${m.manifestUid}/publish`, body('p-2'));
    assert.deepEqual([blocked.status, blocked.body.error], [409, 'approval_required']);

    // Reactivated, both count again on the next request.
    deactivate(w, BOB, 1);
    const ok = await admin(env, 'POST', `/manifests/${m.manifestUid}/publish`, body('p-3'));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual([...(await revokedReleaseUsers(w.env, scope))], [21]);
  } finally {
    RELEASE_ADMIN_DEPS.authorities = realAuthorities;
  }
});
