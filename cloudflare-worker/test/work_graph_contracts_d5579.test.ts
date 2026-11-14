/**
 * D5579 (#5579, WorkGraph P0) — the contract validator refuses every graph #5579's acceptance names, and admits a
 * clean one:
 *
 *   1. A clean graph (asset, two versions, a ChangeSet on the head, a person's approval of its exact bytes, a
 *      release pinning the approved version) has no violation.
 *   2. Stale revision: a ChangeSet whose base is not the current head.
 *   3. Cyclic dependency: WorkItems depending on each other; a version that is its own ancestor.
 *   4. Revoked author: a revoked person, a revoked agent run, an agent acting for a revoked person.
 *   5. Wrong tenant: a record of another tenant or company; a project caller reading another project.
 *   6. Duplicate ids.
 *   7. Content digest mismatch: bytes that are not the declared digest, or are truncated.
 *   8. Changed external source revision.
 *   9. Authority: a legal template sourced from R2, code sourced from anything but Git, a malformed Git SHA.
 *  10. Immutable records: no ChangeSet against signed legal evidence or a released asset.
 *  11. Approval: an agent cannot approve; an approval of other bytes is stale; a release of unapproved or
 *      mis-pinned bytes is refused.
 *
 * Pure: no database. Every id and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_contracts_d5579.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTHORITY, WORKGRAPH_CONTRACT_VERSION, sha256Hex, sourceKey, validateWorkGraph, verifyVersionBytes,
  type Actor, type ArtifactVersion, type Scope, type ValidationContext, type WorkGraph,
} from '../src/services/workGraphContracts.ts';

const SCOPE: Scope = { tenantId: 7, companyId: 70, projectId: 700 };
const COMPANY: Scope = { tenantId: 7, companyId: 70, projectId: null };
const ALICE: Actor = { kind: 'person', userId: 11 };
const BOB: Actor = { kind: 'person', userId: 12 };
const WRITER: Actor = { kind: 'agent', agentRunId: 'run_writer', onBehalfOfUserId: 11, chargeId: 'chg_1' };
const D = (ch: string) => ch.repeat(64);
const CTX: ValidationContext = { scope: SCOPE };

function version(id: string, over: Partial<ArtifactVersion> = {}): ArtifactVersion {
  return {
    id, assetId: 'deck', scope: SCOPE, parents: [], digest: D('a'), byteLength: 3, mediaProfile: 'application/json',
    source: { store: 'd1_record', locator: 'pitch_decks', id: '41', revision: '1' }, recipe: null, residency: null,
    license: null, author: WRITER, createdAt: '2026-11-13T10:00:00Z', expiresAt: null, ...over,
  };
}

/** A clean graph: deck v1 -> v2 (head); ChangeSet on v2 proposing digest c; Bob approves c; release pins v2 (b). */
function clean(): WorkGraph {
  return {
    workItems: [{
      id: 'wi1', scope: SCOPE, deliverableAssetId: 'deck', modifies: [{ assetId: 'deck', versionId: 'v2', unit: { kind: 'slide', id: 's3' } }],
      baseVersionId: 'v2', dependsOn: [], author: WRITER, priority: 1, risk: 'medium', idempotencyKey: 'k-wi1',
    }],
    assets: [{ id: 'deck', scope: SCOPE, kind: 'pitch_deck', headVersionId: 'v2', accessClass: 'confidential', approvalPolicy: 'human_publication' }],
    versions: [version('v1'), version('v2', { parents: ['v1'], digest: D('b'), source: { store: 'd1_record', locator: 'pitch_decks', id: '41', revision: '2' } })],
    changeSets: [{
      id: 'cs1', scope: SCOPE, workItemId: 'wi1', assetId: 'deck', baseVersionId: 'v2', proposedDigest: D('c'),
      components: [{ assetId: 'deck', versionId: 'v2', unit: { kind: 'slide', id: 's3' } }], author: WRITER, idempotencyKey: 'k-cs1',
    }, {
      id: 'cs0', scope: SCOPE, workItemId: 'wi1', assetId: 'deck', baseVersionId: 'v2', proposedDigest: D('b'),
      components: [], author: WRITER, idempotencyKey: 'k-cs0',
    }],
    reviews: [
      { id: 'r1', scope: SCOPE, changeSetId: 'cs1', contentDigest: D('c'), decision: 'approve', reviewer: BOB, approvalRef: 'apr_1', decidedAt: '2026-11-13T11:00:00Z' },
      { id: 'r0', scope: SCOPE, changeSetId: 'cs0', contentDigest: D('b'), decision: 'approve', reviewer: BOB, approvalRef: 'apr_0', decidedAt: '2026-11-13T09:00:00Z' },
    ],
    releases: [{ id: 'rel1', scope: SCOPE, components: [{ assetId: 'deck', versionId: 'v2', digest: D('b') }], approvalIds: ['r0'], expectedPreviousId: null, idempotencyKey: 'k-rel1' }],
  };
}

