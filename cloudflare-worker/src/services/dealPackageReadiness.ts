/**
 * D5457 (#5457, ADP-03) — the one server-owned preflight for a deal package: a pure evaluator over facts, the
 * explicit blocker matrix by audience and instrument, and the bounded read that gathers those facts for a D5454
 * preparation. Contract: `documentation/architecture/decisions/D5457.md`.
 *
 * FOUR SEPARATE ANSWERS. `content_completeness` (is the brief whole), `release_eligibility` (may this candidate go
 * to this audience), `investor_access` (what each intended recipient would actually receive under the stores' own
 * rules) and `closing_readiness` (may a transaction close). A complete brief is not a release; a release is not a
 * closing. A teaser is never blocked by a closing prerequisite, and a closing prerequisite is never "passed" because
 * its record could not be read.
 *
 * FAILED READS ARE NOT PASSES. Every check is `pass`, `fail`, `unreadable`, `unavailable` (no integrated source:
 * ADP-02's typed terms, ADP-04's review, Contracts' legal prerequisites, the marketplace distribution policy, the
 * representative-authority record), `review_required` (a case the matrix does not know) or `not_applicable`. A
 * dimension is `ready` only when every blocking check in it passed.
 *
 * ADVISORY, NOT AUTHORITY. A result carries the candidate and sources digests it was computed for and a freshness
 * limit. It is never a permission token: the final release (ADP-04) re-runs it in its own transaction.
 *
 * READ-ONLY. `readPackageReadiness` writes nothing, calls no AI or provider and runs at most `READINESS_QUERY_MAX`
 * statements. No route mounts it yet; creation, review and publication stay disabled (`PREPARATION_MUTATIONS_ENABLED`).
 */
import type { Env, User } from '../types';
import {
  type CapabilityContext, type IssuerResult, deploymentScope, isMissingPreparationTable, issuerDrift,
  preparationCapabilities, resolveIssuerPair,
} from './dealPreparation';
import {
  D5457_CONTRACT_VERSION, PACKAGE_POLICY_VERSION, type ManifestResult, type ReleaseAudience, candidateDigest, parseManifest,
} from './dealPackageManifest';
import {
  RECIPIENT_QUERY_MAX, RESOLVE_QUERY_MAX, type RecipientFacts, type ResolvedItem, type SourceStatus,
  admitsAudience, readRecipientFacts, resolveManifestSources, retrievalDecision, sourcesDigest,
} from './dealPackageSources';

export const DIMENSIONS = ['content_completeness', 'release_eligibility', 'investor_access', 'closing_readiness'] as const;
export type Dimension = typeof DIMENSIONS[number];
export type CheckState = 'pass' | 'fail' | 'unreadable' | 'unavailable' | 'review_required' | 'not_applicable';
export type CheckLevel = 'blocking' | 'advisory';
export type DimensionState = 'ready' | 'blocked' | 'unreadable' | 'review_required';

/** Where an authorised person repairs a failed check. The client maps each key to a screen it may open. */
export type RepairKey = 'edit_revision' | 'edit_manifest' | 'edit_audience' | 'company_link' | 'data_room' | 'raise_evidence'
  | 'pitch_deck' | 'review' | 'contracts' | 'distribution_policy' | 'none';

export type Check = {
  id: CheckId; dimension: Dimension; level: CheckLevel; state: CheckState; code: string; explanation: string; repair: RepairKey;
  /** Counts only (by status or by recipient outcome); never a name, title or amount. */
  counts?: Record<string, number>;
};

export const CHECK_IDS = [
  'issuer_pair', 'manifest_valid', 'brief_sections', 'instrument_supported', 'typed_terms',
  'sources_current', 'sources_latest', 'audience_selected', 'distribution_policy', 'audience_projection', 'candidate_review',
  'recipient_access',
  'legal_prerequisites', 'issuer_authority', 'instrument_closing_rules',
] as const;
export type CheckId = typeof CHECK_IDS[number];

