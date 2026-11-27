/**
 * D5586 (#5586 part 1): the synthetic swarm benchmark. 10, 50 and 100 concurrent tasks across code, documents, brand
 * images and video renders, in two tenant-isolated ventures, through the real admission stack: #5570's placement and
 * compute leases, this issue's swarm admission over the same store, #5581's revision DAG and compare-and-swap head on
 * a real SQLite database, #5581's verified blob put for brand images, and #5585's release publication.
 *
 * Nothing leaves the process: no model, provider, R2 or network is called. The clock is simulated (one tick is one
 * second, and nothing else moves it) and each operation has a fixed duration and a fixed measured cost, the house
 * pattern of deck_ensembles_load_d1551, so the same input gives the same figures on any host.
 *
 * The replay and chaos cases, each on a fixed share of the tasks: simultaneous same-asset updates (tasks share
 * assets), a busy provider (6 containers for up to 100 tasks) and a provider brownout, a missing completion callback,
 * a partial upload, a crash between the revision and the head move, a redelivered completion, a changed citation
 * before publication, a revoked agent, budget exhaustion and an unavailable region. The checks: no acknowledged
 * revision is lost, nothing is published or charged twice, the budget is never overcommitted, no tenant's write
 * lands in another's records, and every task ends.
 *
 * Hosted stages (real providers, real quota) are not here: they need an owner-approved cost and quota (#5586).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/swarm_benchmark_5586.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1 } from './_d1_sqlite.mjs';
import { sha256Hex, type Actor, type Scope, type SourceRef } from '../src/services/workGraphContracts.ts';
import { advanceHead, createRevision, registerAsset } from '../src/services/workGraphRevisions.ts';
import { putVerified } from '../src/services/workGraphBlobs.ts';
import { placeWorkspace, type PlacementCandidate, type RateCard } from '../src/services/agents/workspacePlacement.ts';
import { MODALITY_LANE, budgetCommitted, ventureKey, type Modality } from '../src/services/agents/swarmAdmission.ts';
import { readApprovals, readBottlenecks, throughput, capacityReadModel } from '../src/services/agents/swarmCapacity.ts';
import { CTX, OTHER, OTHER_CTX, SCHEMA, SCOPE, T0, approvedManifest, attestAll, campaign, clock, publish, revise } from './_work_graph_release_world_5585.ts';
import { fakeCapabilities, specFixture } from './_workspace_fake_5565.ts';
import { MODELS, V7, V8, facts as baseFacts, policy, swarmWorld } from './_swarm_world_5586.ts';

const MEDIA = readFileSync(new URL('../sql/migrations/202611220358_5583_media_blob_classes.sql', import.meta.url), 'utf8');
const TICK = 1000;
const MODS = ['code', 'document', 'brand_image', 'video_render'] as const;
const KIND = { code: 'code', document: 'document', brand_image: 'image', video_render: 'video' } as const;
/** Simulated ticks each modality runs for, and its fixed measured cost in micro-USD. */
const RUN_TICKS: Record<typeof MODS[number], number> = { code: 3, document: 1, brand_image: 2, video_render: 5 };
const COST: Record<typeof MODS[number], number> = { code: 1000, document: 800, brand_image: 1500, video_render: 9000 };
const REVIEWER: Actor = { kind: 'person', userId: 14 };
const REVOKED_AGENT = 777;

/** R2 in memory: a put checks `sha256` over what arrived, as R2 does; `tearNext` delivers only half the body. */
class TornR2 {
  objects = new Map<string, { bytes: Uint8Array; sha256: string; customMetadata: Record<string, string> }>();
  tearNext = false;
  private view(key: string, o: { bytes: Uint8Array; sha256: string; customMetadata: Record<string, string> }) {
    const buf = new Uint8Array(o.sha256.match(/../g)!.map(h => parseInt(h, 16))).buffer;
    return { key, size: o.bytes.byteLength, customMetadata: { ...o.customMetadata }, checksums: { sha256: buf }, arrayBuffer: async () => o.bytes.slice().buffer };
  }
  async put(key: string, value: Uint8Array, opts: { sha256?: string; customMetadata?: Record<string, string> } = {}) {
    let bytes = new Uint8Array(value);
    if (this.tearNext) { this.tearNext = false; bytes = bytes.slice(0, Math.floor(bytes.byteLength / 2)); }
    const sum = await sha256Hex(bytes);
    if (opts.sha256 && sum !== opts.sha256) throw new Error('put: the SHA-256 checksum does not match');
    const o = { bytes, sha256: sum, customMetadata: { ...(opts.customMetadata ?? {}) } };
    this.objects.set(key, o);
    return this.view(key, o);
  }
  async head(key: string) { const o = this.objects.get(key); return o ? this.view(key, o) : null; }
  async get(key: string) { const o = this.objects.get(key); return o ? this.view(key, o) : null; }
  async delete(key: string) { this.objects.delete(key); }
}

