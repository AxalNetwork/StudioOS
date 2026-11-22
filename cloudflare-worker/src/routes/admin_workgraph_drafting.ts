/** D5582 part 3 (#5582): Super Admin preview access to scoped drafting, counsel clause leases and publication confirmation. */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { activeCompanyFor } from '../middleware/activeCompany';
import { refuse } from '../util/refusal';
import { branchOf } from '../util/branch';
import { proposeCandidate, confirmPublished } from '../services/workGraphDrafting';
import { draftingAsset, scopeOfDraft, currentDraftingDomain, readDraftingDomain } from '../services/workGraphDraftingScope';
import { clausesOf, deckUnits, quoteUnits, type Unit } from '../services/workGraphUnits';
import { planMerge } from '../services/workGraphMerge';
import { acquireLease, renewLease, releaseLease, assertFence, leasesOn, validUnit } from '../services/workGraphLeases';

const r = new Hono<{ Bindings: Env; Variables: { actor: User } }>();
const key = z.string().min(1).max(150);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const quote = z.object({ price_cents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  change_summary: z.string().max(400), note: z.string().max(600).nullable() }).strict();
const draft = z.union([z.string().max(200_000), z.array(z.record(z.string(), z.unknown())).max(200), quote]);
const candidateInput = z.object({ headRevisionUid: key, ours: draft, theirs: draft,
  contributors: z.object({ ours: key, theirs: key }).strict(), jurisdiction: z.string().max(40).optional(),
  fences: z.record(z.string(), z.number().int().positive()).default({}), idempotencyKey: key }).strict();
const confirmation = z.object({ headRevisionUid: key, approvedDigest: digest, publishedId: z.string().regex(/^[1-9][0-9]{0,14}$/),
  fences: z.record(z.string(), z.number().int().positive()).default({}), idempotencyKey: key }).strict();
const leaseInput = z.discriminatedUnion('op', [
  z.object({ op: z.literal('acquire'), ttlMs: z.number().int() }).strict(),
  z.object({ op: z.literal('renew'), fence: z.number().int().positive(), ttlMs: z.number().int() }).strict(),
  z.object({ op: z.literal('release'), fence: z.number().int().positive() }).strict(),
]);

r.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  if (c.env.ENVIRONMENT !== 'preview' || branchOf(c.env) || c.env.WORK_GRAPH_DRAFTING !== 'preview') {
    return refuse(c, 404, { code: 'drafting_unavailable', message: 'WorkGraph drafting is unavailable on this deployment.' });
  }
  c.set('actor', c.req.method === 'GET' ? await requireSuperAdmin(c as any) : await requireSuperAdminWriteBar(c as any));
  return next();
});
r.use('*', bodyLimit({ maxSize: 512_000, onError: c => refuse(c, 413, { code: 'draft_too_large', message: 'The drafting request is too large.' }) }));

async function scoped(c: any) {
  const user = c.get('actor') as User;
  const companyId = await activeCompanyFor(c, user);
  const asset = companyId ? await draftingAsset(c.env, companyId, c.req.param('assetUid')) : null;
  return asset ? { user, asset, ctx: { scope: scopeOfDraft(asset) } } : null;
}
const missing = (c: any) => refuse(c, 404, { code: 'drafting_asset_not_found', message: 'That drafting asset is unavailable in this company.' });
const stale = (c: any) => refuse(c, 409, { code: 'stale_revision', message: 'The domain record changed. Adopt its current revision before drafting again.' });
const malformed = (c: any) => refuse(c, 400, { code: 'invalid_draft_request', message: 'Supply the required drafting fields and content.' });

function draftUnits(kind: string, value: unknown): Unit[] | null {
  if (kind === 'pitch_deck' && Array.isArray(value)) return deckUnits({ id: 0, version: 0, slides: value }).units;
  if (kind === 'legal_template' && typeof value === 'string') return clausesOf(value, 'clause');
  const parsed = quote.safeParse(value);
  return kind === 'offer' && parsed.success ? quoteUnits({ id: 0, quote_id: 0, version: 0, ...parsed.data }).units : null;
}

/** Counsel leases and checks always use the authenticated person and the server-read scope. */
async function counsel(c: any, user: User) {
  return !!await c.env.DB.prepare('SELECT 1 AS ok FROM counsel_members WHERE user_id = ?').bind(user.id).first();
}
async function fenced(c: any, s: NonNullable<Awaited<ReturnType<typeof scoped>>>, units: Unit[], fences: Record<string, number>) {
  if (s.asset.kind !== 'legal_template' || !leasesOn(c.env)) return null;
  const holder = { actorKind: 'person' as const, userId: s.user.id };
  for (const unit of units) {
    const result = await assertFence(c.env, { caller: s.ctx,
      resource: { scope: s.ctx.scope, assetId: s.asset.asset_uid, unit: { kind: 'section', id: unit.id } },
      fence: fences[unit.id], holder, capability: { checked: true, scope: s.ctx.scope, holder } });
    if (!result.ok) return refuse(c, 409, { code: 'clause_lease_required', message: 'Acquire or renew each affected clause lease before continuing.' });
  }
  return null;
}

