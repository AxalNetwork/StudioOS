/**
 * D5585 part 15 (#5585, WorkGraph P1): a render approved before it spends. A `render` approval on a release manifest
 * states a ceiling; `renderApprovalFor` finds the approval for (asset, base revision) under the same counting rule as
 * publish approvals; #5586's swarm admission refuses a `video_render` or `brand_image` ticket without one, or beyond
 * its ceiling, when the venture's policy requires it. The real release services over part 2's SQLite world and the
 * real swarm admission over #5570's admission control.
 *
 *   1. A render approval must state a ceiling; nothing else may carry one; the store refuses either pairing too.
 *   2. The resolver: no base, not pinned, unapproved, approved (the most a profile's approvers allowed), the newest
 *      manifest wins; a withdrawn, revoked, the author's own, another digest's or another audience's approval does
 *      not count; a takedown withholds it; another venture never sees it.
 *   3. Admission: not read (503), none (403), unreadable (503), over the ceiling counting waiting, live and settled
 *      tickets on the same piece (409), within it admitted with the manifest recorded; not required, other
 *      modalities and another piece untouched; every refusal is audited.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_release_render_approvals_5585.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALICE, AUTH, CTX, ERIN, OTHER_CTX, clock, decision, newLine, piece, revise, world, type Piece, type W } from './_work_graph_release_world_5585.ts';
import { cutManifest, decideRelease, WORK_GRAPH_RELEASE_LIMITS, type ReleaseContext } from '../src/services/workGraphReleases.ts';
import { renderApprovalFor } from '../src/services/workGraphReleaseRenderApprovals.ts';
import { takedownRelease } from '../src/services/workGraphReleaseTakedowns.ts';
import { renderApprovalCommitted, type SwarmRenderApproval } from '../src/services/agents/swarmAdmission.ts';
import { V7, facts, ok, policy, refused, request, swarmWorld } from './_swarm_world_5586.ts';

const FRANK = { kind: 'person' as const, userId: 18 }; // a second brand owner
const CTX2: ReleaseContext = { ...CTX, authorities: new Map([...AUTH, [18, ['brand_owner']]]) };

/** A video piece on an investors line, cut into a manifest that pins it under the marketing profile. */
async function pinned(w: W, key = 'v') {
  const video = await piece(w, `${key}-video`, 'video', 'confidential');
  const line = await newLine(w, `${key}-line`);
  const m = await cut(w, line, video, `${key}-m1`);
  return { video, line, m };
}
async function cut(w: W, line: string, p: Piece, key: string) {
  clock.t += 60_000;
  const m = await cutManifest(w.env, CTX, { lineAssetUid: line, partial: false, author: ALICE, idempotencyKey: key,
    components: [{ assetUid: p.asset, revisionUid: p.rev, digest: p.digest, role: 'video', profile: 'marketing' }] });
  assert.ok(m.ok, JSON.stringify(m));
  return m;
}
const render = (m: { manifestUid: string; digest: string }, key: string, ceiling: number | null, over: Record<string, unknown> = {}) =>
  decision(m.manifestUid, m.digest, 'marketing', key, { purpose: 'render', renderCeilingMicrousd: ceiling, ...over });
const ask = (w: W, p: Piece, ctx: ReleaseContext = CTX2, base: string | null = p.rev) => renderApprovalFor(w.env, ctx, { assetUid: p.asset, baseRevisionUid: base });
const plain = (a: { approval: unknown; reason: unknown }) => ({ approval: a.approval, reason: a.reason });

