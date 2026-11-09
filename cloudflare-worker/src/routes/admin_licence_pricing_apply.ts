/**
 * D5017 (#5017) — country pricing on a licence. Super Admin, HQ only.
 *
 *   GET  /api/admin/licences/:uid/pricing                          territory, basis, active model, per-country freshness,
 *                                                                  latest recommendation, latest decision, drift, next review,
 *                                                                  reviews, agreement match
 *   PUT  /api/admin/licences/:uid/pricing/policy                   record the pricing basis      (write bar, reason, expected_revision)
 *   POST /api/admin/licences/:uid/pricing/snapshot                 a fresh, frozen recommendation (write bar; changes no term)
 *   POST /api/admin/licences/:uid/pricing/apply                    accept or override into the core terms
 *                                                                  (write bar, snapshot_uid, expected_terms_revision, reason)
 *   POST /api/admin/licences/:uid/pricing/reviews                  open the annual review on a fresh recommendation (write bar)
 *   POST /api/admin/licences/:uid/pricing/reviews/:reviewUid/resolve   keep or postpone (write bar, reason, expected_revision)
 *
 * The apply is the D4694 revision-safe terms write: a stale `expected_terms_revision`
 * answers 409 `terms_conflict` and records nothing. It never instantiates, sends
 * or edits a contract and never touches an issued invoice; a changed annual fee
 * or royalty marks the agreement as not matching, and the read says so until
 * HQ instantiates the replacement (`POST /api/admin/licences/:uid/contract`).
 * The branch push's outcome comes back on its own (`pushed`), apart from HQ's
 * commit (`committed: true`).
 */
import { Hono, type Context } from 'hono';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import type { Env } from '../types';
import { mapError, nowIso } from './_t13t14t15_helpers';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';
import { byUid, logEvent, pushOutcome, type LicenceRow } from '../services/licenceLedgerCore';
import { pushLicenceToBranch } from '../services/licencePush';
import { isIsoDay } from '../services/licenceTerms';
import adminLicences from './admin_licences';
import type { RouteMount } from '../util/routeRegistry';
import { PricingError, activeModel, decisionsForLicence, getCountry } from '../services/licencePricingStore';
import {
  addYear, applyStatements, createLicenceSnapshot, currentContract, driftOf, effectiveBasis, getLicenceSnapshot, getReview,
  latestLicenceSnapshot, nextReviewOn, openReview, planApply, policyOf, resolveReview, reviewsFor, territoryOf,
  validateApplyBody, validatePolicyBody, type ApplyInput, type Values,
} from '../services/licencePricingApply';

type C = Context<{ Bindings: Env }>;
const r = new Hono<{ Bindings: Env }>();
const actorOf = (u: { id: number }) => `user:${u.id}`;
const today = () => new Date().toISOString().slice(0, 10);

function answer(c: C, e: unknown) {
  if (e instanceof PricingError) return refuse(c, e.status, { code: e.code, message: e.sentence, extra: e.extra });
  return mapError(c, e);
}
const reasonOf = (b: Record<string, unknown> | null, min = 3, max = 500) => {
  const s = typeof b?.reason === 'string' ? b.reason.trim() : '';
  return s.length >= min && s.length <= max ? s : null;
};
const noReason = (c: C) => refuse(c, 400, { code: 'reason_required', message: 'Say why, in 3 to 500 characters.' });
const notFound = (c: C) => refuse(c, 404, { code: 'not_found', message: 'No licence with that id.' });

/** The licence's current terms as the pricing panel shows them. */
const termsOf = (l: LicenceRow) => ({
  annual_fee_cents: l.annual_fee_cents ?? null, revenue_share_bps: l.revenue_share_bps ?? null, currency: l.currency ?? null,
  terms_revision: Number((l as any).terms_revision ?? 0),
});

/**
 * Whether the licence's agreement still matches its priced terms: it does not
 * when any applied decision changed a contractual figure after the current
 * contract was instantiated. `unreadable` when the contract store
 * cannot be read; `none` when there is no contract at all.
 */