const codes = (g: WorkGraph, ctx: ValidationContext = CTX) => validateWorkGraph(g, ctx).map((v) => v.code).sort();

test('the contract version is 1 and every asset kind has a canonical store', () => {
  assert.equal(WORKGRAPH_CONTRACT_VERSION, 1);
  for (const [kind, stores] of Object.entries(AUTHORITY)) assert.ok(stores.length > 0, kind);
  // R2 is never the editor of a structured legal or offer record, and D1 never holds code.
  assert.ok(!AUTHORITY.legal_template.includes('r2_object'));
  assert.ok(!AUTHORITY.offer.includes('r2_object'));
  assert.deepEqual([...AUTHORITY.code], ['git']);
  assert.deepEqual([...AUTHORITY.legal_signed], ['esign_envelope']);
});

test('1. a clean graph has no violation', () => {
  assert.deepEqual(validateWorkGraph(clean(), CTX), []);
  // A company-wide caller sees the project's records too.
  assert.deepEqual(validateWorkGraph(clean(), { scope: COMPANY }), []);
});

test('2. stale revision: a ChangeSet on an old base is refused, naming base and head', () => {
  const g = clean();
  g.changeSets![0].baseVersionId = 'v1';
  const v = validateWorkGraph(g, CTX);
  assert.deepEqual(v, [{ code: 'stale_revision', record: 'ChangeSet', ids: ['cs1', 'v1', 'v2'] }]);
  // A first ChangeSet on an asset that already has a head is stale too.
  g.changeSets![0].baseVersionId = null;
  assert.deepEqual(codes(g), ['stale_revision']);
});

test('3. cyclic dependency: work items, and a version that is its own ancestor', () => {
  const g = clean();
  g.workItems!.push({ ...g.workItems![0], id: 'wi2', dependsOn: ['wi1'], idempotencyKey: 'k-wi2' });
  g.workItems![0].dependsOn = ['wi2'];
  const v = validateWorkGraph(g, CTX).filter((x) => x.code === 'cyclic_dependency');
  assert.equal(v.length, 1);
  assert.equal(v[0].record, 'WorkItem');
  assert.ok(v[0].ids.includes('wi1') && v[0].ids.includes('wi2'));

  const h = clean();
  h.versions![0].parents = ['v2'];
  assert.deepEqual(codes(h), ['cyclic_dependency']);
});

test('4. revoked author: person, agent run, and an agent acting for a revoked person', () => {
  assert.ok(codes(clean(), { scope: SCOPE, revokedAgentRunIds: new Set(['run_writer']) }).includes('revoked_author'));
  assert.ok(codes(clean(), { scope: SCOPE, revokedUserIds: new Set([11]) }).includes('revoked_author'), 'agent for a revoked person');
  const byBob = codes(clean(), { scope: SCOPE, revokedUserIds: new Set([12]) });
  assert.ok(byBob.includes('revoked_author'), 'revoked reviewer');
  // A revoked reviewer's approval no longer counts toward a release.
  assert.ok(byBob.includes('unapproved_release'));
});

test('5. wrong tenant: another tenant, another company, another project', () => {
  for (const scope of [{ ...SCOPE, tenantId: 8 }, { ...SCOPE, companyId: 71 }, { ...SCOPE, projectId: 701 }]) {
    const g = clean();
    g.changeSets![0].scope = scope;
    assert.deepEqual(validateWorkGraph(g, CTX), [{ code: 'wrong_tenant', record: 'ChangeSet', ids: ['cs1'] }]);
  }
  // A version filed under another company than its asset is refused even if the caller could see both.
  const g = clean();
  g.assets![0].scope = COMPANY;
  g.versions![1].scope = { tenantId: 7, companyId: 71, projectId: 700 };
  assert.deepEqual(
    validateWorkGraph(g, CTX).filter((x) => x.record === 'ArtifactVersion' && x.ids[0] === 'v2'),
    [{ code: 'wrong_tenant', record: 'ArtifactVersion', ids: ['v2'] }, { code: 'wrong_tenant', record: 'ArtifactVersion', ids: ['v2', 'deck'] }],
  );
});

