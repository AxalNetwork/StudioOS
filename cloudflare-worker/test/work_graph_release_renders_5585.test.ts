/**
 * D5585 part 12 (#5585, WorkGraph P1): render approvals tied to #5586's budgets. A release that pins a render (a
 * video render, a brand image an agent run wrote) is approved and published only when #5586's swarm admission
 * admitted that run and it settled, at a measured cost, within the reserve admission held for it. The real release
 * services over part 2's SQLite world, and #5586's real swarm admission over #5570's real admission control.
 *
 *   1. Admitted and settled within its reserve: approvable and publishable; the evaluation shows the bill.
 *   2. No swarm state passed (the routes today): `admission_unverified`, refused at approval and at publication.
 *   3. Not admitted, refused by admission (no_capacity, budget_exhausted), waiting, not settled: each refused with
 *      the admission's own reason.
 *   4. Unknown cost (settled without metrics) and over budget (charged above the reserve): refused, never approved.
 *   5. Cross-tenant: another venture's ticket or refusal under the same run uid never satisfies, and never shows.
 *   6. Stale admission: a ticket for another base, another asset or another modality is `other_revision`/`other_modality`.
 *   7. Regression: pieces that are not renders (a person's upload, a brand-token record, code) are untouched.
 *   8. The pure rule: what a render is, malformed swarm state, every reason distinct.
 *   9. The admin and reviewer context: swarm state is not read by default (no binding), so the routes behind
 *      WORK_GRAPH_RELEASE_ADMIN=on show `admission_unverified`; a resolver feeds the same evaluation.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_release_renders_5585.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceHead, createRevision, registerAsset } from '../src/services/workGraphRevisions.ts';
import type { Actor, AssetKind } from '../src/services/workGraphContracts.ts';
import {
  cutManifest, decideRelease, releaseStatus, renderGapIds, type ProfileName, type ReleaseContext,
} from '../src/services/workGraphReleases.ts';
import { RENDER_GAPS, renderAdmissionOf, renderModality, type RenderRevisionRow } from '../src/services/workGraphReleaseRenders.ts';
import { RELEASE_ADMIN_DEPS, RELEASE_REFUSAL_SENTENCES, releaseAdminContext } from '../src/services/workGraphReleaseAdmin.ts';
import { emptySwarmState, type SwarmState } from '../src/services/agents/swarmAdmission.ts';
import {
  ALICE, BOB, CTX, SCOPE, attestAll, count, decision, hex, newLine, piece, publish, world, type Piece, type W,
} from './_work_graph_release_world_5585.ts';
import { V7, V8, facts, ok, policy, request, swarmWorld } from './_swarm_world_5586.ts';

const agent = (runId: string): Actor => ({ kind: 'agent', agentRunId: runId, onBehalfOfUserId: 11, chargeId: null });

/** A revision an agent run wrote and a person accepted as the head: what a render is. */
async function rendered(w: W, key: string, kind: AssetKind, runId: string, mediaProfile: string, base?: Piece): Promise<Piece> {
  let asset = base?.asset;
  if (!asset) {
    const a = await registerAsset(w.env, CTX, { scope: SCOPE, kind, accessClass: 'confidential', approvalPolicy: 'team_review', actor: ALICE, idempotencyKey: `asset-${key}` });
    assert.ok(a.ok, JSON.stringify(a));
    asset = a.assetUid;
  }
  const digest = await hex(key);
  const source = kind === 'video'
    ? { store: 'stream' as const, locator: 'stream', id: `vid-${key}`, revision: key }
    : { store: 'r2_object' as const, locator: 'COMPANY_LOGOS', id: `graphics/${key}`, revision: key };
  const r = await createRevision(w.env, CTX, {
    assetUid: asset, parents: base ? [base.rev] : [], digest, byteLength: 10, mediaProfile, source, author: agent(runId), idempotencyKey: `rev-${key}`,
  });
  assert.ok(r.ok, JSON.stringify(r));
  const h = await advanceHead(w.env, CTX, {
    assetUid: asset, expectedRevisionUid: base?.rev ?? null, revisionUid: r.revisionUid, actor: ALICE, idempotencyKey: `adv-${key}`,
    approval: { ref: `approvals:item-${key}`, contentDigest: digest, reviewer: BOB, decidedAt: '2026-11-19T09:00:00Z' },
  });
  assert.ok(h.ok, JSON.stringify(h));
  return { asset, rev: r.revisionUid, digest, key, kind, source };
}

