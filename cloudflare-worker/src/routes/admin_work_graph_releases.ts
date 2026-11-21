/**
 * D5585 part 7 (#5585): the Super-Admin WorkGraph release routes, mounted at /api/admin/work-graph/releases. OFF BY
 * DEFAULT (the owner's answer of 2026-11-21): unless `WORK_GRAPH_RELEASE_ADMIN` is exactly `on`, every route refuses
 * 404 `release_admin_off` before it reads a session or anything else in D1. Decision:
 * `documentation/architecture/decisions/D5585-p7.md`.
 *
 * Every route names the scope it acts in (`tenant_id`, `company_id`; query on reads, body on writes). A line or a
 * manifest of another scope is refused `wrong_tenant` by the part 1 and part 2 services.
 *
 *   GET  /lines?tenant_id&company_id                   the scope's release lines and what each one's pointer names
 *   GET  /lines/:line?tenant_id&company_id             the published release (evaluated), what the line may serve, its manifests
 *   GET  /manifests/:manifest?tenant_id&company_id     one manifest's evaluation: every pinned piece, what it owes, what it lacks
 *   GET  /deliveries?tenant_id&company_id[&state][&manifest]   the release outbox: each effect's state and delivery row
 *   POST /manifests/:manifest/publish   { tenant_id, company_id, digest, expected_manifest_uid, effects: [{ target, ref }], idempotency_key }
 *   POST /manifests/:manifest/takedown  { tenant_id, company_id, digest, component?: { revision_uid, digest }, reason_code, evidence_ref, authority, idempotency_key }
 *   POST /lines/:line/repin             { tenant_id, company_id, target_manifest_uid, expected_manifest_uid, idempotency_key }
 *   POST /drain                         { limit? }   one bounded drain of the release outbox (at most 25 effects)
 *   GET  /authorities?tenant_id&company_id[&user_id][&history=1]   part 8: who holds which release authority, and the history
 *   POST /authorities/grant             { tenant_id, company_id, user_id, authority, reason, expected_seq, idempotency_key }
 *   POST /authorities/revoke            { tenant_id, company_id, user_id, authority, reason, expected_seq, idempotency_key }
 *
 * GATES. Reads: `requireSuperAdmin` (HQ only). Writes and the drain: `requireSuperAdminWriteBar` (a TOTP session, a
 * recent step-up, then the elevation). Every write is recorded with the actor through `logAdminAction`, whatever its
 * outcome, beside the services' own audit rows (`advance_head` / `advance_refused` events, the takedown table, the
 * outbox's integrity events).
 *
 * STALE WRITES. A publish and a takedown carry the digest the Super Admin saw (`stale_approval` otherwise); a publish
 * carries the manifest it expects the pointer to name (the CAS refuses `stale_revision`); a re-pin carries the head it
 * saw (`stale_revision`, with the current head).
 *
 * The drain delivers only while `WORK_GRAPH_RELEASE_DELIVERY` is `preview` (409 `release_delivery_off` otherwise).
 *
 * RELEASE AUTHORITIES (part 8, D5585-p8). Publish and takedown resolve every person's authorities in the named scope
 * from the per-company store (`workGraphReleaseAuthorities.ts`): an approval counts only while its reviewer holds the
 * authority it was given under, and a takedown only with an authority the acting Super Admin holds. Being a Super
 * Admin grants none by itself. A Super Admin grants and revokes them here, to people linked to the company, with the
 * `seq` they saw; each write is an admin audit row beside the store's own event row.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';
import type { Actor, Scope } from '../services/workGraphContracts';
import type { Cost } from '../services/workGraphRevisions';
import {
  Meter, outOfScope, publishRelease, publishedRelease, readLine, readManifest, releaseStatus, scopeOf,
  type PublishEffect, type ReleaseRefusal,
} from '../services/workGraphReleases';
import { repinRelease, servedRelease, takedownRelease, type TakedownReason } from '../services/workGraphReleaseTakedowns';
import { drainReleaseEffects } from '../services/workGraphReleaseAdapters';
import {
  RELEASE_AUTHORITIES, grantReleaseAuthority, listReleaseAuthorityGrants, revokeReleaseAuthority,
} from '../services/workGraphReleaseAuthorities';
import {
  EFFECT_STATES, RELEASE_DRAIN_LIMITS, listLimit, listLineManifests, listReleaseDeliveries, listReleaseLines,
  releaseAdminContext, releaseAdminEnabled, scopeFrom, summariseDrain,
} from '../services/workGraphReleaseAdmin';

const r = new Hono<{ Bindings: Env }>();

const OFF_MESSAGE = 'WorkGraph release administration is not enabled on this deployment.';

// The flag is read before anything else, the session included: off, no route reads D1.
r.use('*', async (c, next) => {
  if (!releaseAdminEnabled(c.env)) return refuse(c, 404, { code: 'release_admin_off', message: OFF_MESSAGE });
  await next();
});

/** Our sentence for each refusal code the release services send. */
const SENTENCES: Record<string, string> = {
  malformed: 'The request is missing a field or has one in the wrong shape.',
  not_found: 'No such release line or manifest.',
  wrong_tenant: 'That release belongs to another tenant or company than the one this request names.',
  unknown_reference: 'The request names a manifest, line or revision that does not belong to this release.',
  stale_approval: 'The digest you reviewed is not this manifest’s digest any more. Reload the release and review it again.',
  stale_revision: 'The line’s publication pointer has moved since you loaded it. Reload the line and try again.',
  idempotency_conflict: 'This idempotency key was already used for a different request.',
  composite_incompatible: 'A pinned piece stopped being its asset’s accepted head while the release was being published.',
  audience_forbidden: 'A pinned piece may not be shown to this line’s audience.',
  rebuild_required: 'A pinned piece is out of date and must be rebuilt before this release can go out.',
  reapproval_required: 'A pinned piece changed and must be approved again before this release can go out.',
  attestation_missing: 'A pinned piece lacks the evidence its policy profile requires.',
  approval_required: 'A policy profile in this manifest has no live publish approval of this digest.',
  changes_requested: 'A reviewer’s latest decision on this manifest asks for changes.',
  no_authority: 'Nobody in this request holds the authority this act needs.',
  effect_target: 'This release cannot be delivered to one of the targets named.',
  queue_full: 'The tenant’s release outbox is full. Wait for the drain to catch up.',
  taken_down: 'A takedown covers this release or one of its pieces, so it cannot go out again.',
  not_published: 'Only a manifest this line has published can be re-pinned.',
  is_head: 'That manifest is already what the line’s pointer names.',
  tombstoned: 'A pinned piece was tombstoned and cannot be re-pinned.',
  person_required: 'Only a person can do this.',
  revoked_author: 'The person acting has been revoked.',
  unpinned_component: 'A pinned piece no longer matches the digest the manifest records.',
  unapproved_release: 'A pinned piece’s bytes were not approved by a person when they became its head.',
  unknown_authority: 'That is not a release authority. Name one of the authorities the release policy uses.',
  not_member: 'That person is not linked to this company, so they cannot hold its release authorities.',
  already_held: 'That person already holds this release authority in this company.',
  not_held: 'That person does not hold this release authority in this company, so there is nothing to revoke.',
};
const STATUS: Record<string, number> = { malformed: 400, unknown_authority: 400, not_found: 404, wrong_tenant: 403, queue_full: 503 };

