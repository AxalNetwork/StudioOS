/**
 * D5585 part 3 (#5585, WorkGraph P1) — the real provider adapters behind `releaseEffectHandlers` and the preview-gated
 * `drainReleaseEffects`, against a real SQLite database (part 2's world). No test reaches a provider: GitHub is a
 * stubbed `fetch` that keeps comments in memory, Stream is a fake `STREAM` binding, and both record every request.
 *
 *   1. Off by default: without `WORK_GRAPH_RELEASE_DELIVERY=preview` the drain reads and calls nothing.
 *   2. On: a GitHub PR comment and a Stream record are delivered once each, ids only, with D1 and provider cost; a
 *      second drain sends nothing.
 *   3. Ambiguous delivery per adapter: a send that landed but whose answer was lost is found by the next lookup and
 *      never sent again.
 *   4. Missing credentials, a ref the credentials do not reach and a malformed ref are refused without a call; a
 *      target with no integration refuses `target_not_configured` until it is dead-lettered; a lookup that cannot read
 *      every comment sends nothing.
 *   5. A takedown, a superseded release and another tenant's forged effect are still withheld through the real
 *      handler map, with no provider request.
 *   6. A retraction uses the provider's own call (GitHub deletes the comment, Stream removes the record), and a lost
 *      retraction answer is reconciled.
 *   7. The drain claims only kinds it handles: another kind's effect stays pending, or goes to the caller's handler.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_release_adapters_5585.test.ts
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CTX, ERIN, OTHER, approvedManifest, attestAll, campaign, clock, publish, revise, type W, world } from './_work_graph_release_world_5585.ts';
import { WORK_GRAPH_EFFECT_LIMITS } from '../src/services/workGraphEffects.ts';
import { DeliveryRetry, RELEASE_RETRACT_KIND } from '../src/services/workGraphReleaseDelivery.ts';
import { takedownRelease } from '../src/services/workGraphReleaseTakedowns.ts';
import { ProviderMeter, RELEASE_ADAPTER_LIMITS, STREAM_META, drainReleaseEffects, releaseAdapters } from '../src/services/workGraphReleaseAdapters.ts';

const UID = '0123456789abcdef'.repeat(2);
const PR = 'acme/site#12';

// ---- GitHub: a stubbed fetch over in-memory PR comments --------------------------------------------------------------
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
class FakeGitHub {
  comments: { id: number; body: string }[] = [];
  requests: { method: string; url: string; body?: any }[] = [];
  nextId = 900;
  /** Apply the next POST or DELETE, then lose its answer (the network drops it). */
  loseNext: 'POST' | 'DELETE' | null = null;
  install() {
    globalThis.fetch = (async (input: any, init: any = {}) => {
      const url = String(input);
      const method = init.method ?? 'GET';
      this.requests.push({ method, url, body: init.body ? JSON.parse(init.body) : undefined });
      assert.ok(url.startsWith('https://api.github.com/repos/acme/site/'), url);
      const json = (status: number, data: unknown) => new Response(data === null ? null : JSON.stringify(data), { status });
      let m = /\/issues\/12\/comments\?per_page=100&page=(\d+)$/.exec(url);
      if (m && method === 'GET') {
        const p = Number(m[1]);
        return json(200, this.comments.slice((p - 1) * 100, p * 100));
      }
      if (/\/issues\/12\/comments$/.test(url) && method === 'POST') {
        const c = { id: ++this.nextId, body: JSON.parse(init.body).body };
        this.comments.push(c);
        if (this.loseNext === 'POST') { this.loseNext = null; throw new Error('socket hang up'); }
        return json(201, c);
      }
      m = /\/issues\/comments\/(\d+)$/.exec(url);
      if (m && method === 'DELETE') {
        const i = this.comments.findIndex((c) => c.id === Number(m![1]));
        if (i < 0) return json(404, { message: 'Not Found' });
        this.comments.splice(i, 1);
        if (this.loseNext === 'DELETE') { this.loseNext = null; throw new Error('socket hang up'); }
        return json(204, null);
      }
      return json(404, { message: 'Not Found' });
    }) as typeof fetch;
    return this;
  }
  count(method: string) { return this.requests.filter((r) => r.method === method).length; }
}

