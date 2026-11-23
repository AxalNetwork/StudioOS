/**
 * D5585 part 6 (#5585, WorkGraph P1) — the `website_cdn` and `external_distribution` adapters, through the real
 * handler map and the preview-gated drain, on part 2's real SQLite world. No test reaches a provider: R2 is a fake
 * `FILES` bucket and the distribution channel is a fake injected channel; both record every request.
 *
 *   1. A public release is written once to its site record (ids only, write-once, under `release-sites/`) and posted
 *      once to a channel, with its cost; a second drain sends nothing.
 *   2. An ambiguous write (the put or the post landed, the answer was lost) is found by the next lookup, never resent.
 *   3. No bucket, no channel, a malformed ref, an unknown channel, another tenant's destination and an audience the
 *      target cannot carry are refused without a provider request, and each refusal is an outbox audit row.
 *   4. Cross-tenant: a record held under the key for another tenant is refused `wrong_tenant` and never overwritten;
 *      a forged effect naming this release from another tenant is withheld by the handler with no request.
 *   5. Stale writes: a superseded effect and a stale digest are withheld with no request; a record of the same
 *      manifest under another key or digest is `digest_conflict`, never overwritten.
 *   6. A takedown retracts both: the site record is deleted (a lost delete answer is reconciled) and the channel's
 *      posts are withdrawn (a 404 is already gone); a takedown before delivery sends nothing.
 *   7. Channel errors: 401, 4xx and 5xx map to their codes, and a lookup that cannot read everything posts nothing.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_release_distribution_5585.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALICE, CTX, ERIN, OTHER, SCOPE, approvedManifest, attestAll, campaign, clock, decision, newLine, piece, publish,
  revise, type Piece, type W, world,
} from './_work_graph_release_world_5585.ts';
import { WORK_GRAPH_EFFECT_LIMITS } from '../src/services/workGraphEffects.ts';
import { blobPrefix } from '../src/services/workGraphBlobs.ts';
import { DeliveryRetry, RELEASE_RETRACT_KIND } from '../src/services/workGraphReleaseDelivery.ts';
import { cutManifest, decideRelease } from '../src/services/workGraphReleases.ts';
import { takedownRelease } from '../src/services/workGraphReleaseTakedowns.ts';
import { drainReleaseEffects } from '../src/services/workGraphReleaseAdapters.ts';
import { ChannelError } from '../src/services/eventSyndication/channelError.ts';
import {
  RELEASE_DISTRIBUTION_CHANNELS, SITE_META, externalDistributionAdapter, siteRecordKey, websiteCdnAdapter,
  type DistributionRecord, type ReleaseDistributionChannel,
} from '../src/services/workGraphReleaseDistribution.ts';

const SITE = 'campaign-site';
const DEST = 'ir_list:acme-investors';

// ---- R2: a fake FILES bucket -------------------------------------------------------------------------------------------
class FakeBucket {
  objects = new Map<string, { body: string; customMetadata: Record<string, string>; httpMetadata: any }>();
  requests: { fn: string; key: string }[] = [];
  /** Apply the next put or delete, then lose its answer. */
  loseNext: 'put' | 'delete' | null = null;
  async head(key: string) {
    this.requests.push({ fn: 'head', key });
    const o = this.objects.get(key);
    return o ? { key, customMetadata: { ...o.customMetadata } } : null;
  }
  async put(key: string, body: string, opts: any) {
    this.requests.push({ fn: 'put', key });
    this.objects.set(key, { body, customMetadata: { ...opts.customMetadata }, httpMetadata: opts.httpMetadata });
    if (this.loseNext === 'put') { this.loseNext = null; throw new Error('timeout'); }
    return { key };
  }
  async delete(key: string) {
    this.requests.push({ fn: 'delete', key });
    this.objects.delete(key);
    if (this.loseNext === 'delete') { this.loseNext = null; throw new Error('timeout'); }
  }
  count(fn: string) { return this.requests.filter((r) => r.fn === fn).length; }
}

