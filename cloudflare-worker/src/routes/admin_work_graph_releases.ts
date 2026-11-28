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
 *   PUT  /lines/:line/name              part 16: { tenant_id, company_id, name, expected_seq, idempotency_key }   name or rename a line
 *   GET  /webhooks?tenant_id&company_id   part 20: the company's signed-webhook destinations, and whether signing is set
 *   POST /webhooks                      part 20: { tenant_id, company_id, op: register|disable, name, url?, audiences?, expected_seq, idempotency_key }
 *   POST /drain                         { limit? }   one bounded drain of the release outbox (at most 25 effects)
 *   GET  /authorities?tenant_id&company_id[&user_id][&history=1]   part 8: who holds which release authority, and the history
 *   POST /authorities/grant             { tenant_id, company_id, user_id, authority, reason, expected_seq, idempotency_key }
 *   POST /authorities/revoke            { tenant_id, company_id, user_id, authority, reason, expected_seq, idempotency_key }
 *   GET  /scopes                        part 11: every tenant and company with release lines, with the company's name
 *   GET  /status                        part 11: which release switches are on (admin, delivery, sites), booleans only
 *   GET  /authorities/candidates?tenant_id&company_id   part 11: the company's linked people, what each holds, each key's seq
 *
 * NAMES (part 11, D5585-p11). Every read that returns user ids also returns `people`: `{ [userId]: { name } }`, the name
 * other members see (`effectiveDisplayName`), never an email. A line's name is the one a Super Admin gave it (part 16,
 * D5585-p16), with the `lineNameSeq` a rename names; an unnamed line is `lineName: null`,
 * `lineNameReason: 'not_recorded'`. The manifest evaluation explains every live decision that does not count
 * (`notCounted[]`, one reason each, from the same rule that counts).
 *
 * GATES. Reads: `requireSuperAdmin` (HQ only). Writes and the drain: `requireSuperAdminWriteBar` (a TOTP session, a
 * recent step-up, then the elevation). Every write is recorded with the actor through `logAdminAction`, whatever its
 * outcome, beside the services' own audit rows (`advance_head` / `advance_refused` events, the takedown table, the
 * outbox's integrity events).
 *
 * STALE WRITES. A publish and a takedown carry the digest the Super Admin saw (`stale_approval` otherwise); a publish
 * carries the manifest it expects the pointer to name (the CAS refuses `stale_revision`); a re-pin carries the head it
 * saw (`stale_revision`, with the current head); a rename carries the name `seq` it saw (`stale_line_name`, with the
 * current name).
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
  RELEASE_REFUSAL_SENTENCES, RELEASE_REFUSAL_STATUS, releaseAdminContext, releaseAdminEnabled, scopeFrom, summariseDrain,
} from '../services/workGraphReleaseAdmin';
import { companyUnderOtherTenant } from '../services/workGraphReleaseAuthorities';
import {
  RELEASE_DIRECTORY_LIMITS, listGrantCandidates, listReleaseScopes, releasePeople, releaseSwitches,
} from '../services/workGraphReleaseDirectory';
import type { ReleaseState } from '../services/workGraphReleases';
import { UNNAMED, lineNameFields, lineNamesOf, setReleaseLineName } from '../services/workGraphReleaseLineNames';
import { changeWebhook, webhookDestination, webhooksOf } from '../services/workGraphReleaseWebhooks';

const r = new Hono<{ Bindings: Env }>();

const OFF_MESSAGE = 'WorkGraph release administration is not enabled on this deployment.';

// The flag is read before anything else, the session included: off, no route reads D1.
r.use('*', async (c, next) => {
  if (!releaseAdminEnabled(c.env)) return refuse(c, 404, { code: 'release_admin_off', message: OFF_MESSAGE });
  await next();
});

const SENTENCES = RELEASE_REFUSAL_SENTENCES;
const STATUS = RELEASE_REFUSAL_STATUS;

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

/**
 * Part 11: every person a release evaluation names — its author, the reviewers who count and those who do not. Whoever
 * asked for changes (`changesRequestedBy`) is among the latter: their live decision is `changes_requested` there.
 * Part 14 (D5585-p14): and every attester of a pinned piece, or the person an attesting agent run acted for.
 */
const releasePeopleIds = (rel: ReleaseState | null): number[] => (rel ? [
  rel.authorUserId, ...rel.approvals.map((a) => a.reviewerUserId), ...rel.notCounted.map((d) => d.reviewerUserId),
  ...rel.components.flatMap((c) => c.attestations.map((a) => a.userId)),
] : []);