// ---- Stream: a fake STREAM binding ------------------------------------------------------------------------------------
class FakeStream {
  videos = new Map<string, { meta: Record<string, unknown>; requireSignedURLs: boolean }>([[UID, { meta: { name: 'campaign film' }, requireSignedURLs: true }]]);
  requests: { fn: string; uid: string; patch?: any }[] = [];
  loseNextUpdate = false;
  createDirectUpload = async () => { throw new Error('unused'); };
  video(uid: string) {
    const self = this;
    const v = () => { const x = self.videos.get(uid); if (!x) throw new Error('not found'); return x; };
    return {
      async details() { self.requests.push({ fn: 'details', uid }); return structuredClone({ uid, ...v() }); },
      async update(patch: any) {
        self.requests.push({ fn: 'update', uid, patch: structuredClone(patch) });
        Object.assign(v(), structuredClone(patch));
        if (self.loseNextUpdate) { self.loseNextUpdate = false; throw new Error('timeout'); }
        return structuredClone({ uid, ...v() });
      },
      generateToken: async () => 'tok', delete: async () => undefined,
      captions: { generate: async () => null, delete: async () => undefined },
    };
  }
  count(fn: string) { return this.requests.filter((r) => r.fn === fn).length; }
}

const EFFECTS = [{ target: 'github_pr' as const, ref: PR }, { target: 'stream' as const, ref: UID }];
// website_cdn is for a public line only (part 1), so the investors campaign queues the other two; its adapter is checked
// directly. Here neither has a provider: no FILES bucket, no distribution channel (part 6, D5585-p6).
const UNINTEGRATED = [{ target: 'signed_document' as const, ref: 'envelope-77' }, { target: 'external_distribution' as const, ref: 'investor-list-1' }];

function live(w: W, over: Record<string, unknown> = {}) {
  const gh = new FakeGitHub().install();
  const stream = new FakeStream();
  const env = {
    DB: w.env.DB, WORK_GRAPH_RELEASE_DELIVERY: 'preview', GITHUB_ACCESS_TOKEN: 'ghs_fake', GITHUB_REPO_OWNER: 'acme', GITHUB_REPO_NAME: 'site',
    STREAM: stream, ...over,
  } as any;
  return { gh, stream, env };
}
async function shipped(w: W, effects: { target: any; ref: string }[] = EFFECTS) {
  const c = await campaign(w);
  const m = await approvedManifest(w, c.line, c.p, 'm1', c.p.evidence.rev);
  const r = await publish(w, c.line, m.manifestUid, null, 'pub-m1', CTX, effects);
  assert.ok(r.ok, JSON.stringify(r));
  return { c, m, effectIds: r.effectIds };
}
const deliveries = (w: W) => w.db.prepare('SELECT * FROM work_graph_release_deliveries ORDER BY effect_id').all() as any[];
const effectRows = (w: W) => w.db.prepare('SELECT id, effect_kind, state, attempts, last_error_code FROM work_graph_effects ORDER BY id').all() as any[];
const later = (ms: number) => { clock.t += ms; };
async function drain(env: any, opts = {}) {
  const r = await drainReleaseEffects(env, opts);
  assert.ok(r.ok, JSON.stringify(r));
  return r;
}

test('1. off by default: without the preview flag the drain reads and calls nothing', async () => {
  const w = world();
  await shipped(w);
  for (const flag of [undefined, '', 'true', 'on', 'PREVIEW']) {
    const { gh, stream, env } = live(w, { WORK_GRAPH_RELEASE_DELIVERY: flag });
    const r = await drainReleaseEffects(env);
    assert.deepEqual(r, { ok: false, code: 'release_delivery_off' });
    assert.equal(gh.requests.length + stream.requests.length, 0);
  }
  assert.deepEqual(effectRows(w).map((e) => [e.state, e.attempts]), [['pending', 0], ['pending', 0]]);
});

