/**
 * D5585 part 10 (#5585): the signed-in WorkGraph release reviewer routes, mounted at /api/work-graph/releases. A person
 * linked to a company records their own publish decision on a manifest there, or attests a component revision, under a
 * release authority they hold in that company. OFF BY DEFAULT: unless `WORK_GRAPH_RELEASE_ADMIN` is exactly `on` (the
 * same switch as part 7's Super-Admin routes), every route refuses 404 `release_review_off` before it reads a session or
 * anything else in D1. Decision: `documentation/architecture/decisions/D5585-p10.md`.
 *
 *   GET  /pending?tenant_id&company_id[&limit]   the manifests awaiting this person's decision there (ids and digests)
 *   POST /manifests/:manifest/decisions   { tenant_id, company_id, digest, audience, profile, authority, decision,
 *                                           approval_ref?, citations?, disclosure_ref?, rights_ref?, idempotency_key }
 *                                         decision: approve | reject | request_changes | withdraw (their own)
 *   POST /attestations                    { tenant_id, company_id, revision_uid, digest, requirement, evidence_ref,
 *                                           authority, idempotency_key }
 *
 * GATES. Reads: `requireAuth`. Writes: `requireStepUp` (a TOTP or passkey session with a recent step-up): a release
 * decision is the sign-off of a counsel, a signatory or a security officer that publication relies on, like the
 * counsel approval of `round_calls.ts` and the sanctions review of `trust.ts`, so an email-link session is not enough.
 * Then, on every route: the person is linked to the company (`resolveActiveCompany`: `user_company_links`, not an
 * archived company), else 403 `not_member`; the company's release records live under the named tenant, else 403
 * `wrong_tenant`; the person is not revoked (`users.is_active = 0`, part 9), else 403 `revoked_author`.
 *
 * AUTHORITY. Only what part 8's store holds for (tenant, company, this person), through `resolveReleaseAuthorities`.
 * Being a Super Admin adds nothing. Part 1's `decideRelease` accepts a decision only under an authority the person holds
 * that approves the profile (`no_authority`), and `attestComponent` an attestation only under one the requirement names.
 * A requirement no authority attests (`pr_validated`, `ci_passed`: a CI run's) is `no_authority` here.
 *
 * STALE WRITES. Every write names the digest the person reviewed (`stale_approval` otherwise) and its idempotency key
 * (a replay answers the first result; another request under it is `idempotency_conflict`). A decision also names the
 * audience it was reviewed for (`audience_forbidden`). Decisions are append-only; the live one is the person's latest
 * row, so a withdrawal is a later `withdraw` row, never an edit, and only ever of their own decision.
 *
 * AUDIT. The decision or attestation row is the services' own record. Every write that passes the gate is also an
 * audit row through `logAdminAction` (`work_graph_release_review_decide` / `_attest`, the person as actor), with its
 * outcome, refused or not.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth, requireStepUp } from '../auth';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';
import { resolveActiveCompany } from '../middleware/activeCompany';
import type { Scope } from '../services/workGraphContracts';
import { Meter, REQUIREMENTS, REQUIREMENT_AUTHORITY, attestComponent, decideRelease, type Requirement } from '../services/workGraphReleases';
import { companyUnderOtherTenant } from '../services/workGraphReleaseAuthorities';
import { RELEASE_REFUSAL_SENTENCES, RELEASE_REFUSAL_STATUS, releaseAdminEnabled, scopeFrom } from '../services/workGraphReleaseAdmin';
import { REVIEW_LIMITS, pendingReleaseDecisions, reviewerContext, type ReviewerContext } from '../services/workGraphReleaseReviews';

const r = new Hono<{ Bindings: Env }>();

const OFF_MESSAGE = 'WorkGraph release review is not enabled on this deployment.';

// The flag is read before anything else, the session included: off, no route reads D1.
r.use('*', async (c, next) => {
  if (!releaseAdminEnabled(c.env)) return refuse(c, 404, { code: 'release_review_off', message: OFF_MESSAGE });
  await next();
});

/** The reviewer's own sentences where the shared one speaks of someone else; the rest are the release services'. */
const OWN: Record<string, string> = {
  not_member: 'You are not linked to this company, so you cannot review its releases.',
  revoked_author: 'Your account has been revoked, so you cannot review releases.',
  no_authority: 'You do not hold a release authority in this company that can decide this.',
};
const STATUS: Record<string, number> = { ...RELEASE_REFUSAL_STATUS, not_member: 403, revoked_author: 403 };

function refused(c: Context, x: { code: string; ids?: string[]; cost?: unknown }) {
  return refuse(c, STATUS[x.code] ?? 409, {
    code: x.code,
    message: OWN[x.code] ?? RELEASE_REFUSAL_SENTENCES[x.code] ?? 'The release service refused this request.',
    extra: { ids: x.ids ?? [], ...(x.cost ? { cost: x.cost } : {}) },
  });
}
const badScope = (c: Context) => refuse(c, 400, { code: 'malformed', message: 'Name the scope this acts in: tenant_id and company_id, both positive integers.' });
const UID = /^[A-Za-z0-9_:.-]{1,80}$/;

async function body(c: Context): Promise<Record<string, any> | null> {
  try {
    const b = await c.req.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
  } catch { return null; }
}

type Gate = { ok: true; rc: ReviewerContext } | { ok: false; code: 'not_member' | 'wrong_tenant' | 'revoked_author' };

