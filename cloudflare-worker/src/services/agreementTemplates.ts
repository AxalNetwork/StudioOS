/**
 * D5049 (#5049, part 2 of #5047) — the templates package and program agreements are drafted from, the
 * namespaced values that fill them, and the readiness a send is held to.
 *
 * CONTRACTS OWNS THE TEMPLATES. Each catalog slug below is a row HQ authors in the Contracts library
 * (`legal_templates`); this file names which slugs exist for which package or program and kind, never their
 * text. A slug HQ has not authored reads "missing template", and nothing can be drafted from it.
 *
 * THE MERGE SCHEMA IS NAMESPACED: `licence.*`, `package.*`, `program.*`, `grant.*`, `terms.*`, `signer.*`,
 * `entity.*`, `agreement.*`. Only namespaced keys are ever filled, so a template still using an ad hoc flat
 * key (`{{brand_name}}`) leaves it standing, reported, and the send refused (D4671's rule: any `{{field}}`
 * left in the body blocks the send).
 *
 * A VALUE NOBODY RECORDED IS NULL, and the field stays visible and named (`renderContract`, D110): an empty
 * string would turn "never agreed" into a contract that reads complete.
 */
import type { LicenceRow } from './licenceLedgerCore';
import type { LicenceTerms } from './licenceTerms';
import { mergeValues, renderContract, unresolvedFields } from './licenceContract';
import { programOf, termsOf } from './programGrants';
import { termLine } from './programSchedule';
import { COUNSEL_REVIEW_SLUGS } from './templateFormat';
import type { AgreementKind } from './programAgreements';

export const MERGE_NAMESPACES = ['licence', 'package', 'program', 'grant', 'terms', 'signer', 'entity', 'agreement'] as const;
export type MergeNamespace = typeof MERGE_NAMESPACES[number];

/** The four Axal VC packages a package agreement can name (#5021 builds their store; until then, these keys). */
export const PACKAGES: Array<{ key: string; name: string }> = [
  { key: 'core_network', name: 'Core Network' },
  { key: 'talent_learning', name: 'Talent & Learning' },
  { key: 'venture_building', name: 'Venture Building' },
  { key: 'full_axal_vc', name: 'Full Axal VC operating system' },
];
export const packageOf = (key: string | null | undefined) => PACKAGES.find((p) => p.key === key) || null;

export type CatalogTemplate = {
  slug: string;
  /** The kinds a version drafted from it may be. */
  kinds: readonly AgreementKind[];
  program_key?: string;
  package_key?: string;
  title: string;
};

const PROGRAM_KINDS = ['program_licence', 'program_addendum'] as const;
const PACKAGE_KINDS = ['package_master', 'package_addendum'] as const;

/** The issue's slugs, each bound to the package or program it licenses. */
export const AGREEMENT_TEMPLATES: readonly CatalogTemplate[] = [
  { slug: 'package_core_network_master', kinds: PACKAGE_KINDS, package_key: 'core_network', title: 'Core Network Package Agreement' },
  { slug: 'package_talent_learning_master', kinds: PACKAGE_KINDS, package_key: 'talent_learning', title: 'Talent & Learning Package Agreement' },
  { slug: 'package_venture_building_master', kinds: PACKAGE_KINDS, package_key: 'venture_building', title: 'Venture Building Package Agreement' },
  { slug: 'package_full_axal_vc_master', kinds: PACKAGE_KINDS, package_key: 'full_axal_vc', title: 'Full Axal VC Package Agreement' },
  { slug: 'program_spinout_lab_licence', kinds: PROGRAM_KINDS, program_key: 'spinout-lab', title: 'Spin-Out Lab Programme Licence' },
  { slug: 'program_ai_native_venture_licence', kinds: PROGRAM_KINDS, program_key: 'ai-native-venture', title: 'AI-native Venture Programme Licence' },
  { slug: 'program_product_testing_licence', kinds: PROGRAM_KINDS, program_key: 'product-testing', title: 'Product Testing Programme Licence' },
  { slug: 'program_learning_licence', kinds: PROGRAM_KINDS, program_key: 'learning', title: 'Learning Programme Licence' },
  { slug: 'program_mentor_access_licence', kinds: PROGRAM_KINDS, program_key: 'mentor-cohorts', title: 'Mentor Access Programme Licence' },
  { slug: 'program_investor_access_licence', kinds: PROGRAM_KINDS, program_key: 'investor-cohorts', title: 'Investor Access Programme Licence' },
  { slug: 'program_referral_partners_licence', kinds: PROGRAM_KINDS, program_key: 'referral-partners', title: 'Referral Partners Programme Licence' },
  { slug: 'program_refer_earn_terms', kinds: PROGRAM_KINDS, program_key: 'refer-and-earn', title: 'Refer & Earn Programme Terms' },
  { slug: 'program_perks_licence', kinds: PROGRAM_KINDS, program_key: 'perks', title: 'Perks Programme Licence' },
  { slug: 'program_influencer_licence', kinds: PROGRAM_KINDS, program_key: 'influencer', title: 'Influencer Programme Licence' },
];
export const catalogTemplate = (slug: string) => AGREEMENT_TEMPLATES.find((t) => t.slug === slug) || null;

/**
 * Whether a template slug may draft this kind of version for this scope; null when it may, else why not.
 * A program template drafts only its own program's licence or addenda, a package template only its package's.
 */
