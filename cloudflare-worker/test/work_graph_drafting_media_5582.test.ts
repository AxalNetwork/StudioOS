/** D5582 part 5: a frozen deck export pins the exact D5583 media revisions the deck embeds, on migrated D1 and a fake R2. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { grantWriteBar } from './_write_bar_session.mjs';
import { FakeR2 } from './_work_graph_world_5581.ts';
import registry from '../src/routes/admin_workgraph_drafting_assets.ts';
import { WORK_GRAPH_DEPS, impactOf, tombstoneRevision } from '../src/services/workGraphRevisions.ts';
import { WORK_GRAPH_BLOB_DEPS, putVerified, setRevisionOffline } from '../src/services/workGraphBlobs.ts';
import { registerReleaseLine, releaseStatus } from '../src/services/workGraphReleases.ts';
import { recordMaster, recordVariant, registerMediaAsset, selectVariant } from '../src/services/workGraphVariants.ts';
import { embeddedMediaRefs } from '../src/services/workGraphDraftingMedia.ts';
import type { MediaProvenance } from '../src/services/workGraphMedia.ts';

const SECRET = 'workgraph-drafting-media-fixture-secret-5582';
const SUPER = 920001, DESIGNER = 920002, COMPANY = 920010, FOREIGN = 920011, PROJECT = 920020, OTHER_PROJECT = 920021, FOREIGN_PROJECT = 920022;
const TENANT = 920100;
const DECK_ID = 920030;
const person = (userId: number) => ({ kind: 'person' as const, userId });
const agent = (run: string) => ({ kind: 'agent' as const, agentRunId: run, onBehalfOfUserId: DESIGNER, chargeId: `chg_${run}` });
const owned: MediaProvenance = { origin: 'upload', rights: { basis: 'owned', usageScope: ['deck'] } };
const generated = (run: string): MediaProvenance => ({ origin: 'generated', rights: { basis: 'platform_generated', usageScope: ['deck'] },
  generation: { provider: 'axal_ai_router', model: 'img-model', recipe: `visual ${run}`, seed: run, reproducible: false, reproducibilityVerifiedAt: null } });
const bytes = (label: string) => new TextEncoder().encode(`synthetic media bytes: ${label}`);
const ref = (m: { assetUid: string; revisionUid: string }) => ({ asset_uid: m.assetUid, revision_uid: m.revisionUid });

let tick = Date.parse('2026-11-27T12:00:00.000Z');
WORK_GRAPH_DEPS.now = () => new Date(tick += 1000);
WORK_GRAPH_BLOB_DEPS.now = () => new Date(tick);

async function world(t: any) {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  t.after(() => db.close());
  loadSchema(db);
  for (const [uid, name] of [[SUPER, 'Preview operator'], [DESIGNER, 'Designer']] as const) {
    db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)').run(uid, 'admin', name, `${uid}@example.test`);
  }
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const [cid, uid] of [[COMPANY, 'media-company'], [FOREIGN, 'media-foreign']] as const) {
    db.prepare('INSERT INTO company_profiles (id, uid, company_name) VALUES (?, ?, ?)').run(cid, uid, uid);
  }
  db.prepare('INSERT INTO user_company_links (uid, company_id, user_id) VALUES (?, ?, ?)').run('link-super', COMPANY, SUPER);
  db.prepare('INSERT INTO projects (id, name, company_id) VALUES (?, ?, ?)').run(PROJECT, 'Media project', COMPANY);
  db.prepare('INSERT INTO projects (id, name, company_id) VALUES (?, ?, ?)').run(OTHER_PROJECT, 'Sibling project', COMPANY);
  db.prepare('INSERT INTO projects (id, name, company_id) VALUES (?, ?, ?)').run(FOREIGN_PROJECT, 'Foreign project', FOREIGN);
  const r2 = new FakeR2();
  const env: any = { DB: d1Over(db), FILES: r2, JWT_SECRET: SECRET, ENVIRONMENT: 'preview', WORK_GRAPH_DRAFTING: 'preview', WORK_GRAPH_LEASES: 'off' };
  const bar = grantWriteBar(db, SUPER);
  const token = () => new SignJWT({ user_id: SUPER, role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
    .setJti(bar).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const app = new Hono<any>();
  app.route('/api/admin/workgraph/drafting-assets', registry);
  app.onError((err, c) => c.json({ detail: err.message }, 403));
  const call = async (path: string, body?: unknown) => {
    const response = await app.request(`/api/admin/workgraph/drafting-assets${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', 'X-Company-Id': String(COMPANY) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
    return { status: response.status, body: await response.json() as any };
  };
  const count = (sql: string, ...args: unknown[]) => Number((db.prepare(sql).get(...(args as any[])) as any)?.n);

  let version = 0;
  /** The founder saves a deck version through the deck's own table: the new row is current. */
  const saveDeck = (slides: unknown[]) => {
    version += 1;
    db.prepare('UPDATE pitch_decks SET is_current = 0 WHERE project_id = ?').run(PROJECT);
    db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (?, ?, ?, ?, ?, 1)')
      .run(DECK_ID + version - 1, PROJECT, version, JSON.stringify(slides), 'Media deck');
  };

  /** A D5583 image asset with a person's master, its bytes in the WorkGraph blob store at the typed key. */
  const image = async (key: string, o: { companyId?: number; projectId?: number | null; tenantId?: number } = {}) => {
    const scope = { tenantId: o.tenantId ?? TENANT, companyId: o.companyId ?? COMPANY, projectId: o.projectId === undefined ? PROJECT : o.projectId };
    const ctx = { scope: { ...scope, projectId: null } };
    const reg: any = await registerMediaAsset(env, ctx, { scope, kind: 'image', accessClass: 'confidential', actor: person(DESIGNER), idempotencyKey: `media-${key}` });
    assert.equal(reg.ok, true, JSON.stringify(reg));
    const put: any = await putVerified(env, ctx, { scope, bytes: bytes(key), objectClass: 'master', storageProjectId: scope.projectId, accessClass: 'confidential', actor: person(DESIGNER), assetUid: reg.assetUid });
    assert.equal(put.ok, true, JSON.stringify(put));
    const master: any = await recordMaster(env, ctx, { assetUid: reg.assetUid, expectedRevisionUid: null, digest: put.digest, byteLength: put.size,
      mediaProfile: 'image/png', source: put.source, provenance: owned, use: 'deck', by: person(DESIGNER), idempotencyKey: `master-${key}` });
    assert.equal(master.ok, true, JSON.stringify(master));
    return { assetUid: reg.assetUid as string, revisionUid: master.revisionUid as string, digest: put.digest as string, ctx, scope };
  };
  /** An agent's variant of an image: a sibling revision whose bytes are stored first. Its head does not move. */
  const variant = async (img: { assetUid: string; revisionUid: string; ctx: any; scope: any }, run: string) => {
    const put: any = await putVerified(env, img.ctx, { scope: img.scope, bytes: bytes(`${img.assetUid}:${run}`), objectClass: 'master', storageProjectId: img.scope.projectId,
      accessClass: 'confidential', actor: agent(run), assetUid: img.assetUid });
    assert.equal(put.ok, true, JSON.stringify(put));
    const v: any = await recordVariant(env, img.ctx, { assetUid: img.assetUid, parentRevisionUid: img.revisionUid, digest: put.digest,
      byteLength: put.size, mediaProfile: 'image/png', source: put.source, provenance: generated(run), use: 'deck', author: agent(run),
      idempotencyKey: `variant-${img.assetUid}-${run}` });
    assert.equal(v.ok, true, JSON.stringify(v));
    return { revisionUid: v.revisionUid as string, digest: put.digest as string, run };
  };
  /** A person picks a variant: it becomes the media asset's head (a media edit). */
  const select = async (img: { assetUid: string; ctx: any }, from: string, pick: { revisionUid: string; digest: string; run: string }) => {
    const s: any = await selectVariant(env, img.ctx, { assetUid: img.assetUid, expectedRevisionUid: from, variantRevisionUid: pick.revisionUid,
      digest: pick.digest, provenance: generated(pick.run), use: 'deck', by: person(DESIGNER), approvalRef: `pick:${pick.revisionUid}`,
      idempotencyKey: `select-${pick.revisionUid}` });
    assert.equal(s.ok, true, JSON.stringify(s));
    return s;
  };
  const line = async (key = 'line') => {
    const scope = { tenantId: TENANT, companyId: COMPANY, projectId: null };
    const l: any = await registerReleaseLine(env, { scope }, { scope, audience: 'investors', actor: person(SUPER), idempotencyKey: key });
    assert.equal(l.ok, true, JSON.stringify(l));
    return l.lineAssetUid as string;
  };
  const bootstrap = async () => {
    const made = await call('', { tenantId: TENANT, kind: 'pitch_deck', sourceId: DECK_ID });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    return made.body;
  };
  return { db, env, r2, call, count, saveDeck, image, variant, select, line, bootstrap };
}

