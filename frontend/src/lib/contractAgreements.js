// D5050 (#5050): the licence agreements in Contracts — the filter choices the Worker accepts on
// GET /api/admin/contracts (services/contractAgreementSources.ts) and the context line a row shows.
import { PROGRAMS } from './programGrants.js';

/** `agreement_type`, in the Worker's order. */
export const AGREEMENT_TYPE_OPTIONS = [
  ['', 'Any agreement type'],
  ['territory_licence', 'Territory licence'],
  ['package', 'Package agreement'],
  ['program_licence', 'Program licence'],
  ['program_schedule_addendum', 'Program schedule / addendum'],
];

/** `agreement_status`: the legal document's own state, never the program grant's. */
export const LEGAL_STATUS_OPTIONS = [
  ['', 'Any legal state'],
  ['draft', 'Draft'],
  ['awaiting_signature', 'Awaiting signature'],
  ['executed', 'Executed'],
  ['superseded', 'Superseded'],
  ['voided', 'Voided'],
];

/** The Axal VC packages (#5021 builds their store; the keys are D5049's). */
export const PACKAGE_OPTIONS = [
  ['', 'Any package'],
  ['core_network', 'Core Network'],
  ['talent_learning', 'Talent & Learning'],
  ['venture_building', 'Venture Building'],
  ['full_axal_vc', 'Full Axal VC operating system'],
];

export const PROGRAM_OPTIONS = [['', 'Any program'], ...PROGRAMS.map((p) => [p.key, p.name])];

/**
 * What a row says about the licence agreement it is, without opening it: the type, the licence and its
 * territory, and the program or package. Null when the row is not a licence agreement.
 */
export function agreementContextLine(agreement) {
  if (!agreement) return null;
  const territory = (agreement.territory || []).join(', ');
  return [
    agreement.agreement_type_label,
    agreement.licence_ref || agreement.licence_uid,
    territory || null,
    agreement.program_name || agreement.package_name || null,
    agreement.package_version ? `v${agreement.package_version}` : null,
  ].filter(Boolean).join(' · ');
}

/** The template that produced it, as a row prints it. */
export function agreementTemplateLine(agreement) {
  if (!agreement) return null;
  return agreement.template_version ? `${agreement.template_slug} v${agreement.template_version}` : agreement.template_slug;
}
