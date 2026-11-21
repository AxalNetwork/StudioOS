/**
 * D5583 part 1 (#5583) — variants, a person's selection and an approved brand pack on #5581's revision store, over
 * the baseline plus every migration (`_schema_once.mjs`).
 *
 *   1. Acceptance 1: two agents generate 20 brand visuals across four image assets as separate, traceable sibling
 *      revisions of each master. A person selects one per asset, and an approved brand pack pins the four heads. No
 *      master or unchosen variant is overwritten or lost.
 *   2. Acceptance 1 (3D): a native scene pins its textures by revision; its bytes, the textures' and the preview's
 *      are each verified against their recorded digests (D5579 `verifyVersionBytes`).
 *   3. Acceptance 2:
 *      - a revoked licence, an out-of-scope use and missing consent are refused at selection;
 *      - a font binary is refused as a dependency;
 *      - a stale texture pin is refused when the variant is recorded;
 *      - another tenant's asset is not found;
 *      - an agent cannot select or compose.
 *   4. A pack refuses a member with no head, a non-composite pack, an empty or duplicate list; a retry writes nothing.
 *
 * Every studio, person, model and image is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_variants_5583.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { WORK_GRAPH_DEPS } from '../src/services/workGraphRevisions.ts';
import { sha256Hex, verifyVersionBytes, type Actor, type ArtifactVersion, type Scope, type ValidationContext } from '../src/services/workGraphContracts.ts';
import type { MediaProvenance } from '../src/services/workGraphMedia.ts';
import {
  MEDIA_POLICY, composeBrandPack, recordMaster, recordVariant, registerMediaAsset, selectVariant,
} from '../src/services/workGraphVariants.ts';

const NOW = new Date('2026-11-14T12:00:00Z');
WORK_GRAPH_DEPS.now = () => NOW;
let n = 0;
WORK_GRAPH_DEPS.newId = () => `id${++n}`;

const SCOPE: Scope = { tenantId: 6, companyId: 60, projectId: 600 };
const CTX: ValidationContext = { scope: SCOPE };
const DESIGNER: Actor = { kind: 'person', userId: 31 };
const agentA: Actor = { kind: 'agent', agentRunId: 'run_visuals_a', onBehalfOfUserId: 31, chargeId: 'chg_a' };
const agentB: Actor = { kind: 'agent', agentRunId: 'run_visuals_b', onBehalfOfUserId: 31, chargeId: 'chg_b' };

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return { db, env: { DB: d1Over(db) } as any };
}
type W = ReturnType<typeof world>;
const head = (w: W, uid: string) => (w.db.prepare('SELECT head_revision_uid AS h FROM work_graph_assets WHERE asset_uid = ?').get(uid) as any).h;
const revisions = (w: W, uid: string) => w.db.prepare('SELECT revision_uid, parent_uids_json, digest, recipe, actor_kind, agent_run_id FROM work_graph_revisions WHERE asset_uid = ? ORDER BY seq').all(uid) as any[];

const owned: MediaProvenance = { origin: 'upload', rights: { basis: 'owned', usageScope: ['deck', 'site'] } };
const generated = (run: string, seed: string): MediaProvenance => ({
  origin: 'generated', rights: { basis: 'platform_generated', usageScope: ['deck', 'site'] },
  generation: { provider: 'axal_ai_router', model: 'img-model', recipe: `visual for ${run}`, seed, reproducible: false, reproducibilityVerifiedAt: null },
});
const blob = (key: string, digest: string) => ({ store: 'r2_object' as const, locator: 'FILES', id: key, revision: digest });
const hex = (i: number) => i.toString(16).padStart(64, '0');

async function imageAsset(w: W, key: string, masterDigest: string) {
  const reg: any = await registerMediaAsset(w.env, CTX, { scope: SCOPE, kind: 'image', accessClass: 'confidential', actor: DESIGNER, idempotencyKey: `a-${key}` });
  assert.equal(reg.ok, true, JSON.stringify(reg));
  const m: any = await recordMaster(w.env, CTX, {
    assetUid: reg.assetUid, expectedRevisionUid: null, digest: masterDigest, byteLength: 1024, mediaProfile: 'image/png', source: blob(`master/${key}.png`, masterDigest),
    provenance: owned, use: 'deck', by: DESIGNER, idempotencyKey: `m-${key}`,
  });
  assert.equal(m.ok, true, JSON.stringify(m));
  return { assetUid: reg.assetUid as string, masterUid: m.revisionUid as string };
}

test('1. twenty visuals from two agents become traceable variants; a person selects; the pack pins the heads', async () => {
  const w = world();
  assert.equal(MEDIA_POLICY, 'human_publication');
  const assets = [];
  for (let i = 0; i < 4; i += 1) assets.push(await imageAsset(w, `img${i}`, hex(1000 + i)));

  // Two agents, ten visuals each: five per asset, alternating agents.
  let d = 0;
  const variants: Record<string, { uid: string; digest: string; run: string }[]> = {};
  for (const a of assets) {
    variants[a.assetUid] = [];
    for (let k = 0; k < 5; k += 1) {
      const agent = (d % 2 === 0) ? agentA : agentB;
      const run = (agent as any).agentRunId;
      const digest = hex(++d);
      const r: any = await recordVariant(w.env, CTX, {
        assetUid: a.assetUid, parentRevisionUid: a.masterUid, digest, byteLength: 2048, mediaProfile: 'image/webp',
        source: blob(`variant/${digest}.webp`, digest), provenance: generated(run, String(d)), use: 'deck', author: agent, idempotencyKey: `v-${digest}`,
      });
      assert.equal(r.ok, true, JSON.stringify(r));
      variants[a.assetUid].push({ uid: r.revisionUid, digest, run });
    }
    assert.equal(head(w, a.assetUid), a.masterUid, 'recording variants never moves the head');
  }
  assert.equal(d, 20);
  // Each variant is a sibling of its master and names the agent run that made it.
  const all = assets.flatMap((a) => revisions(w, a.assetUid).filter((r) => r.actor_kind === 'agent'));
  assert.equal(all.length, 20);
  for (const r of all) {
    assert.ok(JSON.parse(r.parent_uids_json).length === 1);
    const recipe = JSON.parse(r.recipe);
    assert.equal(recipe.generation.model, 'img-model');
    assert.equal(recipe.generation.recipe_recorded, true);
    assert.ok(!String(r.recipe).includes('visual for'), 'the prompt stays in its domain row, not in the recipe');
  }
  assert.deepEqual(new Set(all.map((r) => r.agent_run_id)), new Set(['run_visuals_a', 'run_visuals_b']));

  // An agent cannot select.
  const first = assets[0];
  const pick0 = variants[first.assetUid][2];
  assert.equal(((await selectVariant(w.env, CTX, {
    assetUid: first.assetUid, expectedRevisionUid: first.masterUid, variantRevisionUid: pick0.uid, digest: pick0.digest,
    provenance: generated(pick0.run, '3'), use: 'deck', by: agentA, approvalRef: 'x', idempotencyKey: 's-agent',
  })) as any).code, 'person_required');

  // The designer selects one variant per asset.
  for (const a of assets) {
    const pick = variants[a.assetUid][1];
    const s: any = await selectVariant(w.env, CTX, {
      assetUid: a.assetUid, expectedRevisionUid: a.masterUid, variantRevisionUid: pick.uid, digest: pick.digest,
      provenance: generated(pick.run, '2'), use: 'deck', by: DESIGNER, approvalRef: `pick:${a.assetUid}`, idempotencyKey: `s-${a.assetUid}`,
    });
    assert.equal(s.ok, true, JSON.stringify(s));
    assert.equal(head(w, a.assetUid), pick.uid);
  }

  // The pack pins the four heads; nothing it points at is overwritten.
  const pack: any = await registerMediaAsset(w.env, CTX, { scope: SCOPE, kind: 'composite', accessClass: 'confidential', actor: DESIGNER, idempotencyKey: 'pack' });
  const before = assets.map((a) => JSON.stringify(revisions(w, a.assetUid)));
  const composed: any = await composeBrandPack(w.env, CTX, { packAssetUid: pack.assetUid, expectedRevisionUid: null, members: assets.map((a) => a.assetUid), by: DESIGNER, approvalRef: 'pack:approve', idempotencyKey: 'p1' });
  assert.equal(composed.ok, true, JSON.stringify(composed));
  const edges = w.db.prepare("SELECT to_asset_uid, to_revision_uid FROM work_graph_edges WHERE edge_kind = 'component' ORDER BY to_asset_uid").all() as any[];
  assert.deepEqual(edges.map((e) => [e.to_asset_uid, e.to_revision_uid]).sort(), assets.map((a) => [a.assetUid, variants[a.assetUid][1].uid]).sort());
  assert.deepEqual(assets.map((a) => JSON.stringify(revisions(w, a.assetUid))), before, 'masters and every variant are unchanged');
  for (const a of assets) assert.ok(revisions(w, a.assetUid).some((r) => r.revision_uid === a.masterUid), 'the master is kept');

  // A retry writes nothing new.
  const again: any = await composeBrandPack(w.env, CTX, { packAssetUid: pack.assetUid, expectedRevisionUid: null, members: assets.map((a) => a.assetUid), by: DESIGNER, approvalRef: 'pack:approve', idempotencyKey: 'p1' });
  assert.equal(again.ok, true);
  assert.equal(revisions(w, pack.assetUid).length, 1);

  // An agent cannot compose a pack.
  assert.equal(((await composeBrandPack(w.env, CTX, { packAssetUid: pack.assetUid, expectedRevisionUid: composed.revisionUid, members: [assets[0].assetUid], by: agentB, approvalRef: 'x', idempotencyKey: 'p2' })) as any).code, 'person_required');
});

test('2. a 3D scene pins its textures; scene, textures and preview are hash-verifiable', async () => {
  const w = world();
  const bytes = { scene: new TextEncoder().encode('glTF-scene-bytes'), texA: new TextEncoder().encode('texture-a'), texB: new TextEncoder().encode('texture-b'), preview: new TextEncoder().encode('preview-webp') };
  const digests = Object.fromEntries(await Promise.all(Object.entries(bytes).map(async ([k, b]) => [k, await sha256Hex(b)]))) as Record<keyof typeof bytes, string>;
  const tex: Record<string, { assetUid: string; masterUid: string }> = {};
  for (const k of ['texA', 'texB'] as const) {
    const reg: any = await registerMediaAsset(w.env, CTX, { scope: SCOPE, kind: 'image', accessClass: 'internal', actor: DESIGNER, idempotencyKey: `t-${k}` });
    const m: any = await recordMaster(w.env, CTX, { assetUid: reg.assetUid, expectedRevisionUid: null, digest: digests[k], byteLength: bytes[k].byteLength, mediaProfile: 'image/png', source: blob(`master/${k}.png`, digests[k]), provenance: owned, use: 'deck', by: DESIGNER, idempotencyKey: `tm-${k}` });
    assert.equal(m.ok, true, JSON.stringify(m));
    tex[k] = { assetUid: reg.assetUid, masterUid: m.revisionUid };
  }
  const scene: any = await registerMediaAsset(w.env, CTX, { scope: SCOPE, kind: 'model_3d', accessClass: 'internal', actor: DESIGNER, idempotencyKey: 'scene' });
  const m: any = await recordMaster(w.env, CTX, {
    assetUid: scene.assetUid, expectedRevisionUid: null, digest: digests.scene, byteLength: bytes.scene.byteLength, mediaProfile: 'model/gltf-binary',
    source: blob('master/scene.glb', digests.scene), provenance: owned, use: 'deck', by: DESIGNER, idempotencyKey: 'sm',
    dependencies: [
      { kind: 'texture', assetUid: tex.texA.assetUid, revisionUid: tex.texA.masterUid },
      { kind: 'texture', assetUid: tex.texB.assetUid, revisionUid: tex.texB.masterUid },
      { kind: 'font', family: 'Space Grotesk', license: 'OFL-1.1' },
    ],
  });
  assert.equal(m.ok, true, JSON.stringify(m));
  const pins = w.db.prepare("SELECT to_asset_uid, to_revision_uid FROM work_graph_edges WHERE from_revision_uid = ? AND edge_kind = 'read'").all(m.revisionUid) as any[];
  assert.equal(pins.length, 2);
  assert.deepEqual(JSON.parse(revisions(w, scene.assetUid)[0].recipe).fonts, [{ family: 'Space Grotesk', license: 'OFL-1.1', foundry: null }]);

  // Every recorded object is verifiable against its bytes, and a swapped object is not.
  for (const k of Object.keys(bytes) as (keyof typeof bytes)[]) {
    const v = { id: k, digest: digests[k], byteLength: bytes[k].byteLength } as ArtifactVersion;
    assert.equal(await verifyVersionBytes(v, bytes[k]), null, k);
  }
  assert.equal((await verifyVersionBytes({ id: 'scene', digest: digests.scene, byteLength: bytes.texA.byteLength } as ArtifactVersion, bytes.texA))?.code, 'digest_mismatch');

  // A variant of the scene pinned to a texture revision that is no longer that texture's head is refused.
  const texV: any = await recordVariant(w.env, CTX, { assetUid: tex.texA.assetUid, parentRevisionUid: tex.texA.masterUid, digest: hex(77), byteLength: 9, mediaProfile: 'image/png', source: blob('v/texA2.png', hex(77)), provenance: owned, use: 'deck', author: DESIGNER, idempotencyKey: 'tv' });
  const sel: any = await selectVariant(w.env, CTX, { assetUid: tex.texA.assetUid, expectedRevisionUid: tex.texA.masterUid, variantRevisionUid: texV.revisionUid, digest: hex(77), provenance: owned, use: 'deck', by: DESIGNER, approvalRef: 'tex', idempotencyKey: 'ts' });
  assert.equal(sel.ok, true, JSON.stringify(sel));
  const sceneV: any = await recordVariant(w.env, CTX, {
    assetUid: scene.assetUid, parentRevisionUid: m.revisionUid, digest: hex(78), byteLength: 9, mediaProfile: 'model/gltf-binary', source: blob('v/scene2.glb', hex(78)),
    provenance: owned, use: 'deck', author: agentA, idempotencyKey: 'sv',
    dependencies: [{ kind: 'texture', assetUid: tex.texA.assetUid, revisionUid: tex.texA.masterUid }],
  });
  // #5581 refuses a pin that is no longer its asset's head when the revision is recorded: nothing is written.
  assert.deepEqual([sceneV.ok, sceneV.code], [false, 'stale_dependency']);
  assert.equal(head(w, scene.assetUid), m.revisionUid, 'the scene head stays on the consistent version');
});

test('3. revoked licence, wrong use, missing consent, font binary, wrong tenant and an oversized recipe fail closed', async () => {
  const w = world();
  const a = await imageAsset(w, 'x', hex(500));
  const v = async (provenance: MediaProvenance, key: string, deps: any[] = []) => recordVariant(w.env, CTX, {
    assetUid: a.assetUid, parentRevisionUid: a.masterUid, digest: hex(600 + key.length), byteLength: 10, mediaProfile: 'image/png',
    source: blob(`v/${key}.png`, hex(600 + key.length)), provenance, use: 'deck', author: agentA, idempotencyKey: key, dependencies: deps,
  }) as any;
  const licensed: MediaProvenance = { origin: 'upload', rights: { basis: 'licensed', licensor: 'Stock Co', licenseRef: 'LIC-9', usageScope: ['deck'] } };

  // Recorded as a draft, then the licence is revoked: the selection is refused and the head stays.
  const ok = await v(licensed, 'lic');
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const revoked = { ...licensed, rights: { ...licensed.rights, revokedAt: '2026-11-13T00:00:00Z' } };
  const r1: any = await selectVariant(w.env, CTX, { assetUid: a.assetUid, expectedRevisionUid: a.masterUid, variantRevisionUid: ok.revisionUid, digest: hex(603), provenance: revoked, use: 'deck', by: DESIGNER, approvalRef: 'x', idempotencyKey: 's1' });
  assert.deepEqual([r1.code, r1.provenance], ['provenance', ['license_revoked']]);
  const r2: any = await selectVariant(w.env, CTX, { assetUid: a.assetUid, expectedRevisionUid: a.masterUid, variantRevisionUid: ok.revisionUid, digest: hex(603), provenance: licensed, use: 'site', by: DESIGNER, approvalRef: 'x', idempotencyKey: 's2' });
  assert.deepEqual(r2.provenance, ['usage_out_of_scope']);
  const person = { ...licensed, consent: { showsPerson: true, consentAt: null, consentByUserId: null } };
  const r3: any = await selectVariant(w.env, CTX, { assetUid: a.assetUid, expectedRevisionUid: a.masterUid, variantRevisionUid: ok.revisionUid, digest: hex(603), provenance: person, use: 'deck', by: DESIGNER, approvalRef: 'x', idempotencyKey: 's3' });
  assert.deepEqual(r3.provenance, ['consent_missing']);
  assert.equal(head(w, a.assetUid), a.masterUid);

  // A revoked licence is refused already at the draft.
  assert.deepEqual(((await v(revoked, 'rev')) as any).provenance, ['license_revoked']);
  // A font binary is never a dependency.
  assert.equal(((await v(owned, 'font', [{ kind: 'font', family: 'X', license: 'OFL-1.1', assetUid: 'bytes' }])) as any).code, 'font_binary');
  // A variant on something that is no longer the head is refused.
  const stale: any = await recordVariant(w.env, CTX, { assetUid: a.assetUid, parentRevisionUid: 'wgr_old', digest: hex(700), byteLength: 1, mediaProfile: 'image/png', source: blob('v/old.png', hex(700)), provenance: owned, use: 'deck', author: agentA, idempotencyKey: 'old' });
  assert.equal(stale.code, 'not_a_head');
  // Another tenant's caller does not see the asset.
  const other: ValidationContext = { scope: { ...SCOPE, tenantId: 7 } };
  assert.equal(((await recordVariant(w.env, other, { assetUid: a.assetUid, parentRevisionUid: a.masterUid, digest: hex(701), byteLength: 1, mediaProfile: 'image/png', source: blob('v/t.png', hex(701)), provenance: owned, use: 'deck', author: agentA, idempotencyKey: 'tenant' })) as any).code, 'not_found');
  // A provenance too large for the revision's recipe column is refused before the insert.
  const huge: MediaProvenance = { origin: 'upload', rights: { basis: 'owned', usageScope: ['deck'], attribution: 'x'.repeat(2100) } };
  assert.deepEqual(((await v(huge, 'huge')) as any).ids, [a.assetUid, 'recipe']);
  // Masters are a person's.
  const reg: any = await registerMediaAsset(w.env, CTX, { scope: SCOPE, kind: 'image', accessClass: 'internal', actor: DESIGNER, idempotencyKey: 'agent-master' });
  assert.equal(((await recordMaster(w.env, CTX, { assetUid: reg.assetUid, expectedRevisionUid: null, digest: hex(800), byteLength: 1, mediaProfile: 'image/png', source: blob('m.png', hex(800)), provenance: owned, use: 'deck', by: agentA, idempotencyKey: 'am' })) as any).code, 'person_required');
  // Only media kinds and composites are registered here.
  assert.equal(((await registerMediaAsset(w.env, CTX, { scope: SCOPE, kind: 'pitch_deck' as any, accessClass: 'internal', actor: DESIGNER, idempotencyKey: 'deck' })) as any).code, 'kind_mismatch');
});

test('4. a pack refuses a member with no head, a non-composite pack, and an empty or repeated list', async () => {
  const w = world();
  const a = await imageAsset(w, 'p', hex(900));
  const headless: any = await registerMediaAsset(w.env, CTX, { scope: SCOPE, kind: 'image', accessClass: 'internal', actor: DESIGNER, idempotencyKey: 'h' });
  const pack: any = await registerMediaAsset(w.env, CTX, { scope: SCOPE, kind: 'composite', accessClass: 'internal', actor: DESIGNER, idempotencyKey: 'pk' });
  const compose = (members: string[], packUid = pack.assetUid, key = 'c') => composeBrandPack(w.env, CTX, { packAssetUid: packUid, expectedRevisionUid: null, members, by: DESIGNER, approvalRef: 'x', idempotencyKey: key }) as Promise<any>;
  assert.equal((await compose([a.assetUid, headless.assetUid])).code, 'not_a_head');
  assert.equal((await compose([a.assetUid], a.assetUid)).code, 'kind_mismatch');
  assert.equal((await compose([])).code, 'empty_pack');
  assert.equal((await compose([a.assetUid, a.assetUid])).code, 'malformed');
  assert.equal(head(w, pack.assetUid), null);
  const ok = await compose([a.assetUid], pack.assetUid, 'good');
  assert.equal(ok.ok, true, JSON.stringify(ok));
});