const DIMENSION_OF: Record<CheckId, Dimension> = {
  issuer_pair: 'release_eligibility', manifest_valid: 'content_completeness', brief_sections: 'content_completeness',
  instrument_supported: 'content_completeness', typed_terms: 'content_completeness', sources_current: 'release_eligibility',
  sources_latest: 'release_eligibility', audience_selected: 'release_eligibility', distribution_policy: 'release_eligibility',
  audience_projection: 'release_eligibility', candidate_review: 'release_eligibility', recipient_access: 'investor_access',
  legal_prerequisites: 'closing_readiness', issuer_authority: 'closing_readiness', instrument_closing_rules: 'closing_readiness',
};

type Applicability = CheckLevel | 'not_applicable';
const ALL_BLOCKING: Record<CheckId, Applicability> = Object.fromEntries(CHECK_IDS.map((id) => [id, 'blocking'])) as Record<CheckId, Applicability>;

/**
 * THE BLOCKER MATRIX BY AUDIENCE. `none` is a candidate with no audience chosen yet: it is judged as an invited
 * release so nothing is assumed lighter. A teaser has no recipients and needs an approved distribution policy; an
 * invited release needs neither a policy nor any closing prerequisite. Closing checks are blocking in every column,
 * but they block `closing_readiness` only, never a release dimension.
 */
export const BLOCKER_MATRIX: Readonly<Record<ReleaseAudience | 'none', Readonly<Record<CheckId, Applicability>>>> = Object.freeze({
  marketplace_teaser: { ...ALL_BLOCKING, sources_latest: 'advisory', recipient_access: 'not_applicable' },
  invited: { ...ALL_BLOCKING, sources_latest: 'advisory', distribution_policy: 'not_applicable' },
  invited_nda: { ...ALL_BLOCKING, sources_latest: 'advisory', distribution_policy: 'not_applicable' },
  none: { ...ALL_BLOCKING, sources_latest: 'advisory', distribution_policy: 'not_applicable' },
});

/** The brief sections each audience's projection needs (the D5454 projection keys it shows). */
export const REQUIRED_SECTIONS: Readonly<Record<ReleaseAudience | 'none', readonly string[]>> = Object.freeze({
  marketplace_teaser: ['title', 'summary', 'sector', 'instrument', 'currency'],
  invited: ['title', 'summary', 'description', 'sector', 'instrument', 'currency', 'target_raise', 'minimum_check'],
  invited_nda: ['title', 'summary', 'description', 'sector', 'instrument', 'currency', 'target_raise', 'minimum_check'],
  none: ['title', 'summary', 'description', 'sector', 'instrument', 'currency', 'target_raise', 'minimum_check'],
});

/**
 * THE MATRIX BY INSTRUMENT. The families the package knows, and the closing records each needs beyond the legal
 * prerequisites and representative authority every family needs. A family not listed is `review_required`.
 * `vehicle_record` (the SPV's own entity record) has no integrated source yet.
 */
export const INSTRUMENT_FAMILIES = {
  safe: { aliases: ['safe', 'post-money safe', 'pre-money safe'], closing_extra: [] as string[] },
  convertible_note: { aliases: ['note', 'convertible note', 'convertible_note'], closing_extra: [] as string[] },
  priced_equity: { aliases: ['equity', 'priced', 'priced equity', 'priced_equity', 'preferred equity'], closing_extra: [] as string[] },
  spv: { aliases: ['spv', 'spv interest'], closing_extra: ['vehicle_record'] },
} as const;
export type InstrumentFamily = keyof typeof INSTRUMENT_FAMILIES;

export function instrumentFamily(v: unknown): InstrumentFamily | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  for (const [family, spec] of Object.entries(INSTRUMENT_FAMILIES)) if ((spec.aliases as readonly string[]).includes(s)) return family as InstrumentFamily;
  return null;
}

/** A fact another package supplies. Until it does, the orchestrator passes `unavailable`. */
export type ExternalFact =
  | { state: 'unavailable' } | { state: 'unreadable' }
  | { state: 'recorded'; ok: boolean; version: string; candidate_digest?: string };
export type LegalFact =
  | { state: 'unavailable' } | { state: 'unreadable' }
  | { state: 'recorded'; template_active: boolean; template_reviewed: boolean; version: string };

