/** Immutable package offers and atomic grant/legal-policy acceptance for HQ (#5024). */
import type { Env } from '../types';
import { byUid } from './licenceLedgerCore';
import { isIsoDay } from './licenceTerms';
import { activePackageDetail, versionDetail, isPackageKey } from './licencePackagesStore';
import { createRecommendation } from './packagePricing';
import { packageDigest, offeredPrograms, packageGrantStatements, reviewPackageGrants, PackageGrantInputError, type OfferedProgram } from './packageOfferGrants';
import { clearGuard, decisionGuard, runDecision } from './decisionBatch';
import { queuePushStatement, pushLicenceToBranch } from './licencePush';
import { agreementsOfLicence } from './programAgreements';
import { freezeHoldingStatements, holdingsOf, latestPolicy, programLegalStatus, replacementOnPackageMoveStatement, requirementFor,
  syncLegalGate, type Holding, type Policy } from './agreementPolicies';
import { logAdminAction } from './adminAudit';

export class PackageOfferError extends Error {
  readonly status: 400 | 404 | 409;
  readonly code: string;
  readonly sentence: string;
  readonly detail: Record<string, unknown>;
  constructor(status: 400 | 404 | 409, code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message); this.status = status; this.code = code; this.sentence = message; this.detail = detail;
  }
}
export type PackageOffer = {
  uid: string; licence_uid: string; package_uid: string; package_key: string; package_name: string; package_version: number;
  pricing_recommendation_uid: string; country_pricing_snapshot_uid: string; currency: string;
  recommended_annual_fee_cents: number; accepted_annual_fee_cents: number | null; state: string; override_reason: string | null;
  starts_on: string; ends_on: string; expires_on: string | null; composition_json: string; recommendation_json: string;
  created_at: string; created_by: number; decided_at: string | null; decided_by: number | null; revision: number;
  create_key: string; create_hash: string; accept_key: string | null; accept_hash: string | null; acceptance_json: string | null;
};
const bad = (code: string, message: string): never => { throw new PackageOfferError(400, code, message); };
const conflict = (code: string, message: string, detail = {}): never => { throw new PackageOfferError(409, code, message, detail); };
function fields(body: Record<string, any>, allowed: string[]) {
  if (Object.keys(body).some((key) => !allowed.includes(key))) bad('invalid_fields', 'This operation contains unsupported fields. Review the documented package-offer inputs.');
}
export const offerReason = (v: unknown): string => {
  if (typeof v !== 'string' || v.trim().length < 10 || v.trim().length > 500) bad('reason_required', 'Say why in 10 to 500 characters, including when declining or superseding an offer.');
  return (v as string).trim();
};
export const offerKey = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_.:-]{8,200}$/.test(v)) bad('idempotency_key_required', 'Mint one idempotency key per prepared operation and reuse it for retries.');
  return v as string;
};
export const offerRevision = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) bad('revision_required', 'expected_revision must name the offer revision you read.');
  return v as number;
};
export async function getPackageOffer(env: Env, licenceUid: string, uid: string): Promise<PackageOffer> {
  const row = await env.DB.prepare('SELECT * FROM licence_package_offers WHERE uid = ? AND licence_uid = ?').bind(uid, licenceUid).first<PackageOffer>();
  if (!row) throw new PackageOfferError(404, 'not_found', 'No package offer for this licence has that id.');
  return row;
}
export function presentPackageOffer(row: PackageOffer) {
  const { create_key, create_hash, accept_key, accept_hash, composition_json, recommendation_json, acceptance_json, ...offer } = row;
  return { ...offer, programs: JSON.parse(composition_json), recommendation: JSON.parse(recommendation_json),
    acceptance: acceptance_json ? JSON.parse(acceptance_json) : null };
}
export async function listPackageOffers(env: Env, licenceUid: string) {
  const rows = await env.DB.prepare('SELECT * FROM licence_package_offers WHERE licence_uid = ? ORDER BY created_at DESC, uid DESC LIMIT 100').bind(licenceUid).all<PackageOffer>();
  return (rows.results || []).map(presentPackageOffer);
}