// ---- A fake outside channel ------------------------------------------------------------------------------------------
class FakeChannel implements ReleaseDistributionChannel {
  audiences: readonly ('internal' | 'investors' | 'partners' | 'public')[] = ['investors', 'public'];
  /** Which tenant/company owns each destination. */
  owners = new Map<string, string>([['acme-investors', '7/70'], ['rival-list', '8/80']]);
  records: (DistributionRecord & { body: any })[] = [];
  requests: { fn: string; dest: string }[] = [];
  next = 40;
  complete = true;
  failNext: { fn: string; status: number | null } | null = null;
  loseNextPost = false;
  owns(dest: string, s: { tenantId: number; companyId: number }) { return this.owners.get(dest) === `${s.tenantId}/${s.companyId}`; }
  private fail(fn: string) {
    if (this.failNext?.fn === fn) { const st = this.failNext.status; this.failNext = null; throw st === null ? new Error('reset') : new ChannelError('refused', st); }
  }
  async find(dest: string, q: { key: string } | { manifestUid: string }) {
    this.requests.push({ fn: 'find', dest });
    this.fail('find');
    const records = this.records.filter((r) => ('key' in q ? r.key === q.key : r.manifestUid === q.manifestUid)).map(({ body, ...r }) => r);
    return { complete: this.complete, records };
  }
  async post(dest: string, rec: any) {
    this.requests.push({ fn: 'post', dest });
    this.fail('post');
    const r = { externalId: `post-${++this.next}`, key: rec.release_key, manifestUid: rec.manifest, digest: rec.digest, tenantId: rec.tenantId, companyId: rec.companyId, body: rec };
    this.records.push(r);
    if (this.loseNextPost) { this.loseNextPost = false; throw new Error('socket hang up'); }
    const { body, ...out } = r;
    return out;
  }
  async withdraw(dest: string, id: string) {
    this.requests.push({ fn: 'withdraw', dest });
    this.fail('withdraw');
    const i = this.records.findIndex((r) => r.externalId === id);
    if (i < 0) throw new ChannelError('gone', 404);
    this.records.splice(i, 1);
  }
  count(fn: string) { return this.requests.filter((r) => r.fn === fn).length; }
}

function live(w: W, over: Record<string, unknown> = {}) {
  const bucket = new FakeBucket();
  const channel = new FakeChannel();
  const env = { DB: w.env.DB, WORK_GRAPH_RELEASE_DELIVERY: 'preview', FILES: bucket, ...over } as any;
  return { bucket, channel, env, channels: { ir_list: channel } as Record<string, ReleaseDistributionChannel> };
}
type Live = ReturnType<typeof live>;
async function drain(x: Live, opts: Record<string, unknown> = {}) {
  const r = await drainReleaseEffects(x.env, { distributionChannels: x.channels, ...opts });
  assert.ok(r.ok, JSON.stringify(r));
  return r;
}
const deliveries = (w: W) => w.db.prepare('SELECT * FROM work_graph_release_deliveries ORDER BY effect_id').all() as any[];
const effectRows = (w: W) => w.db.prepare('SELECT id, effect_kind, state, attempts, last_error_code FROM work_graph_effects ORDER BY id').all() as any[];
const audits = (w: W) => (w.db.prepare("SELECT effect_id, action, detail_json FROM work_graph_integrity_events WHERE action IN ('effect_retry', 'effect_dead') ORDER BY id").all() as any[])
  .map((a) => [a.effect_id, a.action, JSON.parse(a.detail_json).error]);
const later = (ms: number) => { clock.t += ms; };
const requests = (x: Live) => x.bucket.requests.length + x.channel.requests.length;

const PUBLIC_EFFECTS = [{ target: 'website_cdn' as const, ref: SITE }, { target: 'external_distribution' as const, ref: DEST }];

