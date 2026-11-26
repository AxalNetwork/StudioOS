/**
 * D5585 part 1 (#5585, WorkGraph P1) — composite release manifests on #5581's registry, against a real SQLite
 * database built from the #5581 migrations and this issue's (`202611182125_5585_work_graph_releases.sql`):
 *
 *   1. A synthetic venture campaign (deck, source graphics, offer terms, video, website commit, marketing copy,
 *      captions and evidence) releases one consistent package; every displayed piece traces to its pinned version;
 *      the outbox effects are queued in the pointer's batch and never delivered.
 *   2. An edit after approval makes the release stale (`reapproval_required`, or `rebuild_required` for a derived
 *      output whose input moved), and the pointer and the outbox stay as they were.
 *   3. Publish decisions are bound to the manifest digest, the audience, the profile and the reviewer's authority;
 *      render approval, self-approval, an agent, a withdrawn or revoked approval and a change request do not publish.
 *   4. No draft or confidential piece reaches a public export.
 *   5. Every operation refuses another tenant.
 *   6. A replayed or stale webhook cannot publish twice or roll the pointer back; concurrent publishers: one wins.
 *   7. Domain policy profiles: attestations at the exact digest, by the right authority; protected data adds residency
 *      and security review; a full package cannot drop a piece; a component's bytes must have been approved.
 *   8. The four tables are append-only; every result carries its D1 cost.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_releases_5585.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1 } from './_d1_sqlite.mjs';
import { sha256Hex, type Actor, type AssetKind, type AccessClass, type Scope, type SourceRef } from '../src/services/workGraphContracts.ts';
import { WORK_GRAPH_DEPS, advanceHead, createRevision, registerAsset } from '../src/services/workGraphRevisions.ts';
import {
  attestComponent, cutManifest, decideRelease, publishRelease, publishedRelease, registerReleaseLine, releaseStatus,
  type Audience, type DecideInput, type ManifestComponentInput, type ProfileName, type ReleaseContext, type Requirement,
} from '../src/services/workGraphReleases.ts';

const read = (f: string) => readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8');
const SCHEMA = read('202611140007_5581_work_graph_revisions.sql') + read('202611140122_5581_work_graph_lease_events.sql')
  + read('202611140924_5581_work_graph_integrity.sql') + read('202611182125_5585_work_graph_releases.sql')
  + read('202611190940_5585_work_graph_release_takedowns.sql') + read('202611260837_5585_release_render_ceiling.sql');

WORK_GRAPH_DEPS.now = () => new Date('2026-11-18T21:30:00Z');
let n = 0;
WORK_GRAPH_DEPS.newId = () => `id${++n}`;

const SCOPE: Scope = { tenantId: 7, companyId: 70, projectId: 700 };
const OTHER: Scope = { tenantId: 8, companyId: 80, projectId: 800 };
const ALICE: Actor = { kind: 'person', userId: 11 }; // author
const BOB: Actor = { kind: 'person', userId: 12 }; // maintainer, approves component heads
const CAROL: Actor = { kind: 'person', userId: 13 }; // brand owner
const DAVE: Actor = { kind: 'person', userId: 14 }; // founder
const ERIN: Actor = { kind: 'person', userId: 15 }; // counsel
const SAM: Actor = { kind: 'person', userId: 16 }; // security officer
const CI: Actor = { kind: 'agent', agentRunId: 'run_ci', onBehalfOfUserId: 12, chargeId: null };
const AUTH = new Map<number, string[]>([
  [11, ['founder']], [12, ['maintainer']], [13, ['brand_owner']], [14, ['founder']], [15, ['counsel', 'authorized_signatory']], [16, ['security_officer']],
]);
const CTX: ReleaseContext = { scope: { tenantId: 7, companyId: 70, projectId: null }, authorities: AUTH };
const OTHER_CTX: ReleaseContext = { scope: { tenantId: 8, companyId: 80, projectId: null }, authorities: AUTH };
const hex = (s: string) => sha256Hex(new TextEncoder().encode(s));

function world() {
  const { DB, db } = makeD1(SCHEMA);
  return { env: { DB } as any, db };
}
type W = ReturnType<typeof world>;
const count = (w: W, sql: string, ...b: any[]) => Number((w.db.prepare(sql).get(...b) as any).n);
const headOf = (w: W, a: string) => (w.db.prepare('SELECT head_revision_uid AS h, head_seq AS s FROM work_graph_assets WHERE asset_uid = ?').get(a) as any);

interface Piece { asset: string; rev: string; digest: string; key: string; kind: AssetKind; source: SourceRef }

const SOURCES: Record<string, (k: string) => SourceRef> = {
  code: (k) => ({ store: 'git', locator: 'acme/site', id: 'main', revision: (k.length.toString(16) + 'a'.repeat(40)).slice(0, 40) }),
  image: (k) => ({ store: 'r2_object', locator: 'COMPANY_LOGOS', id: `graphics/${k}`, revision: k }),
  video: (k) => ({ store: 'stream', locator: 'stream', id: `vid-${k}`, revision: k }),
  pitch_deck: (k) => ({ store: 'd1_record', locator: 'pitch_decks', id: '41', revision: k }),
  offer: (k) => ({ store: 'd1_record', locator: 'quote_versions', id: '9', revision: k }),
  document: (k) => ({ store: 'd1_record', locator: 'documents', id: k, revision: k }),
};

/** An asset with an approved first head (BOB approves the exact bytes, as a release requires). */
async function piece(w: W, key: string, kind: AssetKind, access: AccessClass, opts: { deps?: Piece[]; scope?: Scope; ctx?: ReleaseContext; approve?: boolean; residency?: string | null } = {}): Promise<Piece> {
  const ctx = opts.ctx ?? CTX;
  const a = await registerAsset(w.env, ctx, { scope: opts.scope ?? SCOPE, kind, accessClass: access, approvalPolicy: 'team_review', actor: ALICE, idempotencyKey: `asset-${key}` });
  assert.ok(a.ok, JSON.stringify(a));
  return revise(w, { asset: a.assetUid, rev: '', digest: '', key, kind, source: SOURCES[kind](key) }, `${key}-v1`, opts);
}
async function revise(w: W, p: Piece, key: string, opts: { deps?: Piece[]; ctx?: ReleaseContext; approve?: boolean; residency?: string | null } = {}): Promise<Piece> {
  const ctx = opts.ctx ?? CTX;
  const digest = await hex(key);
  const source = SOURCES[p.kind](key);
  const r = await createRevision(w.env, ctx, {
    assetUid: p.asset, parents: p.rev ? [p.rev] : [], digest, byteLength: 10, mediaProfile: 'application/octet-stream', source,
    author: ALICE, idempotencyKey: `rev-${key}`, residency: opts.residency ?? null,
    dependencies: (opts.deps ?? []).map((d) => ({ kind: 'derived' as const, assetUid: d.asset, revisionUid: d.rev })),
  });
  assert.ok(r.ok, JSON.stringify(r));
  if (opts.approve !== false) {
    const h = await advanceHead(w.env, ctx, {
      assetUid: p.asset, expectedRevisionUid: p.rev || null, revisionUid: r.revisionUid, actor: ALICE, idempotencyKey: `adv-${key}`,
      approval: { ref: `approvals:item-${key}`, contentDigest: digest, reviewer: BOB, decidedAt: '2026-11-18T21:00:00Z' },
    });
    assert.ok(h.ok, JSON.stringify(h));
  }
  return { ...p, rev: r.revisionUid, digest, key, source };
}