/** Two cards: an image block on the first, a card background on the second. */
const deckWith = (hero: object | null, backdrop: object | null) => [
  { uid: 'one', title: 'Opening', blocks: [{ id: 'body', kind: 'text', text: 'Hello' },
    ...(hero ? [{ id: 'hero', kind: 'image', image_url: '/synthetic/hero.png', workgraph_media: hero }] : [])] },
  { uid: 'two', title: 'Product', ...(backdrop ? { background: { image_url: '/synthetic/bg.png', workgraph_media: backdrop } } : {}),
    blocks: [{ id: 'copy', kind: 'text', text: 'Product' }] },
];
const freezeBody = (made: any, lineAssetUid: string, key: string) => ({ headRevisionUid: made.headRevisionUid, approvedDigest: made.digest,
  lineAssetUid, role: 'deck', partial: true, idempotencyKey: key });
const manifestBody = (w: any, uid: string) => JSON.parse((w.db.prepare('SELECT body_json FROM work_graph_release_manifests WHERE manifest_uid = ?').get(uid) as any).body_json);

test('two agents make variants of two images; the person picks one each; the frozen deck pins exactly those revisions and digests', async t => {
  const w = await world(t);
  const hero = await w.image('hero'), backdrop = await w.image('backdrop');
  // Two visual agents work in parallel: A on the hero, B on the backdrop and a competing hero variant.
  const heroA = await w.variant(hero, 'run_visuals_a');
  const heroB = await w.variant(hero, 'run_visuals_b');
  const backB = await w.variant(backdrop, 'run_visuals_b');
  await w.select(hero, hero.revisionUid, heroA);
  await w.select(backdrop, backdrop.revisionUid, backB);
  w.saveDeck(deckWith(ref({ assetUid: hero.assetUid, revisionUid: heroA.revisionUid }), ref({ assetUid: backdrop.assetUid, revisionUid: backB.revisionUid })));
  const made = await w.bootstrap();
  const lineUid = await w.line();
  const frozen = await w.call(`/${made.assetUid}/freeze`, freezeBody(made, lineUid, 'freeze-1'));
  assert.equal(frozen.status, 200, JSON.stringify(frozen.body));
  const expected = [
    [hero.assetUid, heroA.revisionUid, heroA.digest, ['one/hero']],
    [backdrop.assetUid, backB.revisionUid, backB.digest, ['two/__layout']],
  ].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  assert.deepEqual(frozen.body.media.map((m: any) => [m.assetUid, m.revisionUid, m.digest, m.units]), expected);
  for (const m of frozen.body.media) assert.deepEqual([m.kind, m.objectClass], ['image', 'master']);
  assert.equal(frozen.body.cost.r2ClassB, 2);
  // The manifest holds the deck and both media at their digests, with one component edge each; B's losing hero variant is not in it.
  const body = manifestBody(w, frozen.body.manifestUid);
  const pinned = body.components.map((c: any) => [c.asset, c.revision, c.digest, c.role]);
  assert.deepEqual(pinned.filter((p: any) => p[3] === 'embedded_media').map((p: any) => p.slice(0, 3)), expected.map((e) => e.slice(0, 3)));
  assert.deepEqual(pinned.filter((p: any) => p[3] === 'deck'), [[made.assetUid, made.headRevisionUid, made.digest, 'deck']]);
  assert.ok(!pinned.some((p: any) => p[1] === heroB.revisionUid));
  assert.equal(w.count("SELECT COUNT(*) AS n FROM work_graph_edges WHERE from_revision_uid = ? AND edge_kind = 'component'", frozen.body.manifestUid), 3);
  const audit = JSON.parse((w.db.prepare("SELECT filters_json AS details FROM admin_audit_log WHERE action = 'workgraph_drafting_freeze' ORDER BY id DESC").get() as any).details);
  assert.deepEqual([...audit.media].sort(), expected.map((e) => `${e[0]}:${e[1]}:${e[2]}`).sort());
  const status: any = await releaseStatus(w.env, { scope: { tenantId: TENANT, companyId: COMPANY, projectId: null } }, frozen.body.manifestUid);
  assert.ok(status.release.components.every((c: any) => c.status === 'current'), JSON.stringify(status.release.components));
});