/** A public release: a website commit and its copy, both public, attested and approved for the public. */
async function publicRelease(w: W, effects: { target: any; ref: string }[] = PUBLIC_EFFECTS) {
  const website = await piece(w, 'pub-website', 'code', 'public');
  const copy = await piece(w, 'pub-copy', 'document', 'public');
  await attestAll(w, website, ['code']);
  await attestAll(w, copy, ['marketing']);
  const line = await newLine(w, 'line-public', 'public');
  const m = await cutPublic(w, line, website, copy, 'pm1');
  const r = await publish(w, line, m.manifestUid, null, 'pub-pm1', CTX, effects);
  assert.ok(r.ok, JSON.stringify(r));
  return { website, copy, line, m, effectIds: r.effectIds };
}
async function cutPublic(w: W, line: string, website: Piece, copy: Piece, key: string) {
  const m = await cutManifest(w.env, CTX, {
    lineAssetUid: line, partial: false, author: ALICE, idempotencyKey: key,
    components: [
      { assetUid: website.asset, revisionUid: website.rev, digest: website.digest, role: 'website', profile: 'code' },
      { assetUid: copy.asset, revisionUid: copy.rev, digest: copy.digest, role: 'copy', profile: 'marketing' },
    ],
  });
  assert.ok(m.ok, JSON.stringify(m));
  for (const prof of ['code', 'marketing'] as const) {
    const d = await decideRelease(w.env, CTX, decision(m.manifestUid, m.digest, prof, `${key}-${prof}`, {}, 'public'));
    assert.ok(d.ok, JSON.stringify(d));
  }
  return m;
}
const keyOf = (m: { manifestUid: string }) => siteRecordKey({ tenantId: 7, companyId: 70, ref: SITE, manifestUid: m.manifestUid });

test('1. a public release: one write-once site record and one channel post, ids only, with their cost', async () => {
  const w = world();
  const { m, line, effectIds, website, copy } = await publicRelease(w);
  const x = live(w);
  const r = await drain(x);
  assert.deepEqual(r.results.map((e) => e.status), ['applied', 'applied']);
  // R2: head (lookup) + put; channel: find (lookup) + post.
  assert.equal(r.providerRequests, 4);
  assert.deepEqual(r.providerRequestsByTarget, { github_pr: 0, stream: 0, signed_document: 0, website_cdn: 2, external_distribution: 2 });
  const key = keyOf(m);
  assert.equal(key, `release-sites/t7/c70/${SITE}/${m.manifestUid}.json`);
  assert.ok(!key.startsWith('wg/v1/') && !key.startsWith(blobPrefix(SCOPE)), 'never a write-once record (D6651), never a blob #5581 reconcile lists');
  const o = x.bucket.objects.get(key)!;
  const releaseKey = `release:${m.manifestUid}:website_cdn:${SITE}`;
  assert.deepEqual(o.customMetadata, {
    [SITE_META.key]: releaseKey, [SITE_META.manifest]: m.manifestUid, [SITE_META.digest]: m.digest, [SITE_META.tenant]: '7', [SITE_META.company]: '70',
  });
  assert.equal(o.httpMetadata.contentType, 'application/json; charset=utf-8');
  const body = JSON.parse(o.body);
  assert.deepEqual(body, {
    audience: 'public', digest: m.digest, line, manifest: m.manifestUid, release_key: releaseKey, v: 1,
    components: [
      { asset: website.asset, digest: website.digest, revision: website.rev, role: 'website' },
      { asset: copy.asset, digest: copy.digest, revision: copy.rev, role: 'copy' },
    ],
  });
  assert.ok(!/acme\/site|"store"|"locator"|documents/.test(o.body), 'ids only: no source locators');
  const post = x.channel.records[0];
  assert.deepEqual([post.key, post.manifestUid, post.digest, post.tenantId, post.companyId, post.body.audience],
    [`release:${m.manifestUid}:external_distribution:${DEST}`, m.manifestUid, m.digest, 7, 70, 'public']);
  assert.ok(!JSON.stringify(post.body).includes('locator'));
  assert.deepEqual(deliveries(w).map((d) => [d.effect_id, d.target, d.outcome, d.reconciled, d.provider_calls, d.external_ref]), [
    [effectIds[0], 'website_cdn', 'confirmed', 0, 2, `site:${SITE}:${m.manifestUid}`],
    [effectIds[1], 'external_distribution', 'confirmed', 0, 2, 'dist:ir_list:post-41'],
  ]);
  assert.ok(deliveries(w).every((d) => d.d1_statements >= 4));
  const again = await drain(x);
  assert.equal(again.results.length + again.providerRequests, 0);
  assert.equal(x.bucket.count('put') + x.channel.count('post'), 2);
});