function refused(c: Context, x: { code: string; ids?: string[]; cost?: Cost; currentHead?: unknown; current?: unknown }) {
  return refuse(c, STATUS[x.code] ?? 409, {
    code: x.code,
    message: SENTENCES[x.code] ?? 'The release service refused this request.',
    extra: {
      ids: x.ids ?? [], ...(x.cost ? { cost: x.cost } : {}), ...(x.currentHead ? { current_head: x.currentHead } : {}),
      ...(x.current ? { current: x.current } : {}),
    },
  });
}
const badScope = (c: Context) => refuse(c, 400, { code: 'malformed', message: 'Name the scope this acts in: tenant_id and company_id, both positive integers.' });
const HEX64 = /^[0-9a-f]{64}$/;
const UID = /^[A-Za-z0-9_:.-]{1,80}$/;
const addCost = (a: Cost, b: Cost): Cost => ({ d1Statements: a.d1Statements + b.d1Statements, d1Batches: a.d1Batches + b.d1Batches });

async function body(c: Context): Promise<Record<string, any> | null> {
  try {
    const b = await c.req.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
  } catch { return null; }
}
const queryScope = (c: Context): Scope | null => scopeFrom(c.req.query('tenant_id'), c.req.query('company_id'));

async function audit(c: Context<{ Bindings: Env }>, user: { id: number; email?: string | null }, action: string, details: Record<string, unknown>) {
  await logAdminAction(c.env, Number(user.id), String(user.email ?? ''), action, details);
}