export type ReadinessInput = {
  preparation: { uid: string; company_id: number; project_id: number };
  revision: { id: number; content: Record<string, unknown>; content_sha256: string; company_id: number; project_id: number };
  /** The issuer pair resolved now, or `unreadable` when the read failed. */
  issuer: IssuerResult | 'unreadable';
  /** The project's current company, for drift against the revision's pinned pair. */
  current_company: { company_id: unknown } | null | 'unreadable';
  manifest: ManifestResult;
  sources: readonly ResolvedItem[];
  recipients: readonly RecipientFacts[];
  dependencies: { terms: ExternalFact; review: ExternalFact; legal: LegalFact; distribution_policy: ExternalFact; representative_authority: ExternalFact };
  candidate_digest: string;
  sources_digest: string;
  now: number;
};

export const READINESS_TTL_MS = 5 * 60 * 1000;

export type ReadinessResult = {
  contract_version: typeof D5457_CONTRACT_VERSION;
  policy_version: string;
  preparation_uid: string;
  revision_id: number;
  candidate_digest: string;
  sources_digest: string;
  evaluated_at: string;
  fresh_until: string;
  dependency_versions: Record<string, string>;
  audience: ReleaseAudience | null;
  instrument_family: InstrumentFamily | null;
  dimensions: Record<Dimension, { state: DimensionState; blocking: number; advisory: number }>;
  release_ready: boolean;
  closing_ready: boolean;
  checks: Check[];
};

const word = {
  pass: 'Recorded and current.',
  unreadable: 'This could not be read. Nothing is assumed; try again.',
} as const;

function check(id: CheckId, applicability: Applicability, state: CheckState, code: string, explanation: string, repair: RepairKey, counts?: Record<string, number>): Check {
  const out: Check = {
    id, dimension: DIMENSION_OF[id], level: applicability === 'advisory' ? 'advisory' : 'blocking',
    state: applicability === 'not_applicable' ? 'not_applicable' : state,
    code: applicability === 'not_applicable' ? 'not_applicable' : code,
    explanation: applicability === 'not_applicable' ? 'Not required for this audience.' : explanation,
    repair: applicability === 'not_applicable' ? 'none' : repair,
  };
  if (counts && applicability !== 'not_applicable') out.counts = counts;
  return out;
}

function fromExternal(f: ExternalFact, what: string, unavailableWhy: string): { state: CheckState; code: string; explanation: string } {
  if (f.state === 'unavailable') return { state: 'unavailable', code: `${what}_unavailable`, explanation: unavailableWhy };
  if (f.state === 'unreadable') return { state: 'unreadable', code: `${what}_unreadable`, explanation: word.unreadable };
  return f.ok ? { state: 'pass', code: 'ok', explanation: word.pass } : { state: 'fail', code: `${what}_not_satisfied`, explanation: 'Recorded as not satisfied.' };
}

const present = (v: unknown) => v != null && !(typeof v === 'string' && v.trim() === '');

