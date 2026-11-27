/**
 * D5586 (#5586 part 1): the capacity read model, cost attribution, throughput and the bottleneck signals, the last
 * read from a real SQLite database built from the #5581 and #5585 migrations (the release world of D5585).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/swarm_capacity_5586.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceHead, createRevision, registerAsset } from '../src/services/workGraphRevisions.ts';
import { attributeCosts, capacityReadModel, costEntriesFromTickets, percentile, readApprovals, readBottlenecks, throughput, NOT_RECORDED } from '../src/services/agents/swarmCapacity.ts';
import type { SwarmTicket } from '../src/services/agents/swarmAdmission.ts';
import { ALICE, BOB, CTX, OTHER, OTHER_CTX, SCOPE, approvedManifest, clock, hex, published, revise, world } from './_work_graph_release_world_5585.ts';
import { V7, V8, facts, ok, policy, request, swarmWorld } from './_swarm_world_5586.ts';

const SINCE = '2026-11-19T00:00:00Z';

test('an unknown vendor cost is never 0: unpriced makes the total unavailable, a missing category is not recorded', () => {
  const c = attributeCosts([
    { venture: 't7:c70', modality: 'document', category: 'ai_inference', microusd: 400, basis: 'measured' },
    { venture: 't7:c70', modality: 'document', category: 'ai_inference', microusd: 600, basis: 'reserve' },
    { venture: 't7:c70', modality: 'video_render', category: 'gpu', microusd: 'unavailable', basis: 'vendor_unpriced' },
    { venture: 't7:c70', modality: 'video_render', category: 'gpu', microusd: 900, basis: 'measured' },
  ]);
  assert.deepEqual(c.ai_inference, { known_microusd: 400, estimated_microusd: 600, unpriced_entries: 0, total: 1000 });
  assert.deepEqual(c.gpu, { known_microusd: 900, estimated_microusd: 0, unpriced_entries: 1, total: 'unavailable' });
  for (const k of ['ci_minutes', 'egress', 'stream_output', 'storage_gb_month'] as const) assert.equal(c[k].total, NOT_RECORDED);
  assert.equal(c.total, 'unavailable');
  assert.equal(attributeCosts([]).total, NOT_RECORDED);
  assert.equal(attributeCosts([{ venture: 'x', modality: 'code', category: 'compute', microusd: 5, basis: 'measured' }]).total, 5);
});

test('p50/p95 are nearest-rank over recorded samples; time to approved deliverable counts only approved output', () => {
  assert.equal(percentile([], 50), NOT_RECORDED);
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
  assert.equal(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95), 95);
  assert.equal(percentile([10], 95), 10);
  const t = (uid: string, enq: number, adm: number | null, set: number | null): SwarmTicket => ({ ...request(V7, 'document'), ticket_uid: uid,
    state: set !== null ? 'settled' : adm !== null ? 'admitted' : 'waiting', sequence: 1, enqueued_at: enq, admitted_at: adm, settled_at: set,
    reserve_held_microusd: 1, reserve_basis: 'quote', charged_microusd: set !== null ? 1 : null, measured: set !== null ? true : null, wait_reason: null, end_code: null });
  const tickets = [t('a', 0, 10, 110), t('b', 0, 30, 130), t('c', 0, 50, 250), t('d', 0, null, null), t('e', 5_000_000, 5_000_010, 5_000_020)];
  const out = throughput(tickets, new Map([['a', 1000], ['c', 3000]]), { from: 0, to: 3_600_000 });
  assert.deepEqual([out.requested, out.settled, out.approved, out.settled_unapproved, out.approved_per_hour], [4, 3, 2, 1, 2]);
  assert.deepEqual(out.queue_wait_ms, { p50: 30, p95: 50 });
  assert.deepEqual(out.run_ms, { p50: 100, p95: 200 });
  assert.deepEqual(out.time_to_approved_ms, { p50: 1000, p95: 3000 });
  assert.deepEqual(out.human_approval_delay_ms, { p50: 890, p95: 2750 });
  const none = throughput([], new Map(), { from: 0, to: 1 });
  assert.deepEqual([none.approved_per_hour, none.time_to_approved_ms.p50], [NOT_RECORDED, NOT_RECORDED]);
});

test('bottlenecks: real CAS refusals, outbox backlog and review depth, scoped to one venture; the rest is not recorded', async () => {
  const w = world();
  const { c } = await published(w);
  // A second manifest is cut and approved but not published: it awaits.
  clock.t += 60_000;
  await approvedManifest(w, c.line, c.p, 'm2', c.p.evidence.rev);
  // A writer built on an old head: the CAS refuses it.
  const old = c.p.copy.rev;
  const v2 = await revise(w, c.p.copy, 'copy-v2');
  const r3 = await createRevision(w.env, CTX, { assetUid: v2.asset, parents: [old], digest: await hex('copy-v3'), byteLength: 1, mediaProfile: 'text/plain',
    source: { store: 'd1_record', locator: 'documents', id: 'copy', revision: 'v3' }, author: ALICE, idempotencyKey: 'rev-copy-v3' });
  assert.ok(r3.ok);
  const stale = await advanceHead(w.env, CTX, { assetUid: v2.asset, expectedRevisionUid: old, revisionUid: r3.revisionUid, actor: ALICE, approval: null, idempotencyKey: 'adv-copy-v3' });
  assert.equal(stale.ok, false);
  // Another venture's records never reach this venture's figures.
  const o = await registerAsset(w.env, OTHER_CTX, { scope: OTHER, kind: 'document', accessClass: 'internal', approvalPolicy: 'team_review', actor: BOB, idempotencyKey: 'other-a' });
  assert.ok(o.ok);
  w.db.prepare(`INSERT INTO work_graph_events (tenant_id, company_id, project_id, asset_uid, action, actor_kind, actor_user_id, outcome, refusal_code, created_at)
    VALUES (8, 80, 800, ?, 'advance_refused', 'person', 12, 'refused', 'stale_revision', ?)`).run(o.ok ? o.assetUid : '', new Date(clock.t).toISOString());
  const now = clock.t + 1000;
  const r = await readBottlenecks(w.env, CTX, SCOPE, SINCE, now);
  assert.ok(r.ok);
  if (!r.ok) return;
  const b = r.bottlenecks;
  const moves = Number((w.db.prepare(`SELECT COUNT(*) AS n FROM work_graph_events WHERE tenant_id = 7 AND action = 'advance_head'`).get() as any).n);
  assert.deepEqual(b.d1_conflicts, { head_moves: moves, refused: 1, stale: 1, conflict_rate: 1 / (moves + 1) });
  assert.ok(typeof b.outbox === 'object' && b.outbox.pending === 4 && b.outbox.claimed === 0 && b.outbox.dead === 0 && typeof b.outbox.oldest_pending_age_ms === 'number');
  assert.ok(typeof b.review_queue === 'object' && b.review_queue.awaiting === 1);
  assert.deepEqual(b.agent_planning_overlap, { lease_grants: 0, busy: 0, overlap_rate: NOT_RECORDED });
  assert.deepEqual(b.r2_uploads, { puts: 0, refused: 0, class_a_ops: 0, cost_microusd: 'unavailable' });
  for (const k of ['image_model_capacity', 'github_pr_ci_wait', 'preview_transcoding', 'egress'] as const) assert.equal(b[k], NOT_RECORDED);
  assert.equal(r.statements, 5);
  // The other venture sees its own refusal and none of this one's.
  const theirs = await readBottlenecks(w.env, OTHER_CTX, OTHER, SINCE, now);
  assert.ok(theirs.ok && typeof theirs.bottlenecks.d1_conflicts === 'object' && theirs.bottlenecks.d1_conflicts.head_moves === 0 && theirs.bottlenecks.d1_conflicts.stale === 1);
  assert.ok(theirs.ok && typeof theirs.bottlenecks.outbox === 'object' && theirs.bottlenecks.outbox.pending === 0);
});

test('a cross-tenant read is refused before any statement; a failing statement makes only its signal unavailable', async () => {
  const w = world();
  let calls = 0;
  const counted = { DB: { prepare: (sql: string) => { calls++; return w.env.DB.prepare(sql); } } } as any;
  assert.deepEqual(await readBottlenecks(counted, OTHER_CTX, SCOPE, SINCE, clock.t), { ok: false, code: 'wrong_tenant' });
  assert.deepEqual(await readApprovals(counted, OTHER_CTX, SCOPE, ['run_x']), { ok: false, code: 'wrong_tenant' });
  assert.equal(calls, 0);
  assert.deepEqual(await readBottlenecks(counted, CTX, SCOPE, 'not a date', clock.t), { ok: false, code: 'malformed' });
  const broken = { DB: { prepare: (sql: string) => (sql.includes('work_graph_effects') ? { bind: () => ({ first: async () => { throw new Error('D1 down'); } }) } : w.env.DB.prepare(sql)) } } as any;
  const r = await readBottlenecks(broken, CTX, SCOPE, SINCE, clock.t);
  assert.ok(r.ok && r.bottlenecks.outbox === 'unavailable' && typeof r.bottlenecks.d1_conflicts === 'object');
  assert.ok(r.ok && typeof r.bottlenecks.d1_conflicts === 'object' && r.bottlenecks.d1_conflicts.conflict_rate === NOT_RECORDED, 'no attempts is not a 0% conflict rate');
});

test('approval time per agent run comes from the first approved head move of that run, in scope', async () => {
  const w = world();
  const a = await registerAsset(w.env, CTX, { scope: SCOPE, kind: 'document', accessClass: 'internal', approvalPolicy: 'team_review', actor: ALICE, idempotencyKey: 'ap-a' });
  assert.ok(a.ok);
  if (!a.ok) return;
  const run = { kind: 'agent' as const, agentRunId: 'run_doc_1', onBehalfOfUserId: 11, chargeId: 'chg_1' };
  const digest = await hex('ap-v1');
  const r = await createRevision(w.env, CTX, { assetUid: a.assetUid, parents: [], digest, byteLength: 1, mediaProfile: 'text/plain',
    source: { store: 'd1_record', locator: 'documents', id: 'ap', revision: 'v1' }, author: run, idempotencyKey: 'ap-r1' });
  assert.ok(r.ok);
  if (!r.ok) return;
  clock.t += 5000;
  const h = await advanceHead(w.env, CTX, { assetUid: a.assetUid, expectedRevisionUid: null, revisionUid: r.revisionUid, actor: run, idempotencyKey: 'ap-h1',
    approval: { ref: 'approvals:ap-1', contentDigest: digest, reviewer: BOB, decidedAt: new Date(clock.t).toISOString() } });
  assert.ok(h.ok, JSON.stringify(h));
  // A later head move by another run, with no approval, is not an approved deliverable.
  const run2 = { kind: 'agent' as const, agentRunId: 'run_doc_2', onBehalfOfUserId: 11, chargeId: 'chg_2' };
  const r2 = await createRevision(w.env, CTX, { assetUid: a.assetUid, parents: [r.revisionUid], digest: await hex('ap-v2'), byteLength: 1, mediaProfile: 'text/plain',
    source: { store: 'd1_record', locator: 'documents', id: 'ap', revision: 'v2' }, author: run2, idempotencyKey: 'ap-r2' });
  assert.ok(r2.ok);
  if (!r2.ok) return;
  const h2 = await advanceHead(w.env, CTX, { assetUid: a.assetUid, expectedRevisionUid: r.revisionUid, revisionUid: r2.revisionUid, actor: run2, idempotencyKey: 'ap-h2', approval: null });
  assert.ok(h2.ok, JSON.stringify(h2));
  const got = await readApprovals(w.env, CTX, SCOPE, ['run_doc_1', 'run_doc_2', 'run_never']);
  assert.ok(got.ok);
  if (!got.ok) return;
  assert.deepEqual([...got.approvedAt.entries()], [['run_doc_1', clock.t]]);
  const theirs = await readApprovals(w.env, OTHER_CTX, OTHER, ['run_doc_1']);
  assert.ok(theirs.ok && theirs.approvedAt.size === 0);
});

test('the read model: per modality, venture, team, provider, budget, storage and backlog; a tenant sees only itself', async () => {
  const w = swarmWorld();
  const p7 = policy(V7, { render_budget_microusd: 10_000, storage_quota_bytes: 100_000 }), p8 = policy(V8, { render_budget_microusd: null });
  const doc = request(V7, 'document', { team_id: 3, reserve_microusd: 2000 });
  ok(await w.swarm.request(doc, p7, facts()));
  ok(await w.swarm.request(request(V7, 'video_render', { team_id: null, reserve_microusd: 'unavailable', ceiling_microusd: 5000 }), p7, facts()));
  ok(await w.swarm.request(request(V7, 'video_render'), p7, facts()));
  assert.equal(ok(await w.swarm.request(request(V7, 'video_render'), p7, facts())).state, 'waiting');
  ok(await w.swarm.settle(doc.ticket_uid, 'unavailable'));
  ok(await w.swarm.request(request(V8, 'code'), policy(V8), facts()));
  const swarm = await w.swarm.snapshot();
  const ventures = { 't7:c70': { policy: p7, storage_used_bytes: 1000 }, 't8:c80': { policy: p8, storage_used_bytes: null } };
  const all = capacityReadModel({ swarm, now: w.clock.now + 500, halted: true, scope: null, ventures, registeredAgents: 1000, bottlenecks: null });
  assert.deepEqual([all.registered_agents, all.executions], [1000, 3]);
  assert.deepEqual(all.by_modality.video_render, { work_class: 'expensive_render', lane: 'lease', live: 2, waiting: 1, settled: 0, withdrawn: 0 });
  assert.deepEqual(all.by_modality.document, { work_class: 'iterative_generation', lane: 'inline', live: 0, waiting: 0, settled: 1, withdrawn: 0 });
  const v7 = all.by_venture['t7:c70'] as any;
  // The 5000 ceiling and the 1000 quote of the two live renders (the third waits and commits nothing) and the 2000 reserve charged with no metrics: 8000 of 10000.
  assert.deepEqual(v7.budget, { limit_microusd: 10_000, committed_microusd: 8000, remaining_microusd: 2000 });
  assert.deepEqual(v7.storage, { quota_bytes: 100_000, used_bytes: 1000, reserved_bytes: 2000 });
  assert.deepEqual(v7.costs.ai_inference, { known_microusd: 0, estimated_microusd: 2000, unpriced_entries: 0, total: 2000 });
  assert.equal(v7.costs.gpu.total, NOT_RECORDED);
  assert.deepEqual([(all.by_venture['t8:c80'] as any).budget, (all.by_venture['t8:c80'] as any).storage], [NOT_RECORDED, NOT_RECORDED]);
  assert.deepEqual(Object.keys(all.by_team).sort(), ['team1', 'team3', 'unassigned']);
  assert.deepEqual(all.by_provider.cloudflare, { live: 3, waiting: 1, settled: 1, withdrawn: 0 });
  assert.deepEqual(all.alerts.map(a => a.code + (a.venture ? `@${a.venture}` : '')).sort(),
    ['budget_unverified@t8:c80', 'kill_switch_on', 'storage_unverified@t8:c80'].sort());
  assert.equal(all.bottlenecks, NOT_RECORDED);
  const mine = capacityReadModel({ swarm, now: w.clock.now, halted: false, scope: V8, ventures, registeredAgents: null, bottlenecks: null });
  assert.deepEqual(Object.keys(mine.by_venture), ['t8:c80']);
  assert.deepEqual([mine.executions, mine.registered_agents, mine.costs.total], [1, NOT_RECORDED, NOT_RECORDED]);
  assert.equal(costEntriesFromTickets(Object.values(swarm.tickets)).length, 1);
});

test('the backlog names why tickets wait, the render backlog and the oldest wait', async () => {
  const w = swarmWorld();
  const one = { video_render: { max_concurrent: 1, providers: ['cloudflare' as const], models: ['render/ffmpeg-h264'] } };
  const p = policy(V7, { modalities: one, max_waiting: 2, render_budget_microusd: 1000 });
  ok(await w.swarm.request(request(V7, 'video_render', { reserve_microusd: 100 }), p, facts()));
  ok(await w.swarm.request(request(V7, 'video_render', { reserve_microusd: 100 }), p, facts()));
  w.clock.now += 700;
  ok(await w.swarm.request(request(V7, 'video_render', { reserve_microusd: 100 }), p, facts()));
  const m = capacityReadModel({ swarm: await w.swarm.snapshot(), now: w.clock.now + 300, halted: false, scope: V7,
    ventures: { 't7:c70': { policy: p, storage_used_bytes: 0 } }, registeredAgents: 3, bottlenecks: null });
  assert.deepEqual(m.backlog, { waiting: 2, by_reason: { modality_capacity: 2 }, render_backlog: 2, oldest_wait_ms: 1000 });
  assert.deepEqual(m.alerts.map(a => a.code), ['queue_near_full']);
});