r.get('/:assetUid', async c => {
  const s = await scoped(c);
  if (!s) return missing(c);
  const current = await currentDraftingDomain(c.env, s.asset, s.user.id);
  if (!current) return stale(c);
  return c.json({ assetUid: s.asset.asset_uid, headRevisionUid: s.asset.head_revision_uid,
    digest: s.asset.digest, document: current.doc });
});

r.post('/:assetUid/candidates', async c => {
  const s = await scoped(c);
  if (!s) return missing(c);
  const parsed = candidateInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return malformed(c);
  const b = parsed.data;
  if (b.headRevisionUid !== s.asset.head_revision_uid) return stale(c);
  if (s.asset.kind === 'legal_template' && !await counsel(c, s.user)) return refuse(c, 403, { code: 'counsel_required', message: 'Counsel must review this template draft.' });
  const current = await currentDraftingDomain(c.env, s.asset, s.user.id);
  if (!current) return stale(c);
  const ours = draftUnits(s.asset.kind, b.ours), theirs = draftUnits(s.asset.kind, b.theirs);
  if (!ours || !theirs) return malformed(c);
  const target = current.target;
  if (target.kind === 'legal_template') {
    if (!b.jurisdiction || !/^[A-Za-z][A-Za-z0-9 _.-]{0,39}$/.test(b.jurisdiction)) return malformed(c);
    target.jurisdiction = b.jurisdiction;
  }
  const plan = planMerge(s.asset.kind, current.doc.units, ours, theirs);
  if ('ok' in plan) return malformed(c);
  if (!plan.conflicts.length) {
    const changed = plan.units.filter(u => current.doc.units.find(old => old.id === u.id)?.value !== u.value);
    const removed = current.doc.units.filter(u => !plan.units.some(next => next.id === u.id));
    const refusal = await fenced(c, s, [...changed, ...removed], b.fences);
    if (refusal) return refusal;
  }
  const result = await proposeCandidate(c.env, s.ctx, {
    assetUid: s.asset.asset_uid, headRevisionUid: b.headRevisionUid,
    base: current.doc.units, ours, theirs, target, author: { kind: 'person', userId: s.user.id },
    contributors: b.contributors, idempotencyKey: b.idempotencyKey,
  });
  if (!result.ok) return c.json(result, 409);
  return c.json(result);
});

r.post('/:assetUid/confirm-publication', async c => {
  const s = await scoped(c);
  if (!s) return missing(c);
  const parsed = confirmation.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return malformed(c);
  const b = parsed.data;
  if (s.asset.kind === 'legal_template' && !await counsel(c, s.user)) return refuse(c, 403, { code: 'counsel_required', message: 'Counsel must confirm this template publication.' });
  const published = await readDraftingDomain(c.env, s.asset, s.user.id, b.publishedId);
  if (!published) return stale(c);
  const refusal = await fenced(c, s, published.doc.units, b.fences);
  if (refusal) return refusal;
  const result = await confirmPublished(c.env, s.ctx, { assetUid: s.asset.asset_uid,
    expectedRevisionUid: b.headRevisionUid, approvedDigest: b.approvedDigest, published: published.doc,
    approval: { ref: `domain:${published.doc.source.locator}:${published.doc.source.id}`, reviewer: { kind: 'person', userId: s.user.id } },
    idempotencyKey: b.idempotencyKey });
  if (!result.ok) return c.json(result, 409);
  return c.json(result);
});

r.post('/:assetUid/clauses/:clauseId/lease', async c => {
  const s = await scoped(c);
  if (!s || s.asset.kind !== 'legal_template') return missing(c);
  if (!await counsel(c, s.user)) return refuse(c, 403, { code: 'counsel_required', message: 'Only counsel can reserve a clause for review.' });
  const clauseId = c.req.param('clauseId');
  if (!validUnit({ kind: 'section', id: clauseId })) return malformed(c);
  const parsed = leaseInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return malformed(c);
  const b = parsed.data, holder = { actorKind: 'person' as const, userId: s.user.id };
  const resource = { scope: s.ctx.scope, assetId: s.asset.asset_uid, unit: { kind: 'section' as const, id: clauseId } };
  const result = b.op === 'acquire' ? await acquireLease(c.env, s.ctx, resource, holder, b.ttlMs)
    : b.op === 'renew' ? await renewLease(c.env, s.ctx, resource, b.fence, holder, b.ttlMs)
      : await releaseLease(c.env, s.ctx, resource, b.fence, holder);
  return c.json(result, result.status === 'refused' || result.status === 'busy' ? 409 : 200);
});

export const mount: RouteMount = { path: '/api/admin/workgraph/drafting', router: r };
export default r;