test('a media edit after the freeze leaves the export needing re-approval, and refuses a new freeze until the deck embeds the new revision', async t => {
  const w = await world(t);
  const hero = await w.image('hero');
  w.saveDeck(deckWith(ref(hero), null));
  const made = await w.bootstrap();
  const lineUid = await w.line();
  const frozen = await w.call(`/${made.assetUid}/freeze`, freezeBody(made, lineUid, 'freeze-1'));
  assert.equal(frozen.status, 200, JSON.stringify(frozen.body));

  // The designer edits the image: an agent's variant is selected and becomes the head.
  const edit = await w.variant(hero, 'run_retouch');
  const moved = await w.select(hero, hero.revisionUid, edit);
  // The impact of the edit names the frozen export that pinned the old revision.
  assert.ok(moved.impact.outputs.some((o: any) => o.revisionUid === frozen.body.manifestUid && o.edgeKind === 'component'));
  const impact: any = await impactOf(w.env, { scope: { tenantId: TENANT, companyId: COMPANY, projectId: null } }, hero.revisionUid);
  assert.ok(impact.impact.outputs.some((o: any) => o.revisionUid === frozen.body.manifestUid));
  const status: any = await releaseStatus(w.env, { scope: { tenantId: TENANT, companyId: COMPANY, projectId: null } }, frozen.body.manifestUid);
  const pinnedMedia = status.release.components.find((c: any) => c.asset === hero.assetUid);
  assert.equal(pinnedMedia.status, 'reapproval_required');
  assert.deepEqual(pinnedMedia.reasons, ['superseded']);
  assert.equal(status.release.status, 'reapproval_required');

  // The same approved deck cannot be frozen again: it still embeds the superseded revision.
  const again = await w.call(`/${made.assetUid}/freeze`, freezeBody(made, lineUid, 'freeze-2'));
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'embedded_media_stale');
  assert.deepEqual(again.body.ids, [hero.assetUid, hero.revisionUid, edit.revisionUid]);
  assert.equal(w.count('SELECT COUNT(*) AS n FROM work_graph_release_manifests'), 1);

  // The deck is saved embedding the new revision; the old approval no longer reads as the head; a person re-adopts it.
  w.saveDeck(deckWith(ref({ assetUid: hero.assetUid, revisionUid: edit.revisionUid }), null));
  const stale = await w.call(`/${made.assetUid}/freeze`, freezeBody(made, lineUid, 'freeze-3'));
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'stale_revision');
  const adopted = await w.call(`/${made.assetUid}/adopt`, { headRevisionUid: made.headRevisionUid, idempotencyKey: 'readopt' });
  assert.equal(adopted.status, 200, JSON.stringify(adopted.body));
  assert.notEqual(adopted.body.digest, made.digest);
  const renewed = await w.call(`/${made.assetUid}/freeze`, freezeBody(adopted.body, lineUid, 'freeze-4'));
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
  assert.deepEqual(renewed.body.media.map((m: any) => [m.revisionUid, m.digest]), [[edit.revisionUid, edit.digest]]);
  assert.notEqual(renewed.body.digest, frozen.body.digest);
});