test('2. an ambiguous write is found by the next lookup and never sent again', async () => {
  const w = world();
  const { m, effectIds } = await publicRelease(w);
  const x = live(w);
  x.bucket.loseNext = 'put';
  x.channel.loseNextPost = true;
  let r = await drain(x);
  assert.deepEqual(r.results.map((e) => e.status), ['retry', 'retry']);
  assert.deepEqual(effectRows(w).map((e) => e.last_error_code), ['provider_unavailable', 'provider_unavailable']);
  assert.equal(deliveries(w).length, 0, 'an answer that never came is not a delivery');
  later(WORK_GRAPH_EFFECT_LIMITS.baseBackoffMs);
  r = await drain(x);
  assert.deepEqual(r.results.map((e) => e.status), ['applied', 'applied']);
  assert.equal(r.providerRequests, 2, 'lookups only');
  assert.equal(x.bucket.count('put'), 1);
  assert.equal(x.channel.count('post'), 1);
  assert.equal(x.channel.records.length, 1);
  assert.deepEqual(deliveries(w).map((d) => [d.effect_id, d.outcome, d.reconciled, d.attempt, d.provider_calls, d.external_ref]), [
    [effectIds[0], 'confirmed', 1, 2, 1, `site:${SITE}:${m.manifestUid}`], [effectIds[1], 'confirmed', 1, 2, 1, 'dist:ir_list:post-41'],
  ]);
});

test('3. missing provider, bad refs, foreign destinations and audiences are refused without a request, and audited', async () => {
  // No FILES bucket and no channel registered (main's registry is empty).
  let w = world();
  await publicRelease(w);
  let x = live(w, { FILES: undefined });
  assert.equal(Object.keys(RELEASE_DISTRIBUTION_CHANNELS).length, 0, 'no channel is registered on main');
  let r = await drain(x, { distributionChannels: undefined });
  assert.deepEqual(effectRows(w).map((e) => e.last_error_code), ['target_not_configured', 'target_not_configured']);
  assert.equal(requests(x) + r.providerRequests, 0);
  assert.deepEqual(audits(w).map((a) => [a[1], a[2]]), [['effect_retry', 'target_not_configured'], ['effect_retry', 'target_not_configured']]);

  // A site ref that is not a DNS label, and a distribution ref without a channel.
  w = world();
  await publicRelease(w, [{ target: 'website_cdn', ref: 'Campaign_Site' }, { target: 'external_distribution', ref: 'acme-investors' }]);
  x = live(w);
  r = await drain(x);
  assert.deepEqual(effectRows(w).map((e) => e.last_error_code), ['malformed_ref', 'malformed_ref']);
  assert.equal(requests(x) + r.providerRequests, 0);

  // An unknown channel, and a destination another tenant owns.
  w = world();
  await publicRelease(w, [{ target: 'external_distribution', ref: 'newsletter:acme-investors' }, { target: 'external_distribution', ref: 'ir_list:rival-list' }]);
  x = live(w);
  r = await drain(x);
  assert.deepEqual(effectRows(w).map((e) => e.last_error_code), ['target_not_configured', 'ref_out_of_scope']);
  assert.equal(requests(x) + r.providerRequests, 0);
  assert.deepEqual(audits(w).map((a) => a[2]), ['target_not_configured', 'ref_out_of_scope']);

  // A channel that does not carry the audience: the investors campaign on a public-only channel.
  w = world();
  const c = await campaign(w);
  const m = await approvedManifest(w, c.line, c.p, 'm1', c.p.evidence.rev);
  assert.ok((await publish(w, c.line, m.manifestUid, null, 'pub-m1', CTX, [{ target: 'external_distribution', ref: DEST }])).ok);
  x = live(w);
  x.channel.audiences = ['public'];
  r = await drain(x);
  assert.deepEqual(effectRows(w).map((e) => e.last_error_code), ['audience_forbidden']);
  assert.equal(requests(x) + r.providerRequests, 0);
  // The same channel carrying investors delivers it.
  x.channel.audiences = ['investors'];
  later(WORK_GRAPH_EFFECT_LIMITS.baseBackoffMs);
  r = await drain(x);
  assert.deepEqual(r.results.map((e) => e.status), ['applied']);

  // A website takes a public release only, whatever the effect says (part 1 refuses it at publication as well).
  const meter = { n: 0, count() { this.n++; } };
  const cdn = websiteCdnAdapter({ FILES: x.bucket as any }, meter);
  const req = { op: 'publish', idempotencyKey: 'k', target: 'website_cdn', tenantId: 7, companyId: 70, ref: SITE, lineAssetUid: c.line, manifestUid: m.manifestUid, digest: m.digest, audience: 'investors', components: [] } as any;
  for (const fn of ['lookup', 'send'] as const) {
    await assert.rejects(cdn[fn](req), (e: any) => e instanceof DeliveryRetry && e.code === 'audience_forbidden');
  }
  assert.equal(meter.n + x.bucket.requests.length, 0);
});