test('2. on: the PR comment and the Stream record are delivered once each, ids only, with their cost', async () => {
  const w = world();
  const { m, effectIds } = await shipped(w);
  const { gh, stream, env } = live(w);
  const r = await drain(env);
  assert.deepEqual(r.results.map((x) => x.status), ['applied', 'applied']);
  assert.ok(r.cost.d1Statements > 0);
  // GitHub: one page read (lookup), one POST; Stream: details (lookup), details + update (send).
  assert.equal(r.providerRequests, 5);
  assert.deepEqual(r.providerRequestsByTarget, { github_pr: 2, stream: 3, signed_document: 0, website_cdn: 0, external_distribution: 0 });
  assert.equal(gh.count('POST'), 1);
  const body = gh.comments[0].body;
  assert.ok(body.includes(`<!-- axal-release key=release:${m.manifestUid}:github_pr:${PR} -->`));
  assert.ok(body.includes(`sha256:${m.digest}`) && body.includes('Audience: investors') && body.includes('Pinned pieces: 8'));
  assert.ok(!/acme\/site@|COMPANY_LOGOS|pitch_decks|quote_versions/.test(body), 'ids only: no source locators');
  const v = stream.videos.get(UID)!;
  assert.deepEqual(v.meta, { name: 'campaign film', [STREAM_META.key]: `release:${m.manifestUid}:stream:${UID}`, [STREAM_META.manifest]: m.manifestUid, [STREAM_META.digest]: m.digest });
  assert.equal(v.requireSignedURLs, true, 'signed playback stays on');
  assert.deepEqual(deliveries(w).map((d) => [d.effect_id, d.target, d.outcome, d.reconciled, d.provider_calls, d.external_ref]), [
    [effectIds[0], 'github_pr', 'confirmed', 0, 2, 'github:comment:901'], [effectIds[1], 'stream', 'confirmed', 0, 2, `stream:${UID}`],
  ]);
  assert.ok(deliveries(w).every((d) => d.d1_statements >= 4));
  const again = await drain(env);
  assert.equal(again.results.length, 0);
  assert.equal(again.providerRequests, 0);
  assert.equal(gh.count('POST') + stream.count('update'), 2);
});

test('3. an ambiguous delivery is found by the next lookup and never sent again, per adapter', async () => {
  const w = world();
  const { effectIds } = await shipped(w);
  const { gh, stream, env } = live(w);
  gh.loseNext = 'POST';
  stream.loseNextUpdate = true;
  let r = await drain(env);
  assert.deepEqual(r.results.map((x) => x.status), ['retry', 'retry']);
  assert.deepEqual(effectRows(w).map((e) => e.last_error_code), ['provider_unavailable', 'provider_unavailable']);
  assert.equal(deliveries(w).length, 0, 'an answer that never came is not a delivery');
  later(WORK_GRAPH_EFFECT_LIMITS.baseBackoffMs);
  r = await drain(env);
  assert.deepEqual(r.results.map((x) => x.status), ['applied', 'applied']);
  assert.equal(r.providerRequests, 2, 'lookups only');
  assert.equal(gh.count('POST'), 1);
  assert.equal(gh.comments.length, 1);
  assert.equal(stream.count('update'), 1);
  assert.deepEqual(deliveries(w).map((d) => [d.effect_id, d.outcome, d.reconciled, d.attempt, d.provider_calls, d.external_ref]), [
    [effectIds[0], 'confirmed', 1, 2, 1, 'github:comment:901'], [effectIds[1], 'confirmed', 1, 2, 1, `stream:${UID}`],
  ]);
});