test('6. duplicate ids are refused per record type', () => {
  const g = clean();
  g.versions!.push(version('v1'));
  assert.deepEqual(validateWorkGraph(g, CTX), [{ code: 'duplicate_id', record: 'ArtifactVersion', ids: ['v1'] }]);
});

test('7. content digest mismatch: other bytes, truncated bytes', async () => {
  const bytes = new TextEncoder().encode('{"slides":[1,2,3]}');
  const v = version('v9', { digest: await sha256Hex(bytes), byteLength: bytes.byteLength });
  assert.equal(await verifyVersionBytes(v, bytes), null);
  const swapped = await verifyVersionBytes(v, new TextEncoder().encode('{"slides":[1,2,4]}'));
  assert.equal(swapped?.code, 'digest_mismatch');
  const partial = await verifyVersionBytes(v, bytes.slice(0, 5));
  assert.equal(partial?.code, 'digest_mismatch');
  // The right digest with a wrong declared length is refused too: a version's length is part of its contract.
  const wrongLength = await verifyVersionBytes({ ...v, byteLength: v.byteLength + 1 }, bytes);
  assert.equal(wrongLength?.code, 'digest_mismatch');
  // The known SHA-256 of the empty string, so the helper is the real digest.
  assert.equal(await sha256Hex(new Uint8Array()), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('8. changed external source revision', () => {
  const g = clean();
  const src = { store: 'external_editor' as const, locator: 'figma', id: 'file_1', revision: 'rev_3' };
  g.versions![1].source = src;
  assert.deepEqual(validateWorkGraph(g, { scope: SCOPE, externalHeads: new Map([[sourceKey(src), 'rev_3']]) }), []);
  assert.deepEqual(codes(g, { scope: SCOPE, externalHeads: new Map([[sourceKey(src), 'rev_4']]) }), ['external_source_changed']);
});

test('9. authority: the canonical store per kind', () => {
  const legal = clean();
  legal.assets![0].kind = 'legal_template';
  legal.versions![1].source = { store: 'r2_object', locator: 'FILES', id: 'tpl.pdf', revision: D('b') };
  assert.deepEqual(codes(legal), ['authority_violation']);

  const code = clean();
  code.assets![0].kind = 'code';
  assert.deepEqual(codes(code), ['authority_violation', 'authority_violation']);
  for (const v of code.versions!) v.source = { store: 'git', locator: 'acme/app', id: 'src/a.ts', revision: '0123456789abcdef0123456789abcdef01234567' };
  assert.deepEqual(codes(code), []);
  code.versions![0].source.revision = 'main';
  assert.deepEqual(codes(code), ['malformed']);
});

test('10. immutable records: signed legal evidence and released assets take no ChangeSet', () => {
  const signed = clean();
  signed.assets![0].kind = 'legal_signed';
  for (const v of signed.versions!) v.source = { store: 'esign_envelope', locator: 'esign', id: 'env_1', revision: v.digest };
  assert.ok(codes(signed).includes('immutable_record'));
  const released = clean();
  released.assets![0].released = true;
  assert.ok(codes(released).includes('immutable_record'));
});

test('11. approvals: a person approves exact bytes; a release pins approved bytes', () => {
  const agent = clean();
  agent.reviews![0].reviewer = WRITER;
  assert.deepEqual(codes(agent), ['agent_review']);

  const stale = clean();
  stale.reviews![0].contentDigest = D('d');
  assert.deepEqual(validateWorkGraph(stale, CTX), [{ code: 'stale_approval', record: 'ReviewDecision', ids: ['r1', 'cs1'] }]);

  const unapproved = clean();
  unapproved.reviews![1].decision = 'reject';
  assert.deepEqual(codes(unapproved), ['unapproved_release']);

  const misPinned = clean();
  misPinned.releases![0].components[0].digest = D('c');
  assert.deepEqual(codes(misPinned), ['unpinned_component']);
});

test('unknown references are named, never guessed', () => {
  const g = clean();
  g.changeSets![0].workItemId = 'wi404';
  g.releases![0].approvalIds = ['r404'];
  assert.deepEqual(validateWorkGraph(g, CTX), [
    { code: 'unknown_reference', record: 'ChangeSet', ids: ['cs1', 'wi404'] },
    { code: 'unknown_reference', record: 'ReleaseManifest', ids: ['rel1', 'r404'] },
  ]);
});