const ATTEST: Record<ProfileName, [Requirement, Actor, string | null][]> = {
  code: [['pr_validated', CI, null], ['ci_passed', CI, null]],
  marketing: [['brand_rights', CAROL, 'brand_owner'], ['claims_review', CAROL, 'brand_owner']],
  investor_pitch: [['evidence_review', DAVE, 'founder']],
  contract: [['counsel_review', ERIN, 'counsel'], ['signing_authority', ERIN, 'authorized_signatory']],
  protected_data: [['residency_review', SAM, 'security_officer'], ['security_review', SAM, 'security_officer']],
};
async function attestAll(w: W, p: Piece, profiles: ProfileName[]) {
  for (const prof of profiles) {
    for (const [req, actor, authority] of ATTEST[prof]) {
      const r = await attestComponent(w.env, CTX, { revisionUid: p.rev, digest: p.digest, requirement: req, evidenceRef: `ev:${p.key}:${req}`, authority, actor, idempotencyKey: `att-${p.key}-${req}` });
      assert.ok(r.ok, JSON.stringify(r));
    }
  }
}

const REVIEWER: Record<ProfileName, [Actor, string]> = {
  code: [BOB, 'maintainer'], marketing: [CAROL, 'brand_owner'], investor_pitch: [DAVE, 'founder'], contract: [ERIN, 'counsel'],
  protected_data: [SAM, 'security_officer'],
};
function decision(manifestUid: string, digest: string, profile: ProfileName, key: string, over: Partial<DecideInput> = {}, audience: Audience = 'investors'): DecideInput {
  const [reviewer, authority] = REVIEWER[profile];
  return {
    manifestUid, digest, audience, purpose: 'publish', profile, authority, decision: 'approve', reviewer, approvalRef: `approvals:${key}`,
    citations: [], disclosureRef: 'disclosure:forward-looking-v2', rightsRef: 'rights:brand-licence-2026', idempotencyKey: `dec-${key}`, ...over,
  };
}

/** The synthetic venture campaign: every piece accepted, approved and attested; a line for investors. */
async function campaign(w: W) {
  const glossary = await piece(w, 'glossary', 'document', 'internal');
  const p = {
    website: await piece(w, 'website', 'code', 'internal'),
    graphics: await piece(w, 'graphics', 'image', 'confidential'),
    deck: await piece(w, 'deck', 'pitch_deck', 'confidential'),
    offer: await piece(w, 'offer', 'offer', 'confidential'),
    copy: await piece(w, 'copy', 'document', 'internal'),
    captions: await piece(w, 'captions', 'document', 'internal', { deps: [glossary] }),
    video: await piece(w, 'video', 'video', 'confidential'),
    evidence: await piece(w, 'evidence', 'document', 'confidential'),
  };
  const profile: Record<keyof typeof p, ProfileName> = {
    website: 'code', graphics: 'marketing', deck: 'investor_pitch', offer: 'contract', copy: 'marketing', captions: 'marketing',
    video: 'marketing', evidence: 'investor_pitch',
  };
  for (const k of Object.keys(p) as (keyof typeof p)[]) await attestAll(w, p[k], [profile[k]]);
  const line = await registerReleaseLine(w.env, CTX, { scope: SCOPE, audience: 'investors', actor: ALICE, idempotencyKey: 'line-investors' });
  assert.ok(line.ok, JSON.stringify(line));
  const components = (pieces = p): ManifestComponentInput[] => (Object.keys(pieces) as (keyof typeof p)[]).map((k) => ({
    assetUid: pieces[k].asset, revisionUid: pieces[k].rev, digest: pieces[k].digest, role: k, profile: profile[k],
  }));
  return { p, glossary, profile, line: line.lineAssetUid, components };
}
type Campaign = Awaited<ReturnType<typeof campaign>>;

