/**
 * D5585 part 2 (#5585, WorkGraph P1) — delivery of the queued `release_*` effects, revocation and takedown with
 * retention, and re-pointing a line to an earlier manifest by a forward re-pin, against a real SQLite database built
 * from the #5581 migrations and both #5585 migrations. No adapter reaches a provider: every one is a recording fake.
 *
 *   1. Delivery: the campaign's four effects are delivered once through #5581's outbox, each with its pinned pieces;
 *      a second drain sends nothing; each delivery row carries its D1 and provider cost.
 *   2. Ambiguous delivery is reconciled through the idempotency key: a send lost after the provider accepted it, and a
 *      provider that only accepts, are never sent twice; acceptance is not recorded as delivery.
 *   3. A stale effect cannot publish: an older release's effects after a newer publication, a stale digest and another
 *      tenant's manifest are withheld without a provider call.
 *   4. A takedown keeps the historical evidence and stops serving: manifest, decisions, attestations and audit stay;
 *      nothing is served; every confirmed delivery is retracted; the taken-down release can never be published again.
 *   5. Effects still queued when the takedown lands are withheld; a takedown that lands while a send is in flight still
 *      queues the retraction.
 *   6. A component takedown reaches every release that pins the piece, and no manifest pinning it publishes again.
 *   7. Takedowns refuse an agent, a revoked person, a stale identity, a person without the authority and another
 *      tenant, and record each refusal; a replay returns the first; a second takedown of the same thing changes nothing.
 *   8. Re-pin: re-pointing to the earlier manifest is a new manifest revision on the current head that re-pins the
 *      earlier component revisions, needs a fresh approval of its own digest and moves the pointer forward.
 *   9. The CAS takes earlier component revisions only when named, and never a tombstoned one.
 *  10. The two tables are append-only; a missing adapter dead-letters; a retraction of nothing is recorded.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_release_takedowns_5585.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALICE, BOB, CAROL, CI, CTX, DAVE, ERIN, NOBODY, OTHER_CTX, SAM, approve, approvedManifest, allCalls, attestAll, clock, components,
  count, decision, headOf, hex, newLine, providers, publish, published, revise, type W, world,
} from './_work_graph_release_world_5585.ts';
import { advanceHead, tombstoneRevision } from '../src/services/workGraphRevisions.ts';
import { drainEffects, deliverEffect, WORK_GRAPH_EFFECT_LIMITS } from '../src/services/workGraphEffects.ts';
import { cutManifest, decideRelease, publishedRelease, releaseStatus } from '../src/services/workGraphReleases.ts';
import { releaseEffectHandlers, RELEASE_RETRACT_KIND } from '../src/services/workGraphReleaseDelivery.ts';
import { repinRelease, servedRelease, takedownRelease, type TakedownInput } from '../src/services/workGraphReleaseTakedowns.ts';

const deliveries = (w: W) => w.db.prepare('SELECT * FROM work_graph_release_deliveries ORDER BY effect_id').all() as any[];
const effects = (w: W, kind?: string) => w.db.prepare(
  `SELECT id, effect_kind, state, attempts, last_error_code, payload_json FROM work_graph_effects ${kind ? 'WHERE effect_kind = ?' : ''} ORDER BY id`,
).all(...(kind ? [kind] : [])) as any[];
const later = (ms: number) => { clock.t += ms; };

function takedown(manifestUid: string, digest: string, line: string, key: string, over: Partial<TakedownInput> = {}): TakedownInput {
  return {
    lineAssetUid: line, manifestUid, digest, reasonCode: 'rights_withdrawn', evidenceRef: 'notice:rights-2026-11-19', authority: 'counsel',
    actor: ERIN, idempotencyKey: key, ...over,
  };
}

test('1. the queued release effects are delivered once, with their pinned pieces, through the outbox', async () => {
  const w = world();
  const { c, m, effectIds } = await published(w);
  const ps = providers();
  const r = await drainEffects(w.env, releaseEffectHandlers(ps));
  assert.deepEqual(r.results.map((x) => x.status), ['applied', 'applied', 'applied', 'applied']);
  assert.ok(r.cost.d1Statements > 0 && r.cost.d1Batches >= 4);
  const d = deliveries(w);
  assert.deepEqual(d.map((x) => [x.effect_id, x.op, x.target, x.outcome, x.reconciled, x.provider_calls]), [
    [effectIds[0], 'publish', 'github_pr', 'confirmed', 0, 2], [effectIds[1], 'publish', 'stream', 'confirmed', 0, 2],
    [effectIds[2], 'publish', 'signed_document', 'confirmed', 0, 2], [effectIds[3], 'publish', 'external_distribution', 'confirmed', 0, 2],
  ]);
  assert.ok(d.every((x) => x.manifest_uid === m.manifestUid && x.manifest_digest === m.digest && x.d1_statements >= 4 && x.external_ref));
  // The provider receives the pinned versions, never the latest, under the effect's own key.
  const sent = ps.stream.calls.find((x) => x.fn === 'send')!.req;
  assert.equal(sent.manifestUid, m.manifestUid);
  assert.equal(sent.idempotencyKey, `release:${m.manifestUid}:stream:vid-campaign`);
  assert.equal(sent.audience, 'investors');
  assert.deepEqual(sent.components.find((x) => x.role === 'deck'), { asset: c.p.deck.asset, revision: c.p.deck.rev, digest: c.p.deck.digest, role: 'deck', source: c.p.deck.source });
  assert.equal(ps.website_cdn.calls.length, 0);
  // A second drain and a redelivered effect send nothing.
  const again = await drainEffects(w.env, releaseEffectHandlers(ps));
  assert.equal(again.results.length, 0);
  assert.equal((await deliverEffect(w.env, releaseEffectHandlers(ps), effectIds[0])).status, 'already_applied');
  assert.equal(ps.github_pr.sends(), 1);
  assert.equal(count(w, `SELECT COUNT(*) AS n FROM work_graph_integrity_events WHERE action = 'effect_applied'`), 4);
});

test('2. an ambiguous delivery is reconciled by its key and never sent twice', async () => {
  const w = world();
  const { m, effectIds } = await published(w);
  const ps = providers();
  // The provider takes the send, then the response is lost.
  ps.stream.onSend = async (req, self) => {
    self.held.set(req.idempotencyKey, { status: 'confirmed', externalRef: 'stream-uid-1' });
    throw Object.assign(new Error('timeout'), { code: 'provider_timeout' });
  };
  // The signed-document provider only accepts at first; confirmation comes later.
  ps.signed_document.onSend = async (req, self) => {
    self.held.set(req.idempotencyKey, { status: 'accepted' });
    return { status: 'accepted' };
  };
  const h = releaseEffectHandlers(ps);
  let r = await deliverEffect(w.env, h, effectIds[1]);
  assert.equal(r.status, 'retry');
  assert.equal(effects(w).find((e) => e.id === effectIds[1]).last_error_code, 'provider_timeout');
  r = await deliverEffect(w.env, h, effectIds[2]);
  assert.equal(r.status, 'retry');
  assert.equal(effects(w).find((e) => e.id === effectIds[2]).last_error_code, 'awaiting_confirmation');
  assert.equal(deliveries(w).length, 0, 'acceptance is not delivery');

  later(WORK_GRAPH_EFFECT_LIMITS.baseBackoffMs);
  r = await deliverEffect(w.env, h, effectIds[1]);
  assert.equal(r.status, 'applied');
  r = await deliverEffect(w.env, h, effectIds[2]);
  assert.equal(r.status, 'retry', 'still only accepted: no second send');
  ps.signed_document.held.set(`release:${m.manifestUid}:signed_document:envelope-77`, { status: 'confirmed', externalRef: 'env-77-done' });
  later(2 * WORK_GRAPH_EFFECT_LIMITS.baseBackoffMs);
  r = await deliverEffect(w.env, h, effectIds[2]);
  assert.equal(r.status, 'applied');
  assert.equal(ps.stream.sends(), 1);
  assert.equal(ps.signed_document.sends(), 1);
  const d = deliveries(w);
  assert.deepEqual(d.map((x) => [x.target, x.outcome, x.reconciled, x.external_ref, x.attempt]), [
    ['stream', 'confirmed', 1, 'stream-uid-1', 2], ['signed_document', 'confirmed', 1, 'env-77-done', 3],
  ]);
});

test('3. a stale effect cannot publish: superseded, stale digest and another tenant are withheld without a call', async () => {
  const w = world();
  const { c, m, effectIds } = await published(w);
  // A newer release is published before the first one's effects are delivered.
  const copy2 = await revise(w, c.p.copy, 'copy-v2');
  await attestAll(w, copy2, ['marketing']);
  const m2 = await approvedManifest(w, c.line, { ...c.p, copy: copy2 }, 'm2', c.p.evidence.rev);
  const p2 = await publish(w, c.line, m2.manifestUid, m.manifestUid, 'pub-m2');
  assert.ok(p2.ok, JSON.stringify(p2));

  // A forged effect naming another tenant's manifest, and one with a stale digest.
  const forge = (tenant: number, company: number, key: string, digest: string) => w.db.prepare(
    `INSERT INTO work_graph_effects (tenant_id, company_id, asset_uid, effect_kind, idempotency_key, request_hash, payload_json, max_attempts, next_attempt_ms, created_at)
     VALUES (?, ?, ?, 'release_stream', ?, ?, ?, 5, 0, '2026-11-19T09:00:00Z')`,
  ).run(tenant, company, c.line, key, 'f'.repeat(64), JSON.stringify({ audience: 'investors', digest, line: c.line, manifest: m2.manifestUid, ref: 'vid-x', target: 'stream' }));
  forge(8, 80, 'forged-tenant', m2.digest);
  forge(7, 70, 'forged-digest', await hex('not the manifest'));

  const ps = providers();
  await drainEffects(w.env, releaseEffectHandlers(ps));
  const d = deliveries(w);
  const old = d.filter((x) => x.manifest_uid === m.manifestUid && effectIds.includes(x.effect_id));
  assert.deepEqual(old.map((x) => [x.outcome, x.reason_code, x.provider_calls]), Array(4).fill(['superseded', 'not_head', 0]));
  assert.deepEqual(d.filter((x) => x.target_ref === 'vid-x').map((x) => [x.tenant_id, x.outcome, x.reason_code]), [[8, 'withheld', 'wrong_tenant'], [7, 'withheld', 'stale_digest']]);
  // Only the newer release reached the providers, once per target.
  assert.equal(d.filter((x) => x.outcome === 'confirmed').length, 4);
  assert.ok(d.filter((x) => x.outcome === 'confirmed').every((x) => x.manifest_uid === m2.manifestUid));
  assert.equal(allCalls(ps), 8);
});

test('4. a takedown keeps the historical evidence, stops serving and retracts every confirmed delivery', async () => {
  const w = world();
  const { c, m } = await published(w);
  const ps = providers();
  await drainEffects(w.env, releaseEffectHandlers(ps));
  let served = await servedRelease(w.env, CTX, c.line);
  assert.ok(served.ok && served.served?.manifestUid === m.manifestUid);
  const before = {
    decisions: count(w, 'SELECT COUNT(*) AS n FROM work_graph_release_decisions'),
    attestations: count(w, 'SELECT COUNT(*) AS n FROM work_graph_release_attestations'),
    events: count(w, 'SELECT COUNT(*) AS n FROM work_graph_events'),
    revisions: count(w, 'SELECT COUNT(*) AS n FROM work_graph_revisions WHERE tombstoned_at IS NULL'),
  };

  const t = await takedownRelease(w.env, CTX, takedown(m.manifestUid, m.digest, c.line, 'td-1'));
  assert.ok(t.ok && t.changed, JSON.stringify(t));
  assert.equal(t.retractEffectIds.length, 4);
  assert.ok(t.cost.d1Statements > 0 && t.cost.d1Batches === 1);
  const row = w.db.prepare('SELECT * FROM work_graph_release_takedowns WHERE id = ?').get(t.takedownId) as any;
  assert.deepEqual([row.outcome, row.scope, row.reason_code, row.authority, row.actor_user_id, row.manifest_digest, row.retract_count],
    ['applied', 'manifest', 'rights_withdrawn', 'counsel', 15, m.digest, 4]);
  assert.equal(count(w, `SELECT COUNT(*) AS n FROM work_graph_integrity_events WHERE action = 'effect_enqueued' AND detail_json LIKE '%"cause":"takedown"%'`), 4);

  // Not served, and the reason is the takedown.
  served = await servedRelease(w.env, CTX, c.line);
  assert.ok(served.ok);
  assert.equal(served.served, null);
  assert.deepEqual(served.withheld?.takedowns.map((x) => x.id), [t.takedownId]);
  // Retained: the manifest, its pins, decisions, attestations, revisions and audit are all still there.
  const st = await releaseStatus(w.env, CTX, m.manifestUid);
  assert.ok(st.ok);
  assert.equal(st.release.published, true);
  assert.equal(st.release.approvals.length, 4);
  assert.deepEqual(st.release.takedowns.map((x) => x.reasonCode), ['rights_withdrawn']);
  const pub = await publishedRelease(w.env, CTX, c.line);
  assert.ok(pub.ok && pub.release?.components.find((x) => x.role === 'deck')?.revision === c.p.deck.rev);
  assert.deepEqual({
    decisions: count(w, 'SELECT COUNT(*) AS n FROM work_graph_release_decisions'),
    attestations: count(w, 'SELECT COUNT(*) AS n FROM work_graph_release_attestations'),
    events: count(w, 'SELECT COUNT(*) AS n FROM work_graph_events'),
    revisions: count(w, 'SELECT COUNT(*) AS n FROM work_graph_revisions WHERE tombstoned_at IS NULL'),
  }, before);

  // The retractions are delivered once each, naming the release they take back.
  await drainEffects(w.env, releaseEffectHandlers(ps));
  const r = deliveries(w).filter((x) => x.op === 'retract');
  assert.deepEqual(r.map((x) => [x.target, x.outcome, x.manifest_uid]), [
    ['external_distribution', 'retracted', m.manifestUid], ['github_pr', 'retracted', m.manifestUid],
    ['signed_document', 'retracted', m.manifestUid], ['stream', 'retracted', m.manifestUid],
  ]);
  assert.equal(ps.stream.sends('retract'), 1);

  // A release takedown withdraws that release: a new manifest of the same pieces is a new release, cut on it, that
  // needs its own approval; the taken-down manifest itself is refused for good (component content: test 6).
  const m2 = await approvedManifest(w, c.line, c.p, 'm-again', c.p.evidence.rev);
  const again = await publish(w, c.line, m2.manifestUid, m.manifestUid, 'pub-again');
  assert.ok(again.ok, JSON.stringify(again));
  const back = await publish(w, c.line, m.manifestUid, m2.manifestUid, 'pub-back');
  assert.equal(!back.ok && back.code, 'taken_down');
  assert.equal(headOf(w, c.line).h, m2.manifestUid);
});

test('5. effects queued when a takedown lands are withheld; a send in flight is still retracted', async () => {
  const w = world();
  const { c, m } = await published(w);
  const t = await takedownRelease(w.env, CTX, takedown(m.manifestUid, m.digest, c.line, 'td-early'));
  assert.ok(t.ok && t.retractEffectIds.length === 0, 'nothing was delivered yet, so nothing to retract');
  const ps = providers();
  await drainEffects(w.env, releaseEffectHandlers(ps));
  assert.deepEqual(deliveries(w).map((x) => [x.outcome, x.reason_code, x.provider_calls]), Array(4).fill(['withheld', 'taken_down', 0]));
  assert.equal(allCalls(ps), 0);

  // The race: the takedown commits while the provider is confirming the send.
  const w2 = world();
  const r2 = await published(w2);
  const ps2 = providers();
  ps2.stream.onSend = async (req, self) => {
    const td = await takedownRelease(w2.env, CTX, takedown(r2.m.manifestUid, r2.m.digest, r2.c.line, 'td-race'));
    assert.ok(td.ok && td.retractEffectIds.length === 0);
    const rec = { status: 'confirmed' as const, externalRef: 'stream-raced' };
    self.held.set(req.idempotencyKey, rec);
    return rec;
  };
  const h = releaseEffectHandlers(ps2);
  assert.equal((await deliverEffect(w2.env, h, r2.effectIds[1])).status, 'applied');
  const retract = effects(w2, RELEASE_RETRACT_KIND);
  assert.equal(retract.length, 1);
  assert.equal(JSON.parse(retract[0].payload_json).target, 'stream');
  assert.equal(count(w2, `SELECT COUNT(*) AS n FROM work_graph_integrity_events WHERE action = 'effect_enqueued' AND detail_json LIKE '%takedown_race%'`), 1);
  await deliverEffect(w2.env, h, retract[0].id);
  assert.deepEqual(deliveries(w2).filter((x) => x.op === 'retract').map((x) => [x.target, x.outcome]), [['stream', 'retracted']]);
  // Without a takedown the same confirmation queues nothing.
  const w3 = world();
  const r3 = await published(w3);
  await deliverEffect(w3.env, releaseEffectHandlers(providers()), r3.effectIds[1]);
  assert.equal(effects(w3, RELEASE_RETRACT_KIND).length, 0);
});

test('6. a component takedown reaches every release that pins the piece', async () => {
  const w = world();
  const { c, m } = await published(w);
  // A second investors line, a teaser, also carries the video.
  const line2 = await newLine(w, 'line-video');
  const v = await approvedManifest(w, line2, { video: c.p.video, evidence: c.p.evidence }, 'mv', c.p.evidence.rev);
  assert.ok((await publish(w, line2, v.manifestUid, null, 'pub-v', CTX, [{ target: 'stream', ref: 'vid-teaser' }])).ok);
  const ps = providers();
  await drainEffects(w.env, releaseEffectHandlers(ps));
  assert.equal(deliveries(w).filter((x) => x.outcome === 'confirmed').length, 5);

  const t = await takedownRelease(w.env, CTX, takedown(m.manifestUid, m.digest, c.line, 'td-video', {
    component: { revisionUid: c.p.video.rev, digest: c.p.video.digest }, reasonCode: 'consent_withdrawn', authority: 'brand_owner', actor: CAROL,
  }));
  assert.ok(t.ok && t.changed, JSON.stringify(t));
  assert.equal(t.retractEffectIds.length, 5, 'both releases pinning the video are retracted everywhere they went');
  for (const l of [c.line, line2]) {
    const s = await servedRelease(w.env, CTX, l);
    assert.ok(s.ok && s.served === null && s.withheld?.takedowns[0].revisionUid === c.p.video.rev);
  }
  const st = await releaseStatus(w.env, CTX, v.manifestUid);
  assert.ok(st.ok && st.release.components.find((x) => x.role === 'video')!.reasons.includes('taken_down'));
  // A new manifest pinning the taken-down video cannot be published (recorded), one without it can.
  const m2 = await approvedManifest(w, c.line, c.p, 'm2', c.p.evidence.rev);
  const p = await publish(w, c.line, m2.manifestUid, m.manifestUid, 'pub-m2');
  assert.equal(!p.ok && p.code, 'taken_down');
  assert.equal(count(w, `SELECT COUNT(*) AS n FROM work_graph_events WHERE action = 'advance_refused' AND refusal_code = 'taken_down'`), 1);
  const { video: _v, ...rest } = c.p;
  const m3 = await cutManifest(w.env, CTX, { lineAssetUid: c.line, components: components(rest), partial: true, author: ALICE, idempotencyKey: 'm3' });
  assert.ok(m3.ok);
  await approve(w, m3.manifestUid, m3.digest, 'm3', ['code', 'contract', 'investor_pitch', 'marketing'], c.p.evidence.rev);
  assert.ok((await publish(w, c.line, m3.manifestUid, m.manifestUid, 'pub-m3', CTX, [])).ok);
  const s = await servedRelease(w.env, CTX, c.line);
  assert.ok(s.ok && s.served?.manifestUid === m3.manifestUid && !s.served.components.some((x) => x.role === 'video'));
});

test('7. takedown refusals are recorded; a replay returns the first; a second takedown changes nothing', async () => {
  const w = world();
  const { c, m } = await published(w);
  const refuse = async (over: Partial<TakedownInput>, code: string, ctx = CTX) => {
    const r = await takedownRelease(w.env, ctx, takedown(m.manifestUid, m.digest, c.line, `bad-${code}-${Math.random()}`, over));
    assert.equal(!r.ok && r.code, code, JSON.stringify(r));
  };
  await refuse({ actor: CI }, 'person_required');
  await refuse({}, 'revoked_author', { ...CTX, revokedUserIds: new Set([15]) });
  await refuse({ digest: await hex('another release') }, 'stale_approval');
  await refuse({ component: { revisionUid: c.p.video.rev, digest: c.p.deck.digest } }, 'stale_approval');
  await refuse({ component: { revisionUid: 'wgr_nope', digest: c.p.deck.digest } }, 'unknown_reference');
  await refuse({ actor: NOBODY }, 'no_authority');
  await refuse({ actor: DAVE, authority: 'counsel' }, 'no_authority'); // claims an authority he does not hold
  await refuse({ actor: SAM, authority: 'auditor' }, 'no_authority'); // an authority no profile or takedown accepts
  await refuse({}, 'wrong_tenant', OTHER_CTX);
  const refused = w.db.prepare(`SELECT refusal_code, actor_user_id, tenant_id FROM work_graph_release_takedowns WHERE outcome = 'refused' ORDER BY id`).all() as any[];
  assert.deepEqual(refused.map((x) => x.refusal_code), ['person_required', 'revoked_author', 'stale_approval', 'stale_approval', 'unknown_reference', 'no_authority', 'no_authority', 'no_authority', 'wrong_tenant']);
  assert.ok(refused.every((x) => x.tenant_id === 7), 'recorded against the release\'s own tenant');
  assert.equal(count(w, `SELECT COUNT(*) AS n FROM work_graph_release_takedowns WHERE outcome = 'applied'`), 0);
  const s = await servedRelease(w.env, OTHER_CTX, c.line);
  assert.equal(!s.ok && s.code, 'wrong_tenant');

  // The security officer may always take content down; a replay returns the first; another key changes nothing.
  const first = await takedownRelease(w.env, CTX, takedown(m.manifestUid, m.digest, c.line, 'td', { actor: SAM, authority: 'security_officer', reasonCode: 'security' }));
  assert.ok(first.ok && first.changed);
  const replay = await takedownRelease(w.env, CTX, takedown(m.manifestUid, m.digest, c.line, 'td', { actor: SAM, authority: 'security_officer', reasonCode: 'security' }));
  assert.ok(replay.ok && replay.replayed && replay.takedownId === first.takedownId);
  const clash = await takedownRelease(w.env, CTX, takedown(m.manifestUid, m.digest, c.line, 'td', { actor: SAM, authority: 'security_officer', reasonCode: 'legal_order' }));
  assert.equal(!clash.ok && clash.code, 'idempotency_conflict');
  const second = await takedownRelease(w.env, CTX, takedown(m.manifestUid, m.digest, c.line, 'td-2'));
  assert.ok(second.ok && !second.changed && second.takedownId === first.takedownId);
  assert.equal(count(w, `SELECT COUNT(*) AS n FROM work_graph_release_takedowns WHERE outcome = 'applied'`), 1);
});

test('8. re-pointing to the earlier manifest is a forward re-pin that needs its own approval', async () => {
  const w = world();
  const { c, m } = await published(w);
  const ps = providers();
  await drainEffects(w.env, releaseEffectHandlers(ps));
  // v2 ships a new deck, which then has to come down.
  const deck2 = await revise(w, c.p.deck, 'deck-v2');
  await attestAll(w, deck2, ['investor_pitch']);
  const m2 = await approvedManifest(w, c.line, { ...c.p, deck: deck2 }, 'm2', c.p.evidence.rev);
  assert.ok((await publish(w, c.line, m2.manifestUid, m.manifestUid, 'pub-m2')).ok);
  const seq2 = headOf(w, c.line).s;
  assert.ok((await takedownRelease(w.env, CTX, takedown(m2.manifestUid, m2.digest, c.line, 'td-deck2', {
    component: { revisionUid: deck2.rev, digest: deck2.digest }, reasonCode: 'inaccurate', actor: DAVE, authority: 'founder',
  }))).ok);

  // Refusals first.
  let r = await repinRelease(w.env, CTX, { lineAssetUid: c.line, targetManifestUid: m2.manifestUid, author: ALICE, idempotencyKey: 'rp-head' });
  assert.equal(!r.ok && r.code, 'is_head');
  const unpub = await approvedManifest(w, c.line, { ...c.p, deck: deck2 }, 'm-unpub', c.p.evidence.rev);
  r = await repinRelease(w.env, CTX, { lineAssetUid: c.line, targetManifestUid: unpub.manifestUid, author: ALICE, idempotencyKey: 'rp-unpub' });
  assert.equal(!r.ok && r.code, 'not_published');
  r = await repinRelease(w.env, OTHER_CTX, { lineAssetUid: c.line, targetManifestUid: m.manifestUid, author: ALICE, idempotencyKey: 'rp-x' });
  assert.equal(!r.ok && r.code, 'wrong_tenant');

  // The re-pin: a NEW manifest on the current head, pinning the earlier component revisions.
  const rp = await repinRelease(w.env, CTX, { lineAssetUid: c.line, targetManifestUid: m.manifestUid, author: ALICE, idempotencyKey: 'rp' });
  assert.ok(rp.ok, JSON.stringify(rp));
  assert.equal(rp.baseManifestUid, m2.manifestUid);
  assert.equal(rp.repinOf, m.manifestUid);
  assert.notEqual(rp.digest, m.digest);
  const again = await repinRelease(w.env, CTX, { lineAssetUid: c.line, targetManifestUid: m.manifestUid, author: ALICE, idempotencyKey: 'rp' });
  assert.ok(again.ok && again.replayed && again.manifestUid === rp.manifestUid);
  const clash = await repinRelease(w.env, CTX, { lineAssetUid: c.line, targetManifestUid: unpub.manifestUid, author: ALICE, idempotencyKey: 'rp' });
  assert.equal(!clash.ok && clash.code, 'idempotency_conflict');
  assert.deepEqual(JSON.parse((w.db.prepare('SELECT parent_uids_json AS p FROM work_graph_revisions WHERE revision_uid = ?').get(rp.manifestUid) as any).p), [m2.manifestUid]);
  const edges = w.db.prepare(`SELECT to_revision_uid AS t FROM work_graph_edges WHERE from_revision_uid = ? AND edge_kind = 'component'`).all(rp.manifestUid) as any[];
  assert.ok(edges.some((e) => e.t === c.p.deck.rev) && !edges.some((e) => e.t === deck2.rev));

  const st = await releaseStatus(w.env, CTX, rp.manifestUid);
  assert.ok(st.ok);
  assert.equal(st.release.status, 'current');
  assert.equal(st.release.repinOf, m.manifestUid);
  assert.deepEqual(st.release.components.find((x) => x.role === 'deck')!.reasons, ['repinned']);
  assert.deepEqual(st.release.missingApprovals, ['code', 'contract', 'investor_pitch', 'marketing'], 'the earlier approvals bound another digest');

  // No approval of the re-pin's own digest: refused. Then approved, and published forward from the current head.
  let p = await publish(w, c.line, rp.manifestUid, m2.manifestUid, 'pub-rp-early', CTX, []);
  assert.equal(!p.ok && p.code, 'approval_required');
  await approve(w, rp.manifestUid, rp.digest, 'rp', ['code', 'contract', 'investor_pitch', 'marketing'], c.p.evidence.rev);
  p = await publish(w, c.line, rp.manifestUid, null, 'pub-rp-stale', CTX, []);
  assert.equal(!p.ok && p.code, 'stale_revision');
  p = await publish(w, c.line, rp.manifestUid, m2.manifestUid, 'pub-rp', CTX, [{ target: 'stream', ref: 'vid-campaign' }]);
  assert.ok(p.ok, JSON.stringify(p));
  assert.equal(headOf(w, c.line).h, rp.manifestUid);
  assert.equal(headOf(w, c.line).s, seq2 + 1, 'the pointer moved forward, never back');
  const s = await servedRelease(w.env, CTX, c.line);
  assert.ok(s.ok && s.served?.manifestUid === rp.manifestUid);
  assert.equal(s.served!.components.find((x) => x.role === 'deck')!.revision, c.p.deck.rev);
  // The working heads were not touched: the deck's head is still v2.
  assert.equal(headOf(w, c.p.deck.asset).h, deck2.rev);
  // And the re-pin's effect delivers the earlier pieces.
  await drainEffects(w.env, releaseEffectHandlers(ps));
  const last = ps.stream.calls.filter((x) => x.fn === 'send').at(-1)!.req;
  assert.equal(last.manifestUid, rp.manifestUid);
  assert.equal(last.components.find((x) => x.role === 'deck')!.revision, c.p.deck.rev);

  // A re-pin of a manifest a takedown covers is refused.
  r = await repinRelease(w.env, CTX, { lineAssetUid: c.line, targetManifestUid: m2.manifestUid, author: ALICE, idempotencyKey: 'rp-down' });
  assert.equal(!r.ok && r.code, 'taken_down');
});

test('9. the CAS takes earlier component revisions only when named, and never a tombstoned one', async () => {
  const w = world();
  const { c, m } = await published(w);
  const copy2 = await revise(w, c.p.copy, 'copy-v2');
  await attestAll(w, copy2, ['marketing']);
  const m2 = await approvedManifest(w, c.line, { ...c.p, copy: copy2 }, 'm2', c.p.evidence.rev);
  assert.ok((await publish(w, c.line, m2.manifestUid, m.manifestUid, 'pub-m2', CTX, [])).ok);
  const rp = await repinRelease(w.env, CTX, { lineAssetUid: c.line, targetManifestUid: m.manifestUid, author: ALICE, idempotencyKey: 'rp' });
  assert.ok(rp.ok);
  const raw = (key: string, hooks?: { repinnedComponents?: string[] }) => advanceHead(w.env, CTX, {
    assetUid: c.line, expectedRevisionUid: m2.manifestUid, revisionUid: rp.manifestUid, actor: ALICE, idempotencyKey: key,
    approval: { ref: 'approvals:raw', contentDigest: rp.digest, reviewer: CAROL, decidedAt: '2026-11-19T09:00:00Z' },
  }, hooks);
  let h = await raw('raw-1');
  assert.equal(!h.ok && h.code, 'composite_incompatible');
  assert.ok(!h.ok && h.ids.includes(c.p.copy.rev));
  // Tombstone the earlier copy (it is no longer a head): even named, the CAS refuses it.
  assert.ok((await tombstoneRevision(w.env, CTX, { revisionUid: c.p.copy.rev, actor: BOB, reason: 'retired' })).ok);
  h = await raw('raw-2', { repinnedComponents: [c.p.copy.rev] });
  assert.equal(!h.ok && h.code, 'tombstoned');
  assert.equal(headOf(w, c.line).h, m2.manifestUid);
  // Publication sees it before the CAS, and serving of the earlier manifest would be withheld.
  await approve(w, rp.manifestUid, rp.digest, 'rp', ['code', 'contract', 'investor_pitch', 'marketing'], c.p.evidence.rev);
  const p = await publish(w, c.line, rp.manifestUid, m2.manifestUid, 'pub-rp', CTX, []);
  assert.equal(!p.ok && p.code, 'reapproval_required');
  // A re-pin of a manifest whose piece is tombstoned is refused at the cut.
  const again = await repinRelease(w.env, CTX, { lineAssetUid: c.line, targetManifestUid: m.manifestUid, author: ALICE, idempotencyKey: 'rp-2' });
  assert.equal(!again.ok && again.code, 'tombstoned');

  // Named and live, the CAS takes it.
  const w2 = world();
  const r2 = await published(w2);
  const copy3 = await revise(w2, r2.c.p.copy, 'copy-v2');
  await attestAll(w2, copy3, ['marketing']);
  const n2 = await approvedManifest(w2, r2.c.line, { ...r2.c.p, copy: copy3 }, 'm2', r2.c.p.evidence.rev);
  assert.ok((await publish(w2, r2.c.line, n2.manifestUid, r2.m.manifestUid, 'pub-m2', CTX, [])).ok);
  const rp2 = await repinRelease(w2.env, CTX, { lineAssetUid: r2.c.line, targetManifestUid: r2.m.manifestUid, author: ALICE, idempotencyKey: 'rp' });
  assert.ok(rp2.ok);
  const ok = await advanceHead(w2.env, CTX, {
    assetUid: r2.c.line, expectedRevisionUid: n2.manifestUid, revisionUid: rp2.manifestUid, actor: ALICE, idempotencyKey: 'raw-ok',
    approval: { ref: 'approvals:raw', contentDigest: rp2.digest, reviewer: CAROL, decidedAt: '2026-11-19T09:00:00Z' },
  }, { repinnedComponents: [r2.c.p.copy.rev] });
  assert.ok(ok.ok, JSON.stringify(ok));
  // An ordinary cut still refuses a component that is not its asset's head.
  const draft = await cutManifest(w2.env, CTX, { lineAssetUid: r2.c.line, partial: true, author: ALICE, idempotencyKey: 'old', components: [
    { assetUid: r2.c.p.copy.asset, revisionUid: r2.c.p.copy.rev, digest: r2.c.p.copy.digest, role: 'copy', profile: 'marketing' },
  ] });
  assert.equal(!draft.ok && draft.code, 'composite_incompatible');
});

test('10. append-only tables, a missing adapter dead-letters, a retraction of nothing is recorded', async () => {
  const w = world();
  const { c, m, effectIds } = await published(w);
  const ps = providers();
  const { stream: _s, ...noStream } = ps;
  const h = releaseEffectHandlers(noStream);
  let last;
  for (let i = 0; i < WORK_GRAPH_EFFECT_LIMITS.maxAttempts; i++) {
    last = await deliverEffect(w.env, h, effectIds[1]);
    later(WORK_GRAPH_EFFECT_LIMITS.maxBackoffMs);
  }
  assert.equal(last!.status, 'dead');
  assert.equal(effects(w).find((e) => e.id === effectIds[1]).last_error_code, 'no_adapter');

  await drainEffects(w.env, releaseEffectHandlers(ps));
  // The provider lost the delivery on its side: a retraction finds nothing and says so.
  ps.github_pr.onSend = async (req) => (req.op === 'retract' ? { status: 'absent' } : { status: 'confirmed' });
  ps.github_pr.held.clear();
  const t = await takedownRelease(w.env, CTX, takedown(m.manifestUid, m.digest, c.line, 'td'));
  assert.ok(t.ok && t.retractEffectIds.length === 3, 'the dead stream effect was never delivered, so it is not retracted');
  await drainEffects(w.env, releaseEffectHandlers(ps));
  assert.deepEqual(deliveries(w).filter((x) => x.op === 'retract').map((x) => [x.target, x.outcome]), [
    ['external_distribution', 'retracted'], ['github_pr', 'nothing_to_retract'], ['signed_document', 'retracted'],
  ]);

  for (const sql of [
    `UPDATE work_graph_release_takedowns SET reason_code = 'policy'`, `DELETE FROM work_graph_release_takedowns`,
    `UPDATE work_graph_release_deliveries SET outcome = 'withheld'`, `DELETE FROM work_graph_release_deliveries`,
  ]) assert.throws(() => w.db.exec(sql), /D5585 part 2/, sql);
  // Render approvals are recorded apart and still never publish (part 1), whatever this part adds.
  assert.ok((await decideRelease(w.env, CTX, decision(m.manifestUid, m.digest, 'marketing', 'render', { purpose: 'render' }))).ok);
});
