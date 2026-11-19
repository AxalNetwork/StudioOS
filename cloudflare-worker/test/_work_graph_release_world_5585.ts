/**
 * D5585 part 2 (#5585): the shared world of the release takedown and delivery tests — one real SQLite database built
 * from the #5581 migrations and both #5585 migrations, the synthetic venture campaign of part 1, a clock every service
 * reads (D5614), and fake delivery adapters that record each call and never reach a provider.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1 } from './_d1_sqlite.mjs';
import { sha256Hex, type Actor, type AssetKind, type AccessClass, type Scope, type SourceRef } from '../src/services/workGraphContracts.ts';
import { WORK_GRAPH_DEPS, advanceHead, createRevision, registerAsset } from '../src/services/workGraphRevisions.ts';
import { WORK_GRAPH_BLOB_DEPS } from '../src/services/workGraphBlobs.ts';
import { WORK_GRAPH_EFFECT_DEPS } from '../src/services/workGraphEffects.ts';
import {
  attestComponent, cutManifest, decideRelease, publishRelease, registerReleaseLine,
  type Audience, type DecideInput, type ManifestComponentInput, type ProfileName, type ReleaseContext, type Requirement,
} from '../src/services/workGraphReleases.ts';
import type { ReleaseDeliveryAdapter, ReleaseDeliveryReceipt, ReleaseDeliveryRequest } from '../src/services/workGraphReleaseDelivery.ts';

const read = (f: string) => readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8');
export const SCHEMA = read('202611140007_5581_work_graph_revisions.sql') + read('202611140122_5581_work_graph_lease_events.sql')
  + read('202611140924_5581_work_graph_integrity.sql') + read('202611182125_5585_work_graph_releases.sql')
  + read('202611190940_5585_work_graph_release_takedowns.sql');

export const T0 = Date.parse('2026-11-19T09:40:00Z');
export const clock = { t: T0 };
WORK_GRAPH_DEPS.now = () => new Date(clock.t);
WORK_GRAPH_BLOB_DEPS.now = () => new Date(clock.t);
let n = 0;
WORK_GRAPH_DEPS.newId = () => `id${++n}`;
WORK_GRAPH_EFFECT_DEPS.newToken = () => `tok${++n}`;
export const uniq = () => ++n;

export const SCOPE: Scope = { tenantId: 7, companyId: 70, projectId: 700 };
export const OTHER: Scope = { tenantId: 8, companyId: 80, projectId: 800 };
export const ALICE: Actor = { kind: 'person', userId: 11 }; // author
export const BOB: Actor = { kind: 'person', userId: 12 }; // maintainer
export const CAROL: Actor = { kind: 'person', userId: 13 }; // brand owner
export const DAVE: Actor = { kind: 'person', userId: 14 }; // founder
export const ERIN: Actor = { kind: 'person', userId: 15 }; // counsel
export const SAM: Actor = { kind: 'person', userId: 16 }; // security officer
export const NOBODY: Actor = { kind: 'person', userId: 17 }; // no authority
export const CI: Actor = { kind: 'agent', agentRunId: 'run_ci', onBehalfOfUserId: 12, chargeId: null };
export const AUTH = new Map<number, string[]>([
  [11, ['founder']], [12, ['maintainer']], [13, ['brand_owner']], [14, ['founder']], [15, ['counsel', 'authorized_signatory']], [16, ['security_officer']],
]);
export const CTX: ReleaseContext = { scope: { tenantId: 7, companyId: 70, projectId: null }, authorities: AUTH };
export const OTHER_CTX: ReleaseContext = { scope: { tenantId: 8, companyId: 80, projectId: null }, authorities: AUTH };
export const hex = (s: string) => sha256Hex(new TextEncoder().encode(s));

export function world() {
  clock.t = T0;
  const { DB, db } = makeD1(SCHEMA);
  return { env: { DB } as any, db };
}
export type W = ReturnType<typeof world>;
export const count = (w: W, sql: string, ...b: any[]) => Number((w.db.prepare(sql).get(...b) as any).n);
export const headOf = (w: W, a: string) => (w.db.prepare('SELECT head_revision_uid AS h, head_seq AS s FROM work_graph_assets WHERE asset_uid = ?').get(a) as any);

export interface Piece { asset: string; rev: string; digest: string; key: string; kind: AssetKind; source: SourceRef }

const SOURCES: Record<string, (k: string) => SourceRef> = {
  code: (k) => ({ store: 'git', locator: 'acme/site', id: 'main', revision: (k.length.toString(16) + 'a'.repeat(40)).slice(0, 40) }),
  image: (k) => ({ store: 'r2_object', locator: 'COMPANY_LOGOS', id: `graphics/${k}`, revision: k }),
  video: (k) => ({ store: 'stream', locator: 'stream', id: `vid-${k}`, revision: k }),
  pitch_deck: (k) => ({ store: 'd1_record', locator: 'pitch_decks', id: '41', revision: k }),
  offer: (k) => ({ store: 'd1_record', locator: 'quote_versions', id: '9', revision: k }),
  document: (k) => ({ store: 'd1_record', locator: 'documents', id: k, revision: k }),
};

export async function piece(w: W, key: string, kind: AssetKind, access: AccessClass, opts: { deps?: Piece[]; scope?: Scope; ctx?: ReleaseContext } = {}): Promise<Piece> {
  const ctx = opts.ctx ?? CTX;
  const a = await registerAsset(w.env, ctx, { scope: opts.scope ?? SCOPE, kind, accessClass: access, approvalPolicy: 'team_review', actor: ALICE, idempotencyKey: `asset-${key}` });
  assert.ok(a.ok, JSON.stringify(a));
  return revise(w, { asset: a.assetUid, rev: '', digest: '', key, kind, source: SOURCES[kind](key) }, `${key}-v1`, opts);
}
/** A new accepted head, approved by BOB at its exact bytes. */
export async function revise(w: W, p: Piece, key: string, opts: { deps?: Piece[]; ctx?: ReleaseContext } = {}): Promise<Piece> {
  const ctx = opts.ctx ?? CTX;
  const digest = await hex(key);
  const source = SOURCES[p.kind](key);
  const r = await createRevision(w.env, ctx, {
    assetUid: p.asset, parents: p.rev ? [p.rev] : [], digest, byteLength: 10, mediaProfile: 'application/octet-stream', source,
    author: ALICE, idempotencyKey: `rev-${key}`,
    dependencies: (opts.deps ?? []).map((d) => ({ kind: 'derived' as const, assetUid: d.asset, revisionUid: d.rev })),
  });
  assert.ok(r.ok, JSON.stringify(r));
  const h = await advanceHead(w.env, ctx, {
    assetUid: p.asset, expectedRevisionUid: p.rev || null, revisionUid: r.revisionUid, actor: ALICE, idempotencyKey: `adv-${key}`,
    approval: { ref: `approvals:item-${key}`, contentDigest: digest, reviewer: BOB, decidedAt: '2026-11-19T09:00:00Z' },
  });
  assert.ok(h.ok, JSON.stringify(h));
  return { ...p, rev: r.revisionUid, digest, key, source };
}