/** The pure evaluator: the same facts always give the same checks, wherever they are shown. */
export function evaluateReadiness(input: ReadinessInput): ReadinessResult {
  const manifest = input.manifest.ok ? input.manifest.manifest : null;
  const audience = manifest?.audience?.audience ?? null;
  const m = BLOCKER_MATRIX[audience ?? 'none'];
  const content = input.revision.content;
  const family = instrumentFamily(content.instrument);
  const checks: Check[] = [];

  // 1. Issuer: the company-backed project pair, resolved now and compared with the revision's pinned pair.
  if (input.issuer === 'unreadable' || input.current_company === 'unreadable') {
    checks.push(check('issuer_pair', m.issuer_pair, 'unreadable', 'issuer_unreadable', word.unreadable, 'company_link'));
  } else if (!input.issuer.ok) {
    checks.push(check('issuer_pair', m.issuer_pair, 'fail', input.issuer.code, 'The issuing company and its project are not a valid, live company-backed pair.', 'company_link'));
  } else if (input.revision.company_id !== input.preparation.company_id || input.revision.project_id !== input.preparation.project_id
    || issuerDrift({ company_id: input.revision.company_id, project_id: input.revision.project_id }, input.current_company) !== 'same') {
    checks.push(check('issuer_pair', m.issuer_pair, 'fail', 'issuer_moved', 'The project no longer belongs to the company this revision names. Reconcile before release; nothing is rewritten.', 'company_link'));
  } else {
    checks.push(check('issuer_pair', m.issuer_pair, 'pass', 'ok', word.pass, 'none'));
  }

  // 2. The manifest itself.
  checks.push(input.manifest.ok
    ? check('manifest_valid', m.manifest_valid, 'pass', 'ok', word.pass, 'none')
    : check('manifest_valid', m.manifest_valid, 'fail', input.manifest.code, 'The package manifest is malformed and is read as nothing.', 'edit_manifest'));

  // 3. Brief sections for this audience's projection.
  const missing = REQUIRED_SECTIONS[audience ?? 'none'].filter((k) => !present(content[k]));
  checks.push(missing.length === 0
    ? check('brief_sections', m.brief_sections, 'pass', 'ok', word.pass, 'none')
    : check('brief_sections', m.brief_sections, 'fail', 'sections_missing', `Missing: ${missing.join(', ')}.`, 'edit_revision', { missing: missing.length }));

  // 4. Instrument family and currency shape. An unfamiliar instrument is reviewed, never guessed.
  if (!present(content.instrument)) checks.push(check('instrument_supported', m.instrument_supported, 'fail', 'instrument_missing', 'No instrument is recorded.', 'edit_revision'));
  else if (!family) checks.push(check('instrument_supported', m.instrument_supported, 'review_required', 'instrument_unfamiliar', 'This instrument is not in the package matrix; a reviewer must decide its rules.', 'review'));
  else if (typeof content.currency !== 'string' || !/^[A-Z]{3}$/.test(content.currency)) checks.push(check('instrument_supported', m.instrument_supported, 'fail', 'currency_invalid', 'The currency is not a three-letter code.', 'edit_revision'));
  else checks.push(check('instrument_supported', m.instrument_supported, 'pass', 'ok', word.pass, 'none'));

  // 5. Typed terms (ADP-02, #5456).
  const terms = fromExternal(input.dependencies.terms, 'terms', 'Typed terms validation comes from draft revisions (#5456), which are not built yet.');
  checks.push(check('typed_terms', m.typed_terms, terms.state, terms.code, terms.explanation, 'edit_revision'));

  // 6. Sources: every selected item must be available now, in the issuer's scope, at its pinned version.
  const byStatus: Partial<Record<SourceStatus, number>> = {};
  for (const s of input.sources) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  const counts = byStatus as Record<string, number>;
  if (!manifest) checks.push(check('sources_current', m.sources_current, 'fail', 'manifest_invalid', 'No source can be checked while the manifest is malformed.', 'edit_manifest'));
  else if (byStatus.unreadable) checks.push(check('sources_current', m.sources_current, 'unreadable', 'sources_unreadable', word.unreadable, 'edit_manifest', counts));
  else if (input.sources.some((s) => s.status !== 'available' && s.status !== 'unavailable')) checks.push(check('sources_current', m.sources_current, 'fail', 'sources_not_current', 'Some selected sources are missing, outside this project, revoked, expired, restricted or at a different version.', 'edit_manifest', counts));
  else if (byStatus.unavailable) checks.push(check('sources_current', m.sources_current, 'unavailable', 'sources_not_integrated', 'Some selected source kinds are not read by the package yet, so their access cannot be checked.', 'edit_manifest', counts));
  else checks.push(check('sources_current', m.sources_current, 'pass', 'ok', word.pass, 'none', counts));
  const superseded = input.sources.filter((s) => s.superseded).length;
  checks.push(superseded
    ? check('sources_latest', m.sources_latest, 'fail', 'newer_version_exists', 'A newer version of a selected deck exists; the pinned one is still the one shown.', 'pitch_deck', { superseded })
    : check('sources_latest', m.sources_latest, 'pass', 'ok', word.pass, 'none'));

  // 7. Audience: chosen, narrowly invited, and projected without exceeding what the stores allow.
  const recipients = manifest?.audience?.recipients ?? [];
  if (!manifest?.audience) checks.push(check('audience_selected', m.audience_selected, 'fail', 'audience_missing', 'No audience is chosen.', 'edit_audience'));
  else if (audience !== 'marketplace_teaser' && recipients.length === 0) checks.push(check('audience_selected', m.audience_selected, 'fail', 'recipients_missing', 'An invited release names its recipients.', 'edit_audience'));
  else checks.push(check('audience_selected', m.audience_selected, 'pass', 'ok', word.pass, 'none'));
  const policy = fromExternal(input.dependencies.distribution_policy, 'distribution_policy', 'No marketplace distribution policy is approved, so a teaser cannot be listed.');
  checks.push(check('distribution_policy', m.distribution_policy, policy.state, policy.code, policy.explanation, 'distribution_policy'));
  if (!audience) checks.push(check('audience_projection', m.audience_projection, 'fail', 'audience_missing', 'No audience is chosen.', 'edit_audience'));
  else {
    const exceeds = input.sources.filter((s) => admitsAudience(s, audience) === 'exceeds_audience').length;
    checks.push(exceeds
      ? check('audience_projection', m.audience_projection, 'fail', 'source_exceeds_audience', 'Some selected sources may not go to this audience under their own sharing rules. Remove them or change the audience; the release grants no access.', 'edit_manifest', { exceeds })
      : check('audience_projection', m.audience_projection, 'pass', 'ok', word.pass, 'none'));
  }

  // 8. Approval of this exact candidate (ADP-04, #5458).
  const rv = input.dependencies.review;
  if (rv.state === 'recorded' && rv.ok && rv.candidate_digest !== input.candidate_digest) {
    checks.push(check('candidate_review', m.candidate_review, 'fail', 'approval_for_other_candidate', 'The recorded approval is for a different candidate; this one needs its own review.', 'review'));
  } else {
    const r = fromExternal(rv, 'review', 'Review and approval of the exact candidate come from #5458, which is not built yet.');
    checks.push(check('candidate_review', m.candidate_review, r.state, r.code, r.explanation, 'review'));
  }

  // 9. Investor-specific access: what each recipient would receive under the stores' rules today.
  const outcome = { full: 0, partial: 0, none: 0, ineligible: 0, unreadable: 0 };
  for (const r of input.recipients) {
    if (r.state === 'unreadable') { outcome.unreadable += 1; continue; }
    if (r.state !== 'recorded') { outcome.ineligible += 1; continue; }
    const delivered = audience ? input.sources.filter((s) => retrievalDecision(s, audience, r, input.now) === 'deliver').length : 0;
    if (delivered === input.sources.length) outcome.full += 1; else if (delivered === 0) outcome.none += 1; else outcome.partial += 1;
  }
  if (outcome.unreadable) checks.push(check('recipient_access', m.recipient_access, 'unreadable', 'recipients_unreadable', word.unreadable, 'edit_audience', outcome));
  else if (outcome.ineligible) checks.push(check('recipient_access', m.recipient_access, 'fail', 'recipient_ineligible', 'Some recipients have no active account.', 'edit_audience', outcome));
  // Withheld items are the stores' rules working, so this is advisory: the release still grants nothing.
  else if (outcome.partial || outcome.none) checks.push(check('recipient_access', m.recipient_access === 'not_applicable' ? 'not_applicable' : 'advisory', 'fail', 'sources_withheld_for_recipients', 'Some recipients would not receive every source under their current grants; they are withheld, not granted.', 'data_room', outcome));
  else checks.push(check('recipient_access', m.recipient_access, 'pass', 'ok', word.pass, 'none', outcome));

  // 10. Closing readiness: separate from any release, and never passed on a missing record.
  const lg = input.dependencies.legal;
  if (lg.state === 'unavailable') checks.push(check('legal_prerequisites', m.legal_prerequisites, 'unavailable', 'legal_unavailable', 'Offering legal and template review records are not read by the package yet (#4811).', 'contracts'));
  else if (lg.state === 'unreadable') checks.push(check('legal_prerequisites', m.legal_prerequisites, 'unreadable', 'legal_unreadable', word.unreadable, 'contracts'));
  else if (!lg.template_active) checks.push(check('legal_prerequisites', m.legal_prerequisites, 'fail', 'template_inactive', 'The offering template is not active.', 'contracts'));
  else if (!lg.template_reviewed) checks.push(check('legal_prerequisites', m.legal_prerequisites, 'fail', 'template_unreviewed', 'The offering template has no recorded legal review.', 'contracts'));
  else checks.push(check('legal_prerequisites', m.legal_prerequisites, 'pass', 'ok', word.pass, 'none'));
  const auth = fromExternal(input.dependencies.representative_authority, 'authority', 'The issuer representative\'s authority is not recorded in a store the package reads.');
  checks.push(check('issuer_authority', m.issuer_authority, auth.state, auth.code, auth.explanation, 'company_link'));
  if (!family) checks.push(check('instrument_closing_rules', m.instrument_closing_rules, 'review_required', 'instrument_unfamiliar', 'No closing rules are known for this instrument; a reviewer must decide them.', 'review'));
  else if (INSTRUMENT_FAMILIES[family].closing_extra.length) checks.push(check('instrument_closing_rules', m.instrument_closing_rules, 'unavailable', 'vehicle_record_unavailable', 'The vehicle\'s own entity record is not read by the package yet.', 'contracts'));
  else checks.push(check('instrument_closing_rules', m.instrument_closing_rules, 'pass', 'ok', 'No closing record beyond the legal prerequisites is needed for this instrument.', 'none'));

  const dimensions = Object.fromEntries(DIMENSIONS.map((d) => {
    const inD = checks.filter((c) => c.dimension === d && c.state !== 'not_applicable');
    const blocking = inD.filter((c) => c.level === 'blocking' && c.state !== 'pass');
    const advisory = inD.filter((c) => c.level === 'advisory' && c.state !== 'pass').length;
    const state: DimensionState = blocking.some((c) => c.state === 'unreadable') ? 'unreadable'
      : blocking.some((c) => c.state === 'fail' || c.state === 'unavailable') ? 'blocked'
        : blocking.some((c) => c.state === 'review_required') ? 'review_required' : 'ready';
    return [d, { state, blocking: blocking.length, advisory }];
  })) as ReadinessResult['dimensions'];

  const dv = (f: ExternalFact | LegalFact) => (f.state === 'recorded' ? f.version : f.state);
  return {
    contract_version: D5457_CONTRACT_VERSION,
    policy_version: PACKAGE_POLICY_VERSION,
    preparation_uid: input.preparation.uid,
    revision_id: input.revision.id,
    candidate_digest: input.candidate_digest,
    sources_digest: input.sources_digest,
    evaluated_at: new Date(input.now).toISOString(),
    fresh_until: new Date(input.now + READINESS_TTL_MS).toISOString(),
    dependency_versions: {
      d5454_contract: '1', terms: dv(input.dependencies.terms), review: dv(input.dependencies.review), legal: dv(input.dependencies.legal),
      distribution_policy: dv(input.dependencies.distribution_policy), representative_authority: dv(input.dependencies.representative_authority),
    },
    audience,
    instrument_family: family,
    dimensions,
    release_ready: dimensions.content_completeness.state === 'ready' && dimensions.release_eligibility.state === 'ready'
      && dimensions.investor_access.state === 'ready',
    closing_ready: dimensions.closing_readiness.state === 'ready',
    checks,
  };
}