test('4. cross-tenant: another tenant’s record is never taken or overwritten, and a forged effect is withheld', async () => {
  const w = world();
  const { m } = await publicRelease(w);
  const x = live(w);
  // A record under this key claiming another tenant, and a channel record of this key sent for another tenant.
  x.bucket.objects.set(keyOf(m), { body: '{"forged":true}', customMetadata: { [SITE_META.tenant]: '8', [SITE_META.company]: '80', [SITE_META.manifest]: m.manifestUid }, httpMetadata: {} });
  x.channel.records.push({ externalId: 'post-x', key: `release:${m.manifestUid}:external_distribution:${DEST}`, manifestUid: m.manifestUid, digest: m.digest, tenantId: 8, companyId: 80, body: {} });
  await drain(x);
  assert.deepEqual(effectRows(w).map((e) => e.last_error_code), ['wrong_tenant', 'wrong_tenant']);
  assert.equal(x.bucket.count('put') + x.channel.count('post'), 0);
  assert.equal(x.bucket.objects.get(keyOf(m))!.body, '{"forged":true}', 'never overwritten');
  assert.equal(deliveries(w).length, 0);

  // A forged effect in another tenant naming this release: withheld by the handler, no request.
  const w2 = world();
  const s = await publicRelease(w2, []);
  for (const [kind, target, ref] of [['release_website_cdn', 'website_cdn', SITE], ['release_external_distribution', 'external_distribution', DEST]]) {
    w2.db.prepare(
      `INSERT INTO work_graph_effects (tenant_id, company_id, asset_uid, effect_kind, idempotency_key, request_hash, payload_json, max_attempts, next_attempt_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 5, 0, '2026-11-19T09:00:00Z')`,
    ).run(OTHER.tenantId, OTHER.companyId, s.line, kind, `forged-${target}`, 'f'.repeat(64),
      JSON.stringify({ audience: 'public', digest: s.m.digest, line: s.line, manifest: s.m.manifestUid, ref, target }));
  }
  const x2 = live(w2);
  const r = await drain(x2);
  assert.deepEqual(deliveries(w2).map((d) => [d.tenant_id, d.target, d.outcome, d.reason_code, d.provider_calls]), [
    [8, 'website_cdn', 'withheld', 'wrong_tenant', 0], [8, 'external_distribution', 'withheld', 'wrong_tenant', 0],
  ]);
  assert.equal(requests(x2) + r.providerRequests, 0);
});