test('an idempotent re-freeze replays the same manifest and pins; the same key with other pins is a conflict', async t => {
  const w = await world(t);
  const hero = await w.image('hero');
  w.saveDeck(deckWith(ref(hero), ref(hero)));
  const made = await w.bootstrap();
  const lineUid = await w.line();
  const first = await w.call(`/${made.assetUid}/freeze`, freezeBody(made, lineUid, 'freeze-1'));
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.replayed, false);
  // One image embedded twice (a block and a background) is one pin, naming both places.
  assert.deepEqual(first.body.media.map((m: any) => [m.revisionUid, m.units]), [[hero.revisionUid, ['one/hero', 'two/__layout']]]);
  const counts = () => [w.count('SELECT COUNT(*) AS n FROM work_graph_release_manifests'), w.count('SELECT COUNT(*) AS n FROM work_graph_revisions'),
    w.count('SELECT COUNT(*) AS n FROM work_graph_edges')];
  const before = counts();
  const replay = await w.call(`/${made.assetUid}/freeze`, freezeBody(made, lineUid, 'freeze-1'));
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.replayed, true);
  assert.deepEqual([replay.body.manifestUid, replay.body.digest, replay.body.media], [first.body.manifestUid, first.body.digest, first.body.media]);
  assert.deepEqual(counts(), before);

  // A new image version the deck now embeds, re-adopted, under the old key: refused, nothing cut.
  const edit = await w.variant(hero, 'run_retouch');
  await w.select(hero, hero.revisionUid, edit);
  w.saveDeck(deckWith(ref({ assetUid: hero.assetUid, revisionUid: edit.revisionUid }), null));
  const adopted = await w.call(`/${made.assetUid}/adopt`, { headRevisionUid: made.headRevisionUid, idempotencyKey: 'readopt' });
  assert.equal(adopted.status, 200);
  const conflict = await w.call(`/${made.assetUid}/freeze`, freezeBody(adopted.body, lineUid, 'freeze-1'));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, 'idempotency_conflict');
  assert.equal(w.count('SELECT COUNT(*) AS n FROM work_graph_release_manifests'), 1);
});