/** Part 11: the names of the people an answer names, and the statement it cost. */
async function named(env: Env, ids: Iterable<number | null | undefined>) {
  const m = new Meter(env);
  return { people: await releasePeople(env, m, ids), cost: m.cost };
}

async function audit(c: Context<{ Bindings: Env }>, user: { id: number; email?: string | null }, action: string, details: Record<string, unknown>) {
  await logAdminAction(c.env, Number(user.id), String(user.email ?? ''), action, details);
}

// ---------------------------------------------------------------------------------------------------------------------
// Reads

r.get('/lines', async (c) => {
  await requireSuperAdmin(c);
  const scope = queryScope(c);
  if (!scope) return badScope(c);
  const list = await listReleaseLines(c.env, scope, listLimit(c.req.query('limit')));
  const names = await named(c.env, list.lines.map((l) => l.createdByUserId));
  return c.json({ ok: true, scope, lines: list.lines, people: names.people, cost: addCost(list.cost, names.cost) });
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
  const nm = new Meter(c.env);
  const lineName = (await lineNamesOf(c.env, nm, scope, [line])).get(line) ?? UNNAMED;
  const names = await named(c.env, [...releasePeopleIds(pub.release), ...list.manifests.map((x) => x.actorUserId), lineName.setByUserId]);
  return c.json({
    ok: true, scope, lineAssetUid: line, ...lineNameFields(lineName), lineNameSetBy: lineName.setByUserId, lineNameSetAt: lineName.setAt,
    headSeq: pub.headSeq, published: pub.release, served: served.served,
    withheld: served.withheld, manifests: list.manifests, people: names.people,
    cost: addCost(addCost(addCost(addCost(pub.cost, served.cost), list.cost), names.cost), nm.cost),
  });
});

