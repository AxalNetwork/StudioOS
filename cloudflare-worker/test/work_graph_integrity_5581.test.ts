/**
 * D5581 part 3 (#5581, WorkGraph P0): content-addressed bytes in R2 `FILES`, integrity before release, the lease fence
 * at the head swap, tenant limits and the offline state, against a real SQLite database built from the three #5581
 * migrations, an in-memory R2 that checks SHA-256 like R2 does, and part 2's lease Durable Object.
 *
 *   1. putVerified writes under the digest with R2's checksum; a re-put reuses the object; audit and cost.
 *   2. A torn upload never lands, and a revision whose bytes never arrived never becomes the head.
 *   3. Digest or size mismatch, rot and an unverifiable object are refused at verify and at the head swap.
 *   4. Domain-held bytes are not re-verified (no R2 call); part 1's statement counts hold.
 *   5. Restricted and confidential records carry no plaintext preview, stored or returned.
 *   6. The fence: ignored while leases are off; while on, a stale, foreign or capability-less fence is refused.
 *   7. Tenant limits: assets, versions, bytes. Offline revisions are metadata only.
 *   8. Wrong tenant on every operation; every refusal leaves an audit row.
 *
 * Mutations checked (each applied alone, the two part 3 files run, then reverted; the tests that turned red):
 *   - advanceHead's `isWorkGraphBlobSource` block disabled: 2, 3, 6.
 *   - verifyBlob's size check removed: 3.  Its re-hash skipped whenever a checksum exists: 2, 3, 6 (rot, cost).
 *     Its no-checksum refusal removed: 3.
 *   - the CAS's `work_graph_revision_flags` NOT EXISTS neutralised: 7 here, reconcile 1 and 4.
 *   - `leasesOn(env)` in advanceHead forced true: 6.  The fence block disabled: 6.  `no_capability` mapped to
 *     `stale_fence`: 6.
 *   - putVerified's reuse branch disabled: 1.  The preview refusal removed: 5.  The stray-preview rewrite removed: 5.
 *     readRevisionMetadata's access-class check removed: 5.
 *   - the tenant byte pre-check removed: 7.  The ledger insert's byte guard loosened: 7 (the concurrent pair).
 *   - the asset cap's WHERE loosened: 7.  The version cap's: 7.
 *   - putVerified's `outOfScope` check removed: 8.  readRevisionBytes' offline check removed: 7.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from '../src/services/workGraphContracts.ts';
import {
  WORK_GRAPH_BLOB_DEPS, WORK_GRAPH_BLOB_LIMITS, blobKey, blobSourceRef, putVerified, readRevisionBytes, readRevisionMetadata,
  setRevisionOffline, verifyBlob,
} from '../src/services/workGraphBlobs.ts';
import { acquireLease, releaseLease, type WriteCapability } from '../src/services/workGraphLeases.ts';
import { WORK_GRAPH_LIMITS, createRevision, registerAsset } from '../src/services/workGraphRevisions.ts';
import {
  ALICE, BOB, CTX, OTHER, OTHER_CTX, SCOPE, advance, agent, asset, blobRev, bytesOf, count, headOf, rows, world, type W,
} from './_work_graph_world_5581.ts';

const PNG = bytesOf('png-bytes-of-the-cover-image');
const put = (w: W, bytes = PNG, over: Partial<Parameters<typeof putVerified>[2]> = {}, ctx = CTX, limits = WORK_GRAPH_BLOB_LIMITS) =>
  putVerified(w.env, ctx, { scope: SCOPE, bytes, accessClass: 'confidential', actor: ALICE, ...over }, limits);
const events = (w: W) => rows(w, 'SELECT action, outcome, refusal_code AS code, digest FROM work_graph_integrity_events ORDER BY id');
const refused = (w: W) => rows(w, "SELECT refusal_code AS code, revision_uid AS rev FROM work_graph_events WHERE action = 'advance_refused' ORDER BY id");

test('1. putVerified writes under the digest with R2\'s checksum; the same bytes again are reused; audit and cost', async () => {
  const w = world();
  const digest = await sha256Hex(PNG);
  const first = await put(w);
  assert.ok(first.ok, JSON.stringify(first));
  assert.equal(first.digest, digest);
  assert.equal(first.size, PNG.byteLength);
  assert.equal(first.key, `wg/v1/t7/c70/sha256/${digest}`);
  assert.deepEqual(first.source, { store: 'r2_object', locator: 'FILES', id: first.key, revision: digest });
  assert.equal(first.reused, false);
  const obj = w.r2.objects.get(first.key)!;
  assert.equal(obj.sha256, digest, 'R2 holds its own SHA-256 of the bytes');
  assert.deepEqual(Object.keys(obj.customMetadata).sort(), ['access', 'company', 'digest', 'size', 'tenant', 'wg']);
  assert.equal(obj.customMetadata.digest, digest);
  // head (absent), tenant bytes, put, batch of blob row + audit.
  assert.deepEqual(first.cost, { d1Statements: 3, d1Batches: 1, r2ClassA: 1, r2ClassB: 1 });

  const again = await put(w);
  assert.ok(again.ok && again.reused);
  assert.equal(w.r2.ops.put, 1, 'no second write');
  assert.deepEqual(again.cost, { d1Statements: 3, d1Batches: 1, r2ClassA: 0, r2ClassB: 1 });
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_blobs'), 1);
  assert.deepEqual(events(w).map((e) => e.action), ['blob_put', 'blob_reused']);
  const cost = rows(w, 'SELECT d1_statements AS d, r2_class_a AS a, r2_class_b AS b FROM work_graph_integrity_events ORDER BY id');
  assert.deepEqual(cost[0], { d: 3, a: 1, b: 1 }, 'the audit row carries the call\'s cost');

  // A corrupt object at the digest's key is replaced with the verified bytes.
  w.r2.rot(first.key);
  w.r2.objects.get(first.key)!.sha256 = null;
  const repaired = await put(w);
  assert.ok(repaired.ok && !repaired.reused);
  assert.equal(await sha256Hex(w.r2.objects.get(first.key)!.bytes), digest);
});

test('2. a torn upload never lands; a revision whose bytes never arrived never becomes the head', async () => {
  const w = world();
  w.r2.tearNext = true;
  const torn = await put(w);
  assert.ok(!torn.ok);
  assert.equal(torn.code, 'digest_mismatch');
  assert.equal(w.r2.objects.size, 0);
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_blobs'), 0);
  assert.deepEqual(events(w).map((e) => [e.action, e.code]), [['blob_refused', 'digest_mismatch']]);

  // The writer crashed between creating the revision and uploading: the revision exists, its bytes do not.
  const a = await asset(w, 'img');
  const digest = await sha256Hex(PNG);
  const v1 = await blobRev(w, a, 'v1', digest, PNG.byteLength);
  const r = await advance(w, a, null, v1, 'v1');
  assert.ok(!r.ok);
  assert.equal(r.code, 'bytes_unverified');
  assert.deepEqual(r.ids, [v1, 'missing_bytes', 'absent']);
  assert.equal(headOf(w, a).h, null, 'the head did not move');
  assert.deepEqual(refused(w), [{ code: 'bytes_unverified', rev: v1 }]);

  // Once the bytes are there, the same move goes through; a retry of it replays.
  assert.ok((await put(w)).ok);
  const ok = await advance(w, a, null, v1, 'v1-retry');
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal(headOf(w, a).h, v1);
  // asset, replay probe, revision, batch (swap + event), head read: part 1's six; plus R2 head and get.
  assert.deepEqual(ok.cost, { d1Statements: 6, d1Batches: 1, r2ClassB: 2 });
});

test('3. digest or size mismatch, rot and an unverifiable object are refused at verify and at the swap', async () => {
  const w = world();
  const p = await put(w);
  assert.ok(p.ok);
  assert.deepEqual(await verifyBlob(w.env, SCOPE, p.digest, p.size), { ok: true, method: 'rehash', size: p.size, r2ClassB: 2 });
  assert.equal((await verifyBlob(w.env, SCOPE, p.digest, p.size + 1)).ok, false);
  const sized = await verifyBlob(w.env, SCOPE, p.digest, p.size + 1);
  assert.ok(!sized.ok); assert.equal(sized.code, 'digest_mismatch'); assert.equal(sized.detail, 'size');
  const absent = await verifyBlob(w.env, SCOPE, 'e'.repeat(64), 3);
  assert.ok(!absent.ok); assert.equal(absent.code, 'missing_bytes');
  const other = await verifyBlob(w.env, OTHER, p.digest, p.size);
  assert.ok(!other.ok); assert.equal(other.code, 'missing_bytes', "another tenant's key holds nothing of this tenant's");

  // Above the re-hash size, R2's checksum decides; with no checksum there is nothing to trust.
  const small = { ...WORK_GRAPH_BLOB_LIMITS, deepVerifyMaxBytes: 4 };
  assert.deepEqual(await verifyBlob(w.env, SCOPE, p.digest, p.size, small), { ok: true, method: 'checksum', size: p.size, r2ClassB: 1 });
  w.r2.objects.get(p.key)!.sha256 = null;
  const blind = await verifyBlob(w.env, SCOPE, p.digest, p.size, small);
  assert.ok(!blind.ok); assert.equal(blind.detail, 'unverifiable');

  // Bit rot under an intact checksum is caught by the re-hash, and the swap refuses it.
  w.r2.objects.get(p.key)!.sha256 = p.digest;
  w.r2.rot(p.key);
  const rot = await verifyBlob(w.env, SCOPE, p.digest, p.size);
  assert.ok(!rot.ok); assert.equal(rot.detail, 'rehash');
  const a = await asset(w, 'img');
  const v1 = await blobRev(w, a, 'v1', p.digest, p.size);
  const r = await advance(w, a, null, v1, 'v1');
  assert.ok(!r.ok); assert.equal(r.code, 'bytes_unverified'); assert.deepEqual(r.ids, [v1, 'digest_mismatch', 'rehash']);

  // A truncated object, and a revision that declares the wrong size for intact bytes.
  const q = await put(w, bytesOf('second image'));
  assert.ok(q.ok);
  const v2 = await blobRev(w, a, 'v2', q.digest, q.size + 5);
  const wrongSize = await advance(w, a, null, v2, 'v2');
  assert.ok(!wrongSize.ok); assert.deepEqual(wrongSize.ids, [v2, 'digest_mismatch', 'size']);
  w.r2.truncate(q.key);
  const v3 = await blobRev(w, a, 'v3', q.digest, q.size);
  const cut = await advance(w, a, null, v3, 'v3');
  assert.ok(!cut.ok); assert.equal(cut.code, 'bytes_unverified');
  assert.equal(headOf(w, a).h, null);
  assert.deepEqual(refused(w).map((e) => e.code), ['bytes_unverified', 'bytes_unverified', 'bytes_unverified']);

  // A stale writer with good bytes is still refused by the CAS itself.
  const g = await put(w, bytesOf('third image'));
  assert.ok(g.ok);
  const h1 = await blobRev(w, a, 'h1', g.digest, g.size);
  assert.ok((await advance(w, a, null, h1, 'h1')).ok);
  const h2 = await blobRev(w, a, 'h2', g.digest, g.size, { parents: [h1] });
  const h3 = await blobRev(w, a, 'h3', g.digest, g.size, { parents: [h1], author: agent('run_b') });
  assert.ok((await advance(w, a, h1, h2, 'h2')).ok);
  const stale = await advance(w, a, h1, h3, 'h3');
  assert.ok(!stale.ok); assert.equal(stale.code, 'stale_revision');
});

test('4. domain-held bytes are not re-verified here: no R2 call, part 1\'s statement counts', async () => {
  const w = world();
  const a = await asset(w, 'deck', { kind: 'pitch_deck' });
  const r = await createRevision(w.env, CTX, {
    assetUid: a, parents: [], digest: 'a'.repeat(64), byteLength: 10, mediaProfile: 'application/json',
    source: { store: 'd1_record', locator: 'pitch_decks', id: '41', revision: '3' }, author: agent('run_a'), idempotencyKey: 'rev-deck',
  });
  assert.ok(r.ok);
  const moved = await advance(w, a, null, r.revisionUid, 'deck');
  assert.ok(moved.ok);
  assert.deepEqual(moved.cost, { d1Statements: 6, d1Batches: 1 });
  assert.equal(w.r2.totalOps(), 0);

  // A domain's own R2 object (deck-images/…) is pointed at, not WorkGraph's to verify.
  const img = await asset(w, 'domain-img');
  const d = await createRevision(w.env, CTX, {
    assetUid: img, parents: [], digest: 'b'.repeat(64), byteLength: 10, mediaProfile: 'image/png',
    source: { store: 'r2_object', locator: 'FILES', id: 'deck-images/700/x.png', revision: 'b'.repeat(64) }, author: agent('run_a'), idempotencyKey: 'rev-domain',
  });
  assert.ok(d.ok);
  assert.ok((await advance(w, img, null, d.revisionUid, 'domain')).ok);
  assert.equal(w.r2.totalOps(), 0);

  // A WorkGraph key must be this asset's own tenant and company and this digest.
  const foreign = await createRevision(w.env, CTX, {
    assetUid: img, parents: [], digest: 'c'.repeat(64), byteLength: 1, mediaProfile: 'image/png',
    source: blobSourceRef(OTHER, 'c'.repeat(64)), author: agent('run_a'), idempotencyKey: 'rev-foreign',
  });
  assert.ok(!foreign.ok); assert.equal(foreign.code, 'malformed'); assert.deepEqual(foreign.ids.slice(1), ['blob_key']);
  const otherDigest = await createRevision(w.env, CTX, {
    assetUid: img, parents: [], digest: 'c'.repeat(64), byteLength: 1, mediaProfile: 'image/png',
    source: blobSourceRef(SCOPE, 'd'.repeat(64)), author: agent('run_a'), idempotencyKey: 'rev-other-digest',
  });
  assert.ok(!otherDigest.ok); assert.equal(otherDigest.code, 'malformed');
});

test('5. restricted and confidential records carry no plaintext preview, stored or returned', async () => {
  const w = world();
  for (const accessClass of ['confidential', 'restricted'] as const) {
    const r = await put(w, PNG, { accessClass, preview: 'Q3 board memo: layoffs' });
    assert.ok(!r.ok); assert.equal(r.code, 'preview_forbidden');
  }
  assert.equal(w.r2.objects.size, 0);
  assert.deepEqual(events(w).map((e) => e.code), ['preview_forbidden', 'preview_forbidden']);

  const pub = await put(w, PNG, { accessClass: 'public', preview: 'Cover image' });
  assert.ok(pub.ok);
  const a = await asset(w, 'pub', { accessClass: 'public' });
  const v1 = await blobRev(w, a, 'v1', pub.digest, pub.size);
  const meta = await readRevisionMetadata(w.env, CTX, v1);
  assert.ok(meta.ok); assert.equal(meta.metadata.preview, 'Cover image');

  // The asset is reclassified: its preview is no longer returned, whatever the object still holds.
  w.db.prepare("UPDATE work_graph_assets SET access_class = 'restricted' WHERE asset_uid = ?").run(a);
  const hidden = await readRevisionMetadata(w.env, CTX, v1);
  assert.ok(hidden.ok); assert.equal(hidden.metadata.preview, null);
  assert.equal(hidden.metadata.accessClass, 'restricted');

  // A restricted put of the same bytes rewrites the shared object without the preview.
  const restricted = await put(w, PNG, { accessClass: 'restricted' });
  assert.ok(restricted.ok);
  assert.equal(w.r2.objects.get(pub.key)!.customMetadata.preview, undefined);
  assert.equal(w.r2.objects.get(pub.key)!.customMetadata.access, 'restricted');
  // No column of any WorkGraph table holds the preview text.
  const dump = JSON.stringify(rows(w, 'SELECT * FROM work_graph_integrity_events')) + JSON.stringify(rows(w, 'SELECT * FROM work_graph_blobs'));
  assert.ok(!dump.includes('Cover image'));
});

test('6. the fence: ignored while leases are off; while on, a stale, foreign or capability-less fence is refused', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  const w = world();
  const a = await asset(w, 'img');
  const p = await put(w);
  assert.ok(p.ok);
  const v1 = await blobRev(w, a, 'v1', p.digest, p.size);
  const unit = { kind: 'whole' as const, id: 'all' };
  const holder = { actorKind: 'agent' as const, agentRunId: 'run_a' };
  const cap = (h = holder): WriteCapability => ({ checked: true, scope: SCOPE, holder: h });

  // Leases off: a fence (even a nonsense one) changes nothing, and the lease object is never reached.
  const off = await advance(w, a, null, v1, 'off', { fence: { value: 999, unit, capability: null } });
  assert.ok(off.ok, JSON.stringify(off));
  assert.equal(off.cost.doCalls, undefined);
  assert.equal(w.lease.calls(), 0);
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_lease_events'), 0);

  w.setLeases('on');
  const v2 = await blobRev(w, a, 'v2', p.digest, p.size, { parents: [v1] });
  const res = { scope: SCOPE, assetId: a, unit };
  const g = await acquireLease(w.env, { scope: SCOPE }, res, holder, 30_000);
  assert.equal(g.status, 'granted');
  const fence = (g as any).fence as number;

  const noCap = await advance(w, a, v1, v2, 'nocap', { fence: { value: fence, unit, capability: null } });
  assert.ok(!noCap.ok); assert.equal(noCap.code, 'no_capability');
  // Bob's capability does not lend his authority to the agent's fence.
  const wrongCap = await advance(w, a, v1, v2, 'wrongcap', { fence: { value: fence, unit, capability: cap({ actorKind: 'person', userId: 12 } as any) } });
  assert.ok(!wrongCap.ok); assert.equal(wrongCap.code, 'no_capability');
  // The fence of another holder (the agent's) used by Bob.
  const foreign = await advance(w, a, v1, v2, 'foreign', { actor: BOB, fence: { value: fence, unit, capability: cap({ actorKind: 'person', userId: 12 } as any) } });
  assert.ok(!foreign.ok); assert.equal(foreign.code, 'stale_fence'); assert.deepEqual(foreign.ids, [a, String(fence), 'not_holder']);
  assert.equal(headOf(w, a).h, v1);

  const ok = await advance(w, a, v1, v2, 'fenced', { fence: { value: fence, unit, capability: cap() } });
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal(ok.cost.doCalls, 1);
  // part 1's six and its impact walk (not a first head), plus the lease audit's one statement in its own batch,
  // plus R2's head and get, plus one lease object call.
  assert.deepEqual(ok.cost, { d1Statements: 8, d1Batches: 2, r2ClassB: 2, doCalls: 1 });

  // Released: the same fence is now stale.
  assert.equal((await releaseLease(w.env, { scope: SCOPE }, res, fence, holder)).status, 'released');
  const v3 = await blobRev(w, a, 'v3', p.digest, p.size, { parents: [v2] });
  const stale = await advance(w, a, v2, v3, 'stale', { fence: { value: fence, unit, capability: cap() } });
  assert.ok(!stale.ok); assert.equal(stale.code, 'stale_fence'); assert.deepEqual(stale.ids, [a, String(fence), 'stale_fence']);
  // Leases on but no fence brought: optimistic concurrency alone, as in part 1.
  const bare = await advance(w, a, v2, v3, 'bare');
  assert.ok(bare.ok);

  assert.deepEqual(refused(w).map((e) => e.code), ['no_capability', 'no_capability', 'stale_fence', 'stale_fence']);
  const leaseRows = rows(w, "SELECT action, refusal_code AS code FROM work_graph_lease_events WHERE action IN ('refuse', 'check') ORDER BY id");
  assert.deepEqual(leaseRows, [
    { action: 'refuse', code: 'no_capability' }, { action: 'refuse', code: 'no_capability' }, { action: 'refuse', code: 'not_holder' },
    { action: 'check', code: null }, { action: 'refuse', code: 'stale_fence' },
  ]);

  // Residency: bytes that must stay in the EU never become a head in HQ's unrestricted bucket.
  const eu = await blobRev(w, a, 'eu', p.digest, p.size, { parents: [v3], residency: 'eu' });
  const euMove = await advance(w, a, v3, eu, 'eu');
  assert.ok(!euMove.ok); assert.equal(euMove.code, 'residency_mismatch');
});

test('7. tenant limits on assets, versions and bytes; an offline revision is metadata only', async () => {
  const w = world();
  const limits = { ...WORK_GRAPH_LIMITS, maxAssetsPerTenant: 2, maxVersionsPerTenant: 3 };
  const a1 = await registerAsset(w.env, CTX, { scope: SCOPE, kind: 'image', accessClass: 'internal', approvalPolicy: 'p', actor: ALICE, idempotencyKey: 'l1' }, limits);
  const a2 = await registerAsset(w.env, CTX, { scope: { ...SCOPE, companyId: 70, projectId: 701 }, kind: 'image', accessClass: 'internal', approvalPolicy: 'p', actor: ALICE, idempotencyKey: 'l2' }, limits);
  assert.ok(a1.ok && a2.ok);
  const a3 = await registerAsset(w.env, CTX, { scope: SCOPE, kind: 'image', accessClass: 'internal', approvalPolicy: 'p', actor: ALICE, idempotencyKey: 'l3' }, limits);
  assert.ok(!a3.ok); assert.equal(a3.code, 'tenant_limit'); assert.deepEqual(a3.ids, ['assets', '2']);
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_assets'), 2);
  assert.equal(count(w, "SELECT COUNT(*) AS n FROM work_graph_events WHERE action = 'register_asset'"), 2, 'no event for the refused asset');
  // Another tenant has its own allowance.
  const o1 = await registerAsset(w.env, OTHER_CTX, { scope: OTHER, kind: 'image', accessClass: 'internal', approvalPolicy: 'p', actor: ALICE, idempotencyKey: 'l1' }, limits);
  assert.ok(o1.ok);

  const mk = (assetUid: string, k: string) => createRevision(w.env, CTX, {
    assetUid, parents: [], digest: 'a'.repeat(64), byteLength: 1, mediaProfile: 'image/png',
    source: { store: 'r2_object', locator: 'FILES', id: `deck-images/${k}.png`, revision: k }, author: agent('run_a'), idempotencyKey: `v-${k}`,
  }, limits);
  assert.ok((await mk(a1.assetUid, 'x1')).ok);
  assert.ok((await mk(a2.assetUid, 'x2')).ok);
  assert.ok((await mk(a1.assetUid, 'x3')).ok);
  const over = await mk(a2.assetUid, 'x4');
  assert.ok(!over.ok); assert.equal(over.code, 'tenant_limit'); assert.deepEqual(over.ids, ['versions', '3']);
  assert.deepEqual(events(w).map((e) => [e.action, e.code]), [['limit_refused', 'tenant_limit'], ['limit_refused', 'tenant_limit']]);

  const bytesCap = { ...WORK_GRAPH_BLOB_LIMITS, maxBytesPerTenant: PNG.byteLength + 3 };
  assert.ok((await put(w, PNG, {}, CTX, bytesCap)).ok);
  const big = await put(w, bytesOf('four'), {}, CTX, bytesCap);
  assert.ok(!big.ok); assert.equal(big.code, 'tenant_limit');
  assert.equal(w.r2.ops.put, 1, 'no write is even attempted past the limit');
  assert.equal(w.r2.objects.size, 1);
  // Two puts that each fit, at once: the limit holds inside the ledger insert, and the loser's object is removed.
  const race = await (async () => {
    const r = world();
    const cap = { ...WORK_GRAPH_BLOB_LIMITS, maxBytesPerTenant: 10 };
    const [x, y] = await Promise.all([put(r, bytesOf('sixsix'), {}, CTX, cap), put(r, bytesOf('sevenxx'), {}, CTX, cap)]);
    return { r, codes: [x.ok ? 'ok' : x.code, y.ok ? 'ok' : y.code].sort() };
  })();
  assert.deepEqual(race.codes, ['ok', 'tenant_limit']);
  assert.equal(race.r.r2.objects.size, 1);
  assert.equal(count(race.r, 'SELECT COUNT(*) AS n FROM work_graph_blobs'), 1);
  const tooBig = await put(w, bytesOf('x'.repeat(40)), {}, CTX, { ...WORK_GRAPH_BLOB_LIMITS, maxPutBytes: 10 });
  assert.ok(!tooBig.ok); assert.equal(tooBig.code, 'size_limit');

  // Offline: bytes refused, metadata readable, never a head; back online, it moves.
  const img = await asset(w, 'off', { accessClass: 'internal' }, CTX);
  const p = await put(w, bytesOf('offline image'), { accessClass: 'internal', preview: 'cover' });
  assert.ok(p.ok);
  const v1 = await blobRev(w, img, 'off1', p.digest, p.size);
  const read = await readRevisionBytes(w.env, CTX, { revisionUid: v1, actor: ALICE });
  assert.ok(read.ok); assert.deepEqual([...read.bytes], [...bytesOf('offline image')]);
  const agentOff = await setRevisionOffline(w.env, CTX, { revisionUid: v1, offline: true, actor: agent('run_a'), reason: 'takedown' });
  assert.ok(!agentOff.ok); assert.equal(agentOff.code, 'person_required');
  const off = await setRevisionOffline(w.env, CTX, { revisionUid: v1, offline: true, actor: ALICE, reason: 'takedown' });
  assert.ok(off.ok && off.changed);
  const blocked = await readRevisionBytes(w.env, CTX, { revisionUid: v1, actor: ALICE });
  assert.ok(!blocked.ok); assert.equal(blocked.code, 'offline');
  const meta = await readRevisionMetadata(w.env, CTX, v1);
  assert.ok(meta.ok); assert.equal(meta.metadata.offline, true); assert.equal(meta.metadata.preview, null); assert.equal(meta.metadata.digest, p.digest);
  const move = await advance(w, img, null, v1, 'off1');
  assert.ok(!move.ok); assert.equal(move.code, 'offline'); assert.deepEqual(move.ids, [v1, 'offline']);
  assert.equal(headOf(w, img).h, null);
  const on = await setRevisionOffline(w.env, CTX, { revisionUid: v1, offline: false, actor: ALICE, reason: 'restored' });
  assert.ok(on.ok && on.changed);
  assert.ok((await advance(w, img, null, v1, 'off1-again')).ok);
  assert.deepEqual(events(w).filter((e) => e.action.startsWith('offline') || e.action === 'read_refused').map((e) => [e.action, e.code]),
    [['offline_set', null], ['read_refused', 'offline'], ['offline_cleared', null]]);
});

test('8. wrong tenant everywhere, each refusal audited; a project caller cannot reach another project', async () => {
  const w = world();
  const p = await put(w);
  assert.ok(p.ok);
  const a = await asset(w, 'img');
  const v1 = await blobRev(w, a, 'v1', p.digest, p.size);

  const foreignPut = await putVerified(w.env, OTHER_CTX, { scope: SCOPE, bytes: PNG, accessClass: 'internal', actor: BOB });
  assert.ok(!foreignPut.ok); assert.equal(foreignPut.code, 'wrong_tenant');
  const projectCaller = { scope: { tenantId: 7, companyId: 70, projectId: 999 } };
  const otherProject = await putVerified(w.env, projectCaller, { scope: SCOPE, bytes: PNG, accessClass: 'internal', actor: BOB });
  assert.ok(!otherProject.ok); assert.equal(otherProject.code, 'wrong_tenant');
  const bytes = await readRevisionBytes(w.env, OTHER_CTX, { revisionUid: v1, actor: BOB });
  assert.ok(!bytes.ok); assert.equal(bytes.code, 'wrong_tenant');
  const meta = await readRevisionMetadata(w.env, OTHER_CTX, v1);
  assert.ok(!meta.ok); assert.equal(meta.code, 'wrong_tenant');
  const off = await setRevisionOffline(w.env, OTHER_CTX, { revisionUid: v1, offline: true, actor: BOB, reason: 'x' });
  assert.ok(!off.ok); assert.equal(off.code, 'wrong_tenant');
  const head = await advance(w, a, null, v1, 'x');
  assert.ok(head.ok, 'the owner still can');
  assert.equal(w.r2.ops.put, 1);
  assert.deepEqual(events(w).filter((e) => e.outcome === 'refused').map((e) => e.code), ['wrong_tenant', 'wrong_tenant', 'wrong_tenant', 'wrong_tenant', 'wrong_tenant']);
  // No R2 binding: refused, never guessed.
  const bare = world({ files: false });
  const nb = await putVerified(bare.env, CTX, { scope: SCOPE, bytes: PNG, accessClass: 'internal', actor: ALICE });
  assert.ok(!nb.ok); assert.equal(nb.code, 'no_binding');
  assert.equal(blobKey(SCOPE, p.digest).startsWith('wg/v1/t7/c70/'), true);
  assert.equal(WORK_GRAPH_BLOB_DEPS.jurisdiction, null, "HQ's FILES bucket declares no jurisdiction");
});