test('4. missing credentials and out-of-scope refs are refused without a call; unintegrated targets dead-letter', async () => {
  // No GitHub token, no Stream binding.
  let w = world();
  await shipped(w);
  let x = live(w, { GITHUB_ACCESS_TOKEN: undefined, STREAM: undefined });
  let r = await drain(x.env);
  assert.deepEqual(r.results.map((e) => e.status), ['retry', 'retry']);
  assert.deepEqual(effectRows(w).map((e) => e.last_error_code), ['target_not_configured', 'target_not_configured']);
  assert.equal(x.gh.requests.length + x.stream.requests.length + r.providerRequests, 0);

  // A repository the token does not reach, and a ref that is no Stream uid.
  w = world();
  await shipped(w, [{ target: 'github_pr', ref: 'other/repo#3' }, { target: 'stream', ref: 'vid-campaign' }]);
  x = live(w);
  await drain(x.env);
  assert.deepEqual(effectRows(w).map((e) => e.last_error_code), ['ref_out_of_scope', 'malformed_ref']);
  assert.equal(x.gh.requests.length + x.stream.requests.length, 0);

  // A PR with more comments than the lookup reads: it cannot prove absence, so it never posts.
  w = world();
  await shipped(w, [EFFECTS[0]]);
  x = live(w);
  const pages = RELEASE_ADAPTER_LIMITS.githubCommentPages;
  for (let i = 0; i < pages * RELEASE_ADAPTER_LIMITS.githubPageSize; i++) x.gh.comments.push({ id: i + 1, body: 'lgtm' });
  await drain(x.env);
  assert.equal(effectRows(w)[0].last_error_code, 'lookup_incomplete');
  assert.equal(x.gh.count('GET'), pages);
  assert.equal(x.gh.count('POST'), 0);

  // Targets with no provider in this env refuse on every attempt, call nothing, and dead-letter for a person to read.
  w = world();
  await shipped(w, UNINTEGRATED);
  x = live(w);
  for (let i = 0; i < WORK_GRAPH_EFFECT_LIMITS.maxAttempts; i++) {
    r = await drain(x.env);
    assert.equal(r.providerRequests, 0);
    later(WORK_GRAPH_EFFECT_LIMITS.maxBackoffMs);
  }
  assert.deepEqual(effectRows(w).map((e) => [e.effect_kind, e.state, e.last_error_code]), [
    ['release_signed_document', 'dead', 'target_not_configured'], ['release_external_distribution', 'dead', 'target_not_configured'],
  ]);
  assert.equal(x.gh.requests.length + x.stream.requests.length + deliveries(w).length, 0);
  const meter = new ProviderMeter();
  const cdn = releaseAdapters(x.env, meter).website_cdn;
  for (const fn of ['lookup', 'send'] as const) {
    await assert.rejects(cdn[fn]({ op: 'publish' } as any), (e: any) => e instanceof DeliveryRetry && e.code === 'target_not_configured');
  }
  assert.equal(meter.requests, 0);
});

test('5. a takedown, a superseded release and another tenant are withheld through the real handler map', async () => {
  // Taken down before delivery.
  let w = world();
  let s = await shipped(w);
  const td = await takedownRelease(w.env, CTX, {
    lineAssetUid: s.c.line, manifestUid: s.m.manifestUid, digest: s.m.digest, reasonCode: 'rights_withdrawn',
    evidenceRef: 'notice:rights-2026-11-19', authority: 'counsel', actor: ERIN, idempotencyKey: 'td-1',
  });
  assert.ok(td.ok, JSON.stringify(td));
  let x = live(w);
  let r = await drain(x.env);
  assert.deepEqual(deliveries(w).map((d) => [d.outcome, d.reason_code, d.provider_calls]), [['withheld', 'taken_down', 0], ['withheld', 'taken_down', 0]]);
  assert.equal(r.providerRequests + x.gh.requests.length + x.stream.requests.length, 0);

  // Superseded by a newer publication, plus a forged effect naming another tenant's manifest.
  w = world();
  s = await shipped(w);
  const copy2 = await revise(w, s.c.p.copy, 'copy-v2');
  await attestAll(w, copy2, ['marketing']);
  const m2 = await approvedManifest(w, s.c.line, { ...s.c.p, copy: copy2 }, 'm2', s.c.p.evidence.rev);
  const p2 = await publish(w, s.c.line, m2.manifestUid, s.m.manifestUid, 'pub-m2', CTX, []);
  assert.ok(p2.ok, JSON.stringify(p2));
  w.db.prepare(
    `INSERT INTO work_graph_effects (tenant_id, company_id, asset_uid, effect_kind, idempotency_key, request_hash, payload_json, max_attempts, next_attempt_ms, created_at)
     VALUES (?, ?, ?, 'release_github_pr', 'forged', ?, ?, 5, 0, '2026-11-19T09:00:00Z')`,
  ).run(OTHER.tenantId, OTHER.companyId, s.c.line, 'f'.repeat(64), JSON.stringify({ audience: 'investors', digest: m2.digest, line: s.c.line, manifest: m2.manifestUid, ref: PR, target: 'github_pr' }));
  x = live(w);
  r = await drain(x.env);
  assert.deepEqual(deliveries(w).map((d) => [d.tenant_id, d.outcome, d.reason_code, d.provider_calls]), [
    [7, 'superseded', 'not_head', 0], [7, 'superseded', 'not_head', 0], [8, 'withheld', 'wrong_tenant', 0],
  ]);
  assert.equal(r.providerRequests + x.gh.requests.length + x.stream.requests.length, 0);
});