test('5. stale writes: superseded and stale-digest effects are withheld, and a conflicting record is never overwritten', async () => {
  // m1 is superseded by m2 before its effects are delivered; m2's are delivered.
  let w = world();
  const s = await publicRelease(w);
  const copy2 = await revise(w, s.copy, 'pub-copy-v2');
  await attestAll(w, copy2, ['marketing']);
  const m2 = await cutPublic(w, s.line, s.website, copy2, 'pm2');
  assert.ok((await publish(w, s.line, m2.manifestUid, s.m.manifestUid, 'pub-pm2', CTX, PUBLIC_EFFECTS)).ok);
  let x = live(w);
  let r = await drain(x);
  assert.deepEqual(deliveries(w).map((d) => [d.manifest_uid, d.target, d.outcome, d.reason_code, d.provider_calls]), [
    [s.m.manifestUid, 'website_cdn', 'superseded', 'not_head', 0], [s.m.manifestUid, 'external_distribution', 'superseded', 'not_head', 0],
    [m2.manifestUid, 'website_cdn', 'confirmed', null, 2], [m2.manifestUid, 'external_distribution', 'confirmed', null, 2],
  ]);
  assert.deepEqual([...x.bucket.objects.keys()], [keyOf(m2)], 'the older release never reached the site');
  assert.deepEqual(x.channel.records.map((p) => p.manifestUid), [m2.manifestUid]);
  assert.equal(r.providerRequests, 4);

  // A stale digest in the effect: withheld, no request.
  w = world();
  const t = await publicRelease(w, []);
  w.db.prepare(
    `INSERT INTO work_graph_effects (tenant_id, company_id, asset_uid, effect_kind, idempotency_key, request_hash, payload_json, max_attempts, next_attempt_ms, created_at)
     VALUES (7, 70, ?, 'release_website_cdn', 'stale', ?, ?, 5, 0, '2026-11-19T09:00:00Z')`,
  ).run(t.line, 'a'.repeat(64), JSON.stringify({ audience: 'public', digest: 'b'.repeat(64), line: t.line, manifest: t.m.manifestUid, ref: SITE, target: 'website_cdn' }));
  x = live(w);
  r = await drain(x);
  assert.deepEqual(deliveries(w).map((d) => [d.outcome, d.reason_code, d.provider_calls]), [['withheld', 'stale_digest', 0]]);
  assert.equal(requests(x) + r.providerRequests, 0);

  // A record of this manifest already on the site under another key or digest, and a channel post of the key with
  // another digest: neither is taken as delivered nor overwritten.
  w = world();
  const u = await publicRelease(w);
  x = live(w);
  const foreign = { [SITE_META.key]: 'release:other', [SITE_META.manifest]: u.m.manifestUid, [SITE_META.digest]: u.m.digest, [SITE_META.tenant]: '7', [SITE_META.company]: '70' };
  x.bucket.objects.set(keyOf(u.m), { body: 'earlier', customMetadata: foreign, httpMetadata: {} });
  x.channel.records.push({ externalId: 'post-old', key: `release:${u.m.manifestUid}:external_distribution:${DEST}`, manifestUid: u.m.manifestUid, digest: 'c'.repeat(64), tenantId: 7, companyId: 70, body: {} });
  await drain(x);
  assert.deepEqual(effectRows(w).map((e) => e.last_error_code), ['digest_conflict', 'digest_conflict']);
  assert.equal(x.bucket.count('put') + x.channel.count('post'), 0);
  assert.equal(x.bucket.objects.get(keyOf(u.m))!.body, 'earlier');
  // Same key, other digest on the site.
  x.bucket.objects.set(keyOf(u.m), { body: 'earlier', customMetadata: { ...foreign, [SITE_META.key]: `release:${u.m.manifestUid}:website_cdn:${SITE}`, [SITE_META.digest]: 'd'.repeat(64) }, httpMetadata: {} });
  later(WORK_GRAPH_EFFECT_LIMITS.baseBackoffMs);
  await drain(x);
  assert.equal(effectRows(w)[0].last_error_code, 'digest_conflict');
  assert.equal(x.bucket.count('put'), 0);
});