r.get('/manifests/:manifest', async (c) => {
  await requireSuperAdmin(c);
  const scope = queryScope(c);
  if (!scope) return badScope(c);
  const s = await releaseStatus(c.env, await releaseAdminContext(c.env, scope), c.req.param('manifest'));
  if (!s.ok) return refused(c, s);
  const names = await named(c.env, releasePeopleIds(s.release));
  return c.json({ ok: true, scope, release: s.release, people: names.people, cost: addCost(s.cost, names.cost) });
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

// Part 16 (D5585-p16): name or rename a release line, from the name `seq` the Super Admin saw. Each attempt, refused or
// not, is an admin audit row; the store keeps every name the line has had.
r.put('/lines/:line/name', async (c) => {
  const user = await requireSuperAdminWriteBar(c);
  const b = await body(c);
  const scope = b && scopeFrom(b.tenant_id, b.company_id);
  if (!b || !scope) return badScope(c);
  const lineUid = c.req.param('line');
  if (typeof b.name !== 'string' || !Number.isSafeInteger(b.expected_seq) || b.expected_seq < 0 || typeof b.idempotency_key !== 'string') {
    return refuse(c, 400, { code: 'malformed', message: 'A rename names the new name, the name seq you saw (0 for an unnamed line), and an idempotency key.' });
  }
  const base = { tenant_id: scope.tenantId, company_id: scope.companyId, line_asset_uid: lineUid.slice(0, 80), expected_seq: b.expected_seq, idempotency_key: b.idempotency_key.slice(0, 160) };
  const out = async (outcome: string, extra: Record<string, unknown> = {}) => audit(c, user, 'work_graph_release_line_name', { ...base, outcome, ...extra });
  const res = await setReleaseLineName(c.env, {
    scope, lineAssetUid: lineUid, name: b.name, expectedSeq: b.expected_seq, actorUserId: Number(user.id), idempotencyKey: b.idempotency_key,
  });
  if (!res.ok) {
    await out(res.code, { ids: res.ids.slice(0, 20) });
    return refused(c, { code: res.code, ids: res.ids, cost: res.cost, ...(res.current ? { current: res.current } : {}) });
  }
  await out('named', { name: res.name, seq: res.seq, replayed: res.replayed });
  return c.json({ ok: true, scope, lineAssetUid: lineUid, lineName: res.name, lineNameSeq: res.seq, replayed: res.replayed, cost: res.cost });
});

// Part 20 (D5585-p20): the company's signed-webhook destinations for external distribution. A webhook's effect ref is
// `webhook:<destination>`. `signing` says whether the Worker holds the signing key: without it nothing is sent.
r.get('/webhooks', async (c) => {
  await requireSuperAdmin(c);
  const scope = queryScope(c);
  if (!scope) return badScope(c);
  const m = new Meter(c.env);
  const list = await webhooksOf(c.env, m, scope);
  const names = await named(c.env, list.map((w) => w.changedByUserId));
  const key = c.env.RELEASE_WEBHOOK_SIGNING_KEY;
  return c.json({
    ok: true, scope, signing: typeof key === 'string' && key.length >= 32,
    webhooks: list.map((w) => ({ ...w, ref: `webhook:${webhookDestination(scope, w.name)}` })), people: names.people, cost: addCost(m.cost, names.cost),
  });
});

r.post('/webhooks', async (c) => {
  const user = await requireSuperAdminWriteBar(c);
  const b = await body(c);
  const scope = b && scopeFrom(b.tenant_id, b.company_id);
  if (!b || !scope) return badScope(c);
  if ((b.op !== 'register' && b.op !== 'disable') || typeof b.name !== 'string' || !Number.isSafeInteger(b.expected_seq) || b.expected_seq < 0
    || typeof b.idempotency_key !== 'string') {
    return refuse(c, 400, { code: 'malformed', message: 'A change names op (register or disable), the webhook name, the seq you saw (0 for a new name), and an idempotency key.' });
  }
  const base = { tenant_id: scope.tenantId, company_id: scope.companyId, op: b.op, name: b.name.slice(0, 40), expected_seq: b.expected_seq, idempotency_key: b.idempotency_key.slice(0, 160),
    url: typeof b.url === 'string' ? b.url.slice(0, 500) : null };
  const out = async (outcome: string, extra: Record<string, unknown> = {}) => audit(c, user, 'work_graph_release_webhook', { ...base, outcome, ...extra });
  const res = await changeWebhook(c.env, {
    scope, op: b.op, name: b.name, url: b.url ?? null, audiences: Array.isArray(b.audiences) ? b.audiences : undefined,
    expectedSeq: b.expected_seq, actorUserId: Number(user.id), idempotencyKey: b.idempotency_key,
  });
  if (!res.ok) {
    await out(res.code, { ids: res.ids.slice(0, 20) });
    return refused(c, { code: res.code, ids: res.ids, cost: res.cost, ...(res.current !== undefined ? { current: res.current } : {}) });
  }
  await out(res.op === 'register' ? 'registered' : 'disabled', { seq: res.seq, replayed: res.replayed });
  return c.json({ ok: true, scope, op: res.op, name: res.name, seq: res.seq, ref: `webhook:${webhookDestination(scope, res.name)}`, replayed: res.replayed, cost: res.cost });
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
  const names = await named(c.env, [
    ...res.holders.flatMap((h) => [h.userId, h.grantedByUserId]), ...(res.events ?? []).flatMap((e) => [e.userId, e.actorUserId]),
  ]);
  return c.json({ ok: true, scope, authorities: RELEASE_AUTHORITIES, ...res, people: names.people, cost: addCost(res.cost, names.cost) });
});

// Part 11 (D5585-p11): the people a grant may name. Only people linked to the company; a company whose release records
// live under another tenant is refused `wrong_tenant`, as a grant there would be.
r.get('/authorities/candidates', async (c) => {
  await requireSuperAdmin(c);
  const scope = queryScope(c);
  if (!scope) return badScope(c);
  const m = new Meter(c.env);
  if (await companyUnderOtherTenant(c.env, m, scope)) return refused(c, { code: 'wrong_tenant', ids: [String(scope.companyId)], cost: m.cost });
  const res = await listGrantCandidates(c.env, m, scope, RELEASE_DIRECTORY_LIMITS.candidatesMax);
  return c.json({ ok: true, scope, authorities: RELEASE_AUTHORITIES, ...res, cost: m.cost });
});

// ---------------------------------------------------------------------------------------------------------------------
// Part 11 (D5585-p11): the scope bar and the switches

r.get('/scopes', async (c) => {
  await requireSuperAdmin(c);
  const m = new Meter(c.env);
  const res = await listReleaseScopes(c.env, m, RELEASE_DIRECTORY_LIMITS.scopesMax);
  return c.json({ ok: true, ...res, cost: m.cost });
});

// Booleans only: whether delivery (`WORK_GRAPH_RELEASE_DELIVERY=preview`) and public sites (`WORK_GRAPH_RELEASE_SITES=on`)
// are on, so the page can say so before a drain is tried. Never the variables' values. Nothing is read past the gate.
r.get('/status', async (c) => {
  await requireSuperAdmin(c);
  return c.json({ ok: true, switches: releaseSwitches(c.env) });
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