async function cut(w: W, c: Campaign, key: string, over: Partial<Parameters<typeof cutManifest>[2]> = {}) {
  const r = await cutManifest(w.env, CTX, { lineAssetUid: c.line, components: c.components(), partial: false, author: ALICE, idempotencyKey: key, ...over });
  assert.ok(r.ok, JSON.stringify(r));
  return r;
}
async function approveAll(w: W, manifestUid: string, digest: string, key: string, profiles: ProfileName[] = ['code', 'contract', 'investor_pitch', 'marketing'], evidenceRev?: string) {
  for (const prof of profiles) {
    const r = await decideRelease(w.env, CTX, decision(manifestUid, digest, prof, `${key}-${prof}`, prof === 'investor_pitch' ? { citations: [evidenceRev!] } : {}));
    assert.ok(r.ok, JSON.stringify(r));
  }
}
const EFFECTS = [
  { target: 'github_pr' as const, ref: 'acme/site#12' }, { target: 'stream' as const, ref: 'vid-campaign' },
  { target: 'signed_document' as const, ref: 'envelope-77' }, { target: 'external_distribution' as const, ref: 'investor-list-1' },
];
function publish(w: W, line: string, manifestUid: string, expected: string | null, key: string, ctx: ReleaseContext = CTX, effects = EFFECTS) {
  return publishRelease(w.env, ctx, { lineAssetUid: line, manifestUid, expectedManifestUid: expected, effects, actor: ALICE, idempotencyKey: key });
}
async function ready(w: W) {
  const c = await campaign(w);
  const m = await cut(w, c, 'm1');
  await approveAll(w, m.manifestUid, m.digest, 'm1', undefined, c.p.evidence.rev);
  return { c, m };
}

test('1. the synthetic venture campaign releases one consistent, traceable package with queued effects', async () => {
  const w = world();
  const { c, m } = await ready(w);
  const st = await releaseStatus(w.env, CTX, m.manifestUid);
  assert.ok(st.ok);
  assert.equal(st.release.status, 'current');
  assert.deepEqual(st.release.missingApprovals, []);
  assert.ok(st.release.components.every((x) => x.missingAttestations.length === 0));

  const r = await publish(w, c.line, m.manifestUid, null, 'pub-1');
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.replayed, false);
  assert.equal(headOf(w, c.line).h, m.manifestUid);
  assert.equal(r.effectIds.length, 4);
  assert.ok(r.cost.d1Statements > 0 && r.cost.d1Batches >= 1);

  // Queued, not delivered: pending, no attempt, one audit row each, all in the pointer's batch.
  const eff = w.db.prepare('SELECT effect_kind, state, attempts, payload_json FROM work_graph_effects ORDER BY id').all() as any[];
  assert.deepEqual(eff.map((e) => [e.effect_kind, e.state, e.attempts]), [
    ['release_github_pr', 'pending', 0], ['release_stream', 'pending', 0], ['release_signed_document', 'pending', 0], ['release_external_distribution', 'pending', 0],
  ]);
  assert.ok(eff.every((e) => JSON.parse(e.payload_json).digest === m.digest));
  assert.equal(count(w, `SELECT COUNT(*) AS n FROM work_graph_integrity_events WHERE action = 'effect_enqueued' AND revision_uid = ?`, m.manifestUid), 4);

  // The publication's audit row binds the manifest digest and a person's approval.
  const ev = w.db.prepare(`SELECT approval_ref, approval_digest, approver_user_id FROM work_graph_events WHERE action = 'advance_head' AND asset_uid = ?`).get(c.line) as any;
  assert.equal(ev.approval_digest, m.digest);
  assert.ok(ev.approval_ref.startsWith('approvals:m1-'));

  // Every displayed piece traces to its pinned version, digest and source, and the digest is the body's.
  const pub = await publishedRelease(w.env, CTX, c.line);
  assert.ok(pub.ok && pub.release);
  assert.equal(pub.release.manifestUid, m.manifestUid);
  for (const k of Object.keys(c.p) as (keyof Campaign['p'])[]) {
    const x = pub.release.components.find((y) => y.role === k)!;
    assert.deepEqual([x.asset, x.revision, x.digest, x.source], [c.p[k].asset, c.p[k].rev, c.p[k].digest, c.p[k].source]);
  }
  const body = (w.db.prepare('SELECT body_json FROM work_graph_release_manifests WHERE manifest_uid = ?').get(m.manifestUid) as any).body_json;
  assert.equal(await sha256Hex(new TextEncoder().encode(body)), m.digest);
  assert.equal((w.db.prepare('SELECT digest FROM work_graph_revisions WHERE revision_uid = ?').get(m.manifestUid) as any).digest, m.digest);
  assert.equal(count(w, `SELECT COUNT(*) AS n FROM work_graph_edges WHERE from_revision_uid = ? AND edge_kind = 'component'`, m.manifestUid), 8);

  // After a later edit the published pointer still serves the pinned versions, never the latest.
  await revise(w, c.p.deck, 'deck-v2');
  const later = await publishedRelease(w.env, CTX, c.line);
  assert.ok(later.ok && later.release);
  assert.equal(later.release.components.find((y) => y.role === 'deck')!.revision, c.p.deck.rev);
  assert.equal(later.release.status, 'reapproval_required');
});