/** Membership, tenant and revocation, in that order; then the person's own context. */
async function gate(env: Env, scope: Scope, userId: number): Promise<Gate> {
  if (await resolveActiveCompany(env, { id: userId }, String(scope.companyId)) === null) return { ok: false, code: 'not_member' };
  if (await companyUnderOtherTenant(env, new Meter(env), { tenantId: scope.tenantId, companyId: scope.companyId })) return { ok: false, code: 'wrong_tenant' };
  const rc = await reviewerContext(env, scope, userId);
  if (rc.revoked) return { ok: false, code: 'revoked_author' };
  return { ok: true, rc };
}

const listLimit = (v: unknown) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, REVIEW_LIMITS.listMax) : REVIEW_LIMITS.listMax;
};

// ---------------------------------------------------------------------------------------------------------------------
// Read

r.get('/pending', async (c) => {
  const user = await requireAuth(c);
  const scope = scopeFrom(c.req.query('tenant_id'), c.req.query('company_id'));
  if (!scope) return badScope(c);
  const g = await gate(c.env, scope, Number(user.id));
  if (!g.ok) return refused(c, { code: g.code, ids: [String(scope.companyId)] });
  const out = await pendingReleaseDecisions(c.env, scope, Number(user.id), g.rc.held, listLimit(c.req.query('limit')));
  return c.json({ ok: true, scope, authorities: g.rc.held, ...out });
});

// ---------------------------------------------------------------------------------------------------------------------
// Writes

async function audit(c: Context<{ Bindings: Env }>, user: { id: number; email?: string | null }, action: string, details: Record<string, unknown>) {
  await logAdminAction(c.env, Number(user.id), String(user.email ?? ''), action, details);
}

r.post('/manifests/:manifest/decisions', async (c) => {
  const user = await requireStepUp(c);
  const b = await body(c);
  const scope = b && scopeFrom(b.tenant_id, b.company_id);
  if (!b || !scope) return badScope(c);
  const uid = c.req.param('manifest');
  const base = {
    tenant_id: scope.tenantId, company_id: scope.companyId, manifest_uid: uid.slice(0, 80), digest: b.digest, profile: b.profile,
    authority: typeof b.authority === 'string' ? b.authority.slice(0, 40) : null, decision: b.decision, idempotency_key: b.idempotency_key,
  };
  const out = async (outcome: string, extra: Record<string, unknown> = {}) => audit(c, user, 'work_graph_release_review_decide', { ...base, outcome, ...extra });
  if (!UID.test(uid)) { await out('malformed'); return refused(c, { code: 'malformed', ids: [] }); }
  const g = await gate(c.env, scope, Number(user.id));
  if (!g.ok) { await out(g.code); return refused(c, { code: g.code, ids: [uid] }); }
  const res = await decideRelease(c.env, g.rc.ctx, {
    manifestUid: uid, digest: b.digest, audience: b.audience, purpose: 'publish', profile: b.profile, authority: b.authority,
    decision: b.decision, reviewer: { kind: 'person', userId: Number(user.id) },
    approvalRef: b.approval_ref ?? `release_review:${uid}`, citations: b.citations ?? [],
    disclosureRef: b.disclosure_ref ?? null, rightsRef: b.rights_ref ?? null, idempotencyKey: b.idempotency_key,
  });
  if (!res.ok) { await out(res.code, { ids: res.ids.slice(0, 20) }); return refused(c, res); }
  await out('recorded', { decision_id: res.decisionId, replayed: res.replayed });
  return c.json({ ...res, scope });
});

r.post('/attestations', async (c) => {
  const user = await requireStepUp(c);
  const b = await body(c);
  const scope = b && scopeFrom(b.tenant_id, b.company_id);
  if (!b || !scope) return badScope(c);
  const base = {
    tenant_id: scope.tenantId, company_id: scope.companyId, revision_uid: typeof b.revision_uid === 'string' ? b.revision_uid.slice(0, 80) : null,
    digest: b.digest, requirement: b.requirement, authority: typeof b.authority === 'string' ? b.authority.slice(0, 40) : null,
    idempotency_key: b.idempotency_key,
  };
  const out = async (outcome: string, extra: Record<string, unknown> = {}) => audit(c, user, 'work_graph_release_review_attest', { ...base, outcome, ...extra });
  const g = await gate(c.env, scope, Number(user.id));
  if (!g.ok) { await out(g.code); return refused(c, { code: g.code, ids: [String(b.revision_uid ?? '')] }); }
  // A requirement no release authority attests is a CI run's (an agent's), never a reviewer's.
  if ((REQUIREMENTS as readonly string[]).includes(b.requirement) && REQUIREMENT_AUTHORITY[b.requirement as Requirement] === null) {
    await out('no_authority');
    return refused(c, { code: 'no_authority', ids: [String(b.revision_uid ?? ''), b.requirement] });
  }
  const res = await attestComponent(c.env, g.rc.ctx, {
    revisionUid: b.revision_uid, digest: b.digest, requirement: b.requirement, evidenceRef: b.evidence_ref,
    authority: b.authority ?? null, actor: { kind: 'person', userId: Number(user.id) }, idempotencyKey: b.idempotency_key,
  });
  if (!res.ok) { await out(res.code, { ids: res.ids.slice(0, 20) }); return refused(c, res); }
  await out('recorded', { attestation_id: res.attestationId, replayed: res.replayed });
  return c.json({ ...res, scope });
});

export const mount: RouteMount = { path: '/api/work-graph/releases', router: r };
export default r;