/** A public-free investors line pinning a video render, a brand image render and a code piece, every piece attested. */
async function renderRelease(w: W, key = 'r') {
  const video = await rendered(w, `${key}-video`, 'video', 'run_vid', 'video/mp4');
  const brand = await rendered(w, `${key}-brand`, 'image', 'run_img', 'image/png');
  const website = await piece(w, `${key}-website`, 'code', 'internal');
  await attestAll(w, video, ['marketing']);
  await attestAll(w, brand, ['marketing']);
  await attestAll(w, website, ['code']);
  const line = await newLine(w, `line-${key}`);
  const m = await cutManifest(w.env, CTX, {
    lineAssetUid: line, partial: false, author: ALICE, idempotencyKey: `man-${key}`,
    components: [
      { assetUid: video.asset, revisionUid: video.rev, digest: video.digest, role: 'video_master', profile: 'marketing' },
      { assetUid: brand.asset, revisionUid: brand.rev, digest: brand.digest, role: 'brand_image', profile: 'marketing' },
      { assetUid: website.asset, revisionUid: website.rev, digest: website.digest, role: 'website', profile: 'code' },
    ],
  });
  assert.ok(m.ok, JSON.stringify(m));
  return { video, brand, website, line, m };
}
type Release = Awaited<ReturnType<typeof renderRelease>>;

/** Both renders admitted by #5586 on their own base and settled at a measured cost within the reserve. */
async function admittedSwarm(r: Release, bills: { video?: number | 'unavailable'; brand?: number | 'unavailable' } = {}) {
  const s = swarmWorld();
  ok(await s.swarm.request(request(V7, 'video_render', { ticket_uid: 'run_vid', asset_uid: r.video.asset, base_revision_uid: null }), policy(V7), facts()));
  ok(await s.swarm.request(request(V7, 'brand_image', { ticket_uid: 'run_img', asset_uid: r.brand.asset, base_revision_uid: null }), policy(V7), facts()));
  const g = (await s.admission.admit()).find((x) => x.run_uid === 'run_vid')!;
  ok(await s.swarm.settle('run_vid', bills.video ?? 900, g.generation));
  ok(await s.swarm.settle('run_img', bills.brand ?? 400));
  return s;
}
const withSwarm = (swarm: SwarmState | null): ReleaseContext => ({ ...CTX, renderAdmissions: swarm });