async function agreementOf(c: C, licenceUid: string) {
  let contract: Awaited<ReturnType<typeof currentContract>>;
  try { contract = await currentContract(c.env, licenceUid); } catch { return { state: 'unreadable' as const, contract: null, reason: 'The licence contract store could not be read just now.' }; }
  if (!contract) return { state: 'none' as const, contract: null, reason: 'No agreement has been instantiated for this licence.' };
  const later = await c.env.DB.prepare(
    'SELECT uid, created_at FROM licence_pricing_decisions WHERE licence_uid = ? AND contractual_change = 1 AND created_at > ? ORDER BY created_at DESC LIMIT 1',
  ).bind(licenceUid, contract.created_at).first<Record<string, any>>();
  return {
    state: later ? 'mismatch' as const : 'matches' as const,
    contract,
    decision_uid: later ? String(later.uid) : null,
    reason: later
      ? 'A pricing decision changed the annual fee or royalty after this agreement was drawn, so it may no longer match. Instantiate the replacement agreement on the Contract tab; the current one is not edited.'
      : null,
  };
}

r.get('/:uid/pricing', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return notFound(c);
    const territory = await territoryOf(c.env, licence.id);
    const [policy, model, snapshot, decisions, reviews] = await Promise.all([
      policyOf(c.env, licence.uid), activeModel(c.env), latestLicenceSnapshot(c.env, licence.uid),
      decisionsForLicence(c.env, licence.uid), reviewsFor(c.env, licence.uid),
    ]);
    const eff = effectiveBasis(policy, territory);
    const countries = await Promise.all(territory.map(async (code) => {
      const p = await getCountry(c.env, code);
      if (!p) return { country_code: code, recorded: false, reason: `No market profile is recorded for ${code}.` };
      return {
        country_code: code, recorded: true, country_name: p.country_name, regulatory_class: p.regulatory_class,
        inputs: {
          purchasing_power: { status: p.ppp_status, as_of: p.ppp_as_of, source: p.ppp_source },
          startup_ecosystem: { status: p.startup_score_status, as_of: p.startup_as_of, source: p.startup_source },
          market_size: { status: p.population_status, as_of: p.population_as_of, source: p.population_source },
        },
        profile_revision: p.revision,
      };
    }));
    // The decision row's extra columns (D5017) are read here so the newest one can speak for the agreement and the review date.
    const latestRow = await c.env.DB.prepare(
      'SELECT uid, created_at, contractual_change, pricing_review_on, licence_snapshot_uid, reason, terms_revision_before, terms_revision_after FROM licence_pricing_decisions WHERE licence_uid = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
    ).bind(licence.uid).first<Record<string, any>>();
    const latest = decisions[0] ? { ...decisions[0], ...(latestRow ? {
      licence_snapshot_uid: latestRow.licence_snapshot_uid ?? null, reason: latestRow.reason ?? null,
      pricing_review_on: latestRow.pricing_review_on ?? null, contractual_change: latestRow.contractual_change === null ? null : Number(latestRow.contractual_change) === 1,
      terms_revision_before: latestRow.terms_revision_before ?? null, terms_revision_after: latestRow.terms_revision_after ?? null,
    } : {}) } : null;
    const next = nextReviewOn(latestRow?.pricing_review_on ?? null, reviews);
    // A recommendation made under another basis or territory is history, not the current recommendation.
    const current = snapshot && eff.ok && snapshot.basis === eff.value.basis && snapshot.policy_revision === eff.value.policy_revision
      && snapshot.territory.join(',') === territory.join(',') ? snapshot : null;
    return c.json({
      licence_uid: licence.uid,
      terms: termsOf(licence),
      territory,
      basis: eff.ok ? { ...eff.value, policy } : { required: true, code: eff.code, reason: eff.sentence, policy },
      model: model ? { uid: model.uid, version: model.version, currency: model.currency, effective_from: model.effective_from } : null,
      model_reason: model ? null : 'No pricing model is active, so no recommendation can be made.',
      countries,
      recommendation: current,
      recommendation_reason: current ? null : snapshot ? 'The last recommendation was made for another territory or basis; refresh it.' : 'No recommendation has been made for this licence yet.',
      latest_decision: latest,
      drift: driftOf(current, licence),
      next_review_on: next,
      review_due: !!next && next <= today(),
      reviews,
      agreement: await agreementOf(c, licence.uid),
    });
  } catch (e) { return answer(c, e); }
});