/** Agreement drafts bind a named real offer, or the accepted current term; older databases keep the legacy catalogue-only read. */
export async function packageOfferForAgreement(env: Env, licenceUid: string, packageKey: string, version: number | null, offerUid: string | null): Promise<PackageOffer | null> {
  let row: PackageOffer | null;
  try {
    row = offerUid
      ? await env.DB.prepare('SELECT * FROM licence_package_offers WHERE uid = ? AND licence_uid = ?').bind(offerUid, licenceUid).first<PackageOffer>()
      : await env.DB.prepare(`SELECT * FROM licence_package_offers WHERE licence_uid = ? AND package_key = ? AND state = 'accepted'
          AND (? IS NULL OR package_version = ?) AND starts_on <= ? AND ends_on >= ? ORDER BY decided_at DESC, uid DESC LIMIT 1`)
        .bind(licenceUid, packageKey, version, version, new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)).first<PackageOffer>();
  } catch (e) {
    if (!offerUid && /no such table: licence_package_offers/i.test(String(e))) return null;
    throw e;
  }
  if (offerUid && !row) throw new PackageOfferError(404, 'package_offer_not_found', 'No commercial package offer for this licence has that id.');
  if (row && (row.package_key !== packageKey || (version !== null && row.package_version !== version)
      || !['offered', 'accepted'].includes(row.state))) {
    throw new PackageOfferError(409, 'package_offer_scope_conflict', 'Choose an offered or accepted package with the same key and version as this agreement.');
  }
  return row;
}
const eventStatement = (env: Env, a: { uid: string; licenceUid: string; action: string; actorId: number; reason: string; at: string; detail: unknown }) =>
  env.DB.prepare(`INSERT INTO licence_package_events (uid, offer_uid, licence_uid, action, actor_user_id, reason, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), a.uid, a.licenceUid, a.action, a.actorId, a.reason, JSON.stringify(a.detail), a.at);

/** A retry returns the original version even if the current catalogue or country index has moved. */
export async function createPackageOffer(env: Env, licenceUid: string, body: Record<string, any>, actor: { id: number; email?: string | null }) {
  fields(body, ['package_key', 'package_version', 'starts_on', 'ends_on', 'expires_on', 'country_pricing_snapshot_uid', 'snapshot_reason', 'program_terms', 'reason', 'idempotency_key']);
  const reason = offerReason(body.reason);
  const key = offerKey(body.idempotency_key);
  const hash = await packageDigest({ licenceUid, body });
  const prior = await env.DB.prepare('SELECT * FROM licence_package_offers WHERE created_by = ? AND create_key = ?').bind(actor.id, key).first<PackageOffer>();
  if (prior) {
    if (prior.create_hash !== hash) conflict('idempotency_key_reused', 'This key already created a different offer.');
    return { offer: presentPackageOffer(prior), created: false };
  }
  const licence = await byUid(env, licenceUid);
  if (!licence) throw new PackageOfferError(404, 'not_found', 'No licence has that id.');
  if (!isPackageKey(body.package_key)) bad('invalid_package', 'Name a published package key.');
  if (body.country_pricing_snapshot_uid != null && (typeof body.country_pricing_snapshot_uid !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(body.country_pricing_snapshot_uid))) bad('invalid_snapshot', 'Choose a recorded country pricing snapshot.');
  if (body.snapshot_reason != null && (typeof body.snapshot_reason !== 'string' || body.snapshot_reason.trim().length < 3 || body.snapshot_reason.trim().length > 500)) bad('invalid_snapshot_reason', 'Explain the snapshot choice in 3 to 500 characters.');
  if (!isIsoDay(body.starts_on) || !isIsoDay(body.ends_on) || body.ends_on < body.starts_on) bad('invalid_dates', 'Record real start/end dates for the package term; the end cannot precede the start.');
  if (body.expires_on != null && !isIsoDay(body.expires_on)) bad('invalid_expiry', 'Offer expiry is a real YYYY-MM-DD date.');
  if (body.package_version != null && (!Number.isSafeInteger(body.package_version) || body.package_version < 1)) bad('invalid_version', 'Package version must be a positive integer.');
  const pkg = body.package_version == null ? await activePackageDetail(env, body.package_key) : await versionDetail(env, body.package_key, body.package_version);
  if (pkg.status !== 'active') conflict('package_not_active', 'Choose a currently active package version when creating an offer. Existing offers retain their published version.');
  if (body.starts_on < pkg.effective_from) bad('invalid_dates', 'The package term cannot start before this catalogue version takes effect.');
  let programs: OfferedProgram[];
  try { programs = await offeredPrograms(env, { licenceId: licence.id, pkg, startsOn: body.starts_on, endsOn: body.ends_on, terms: body.program_terms }); }
  catch (e) { if (e instanceof PackageGrantInputError) return bad('invalid_program_terms', e.message); throw e; }
  const recommendation = (await createRecommendation(env, { licenceUid, pkg,
    snapshotUid: body.country_pricing_snapshot_uid ?? null, snapshotReason: body.snapshot_reason ?? null, actor: `user:${actor.id}` })).recommendation;
  const uid = crypto.randomUUID();
  const at = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO licence_package_offers
        (uid, licence_uid, package_uid, package_key, package_version, package_name, pricing_recommendation_uid,
         country_pricing_snapshot_uid, currency, recommended_annual_fee_cents, starts_on, ends_on, expires_on,
         composition_json, recommendation_json, created_at, created_by, create_key, create_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(uid, licenceUid, pkg.uid, pkg.package_key, pkg.version, pkg.name, recommendation.uid, recommendation.licence_snapshot_uid,
          pkg.currency, recommendation.recommended_annual_fee_cents, body.starts_on, body.ends_on, body.expires_on ?? null,
          JSON.stringify(programs), JSON.stringify(recommendation), at, actor.id, key, hash),
      eventStatement(env, { uid, licenceUid, action: 'created', actorId: actor.id, reason, at, detail: { package_uid: pkg.uid, recommendation_uid: recommendation.uid } }),
    ]);
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) {
      const won = await env.DB.prepare('SELECT * FROM licence_package_offers WHERE created_by = ? AND create_key = ?').bind(actor.id, key).first<PackageOffer>();
      if (won?.create_hash === hash) return { offer: presentPackageOffer(won), created: false };
      if (won) conflict('idempotency_key_reused', 'This key already created a different offer.');
    }
    throw e;
  }
  return { offer: presentPackageOffer(await getPackageOffer(env, licenceUid, uid)), created: true };
}

/** Explicit lifecycle decisions on unaccepted offers; accepted-term lifecycle belongs to #5025. */
export async function changePackageOfferState(env: Env, licenceUid: string, uid: string, action: string, body: Record<string, any>, actorId: number) {
  fields(body, ['expected_revision', 'reason']);
  const targets: Record<string, { to: string; from: string[] }> = {
    offer: { to: 'offered', from: ['draft'] }, decline: { to: 'declined', from: ['offered'] },
    expire: { to: 'expired', from: ['offered'] }, supersede: { to: 'superseded', from: ['draft', 'offered'] },
  };
  const target = targets[action];
  if (!target) bad('invalid_action', 'Choose offer, decline, expire or supersede.');
  const reason = offerReason(body.reason); const revision = offerRevision(body.expected_revision);
  const row = await getPackageOffer(env, licenceUid, uid);
  if (row.revision !== revision || !target.from.includes(row.state)) conflict('changed_since_open', 'This offer changed or cannot take that transition. Read it again.');
  const at = new Date().toISOString();
  const run = await runDecision(env, [
    env.DB.prepare(`UPDATE licence_package_offers SET state = ?, revision = revision + 1, decided_by = ?, decided_at = ?
      WHERE uid = ? AND licence_uid = ? AND state = ? AND revision = ?`).bind(target.to, actorId, at, uid, licenceUid, row.state, revision),
    decisionGuard(env), eventStatement(env, { uid, licenceUid, action: target.to, actorId, reason, at, detail: { from_state: row.state, revision: revision + 1 } }), clearGuard(env),
  ]);
  if (run.lost) conflict('changed_since_open', 'Another decision changed this offer. Nothing was written.');
  return presentPackageOffer(await getPackageOffer(env, licenceUid, uid));
}

function acceptancePrice(offer: PackageOffer, body: Record<string, any>) {
  fields(body, ['accepted_annual_fee_cents', 'override_reason', 'expected_revision', 'review_hash', 'reason', 'idempotency_key']);
  const fee = body.accepted_annual_fee_cents === undefined ? offer.recommended_annual_fee_cents : body.accepted_annual_fee_cents;
  if (typeof fee !== 'number' || !Number.isSafeInteger(fee) || fee < 0 || fee > 1_000_000_000_000) bad('invalid_price', 'The accepted price must be whole nonnegative minor units, within the supported range.');
  const override = fee !== offer.recommended_annual_fee_cents;
  const why = override ? offerReason(body.override_reason) : null;
  return { accepted_annual_fee_cents: fee, override_reason: why, overridden: override };
}

/** Preview every consequence from the frozen offer and current grants/policies, without writing. */
export async function reviewPackageOffer(env: Env, licenceUid: string, uid: string, body: Record<string, any> = {}) {
  const offer = await getPackageOffer(env, licenceUid, uid);
  const licence = await byUid(env, licenceUid);
  if (!licence) throw new PackageOfferError(404, 'not_found', 'No licence has that id.');
  const today = new Date().toISOString().slice(0, 10);
  const price = acceptancePrice(offer, body);
  const programs: OfferedProgram[] = JSON.parse(offer.composition_json);
  const grants = await reviewPackageGrants(env, { offerUid: uid, licenceId: licence.id, renewsOn: licence.renews_on,
    startsOn: offer.starts_on, endsOn: offer.ends_on, currency: offer.currency, programs, today });
  const conflicts = [...grants.conflicts];
  const issue = (code: string, message: string) => conflicts.push({ program_key: '', code, message });
  if (offer.state !== 'offered') issue('not_offered', 'Only an offered package can be accepted.');
  if (licence.status !== 'active') issue('licence_not_active', 'The licence must be active; a package cannot bypass its freeze.');
  if (offer.ends_on < today || (offer.expires_on && offer.expires_on < today)) issue('offer_expired', 'This offer or its term has expired. Create a fresh offer.');
  const overlaps = (await env.DB.prepare(`SELECT uid FROM licence_package_offers WHERE licence_uid = ? AND state = 'accepted'
    AND uid <> ? AND starts_on <= ? AND ends_on >= ?`).bind(licenceUid, uid, offer.ends_on, offer.starts_on).all<{ uid: string }>()).results || [];
  if (overlaps.length) issue('package_term_conflict', 'An accepted package already covers part of this term. Resolve its lifecycle explicitly before accepting another.');
  const [policy, held, agreements] = await Promise.all([latestPolicy(env, 'package', offer.package_key), holdingsOf(env, licenceUid), agreementsOfLicence(env, licenceUid)]);
  const priorPackage = held.find((h) => h.scope_kind === 'package');
  if (priorPackage && offer.starts_on > today) issue('scheduled_package_policy', 'A future package cannot replace a held package policy early. Use the scheduled lifecycle workflow.');
  if (priorPackage && (priorPackage.policy.programs || []).some((key) => !programs.some((p) => p.program_key === key)
      && grants.rows.some((g) => g.program_key === key && g.state === 'granted'))) {
    issue('package_move_requires_review', 'This move would remove a frozen package policy from an existing outside grant. Resolve its standalone legal terms through the lifecycle workflow first.');
  }
  const policies: Array<{ scopeKind: 'package' | 'program'; scopeKey: string; policy: Policy | null; freeze: boolean }> = [
    { scopeKind: 'package', scopeKey: offer.package_key, policy, freeze: true },
  ];
  if (!policy) issue('package_policy_missing', 'Record the package agreement strategy and legal gate before accepting its offer.');
  else if ([...(policy.programs || [])].sort().join('|') !== programs.map((p) => p.program_key).sort().join('|')) {
    issue('package_policy_composition_conflict', 'The current package agreement policy must name exactly the offered programs, preserving standalone extras.');
  }
  const prospective: Holding[] = held.filter((h) => h.scope_kind !== 'package');
  const holding = (p: Policy, origin: Holding['origin']): Holding => ({ uid: `review-${p.uid}`, licence_uid: licenceUid,
    scope_kind: p.scope_kind, scope_key: p.scope_key, policy_uid: p.uid, policy_version: p.version, origin, package_offer_uid: uid,
    frozen_at: '', frozen_by_user_id: null, superseded_at: null, superseded_by_uid: null, policy: p, package_version: offer.package_version });
  if (policy) prospective.push(holding(policy, 'package_offer_accepted'));
  for (const p of grants.plans) {
    if (p.action === 'created' && !held.some((h) => h.scope_kind === 'program' && h.scope_key === p.program_key)) {
      const own = await latestPolicy(env, 'program', p.program_key);
      policies.push({ scopeKind: 'program', scopeKey: p.program_key, policy: own, freeze: !!own });
      if (own) prospective.push(holding(own, 'program_granted'));
    }
    const requirement = requirementFor(p.program_key, prospective);
    if (requirement.legal_gate === 'required_before_grant') {
      const status = programLegalStatus({ ...p.terms, program_key: p.program_key, state: 'granted', requires_signed_schedule: 0 }, agreements, requirement, { grantInForce: true });
      if (status.missing.length) conflicts.push({ program_key: p.program_key, code: 'agreement_required_before_grant', message: `Execute the required agreement first: ${status.missing.join(', ')}.` });
    }
  }
  const review = { offer: presentPackageOffer(offer), price, grants: grants.plans, conflicts,
    legal: policy ? { policy_uid: policy.uid, policy_version: policy.version, strategy: policy.strategy, legal_gate: policy.legal_gate } : null,
    branch_sync: 'Existing Program Grants licence copy; delivery is reported separately.', accepted_program_allocation: 'Not recorded; the package has its own price.' };
  const reviewHash = await packageDigest({ review, licence_revision: licence.revision, today,
    policies: policies.map((p) => [p.scopeKind, p.scopeKey, p.policy?.uid ?? null]), holdings: held.map((h) => h.uid),
    agreements: agreements.map((a) => [a.uid, a.revision, a.status]) });
  return { review, review_hash: reviewHash, internal: { offer, licence, policies, held, agreements } };
}

/** The whole acceptance is guarded and committed once, then the normal branch delivery runs. */
export async function acceptPackageOffer(env: Env, licenceUid: string, uid: string, body: Record<string, any>, actor: { id: number; email?: string | null }) {
  const reason = offerReason(body.reason); const expected = offerRevision(body.expected_revision); const key = offerKey(body.idempotency_key);
  const hash = await packageDigest({ licenceUid, uid, body });
  const stored = await getPackageOffer(env, licenceUid, uid);
  if (stored.state === 'accepted') {
    if (stored.accept_key === key && stored.decided_by === actor.id && stored.accept_hash === hash) return { ...JSON.parse(stored.acceptance_json!), replayed: true };
    conflict('already_accepted', 'This package offer was already accepted. Read its recorded receipt.');
  }
  const prepared = await reviewPackageOffer(env, licenceUid, uid, body);
  const { review, internal: { offer, licence, policies, agreements } } = prepared;
  if (offer.revision !== expected || prepared.review_hash !== body.review_hash) conflict('review_changed', 'The offer, grant or legal consequences changed. Review the offer again; nothing was written.');
  if (review.conflicts.length) conflict('acceptance_conflict', 'Resolve every listed conflict before accepting this package.', { conflicts: review.conflicts });
  const at = new Date().toISOString();
  const receipt = { outcome: 'accepted', offer_uid: uid, licence_uid: licenceUid, package_uid: offer.package_uid,
    package_key: offer.package_key, package_version: offer.package_version, currency: offer.currency, ...review.price,
    starts_on: offer.starts_on, ends_on: offer.ends_on, grants: review.grants, legal: review.legal,
    actor_user_id: actor.id, reason, at, revision: expected + 1, replayed: false };
  const statements = [
    env.DB.prepare(`UPDATE licence_package_offers SET state = 'accepted', accepted_annual_fee_cents = ?, override_reason = ?,
      decided_at = ?, decided_by = ?, revision = revision + 1, accept_key = ?, accept_hash = ?, acceptance_json = ?
      WHERE uid = ? AND licence_uid = ? AND state = 'offered' AND revision = ?`)
      .bind(review.price.accepted_annual_fee_cents, review.price.override_reason, at, actor.id, key, hash, JSON.stringify(receipt), uid, licenceUid, expected),
    decisionGuard(env),
    env.DB.prepare(`INSERT INTO decision_guard (decision_won) VALUES (CASE WHEN
      (SELECT COUNT(*) FROM licence_agreement_policy_holdings WHERE licence_uid = ? AND superseded_at IS NULL) = ?
      AND NOT EXISTS (SELECT 1 FROM licence_agreement_policy_holdings WHERE licence_uid = ? AND superseded_at IS NULL
        AND uid NOT IN (SELECT value FROM json_each(?))) THEN 1 ELSE 0 END)`)
      .bind(licenceUid, prepared.internal.held.length, licenceUid, JSON.stringify(prepared.internal.held.map((h) => h.uid))),
    env.DB.prepare(`INSERT INTO decision_guard (decision_won) VALUES (CASE WHEN EXISTS
      (SELECT 1 FROM territory_licences WHERE uid = ? AND revision = ? AND status = 'active') THEN 1 ELSE 0 END)`).bind(licenceUid, licence.revision),
    env.DB.prepare(`INSERT INTO decision_guard (decision_won) VALUES (CASE WHEN NOT EXISTS
      (SELECT 1 FROM licence_package_offers WHERE licence_uid = ? AND state = 'accepted' AND uid <> ? AND starts_on <= ? AND ends_on >= ?) THEN 1 ELSE 0 END)`)
      .bind(licenceUid, uid, offer.ends_on, offer.starts_on),
  ];
  for (const p of policies) {
    statements.push(env.DB.prepare(`INSERT INTO decision_guard (decision_won) VALUES (CASE WHEN
      (SELECT uid FROM licence_agreement_policies WHERE scope_kind = ? AND scope_key = ? ORDER BY version DESC LIMIT 1) IS ? THEN 1 ELSE 0 END)`)
      .bind(p.scopeKind, p.scopeKey, p.policy?.uid ?? null));
    if (p.freeze && p.policy) statements.push(...freezeHoldingStatements(env, { uid: crypto.randomUUID(), licenceUid,
      scopeKind: p.scopeKind, scopeKey: p.scopeKey, origin: p.scopeKind === 'package' ? 'package_offer_accepted' : 'program_granted',
      packageOfferUid: uid, packageVersion: offer.package_version, actorId: actor.id, at, reason }));
  }
  for (const a of agreements.filter((a) => a.status === 'executed')) {
    statements.push(env.DB.prepare(`INSERT INTO decision_guard (decision_won) VALUES (CASE WHEN EXISTS
      (SELECT 1 FROM licence_program_agreements WHERE uid = ? AND revision = ? AND status = 'executed') THEN 1 ELSE 0 END)`).bind(a.uid, a.revision));
  }
  statements.push(replacementOnPackageMoveStatement(env, { licenceUid, packageKey: offer.package_key, actorId: actor.id, at, reason }));
  statements.push(...packageGrantStatements(env, { licenceId: licence.id, offerUid: uid, actorId: actor.id, reason, at, plans: review.grants }));
  for (const p of review.grants) {
    statements.push(env.DB.prepare(`INSERT INTO licence_package_items
      (offer_uid, program_key, package_uid, package_key, package_version, position, metadata_json, grant_uid, grant_terms_revision, grant_action, accepted_terms_json, allocated_annual_fee_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).bind(uid, p.program_key, offer.package_uid, offer.package_key, offer.package_version,
        p.position, p.metadata ? JSON.stringify(p.metadata) : null, p.grant_uid, p.terms_revision, p.action, JSON.stringify(p.terms)));
  }
  statements.push(eventStatement(env, { uid, licenceUid, action: 'accepted', actorId: actor.id, reason, at, detail: receipt }), queuePushStatement(env, licence.id), clearGuard(env));
  let lost = false;
  try { lost = (await runDecision(env, statements)).lost; }
  catch (e) {
    if (/UNIQUE/i.test(String(e))) {
      const winner = await getPackageOffer(env, licenceUid, uid);
      if (winner.accept_hash === hash && winner.accept_key === key && winner.decided_by === actor.id) return { ...JSON.parse(winner.acceptance_json!), replayed: true };
      conflict('acceptance_conflict', 'A grant or decision changed while accepting this offer. Nothing was partially committed.');
    }
    throw e;
  }
  if (lost) {
    const winner = await getPackageOffer(env, licenceUid, uid);
    if (winner.accept_hash === hash && winner.accept_key === key && winner.decided_by === actor.id) return { ...JSON.parse(winner.acceptance_json!), replayed: true };
    conflict('review_changed', 'The offer, licence, grant or policy changed while accepting it. Nothing was partially committed.');
  }
  await syncLegalGate(env, licenceUid, { actorId: actor.id, reason });
  await logAdminAction(env, actor.id, actor.email || '', 'licence_package_accepted', { licence_uid: licenceUid, package_offer_uid: uid,
    package_uid: offer.package_uid, package_version: offer.package_version, accepted_annual_fee_cents: review.price.accepted_annual_fee_cents,
    currency: offer.currency, reason });
  const pushed = await pushLicenceToBranch(env, licence.id);
  return { ...receipt, pushed };
}