/**
 * Whether a stored result still describes the candidate: same candidate, same sources, same policy, inside its
 * freshness limit. `current` is advisory for a screen; the release re-evaluates regardless.
 */
export function preflightFreshness(
  result: Pick<ReadinessResult, 'candidate_digest' | 'sources_digest' | 'policy_version' | 'fresh_until'>,
  now: { candidate_digest: string; sources_digest: string; at: number },
): 'current' | 'stale' | 'expired' {
  if (result.candidate_digest !== now.candidate_digest || result.sources_digest !== now.sources_digest || result.policy_version !== PACKAGE_POLICY_VERSION) return 'stale';
  const until = Date.parse(result.fresh_until);
  return Number.isFinite(until) && now.at < until ? 'current' : 'expired';
}

/** What the other packages supply today: nothing. Each stays `unavailable` until its owner wires it. */
export const UNINTEGRATED_DEPENDENCIES: ReadinessInput['dependencies'] = Object.freeze({
  terms: { state: 'unavailable' }, review: { state: 'unavailable' }, legal: { state: 'unavailable' },
  distribution_policy: { state: 'unavailable' }, representative_authority: { state: 'unavailable' },
}) as ReadinessInput['dependencies'];

/** Statements `readPackageReadiness` may run: preparation, revision, the issuer pair (two), sources, recipients. */
export const READINESS_QUERY_MAX = 2 + 2 + RESOLVE_QUERY_MAX + RECIPIENT_QUERY_MAX;