r.put('/:uid/pricing/policy', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return notFound(c);
    if (licence.status === 'terminated') return refuse(c, 409, { code: 'licence_terminated', message: 'A terminated licence is not priced.' });
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const reason = reasonOf(body);
    if (!reason) return noReason(c);
    const expected = body?.expected_revision;
    if (!(typeof expected === 'number' && Number.isSafeInteger(expected) && expected >= 0)) {
      return refuse(c, 400, { code: 'expected_revision_required', message: 'Name the basis revision you read (expected_revision; 0 when none is recorded).' });
    }
    const territory = await territoryOf(c.env, licence.id);
    const v = validatePolicyBody(body, territory);
    if (!v.ok) return refuse(c, 400, { code: 'invalid_basis', message: 'The pricing basis has fields to fix.', extra: { fields: v.errors } });
    const before = await policyOf(c.env, licence.uid);
    const at = nowIso();
    const weights = JSON.stringify(v.value.basis === 'basket_weighted' ? v.value.weights : {});
    const res = expected === 0
      ? await c.env.DB.prepare(
        `INSERT INTO licence_pricing_policies (licence_uid, basis, primary_country, weights_json, reason, revision, updated_at, updated_by)
         SELECT ?, ?, ?, ?, ?, 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM licence_pricing_policies WHERE licence_uid = ?)`,
      ).bind(licence.uid, v.value.basis, v.value.primary_country, weights, reason, at, actorOf(admin), licence.uid).run()
      : await c.env.DB.prepare(
        `UPDATE licence_pricing_policies SET basis = ?, primary_country = ?, weights_json = ?, reason = ?, revision = revision + 1, updated_at = ?, updated_by = ?
          WHERE licence_uid = ? AND revision = ?`,
      ).bind(v.value.basis, v.value.primary_country, weights, reason, at, actorOf(admin), licence.uid, expected).run();
    if (Number(res?.meta?.changes ?? 0) !== 1) {
      return refuse(c, 409, { code: 'basis_conflict', message: 'The pricing basis changed since you opened it, so nothing was saved. Reload it.', extra: { current: before } });
    }
    const policy = await policyOf(c.env, licence.uid);
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_pricing_basis_set', {
      licence_uid: licence.uid, before: before ? { basis: before.basis, primary_country: before.primary_country, weights: before.weights, revision: before.revision } : null,
      after: { basis: policy!.basis, primary_country: policy!.primary_country, weights: policy!.weights, revision: policy!.revision }, reason,
    });
    return c.json({ policy });
  } catch (e) { return answer(c, e); }
});

async function snapshotFor(c: C, licence: LicenceRow, actor: string, allowProvisional: boolean) {
  const territory = await territoryOf(c.env, licence.id);
  const eff = effectiveBasis(await policyOf(c.env, licence.uid), territory);
  if (!eff.ok) throw new PricingError(409, eff.code, eff.sentence);
  return createLicenceSnapshot(c.env, licence, eff.value, actor, { allowProvisional });
}

r.post('/:uid/pricing/snapshot', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return notFound(c);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const snapshot = await snapshotFor(c, licence, actorOf(admin), body?.allow_provisional === true);
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_pricing_snapshot_taken', {
      licence_uid: licence.uid, snapshot_uid: snapshot.uid, basis: snapshot.basis, model_version: snapshot.pricing_model_version, available: snapshot.available,
    });
    // A refresh is a recommendation only; it says so, so no screen reads it as a change of terms.
    return c.json({ snapshot, licence_changed: false }, 201);
  } catch (e) { return answer(c, e); }
});