const card = (patch: Partial<RateCard> = {}): RateCard => ({ provider: 'cloudflare', source: 'quoted', vcpu_second: 10, gib_second: 2, boot: 500,
  disk_gib_second: 1, image_pull_cold: 300, image_pull_cached: 0, egress_gib: 50, idle_second: 1, idle_seconds: 30, ...patch });

type Task = {
  i: number; uid: string; v: typeof V7; scope: Scope; ctx: typeof CTX; mod: typeof MODS[number]; asset: string; agent: number;
  region: string; phase: 'pending' | 'queued' | 'admitted' | 'running' | 'lost' | 'done' | 'refused' | 'revoked';
  base: string | null; generation: number | null; doneAt: number; crashed: boolean; torn: boolean; refusal: string | null;
};

async function bench(N: number) {
  clock.t = T0;
  const { DB, db } = makeD1(SCHEMA + MEDIA);
  const r2 = new TornR2();
  const env: any = { DB, FILES: r2 };
  const sw = swarmWorld({ lease_ms: 10_000, per_tenant_running: 6, per_provider_running: { cloudflare: 6 },
    per_region_running: { 'cloudflare:weur': 5, 'cloudflare:eeur': 2 } }, () => clock.t);
  const p7 = policy(V7, { max_concurrent: 10, max_waiting: N });
  const p8 = policy(V8, { max_concurrent: 6, max_waiting: N, render_budget_microusd: 30_000 });
  const ventures = () => ({ [ventureKey(V7)]: { policy: p7, storage_used_bytes: 0 }, [ventureKey(V8)]: { policy: p8, storage_used_bytes: 0 } });
  const revoked = new Set<number>();
  const stats = { placement_waits: 0, partial_uploads: 0, stale_rebases: 0, crashes: 0, redeliveries: 0, lost_callbacks: 0, brownouts: 0,
    budget_refusals: 0, cross_tenant_refusals: 0, no_capacity_retries: 0, max_ticks: 0 };
  const acknowledged: { asset: string; rev: string; uid: string }[] = [];
  const charges: string[] = [];
  const settledCost = new Map<string, number>();

  // Assets: a small pool per venture and modality, so tasks update the same asset at the same time.
  const pool = Math.max(1, Math.floor(N / 10));
  const assets = new Map<string, string>();
  for (const v of [V7, V8]) for (const mod of MODS) for (let k = 0; k < pool; k++) {
    const scope = v === V7 ? SCOPE : OTHER;
    const a = await registerAsset(env, v === V7 ? CTX : OTHER_CTX, { scope, kind: KIND[mod], accessClass: 'confidential', approvalPolicy: 'team_review',
      actor: { kind: 'person', userId: v === V7 ? 11 : 12 }, idempotencyKey: `bench-${N}-${v.tenant_id}-${mod}-${k}` });
    assert.ok(a.ok, JSON.stringify(a));
    assets.set(`${v.tenant_id}:${mod}:${k}`, a.ok ? a.assetUid : '');
  }
  const tasks: Task[] = Array.from({ length: N }, (_, i) => {
    const v = i % 5 === 4 ? V8 : V7, mod = MODS[i % 4];
    return { i, uid: `run_${N}_${i}`, v, scope: v === V7 ? SCOPE : OTHER, ctx: v === V7 ? CTX : OTHER_CTX, mod,
      asset: assets.get(`${v.tenant_id}:${mod}:${Math.floor(i / 4) % pool}`)!,
      agent: v === V8 && mod === 'document' ? REVOKED_AGENT : 1000 + i,
      region: mod === 'video_render' && v === V7 && i % 8 === 3 ? 'eeur' : 'weur',
      phase: 'pending', base: null, generation: null, doneAt: 0, crashed: false, torn: false, refusal: null };
  });
  const byUid = new Map(tasks.map(t => [t.uid, t]));
  const head = (asset: string) => (db.prepare('SELECT head_revision_uid AS h FROM work_graph_assets WHERE asset_uid = ?').get(asset) as { h: string | null }).h;
  const actor = (t: Task): Actor => ({ kind: 'agent', agentRunId: t.uid, onBehalfOfUserId: t.v === V7 ? 11 : 12, chargeId: `chg_${t.uid}` });
  const SOURCE: Record<string, (t: Task, d: string) => SourceRef> = {
    code: (_t, d) => ({ store: 'git', locator: 'acme/site', id: 'main', revision: d.slice(0, 40) }),
    document: (t, d) => ({ store: 'd1_record', locator: 'documents', id: t.uid, revision: d.slice(0, 16) }),
    video_render: (t, d) => ({ store: 'stream', locator: 'stream', id: `vid-${t.uid}`, revision: d.slice(0, 16) }),
  };

  async function ask(t: Task, tick: number) {
    let reserve: number | 'unavailable' = COST[t.mod] + 200, ceiling = COST[t.mod] * 2;
    if (MODALITY_LANE[t.mod] === 'lease') {
      // #5570's placement decides the region and the reserve; an unavailable region queues, never falls back.
      const regions = [t.region];
      const spec = specFixture({ allowed_regions: regions, max_cost_microusd: t.mod === 'video_render' ? 20_000 : 5000 });
      const cand: PlacementCandidate = { capabilities: { ...fakeCapabilities(), enforced_regions: regions },
        health: t.region === 'eeur' && tick < 4 ? 'down' : 'healthy', capacity: { [t.region]: 5 },
        rates: t.mod === 'video_render' ? null : card(), latency_ms: 20, cache_local: false };
      const placed = placeWorkspace(spec, { consented_providers: ['cloudflare'], residency_regions: regions, halted: false }, [cand]);
      if (placed.decision === 'queue') { stats.placement_waits++; return; }
      assert.equal(placed.decision, 'place', JSON.stringify(placed));
      if (placed.decision !== 'place') return;
      reserve = placed.reserve_basis === 'quote' ? placed.reserve_microusd : 'unavailable';
      ceiling = placed.reserve_basis === 'quote' ? Math.max(placed.reserve_microusd, COST[t.mod]) : spec.max_cost_microusd;
      if (placed.reserve_basis === 'quote') reserve = ceiling;
    }
    t.base = head(t.asset);
    const r = await sw.swarm.request({ ticket_uid: t.uid, ...t.v, team_id: (t.i % 3) + 1, agent_id: t.agent, modality: t.mod as Modality, provider: 'cloudflare',
      model: MODELS[t.mod], region: t.region,
      asset_uid: t.asset, base_revision_uid: t.base, reserve_microusd: reserve, ceiling_microusd: ceiling, storage_bytes: 128 },
    t.v === V7 ? p7 : p8, baseFacts({ agent: revoked.has(t.agent) ? 'revoked' : 'active', head_revision_uid: t.base }));
    if (r.ok) { t.phase = r.value.state === 'admitted' ? 'admitted' : 'queued'; return; }
    if (r.code === 'no_capacity') { stats.no_capacity_retries++; return; }
    if (r.code === 'budget_exhausted') { stats.budget_refusals++; t.phase = 'refused'; t.refusal = r.code; return; }
    if (r.code === 'agent_revoked') { t.phase = 'revoked'; return; }
    assert.fail(`${t.uid}: ${r.code}`);
  }

  async function bytesFor(t: Task, attempt: number): Promise<{ digest: string; source: SourceRef; size: number }> {
    const content = new TextEncoder().encode(`${t.uid}:${attempt}:${'x'.repeat(48)}`);
    if (t.mod !== 'brand_image') { const d = await sha256Hex(content); return { digest: d, source: SOURCE[t.mod](t, d), size: content.byteLength }; }
    if (t.i % 6 === 2 && !t.torn) {
      t.torn = true;
      r2.tearNext = true;
      const torn = await putVerified(env, t.ctx, { scope: t.scope, bytes: content, accessClass: 'confidential', actor: actor(t), assetUid: t.asset });
      r2.tearNext = false;
      assert.equal(torn.ok, false, 'a torn body never lands');
      stats.partial_uploads++;
    }
    const put = await putVerified(env, t.ctx, { scope: t.scope, bytes: content, accessClass: 'confidential', actor: actor(t), assetUid: t.asset });
    assert.ok(put.ok, JSON.stringify(put));
    return put.ok ? { digest: put.digest, source: put.source, size: put.size } : assert.fail();
  }

  /** The run's completion: write the revision, move the head (rebasing on a CAS refusal), settle. Safe to redeliver. */
  async function complete(t: Task, tick: number) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const { digest, source, size } = await bytesFor(t, attempt);
      const rev = await createRevision(env, t.ctx, { assetUid: t.asset, parents: t.base ? [t.base] : [], digest, byteLength: size,
        mediaProfile: 'application/octet-stream', source, author: actor(t), idempotencyKey: `rev-${t.uid}-${attempt}` });
      if (!rev.ok && rev.code === 'malformed') assert.fail(JSON.stringify(rev));
      assert.ok(rev.ok, JSON.stringify(rev));
      if (!rev.ok) return;
      if (t.i % 11 === 5 && !t.crashed) { t.crashed = true; stats.crashes++; return; } // crash before the head move; redelivered next tick
      const adv = () => advanceHead(env, t.ctx, { assetUid: t.asset, expectedRevisionUid: t.base, revisionUid: rev.revisionUid, actor: actor(t),
        idempotencyKey: `adv-${t.uid}-${attempt}`, approval: { ref: `approvals:${t.uid}`, contentDigest: digest, reviewer: REVIEWER, decidedAt: new Date(clock.t).toISOString() } });
      const moved = await adv();
      if (!moved.ok && moved.code === 'stale_revision') { stats.stale_rebases++; t.base = head(t.asset); continue; }
      assert.ok(moved.ok, JSON.stringify(moved));
      if (!moved.ok) return;
      if (!moved.replayed) acknowledged.push({ asset: t.asset, rev: rev.revisionUid, uid: t.uid });
      if (t.i % 7 === 3) {
        // A redelivered completion: the same keys answer the first result and write nothing.
        stats.redeliveries++;
        const again = await adv();
        assert.ok(again.ok && again.replayed && again.revisionUid === rev.revisionUid, JSON.stringify(again));
      }
      break;
    }
    if (MODALITY_LANE[t.mod] === 'lease' && t.i % 9 === 4) {
      // The completion callback is lost: the lease expires and reconcile reads the provider (a brownout first).
      stats.lost_callbacks++;
      sw.provider.set(t.uid, 'throw');
      t.phase = 'lost';
      return;
    }
    const bill = await sw.swarm.settle(t.uid, COST[t.mod], t.generation ?? undefined);
    assert.ok(bill.ok && bill.value.first, JSON.stringify(bill));
    if (bill.ok) { charges.push(t.uid); settledCost.set(t.uid, bill.value.charged_microusd); }
    if (t.i % 7 === 3) {
      const again = await sw.swarm.settle(t.uid, COST[t.mod], t.generation ?? undefined);
      assert.ok(again.ok && !again.value.first && again.value.charged_microusd === COST[t.mod], JSON.stringify(again));
    }
    t.phase = 'done';
  }

  let tick = 0;
  for (; tick < 400 && tasks.some(t => !['done', 'refused', 'revoked'].includes(t.phase)); tick++) {
    clock.t = T0 + tick * TICK;
    if (tick === 1) {
      revoked.add(REVOKED_AGENT);
      const r = await sw.swarm.revokeAgent(V8, REVOKED_AGENT);
      for (const uid of r.withdrawn) byUid.get(uid)!.phase = 'revoked';
    }
    for (const t of tasks.filter(x => x.phase === 'pending')) await ask(t, tick);
    for (const uid of await sw.swarm.promote(ventures())) byUid.get(uid)!.phase = 'admitted';
    for (const g of await sw.admission.admit()) byUid.get(g.run_uid)!.generation = g.generation;
    for (const t of tasks.filter(x => x.phase === 'lost')) if (sw.provider.get(t.uid) === 'throw' && tick % 2 === 0) { stats.brownouts++; sw.provider.set(t.uid, { state: 'gone', measured_microusd: COST[t.mod] }); }
    await sw.admission.reconcile();
    for (const t of tasks.filter(x => x.phase === 'lost')) {
      // The late callback is redelivered once reconcile has settled the lease: the swarm takes that one bill.
      const slot = sw.store.peek().slots[t.uid];
      if (!slot?.settlement) continue;
      const bill = await sw.swarm.settle(t.uid, 'unavailable', t.generation!);
      assert.ok(bill.ok && bill.value.first && bill.value.charged_microusd === COST[t.mod] && bill.value.measured, JSON.stringify(bill));
      if (bill.ok) { charges.push(t.uid); settledCost.set(t.uid, bill.value.charged_microusd); }
      t.phase = 'done';
    }
    for (const t of tasks.filter(x => x.phase === 'admitted')) {
      if (MODALITY_LANE[t.mod] === 'lease' && t.generation === null) continue; // its container waits for a lease
      t.phase = 'running'; t.doneAt = tick + RUN_TICKS[t.mod];
    }
    for (const t of tasks.filter(x => x.phase === 'running')) {
      if (tick < t.doneAt) { if (t.generation !== null) assert.ok((await sw.admission.renew(t.uid, t.generation)).ok); continue; }
      await complete(t, tick);
      if (t.crashed && t.phase === 'running' && acknowledged.every(a => a.uid !== t.uid)) t.doneAt = tick + 1;
    }
    for (const key of [ventureKey(V7), ventureKey(V8)]) {
      const committed = budgetCommitted(await sw.swarm.snapshot(), key);
      assert.ok(committed <= (key === ventureKey(V7) ? p7 : p8).render_budget_microusd!, `budget overcommitted for ${key}: ${committed}`);
    }
  }
  stats.max_ticks = tick;

  // A venture never writes into another venture's asset.
  const foreign = await createRevision(env, OTHER_CTX, { assetUid: tasks.find(t => t.v === V7)!.asset, parents: [], digest: 'a'.repeat(64), byteLength: 1,
    mediaProfile: 'text/plain', source: { store: 'd1_record', locator: 'documents', id: 'x', revision: 'x' }, author: { kind: 'person', userId: 12 }, idempotencyKey: `foreign-${N}` });
  assert.equal(!foreign.ok && foreign.code, 'wrong_tenant');
  stats.cross_tenant_refusals++;
  return { N, tick, tasks, db, sw, env, acknowledged, charges, settledCost, stats, p7, p8, ventures };
}