test('1. a render approval states its ceiling, and nothing else may; the store refuses either pairing', async () => {
  const w = world();
  const { m } = await pinned(w);
  const missing = await decideRelease(w.env, CTX, render(m, 'no-cap', null));
  assert.deepEqual(!missing.ok && [missing.code, missing.ids], ['approval_incomplete', [m.manifestUid, 'marketing', 'render_ceiling']]);
  for (const [key, over] of [
    ['pub-cap', { purpose: 'publish' }], ['reject-cap', { decision: 'reject' }], ['zero', { renderCeilingMicrousd: 0 }],
    ['frac', { renderCeilingMicrousd: 1.5 }], ['huge', { renderCeilingMicrousd: WORK_GRAPH_RELEASE_LIMITS.maxRenderCeilingMicrousd + 1 }],
  ] as const) {
    const r = await decideRelease(w.env, CTX, render(m, key, 5_000, over));
    assert.equal(!r.ok && r.code, 'malformed', key);
  }
  const good = await decideRelease(w.env, CTX, render(m, 'ok', WORK_GRAPH_RELEASE_LIMITS.maxRenderCeilingMicrousd));
  assert.ok(good.ok, JSON.stringify(good));
  const row = w.db.prepare('SELECT purpose, decision, render_ceiling_microusd AS c FROM work_graph_release_decisions WHERE id = ?').get(good.decisionId) as any;
  assert.deepEqual({ ...row }, { purpose: 'render', decision: 'approve', c: WORK_GRAPH_RELEASE_LIMITS.maxRenderCeilingMicrousd });
  // Withdrawing a render approval carries no ceiling.
  assert.ok((await decideRelease(w.env, CTX, render(m, 'wd', null, { decision: 'withdraw' }))).ok);

  const insert = (purpose: string, verdict: string, ceiling: number | null, key: string) => w.db.prepare(
    `INSERT INTO work_graph_release_decisions (tenant_id, company_id, project_id, manifest_uid, manifest_digest, audience, purpose, profile,
       authority, decision, reviewer_user_id, approval_ref, render_ceiling_microusd, idempotency_key, request_hash, decided_at)
     VALUES (7, 70, 700, ?, ?, 'investors', ?, 'marketing', 'brand_owner', ?, 13, 'ref', ?, ?, ?, '2026-11-26T00:00:00Z')`,
  ).run(m.manifestUid, m.digest, purpose, verdict, ceiling, key, 'c'.repeat(64));
  assert.throws(() => insert('render', 'approve', null, 's1'), /render_ceiling_microusd/);
  assert.throws(() => insert('publish', 'approve', 10, 's2'), /render_ceiling_microusd/);
  assert.throws(() => insert('render', 'reject', 10, 's3'), /render_ceiling_microusd/);
  assert.throws(() => insert('render', 'approve', 0, 's4'), /CHECK/);
  insert('render', 'approve', 10, 's5');
  insert('publish', 'approve', null, 's6');
});