const ATTEST: Record<ProfileName, [Requirement, Actor, string | null][]> = {
  code: [['pr_validated', CI, null], ['ci_passed', CI, null]],
  marketing: [['brand_rights', CAROL, 'brand_owner'], ['claims_review', CAROL, 'brand_owner']],
  investor_pitch: [['evidence_review', DAVE, 'founder']],
  contract: [['counsel_review', ERIN, 'counsel'], ['signing_authority', ERIN, 'authorized_signatory']],
  protected_data: [['residency_review', SAM, 'security_officer'], ['security_review', SAM, 'security_officer']],
};
export async function attestAll(w: W, p: Piece, profiles: ProfileName[]) {
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
export function decision(manifestUid: string, digest: string, profile: ProfileName, key: string, over: Partial<DecideInput> = {}, audience: Audience = 'investors'): DecideInput {
  const [reviewer, authority] = REVIEWER[profile];
  return {
    manifestUid, digest, audience, purpose: 'publish', profile, authority, decision: 'approve', reviewer, approvalRef: `approvals:${key}`,
    citations: [], disclosureRef: 'disclosure:forward-looking-v2', rightsRef: 'rights:brand-licence-2026', idempotencyKey: `dec-${key}`, ...over,
  };
}

export const PROFILE = {
  website: 'code', graphics: 'marketing', deck: 'investor_pitch', offer: 'contract', copy: 'marketing', captions: 'marketing',
  video: 'marketing', evidence: 'investor_pitch',
} as const satisfies Record<string, ProfileName>;
export type Role = keyof typeof PROFILE;
export type Pieces = Record<Role, Piece>;

/** The synthetic venture campaign of part 1: every piece accepted, approved and attested; a line for investors. */
export async function campaign(w: W, lineKey = 'line-investors') {
  const glossary = await piece(w, 'glossary', 'document', 'internal');
  const p: Pieces = {
    website: await piece(w, 'website', 'code', 'internal'),
    graphics: await piece(w, 'graphics', 'image', 'confidential'),
    deck: await piece(w, 'deck', 'pitch_deck', 'confidential'),
    offer: await piece(w, 'offer', 'offer', 'confidential'),
    copy: await piece(w, 'copy', 'document', 'internal'),
    captions: await piece(w, 'captions', 'document', 'internal', { deps: [glossary] }),
    video: await piece(w, 'video', 'video', 'confidential'),
    evidence: await piece(w, 'evidence', 'document', 'confidential'),
  };
  for (const k of Object.keys(p) as Role[]) await attestAll(w, p[k], [PROFILE[k]]);
  const line = await newLine(w, lineKey);
  return { p, glossary, line };
}
export type Campaign = Awaited<ReturnType<typeof campaign>>;

export async function newLine(w: W, key: string, audience: Audience = 'investors') {
  const line = await registerReleaseLine(w.env, CTX, { scope: SCOPE, audience, actor: ALICE, idempotencyKey: key });
  assert.ok(line.ok, JSON.stringify(line));
  return line.lineAssetUid;
}
export const components = (pieces: Partial<Pieces>): ManifestComponentInput[] => (Object.keys(pieces) as Role[]).map((k) => ({
  assetUid: pieces[k]!.asset, revisionUid: pieces[k]!.rev, digest: pieces[k]!.digest, role: k, profile: PROFILE[k],
}));

/** Cut a full manifest of `pieces` on `line` and approve it for every profile it holds. */
export async function approvedManifest(w: W, line: string, pieces: Partial<Pieces>, key: string, evidenceRev: string) {
  const m = await cutManifest(w.env, CTX, { lineAssetUid: line, components: components(pieces), partial: false, author: ALICE, idempotencyKey: key });
  assert.ok(m.ok, JSON.stringify(m));
  await approve(w, m.manifestUid, m.digest, key, [...new Set((Object.keys(pieces) as Role[]).map((k) => PROFILE[k]))], evidenceRev);
  return m;
}
export async function approve(w: W, manifestUid: string, digest: string, key: string, profiles: ProfileName[], evidenceRev: string) {
  for (const prof of profiles) {
    const r = await decideRelease(w.env, CTX, decision(manifestUid, digest, prof, `${key}-${prof}`, prof === 'investor_pitch' ? { citations: [evidenceRev] } : {}));
    assert.ok(r.ok, JSON.stringify(r));
  }
}

export const EFFECTS = [
  { target: 'github_pr' as const, ref: 'acme/site#12' }, { target: 'stream' as const, ref: 'vid-campaign' },
  { target: 'signed_document' as const, ref: 'envelope-77' }, { target: 'external_distribution' as const, ref: 'investor-list-1' },
];
export function publish(w: W, line: string, manifestUid: string, expected: string | null, key: string, ctx: ReleaseContext = CTX, effects = EFFECTS) {
  return publishRelease(w.env, ctx, { lineAssetUid: line, manifestUid, expectedManifestUid: expected, effects, actor: ALICE, idempotencyKey: key });
}

/** A campaign whose first manifest is published, with its four effects queued. */
export async function published(w: W) {
  const c = await campaign(w);
  const m = await approvedManifest(w, c.line, c.p, 'm1', c.p.evidence.rev);
  const r = await publish(w, c.line, m.manifestUid, null, 'pub-m1');
  assert.ok(r.ok, JSON.stringify(r));
  return { c, m, effectIds: r.effectIds };
}

/**
 * A fake provider. It keeps what it holds by idempotency key and records every call. `onSend` may change what a send
 * does (throw after accepting, answer `accepted`, run a takedown while in flight).
 */
export class FakeProvider implements ReleaseDeliveryAdapter {
  held = new Map<string, ReleaseDeliveryReceipt>();
  calls: { fn: 'lookup' | 'send'; req: ReleaseDeliveryRequest }[] = [];
  onSend: ((req: ReleaseDeliveryRequest, self: FakeProvider) => Promise<ReleaseDeliveryReceipt>) | null = null;
  async lookup(req: ReleaseDeliveryRequest): Promise<ReleaseDeliveryReceipt> {
    this.calls.push({ fn: 'lookup', req });
    return this.held.get(req.idempotencyKey) ?? { status: 'absent' };
  }
  async send(req: ReleaseDeliveryRequest): Promise<ReleaseDeliveryReceipt> {
    this.calls.push({ fn: 'send', req });
    if (this.onSend) return this.onSend(req, this);
    const r: ReleaseDeliveryReceipt = { status: 'confirmed', externalRef: `ext-${req.op}-${this.held.size + 1}` };
    this.held.set(req.idempotencyKey, r);
    return r;
  }
  sends(op?: 'publish' | 'retract') { return this.calls.filter((c) => c.fn === 'send' && (!op || c.req.op === op)).length; }
}
export function providers() {
  return { github_pr: new FakeProvider(), stream: new FakeProvider(), signed_document: new FakeProvider(), website_cdn: new FakeProvider(), external_distribution: new FakeProvider() };
}
export const allCalls = (ps: ReturnType<typeof providers>) => Object.values(ps).reduce((s, p) => s + p.calls.length, 0);