test('media of another tenant, company or project reads as absent, and nothing is cut', async t => {
  const w = await world(t);
  const otherTenant = await w.image('other-tenant', { tenantId: TENANT + 1, companyId: FOREIGN + 1, projectId: null });
  const otherCompany = await w.image('other-company', { companyId: FOREIGN, projectId: FOREIGN_PROJECT });
  const sibling = await w.image('sibling', { projectId: OTHER_PROJECT });
  const wide = await w.image('company-wide', { projectId: null });
  const lineUid = await w.line();
  w.saveDeck(deckWith(null, null));
  let made = await w.bootstrap();
  // The same company and project numbers under another tenant, and another company's company-wide image.
  const sameIdsOtherTenant = await w.image('same-ids-other-tenant', { tenantId: TENANT + 1 });
  const otherCompanyWide = await w.image('other-company-wide', { companyId: FOREIGN, projectId: null });
  const heads = w.r2.ops.head;
  for (const foreign of [otherTenant, otherCompany, sibling, { ...wide, assetUid: otherTenant.assetUid }, sameIdsOtherTenant, otherCompanyWide]) {
    w.saveDeck(deckWith(ref(foreign), null));
    const adopted = await w.call(`/${made.assetUid}/adopt`, { headRevisionUid: made.headRevisionUid, idempotencyKey: `adopt-${foreign.revisionUid}-${foreign.assetUid}` });
    assert.equal(adopted.status, 200, JSON.stringify(adopted.body));
    made = { ...made, headRevisionUid: adopted.body.headRevisionUid, digest: adopted.body.digest };
    const refused = await w.call(`/${made.assetUid}/freeze`, freezeBody(made, lineUid, `freeze-${foreign.revisionUid}`));
    assert.equal(refused.status, 404, JSON.stringify(refused.body));
    assert.equal(refused.body.error, 'embedded_media_not_found');
    assert.equal(refused.body.cost, undefined);
  }
  assert.equal(w.count('SELECT COUNT(*) AS n FROM work_graph_release_manifests'), 0);
  assert.equal(w.r2.ops.head, heads, 'no foreign object is ever asked for');
  assert.equal(w.count("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'workgraph_drafting_freeze' AND filters_json LIKE '%embedded_media_not_found%'"), 6);
  // A company-wide image of the deck's own company is the deck's to embed.
  w.saveDeck(deckWith(ref(wide), null));
  const adopted = await w.call(`/${made.assetUid}/adopt`, { headRevisionUid: made.headRevisionUid, idempotencyKey: 'adopt-wide' });
  const frozen = await w.call(`/${made.assetUid}/freeze`, freezeBody(adopted.body, lineUid, 'freeze-wide'));
  assert.equal(frozen.status, 200, JSON.stringify(frozen.body));
  assert.deepEqual(frozen.body.media.map((m: any) => m.revisionUid), [wide.revisionUid]);
});