// ---------------------------------------------------------------------------------------------------------------------
// Reads

r.get('/lines', async (c) => {
  await requireSuperAdmin(c);
  const scope = queryScope(c);
  if (!scope) return badScope(c);
  return c.json({ ok: true, scope, ...(await listReleaseLines(c.env, scope, listLimit(c.req.query('limit')))) });
});

r.get('/deliveries', async (c) => {
  await requireSuperAdmin(c);
  const scope = queryScope(c);
  if (!scope) return badScope(c);
  const state = c.req.query('state') ?? null;
  if (state !== null && !(EFFECT_STATES as readonly string[]).includes(state)) {
    return refuse(c, 400, { code: 'malformed', message: 'state is one of pending, claimed, applied or dead.' });
  }
  const manifest = c.req.query('manifest') ?? null;
  if (manifest !== null && !UID.test(manifest)) return refuse(c, 400, { code: 'malformed', message: 'manifest is a manifest uid.' });
  return c.json({ ok: true, scope, ...(await listReleaseDeliveries(c.env, scope, { state, manifestUid: manifest, limit: listLimit(c.req.query('limit')) })) });
});

r.get('/lines/:line', async (c) => {
  await requireSuperAdmin(c);
  const scope = queryScope(c);
  if (!scope) return badScope(c);
  const ctx = await releaseAdminContext(c.env, scope);
  const line = c.req.param('line');
  const pub = await publishedRelease(c.env, ctx, line);
  if (!pub.ok) return refused(c, pub);
  const served = await servedRelease(c.env, ctx, line);
  if (!served.ok) return refused(c, served);
  const list = await listLineManifests(c.env, scope, line, listLimit(c.req.query('limit')));
  return c.json({
    ok: true, scope, lineAssetUid: line, headSeq: pub.headSeq, published: pub.release, served: served.served, withheld: served.withheld,
    manifests: list.manifests, cost: addCost(addCost(pub.cost, served.cost), list.cost),
  });
});

r.get('/manifests/:manifest', async (c) => {
  await requireSuperAdmin(c);
  const scope = queryScope(c);
  if (!scope) return badScope(c);
  const s = await releaseStatus(c.env, await releaseAdminContext(c.env, scope), c.req.param('manifest'));
  if (!s.ok) return refused(c, s);
  return c.json({ ok: true, scope, release: s.release, cost: s.cost });
});

// ---------------------------------------------------------------------------------------------------------------------
// Writes

/** The manifest a write names, in the request's scope. A manifest of another scope is `wrong_tenant`. */
async function manifestInScope(env: Env, scope: Scope, uid: string) {
  const m = new Meter(env);
  const man = UID.test(uid) ? await readManifest(env, m, uid) : null;
  return { man, cost: m.cost, foreign: !!man && outOfScope({ scope }, scopeOf(man)) };
}

r.post('/manifests/:manifest/publish', async (c) => {
  const user = await requireSuperAdminWriteBar(c);
  const b = await body(c);
  const scope = b && scopeFrom(b.tenant_id, b.company_id);
  if (!b || !scope) return badScope(c);
  const uid = c.req.param('manifest');
  if (!HEX64.test(String(b.digest)) || !Array.isArray(b.effects) || (b.expected_manifest_uid !== null && typeof b.expected_manifest_uid !== 'string')
    || typeof b.idempotency_key !== 'string') {
    return refuse(c, 400, { code: 'malformed', message: 'A publish names the digest you reviewed, the manifest you expect the pointer to name (or null), its effects and an idempotency key.' });
  }
  const { man, cost, foreign } = await manifestInScope(c.env, scope, uid);
  const base = { tenant_id: scope.tenantId, company_id: scope.companyId, manifest_uid: uid, digest: b.digest, idempotency_key: b.idempotency_key };
  const out = async (outcome: string, extra: Record<string, unknown> = {}) => audit(c, user, 'work_graph_release_publish', { ...base, outcome, ...extra });
  if (!man) { await out('not_found'); return refused(c, { code: 'not_found', ids: [uid], cost }); }
  if (foreign) { await out('wrong_tenant'); return refused(c, { code: 'wrong_tenant', ids: [uid], cost }); }
  // The digest the Super Admin reviewed: a manifest's digest never changes, so another one is a stale view.
  if (b.digest !== man.manifest_digest) { await out('stale_approval'); return refused(c, { code: 'stale_approval', ids: [uid, b.digest], cost }); }
  const actor: Actor = { kind: 'person', userId: Number(user.id) };
  const effects: PublishEffect[] = b.effects.map((e: any) => ({ target: e?.target, ref: e?.ref }));
  const res = await publishRelease(c.env, await releaseAdminContext(c.env, scope), {
    lineAssetUid: man.line_asset_uid, manifestUid: uid, expectedManifestUid: b.expected_manifest_uid, effects, actor, idempotencyKey: b.idempotency_key,
  });
  const total = addCost(cost, res.cost);
  if (!res.ok) { await out(res.code, { ids: res.ids.slice(0, 20) }); return refused(c, { ...res, cost: total }); }
  await out('published', { previous_manifest_uid: res.previousManifestUid, head_seq: res.headSeq, effect_ids: res.effectIds, replayed: res.replayed });
  return c.json({ ...res, cost: total });
});