async function verify(run: Awaited<ReturnType<typeof bench>>) {
  const { tasks, db, sw, acknowledged, charges, settledCost } = run;
  // Every task ended.
  assert.deepEqual(tasks.filter(t => !['done', 'refused', 'revoked'].includes(t.phase)).map(t => `${t.uid}:${t.phase}`), []);
  // No acknowledged revision is lost: each is its asset's head or an ancestor of it, and head_seq counts every move.
  const parentsOf = (rev: string) => JSON.parse((db.prepare('SELECT parent_uids_json AS p FROM work_graph_revisions WHERE revision_uid = ?').get(rev) as { p: string }).p) as string[];
  const byAsset = new Map<string, string[]>();
  for (const a of acknowledged) byAsset.set(a.asset, [...(byAsset.get(a.asset) ?? []), a.rev]);
  for (const [asset, revs] of byAsset) {
    const h = db.prepare('SELECT head_revision_uid AS h, head_seq AS s FROM work_graph_assets WHERE asset_uid = ?').get(asset) as { h: string; s: number };
    const line = new Set<string>();
    for (let cur: string | undefined = h.h; cur; cur = parentsOf(cur)[0]) line.add(cur);
    for (const r of revs) assert.ok(line.has(r), `acknowledged revision ${r} lost from ${asset}`);
    assert.equal(h.s, revs.length, `head_seq of ${asset}`);
  }
  // Nothing charged twice; every finished task charged its measured cost once; no lease still held.
  assert.equal(new Set(charges).size, charges.length);
  const done = tasks.filter(t => t.phase === 'done');
  assert.equal(charges.length, done.length);
  for (const t of done) assert.equal(settledCost.get(t.uid), COST[t.mod], t.uid);
  const state = sw.store.peek();
  for (const t of done.filter(x => MODALITY_LANE[x.mod] === 'lease')) assert.equal(state.slots[t.uid].settlement?.charged_microusd, COST[t.mod], t.uid);
  assert.equal((await sw.admission.planning(null)).simultaneous_executions, 0);
  // Nothing charged to a refused or revoked task, and no swarm ticket left holding capacity.
  const swarm = await sw.swarm.snapshot();
  for (const t of tasks.filter(x => x.phase !== 'done')) assert.equal(swarm.tickets[t.uid]?.charged_microusd ?? null, null, t.uid);
  assert.equal(Object.values(swarm.tickets).filter(t => t.state === 'admitted' || t.state === 'waiting').length, 0);
  // Every write of a venture's runs landed in that venture's records only.
  for (const t of done) {
    const rows = db.prepare('SELECT DISTINCT a.tenant_id AS t FROM work_graph_revisions r JOIN work_graph_assets a ON a.asset_uid = r.asset_uid WHERE r.agent_run_id = ?').all(t.uid) as { t: number }[];
    assert.deepEqual(rows.map(r => r.t), [t.v.tenant_id], t.uid);
  }
  // The figures, from recorded timestamps: time to an approved deliverable per venture.
  const report: Record<string, unknown> = {};
  for (const [v, scope, ctx] of [[V7, SCOPE, CTX], [V8, OTHER, OTHER_CTX]] as const) {
    const mine = Object.values(swarm.tickets).filter(t => ventureKey(t) === ventureKey(v));
    const approvals = await readApprovals(run.env, ctx, scope, mine.map(t => t.ticket_uid));
    assert.ok(approvals.ok);
    if (!approvals.ok) continue;
    const tp = throughput(mine, approvals.approvedAt, { from: T0, to: T0 + run.tick * TICK + TICK });
    assert.equal(tp.approved, mine.filter(t => t.state === 'settled').length, 'every finished task was approved');
    assert.ok(typeof tp.time_to_approved_ms.p50 === 'number' && typeof tp.time_to_approved_ms.p95 === 'number' && tp.time_to_approved_ms.p50 <= tp.time_to_approved_ms.p95);
    const b = await readBottlenecks(run.env, ctx, scope, new Date(T0 - 1000).toISOString(), T0 + run.tick * TICK);
    assert.ok(b.ok);
    report[ventureKey(v)] = { approved: tp.approved, approved_per_hour: tp.approved_per_hour, time_to_approved_ms: tp.time_to_approved_ms,
      queue_wait_ms: tp.queue_wait_ms, d1_conflicts: b.ok ? b.bottlenecks.d1_conflicts : null };
  }
  const model = capacityReadModel({ swarm, now: clock.t, halted: false, scope: null, ventures: run.ventures(), registeredAgents: run.N, bottlenecks: null });
  assert.equal(model.executions, 0);
  return { report, model };
}

