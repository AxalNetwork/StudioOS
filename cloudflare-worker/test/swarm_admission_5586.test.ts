/**
 * D5586 (#5586 part 1): swarm admission per venture, modality, revision, budget, provider, model and storage, on
 * #5570's real admission control over one store. Synthetic ventures, an injected clock, no waits.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/swarm_admission_5586.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODALITY_CLASS, SWARM_AUDIT_MAX, swarmOf } from '../src/services/agents/swarmAdmission.ts';
import { V7, V8, facts, ok, policy, refused, request, swarmWorld } from './_swarm_world_5586.ts';

test('a venture cannot ask under another venture, and the refusal is audited under the claimed scope', async () => {
  const w = swarmWorld();
  refused(await w.swarm.request(request(V8, 'document'), policy(V7), facts()), 'wrong_tenant');
  refused(await w.swarm.request(request({ tenant_id: 7, company_id: 71 }, 'document'), policy(V7), facts()), 'wrong_tenant');
  const s = await w.swarm.snapshot();
  assert.equal(Object.keys(s.tickets).length, 0);
  assert.deepEqual(s.audit.map(a => [a.tenant_id, a.company_id, a.outcome, a.code]), [[8, 80, 'refused', 'wrong_tenant'], [7, 71, 'refused', 'wrong_tenant']]);
  // A venture cannot withdraw another venture's ticket either.
  const mine = request(V7, 'document');
  ok(await w.swarm.request(mine, policy(V7), facts()));
  refused(await w.swarm.withdraw(mine.ticket_uid, V8), 'ticket_not_found');
});

test('checks run in order and each names its reason: kill switch, agent, modality, provider, model, revision', async () => {
  const w = swarmWorld();
  const code = async (patch: Parameters<typeof request>[2], p = policy(V7), f = facts()) => {
    const r = await w.swarm.request(request(V7, 'brand_image', patch), p, f);
    return r.ok ? r.value.state : r.code;
  };
  assert.equal(await code({}, policy(V7, { halted: true })), 'swarm_halted');
  assert.equal(await code({}, policy(V7), facts({ agent: 'revoked' })), 'agent_revoked');
  assert.equal(await code({}, policy(V7), facts({ agent: 'unknown' })), 'agent_unverified');
  assert.equal(await code({}, policy(V7, { modalities: { code: policy(V7).modalities.code } })), 'modality_not_allowed');
  assert.equal(await code({ provider: 'aws' }), 'provider_not_allowed');
  assert.equal(await code({ model: '@cf/unlisted/model' }), 'model_not_allowed');
  assert.equal(await code({}, policy(V7), facts({ head_revision_uid: undefined })), 'revision_unverified');
  assert.equal(await code({ base_revision_uid: 'rev_old' }, policy(V7), facts({ head_revision_uid: 'rev_new' })), 'stale_revision');
  assert.equal(await code({ base_revision_uid: 'rev_new' }, policy(V7), facts({ head_revision_uid: 'rev_new' })), 'admitted');
  assert.equal(await code({ reserve_microusd: 6000 }), 'invalid_swarm_request');
  w.kill.on = true;
  assert.equal(await code({}), 'swarm_halted');
  assert.deepEqual(await w.swarm.promote(w.ventures(policy(V7))), []);
});

test('budget: an unknown quote reserves the ceiling, never 0; exhaustion and an unread budget refuse', async () => {
  const w = swarmWorld();
  const p = policy(V7, { render_budget_microusd: 12_000 });
  const a = ok(await w.swarm.request(request(V7, 'document', { reserve_microusd: 'unavailable', ceiling_microusd: 5000 }), p, facts()));
  assert.deepEqual([a.reserve_microusd, a.reserve_basis], [5000, 'ceiling']);
  ok(await w.swarm.request(request(V7, 'document', { reserve_microusd: 5000 }), p, facts()));
  refused(await w.swarm.request(request(V7, 'document', { reserve_microusd: 2001 }), p, facts()), 'budget_exhausted');
  ok(await w.swarm.request(request(V7, 'document', { reserve_microusd: 2000 }), p, facts()));
  refused(await w.swarm.request(request(V7, 'document'), policy(V7, { render_budget_microusd: null }), facts()), 'budget_unverified');
  // A settled charge stays committed: the budget does not refill when a ticket ends.
  const w2 = swarmWorld();
  const small = policy(V7, { render_budget_microusd: 3000 });
  const spent = request(V7, 'document', { reserve_microusd: 2000 });
  ok(await w2.swarm.request(spent, small, facts()));
  ok(await w2.swarm.settle(spent.ticket_uid, 2000));
  refused(await w2.swarm.request(request(V7, 'document', { reserve_microusd: 1500 }), small, facts()), 'budget_exhausted');
  // Another venture's spend never counts against this one.
  ok(await w.swarm.request(request(V8, 'document', { reserve_microusd: 5000 }), policy(V8, { render_budget_microusd: 5000 }), facts()));
});

test('storage: quota counts used bytes plus live tickets; an unread figure refuses rather than assumes room', async () => {
  const w = swarmWorld();
  const p = policy(V7, { storage_quota_bytes: 10_000 });
  ok(await w.swarm.request(request(V7, 'brand_image', { storage_bytes: 4000 }), p, facts({ storage_used_bytes: 5000 })));
  refused(await w.swarm.request(request(V7, 'brand_image', { storage_bytes: 1001 }), p, facts({ storage_used_bytes: 5000 })), 'storage_quota_exhausted');
  ok(await w.swarm.request(request(V7, 'brand_image', { storage_bytes: 1000 }), p, facts({ storage_used_bytes: 5000 })));
  refused(await w.swarm.request(request(V7, 'brand_image'), p, facts({ storage_used_bytes: null })), 'storage_unverified');
  refused(await w.swarm.request(request(V7, 'brand_image'), policy(V7, { storage_quota_bytes: null }), facts()), 'storage_unverified');
});

test('capacity queues, a full queue refuses with every reason, and promotion is fair across ventures', async () => {
  const w = swarmWorld();
  const p7 = policy(V7, { max_waiting: 2 });
  const one = { video_render: { max_concurrent: 1, providers: ['cloudflare' as const], models: ['render/ffmpeg-h264'] } };
  for (const r of [request(V7, 'video_render'), request(V7, 'video_render')]) assert.equal(ok(await w.swarm.request(r, p7, facts())).state, 'admitted');
  const q1 = request(V7, 'video_render'), q2 = request(V7, 'video_render');
  const w1 = ok(await w.swarm.request(q1, p7, facts()));
  assert.deepEqual([w1.state, w1.work_class, w1.reasons], ['waiting', 'queued_task', ['modality_capacity']]);
  ok(await w.swarm.request(q2, p7, facts()));
  const full = await w.swarm.request(request(V7, 'video_render'), p7, facts());
  refused(full, 'no_capacity');
  assert.deepEqual(!full.ok && full.reasons, ['modality_capacity', 'venture_queue_full']);
  // V8 queues later than V7's two, behind its own running render.
  const v8run = request(V8, 'video_render'), v8wait = request(V8, 'video_render');
  ok(await w.swarm.request(v8run, policy(V8, { modalities: one }), facts()));
  assert.equal(ok(await w.swarm.request(v8wait, policy(V8, { modalities: one }), facts())).state, 'waiting');
  const g = (await w.admission.admit()).find(x => x.run_uid === v8run.ticket_uid)!;
  ok(await w.swarm.settle(v8run.ticket_uid, 900, g.generation));
  // Room opens for all three. V8 now holds the fewest live tickets, so it goes first despite queuing last.
  const wide = policy(V7, { max_waiting: 2, modalities: { video_render: { max_concurrent: 4, providers: ['cloudflare'], models: ['render/ffmpeg-h264'] } } });
  assert.deepEqual(await w.swarm.promote(w.ventures(wide, policy(V8, { modalities: one }))), [v8wait.ticket_uid, q1.ticket_uid, q2.ticket_uid]);
  // A venture absent from the promotion input admits nothing.
  const w2 = swarmWorld();
  ok(await w2.swarm.request(request(V7, 'video_render'), policy(V7, { modalities: one }), facts()));
  ok(await w2.swarm.request(request(V7, 'video_render'), policy(V7, { modalities: one }), facts()));
  assert.deepEqual(await w2.swarm.promote({}), []);
});

test('a publication is serial per asset and the next one waits for it', async () => {
  const w = swarmWorld();
  const p = policy(V7, { modalities: { ...policy(V7).modalities, final_publication: { max_concurrent: 5, providers: ['cloudflare'], models: ['publish/release'] } } });
  const a = request(V7, 'final_publication', { asset_uid: 'line_1', storage_bytes: 0 });
  const b = request(V7, 'final_publication', { asset_uid: 'line_1', storage_bytes: 0 });
  const c = request(V7, 'final_publication', { asset_uid: 'line_2', storage_bytes: 0 });
  assert.equal(ok(await w.swarm.request(a, p, facts())).state, 'admitted');
  assert.deepEqual(ok(await w.swarm.request(b, p, facts())).reasons, ['publication_in_flight']);
  assert.equal(ok(await w.swarm.request(c, p, facts())).state, 'admitted');
  assert.deepEqual(await w.swarm.promote(w.ventures(p)), []);
  ok(await w.swarm.settle(a.ticket_uid, 40));
  assert.deepEqual(await w.swarm.promote(w.ventures(p)), [b.ticket_uid]);
});

test('lease-lane tickets take #5570 compute leases under their uid; inline ones take none', async () => {
  const w = swarmWorld({ per_provider_running: { cloudflare: 1 }, per_region_running: { 'cloudflare:weur': 1 } });
  const code = request(V7, 'code'), doc = request(V7, 'document'), render = request(V7, 'video_render');
  for (const r of [code, doc, render]) ok(await w.swarm.request(r, policy(V7), facts()));
  const slots = w.store.peek().slots;
  assert.deepEqual(Object.keys(slots).sort(), [code.ticket_uid, render.ticket_uid].sort());
  assert.equal(slots[code.ticket_uid].compute_reserve_microusd, 1000);
  // The provider cap of #5570 still holds: one container runs, the other lease waits.
  const grants = await w.admission.admit();
  assert.deepEqual(grants.map(g => g.run_uid), [code.ticket_uid]);
  // A lease-lane ticket settles only through its lease; a waiting lease has not run, so it cannot be settled.
  refused(await w.swarm.settle(render.ticket_uid, 10), 'lease_generation_required');
  refused(await w.swarm.settle(render.ticket_uid, 10, 0), 'not_admitted');
  const planning = await w.admission.planning(1000);
  assert.deepEqual([planning.registered_agents, planning.simultaneous_executions], [1000, 1]);
  assert.equal(MODALITY_CLASS.video_render, 'expensive_render');
});

test('one bill per ticket: the lease settlement is the bill, a repeat answers it again, missing metrics charge the reserve', async () => {
  const w = swarmWorld();
  const r = request(V7, 'code', { reserve_microusd: 3000 });
  ok(await w.swarm.request(r, policy(V7), facts()));
  const [g] = await w.admission.admit();
  refused(await w.swarm.settle(r.ticket_uid, 100, g.generation + 1), 'stale_generation');
  const first = ok(await w.swarm.settle(r.ticket_uid, 'unavailable', g.generation));
  assert.deepEqual(first, { charged_microusd: 3000, measured: false, first: true });
  assert.deepEqual(ok(await w.swarm.settle(r.ticket_uid, 1, g.generation)), { charged_microusd: 3000, measured: false, first: false });
  assert.equal(w.store.peek().slots[r.ticket_uid].settlement?.charged_microusd, 3000);
  const inline = request(V7, 'document', { reserve_microusd: 700 });
  ok(await w.swarm.request(inline, policy(V7), facts()));
  assert.deepEqual(ok(await w.swarm.settle(inline.ticket_uid, 650)), { charged_microusd: 650, measured: true, first: true });
  assert.deepEqual(ok(await w.swarm.settle(inline.ticket_uid, 9999)), { charged_microusd: 650, measured: true, first: false });
  const unmetered = request(V7, 'brand_image', { reserve_microusd: 900 });
  ok(await w.swarm.request(unmetered, policy(V7), facts()));
  assert.deepEqual(ok(await w.swarm.settle(unmetered.ticket_uid, 'unavailable')), { charged_microusd: 900, measured: false, first: true });
  const settles = (await w.swarm.snapshot()).audit.filter(a => a.action === 'settle');
  assert.deepEqual(settles.map(a => [a.ticket_uid, a.charged_microusd, a.measured]), [[r.ticket_uid, 3000, false], [inline.ticket_uid, 650, true], [unmetered.ticket_uid, 900, false]]);
});

test('a replay with the same terms re-takes the lease after a crash; changed terms are refused', async () => {
  const w = swarmWorld();
  const r = request(V7, 'code');
  // Crash between the swarm transaction and the lease: simulate by writing the ticket, then losing the slot.
  ok(await w.swarm.request(r, policy(V7), facts()));
  await w.store.transaction(s => { delete s.slots[r.ticket_uid]; });
  const again = ok(await w.swarm.request(r, policy(V7), facts()));
  assert.equal(again.duplicate, true);
  assert.ok(w.store.peek().slots[r.ticket_uid], 'the replay took the lease');
  const third = ok(await w.swarm.request(r, policy(V7), facts()));
  assert.equal(third.lease && third.lease.ok && (third.lease.value as { duplicate: boolean }).duplicate, true);
  refused(await w.swarm.request({ ...r, reserve_microusd: 2000 }, policy(V7), facts()), 'ticket_contract_changed');
  assert.equal(Object.keys((await w.swarm.snapshot()).tickets).length, 1);
});

test('a revoked agent loses its waiting tickets with no bill and keeps what is running until it settles', async () => {
  const w = swarmWorld();
  const p = policy(V7, { modalities: { ...policy(V7).modalities, document: { max_concurrent: 1, providers: ['cloudflare'], models: Object.values({ d: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }) } } });
  const running = request(V7, 'document', { agent_id: 501 }), queued = request(V7, 'document', { agent_id: 501 });
  ok(await w.swarm.request(running, p, facts()));
  assert.equal(ok(await w.swarm.request(queued, p, facts())).state, 'waiting');
  assert.deepEqual(await w.swarm.revokeAgent(V7, 501), { withdrawn: [queued.ticket_uid], still_running: [running.ticket_uid] });
  assert.deepEqual(await w.swarm.revokeAgent(V8, 501), { withdrawn: [], still_running: [] });
  const s = await w.swarm.snapshot();
  assert.deepEqual([s.tickets[queued.ticket_uid].state, s.tickets[queued.ticket_uid].end_code, s.tickets[queued.ticket_uid].charged_microusd], ['withdrawn', 'agent_revoked', null]);
  refused(await w.swarm.withdraw(running.ticket_uid, V7), 'settle_required');
  refused(await w.swarm.request(request(V7, 'document', { agent_id: 501 }), p, facts({ agent: 'revoked' })), 'agent_revoked');
});

test('a throwing transaction rolls back; a clock that runs backwards is refused; the audit is bounded and counts what it drops', async () => {
  const w = swarmWorld();
  await assert.rejects(w.store.transaction(s => { swarmOf(s).tickets.x = {} as never; throw new Error('boom'); }));
  assert.equal(w.store.peek().swarm, undefined);
  ok(await w.swarm.request(request(V7, 'document'), policy(V7), facts()));
  w.clock.now -= 1;
  refused(await w.swarm.request(request(V7, 'document'), policy(V7), facts()), 'clock_regressed');
  w.clock.now += 1;
  await w.store.transaction(s => { swarmOf(s).audit_seq = SWARM_AUDIT_MAX + 5; swarmOf(s).audit = Array.from({ length: SWARM_AUDIT_MAX }, (_, i) => ({ seq: i + 6, at: 0, ticket_uid: 'x', tenant_id: 7, company_id: 70, action: 'request', outcome: 'applied', code: null })); });
  refused(await w.swarm.request(request(V8, 'document'), policy(V7), facts()), 'wrong_tenant');
  const s = await w.swarm.snapshot();
  assert.equal(s.audit.length, SWARM_AUDIT_MAX);
  assert.equal(s.audit_dropped, 6);
  assert.equal(s.audit.at(-1)!.code, 'wrong_tenant');
});

test('a lease-lane ticket whose container never started withdraws with no bill; one that ran must settle', async () => {
  const w = swarmWorld({ per_provider_running: { cloudflare: 1 }, per_region_running: { 'cloudflare:weur': 1 } });
  const ran = request(V7, 'video_render'), never = request(V7, 'video_render');
  ok(await w.swarm.request(ran, policy(V7), facts()));
  ok(await w.swarm.request(never, policy(V7), facts()));
  assert.deepEqual((await w.admission.admit()).map(g => g.run_uid), [ran.ticket_uid]);
  refused(await w.swarm.withdraw(ran.ticket_uid, V7), 'settle_required');
  assert.deepEqual(ok(await w.swarm.withdraw(never.ticket_uid, V7)), { state: 'withdrawn' });
  const s = w.store.peek();
  assert.deepEqual([s.slots[never.ticket_uid].state, s.slots[never.ticket_uid].settlement], ['withdrawn', null]);
  assert.equal(swarmOf(s).tickets[never.ticket_uid].charged_microusd, null);
  assert.equal(swarmOf(s).tickets[ran.ticket_uid].state, 'admitted');
});