r.post('/:uid/pricing/apply', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return notFound(c);
    if (licence.status === 'terminated') return refuse(c, 409, { code: 'licence_terminated', message: 'A terminated licence is not priced.' });
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const v = validateApplyBody(body);
    if (!v.ok) {
      const code = v.errors.expected_terms_revision ? 'revision_required' : v.errors.reason ? 'reason_required' : 'invalid_apply';
      return refuse(c, 400, { code, message: 'The apply has fields to fix.', extra: { fields: v.errors } });
    }
    const input = v.value;
    const snap = await getLicenceSnapshot(c.env, input.snapshot_uid);
    if (!snap || snap.licence_uid !== licence.uid) return refuse(c, 404, { code: 'snapshot_not_found', message: 'No recommendation with that id for this licence.' });
    // The recommendation must still describe this licence: same territory, same basis and basis revision.
    const territory = await territoryOf(c.env, licence.id);
    const eff = effectiveBasis(await policyOf(c.env, licence.uid), territory);
    if (!eff.ok) return refuse(c, 409, { code: eff.code, message: eff.sentence });
    if (snap.territory.join(',') !== territory.join(',') || snap.basis !== eff.value.basis || snap.policy_revision !== eff.value.policy_revision) {
      return refuse(c, 409, { code: 'snapshot_stale', message: 'The territory or pricing basis changed since this recommendation was made. Refresh the recommendation and apply again.' });
    }
    if (licence.currency && licence.currency !== snap.currency) {
      return refuse(c, 409, { code: 'currency_mismatch', message: `This licence is held in ${licence.currency}, and the recommendation is in ${snap.currency}. Change the licence currency on the Terms tab first, or override in ${snap.currency}.` });
    }
    const plan = planApply(snap, licence, input.accepted, input.override_reason);
    if (!plan.ok) return refuse(c, 400, { code: plan.code, message: plan.sentence });
    let contract: Awaited<ReturnType<typeof currentContract>> = null;
    try { contract = await currentContract(c.env, licence.uid); } catch {
      if (plan.plan.contractual_change) return refuse(c, 503, { code: 'agreement_unreadable', message: 'The licence contract store could not be read, so whether the agreement still matches cannot be told. Nothing was saved; try again.' });
    }
    if (plan.plan.contractual_change && contract && !input.acknowledge_agreement_mismatch) {
      return refuse(c, 409, {
        code: 'agreement_ack_required',
        message: `This changes ${Object.keys(plan.plan.changed_terms).join(' and ')}, and the licence has an agreement (${contract.status}) drawn on the old figures. Acknowledge that it may no longer match; it is not edited, and a replacement is instantiated on the Contract tab.`,
        extra: { contract_uid: contract.uid, contract_status: contract.status, changed: plan.plan.changed_terms },
      });
    }
    if (input.review_uid) {
      const review = await getReview(c.env, input.review_uid);
      if (!review || review.licence_uid !== licence.uid) return refuse(c, 404, { code: 'review_not_found', message: 'No pricing review with that id for this licence.' });
      if (review.state !== 'open') return refuse(c, 409, { code: 'review_closed', message: 'This pricing review is already closed.' });
    }
    const now = nowIso();
    const decisionUid = crypto.randomUUID();
    const reviewOn = input.pricing_review_on ?? addYear(input.effective_from);
    const full: ApplyInput = { ...input, accepted: plan.plan.accepted as Values };
    const results = await c.env.DB.batch(applyStatements(c.env, {
      licence, snap, input: full, plan: plan.plan, actor: actorOf(admin), decisionUid, now, contractUid: contract?.uid ?? null, reviewOn,
    }));
    if (Number(results?.[1]?.meta?.changes ?? 0) !== 1) {
      const fresh = await byUid(c.env, licence.uid);
      return refuse(c, 409, {
        code: 'terms_conflict',
        message: 'These terms changed since you opened them, so nothing was saved. Reload them and apply again.',
        extra: { current_revision: fresh ? Number((fresh as any).terms_revision ?? 0) : null, current: fresh ? termsOf(fresh) : null },
      });
    }
    const after = (await byUid(c.env, licence.uid)) ?? licence;
    // D272 — the branch's copy holds the core terms, so the apply pushes like every terms write.
    const pushed = await pushLicenceToBranch(c.env, licence.id);
    const outcome = pushOutcome(pushed);
    const before = { annual_fee_cents: licence.annual_fee_cents ?? null, revenue_share_bps: licence.revenue_share_bps ?? null, currency: licence.currency };
    const afterTerms = { annual_fee_cents: after.annual_fee_cents ?? null, revenue_share_bps: after.revenue_share_bps ?? null, currency: after.currency };
    await logEvent(c.env, licence.id, 'terms_changed', admin.id, {
      source: 'country_pricing', decision_uid: decisionUid, decision: plan.plan.decision, snapshot_uid: snap.uid,
      model_version: snap.pricing_model_version, reason: input.reason, override_reason: plan.plan.decision === 'overridden' ? input.override_reason : null,
      changed: plan.plan.changed_terms,
    }, input.reason, { before, after: afterTerms }, outcome);
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_pricing_applied', {
      licence_uid: licence.uid, decision_uid: decisionUid, decision: plan.plan.decision, snapshot_uid: snap.uid, differs: plan.plan.differs,
      changed: plan.plan.changed_terms, effective_from: input.effective_from, reason: input.reason, override_reason: input.override_reason, push: outcome,
    });
    return c.json({
      ok: true, committed: true,
      decision: { uid: decisionUid, decision: plan.plan.decision, accepted: plan.plan.accepted, recommended: snap.recommended, effective_from: input.effective_from, pricing_review_on: reviewOn },
      terms: termsOf(after), changed: plan.plan.changed_terms,
      agreement: plan.plan.contractual_change && contract
        ? { state: 'mismatch', contract_uid: contract.uid, reason: 'The agreement was drawn on the old figures. Instantiate the replacement on the Contract tab; the current one was not edited.' }
        : { state: contract ? 'matches' : 'none', contract_uid: contract?.uid ?? null },
      // Issued invoices are frozen; only invoices issued from now on read the new annual fee.
      invoices: { issued_unchanged: true },
      pushed, push_outcome: outcome,
    });
  } catch (e) { return answer(c, e); }
});