for (const N of [10, 50, 100]) {
  test(`${N} concurrent tasks across code, documents, brand images and video survive the chaos cases`, async (t) => {
    const run = await bench(N);
    const { report, model } = await verify(run);
    const s = run.stats;
    t.diagnostic(JSON.stringify({ stats: s, report }));
    assert.ok(run.tick < 400, 'the run finishes');
    assert.ok(s.redeliveries > 0 && s.crashes > 0 && s.partial_uploads > 0, JSON.stringify(s));
    assert.ok(s.placement_waits > 0, 'the unavailable region made placement wait, not fall back');
    if (N >= 50) {
      assert.ok(run.tasks.some(t => t.phase === 'revoked'), 'the revoked agent lost its waiting work');
      assert.ok(s.stale_rebases > 0, 'simultaneous same-asset updates were refused by the CAS and rebased');
      assert.ok(s.lost_callbacks > 0 && s.brownouts > 0, JSON.stringify(s));
      assert.ok(s.budget_refusals > 0, 'the small venture hit its render budget');
      assert.ok((report['t7:c70'] as any).queue_wait_ms.p95 > 0, 'the busy provider and the modality caps made tickets wait');
    }
    // Every venture's figures are measured, and the conflict rate is the CAS refusals actually recorded.
    const v7 = report['t7:c70'] as any;
    assert.ok(typeof v7.d1_conflicts === 'object' && v7.d1_conflicts.stale === s.stale_rebases - (report['t8:c80'] as any).d1_conflicts.stale);
    assert.equal(model.costs.ci_minutes.total, 'not_recorded');
  });
}

