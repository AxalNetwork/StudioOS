/** D5583 part 2 — synthetic preflight against the landed registry and blob integrity service; no live storage. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareMediaUpload, MEDIA_BUFFER_MAX_BYTES, MEDIA_PIN_LIMIT, type PrepareMediaInput } from '../src/services/workGraphMediaStorage.ts';
import { putVerified, readRevisionBytes } from '../src/services/workGraphBlobs.ts';
import { sha256Hex } from '../src/services/workGraphContracts.ts';
import { ALICE, CTX, OTHER_CTX, SCOPE, asset, world, blobRev, bytesOf, count } from './_work_graph_world_5581.ts';
const chunk = (name: string, n = 0) => Uint8Array.from([0, 0, 0, n, ...bytesOf(name), ...new Uint8Array(n), 0, 0, 0, 0]);
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', 13), ...chunk('IEND')]);
const provenance = () => ({ origin: 'upload' as const, rights: { basis: 'owned' as const, usageScope: ['deck'] } });
const input = (assetUid: string, over: Partial<PrepareMediaInput> = {}): PrepareMediaInput => ({ assetUid, expectedHead: null, by: ALICE,
  kind: 'image', objectClass: 'master', declaredMime: 'image/png', bytes: PNG, provenance: provenance(), use: 'deck', ...over });
const code = (r: Awaited<ReturnType<typeof prepareMediaUpload>>) => r.ok ? 'ok' : r.code;

test('four classes prepare exact admitted bytes and scope-derived attribution; no R2 or registry mutation', async () => {
  const w = world(); const id = await asset(w, 'media');
  for (const objectClass of ['master', 'snapshot', 'rendition', 'thumbnail'] as const) {
    const r = await prepareMediaUpload(w.env, CTX, input(id, { objectClass }));
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.objectClass, objectClass); assert.equal(r.mediaProfile, 'image/png'); assert.equal(r.format, 'png');
    assert.equal(r.digest, await sha256Hex(PNG)); assert.deepEqual(r.bytes, PNG); assert.deepEqual(r.scope, SCOPE);
    assert.deepEqual(r.attribution, { companyId: 70, projectId: 700 });
    assert.deepEqual(r.cost, { d1Statements: 1, r2ClassA: 0, r2ClassB: 0 });
  }
  assert.equal(w.r2.objects.size, 0); assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_revisions'), 0);
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_blobs'), 0);
  w.db.close();
});

test('cross-tenant, project scope, revoked actors, missing assets and stale heads refuse before byte writes', async () => {
  const w = world(); const id = await asset(w, 'scope');
  assert.equal(code(await prepareMediaUpload(w.env, OTHER_CTX, input(id))), 'wrong_tenant');
  assert.equal(code(await prepareMediaUpload(w.env, { scope: { ...SCOPE, projectId: 701 } }, input(id))), 'wrong_tenant');
  assert.equal(code(await prepareMediaUpload(w.env, { ...CTX, revokedUserIds: new Set([11]) }, input(id))), 'revoked_author');
  const by = { kind: 'agent' as const, agentRunId: 'revoked', onBehalfOfUserId: 11, chargeId: 'synthetic' };
  assert.equal(code(await prepareMediaUpload(w.env, { ...CTX, revokedAgentRunIds: new Set(['revoked']) }, input(id, { by }))), 'revoked_author');
  assert.equal(code(await prepareMediaUpload(w.env, CTX, input('absent'))), 'not_found');
  assert.equal(code(await prepareMediaUpload(w.env, CTX, input(id, { expectedHead: 'old' }))), 'stale_head');
  assert.equal(w.r2.ops.put, 0); w.db.close();
});

test('corrupt, unsafe, unsupported, oversized and MIME mismatched bodies fail closed before D1', async () => {
  const w = world(); const id = await asset(w, 'formats');
  for (const [over, expected] of [
    [{ bytes: PNG.slice(0, 20) }, 'corrupt'], [{ bytes: new Uint8Array() }, 'empty'],
    [{ bytes: new Uint8Array(MEDIA_BUFFER_MAX_BYTES + 1) }, 'oversized'],
    [{ bytes: bytesOf('not a media file') }, 'unsupported_format'],
    [{ declaredMime: 'text/html' }, 'mime_mismatch'],
    [{ declaredMime: 'image/svg+xml', bytes: bytesOf('<svg><script/></svg>') }, 'unsafe_metadata'],
  ] as const) {
    const r = await prepareMediaUpload(w.env, CTX, input(id, over));
    assert.equal(code(r), expected); assert.equal(r.cost.d1Statements, 0);
  }
  assert.equal(w.r2.ops.put, 0); w.db.close();
});

test('rights and pinned resources are checked before storage; fonts remain names/licenses', async () => {
  const w = world(); const id = await asset(w, 'rights'); const dependency = await asset(w, 'dependency');
  const revoked = provenance(); Object.assign(revoked.rights, { revokedAt: '2026-11-01T00:00:00Z' });
  const r = await prepareMediaUpload(w.env, CTX, input(id, { provenance: revoked }));
  assert.ok(!r.ok && r.code === 'provenance'); assert.deepEqual(r.provenance, ['license_revoked']);
  const expired = provenance(); Object.assign(expired.rights, { expiresAt: '2026-11-01T00:00:00Z' });
  const e = await prepareMediaUpload(w.env, CTX, input(id, { provenance: expired }));
  assert.ok(!e.ok && e.provenance?.includes('license_expired'));
  assert.equal(code(await prepareMediaUpload(w.env, CTX, input(id, { dependencies: [{ kind: 'texture', assetUid: dependency, revisionUid: 'old' }] }))), 'stale_dependency');
  assert.equal(code(await prepareMediaUpload(w.env, CTX, input(id, { provenance: { ...provenance(), origin: 'derived', sourceRevisionUid: 'old' } }))), 'stale_dependency');
  assert.equal(code(await prepareMediaUpload(w.env, CTX, input(id, { dependencies: [{ kind: 'font', family: 'Example', license: 'OFL-1.1', bytes: PNG } as never] }))), 'font_binary');
  const good = await prepareMediaUpload(w.env, CTX, input(id, { dependencies: [{ kind: 'font', family: 'Example', license: 'OFL-1.1' }] }));
  assert.ok(good.ok); assert.deepEqual(good.dependencies.fonts, [{ family: 'Example', license: 'OFL-1.1', foundry: null }]);
  assert.equal(code(await prepareMediaUpload(w.env, CTX, input(id, { dependencies: new Array(MEDIA_PIN_LIMIT + 1).fill({}) }))), 'malformed');
  assert.equal(w.r2.ops.put, 0); w.db.close();
});

test('preparation owns its admitted byte snapshot; a caller mutation during D1 cannot change it', async () => {
  const w = world(); const id = await asset(w, 'snapshot'); const bytes = PNG.slice();
  const pending = prepareMediaUpload(w.env, CTX, input(id, { bytes })); bytes.fill(0);
  const r = await pending; assert.ok(r.ok); assert.deepEqual(r.bytes, PNG); assert.equal(r.digest, await sha256Hex(PNG));
  w.db.close();
});

test('synthetic bytes from a preparation round-trip through the existing blob service and revision reader', async () => {
  const w = world(); const id = await asset(w, 'readback');
  const prepared = await prepareMediaUpload(w.env, CTX, input(id)); assert.ok(prepared.ok);
  // Test the landed source dependency only, not an implemented quota/class upload path.
  const stored = await putVerified(w.env, CTX, { scope: prepared.scope, bytes: prepared.bytes, accessClass: prepared.accessClass, actor: ALICE, assetUid: id });
  assert.ok(stored.ok); assert.equal(stored.digest, prepared.digest);
  const revision = await blobRev(w, id, 'readback-rev', stored.digest, stored.size);
  const read = await readRevisionBytes(w.env, CTX, { revisionUid: revision, actor: ALICE });
  assert.ok(read.ok); assert.deepEqual(read.bytes, PNG); assert.equal(read.digest, prepared.digest);
  const foreign = await readRevisionBytes(w.env, OTHER_CTX, { revisionUid: revision, actor: ALICE });
  assert.ok(!foreign.ok && foreign.code === 'wrong_tenant');
  w.r2.objects.get(stored.key)!.bytes.fill(0);
  const corrupt = await readRevisionBytes(w.env, CTX, { revisionUid: revision, actor: ALICE });
  assert.ok(!corrupt.ok && corrupt.code === 'digest_mismatch');
  w.db.close();
});

import { storeMediaUpload } from '../src/services/workGraphMediaStorage.ts';
import { reconcileWorkGraph } from '../src/services/workGraphReconcile.ts';
import { verifyBlob } from '../src/services/workGraphBlobs.ts';
import { advance, clock, DAY, rows } from './_work_graph_world_5581.ts';

function ownerFixture(w: ReturnType<typeof world>) {
  w.db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, founder_id INTEGER);
    INSERT INTO users VALUES (11,'admin',101),(12,'founder',102);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, company_id INTEGER, founder_id INTEGER);
    INSERT INTO projects VALUES (700,70,101);
    CREATE TABLE user_company_links (id INTEGER PRIMARY KEY, company_id INTEGER, user_id INTEGER,is_primary_admin INTEGER,created_at TEXT);
    INSERT INTO user_company_links VALUES (1,70,11,1,'2026-01-01');`);
}

test('store uses separate physical class prefixes and the existing ledger; dedup/readback remain scoped', async () => {
  const w = world(); ownerFixture(w); const id = await asset(w, 'classed');
  const stored = [];
  for (const objectClass of ['master','snapshot','rendition','thumbnail'] as const) {
    const r = await storeMediaUpload(w.env, CTX, input(id, { objectClass })); assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.key, new RegExp(`/media/p700/${objectClass}/sha256/`));
    assert.equal(r.objectClass, objectClass); assert.equal(r.ownerUserId, 11); assert.ok(r.cost.d1Statements > r.cost.d1Batches);
    assert.equal(r.quota.passed, 'staff'); stored.push(r);
    const verified = await verifyBlob(w.env, SCOPE, r.digest, PNG.length, undefined, objectClass); assert.ok(verified.ok);
  }
  assert.equal(new Set(stored.map((r) => r.key)).size, 4); assert.equal(w.r2.ops.put, 4);
  const again = await storeMediaUpload(w.env, CTX, input(id)); assert.ok(again.ok && again.reused); assert.equal(w.r2.ops.put, 4);
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_blobs'), 4);
  const master = stored[0];
  const revision = await blobRev(w, id, 'classed', master.digest, master.size, { source: master.source });
  const approved = await advance(w, id, null, revision, 'classed', { actor: ALICE, approval: { ref: 'synthetic-review', contentDigest: master.digest, reviewer: ALICE, decidedAt: new Date(clock.t).toISOString() } });
  assert.ok(approved.ok, JSON.stringify(approved));
  const read = await readRevisionBytes(w.env, CTX, { revisionUid: revision, actor: ALICE }); assert.ok(read.ok); assert.deepEqual(read.bytes, PNG);
  const thumbnailRevision = await blobRev(w, id, 'thumbnail-not-master', stored[3].digest, stored[3].size, { parents: [revision], source: stored[3].source });
  const wrongHead = await advance(w, id, revision, thumbnailRevision, 'thumbnail-not-source', { actor: ALICE, approval: { ref: 'synthetic-thumbnail-review', contentDigest: stored[3].digest, reviewer: ALICE, decidedAt: new Date(clock.t).toISOString() } });
  assert.ok(!wrongHead.ok && wrongHead.code === 'authority_violation', 'a thumbnail cannot replace an accepted master');
  const otherOwner = await putVerified(w.env, CTX, { scope: SCOPE, bytes: PNG, accessClass: 'confidential', actor: ALICE, objectClass: 'master', storageOwnerUserId: 12, storageProjectId: 700 });
  assert.ok(otherOwner.ok && otherOwner.reused, 'owner changes do not rewrite or duplicate a company object; quota reads follow the current owner');
  w.db.exec('INSERT INTO projects VALUES (701,70,101)');
  const otherProject = await asset(w, 'other-project', { scope: { ...SCOPE, projectId: 701 } });
  const separate = await storeMediaUpload(w.env, CTX, input(otherProject)); assert.ok(separate.ok);
  assert.match(separate.key, /media\/p701\/master/); assert.notEqual(separate.key, master.key);
  const foreignProjectRevision = await blobRev(w, otherProject, 'project-701', separate.digest, separate.size, { source: separate.source }, { ...SCOPE, projectId: 701 });
  const projectRead = await readRevisionBytes(w.env, { scope: SCOPE }, { revisionUid: foreignProjectRevision, actor: ALICE });
  assert.ok(!projectRead.ok && projectRead.code === 'wrong_tenant');
  w.db.close();
});

test('reconciliation deletes an orphan class without deleting or uncharging the live same-digest master', async () => {
  const w = world(); ownerFixture(w); const id = await asset(w, 'retain');
  const master = await storeMediaUpload(w.env, CTX, input(id)); assert.ok(master.ok);
  const rendition = await storeMediaUpload(w.env, CTX, input(id, { objectClass: 'rendition' })); assert.ok(rendition.ok);
  await blobRev(w, id, 'retain-master', master.digest, master.size, { source: master.source });
  const result = await reconcileWorkGraph(w.env, CTX, { scope: SCOPE, graceMs: 0, retentionMs: DAY });
  assert.ok(result.ok); assert.equal(result.report.missingBytes.length, 0);
  assert.ok(w.r2.objects.has(master.key)); assert.ok(!w.r2.objects.has(rendition.key));
  const ledger = rows(w, 'SELECT object_class, deleted_at FROM work_graph_blobs ORDER BY object_class');
  assert.equal(ledger[0].object_class, 'master'); assert.equal(ledger[0].deleted_at, null);
  assert.equal(ledger[1].object_class, 'rendition'); assert.notEqual(ledger[1].deleted_at, null);
  w.db.close();
});

test('store audits scope refusal and preserves the existing unowned-file guard policy', async () => {
  const w = world(); ownerFixture(w); const id = await asset(w, 'refuse');
  const foreign = await storeMediaUpload(w.env, OTHER_CTX, input(id)); assert.ok(!foreign.ok && foreign.code === 'wrong_tenant');
  w.db.exec('DELETE FROM user_company_links');
  w.db.exec('UPDATE projects SET founder_id = NULL');
  const unknown = await storeMediaUpload(w.env, CTX, input(id, { by: { kind: 'person', userId: 12 } })); assert.ok(unknown.ok, JSON.stringify(unknown));
  assert.equal(unknown.ownerUserId, null); assert.equal(unknown.quota.passed, 'no_owner');
  assert.equal(w.r2.ops.put, 1);
  assert.deepEqual(rows(w, "SELECT refusal_code FROM work_graph_integrity_events WHERE action = 'blob_refused' ORDER BY id").map((x) => x.refusal_code), ['wrong_tenant']);
  w.db.close();
});