test('2. an edit after approval makes the release stale; the pointer and the outbox do not move', async () => {
  const w = world();
  const { c, m } = await ready(w);
  await revise(w, c.p.deck, 'deck-v2');
  const st = await releaseStatus(w.env, CTX, m.manifestUid);
  assert.ok(st.ok);
  assert.equal(st.release.status, 'reapproval_required');
  assert.deepEqual(st.release.components.find((x) => x.role === 'deck')!.reasons, ['superseded']);
  const r = await publish(w, c.line, m.manifestUid, null, 'pub-stale');
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.code, 'reapproval_required');
  assert.equal(headOf(w, c.line).h, null);
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_effects'), 0);
  assert.equal(count(w, `SELECT COUNT(*) AS n FROM work_graph_events WHERE action = 'advance_refused' AND refusal_code = 'reapproval_required' AND asset_uid = ?`, c.line), 1);
});

test('2b. a derived output whose input moved owes a rebuild under the marketing profile', async () => {
  const w = world();
  const { c, m } = await ready(w);
  await revise(w, c.glossary, 'glossary-v2');
  const st = await releaseStatus(w.env, CTX, m.manifestUid);
  assert.ok(st.ok);
  const cap = st.release.components.find((x) => x.role === 'captions')!;
  assert.deepEqual([cap.status, cap.reasons], ['rebuild_required', ['input_changed']]);
  assert.equal(st.release.status, 'rebuild_required');
  const r = await publish(w, c.line, m.manifestUid, null, 'pub-rebuild');
  assert.equal(!r.ok && r.code, 'rebuild_required');
  assert.equal(headOf(w, c.line).h, null);
});

test('2c. the CAS itself refuses a component edited between the checks and the write', async () => {
  const w = world();
  const { c, m } = await ready(w);
  // Simulate the race: the edit lands after evaluation. We edit first and bypass the status check by publishing
  // through #5581 directly with the manifest's approval: the composite swap re-checks every component.
  await revise(w, c.p.video, 'video-v2');
  const h = await advanceHead(w.env, CTX, {
    assetUid: c.line, expectedRevisionUid: null, revisionUid: m.manifestUid, actor: ALICE, idempotencyKey: 'raw',
    approval: { ref: 'approvals:x', contentDigest: m.digest, reviewer: CAROL, decidedAt: '2026-11-18T21:00:00Z' },
  });
  assert.equal(!h.ok && h.code, 'composite_incompatible');
});

test('3. publish approval is bound to digest, audience, profile and authority', async () => {
  const w = world();
  const c = await campaign(w);
  const m = await cut(w, c, 'm1');
  const ev = c.p.evidence.rev;
  const refuse = async (over: Partial<DecideInput>, code: string, profile: ProfileName = 'marketing') => {
    const r = await decideRelease(w.env, CTX, decision(m.manifestUid, m.digest, profile, `bad-${code}-${n++}`, { citations: [ev], ...over }));
    assert.equal(!r.ok && r.code, code, JSON.stringify(r));
  };
  await refuse({ digest: await hex('other bytes') }, 'stale_approval');
  await refuse({ audience: 'public' }, 'audience_forbidden');
  await refuse({ reviewer: { kind: 'agent', agentRunId: 'run_x', onBehalfOfUserId: 13, chargeId: null } }, 'agent_review');
  await refuse({ authority: 'maintainer' }, 'no_authority');
  await refuse({ authority: 'maintainer', reviewer: BOB }, 'no_authority'); // BOB holds maintainer, which marketing does not accept
  await refuse({ reviewer: DAVE }, 'no_authority'); // DAVE holds founder, not brand_owner
  await refuse({ rightsRef: null }, 'approval_incomplete');
  await refuse({ citations: [] }, 'approval_incomplete', 'investor_pitch');
  await refuse({ citations: ['wgr_nope'] }, 'unknown_reference', 'investor_pitch');
  await refuse({ profile: 'protected_data', authority: 'security_officer', reviewer: SAM }, 'policy_profile');
  await refuse({ reviewer: ALICE, authority: 'founder' }, 'self_approval', 'investor_pitch');
  const revoked = await decideRelease(w.env, { ...CTX, revokedUserIds: new Set([13]) }, decision(m.manifestUid, m.digest, 'marketing', 'revoked'));
  assert.equal(!revoked.ok && revoked.code, 'revoked_author');
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_release_decisions'), 0);
});