export type ReadinessRead =
  | { ok: true; result: ReadinessResult; sources: Array<ResolvedItem & { admission: string }> }
  | { ok: false; code: 'not_found' | 'no_revision' | 'unreadable' };

/**
 * Gathers the facts for one preparation's working or submitted revision and evaluates them. Only a caller holding
 * D5454 `read` on the row's deployment gets an answer; anyone else, and a preparation that does not exist, is
 * `not_found`. The sources list is the authoring/review view: it names items inside the issuer's scope only.
 */
export async function readPackageReadiness(
  env: Env, user: User | null | undefined, preparationUid: unknown, ctx: CapabilityContext & { pointer?: 'working' | 'submitted'; now?: number },
): Promise<ReadinessRead> {
  if (typeof preparationUid !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(preparationUid)) return { ok: false, code: 'not_found' };
  // Refuse before any read: the capability needs a platform admin on this deployment, whatever the row says.
  if (!preparationCapabilities(env, user, null, ctx).has('read')) return { ok: false, code: 'not_found' };
  const now = ctx.now ?? Date.now();
  let prep: any;
  try {
    prep = await env.DB.prepare(
      `SELECT id, uid, scope_code, company_id, project_id, working_revision_id, submitted_revision_id
         FROM deal_preparations WHERE uid = ? AND scope_code = ? LIMIT 1`,
    ).bind(preparationUid, deploymentScope(env)).first<any>();
  } catch (e) {
    if (isMissingPreparationTable(e)) return { ok: false, code: 'not_found' };
    return { ok: false, code: 'unreadable' };
  }
  if (!prep || !preparationCapabilities(env, user, prep, ctx).has('read')) return { ok: false, code: 'not_found' };
  const revisionId = ctx.pointer === 'submitted' ? prep.submitted_revision_id : prep.working_revision_id;
  if (revisionId == null) return { ok: false, code: 'no_revision' };
  let rev: any;
  let content: Record<string, unknown>;
  try {
    rev = await env.DB.prepare(
      `SELECT id, content_json, content_sha256, company_id, project_id FROM deal_preparation_revisions
        WHERE id = ? AND preparation_id = ? LIMIT 1`,
    ).bind(revisionId, prep.id).first<any>();
    if (!rev) return { ok: false, code: 'no_revision' };
    const parsed = JSON.parse(String(rev.content_json));
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, code: 'unreadable' };
    content = parsed;
  } catch {
    return { ok: false, code: 'unreadable' };
  }
  const projectId = Number(prep.project_id);
  let issuer: IssuerResult | 'unreadable';
  let currentCompany: { company_id: unknown } | null | 'unreadable';
  try {
    issuer = await resolveIssuerPair(env, { company_id: prep.company_id, project_id: prep.project_id });
    // A refused pair fails the issuer check on its own code before drift is compared.
    currentCompany = issuer.ok ? { company_id: issuer.company_id } : null;
  } catch {
    issuer = 'unreadable';
    currentCompany = 'unreadable';
  }
  const manifest = parseManifest(content);
  const items = manifest.ok ? manifest.manifest.items : [];
  const sources = await resolveManifestSources(env, projectId, items, now);
  const recipients = manifest.ok && manifest.manifest.audience ? await readRecipientFacts(env, projectId, manifest.manifest.audience.recipients) : [];
  const candidate = await candidateDigest({
    preparation_uid: String(prep.uid), revision_id: Number(rev.id), content_sha256: String(rev.content_sha256),
    company_id: Number(rev.company_id), project_id: Number(rev.project_id), manifest: manifest.ok ? manifest.manifest : { items: [], audience: null },
  });
  const result = evaluateReadiness({
    preparation: { uid: String(prep.uid), company_id: Number(prep.company_id), project_id: projectId },
    revision: { id: Number(rev.id), content, content_sha256: String(rev.content_sha256), company_id: Number(rev.company_id), project_id: Number(rev.project_id) },
    issuer, current_company: currentCompany, manifest, sources, recipients,
    dependencies: UNINTEGRATED_DEPENDENCIES,
    candidate_digest: candidate, sources_digest: await sourcesDigest(sources), now,
  });
  const audience = manifest.ok ? manifest.manifest.audience?.audience ?? null : null;
  return { ok: true, result, sources: sources.map((s) => ({ ...s, admission: audience ? admitsAudience(s, audience) : 'no_audience' })) };
}