test('2. the resolver: the counted render approvals of the newest manifest that pins the piece, and nothing else', async () => {
  const w = world();
  const { video, line, m } = await pinned(w);
  assert.deepEqual(plain(await ask(w, video, CTX2, null)), { approval: null, reason: 'no_base' });
  const stranger = await piece(w, 'stranger', 'video', 'confidential');
  assert.deepEqual(plain(await ask(w, stranger)), { approval: null, reason: 'not_pinned' });
  assert.deepEqual(plain(await ask(w, video)), { approval: null, reason: 'unapproved' });

  // Publish approvals are not render approvals.
  assert.ok((await decideRelease(w.env, CTX2, decision(m.manifestUid, m.digest, 'marketing', 'pub'))).ok);
  assert.deepEqual(plain(await ask(w, video)), { approval: null, reason: 'unapproved' });

  // Two brand owners approve the render: the profile authorizes the most either allowed.
  assert.ok((await decideRelease(w.env, CTX2, render(m, 'carol', 3_000))).ok);
  assert.ok((await decideRelease(w.env, CTX2, render(m, 'frank', 7_000, { reviewer: FRANK }))).ok);
  const a = await ask(w, video);
  assert.deepEqual(plain(a), { approval: { manifest_uid: m.manifestUid, ceiling_microusd: 7_000 }, reason: null });
  assert.ok(a.cost.d1Statements > 0);

  // FRANK withdraws: CAROL's approval is what counts. Then FRANK is revoked or loses the authority: same.
  assert.ok((await decideRelease(w.env, CTX2, render(m, 'frank-wd', null, { reviewer: FRANK, decision: 'withdraw' }))).ok);
  assert.equal((await ask(w, video)).approval?.ceiling_microusd, 3_000);
  assert.ok((await decideRelease(w.env, CTX2, render(m, 'frank-2', 9_000, { reviewer: FRANK }))).ok);
  assert.equal((await ask(w, video)).approval?.ceiling_microusd, 9_000);
  // CAROL re-approves for less, later: the most a counted approver allowed still answers, not the latest.
  assert.ok((await decideRelease(w.env, CTX2, render(m, 'carol-2', 3_000))).ok);
  assert.equal((await ask(w, video)).approval?.ceiling_microusd, 9_000);
  // A publish decision CAROL makes afterwards is not her render decision: her render approval still counts.
  assert.ok((await decideRelease(w.env, CTX2, decision(m.manifestUid, m.digest, 'marketing', 'pub-after'))).ok);
  assert.equal((await ask(w, video, { ...CTX2, revokedUserIds: new Set([18]) })).approval?.ceiling_microusd, 3_000);
  assert.equal((await ask(w, video, CTX)).approval?.ceiling_microusd, 3_000, 'FRANK holds no authority in CTX');
  assert.deepEqual(plain(await ask(w, video, { ...CTX, revokedUserIds: new Set([13]) })), { approval: null, reason: 'unapproved' });

  // Rows the services refuse, written as the store would hold them, never count: the author's own, another digest,
  // another audience.
  const raw = (reviewer: number, digest: string, audience: string, key: string) => w.db.prepare(
    `INSERT INTO work_graph_release_decisions (tenant_id, company_id, project_id, manifest_uid, manifest_digest, audience, purpose, profile,
       authority, decision, reviewer_user_id, approval_ref, render_ceiling_microusd, idempotency_key, request_hash, decided_at)
     VALUES (7, 70, 700, ?, ?, ?, 'render', 'marketing', 'brand_owner', 'approve', ?, 'ref', 50000, ?, ?, '2026-11-26T00:00:00Z')`,
  ).run(m.manifestUid, digest, audience, reviewer, key, 'c'.repeat(64));
  const solo = new Map([[11, ['brand_owner']]]);
  raw(11, m.digest, 'investors', 'own');
  assert.deepEqual(plain(await ask(w, video, { ...CTX, authorities: solo })), { approval: null, reason: 'unapproved' }, 'the author\'s own');
  const AUTH19 = new Map([[19, ['brand_owner']]]);
  raw(19, 'd'.repeat(64), 'investors', 'digest');
  assert.deepEqual(plain(await ask(w, video, { ...CTX, authorities: AUTH19 })), { approval: null, reason: 'unapproved' }, 'another digest');
  const AUTH20 = new Map([[20, ['brand_owner']]]);
  raw(20, m.digest, 'public', 'aud');
  assert.deepEqual(plain(await ask(w, video, { ...CTX, authorities: AUTH20 })), { approval: null, reason: 'unapproved' }, 'another audience');

  // Another venture never sees this venture's manifest.
  assert.deepEqual(plain(await ask(w, video, { ...OTHER_CTX, authorities: CTX2.authorities })), { approval: null, reason: 'not_pinned' });

  // A newer manifest pinning the same piece, approved for less, is the one that answers.
  const m2 = await cut(w, line, video, 'v-m2');
  assert.ok((await decideRelease(w.env, CTX2, render(m2, 'm2-carol', 1_000))).ok);
  assert.deepEqual((await ask(w, video)).approval, { manifest_uid: m2.manifestUid, ceiling_microusd: 1_000 });

  // A takedown of the newer manifest withholds it; the older one answers. Taking down the piece withholds both.
  const td = (manifestUid: string, digest: string, key: string, component?: { revisionUid: string; digest: string }) => takedownRelease(w.env, CTX2, {
    lineAssetUid: line, manifestUid, digest, reasonCode: 'rights_withdrawn', evidenceRef: 'notice:1', authority: 'counsel', actor: ERIN, idempotencyKey: key,
    ...(component ? { component } : {}),
  });
  const t1 = await td(m2.manifestUid, m2.digest, 'td-m2');
  assert.ok(t1.ok, JSON.stringify(t1));
  assert.deepEqual((await ask(w, video)).approval, { manifest_uid: m.manifestUid, ceiling_microusd: 9_000 });
  const t2 = await td(m.manifestUid, m.digest, 'td-piece', { revisionUid: video.rev, digest: video.digest });
  assert.ok(t2.ok, JSON.stringify(t2));
  assert.deepEqual(plain(await ask(w, video)), { approval: null, reason: 'taken_down' });

  // A new base revision is a new piece: no manifest pins it yet.
  const v2 = await revise(w, video, 'v-video-v2');
  assert.deepEqual(plain(await ask(w, v2)), { approval: null, reason: 'not_pinned' });
});