test('3b. render approval, a withdrawal, a change request and a revoked reviewer do not publish', async () => {
  const w = world();
  const c = await campaign(w);
  const m = await cut(w, c, 'm1');
  const ev = c.p.evidence.rev;
  await approveAll(w, m.manifestUid, m.digest, 'm1', ['code', 'contract', 'investor_pitch'], ev);
  // A render approval of the same digest is a separate decision and never authorizes publication.
  assert.ok((await decideRelease(w.env, CTX, decision(m.manifestUid, m.digest, 'marketing', 'render', { purpose: 'render', renderCeilingMicrousd: 5_000_000 }))).ok);
  let r = await publish(w, c.line, m.manifestUid, null, 'p1');
  assert.equal(!r.ok && r.code, 'approval_required');
  assert.ok(!r.ok && r.ids.includes('marketing'));

  assert.ok((await decideRelease(w.env, CTX, decision(m.manifestUid, m.digest, 'marketing', 'mk'))).ok);
  assert.ok((await decideRelease(w.env, CTX, decision(m.manifestUid, m.digest, 'marketing', 'mk-w', { decision: 'withdraw' }))).ok);
  r = await publish(w, c.line, m.manifestUid, null, 'p2');
  assert.equal(!r.ok && r.code, 'approval_required');

  assert.ok((await decideRelease(w.env, CTX, decision(m.manifestUid, m.digest, 'marketing', 'mk2'))).ok);
  // Revoked after approving: the approval no longer counts at publication time.
  r = await publishRelease(w.env, { ...CTX, revokedUserIds: new Set([13]) }, { lineAssetUid: c.line, manifestUid: m.manifestUid, expectedManifestUid: null, effects: [], actor: ALICE, idempotencyKey: 'p3' });
  assert.equal(!r.ok && r.code, 'approval_required');
  // Authority lost after approving: same.
  r = await publishRelease(w.env, { ...CTX, authorities: new Map([...AUTH, [13, []]]) }, { lineAssetUid: c.line, manifestUid: m.manifestUid, expectedManifestUid: null, effects: [], actor: ALICE, idempotencyKey: 'p4' });
  assert.equal(!r.ok && r.code, 'approval_required');

  assert.ok((await decideRelease(w.env, CTX, decision(m.manifestUid, m.digest, 'contract', 'ct-rc', { decision: 'request_changes' }))).ok);
  r = await publish(w, c.line, m.manifestUid, null, 'p5');
  assert.equal(!r.ok && r.code, 'changes_requested');
  assert.equal(headOf(w, c.line).h, null);
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_effects'), 0);

  assert.ok((await decideRelease(w.env, CTX, decision(m.manifestUid, m.digest, 'contract', 'ct-ok'))).ok);
  r = await publish(w, c.line, m.manifestUid, null, 'p6');
  assert.ok(r.ok, JSON.stringify(r));
});

test('4. no draft or confidential piece reaches a public export', async () => {
  const w = world();
  const deck = await piece(w, 'deck', 'pitch_deck', 'confidential');
  const banner = await piece(w, 'banner', 'image', 'public');
  const pub = await registerReleaseLine(w.env, CTX, { scope: SCOPE, audience: 'public', actor: ALICE, idempotencyKey: 'line-public' });
  assert.ok(pub.ok);
  let r = await cutManifest(w.env, CTX, { lineAssetUid: pub.lineAssetUid, partial: false, author: ALICE, idempotencyKey: 'pm1', components: [
    { assetUid: deck.asset, revisionUid: deck.rev, digest: deck.digest, role: 'deck' },
  ] });
  assert.equal(!r.ok && r.code, 'audience_forbidden');
  // A candidate that never became the banner's head is a draft.
  const draft = await revise(w, banner, 'banner-draft', { approve: false });
  r = await cutManifest(w.env, CTX, { lineAssetUid: pub.lineAssetUid, partial: false, author: ALICE, idempotencyKey: 'pm2', components: [
    { assetUid: banner.asset, revisionUid: draft.rev, digest: draft.digest, role: 'banner' },
  ] });
  assert.equal(!r.ok && r.code, 'composite_incompatible');
  // A pin whose digest is not the revision's.
  r = await cutManifest(w.env, CTX, { lineAssetUid: pub.lineAssetUid, partial: false, author: ALICE, idempotencyKey: 'pm3', components: [
    { assetUid: banner.asset, revisionUid: banner.rev, digest: draft.digest, role: 'banner' },
  ] });
  assert.equal(!r.ok && r.code, 'unpinned_component');
  // A website push needs a public audience.
  const c = await campaign(w);
  const m = await cut(w, c, 'm1');
  await approveAll(w, m.manifestUid, m.digest, 'm1', undefined, c.p.evidence.rev);
  const p = await publish(w, c.line, m.manifestUid, null, 'pub-cdn', CTX, [{ target: 'website_cdn', ref: 'acme.example' }]);
  assert.equal(!p.ok && p.code, 'effect_target');
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_release_manifests WHERE line_asset_uid = ?', pub.lineAssetUid), 0);
});