test('revoked media refuses the freeze: an offline revision, a taken-down revision and a revoked author', async t => {
  const w = await world(t);
  const lineUid = await w.line();
  const offline = await w.image('offline');
  const author = await w.image('author');
  const downed = await w.image('downed');
  w.saveDeck(deckWith(null, null));
  let made = await w.bootstrap();
  const embed = async (img: { assetUid: string; revisionUid: string }, key: string) => {
    w.saveDeck(deckWith(ref(img), null));
    const adopted = await w.call(`/${made.assetUid}/adopt`, { headRevisionUid: made.headRevisionUid, idempotencyKey: `adopt-${key}` });
    assert.equal(adopted.status, 200, JSON.stringify(adopted.body));
    made = { ...made, headRevisionUid: adopted.body.headRevisionUid, digest: adopted.body.digest };
    return w.call(`/${made.assetUid}/freeze`, freezeBody(made, lineUid, `freeze-${key}`));
  };

  const off: any = await setRevisionOffline(w.env, offline.ctx, { revisionUid: offline.revisionUid, offline: true, actor: person(DESIGNER), reason: 'rights query' });
  assert.equal(off.ok, true, JSON.stringify(off));
  const r1 = await embed(offline, 'offline');
  assert.equal(r1.status, 409);
  assert.deepEqual([r1.body.error, r1.body.ids[2]], ['embedded_media_revoked', 'offline']);

  w.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(DESIGNER);
  const r2 = await embed(author, 'author');
  assert.deepEqual([r2.status, r2.body.error, r2.body.ids[2]], [409, 'embedded_media_revoked', 'author_revoked']);
  w.db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(DESIGNER);

  // A takedown of that exact revision (in an earlier export of the same company) revokes it everywhere once applied.
  const earlier = await embed(downed, 'downed-1');
  assert.equal(earlier.status, 200, JSON.stringify(earlier.body));
  const takedown = (outcome: 'applied' | 'refused', key: string | null, refusal: string | null) => w.db.prepare(`INSERT INTO work_graph_release_takedowns (tenant_id, company_id, line_asset_uid, manifest_uid, manifest_digest, scope,
      revision_uid, digest, reason_code, evidence_ref, actor_kind, actor_user_id, outcome, refusal_code, idempotency_key, request_hash, created_at)
    VALUES (?, ?, ?, ?, ?, 'component', ?, ?, 'rights_withdrawn', 'synthetic-evidence', 'person', ?, ?, ?, ?, ?, ?)`)
    .run(TENANT, COMPANY, lineUid, earlier.body.manifestUid, earlier.body.digest, downed.revisionUid, downed.digest, SUPER, outcome, refusal, key, 'f'.repeat(64), '2026-11-27T13:00:00Z');
  // A refused takedown request revokes nothing: the same deck still freezes under a new key.
  takedown('refused', null, 'no_authority');
  const stillOk = await w.call(`/${made.assetUid}/freeze`, freezeBody(made, lineUid, 'freeze-downed-refused'));
  assert.equal(stillOk.status, 200, JSON.stringify(stillOk.body));
  takedown('applied', 'takedown-1', null);
  const r3 = await w.call(`/${made.assetUid}/freeze`, freezeBody(made, lineUid, 'freeze-downed-2'));
  assert.deepEqual([r3.status, r3.body.error, r3.body.ids[2]], [409, 'embedded_media_revoked', 'taken_down']);
  assert.equal(w.count('SELECT COUNT(*) AS n FROM work_graph_release_manifests'), 2);
});

