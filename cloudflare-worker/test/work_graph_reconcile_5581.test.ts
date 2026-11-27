/**
 * D5581 part 3 (#5581, WorkGraph P0): reconciliation of WorkGraph bytes and the bounded effect outbox, on the shared
 * world (`_work_graph_world_5581.ts`: real SQLite from the #5581 migrations, an in-memory R2, a mocked clock).
 *
 *   1. Half-uploaded bytes: flagged `bytes_missing` past the grace period, never advanced, cleared when they return.
 *   2. Orphans past grace are deleted, young or referenced ones kept, a company hold blocks deletion; tenants apart.
 *   3. Tombstoned revisions: bytes deleted after retention (permanent `bytes_deleted`), kept while shared or held.
 *   4. Residency: refused at put, flagged at reconcile, refused at the head swap.
 *   5. Expired leases with no release or expiry row are audited once; stuck effects counted; dry run writes nothing.
 *   6. The outbox: applied at most once by key under double, concurrent and taken-over delivery.
 *   7. The outbox: per-tenant cap, retry with backoff, dead letter, replay and conflict, bounded drain.
 *   8. Wrong tenant on reconcile, holds and the outbox; each refusal audited.
 *
 * Mutations checked (each applied alone, the two part 3 files run, then reverted; the tests that turned red):
 *   - reconcile's missing-bytes flag write dropped: 1.  Its grace cutoff ignored: 1.
 *   - the orphan `referenced` check removed: 2, 3, 4.  `companyHold` forced false: 2.  The orphan grace removed: 2.
 *   - the retention `keep` count ignored: 3 (shared bytes deleted).  The asset-hold check removed: 3.
 *   - the `bytes_deleted` flag not written: 3.  The retention cutoff ignored: 3.
 *   - reconcile's residency flag removed: 4.  putVerified's residency refusal removed: 4.
 *   - the lease query's "already observed" NOT EXISTS neutralised: 5.  `dryRun` ignored for writes: 5.
 *   - deliverEffect's lapsed-claim condition dropped: 6.  Its `applied` early return removed: 6.  The
 *     CASE…changes() guard replaced by 'applied': 6 (the taken-over delivery commits).
 *   - the enqueue cap loosened: 7.  `backoffMs` returning 0: 7.  `dead` never set: 7.
 *   - enqueueEffect's and reconcile's `outOfScope` removed: 8 (each alone).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from '../src/services/workGraphContracts.ts';
import { WORK_GRAPH_BLOB_DEPS, blobKey, putVerified, readRevisionBytes } from '../src/services/workGraphBlobs.ts';
import { placeHold, reconcileWorkGraph, releaseHold } from '../src/services/workGraphReconcile.ts';
import {
  WORK_GRAPH_EFFECT_LIMITS, deliverEffect, drainEffects, effectStatus, enqueueEffect, type EffectHandler,
} from '../src/services/workGraphEffects.ts';
import { tombstoneRevision } from '../src/services/workGraphRevisions.ts';
import {
  ALICE, BOB, CTX, DAY, HOUR, OTHER, OTHER_CTX, SCOPE, advance, agent, asset, blobRev, bytesOf, clock, count, headOf, rows,
  world, type W,
} from './_work_graph_world_5581.ts';

const RC = { scope: { tenantId: 7, companyId: 70 }, graceMs: HOUR, retentionMs: 7 * DAY };
const events = (w: W, action?: string) => rows(w, `SELECT action, outcome, refusal_code AS code, revision_uid AS rev, digest FROM work_graph_integrity_events${action ? ' WHERE action = ?' : ''} ORDER BY id`, ...(action ? [action] : []));
const flags = (w: W, rev: string) => rows(w, 'SELECT flag FROM work_graph_revision_flags WHERE revision_uid = ? AND cleared_at IS NULL ORDER BY flag', rev).map((r) => r.flag);
const put = (w: W, s: string, over: Partial<Parameters<typeof putVerified>[2]> = {}) =>
  putVerified(w.env, CTX, { scope: SCOPE, bytes: bytesOf(s), accessClass: 'internal', actor: ALICE, ...over });

test('1. half-uploaded bytes are flagged past the grace period, never advanced, and cleared when they return', async () => {
  const w = world();
  const a = await asset(w, 'img');
  const body = bytesOf('never uploaded');
  const digest = await sha256Hex(body);
  const v1 = await blobRev(w, a, 'v1', digest, body.byteLength);

  const young = await reconcileWorkGraph(w.env, CTX, RC);
  assert.ok(young.ok);
  assert.deepEqual(young.report.missingBytes, [], 'within the grace period the upload may still be under way');
  assert.equal(young.report.checked, 0);

  clock.t += 2 * HOUR;
  const r = await reconcileWorkGraph(w.env, CTX, RC);
  assert.ok(r.ok);
  assert.deepEqual(r.report.missingBytes, [v1]);
  assert.deepEqual(flags(w, v1), ['bytes_missing']);
  assert.deepEqual(events(w, 'bytes_missing').map((e) => e.rev), [v1]);
  // A second run does not re-flag it.
  const again = await reconcileWorkGraph(w.env, CTX, RC);
  assert.ok(again.ok); assert.deepEqual(again.report.missingBytes, []);

  // Uploaded now: verify passes, but the flag still refuses the swap until reconcile has seen the bytes.
  assert.ok((await putVerified(w.env, CTX, { scope: SCOPE, bytes: body, accessClass: 'internal', actor: ALICE })).ok);
  const blocked = await advance(w, a, null, v1, 'v1');
  assert.ok(!blocked.ok); assert.equal(blocked.code, 'bytes_unverified'); assert.deepEqual(blocked.ids, [v1, 'bytes_missing']);
  assert.equal(headOf(w, a).h, null);
  const back = await reconcileWorkGraph(w.env, CTX, RC);
  assert.ok(back.ok); assert.deepEqual(back.report.restored, [v1]);
  assert.deepEqual(flags(w, v1), []);
  assert.ok((await advance(w, a, null, v1, 'v1-again')).ok);
});

test('2. orphans past grace are deleted; young or referenced ones kept; a company hold blocks deletion; tenants apart', async () => {
  const w = world();
  const kept = await put(w, 'referenced');
  const orphan = await put(w, 'orphan');
  const foreign = await putVerified(w.env, OTHER_CTX, { scope: OTHER, bytes: bytesOf('orphan of tenant 8'), accessClass: 'internal', actor: BOB });
  assert.ok(kept.ok && orphan.ok && foreign.ok);
  const a = await asset(w, 'img');
  await blobRev(w, a, 'v1', kept.digest, kept.size);
  clock.t += 2 * HOUR;
  const young = await put(w, 'young orphan');
  assert.ok(young.ok);

  const hold = await placeHold(w.env, CTX, { scope: RC.scope, actor: ALICE, reason: 'litigation' });
  assert.ok(hold.ok);
  const held = await reconcileWorkGraph(w.env, CTX, RC);
  assert.ok(held.ok);
  assert.deepEqual(held.report.orphans.map((o) => [o.digest, o.action]), [[orphan.digest, 'held']]);
  assert.ok(w.r2.objects.has(orphan.key));
  assert.equal(events(w, 'deletion_blocked').length, 1);

  const agentRelease = await releaseHold(w.env, CTX, { holdId: hold.holdId, actor: agent('run_a'), reason: 'done' });
  assert.ok(!agentRelease.ok); assert.equal(agentRelease.code, 'person_required');
  assert.ok((await releaseHold(w.env, CTX, { holdId: hold.holdId, actor: ALICE, reason: 'settled' })).ok);
  const r = await reconcileWorkGraph(w.env, CTX, RC);
  assert.ok(r.ok);
  assert.deepEqual(r.report.orphans.map((o) => [o.digest, o.action]), [[orphan.digest, 'deleted']]);
  assert.ok(!w.r2.objects.has(orphan.key));
  assert.ok(w.r2.objects.has(kept.key), 'referenced bytes stay');
  assert.ok(w.r2.objects.has(young.key), 'a young orphan stays');
  assert.ok(w.r2.objects.has(foreign.key), "another tenant's orphan is not this tenant's to delete");
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_blobs WHERE deleted_at IS NOT NULL'), 1);
  assert.deepEqual(events(w, 'blob_deleted').map((e) => e.digest), [orphan.digest]);
  // The same bytes put again come back to life in the ledger.
  assert.ok((await put(w, 'orphan')).ok);
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_blobs WHERE deleted_at IS NOT NULL'), 0);
});

test('3. tombstoned bytes go after retention, permanently; shared or held bytes stay', async () => {
  const w = world();
  const a = await asset(w, 'img');
  const b = await asset(w, 'img2');
  const old = await put(w, 'old cover');
  const shared = await put(w, 'shared cover');
  const cur = await put(w, 'current cover');
  assert.ok(old.ok && shared.ok && cur.ok);
  const v1 = await blobRev(w, a, 'v1', old.digest, old.size);
  const v2 = await blobRev(w, a, 'v2', shared.digest, shared.size, { parents: [v1] });
  const v3 = await blobRev(w, a, 'v3', cur.digest, cur.size, { parents: [v2] });
  const bShared = await blobRev(w, b, 'b1', shared.digest, shared.size);
  assert.ok((await advance(w, a, null, v1, 'v1')).ok);
  assert.ok((await advance(w, a, v1, v2, 'v2')).ok);
  assert.ok((await advance(w, a, v2, v3, 'v3')).ok);
  assert.ok((await tombstoneRevision(w.env, CTX, { revisionUid: v1, actor: ALICE, reason: 'erase' })).ok);
  assert.ok((await tombstoneRevision(w.env, CTX, { revisionUid: v2, actor: ALICE, reason: 'erase' })).ok);

  clock.t += 2 * DAY;
  const early = await reconcileWorkGraph(w.env, CTX, RC);
  assert.ok(early.ok); assert.deepEqual(early.report.retention, [], 'not yet past retention');

  clock.t += 6 * DAY;
  const hold = await placeHold(w.env, CTX, { scope: RC.scope, assetUid: a, actor: ALICE, reason: 'audit' });
  assert.ok(hold.ok);
  const held = await reconcileWorkGraph(w.env, CTX, RC);
  assert.ok(held.ok);
  assert.deepEqual(Object.fromEntries(held.report.retention.map((x) => [x.digest, x.action])), { [old.digest]: 'held', [shared.digest]: 'shared' });
  assert.ok(w.r2.objects.has(old.key));

  assert.ok((await releaseHold(w.env, CTX, { holdId: hold.holdId, actor: ALICE, reason: 'closed' })).ok);
  const r = await reconcileWorkGraph(w.env, CTX, RC);
  assert.ok(r.ok);
  const byDigest = Object.fromEntries(r.report.retention.map((x) => [x.digest, x.action]));
  assert.deepEqual(byDigest, { [old.digest]: 'deleted', [shared.digest]: 'shared' });
  assert.ok(!w.r2.objects.has(old.key));
  assert.ok(w.r2.objects.has(shared.key), 'still the bytes of a live revision of another asset');
  assert.ok(w.r2.objects.has(cur.key));
  assert.deepEqual(flags(w, v1), ['bytes_deleted']);
  assert.deepEqual(flags(w, v2), []);
  assert.deepEqual(flags(w, bShared), []);
  const read = await readRevisionBytes(w.env, CTX, { revisionUid: v1, actor: ALICE });
  assert.ok(!read.ok); assert.equal(read.code, 'bytes_deleted');
  // The deletion tombstone is permanent: no writer can clear it.
  assert.throws(() => w.db.prepare("UPDATE work_graph_revision_flags SET cleared_at = 'x' WHERE revision_uid = ?").run(v1), /permanent/);
  assert.equal(headOf(w, a).h, v3);
});

test('4. residency: refused at put, flagged at reconcile, refused at the head swap', async () => {
  const w = world();
  const refused = await put(w, 'eu bytes', { residency: 'eu' });
  assert.ok(!refused.ok); assert.equal(refused.code, 'residency_mismatch');
  assert.equal(w.r2.objects.size, 0);
  assert.deepEqual(events(w).map((e) => e.code), ['residency_mismatch']);
  const unknown = await put(w, 'mars bytes', { residency: 'mars' });
  assert.ok(!unknown.ok); assert.equal(unknown.code, 'residency_mismatch');

  // A bucket in the EU holds EU bytes.
  WORK_GRAPH_BLOB_DEPS.jurisdiction = 'eu';
  try {
    const ok = await put(w, 'eu bytes', { residency: 'eu' });
    assert.ok(ok.ok, JSON.stringify(ok));
    const a = await asset(w, 'img');
    const v1 = await blobRev(w, a, 'v1', ok.digest, ok.size, { residency: 'eu' });
    // The bucket's binding moved to an unrestricted one: the revision is flagged and never becomes a head.
    WORK_GRAPH_BLOB_DEPS.jurisdiction = null;
    clock.t += 2 * HOUR;
    const r = await reconcileWorkGraph(w.env, CTX, RC);
    assert.ok(r.ok); assert.deepEqual(r.report.residencyFlagged, [v1]);
    assert.deepEqual(flags(w, v1), ['residency_mismatch']);
    const move = await advance(w, a, null, v1, 'v1');
    assert.ok(!move.ok); assert.equal(move.code, 'residency_mismatch');
    WORK_GRAPH_BLOB_DEPS.jurisdiction = 'eu';
    const still = await advance(w, a, null, v1, 'v1-eu');
    assert.ok(!still.ok); assert.equal(still.code, 'residency_mismatch', 'the flag holds until a person clears it');
  } finally {
    WORK_GRAPH_BLOB_DEPS.jurisdiction = null;
  }
});

test('5. expired leases are audited once; stuck effects counted; a dry run writes nothing', async () => {
  const w = world();
  const ins = w.db.prepare(`INSERT INTO work_graph_lease_events (tenant_id, company_id, project_id, asset_id, unit_kind, unit_id, action, fence, actor_kind, agent_run_id, expires_at_ms)
    VALUES (?, ?, NULL, ?, 'whole', 'all', ?, ?, 'agent', 'run_a', ?)`);
  ins.run(7, 70, 'wga_x', 'acquire', 1, clock.t - 1000); // lapsed, never released: a crashed or idle object
  ins.run(7, 70, 'wga_x', 'acquire', 2, clock.t - 1000);
  ins.run(7, 70, 'wga_x', 'release', 2, null);           // released: nothing to report
  ins.run(7, 70, 'wga_x', 'acquire', 3, clock.t - 1000);
  ins.run(7, 70, 'wga_x', 'renew', 3, clock.t + 60_000); // renewed past now: still live
  ins.run(8, 80, 'wga_y', 'acquire', 1, clock.t - 1000); // another tenant's
  w.db.prepare(`INSERT INTO work_graph_effects (tenant_id, company_id, effect_kind, idempotency_key, request_hash, payload_json, state, attempts, max_attempts, next_attempt_ms, claim_token, claimed_until_ms, created_at)
    VALUES (7, 70, 'rerender', 'k', ?, '{}', 'claimed', 1, 5, 0, 'dead-worker', ?, 'x')`).run('0'.repeat(64), clock.t - 1);

  const dry = await reconcileWorkGraph(w.env, CTX, { ...RC, dryRun: true });
  assert.ok(dry.ok);
  assert.deepEqual(dry.report.expiredLeases, [{ assetId: 'wga_x', fence: 1, expiresAtMs: clock.t - 1000 }]);
  assert.equal(dry.report.stuckEffects, 1);
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_integrity_events'), 0, 'a dry run writes no row');

  const r = await reconcileWorkGraph(w.env, CTX, RC);
  assert.ok(r.ok); assert.equal(r.report.expiredLeases.length, 1);
  assert.equal(events(w, 'lease_expiry_observed').length, 1);
  const again = await reconcileWorkGraph(w.env, CTX, RC);
  assert.ok(again.ok); assert.deepEqual(again.report.expiredLeases, [], 'observed once');
  // Cost: the bounded reads, one list, and one batch for the findings.
  assert.equal(r.cost.r2ClassA, 1);
  assert.equal(r.cost.d1Batches, 1);
});

test('6. an effect is applied at most once by its key under double, concurrent and taken-over delivery', async () => {
  const w = world();
  w.db.exec('CREATE TABLE fx (k TEXT PRIMARY KEY, n INTEGER)');
  let calls = 0;
  const handlers: Record<string, EffectHandler> = {
    rerender: async (e, env) => { calls++; return [env.DB.prepare('INSERT INTO fx (k, n) VALUES (?, 1)').bind(e.idempotencyKey)]; },
  };
  const e = await enqueueEffect(w.env, CTX, { scope: SCOPE, assetUid: 'wga_1', kind: 'rerender', idempotencyKey: 'head:wga_1:2', payload: { revision: 'wgr_2' }, actor: agent('run_a') });
  assert.ok(e.ok && !e.replayed);
  const [x, y] = await Promise.all([deliverEffect(w.env, handlers, e.effectId), deliverEffect(w.env, handlers, e.effectId)]);
  assert.deepEqual([x.status, y.status].sort(), ['applied', 'busy']);
  const late = await deliverEffect(w.env, handlers, e.effectId);
  assert.equal(late.status, 'already_applied');
  assert.equal(calls, 1);
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM fx'), 1);

  // A delivery whose claim lapsed mid-effect (a slow or dead worker) and was taken over commits nothing.
  const f = await enqueueEffect(w.env, CTX, { scope: SCOPE, kind: 'rerender', idempotencyKey: 'head:wga_1:3', payload: { revision: 'wgr_3' }, actor: agent('run_a') });
  assert.ok(f.ok);
  let takeover: Promise<any> | null = null;
  const slow: Record<string, EffectHandler> = {
    rerender: async (ef, env) => {
      if (!takeover) {
        clock.t += WORK_GRAPH_EFFECT_LIMITS.claimMs + 1;
        takeover = deliverEffect(env, handlers, ef.id);
        await takeover;
      }
      return [env.DB.prepare('INSERT INTO fx (k, n) VALUES (?, 2)').bind(`${ef.idempotencyKey}:slow`)];
    },
  };
  const first = await deliverEffect(w.env, slow, f.effectId);
  assert.equal(first.status, 'already_applied');
  assert.equal((await takeover!).status, 'applied');
  assert.deepEqual(rows(w, 'SELECT k, n FROM fx ORDER BY k'), [{ k: 'head:wga_1:2', n: 1 }, { k: 'head:wga_1:3', n: 1 }]);
  assert.equal(events(w, 'effect_applied').length, 2);
});

test('7. the outbox is bounded per tenant, retries with backoff, and dead-letters', async () => {
  const w = world();
  const limits = { ...WORK_GRAPH_EFFECT_LIMITS, maxPendingPerTenant: 2, maxAttempts: 3 };
  const enq = (key: string, ctx = CTX, scope = SCOPE, payload = { r: key }) =>
    enqueueEffect(w.env, ctx, { scope, kind: 'notify', idempotencyKey: key, payload, actor: ALICE }, limits);
  const e1 = await enq('a');
  const e2 = await enq('b');
  assert.ok(e1.ok && e2.ok);
  const full = await enq('c');
  assert.ok(!full.ok); assert.equal(full.code, 'queue_full');
  assert.ok((await enq('a')).ok, 'a replay is not a new effect');
  const replay = await enq('a');
  assert.ok(replay.ok && replay.replayed && replay.effectId === e1.effectId);
  const conflict = await enq('a', CTX, SCOPE, { r: 'other' });
  assert.ok(!conflict.ok); assert.equal(conflict.code, 'idempotency_conflict');
  const otherTenant = await enq('c', OTHER_CTX, OTHER);
  assert.ok(otherTenant.ok, "another tenant's queue is its own");
  const bad = await enqueueEffect(w.env, CTX, { scope: SCOPE, kind: 'notify', idempotencyKey: 'x', payload: { body: 'y'.repeat(300) }, actor: ALICE }, limits);
  assert.ok(!bad.ok); assert.equal(bad.code, 'malformed', 'a payload names ids, it carries no content');

  let fails = 0;
  const flaky: Record<string, EffectHandler> = { notify: async () => { fails++; throw Object.assign(new Error('smtp down'), { code: 'upstream_down' }); } };
  const t0 = clock.t;
  const r1 = await deliverEffect(w.env, flaky, e1.effectId, limits);
  assert.deepEqual([r1.status, r1.attempts, r1.nextAttemptMs], ['retry', 1, t0 + 30_000]);
  assert.equal((await deliverEffect(w.env, flaky, e1.effectId, limits)).status, 'not_due');
  clock.t = t0 + 30_000;
  const r2 = await deliverEffect(w.env, flaky, e1.effectId, limits);
  assert.deepEqual([r2.status, r2.nextAttemptMs], ['retry', t0 + 30_000 + 60_000]);
  clock.t = t0 + 90_000;
  const r3 = await deliverEffect(w.env, flaky, e1.effectId, limits);
  assert.equal(r3.status, 'dead');
  assert.equal(fails, 3);
  assert.equal((await deliverEffect(w.env, flaky, e1.effectId, limits)).status, 'dead');
  assert.equal(fails, 3, 'a dead effect is never run again');
  const st = await effectStatus(w.env, CTX, { scope: SCOPE, idempotencyKey: 'a' });
  assert.ok(st.ok); assert.deepEqual([st.state, st.attempts, st.lastErrorCode], ['dead', 3, 'upstream_down']);
  assert.deepEqual(events(w).filter((e) => e.action.startsWith('effect_') && e.action !== 'effect_enqueued').map((e) => [e.action, e.code]), [
    ['effect_refused', 'queue_full'], ['effect_refused', 'idempotency_conflict'], ['effect_retry', null], ['effect_retry', null], ['effect_dead', null],
  ]);
  // A dead effect leaves room in the bounded queue.
  assert.ok((await enq('c')).ok);

  // The drain takes only what is due, at most its limit, and a missing handler is a failure, not a success.
  const drained = await drainEffects(w.env, { notify: async () => {} }, { limit: 1 }, limits);
  assert.equal(drained.results.length, 1);
  assert.equal(drained.results[0].status, 'applied');
  const none = await drainEffects(w.env, {}, {}, limits);
  assert.ok(none.results.every((r) => r.status === 'retry'));
});

test('8. wrong tenant on reconcile, holds and the outbox; each refusal audited', async () => {
  const w = world();
  const r = await reconcileWorkGraph(w.env, OTHER_CTX, RC);
  assert.ok(!r.ok); assert.equal(r.code, 'wrong_tenant');
  const project = await reconcileWorkGraph(w.env, { scope: { tenantId: 7, companyId: 70, projectId: 700 } }, RC);
  assert.ok(!project.ok); assert.equal(project.code, 'wrong_tenant', 'reconcile is a company-wide act');
  const h = await placeHold(w.env, OTHER_CTX, { scope: RC.scope, actor: BOB, reason: 'x' });
  assert.ok(!h.ok); assert.equal(h.code, 'wrong_tenant');
  const mine = await placeHold(w.env, CTX, { scope: RC.scope, actor: ALICE, reason: 'x' });
  assert.ok(mine.ok);
  const rel = await releaseHold(w.env, OTHER_CTX, { holdId: mine.holdId, actor: BOB, reason: 'x' });
  assert.ok(!rel.ok); assert.equal(rel.code, 'wrong_tenant');
  const missingAsset = await placeHold(w.env, CTX, { scope: RC.scope, assetUid: 'wga_of_tenant_8', actor: ALICE, reason: 'x' });
  assert.ok(!missingAsset.ok); assert.equal(missingAsset.code, 'not_found');
  const e = await enqueueEffect(w.env, OTHER_CTX, { scope: SCOPE, kind: 'notify', idempotencyKey: 'k', payload: {}, actor: BOB });
  assert.ok(!e.ok); assert.equal(e.code, 'wrong_tenant');
  const s = await effectStatus(w.env, OTHER_CTX, { scope: SCOPE, idempotencyKey: 'k' });
  assert.ok(!s.ok); assert.equal(s.code, 'wrong_tenant');
  assert.equal(count(w, "SELECT COUNT(*) AS n FROM work_graph_integrity_events WHERE refusal_code = 'wrong_tenant'"), 6);
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_effects'), 0);
  const nb = await reconcileWorkGraph(world({ files: false }).env, CTX, RC);
  assert.ok(!nb.ok); assert.equal(nb.code, 'no_binding');
  assert.equal(blobKey(SCOPE, 'a'.repeat(64)), `wg/v1/t7/c70/sha256/${'a'.repeat(64)}`);
});