test('5. every operation refuses another tenant', async () => {
  const w = world();
  const { c, m } = await ready(w);
  const st = await releaseStatus(w.env, OTHER_CTX, m.manifestUid);
  assert.equal(!st.ok && st.code, 'wrong_tenant');
  const pb = await publishedRelease(w.env, OTHER_CTX, c.line);
  assert.equal(!pb.ok && pb.code, 'wrong_tenant');
  const cm = await cutManifest(w.env, OTHER_CTX, { lineAssetUid: c.line, components: c.components(), partial: false, author: ALICE, idempotencyKey: 'x' });
  assert.equal(!cm.ok && cm.code, 'wrong_tenant');
  const dc = await decideRelease(w.env, OTHER_CTX, decision(m.manifestUid, m.digest, 'code', 'x'));
  assert.equal(!dc.ok && dc.code, 'wrong_tenant');
  const at = await attestComponent(w.env, OTHER_CTX, { revisionUid: c.p.website.rev, digest: c.p.website.digest, requirement: 'ci_passed', evidenceRef: 'ci:1', actor: CI, idempotencyKey: 'x' });
  assert.equal(!at.ok && at.code, 'wrong_tenant');
  const pu = await publish(w, c.line, m.manifestUid, null, 'x', OTHER_CTX);
  assert.equal(!pu.ok && pu.code, 'wrong_tenant');
  const ln = await registerReleaseLine(w.env, OTHER_CTX, { scope: SCOPE, audience: 'investors', actor: ALICE, idempotencyKey: 'x' });
  assert.equal(!ln.ok && ln.code, 'wrong_tenant');
  // Another tenant's accepted piece cannot be pinned into this tenant's manifest.
  const foreign = await piece(w, 'foreign', 'image', 'internal', { scope: OTHER, ctx: OTHER_CTX });
  const fm = await cutManifest(w.env, CTX, { lineAssetUid: c.line, partial: true, author: ALICE, idempotencyKey: 'fm', components: [
    { assetUid: foreign.asset, revisionUid: foreign.rev, digest: foreign.digest, role: 'graphics' },
  ] });
  assert.equal(!fm.ok && fm.code, 'wrong_tenant');
  assert.equal(headOf(w, c.line).h, null);
});

test('6. a replayed or stale webhook cannot publish twice or roll the pointer back', async () => {
  const w = world();
  const { c, m } = await ready(w);
  const first = await publish(w, c.line, m.manifestUid, null, 'hook-1');
  assert.ok(first.ok);
  const again = await publish(w, c.line, m.manifestUid, null, 'hook-1');
  assert.ok(again.ok && again.replayed);
  assert.deepEqual(again.ok && again.effectIds, first.effectIds);
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_effects'), 4);
  // The same delivery key for another publication is refused.
  const m2 = await cut(w, c, 'm2');
  const conflict = await publish(w, c.line, m2.manifestUid, m.manifestUid, 'hook-1');
  assert.equal(!conflict.ok && conflict.code, 'idempotency_conflict');

  await approveAll(w, m2.manifestUid, m2.digest, 'm2', undefined, c.p.evidence.rev);
  const second = await publish(w, c.line, m2.manifestUid, m.manifestUid, 'hook-2');
  assert.ok(second.ok, JSON.stringify(second));
  assert.equal(headOf(w, c.line).h, m2.manifestUid);
  // A late webhook carrying the first release with a fresh key: the CAS refuses, the pointer stays.
  const late = await publish(w, c.line, m.manifestUid, null, 'hook-late');
  assert.equal(!late.ok && late.code, 'stale_revision');
  const late2 = await publish(w, c.line, m.manifestUid, m2.manifestUid, 'hook-late-2');
  assert.equal(!late2.ok && late2.code, 'not_descendant');
  assert.equal(headOf(w, c.line).h, m2.manifestUid);
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_effects'), 8);
});

test('6b. concurrent publishers: exactly one release wins from one base; a doubled delivery queues effects once', async () => {
  const w = world();
  const { c, m } = await ready(w);
  const m2 = await cut(w, c, 'm1b', { partial: true });
  await approveAll(w, m2.manifestUid, m2.digest, 'm1b', undefined, c.p.evidence.rev);
  const [a, b] = await Promise.all([publish(w, c.line, m.manifestUid, null, 'race-a'), publish(w, c.line, m2.manifestUid, null, 'race-b')]);
  assert.equal([a, b].filter((x) => x.ok).length, 1);
  const loser = [a, b].find((x) => !x.ok)!;
  assert.equal(!loser.ok && loser.code, 'stale_revision');
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_effects'), 4);

  const w2 = world();
  const r2 = await ready(w2);
  const [x, y] = await Promise.all([publish(w2, r2.c.line, r2.m.manifestUid, null, 'dup'), publish(w2, r2.c.line, r2.m.manifestUid, null, 'dup')]);
  assert.ok(x.ok && y.ok, JSON.stringify([x, y]));
  assert.equal(count(w2, 'SELECT COUNT(*) AS n FROM work_graph_effects'), 4);
  assert.equal(count(w2, `SELECT COUNT(*) AS n FROM work_graph_events WHERE action = 'advance_head' AND asset_uid = ?`, r2.c.line), 1);
  assert.equal(count(w2, `SELECT COUNT(*) AS n FROM work_graph_integrity_events WHERE action = 'effect_enqueued'`), 4);
});