test('6. a retraction uses the provider’s own call, and a lost retraction answer is reconciled', async () => {
  const w = world();
  const s = await shipped(w);
  const x = live(w);
  x.gh.comments.push({ id: 5, body: 'unrelated review comment' });
  await drain(x.env);
  const td = await takedownRelease(w.env, CTX, {
    lineAssetUid: s.c.line, manifestUid: s.m.manifestUid, digest: s.m.digest, reasonCode: 'legal_order',
    evidenceRef: 'notice:order-1', authority: 'counsel', actor: ERIN, idempotencyKey: 'td-2',
  });
  assert.ok(td.ok && td.retractEffectIds.length === 2, JSON.stringify(td));
  x.gh.loseNext = 'DELETE';
  let r = await drain(x.env);
  assert.deepEqual(r.results.map((e) => e.status), ['retry', 'applied']);
  // Stream: the release record is removed with an update; the video and its own meta stay, signed playback on.
  assert.deepEqual(x.stream.videos.get(UID), { meta: { name: 'campaign film' }, requireSignedURLs: true });
  // GitHub: the release comment is deleted (the DELETE landed, its answer was lost); the unrelated one stays.
  assert.deepEqual(x.gh.comments.map((c) => c.id), [5]);
  assert.deepEqual(x.gh.requests.filter((q) => q.method === 'DELETE').map((q) => q.url.replace(/.*\/issues\//, '')), ['comments/901']);
  later(WORK_GRAPH_EFFECT_LIMITS.baseBackoffMs);
  r = await drain(x.env);
  assert.deepEqual(r.results.map((e) => e.status), ['applied']);
  assert.equal(x.gh.count('DELETE'), 1, 'never deleted twice');
  const back = deliveries(w).filter((d) => d.op === 'retract').sort((a, b) => a.target.localeCompare(b.target));
  assert.deepEqual(back.map((d) => [d.target, d.outcome, d.reconciled, d.manifest_uid]), [
    ['github_pr', 'retracted', 1, s.m.manifestUid], ['stream', 'retracted', 0, s.m.manifestUid],
  ]);
  assert.equal(effectRows(w).filter((e) => e.effect_kind === RELEASE_RETRACT_KIND && e.state === 'applied').length, 2);
});

test('7. the drain claims only kinds it handles; another kind stays pending or goes to the caller’s handler', async () => {
  const setup = async () => {
    const w = world();
    await shipped(w);
    w.db.prepare(
      `INSERT INTO work_graph_effects (tenant_id, company_id, asset_uid, effect_kind, idempotency_key, request_hash, payload_json, max_attempts, next_attempt_ms, created_at)
       VALUES (7, 70, NULL, 'notify_slack', 'other-1', ?, '{}', 5, 0, '2026-11-19T09:00:00Z')`,
    ).run('e'.repeat(64));
    return w;
  };
  let w = await setup();
  let x = live(w);
  let r = await drain(x.env);
  assert.equal(r.results.length, 2);
  assert.deepEqual(effectRows(w).map((e) => [e.effect_kind, e.state, e.attempts]), [
    ['release_github_pr', 'applied', 1], ['release_stream', 'applied', 1], ['notify_slack', 'pending', 0],
  ]);
  const seen: string[] = [];
  // A caller's handler cannot replace a release kind's: part 2's checks always run.
  w = await setup();
  x = live(w);
  r = await drain(x.env, { handlers: { notify_slack: async (e: any) => { seen.push(e.idempotencyKey); }, release_stream: async () => { throw new Error('never'); } } });
  assert.deepEqual(r.results.map((e) => e.status), ['applied', 'applied', 'applied']);
  assert.deepEqual(seen, ['other-1']);
  assert.deepEqual(deliveries(w).map((d) => [d.target, d.outcome]), [['github_pr', 'confirmed'], ['stream', 'confirmed']]);
});