const PROFILES: ProfileName[] = ['code', 'marketing'];
async function approveAll(w: W, ctx: ReleaseContext, m: { manifestUid: string; digest: string }, key: string) {
  return Promise.all(PROFILES.map((p) => decideRelease(w.env, ctx, decision(m.manifestUid, m.digest, p, `${key}-${p}`))));
}
async function gaps(w: W, ctx: ReleaseContext, manifestUid: string) {
  const st = await releaseStatus(w.env, ctx, manifestUid);
  assert.ok(st.ok, JSON.stringify(st));
  // Sorted by role, so the assertions do not depend on the order of generated asset uids.
  return st.release.renderGaps.map((g) => [g.role, g.gap, g.admissionCode]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}
/** The ids a `render_unadmitted` refusal carries: the manifest, then each gap's asset, revision, reason and code. */
async function refusalIds(w: W, ctx: ReleaseContext, manifestUid: string) {
  const st = await releaseStatus(w.env, ctx, manifestUid);
  assert.ok(st.ok);
  return [manifestUid, ...renderGapIds(st.release.renderGaps)];
}

// -------------------------------------------------------------------------------------------------------------------
test('1. admitted and settled within its reserve: approvable and publishable, with the bill in the evaluation', async () => {
  const w = world();
  const r = await renderRelease(w);
  const ctx = withSwarm(await (await admittedSwarm(r)).swarm.snapshot());
  const st = await releaseStatus(w.env, ctx, r.m.manifestUid);
  assert.ok(st.ok);
  assert.deepEqual(st.release.renderGaps, []);
  const byRole = Object.fromEntries(st.release.components.map((c) => [c.role, c.render]));
  assert.deepEqual(byRole.video_master, { modality: 'video_render', ticketUid: 'run_vid', gap: null, admissionCode: null, chargedMicrousd: 900, reserveMicrousd: 1000 });
  assert.deepEqual(byRole.brand_image, { modality: 'brand_image', ticketUid: 'run_img', gap: null, admissionCode: null, chargedMicrousd: 400, reserveMicrousd: 1000 });
  assert.equal(byRole.website, null, 'code is not a render');
  for (const d of await approveAll(w, ctx, r.m, 'ok')) assert.ok(d.ok, JSON.stringify(d));
  // The separate render approval is tied to the same budgets, and records like any decision.
  const render = await decideRelease(w.env, ctx, decision(r.m.manifestUid, r.m.digest, 'marketing', 'ok-render', { purpose: 'render' }));
  assert.ok(render.ok, JSON.stringify(render));
  const pub = await publish(w, r.line, r.m.manifestUid, null, 'pub-ok', ctx, [{ target: 'stream', ref: 'vid-campaign' }]);
  assert.ok(pub.ok, JSON.stringify(pub));
});

test('2. no swarm state passed: admission_unverified, refused at approval and at publication (and recorded)', async () => {
  const w = world();
  const r = await renderRelease(w);
  for (const ctx of [CTX, withSwarm(null)]) {
    assert.deepEqual(await gaps(w, ctx, r.m.manifestUid), [['brand_image', 'admission_unverified', null], ['video_master', 'admission_unverified', null]]);
  }
  const refused = await decideRelease(w.env, CTX, decision(r.m.manifestUid, r.m.digest, 'marketing', 'nv'));
  assert.equal(!refused.ok && refused.code, 'render_unadmitted');
  const ids = await refusalIds(w, CTX, r.m.manifestUid);
  assert.deepEqual(!refused.ok && refused.ids, ids);
  assert.deepEqual([...ids].sort(), [r.m.manifestUid, r.video.asset, r.video.rev, 'admission_unverified', r.brand.asset, r.brand.rev, 'admission_unverified'].sort());
  for (const purpose of ['publish', 'render'] as const) {
    const d = await decideRelease(w.env, CTX, decision(r.m.manifestUid, r.m.digest, 'code', `nv-${purpose}`, { purpose }));
    assert.equal(!d.ok && d.code, 'render_unadmitted', purpose);
  }
  // Asking for changes is never blocked: only an approval needs the render admitted.
  const changes = await decideRelease(w.env, CTX, decision(r.m.manifestUid, r.m.digest, 'marketing', 'nv-changes', { decision: 'request_changes' }));
  assert.ok(changes.ok, JSON.stringify(changes));
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_release_decisions WHERE decision = ?', 'approve'), 0);

  // Approvals recorded while the renders were admitted still cannot publish once the swarm state is not read.
  const w2 = world();
  const r2 = await renderRelease(w2);
  const good = withSwarm(await (await admittedSwarm(r2)).swarm.snapshot());
  for (const d of await approveAll(w2, good, r2.m, 'g')) assert.ok(d.ok);
  const pub = await publish(w2, r2.line, r2.m.manifestUid, null, 'pub-nv', CTX, []);
  assert.equal(!pub.ok && pub.code, 'render_unadmitted');
  assert.equal(count(w2, "SELECT COUNT(*) AS n FROM work_graph_events WHERE action = 'advance_refused' AND refusal_code = 'render_unadmitted'"), 1);
  assert.equal(count(w2, 'SELECT COUNT(*) AS n FROM work_graph_effects'), 0);
});

test('3. not admitted, refused by admission, waiting, not settled: each refused with the admission\'s own reason', async () => {
  const w = world();
  const r = await renderRelease(w);
  // Nothing in the swarm for either run.
  assert.deepEqual(await gaps(w, withSwarm(emptySwarmState()), r.m.manifestUid), [['brand_image', 'not_admitted', null], ['video_master', 'not_admitted', null]]);

  // Admission refused both requests: the video for its budget, the image for capacity with a full queue.
  const s = swarmWorld();
  const tight = policy(V7, { render_budget_microusd: 500 });
  const no = await s.swarm.request(request(V7, 'video_render', { ticket_uid: 'run_vid', asset_uid: r.video.asset }), tight, facts());
  assert.equal(!no.ok && no.code, 'budget_exhausted');
  const one = policy(V7, { max_waiting: 0, modalities: { ...policy(V7).modalities, brand_image: { max_concurrent: 1, providers: ['cloudflare'], models: ['@cf/black-forest-labs/flux-1-schnell'] } } });
  ok(await s.swarm.request(request(V7, 'brand_image'), one, facts()));
  const full = await s.swarm.request(request(V7, 'brand_image', { ticket_uid: 'run_img', asset_uid: r.brand.asset }), one, facts());
  assert.equal(!full.ok && full.code, 'no_capacity');
  const refusedCtx = withSwarm(await s.swarm.snapshot());
  assert.deepEqual(await gaps(w, refusedCtx, r.m.manifestUid), [['brand_image', 'refused', 'no_capacity'], ['video_master', 'refused', 'budget_exhausted']]);
  const d = await decideRelease(w.env, refusedCtx, decision(r.m.manifestUid, r.m.digest, 'marketing', 'refused'));
  const ids = await refusalIds(w, refusedCtx, r.m.manifestUid);
  assert.deepEqual(!d.ok && d.ids, ids);
  assert.deepEqual([...ids].sort(), [r.m.manifestUid, r.video.asset, r.video.rev, 'refused', 'budget_exhausted', r.brand.asset, r.brand.rev, 'refused', 'no_capacity'].sort());

  // The image waits behind capacity; the video was admitted and is still running.
  const q = swarmWorld();
  const oneWaits = policy(V7, { modalities: { ...policy(V7).modalities, brand_image: { max_concurrent: 1, providers: ['cloudflare'], models: ['@cf/black-forest-labs/flux-1-schnell'] } } });
  ok(await q.swarm.request(request(V7, 'brand_image'), oneWaits, facts()));
  assert.equal(ok(await q.swarm.request(request(V7, 'brand_image', { ticket_uid: 'run_img', asset_uid: r.brand.asset }), oneWaits, facts())).state, 'waiting');
  ok(await q.swarm.request(request(V7, 'video_render', { ticket_uid: 'run_vid', asset_uid: r.video.asset }), oneWaits, facts()));
  const pendingCtx = withSwarm(await q.swarm.snapshot());
  assert.deepEqual(await gaps(w, pendingCtx, r.m.manifestUid), [['brand_image', 'waiting', 'modality_capacity'], ['video_master', 'not_settled', null]]);
  const pub = await publish(w, r.line, r.m.manifestUid, null, 'pub-pending', pendingCtx, []);
  assert.equal(!pub.ok && pub.code, 'render_unadmitted');

  // Withdrawn before running: its end code.
  ok(await q.swarm.withdraw('run_img', V7));
  assert.deepEqual((await gaps(w, withSwarm(await q.swarm.snapshot()), r.m.manifestUid))[0], ['brand_image', 'withdrawn', 'withdrawn']);
});

test('4. unknown cost and over budget are refused, never reported as approved', async () => {
  const w = world();
  const r = await renderRelease(w);
  // The video settled without metrics (charged its reserve, an upper bound); the image cost more than its reserve.
  const ctx = withSwarm(await (await admittedSwarm(r, { video: 'unavailable', brand: 1500 })).swarm.snapshot());
  const st = await releaseStatus(w.env, ctx, r.m.manifestUid);
  assert.ok(st.ok);
  assert.deepEqual(st.release.renderGaps.map((g) => [g.role, g.gap, g.chargedMicrousd, g.reserveMicrousd]).sort(), [
    ['brand_image', 'over_budget', 1500, 1000], ['video_master', 'cost_unknown', 1000, 1000],
  ]);
  for (const d of await approveAll(w, ctx, r.m, 'cost')) assert.equal(!d.ok && d.code, 'render_unadmitted');
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_release_decisions'), 0);
  const pub = await publish(w, r.line, r.m.manifestUid, null, 'pub-cost', ctx, []);
  assert.equal(!pub.ok && pub.code, 'render_unadmitted');
  // Exactly at the reserve is within it.
  const w2 = world();
  const r2 = await renderRelease(w2);
  assert.deepEqual(await gaps(w2, withSwarm(await (await admittedSwarm(r2, { video: 1000, brand: 1000 })).swarm.snapshot()), r2.m.manifestUid), []);
});

test('5. cross-tenant: another venture\'s ticket or refusal under the same run uid never satisfies and never shows', async () => {
  const w = world();
  const r = await renderRelease(w);
  const s = swarmWorld();
  // Tenant 8 holds a settled render ticket under each run uid, on the same asset uids, within budget.
  ok(await s.swarm.request(request(V8, 'video_render', { ticket_uid: 'run_vid', asset_uid: r.video.asset }), policy(V8), facts()));
  const g = (await s.admission.admit()).find((x) => x.run_uid === 'run_vid')!;
  ok(await s.swarm.settle('run_vid', 900, g.generation));
  ok(await s.swarm.request(request(V8, 'brand_image', { ticket_uid: 'run_img', asset_uid: r.brand.asset }), policy(V8), facts()));
  ok(await s.swarm.settle('run_img', 400));
  const ctx = withSwarm(await s.swarm.snapshot());
  assert.deepEqual(await gaps(w, ctx, r.m.manifestUid), [['brand_image', 'not_admitted', null], ['video_master', 'not_admitted', null]]);
  const st = await releaseStatus(w.env, ctx, r.m.manifestUid);
  assert.ok(st.ok && st.release.components.every((c) => c.render === null || c.render.chargedMicrousd === null), 'tenant 8 bill is never shown');
  for (const d of await approveAll(w, ctx, r.m, 'x')) assert.equal(!d.ok && d.code, 'render_unadmitted');

  // A tenant 8 refusal under the run uid is not tenant 7's reason either.
  const sr = swarmWorld();
  const no = await sr.swarm.request(request(V8, 'video_render', { ticket_uid: 'run_vid', asset_uid: r.video.asset }), policy(V8, { render_budget_microusd: 1 }), facts());
  assert.equal(!no.ok && no.code, 'budget_exhausted');
  assert.deepEqual((await gaps(w, withSwarm(await sr.swarm.snapshot()), r.m.manifestUid))[1], ['video_master', 'not_admitted', null]);

  // And tenant 8 reading tenant 7's release is refused before anything is evaluated.
  const other = await releaseStatus(w.env, { scope: { tenantId: 8, companyId: 80, projectId: null }, renderAdmissions: await (await admittedSwarm(r)).swarm.snapshot() }, r.m.manifestUid);
  assert.equal(!other.ok && other.code, 'wrong_tenant');
});

test('6. stale admission: a ticket for another base, asset or modality does not cover the pinned revision', async () => {
  const w = world();
  const v1 = await rendered(w, 'st-video-v1', 'video', 'run_v1', 'video/mp4');
  // run_v2 wrote v2 on top of v1; the published release pins v2.
  const v2 = await rendered(w, 'st-video-v2', 'video', 'run_v2', 'video/mp4', v1);
  await attestAll(w, v2, ['marketing']);
  const line = await newLine(w, 'line-stale');
  const m = await cutManifest(w.env, CTX, { lineAssetUid: line, partial: false, author: ALICE, idempotencyKey: 'man-stale',
    components: [{ assetUid: v2.asset, revisionUid: v2.rev, digest: v2.digest, role: 'video_master', profile: 'marketing' }] });
  assert.ok(m.ok);
  const settled = async (patch: Record<string, unknown>, modality: 'video_render' | 'document' = 'video_render') => {
    const s = swarmWorld();
    ok(await s.swarm.request(request(V7, modality, { ticket_uid: 'run_v2', asset_uid: v2.asset, ...patch }), policy(V7), facts({ head_revision_uid: (patch.base_revision_uid ?? null) as string | null })));
    const g = (await s.admission.admit()).find((x) => x.run_uid === 'run_v2');
    ok(await s.swarm.settle('run_v2', 900, g?.generation));
    return withSwarm(await s.swarm.snapshot());
  };
  // Admitted on no base (the asset's first render), but v2 was built on v1: the admission was for another revision.
  const stale = await settled({ base_revision_uid: null });
  assert.deepEqual(await gaps(w, stale, m.manifestUid), [['video_master', 'other_revision', null]]);
  const no = await decideRelease(w.env, stale, decision(m.manifestUid, m.digest, 'marketing', 'st-stale'));
  assert.deepEqual(!no.ok && no.ids, [m.manifestUid, v2.asset, v2.rev, 'other_revision']);
  // Admitted for another asset.
  assert.deepEqual(await gaps(w, await settled({ base_revision_uid: v1.rev, asset_uid: 'asset_elsewhere' }), m.manifestUid), [['video_master', 'other_revision', null]]);
  // Admitted under another modality.
  assert.deepEqual(await gaps(w, await settled({ base_revision_uid: v1.rev }, 'document'), m.manifestUid), [['video_master', 'other_modality', null]]);
  // run_v1's settled ticket does not cover v2, which run_v2 wrote.
  const s1 = swarmWorld();
  ok(await s1.swarm.request(request(V7, 'video_render', { ticket_uid: 'run_v1', asset_uid: v2.asset }), policy(V7), facts()));
  const g1 = (await s1.admission.admit())[0];
  ok(await s1.swarm.settle('run_v1', 900, g1.generation));
  assert.deepEqual(await gaps(w, withSwarm(await s1.swarm.snapshot()), m.manifestUid), [['video_master', 'not_admitted', null]]);
  // On its own base it is current.
  const good = await settled({ base_revision_uid: v1.rev });
  assert.deepEqual(await gaps(w, good, m.manifestUid), []);
  const d = await decideRelease(w.env, good, decision(m.manifestUid, m.digest, 'marketing', 'st'));
  assert.ok(d.ok, JSON.stringify(d));
});

test('7. regression: pieces that are not renders are untouched, with or without swarm state', async () => {
  const w = world();
  // A person's video upload, an agent-written brand-token record, an agent-written image with no image profile, code.
  const upload = await piece(w, 'rg-video', 'video', 'confidential');
  const tokens = await rendered(w, 'rg-brand', 'brand', 'run_tok', 'application/json');
  const odd = await rendered(w, 'rg-image', 'image', 'run_odd', 'application/octet-stream');
  const website = await piece(w, 'rg-website', 'code', 'internal');
  for (const p of [upload, tokens, odd]) await attestAll(w, p, ['marketing']);
  await attestAll(w, website, ['code']);
  const line = await newLine(w, 'line-rg');
  const m = await cutManifest(w.env, CTX, { lineAssetUid: line, partial: false, author: ALICE, idempotencyKey: 'man-rg', components: [
    { assetUid: upload.asset, revisionUid: upload.rev, digest: upload.digest, role: 'video_master', profile: 'marketing' },
    { assetUid: tokens.asset, revisionUid: tokens.rev, digest: tokens.digest, role: 'brand_kit', profile: 'marketing' },
    { assetUid: odd.asset, revisionUid: odd.rev, digest: odd.digest, role: 'graphics', profile: 'marketing' },
    { assetUid: website.asset, revisionUid: website.rev, digest: website.digest, role: 'website', profile: 'code' },
  ] });
  assert.ok(m.ok);
  for (const ctx of [CTX, withSwarm(emptySwarmState())]) {
    const st = await releaseStatus(w.env, ctx, m.manifestUid);
    assert.ok(st.ok);
    assert.deepEqual([st.release.renderGaps, st.release.components.map((c) => c.render)], [[], [null, null, null, null]]);
  }
  for (const d of await approveAll(w, CTX, m, 'rg')) assert.ok(d.ok, JSON.stringify(d));
  const pub = await publish(w, line, m.manifestUid, null, 'pub-rg', CTX, [{ target: 'github_pr', ref: 'acme/site#9' }]);
  assert.ok(pub.ok, JSON.stringify(pub));
});

test('8. the pure rule: what a render is, malformed swarm state, and every reason named', () => {
  const row = (patch: Partial<RenderRevisionRow> = {}): RenderRevisionRow => ({ revision_uid: 'rv', asset_uid: 'as', tenant_id: 7, company_id: 70, kind: 'video',
    actor_kind: 'agent', agent_run_id: 'run_x', parent_uids_json: '[]', media_profile: 'video/mp4', ...patch });
  assert.equal(renderModality(row()), 'video_render');
  assert.equal(renderModality(row({ kind: 'brand', media_profile: 'IMAGE/SVG+XML' })), 'brand_image');
  assert.equal(renderModality(row({ kind: 'image', media_profile: 'image/png' })), 'brand_image');
  assert.equal(renderModality(row({ actor_kind: 'person', agent_run_id: null })), null);
  // A person's revision is never a render, whatever else it carries.
  assert.equal(renderModality(row({ actor_kind: 'person' })), null);
  assert.equal(renderModality(row({ kind: 'audio' })), null);
  assert.equal(renderModality(row({ kind: 'document', media_profile: 'image/png' })), null);
  for (const bad of [undefined, null, {} as SwarmState, { tickets: {}, audit: 'x' } as unknown as SwarmState]) {
    assert.equal(renderAdmissionOf(row(), bad)?.gap, 'admission_unverified');
  }
  assert.equal(renderAdmissionOf(row({ parent_uids_json: 'not json' }), emptySwarmState())?.gap, 'not_admitted');
  assert.equal(renderAdmissionOf(row({ kind: 'code' }), emptySwarmState()), null);
  assert.equal(RENDER_GAPS.length, new Set(RENDER_GAPS).size);
  assert.ok(RELEASE_REFUSAL_SENTENCES.render_unadmitted.length > 20);
});

test('9. the admin context: swarm state is not read by default (no binding), and a resolver feeds the evaluation', async () => {
  const w = world();
  const r = await renderRelease(w);
  const scope = { tenantId: 7, companyId: 70, projectId: null };
  const defaults = { ...RELEASE_ADMIN_DEPS };
  RELEASE_ADMIN_DEPS.authorities = async () => CTX.authorities!;
  RELEASE_ADMIN_DEPS.revokedUsers = async () => new Set<number>();
  try {
    const off = await releaseAdminContext(w.env, scope);
    assert.equal(off.renderAdmissions, null);
    assert.deepEqual((await gaps(w, off, r.m.manifestUid)).map((g) => g[1]), ['admission_unverified', 'admission_unverified']);
    const snap = await (await admittedSwarm(r)).swarm.snapshot();
    RELEASE_ADMIN_DEPS.renderAdmissions = async (_e, s) => { assert.deepEqual(s, scope); return snap; };
    const on = await releaseAdminContext(w.env, scope);
    assert.deepEqual(await gaps(w, on, r.m.manifestUid), []);
  } finally {
    Object.assign(RELEASE_ADMIN_DEPS, defaults);
  }
});