test('6d. an effect already queued under the same key is neither duplicated nor audited twice', async () => {
  const w = world();
  const { c, m } = await ready(w);
  w.db.prepare(`INSERT INTO work_graph_effects (tenant_id, company_id, effect_kind, idempotency_key, request_hash, payload_json,
    max_attempts, next_attempt_ms, created_at) VALUES (7, 70, 'release_stream', ?, ?, '{}', 5, 0, '2026-11-18T21:00:00Z')`)
    .run(`release:${m.manifestUid}:stream:vid-campaign`, 'f'.repeat(64));
  const r = await publish(w, c.line, m.manifestUid, null, 'pre');
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_effects'), 4);
  assert.equal(count(w, `SELECT COUNT(*) AS n FROM work_graph_integrity_events WHERE action = 'effect_enqueued'`), 3);
});

test('6c. a full outbox refuses the publication before the pointer moves', async () => {
  const w = world();
  const { c, m } = await ready(w);
  const fill = w.db.prepare(`INSERT INTO work_graph_effects (tenant_id, company_id, effect_kind, idempotency_key, request_hash, payload_json,
    max_attempts, next_attempt_ms, created_at) VALUES (7, 70, 'filler', ?, ?, '{}', 5, 0, '2026-11-18T21:00:00Z')`);
  for (let i = 0; i < 997; i++) fill.run(`fill-${i}`, 'f'.repeat(64));
  const r = await publish(w, c.line, m.manifestUid, null, 'full');
  assert.equal(!r.ok && r.code, 'queue_full');
  assert.equal(headOf(w, c.line).h, null);
  assert.equal(count(w, `SELECT COUNT(*) AS n FROM work_graph_effects WHERE effect_kind LIKE 'release_%'`), 0);
  // Room for exactly the four: it publishes.
  const w2 = world();
  const r2 = await ready(w2);
  for (let i = 0; i < 996; i++) w2.db.prepare(`INSERT INTO work_graph_effects (tenant_id, company_id, effect_kind, idempotency_key, request_hash, payload_json,
    max_attempts, next_attempt_ms, created_at) VALUES (7, 70, 'filler', ?, ?, '{}', 5, 0, '2026-11-18T21:00:00Z')`).run(`fill-${i}`, 'f'.repeat(64));
  assert.ok((await publish(w2, r2.c.line, r2.m.manifestUid, null, 'fits')).ok);
});

test('7. domain policy profiles: attestations at the exact digest, by the right authority', async () => {
  const w = world();
  const c = await campaign(w);
  const offer2 = await revise(w, c.p.offer, 'offer-v2');
  const base = { revisionUid: offer2.rev, digest: offer2.digest, evidenceRef: 'review:1' };
  let r = await attestComponent(w.env, CTX, { ...base, digest: c.p.offer.digest, requirement: 'counsel_review', authority: 'counsel', actor: ERIN, idempotencyKey: 'a1' });
  assert.equal(!r.ok && r.code, 'stale_approval');
  r = await attestComponent(w.env, CTX, { ...base, requirement: 'counsel_review', authority: null, actor: CI, idempotencyKey: 'a2' });
  assert.equal(!r.ok && r.code, 'person_required');
  r = await attestComponent(w.env, CTX, { ...base, requirement: 'counsel_review', authority: 'counsel', actor: CAROL, idempotencyKey: 'a3' });
  assert.equal(!r.ok && r.code, 'no_authority');
  r = await attestComponent(w.env, CTX, { ...base, requirement: 'counsel_review', authority: 'counsel', actor: ERIN, idempotencyKey: 'a4' });
  assert.ok(r.ok);
  const replay = await attestComponent(w.env, CTX, { ...base, requirement: 'counsel_review', authority: 'counsel', actor: ERIN, idempotencyKey: 'a4' });
  assert.ok(replay.ok && replay.replayed);
  const clash = await attestComponent(w.env, CTX, { ...base, requirement: 'signing_authority', authority: 'counsel', actor: ERIN, idempotencyKey: 'a4' });
  assert.equal(!clash.ok && clash.code, 'idempotency_conflict');

  // The new offer revision has counsel review but no signing authority yet.
  const m = await cut(w, { ...c, components: () => c.components({ ...c.p, offer: offer2 }) }, 'm-offer2');
  await approveAll(w, m.manifestUid, m.digest, 'mo', undefined, c.p.evidence.rev);
  const p = await publish(w, c.line, m.manifestUid, null, 'po');
  assert.equal(!p.ok && p.code, 'attestation_missing');
  assert.deepEqual(!p.ok && p.ids, [c.p.offer.asset, 'signing_authority']);
  // A kind may only declare its own profiles.
  const bad = await cutManifest(w.env, CTX, { lineAssetUid: c.line, partial: true, author: ALICE, idempotencyKey: 'bad', components: [
    { assetUid: c.p.website.asset, revisionUid: c.p.website.rev, digest: c.p.website.digest, role: 'website', profile: 'marketing' },
  ] });
  assert.equal(!bad.ok && bad.code, 'policy_profile');
});