r.post('/:uid/pricing/reviews', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return notFound(c);
    if (licence.status === 'terminated') return refuse(c, 409, { code: 'licence_terminated', message: 'A terminated licence is not reviewed.' });
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const reviews = await reviewsFor(c.env, licence.uid);
    if (reviews.some((x) => x.state === 'open')) return refuse(c, 409, { code: 'review_open', message: 'This licence already has an open pricing review. Close it first.' });
    const latestRow = await c.env.DB.prepare('SELECT pricing_review_on FROM licence_pricing_decisions WHERE licence_uid = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').bind(licence.uid).first<Record<string, any>>();
    const dueOn = nextReviewOn(latestRow?.pricing_review_on ?? null, reviews) ?? today();
    const snapshot = await snapshotFor(c, licence, actorOf(admin), body?.allow_provisional === true);
    const review = await openReview(c.env, licence, snapshot, dueOn, actorOf(admin));
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_pricing_review_opened', {
      licence_uid: licence.uid, review_uid: review.uid, kind: review.kind, snapshot_uid: snapshot.uid, due_on: dueOn,
    });
    return c.json({ review, snapshot, licence_changed: false }, 201);
  } catch (e) { return answer(c, e); }
});

r.post('/:uid/pricing/reviews/:reviewUid/resolve', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return notFound(c);
    const review = await getReview(c.env, c.req.param('reviewUid'));
    if (!review || review.licence_uid !== licence.uid) return refuse(c, 404, { code: 'review_not_found', message: 'No pricing review with that id for this licence.' });
    if (review.state !== 'open') return refuse(c, 409, { code: 'review_closed', message: 'This pricing review is already closed.' });
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const action = body?.action;
    if (action !== 'keep' && action !== 'postpone') {
      return refuse(c, 400, { code: 'invalid_action', message: 'action is keep or postpone. To apply or override, use the apply with this review named.' });
    }
    const reason = reasonOf(body);
    if (!reason) return noReason(c);
    const expected = body?.expected_revision;
    if (!(typeof expected === 'number' && Number.isSafeInteger(expected) && expected >= 1)) {
      return refuse(c, 400, { code: 'expected_revision_required', message: 'Name the review revision you read (expected_revision).' });
    }
    let until: string | null = null;
    if (action === 'postpone') {
      if (!isIsoDay(body?.postponed_until) || (body!.postponed_until as string) <= today()) {
        return refuse(c, 400, { code: 'invalid_postpone', message: 'A postponement names a later date as YYYY-MM-DD.' });
      }
      until = body!.postponed_until as string;
    }
    const resolved = await resolveReview(c.env, { review, action, reason, postponedUntil: until, expectedRevision: expected, actor: actorOf(admin), now: nowIso() });
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_pricing_review_resolved', {
      licence_uid: licence.uid, review_uid: review.uid, action, postponed_until: until, reason,
    });
    return c.json({ review: resolved, licence_changed: false });
  } catch (e) { return answer(c, e); }
});

export const mount: RouteMount[] = [
  // Ahead of the licence ledger, whose `/:uid` catch-all would otherwise see these paths first.
  { path: '/api/admin/licences', router: r, before: [adminLicences] },
];

export default r;