r.post('/manifests/:manifest/takedown', async (c) => {
  const user = await requireSuperAdminWriteBar(c);
  const b = await body(c);
  const scope = b && scopeFrom(b.tenant_id, b.company_id);
  if (!b || !scope) return badScope(c);
  const uid = c.req.param('manifest');
  const comp = b.component == null ? null : { revisionUid: b.component?.revision_uid, digest: b.component?.digest };
  const { man, cost } = await manifestInScope(c.env, scope, uid);
  const base = { tenant_id: scope.tenantId, company_id: scope.companyId, manifest_uid: uid, digest: b.digest, reason_code: b.reason_code, idempotency_key: b.idempotency_key };
  const out = async (outcome: string, extra: Record<string, unknown> = {}) => audit(c, user, 'work_graph_release_takedown', { ...base, outcome, ...extra });
  if (!man) { await out('not_found'); return refused(c, { code: 'not_found', ids: [uid], cost }); }
  // Another scope's manifest goes to the service on purpose: it records the refused attempt against its own tenant.
  const res = await takedownRelease(c.env, await releaseAdminContext(c.env, scope), {
    lineAssetUid: man.line_asset_uid, manifestUid: uid, digest: b.digest, component: comp, reasonCode: b.reason_code as TakedownReason,
    evidenceRef: b.evidence_ref, authority: b.authority, actor: { kind: 'person', userId: Number(user.id) }, idempotencyKey: b.idempotency_key,
  });
  const total = addCost(cost, res.cost);
  if (!res.ok) { await out(res.code, { ids: res.ids.slice(0, 20) }); return refused(c, { ...res, cost: total }); }
  await out('taken_down', { takedown_id: res.takedownId, changed: res.changed, retract_effect_ids: res.retractEffectIds, replayed: res.replayed });
  return c.json({ ...res, cost: total });
});

r.post('/lines/:line/repin', async (c) => {
  const user = await requireSuperAdminWriteBar(c);
  const b = await body(c);
  const scope = b && scopeFrom(b.tenant_id, b.company_id);
  if (!b || !scope) return badScope(c);
  const lineUid = c.req.param('line');
  if (typeof b.target_manifest_uid !== 'string' || (b.expected_manifest_uid !== null && typeof b.expected_manifest_uid !== 'string')
    || typeof b.idempotency_key !== 'string') {
    return refuse(c, 400, { code: 'malformed', message: 'A re-pin names the manifest to re-pin, the manifest you saw the pointer name, and an idempotency key.' });
  }
  const base = { tenant_id: scope.tenantId, company_id: scope.companyId, line_asset_uid: lineUid, target_manifest_uid: b.target_manifest_uid, idempotency_key: b.idempotency_key };
  const out = async (outcome: string, extra: Record<string, unknown> = {}) => audit(c, user, 'work_graph_release_repin', { ...base, outcome, ...extra });
  const m = new Meter(c.env);
  const line = UID.test(lineUid) ? await readLine(c.env, m, lineUid) : null;
  if (!line) { await out('not_found'); return refused(c, { code: 'not_found', ids: [lineUid], cost: m.cost }); }
  if (outOfScope({ scope }, scopeOf(line))) { await out('wrong_tenant'); return refused(c, { code: 'wrong_tenant', ids: [lineUid], cost: m.cost }); }
  // The head the Super Admin saw: a re-pin is cut on the current head, so another one is a stale view.
  if (line.head_revision_uid !== b.expected_manifest_uid) {
    await out('stale_revision');
    return refused(c, { code: 'stale_revision', ids: [lineUid], cost: m.cost, currentHead: { revisionUid: line.head_revision_uid, headSeq: line.head_seq } });
  }
  const res = await repinRelease(c.env, await releaseAdminContext(c.env, scope), {
    lineAssetUid: lineUid, targetManifestUid: b.target_manifest_uid, author: { kind: 'person', userId: Number(user.id) }, idempotencyKey: b.idempotency_key,
  });
  const total = addCost(m.cost, res.cost);
  if (!res.ok) { await out(res.code, { ids: res.ids.slice(0, 20) }); return refused(c, { ...(res as ReleaseRefusal), cost: total }); }
  await out('repinned', { manifest_uid: res.manifestUid, digest: res.digest, replayed: res.replayed });
  return c.json({ ...res, cost: total });
});