test('7b. protected data adds residency and security review and a security officer approval', async () => {
  const w = world();
  const data = await piece(w, 'cap-table', 'document', 'restricted');
  await attestAll(w, data, ['contract']);
  const line = await registerReleaseLine(w.env, CTX, { scope: SCOPE, audience: 'internal', actor: ALICE, idempotencyKey: 'line-int' });
  assert.ok(line.ok);
  const m = await cutManifest(w.env, CTX, { lineAssetUid: line.lineAssetUid, partial: false, author: ALICE, idempotencyKey: 'mi', components: [
    { assetUid: data.asset, revisionUid: data.rev, digest: data.digest, role: 'cap_table', profile: 'contract' },
  ] });
  assert.ok(m.ok);
  const st = await releaseStatus(w.env, CTX, m.manifestUid);
  assert.ok(st.ok);
  assert.deepEqual(st.release.components[0].profiles, ['contract', 'protected_data']);
  assert.deepEqual(st.release.components[0].missingAttestations, ['residency_review', 'security_review']);
  for (const prof of ['contract'] as const) assert.ok((await decideRelease(w.env, CTX, decision(m.manifestUid, m.digest, prof, 'pi', {}, 'internal'))).ok);
  let p = await publish(w, line.lineAssetUid, m.manifestUid, null, 'pp', CTX, []);
  assert.equal(!p.ok && p.code, 'attestation_missing');
  await attestAll(w, data, ['protected_data']);
  p = await publish(w, line.lineAssetUid, m.manifestUid, null, 'pp2', CTX, []);
  assert.equal(!p.ok && p.code, 'approval_required');
  assert.deepEqual(!p.ok && p.ids, [m.manifestUid, 'protected_data']);
  assert.ok((await decideRelease(w.env, CTX, decision(m.manifestUid, m.digest, 'protected_data', 'ps', {}, 'internal'))).ok);
  p = await publish(w, line.lineAssetUid, m.manifestUid, null, 'pp3', CTX, []);
  assert.ok(p.ok, JSON.stringify(p));
});

test('7c. a full package cannot drop a published piece; a partial one can; component bytes must have been approved', async () => {
  const w = world();
  const { c, m } = await ready(w);
  assert.ok((await publish(w, c.line, m.manifestUid, null, 'p1')).ok);
  const { video: _v, ...rest } = c.p;
  const drop = await cutManifest(w.env, CTX, { lineAssetUid: c.line, components: c.components(rest as any), partial: false, author: ALICE, idempotencyKey: 'drop' });
  assert.equal(!drop.ok && drop.code, 'incomplete_package');
  assert.deepEqual(!drop.ok && drop.ids, [c.p.video.asset]);
  const part = await cutManifest(w.env, CTX, { lineAssetUid: c.line, components: c.components(rest as any), partial: true, author: ALICE, idempotencyKey: 'part' });
  assert.ok(part.ok && part.baseManifestUid === m.manifestUid);
  // A cut replays by its key, and the same key with other pins is refused.
  const again = await cutManifest(w.env, CTX, { lineAssetUid: c.line, components: c.components(rest as any), partial: true, author: ALICE, idempotencyKey: 'part' });
  assert.ok(again.ok && again.replayed && again.manifestUid === (part.ok && part.manifestUid));
  const other = await cutManifest(w.env, CTX, { lineAssetUid: c.line, components: c.components(), partial: true, author: ALICE, idempotencyKey: 'part' });
  assert.equal(!other.ok && other.code, 'idempotency_conflict');

  // A head that moved without a person's approval of its bytes cannot be released (D5579 unapproved_release).
  const w2 = world();
  const c2 = await campaign(w2);
  const graphics2 = await revise(w2, c2.p.graphics, 'graphics-v2', { approve: false });
  const moved = await advanceHead(w2.env, CTX, { assetUid: graphics2.asset, expectedRevisionUid: c2.p.graphics.rev, revisionUid: graphics2.rev, actor: ALICE, idempotencyKey: 'adv-g2' });
  assert.ok(moved.ok);
  await attestAll(w2, graphics2, ['marketing']);
  const m2 = await cut(w2, { ...c2, components: () => c2.components({ ...c2.p, graphics: graphics2 }) }, 'mg');
  await approveAll(w2, m2.manifestUid, m2.digest, 'mg', undefined, c2.p.evidence.rev);
  const p = await publish(w2, c2.line, m2.manifestUid, null, 'pg');
  assert.equal(!p.ok && p.code, 'unapproved_release');
  assert.equal(headOf(w2, c2.line).h, null);
});

test('8. the release tables are append-only and a line keeps its audience', async () => {
  const w = world();
  const { c, m } = await ready(w);
  for (const sql of [
    `UPDATE work_graph_release_manifests SET partial = 1`, `DELETE FROM work_graph_release_manifests`,
    `UPDATE work_graph_release_decisions SET decision = 'reject'`, `DELETE FROM work_graph_release_decisions`,
    `UPDATE work_graph_release_attestations SET evidence_ref = 'x'`, `DELETE FROM work_graph_release_attestations`,
    `UPDATE work_graph_release_lines SET audience = 'public'`, `DELETE FROM work_graph_release_lines`,
  ]) assert.throws(() => w.db.exec(sql), /D5585/, sql);
  const again = await registerReleaseLine(w.env, CTX, { scope: SCOPE, audience: 'investors', actor: ALICE, idempotencyKey: 'line-investors' });
  assert.ok(again.ok && again.replayed && again.lineAssetUid === c.line);
  const clash = await registerReleaseLine(w.env, CTX, { scope: SCOPE, audience: 'partners', actor: ALICE, idempotencyKey: 'line-investors' });
  assert.equal(!clash.ok && clash.code, 'idempotency_conflict');
  const st = await releaseStatus(w.env, CTX, m.manifestUid);
  assert.ok(st.ok && st.cost.d1Statements >= 5);
});