export function catalogRefusal(slug: string, kind: AgreementKind, scope: { program_key?: string | null; package_key?: string | null }): string | null {
  const t = catalogTemplate(slug);
  if (!t) return 'That template is not one of the package or program agreement templates.';
  if (!t.kinds.includes(kind)) return `${t.title} drafts ${t.kinds.join(' or ')} versions, not ${kind}.`;
  if (t.program_key && scope.program_key !== t.program_key) return `${t.title} is for the ${t.program_key} program.`;
  if (t.package_key && scope.package_key !== t.package_key) return `${t.title} is for the ${t.package_key} package.`;
  return null;
}

/** Counsel review: the library's own marking, and every package and program agreement until counsel signs one off (D5049 §5). */
export const counselReviewRequired = (slug: string) => COUNSEL_REVIEW_SLUGS.has(slug) || !!catalogTemplate(slug);

export type MergeInput = {
  licence: LicenceRow;
  territories: string[];
  seats: Array<{ seat_type: string; seats_licensed: number }>;
  licenceTerms: LicenceTerms | null;
  /** The program grant, for program kinds; null when the licence holds none. */
  grant: Record<string, unknown> | null;
  program_key: string | null;
  package_key: string | null;
  package_version: number | null;
  signer: { name: string | null; email: string | null } | null;
  agreement: { kind: AgreementKind; prepared_on: string };
};

/**
 * Every namespaced value a version can be filled from, frozen into the draft. Flat keys are not produced, so
 * a template that uses one leaves it unresolved.
 */
export function agreementMergeValues(i: MergeInput): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  // licence.* and terms.*: the master agreement's own values (D803), namespaced only.
  for (const [k, v] of Object.entries(mergeValues(i.licence, i.territories, i.seats, i.licenceTerms))) {
    if (k.startsWith('licence.') || k.startsWith('terms.')) out[k] = v;
  }
  out['licence.uid'] = i.licence.uid;
  out['licence.kind'] = i.licence.kind || null;
  out['entity.legal_name'] = i.licence.legal_entity_name || null;
  out['entity.brand_name'] = i.licence.brand_name || null;
  out['entity.registered_address'] = i.licence.registered_address || null;
  out['signer.name'] = i.licence.signatory_name || i.signer?.name || null;
  out['signer.title'] = i.licence.signatory_title || null;
  out['signer.email'] = i.signer?.email || null;
  if (i.program_key) {
    const p = programOf(i.program_key);
    out['program.key'] = i.program_key;
    out['program.name'] = p?.name ?? null;
  }
  if (i.grant && i.program_key) {
    const terms = termsOf(i.grant, i.program_key);
    for (const [k, v] of Object.entries(terms)) out[`grant.${k}`] = v === null || v === undefined ? null : termLine(k, v, terms);
    out['grant.state'] = String(i.grant.state ?? '') || null;
    out['grant.revision'] = i.grant.terms_revision == null ? null : String(i.grant.terms_revision);
  }
  if (i.package_key) {
    out['package.key'] = i.package_key;
    out['package.name'] = packageOf(i.package_key)?.name ?? null;
    out['package.version'] = i.package_version == null ? null : String(i.package_version);
  }
  out['agreement.kind'] = i.agreement.kind;
  out['agreement.prepared_on'] = i.agreement.prepared_on;
  return out;
}

/** Renders a template body from the values; the body is what is stored, previewed and sent. */
export function renderAgreement(templateBody: string, values: Record<string, string | null>) {
  const { body } = renderContract(templateBody, values);
  return { body, unresolved: unresolvedFields(body) };
}

export type Readiness = {
  ready: boolean;
  missing_template: boolean;
  template_reason: string | null;
  /** Fields the licence's legal entity or its signatory leave empty. */
  missing_entity_fields: string[];
  missing_signatory_fields: string[];
  /** Package, program, grant and licence-terms fields with no recorded value. */
  missing_terms: string[];
  /** Every `{{field}}` still in the body, namespaced or not. */
  unresolved_fields: string[];
  /** The ad hoc, un-namespaced keys among them: the template must be rewritten to the schema. */
  non_namespaced_fields: string[];
  counsel_review: { required: boolean; reason: string | null };
};

/** What stands between a version and a send, read from its body (never from live data). */
export function readinessOf(o: { unresolved: string[]; templateMissing?: string | null; slug: string; signerKnown: boolean }): Readiness {
  const ns = (f: string) => f.split('.')[0];
  const unresolved = [...o.unresolved];
  const flat = unresolved.filter((f) => !f.includes('.') || !(MERGE_NAMESPACES as readonly string[]).includes(ns(f)));
  const counsel = counselReviewRequired(o.slug);
  const signerMissing = unresolved.filter((f) => ns(f) === 'signer');
  if (!o.signerKnown && !signerMissing.includes('signer.email')) signerMissing.push('signer.email');
  return {
    ready: !o.templateMissing && unresolved.length === 0 && o.signerKnown,
    missing_template: !!o.templateMissing,
    template_reason: o.templateMissing ?? null,
    missing_entity_fields: unresolved.filter((f) => ns(f) === 'entity'),
    missing_signatory_fields: signerMissing,
    missing_terms: unresolved.filter((f) => ['package', 'program', 'grant', 'terms', 'licence'].includes(ns(f))),
    unresolved_fields: unresolved,
    non_namespaced_fields: flat,
    counsel_review: {
      required: counsel,
      reason: counsel ? 'Counsel has not reviewed this agreement template. Sending does not lift the marking.' : null,
    },
  };
}