test('3. admission: a render needs its approval and stays within its ceiling; everything else is untouched', async () => {
  const s = swarmWorld();
  const p = policy(V7, { render_approval_required: true });
  const approval: SwarmRenderApproval = { manifest_uid: 'wgm_manifest_1', ceiling_microusd: 5_000 };
  const base = { asset_uid: 'asset_video', base_revision_uid: 'rev_base' };
  const head = facts({ head_revision_uid: 'rev_base' });
  const vid = (patch = {}) => request(V7, 'video_render', { ...base, reserve_microusd: 2_000, ceiling_microusd: 4_000, ...patch });

  refused(await s.swarm.request(vid(), p, head), 'render_approval_unverified');
  refused(await s.swarm.request(vid(), p, { ...head, render_approval: null }), 'render_unapproved');
  for (const bad of [{ manifest_uid: '', ceiling_microusd: 5 }, { manifest_uid: 'wgm_x', ceiling_microusd: 0 }, { manifest_uid: 'bad uid!', ceiling_microusd: 5 }, 'x']) {
    refused(await s.swarm.request(vid(), p, { ...head, render_approval: bad as any }), 'render_approval_unverified');
  }
  // Within: admitted, with the manifest recorded.
  const first = vid();
  const a = ok(await s.swarm.request(first, p, { ...head, render_approval: approval }));
  assert.equal(a.state, 'admitted');
  const t = (s.store.peek() as any).swarm.tickets[first.ticket_uid];
  assert.equal(t.render_manifest_uid, 'wgm_manifest_1');
  // A second render of the same piece: 2,000 held + 2,000 fits 5,000; a third does not. A waiting one counts.
  const second = vid();
  ok(await s.swarm.request(second, p, { ...head, render_approval: approval }));
  refused(await s.swarm.request(vid({ reserve_microusd: 1_001 }), p, { ...head, render_approval: approval }), 'render_over_approved');
  const sw = (s.store.peek() as any).swarm;
  assert.equal(renderApprovalCommitted(sw, first), 4_000);
  // `unavailable` reserves the ticket's ceiling, so it is held against the approval too.
  refused(await s.swarm.request(vid({ reserve_microusd: 'unavailable', ceiling_microusd: 1_001 }), p, { ...head, render_approval: approval }), 'render_over_approved');
  ok(await s.swarm.request(vid({ reserve_microusd: 'unavailable', ceiling_microusd: 1_000 }), p, { ...head, render_approval: approval }));
  // Settled charges count, not their reserves: settle the first at 500.
  const g = (await s.admission.admit()).find((x: any) => x.run_uid === first.ticket_uid);
  assert.ok(g, 'the first render holds its #5570 lease');
  ok(await s.swarm.settle(first.ticket_uid, 500, g.generation));
  assert.equal(renderApprovalCommitted((s.store.peek() as any).swarm, first), 500 + 2_000 + 1_000);
  ok(await s.swarm.request(vid({ reserve_microusd: 1_500 }), p, { ...head, render_approval: approval }));

  // Another piece, or the same asset on another base, has its own approval and its own total.
  const other = { ...head, render_approval: { manifest_uid: 'wgm_other', ceiling_microusd: 2_000 } };
  ok(await s.swarm.request(request(V7, 'video_render', { asset_uid: 'asset_video', base_revision_uid: 'rev_next', reserve_microusd: 2_000, ceiling_microusd: 2_000 }), p,
    { ...other, head_revision_uid: 'rev_next' }));
  // Brand images are governed too; code and documents are not; nor any render when the policy does not require it.
  refused(await s.swarm.request(request(V7, 'brand_image', { ...base }), p, head), 'render_approval_unverified');
  ok(await s.swarm.request(request(V7, 'code', { ...base }), p, head));
  ok(await s.swarm.request(request(V7, 'document', { ...base }), p, head));
  ok(await s.swarm.request(vid(), policy(V7), head));
  ok(await s.swarm.request(vid(), policy(V7, { render_approval_required: 'yes' as any }), head));

  // Every refusal is in the audit with its own code.
  const codes = (s.store.peek() as any).swarm.audit.filter((e: any) => e.outcome === 'refused').map((e: any) => e.code);
  for (const c of ['render_approval_unverified', 'render_unapproved', 'render_over_approved']) assert.ok(codes.includes(c), c);
});