test('unreadable media refuses the freeze: missing or mismatched bytes, a tombstoned revision, a non-media asset, a malformed or ambiguous ref', async t => {
  const w = await world(t);
  const lineUid = await w.line();
  w.saveDeck(deckWith(null, null));
  let made = await w.bootstrap();
  const embed = async (slides: unknown[], key: string) => {
    w.saveDeck(slides);
    const adopted = await w.call(`/${made.assetUid}/adopt`, { headRevisionUid: made.headRevisionUid, idempotencyKey: `adopt-${key}` });
    assert.equal(adopted.status, 200, JSON.stringify(adopted.body));
    made = { ...made, headRevisionUid: adopted.body.headRevisionUid, digest: adopted.body.digest };
    return w.call(`/${made.assetUid}/freeze`, freezeBody(made, lineUid, `freeze-${key}`));
  };
  const lost = await w.image('lost');
  const key = (w.db.prepare('SELECT source_id FROM work_graph_revisions WHERE revision_uid = ?').get(lost.revisionUid) as any).source_id;
  w.r2.objects.delete(key);
  const r1 = await embed(deckWith(ref(lost), null), 'lost');
  assert.deepEqual([r1.status, r1.body.error, r1.body.ids[2]], [409, 'embedded_media_unreadable', 'bytes_missing']);
  w.r2.plant(key, bytes('different bytes of another length'));
  const r2 = await w.call(`/${made.assetUid}/freeze`, freezeBody(made, lineUid, 'freeze-swapped'));
  assert.deepEqual([r2.status, r2.body.error, r2.body.ids[2]], [409, 'embedded_media_unreadable', 'bytes_mismatch']);

  const gone = await w.image('gone');
  const loose = await w.variant(gone, 'run_loose');
  const tomb: any = await tombstoneRevision(w.env, gone.ctx, { revisionUid: loose.revisionUid, actor: person(DESIGNER), reason: 'erasure' } as any);
  assert.equal(tomb.ok, true, JSON.stringify(tomb));
  const r3 = await embed(deckWith(ref({ assetUid: gone.assetUid, revisionUid: loose.revisionUid }), null), 'tombstoned');
  assert.deepEqual([r3.status, r3.body.error, r3.body.ids[2]], [409, 'embedded_media_unreadable', 'tombstoned']);

  // The deck asset itself is not media.
  const r4 = await embed(deckWith(ref({ assetUid: made.assetUid, revisionUid: made.headRevisionUid }), null), 'not-media');
  assert.deepEqual([r4.status, r4.body.error, r4.body.ids[2]], [409, 'embedded_media_unreadable', 'kind']);

  // An image whose canonical version lives in an external editor: WorkGraph holds no bytes it can check.
  const ext: any = await registerMediaAsset(w.env, gone.ctx, { scope: gone.scope, kind: 'image', accessClass: 'confidential', actor: person(DESIGNER), idempotencyKey: 'media-external' });
  const extMaster: any = await recordMaster(w.env, gone.ctx, { assetUid: ext.assetUid, expectedRevisionUid: null, digest: 'c'.repeat(64), byteLength: 10,
    mediaProfile: 'image/png', source: { store: 'external_editor', locator: 'synthetic_editor', id: 'file-1', revision: 'rev-1' }, provenance: owned,
    use: 'deck', by: person(DESIGNER), idempotencyKey: 'master-external' });
  assert.equal(extMaster.ok, true, JSON.stringify(extMaster));
  const rExt = await embed(deckWith(ref({ assetUid: ext.assetUid, revisionUid: extMaster.revisionUid }), null), 'external');
  assert.deepEqual([rExt.status, rExt.body.error, rExt.body.ids[2]], [409, 'embedded_media_unreadable', 'source']);

  const r5 = await embed(deckWith({ asset_uid: gone.assetUid }, null), 'malformed');
  assert.deepEqual([r5.status, r5.body.error], [409, 'embedded_media_malformed']);
  const r6 = await embed(deckWith(ref(gone), ref({ assetUid: gone.assetUid, revisionUid: loose.revisionUid })), 'ambiguous');
  assert.deepEqual([r6.status, r6.body.error], [409, 'embedded_media_ambiguous']);
  assert.equal(w.count('SELECT COUNT(*) AS n FROM work_graph_release_manifests'), 0);
});