r.post('/drain', async (c) => {
  const user = await requireSuperAdminWriteBar(c);
  const b = (await body(c)) ?? {};
  const asked = b.limit == null ? RELEASE_DRAIN_LIMITS.manualMax : Number(b.limit);
  if (!Number.isSafeInteger(asked) || asked < 1) return refuse(c, 400, { code: 'malformed', message: 'limit is a positive whole number.' });
  const limit = Math.min(asked, RELEASE_DRAIN_LIMITS.manualMax);
  const res = await drainReleaseEffects(c.env, { limit });
  if (!res.ok) {
    await audit(c, user, 'work_graph_release_drain', { limit, outcome: res.code });
    return refuse(c, 409, { code: res.code, message: 'Release delivery is off on this deployment, so nothing was drained.' });
  }
  const summary = summariseDrain(res);
  await audit(c, user, 'work_graph_release_drain', { limit, outcome: 'drained', ...summary, effect_ids: res.results.map((x) => x.effectId) });
  return c.json({ ok: true, limit, ...summary, results: res.results.map((x) => ({ effectId: x.effectId, status: x.status, attempts: x.attempts ?? null })) });
});

// ---------------------------------------------------------------------------------------------------------------------
// Release authorities (part 8): the per-company store the routes above resolve from

r.get('/authorities', async (c) => {
  await requireSuperAdmin(c);
  const scope = queryScope(c);
  if (!scope) return badScope(c);
  const u = c.req.query('user_id');
  if (u !== undefined && !/^[1-9][0-9]{0,15}$/.test(u)) return refuse(c, 400, { code: 'malformed', message: 'user_id is a positive whole number.' });
  const res = await listReleaseAuthorityGrants(c.env, scope, {
    userId: u === undefined ? null : Number(u), history: c.req.query('history') === '1', limit: listLimit(c.req.query('limit')),
  });
  return c.json({ ok: true, scope, authorities: RELEASE_AUTHORITIES, ...res });
});

/** A grant or a revocation by the Super Admin who passed the write bar. */
async function changeAuthority(c: Context<{ Bindings: Env }>, user: { id: number; email?: string | null }, op: 'grant' | 'revoke') {
  const b = await body(c);
  const scope = b && scopeFrom(b.tenant_id, b.company_id);
  if (!b || !scope) return badScope(c);
  const base = {
    tenant_id: scope.tenantId, company_id: scope.companyId, user_id: b.user_id, authority: typeof b.authority === 'string' ? b.authority.slice(0, 40) : null,
    expected_seq: b.expected_seq, idempotency_key: b.idempotency_key,
  };
  const out = async (outcome: string, extra: Record<string, unknown> = {}) => audit(c, user, `work_graph_release_authority_${op}`, { ...base, outcome, ...extra });
  const input = {
    scope: { tenantId: scope.tenantId, companyId: scope.companyId }, userId: b.user_id, authority: b.authority, reason: b.reason,
    expectedSeq: b.expected_seq, actorUserId: Number(user.id), idempotencyKey: b.idempotency_key,
  };
  const res = op === 'grant' ? await grantReleaseAuthority(c.env, input) : await revokeReleaseAuthority(c.env, input);
  if (!res.ok) { await out(res.code, res.current ? { current: res.current } : {}); return refused(c, res); }
  await out(op === 'grant' ? 'granted' : 'revoked', { event_id: res.eventId, seq: res.seq, replayed: res.replayed });
  return c.json(res);
}
r.post('/authorities/grant', async (c) => changeAuthority(c, await requireSuperAdminWriteBar(c), 'grant'));
r.post('/authorities/revoke', async (c) => changeAuthority(c, await requireSuperAdminWriteBar(c), 'revoke'));

export const mount: RouteMount = { path: '/api/admin/work-graph/releases', router: r };
export default r;