test('6. a takedown retracts the site record and the channel posts; one before delivery sends nothing', async () => {
  const w = world();
  const s = await publicRelease(w);
  const x = live(w);
  await drain(x);
  // Another release's record on the same site, and another post on the channel, are untouched by the retraction.
  x.bucket.objects.set(`release-sites/t7/c70/${SITE}/other.json`, { body: '{}', customMetadata: {}, httpMetadata: {} });
  x.channel.records.push({ externalId: 'post-other', key: 'release:other', manifestUid: 'other', digest: 'e'.repeat(64), tenantId: 7, companyId: 70, body: {} });
  const td = await takedownRelease(w.env, CTX, {
    lineAssetUid: s.line, manifestUid: s.m.manifestUid, digest: s.m.digest, reasonCode: 'legal_order',
    evidenceRef: 'notice:order-6', authority: 'counsel', actor: ERIN, idempotencyKey: 'td-6',
  });
  assert.ok(td.ok && td.retractEffectIds.length === 2, JSON.stringify(td));
  x.bucket.loseNext = 'delete';
  let r = await drain(x);
  assert.deepEqual(r.results.map((e) => e.status).sort(), ['applied', 'retry']);
  assert.ok(!x.bucket.objects.has(keyOf(s.m)), 'the delete landed; its answer was lost');
  assert.deepEqual(x.channel.records.map((p) => p.externalId), ['post-other']);
  later(WORK_GRAPH_EFFECT_LIMITS.baseBackoffMs);
  r = await drain(x);
  assert.deepEqual(r.results.map((e) => e.status), ['applied']);
  assert.equal(x.bucket.count('delete'), 1, 'never deleted twice');
  assert.ok(x.bucket.objects.has(`release-sites/t7/c70/${SITE}/other.json`));
  const back = deliveries(w).filter((d) => d.op === 'retract').sort((a, b) => a.target.localeCompare(b.target));
  assert.deepEqual(back.map((d) => [d.target, d.outcome, d.reconciled]), [['external_distribution', 'retracted', 0], ['website_cdn', 'retracted', 1]]);
  assert.equal(effectRows(w).filter((e) => e.effect_kind === RELEASE_RETRACT_KIND && e.state === 'applied').length, 2);

  // A withdraw answered 404 (already gone) completes the retraction.
  const meter = { n: 0, count() { this.n++; } };
  const ch = new FakeChannel();
  ch.records.push({ externalId: 'post-9', key: 'k', manifestUid: 'man-9', digest: 'f'.repeat(64), tenantId: 7, companyId: 70, body: {} });
  ch.failNext = { fn: 'withdraw', status: 404 };
  const dist = externalDistributionAdapter({ ir_list: ch }, meter);
  const rq = { op: 'retract', idempotencyKey: 'r', target: 'external_distribution', tenantId: 7, companyId: 70, ref: DEST, lineAssetUid: 'l', manifestUid: 'man-9', digest: 'f'.repeat(64), audience: null, components: [] } as any;
  assert.deepEqual(await dist.send(rq), { status: 'confirmed', externalRef: 'dist:ir_list:post-9' });
  assert.equal(meter.n, 2);

  // Taken down before delivery: withheld, nothing reaches either provider.
  const w2 = world();
  const s2 = await publicRelease(w2);
  const td2 = await takedownRelease(w2.env, CTX, {
    lineAssetUid: s2.line, manifestUid: s2.m.manifestUid, digest: s2.m.digest, reasonCode: 'rights_withdrawn',
    evidenceRef: 'notice:rights-6', authority: 'counsel', actor: ERIN, idempotencyKey: 'td-6b',
  });
  assert.ok(td2.ok, JSON.stringify(td2));
  const x2 = live(w2);
  r = await drain(x2);
  assert.deepEqual(deliveries(w2).map((d) => [d.target, d.outcome, d.reason_code, d.provider_calls]), [
    ['website_cdn', 'withheld', 'taken_down', 0], ['external_distribution', 'withheld', 'taken_down', 0],
  ]);
  assert.equal(requests(x2) + r.providerRequests, 0);
});

test('7. channel errors map to their codes, and an incomplete lookup posts nothing', async () => {
  for (const [fn, status, code] of [
    ['post', 401, 'provider_unauthorized'], ['post', 422, 'provider_rejected'], ['post', 503, 'provider_unavailable'],
    ['post', null, 'provider_unavailable'], ['post', 429, 'provider_unavailable'], ['find', 403, 'provider_unauthorized'],
    ['find', 404, 'provider_rejected'],
  ] as const) {
    const w = world();
    await publicRelease(w, [PUBLIC_EFFECTS[1]]);
    const x = live(w);
    x.channel.failNext = { fn, status };
    await drain(x);
    assert.equal(effectRows(w)[0].last_error_code, code, `${fn} ${status}`);
    assert.equal(x.channel.records.length, 0);
  }
  const w = world();
  await publicRelease(w, [PUBLIC_EFFECTS[1]]);
  const x = live(w);
  x.channel.complete = false;
  await drain(x);
  assert.equal(effectRows(w)[0].last_error_code, 'lookup_incomplete');
  assert.equal(x.channel.count('post'), 0);
  // R2 itself failing: unknown, retried, nothing recorded.
  const w2 = world();
  await publicRelease(w2, [PUBLIC_EFFECTS[0]]);
  const x2 = live(w2);
  x2.bucket.head = async () => { throw new Error('r2 down'); };
  await drain(x2);
  assert.equal(effectRows(w2)[0].last_error_code, 'provider_unavailable');
  assert.equal(x2.bucket.count('put') + deliveries(w2).length, 0);
  // A put that returns no object, and a post whose answer names another key: neither is a delivery.
  const w3 = world();
  await publicRelease(w3);
  const x3 = live(w3);
  x3.bucket.put = async () => null as any;
  x3.channel.post = async () => ({ externalId: 'post-1', key: 'release:someone-else', manifestUid: 'm', digest: 'd', tenantId: 7, companyId: 70 });
  await drain(x3);
  assert.deepEqual(effectRows(w3).map((e) => e.last_error_code), ['provider_unavailable', 'provider_malformed']);
  assert.equal(deliveries(w3).length, 0);
});