test('refs are read from every unit the deck digest covers, and a deck without media freezes as before', async t => {
  const units = [
    { id: 'a/__title', kind: 'card_area', value: JSON.stringify('workgraph_media'), text: '', textMergeable: true, sensitive: [] },
    { id: 'a/img', kind: 'card_area', value: JSON.stringify({ kind: 'image', workgraph_media: { asset_uid: 'b', revision_uid: 'r2' } }), text: '', textMergeable: false, sensitive: [] },
    { id: 'a/__layout', kind: 'card_layout', value: JSON.stringify({ rest: { background: { workgraph_media: { asset_uid: 'a', revision_uid: 'r1' } } }, loose: [{ kind: 'image', workgraph_media: { asset_uid: 'b', revision_uid: 'r2' } }] }), text: '', textMergeable: false, sensitive: [] },
  ] as any;
  const refs: any = embeddedMediaRefs(units);
  assert.deepEqual(refs.refs, [{ assetUid: 'a', revisionUid: 'r1', units: ['a/__layout'] }, { assetUid: 'b', revisionUid: 'r2', units: ['a/img', 'a/__layout'] }]);
  assert.equal((embeddedMediaRefs([{ ...units[1], value: JSON.stringify({ workgraph_media: { asset_uid: 'b', revision_uid: 'r2', extra: 1 } }) }]) as any).code, 'embedded_media_malformed');
  assert.equal((embeddedMediaRefs([{ ...units[1], value: JSON.stringify({ workgraph_media: { asset_uid: 'other', revision_uid: 'r2' } }) }, units[1]]) as any).code, 'embedded_media_malformed');
  const many = Array.from({ length: 32 }, (_, i) => ({ ...units[1], id: `u${i}`, value: JSON.stringify({ workgraph_media: { asset_uid: `a${i}`, revision_uid: `r${i}` } }) }));
  assert.equal((embeddedMediaRefs(many) as any).code, 'embedded_media_too_many');
  assert.equal((embeddedMediaRefs(many.slice(0, 31)) as any).refs.length, 31);

  const w = await world(t);
  w.saveDeck(deckWith(null, null));
  const made = await w.bootstrap();
  const frozen = await w.call(`/${made.assetUid}/freeze`, freezeBody(made, await w.line(), 'plain'));
  assert.equal(frozen.status, 200, JSON.stringify(frozen.body));
  assert.deepEqual(frozen.body.media, []);
  assert.equal(frozen.body.cost.r2ClassB, 0);
  assert.equal(manifestBody(w, frozen.body.manifestUid).components.length, 1);
});