test('the harness is deterministic: the same run gives the same figures', async () => {
  const a = await verify(await bench(10));
  const b = await verify(await bench(10));
  assert.deepEqual(a.report, b.report);
  assert.deepEqual(a.model.costs, b.model.costs);
});

test('publication: a changed citation blocks the stale manifest, simultaneous publishes land once, a replay charges nothing', async () => {
  clock.t = T0;
  const { DB, db } = makeD1(SCHEMA);
  const w = { env: { DB } as any, db };
  const sw = swarmWorld({}, () => clock.t);
  const c = await campaign(w);
  const m1 = await approvedManifest(w, c.line, c.p, 'bench-m1', c.p.evidence.rev);
  // The cited evidence changes after approval: the approved manifest is no longer publishable.
  clock.t += 1000;
  const evidence = await revise(w, c.p.evidence, 'evidence-v2');
  await attestAll(w, evidence, ['investor_pitch']);
  const stale = await publish(w, c.line, m1.manifestUid, null, 'bench-pub-stale');
  assert.equal(stale.ok, false, JSON.stringify(stale));
  const m2 = await approvedManifest(w, c.line, { ...c.p, evidence }, 'bench-m2', evidence.rev);
  // Two publication tickets for the same line: the second waits for the first.
  const pub = (uid: string) => sw.swarm.request({ ticket_uid: uid, ...V7, team_id: 1, agent_id: 9, modality: 'final_publication', provider: 'cloudflare',
    model: 'publish/release', region: 'weur', asset_uid: c.line, base_revision_uid: null, reserve_microusd: 50, ceiling_microusd: 50, storage_bytes: 0 },
  policy(V7, { modalities: { final_publication: { max_concurrent: 4, providers: ['cloudflare'], models: ['publish/release'] } } }), baseFacts());
  const t1 = await pub('run_pub_1'), t2 = await pub('run_pub_2');
  assert.ok(t1.ok && t1.value.state === 'admitted' && t2.ok && t2.value.state === 'waiting');
  // Both publishers race anyway (a second Worker): the CAS on the line lets exactly one land.
  const [a, b] = await Promise.all([publish(w, c.line, m2.manifestUid, null, 'bench-pub-a'), publish(w, c.line, m2.manifestUid, null, 'bench-pub-b')]);
  assert.equal([a, b].filter(r => r.ok).length, 1, JSON.stringify([a, b]));
  const winner = a.ok ? a : b;
  const replay = await publish(w, c.line, m2.manifestUid, null, a.ok ? 'bench-pub-a' : 'bench-pub-b');
  assert.ok(winner.ok && replay.ok && replay.replayed && JSON.stringify(replay.effectIds) === JSON.stringify(winner.effectIds));
  assert.equal(Number((db.prepare(`SELECT COUNT(*) AS n FROM work_graph_effects WHERE idempotency_key LIKE 'release:%'`).get() as { n: number }).n), 4);
  assert.equal(Number((db.prepare(`SELECT head_seq AS s FROM work_graph_assets WHERE asset_uid = ?`).get(c.line) as { s: number }).s), 1);
  const bill = await sw.swarm.settle('run_pub_1', 40);
  assert.ok(bill.ok && bill.value.first);
  assert.ok((await sw.swarm.settle('run_pub_1', 40)).ok);
  assert.deepEqual(await sw.swarm.promote({ 't7:c70': { policy: policy(V7, { modalities: { final_publication: { max_concurrent: 4, providers: ['cloudflare'], models: ['publish/release'] } } }), storage_used_bytes: 0 } }), ['run_pub_2']);
  const swarm = await sw.swarm.snapshot();
  assert.equal(swarm.audit.filter(e => e.action === 'settle').length, 1);
});
