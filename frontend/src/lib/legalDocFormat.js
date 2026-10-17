/**
 * Frontend mirror of `cloudflare-worker/src/services/legalDocFormat.ts`.
 *
 * Keep the two in lock-step: the admin live preview must render exactly what
 * the worker bakes into the exported PDF and the signed e-sign document — same
 * Markdown normalization, same standardized preamble, same execution block.
 */

export const AXAL_LEGAL_ADDRESS = '16192 Coastal Highway, Lewes, Delaware 19958';
export const AXAL_LEGAL_EMAIL = 'legal@axal.vc';
export const AXAL_SIGNATORY_NAME = 'Joseph Gabriel Guillaume Lauzier';
// Management's title; the graduation certificate signs as Management. D705:
// every other party carries its own `signatoryTitle` (see the worker file).
export const AXAL_SIGNATORY_TITLE = 'Managing Partner';

export const AXAL_ENTITIES = {
  management: { key: 'management', name: 'Axal VC Management LLC', descriptor: 'a Delaware limited liability company', signatoryTitle: 'Managing Partner' },
  holdings: { key: 'holdings', name: 'Axal VC Holdings LLC', descriptor: 'a Delaware limited liability company', signatoryTitle: 'Managing Partner' },
  gp: { key: 'gp', name: 'Axal VC GP LLC', descriptor: 'a Delaware limited liability company', signatoryTitle: 'General Partner' },
  fund: {
    key: 'fund', name: 'Axal VC Spin-Out Lab Fund I LP',
    descriptor: 'a Delaware limited partnership, acting by its general partner Axal VC GP LLC',
    signatoryTitle: 'General Partner', through: 'By: Axal VC GP LLC, its general partner',
  },
};

// D705 — the Fund signs these, through its general partner (see the worker file).
const FUND_SIGNS_D705 = new Set([
  'subscription', 'investor_subscription_pro', 'investor_subscription_inst', 'subscription booklet & lpa',
  'co-investment side letter',
  'safe', 'term_sheet', 'spa', 'voting_rights',
]);

// D706 — the Fund I catalog entries, routed by name (see the worker file).
const FUND_PARTY_SLUGS_D706 = new Set([
  'lp_side_letter', 'lp_interest_transfer', 'investment_management_agreement',
  'clawback_guarantee', 'management_rights_letter', 'pro_rata_information_rights_side_letter',
]);
const GP_PARTY_SLUGS_D706 = new Set([
  'lpa_amended_restated', 'lpa_initial', 'gp_closing_certificate', 'lpac_charter', 'gp_llc_agreement',
  'gp_fund_formation_consent', 'carried_interest_award_letter',
]);

// D716 — the notices and the Subscription Booklet (see the worker file).
const FUND_PARTY_SLUGS_D716 = new Set([
  'capital_call_notice', 'distribution_notice', 'default_notice', 'management_fee_statement', 'subscription_booklet',
]);
const GP_PARTY_SLUGS_D716 = new Set(['management_fee_invoice']);
const HOLDINGS_PARTY_SLUGS_D716 = new Set(['platform_licence_fee_invoice']);

// D707 — the two platform IP licences (migration 471), Holdings as licensor,
// and the operating-partner agreements, Management's, routed by name.
// `partner_capital` stays out: a capital partnership is an investor relationship.
const HOLDINGS_PARTY_SLUGS_D707 = new Set(['platform_ip_licence_management_admin', 'platform_ip_licence_fund_admin']);
const MANAGEMENT_PARTY_SLUGS_D707 = new Set(['partner_msa_v1', 'partner_services', 'partner_equity', 'partner_revshare', 'partner_custom', 'partner_nda_nonsolicit']);

export function axalEntityKeyForDoc(slugOrType, category) {
  const s = String(slugOrType || '').toLowerCase();
  if (FUND_PARTY_SLUGS_D706.has(s)) return 'fund';
  if (GP_PARTY_SLUGS_D706.has(s)) return 'gp';
  if (FUND_PARTY_SLUGS_D716.has(s)) return 'fund';
  if (GP_PARTY_SLUGS_D716.has(s)) return 'gp';
  if (HOLDINGS_PARTY_SLUGS_D716.has(s)) return 'holdings';
  if (FUND_SIGNS_D705.has(s)) return 'fund';
  // D707 — by name, so a name always wins over the regex fallback below.
  if (HOLDINGS_PARTY_SLUGS_D707.has(s)) return 'holdings';
  if (MANAGEMENT_PARTY_SLUGS_D707.has(s)) return 'management';
  const gpEntityDocs = new Set([
    'spv joinder agreement', 'strategic side letter / focused spv', 'lpa', 'ppm',
    'mgmt_company', 'accreditation_v1', 'investor_nda_axal', 'carried_interest',
    'secondary purchase agreement',
  ]);
  if (gpEntityDocs.has(s) || /\b(lpa|ppm|subscription|side letter|spv|fund)\b/.test(s)) return 'gp';
  const holdingsDocs = new Set(['ip_license', 'ip_background_schedule']);
  if (holdingsDocs.has(s) || /\b(trademark|brand[\s_-]?ip|domain)\b/.test(s)) return 'holdings';
  return 'management';
}

// D716 — the seven notice types and the packet (see the worker file).
const NOTICE_SLUGS = new Set([
  'capital_call_notice', 'distribution_notice', 'default_notice', 'management_fee_statement',
  'management_fee_invoice', 'platform_licence_fee_invoice', 'payment_instructions_letter',
]);
const BOOKLET_SLUGS = new Set(['subscription_booklet']);

const POLICY_SLUGS = new Set([
  'tos_v1', 'privacy_v1', 'aml_kyc', 'form_adv',
  // D706 (Fund I catalog)
  'compliance_manual_code_of_ethics', 'investor_privacy_notice_reg_sp', 'valuation_policy',
  'conflicts_allocation_policy',
  // D716 — the booklet cover's legend (migration 478)
  'securities_legend',
]);
const UNILATERAL_SLUGS = new Set([
  'section_83b', 'accreditation_v1', 'ein_application_kit', 'sg_acra_form_45_kit',
  'uk_form_in01_kit', 'ee_e_residency_application_kit', 'data_access_acknowledgment_admin',
  'mentor_engagement_disclaimer',
  // D706 (Fund I catalog)
  'certificate_of_limited_partnership_de', 'mfn_election_form', 'lp_investor_questionnaire',
  'lp_aml_kyc_certification', 'lp_tax_status_certification', 'lp_electronic_delivery_consent',
  'form_d_filing_kit', 'bad_actor_questionnaire_506d',
]);
const RESOLUTION_SLUGS = new Set([
  'ic_charter',
  // D706 (Fund I catalog)
  'gp_closing_certificate', 'lpac_charter', 'gp_fund_formation_consent',
]);
const CORPORATE_SLUGS = new Set([
  'certificate_of_incorporation_de', 'bylaws', 'uk_articles_of_association',
  'uk_memorandum_of_association', 'sg_constitution', 'ee_articles_of_association',
  'operating_agreement', 'member_consent', 'ee_founding_resolution',
  'sg_first_directors_resolution', 'equity_split', 'stock_purchase_agreement',
  'ip_license', 'ip_background_schedule',
]);

export function classifyDocument(slugOrType) {
  const s = String(slugOrType || '').toLowerCase();
  if (NOTICE_SLUGS.has(s)) return 'notice';
  if (BOOKLET_SLUGS.has(s)) return 'booklet';
  if (POLICY_SLUGS.has(s)) return 'policy';
  if (UNILATERAL_SLUGS.has(s)) return 'unilateral';
  if (RESOLUTION_SLUGS.has(s)) return 'resolution';
  if (CORPORATE_SLUGS.has(s)) return 'corporate';
  return 'agreement';
}

function stripInline(s) {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    .replace(/(^|[^\w*])\*([^\s*\n](?:[^*\n]*?[^\s*\n])?)\*(?![\w*])/g, '$1$2')
    .replace(/~~([^~\n]+?)~~/g, '$1')
    .replace(/`([^`\n]+?)`/g, '$1')
    .replace(/\\([\\`*_{}\[\]()#+\-.!>~])/g, '$1');
}

export function normalizeLegalBody(input) {
  if (!input) return '';
  const text = String(input).replace(/\r\n?/g, '\n');
  const out = [];
  for (const rawLine of text.split('\n')) {
    let line = rawLine.replace(/[ \t]+$/g, '');
    if (/^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)) { out.push(''); continue; }
    line = line.replace(/^(\s{0,3})(?:>[ \t]?)+/, '$1');
    line = line.replace(/^(\s{0,3})#{1,6}[ \t]+/, '$1');
    line = line.replace(/[ \t]+#+[ \t]*$/, '');
    const task = line.match(/^(\s*)[-*+][ \t]+\[([ xX])\][ \t]+(.*)$/);
    if (task) {
      const mark = task[2].trim() ? '[X]' : '[  ]';
      line = `${task[1]}${mark} ${task[3]}`;
    } else {
      const bullet = line.match(/^(\s*)[-*+][ \t]+(.*)$/);
      if (bullet) line = `${bullet[1]}• ${bullet[2]}`;
    }
    out.push(stripInline(line));
  }
  const collapsed = [];
  for (const l of out) {
    if (l.trim() === '' && collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === '') continue;
    collapsed.push(l);
  }
  while (collapsed.length && collapsed[0].trim() === '') collapsed.shift();
  while (collapsed.length && collapsed[collapsed.length - 1].trim() === '') collapsed.pop();
  return collapsed.join('\n');
}

const SIG_STARTER =
  /^(signed electronically\b|by signing electronically\b|in witness whereof\b|signed\s*:|signature\s*:)/i;
const SIG_LINE = /^(by\s*:|name\s*:|title\s*:|date\s*:|_{3,}|•?\s*_{3,})/i;
const HR_LINE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;

export function stripTrailingSignatureBlock(body) {
  let lines = String(body || '').split('\n');
  let removedAny = false;
  for (;;) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    if (!lines.length) break;
    if (HR_LINE.test(lines[lines.length - 1].trim())) { lines.pop(); removedAny = true; continue; }
    let start = lines.length;
    while (start > 0 && lines[start - 1].trim() !== '') start--;
    const para = lines.slice(start);
    const firstStarts = SIG_STARTER.test(para[0].trim());
    const allSigLines = para.every((l) => { const t = l.trim(); return SIG_LINE.test(t) || /^[_\s]{3,}$/.test(t); });
    if (firstStarts || allSigLines) { lines = lines.slice(0, start); removedAny = true; continue; }
    break;
  }
  return removedAny ? lines.join('\n').replace(/\n+$/, '') : body;
}

const BLANK_LINE = '_________________________';

export function buildPreamble(opts) {
  const title = (opts.documentTitle || 'Agreement').trim();
  const date = (opts.effectiveDate || '').trim() || BLANK_LINE;
  const ent = AXAL_ENTITIES[opts.axalEntityKey || 'management'];
  const entityName = (opts.axalEntityName || '').trim() || ent.name;
  const descriptor = (opts.axalEntityDescriptor || '').trim() || ent.descriptor;
  const counterparty = (opts.counterpartyName || '').trim() || '[Counterparty Legal Name]';
  return (
    `This ${title} is made and entered into as of ${date} (the "Effective Date"), ` +
    `by and between ${entityName}, ${descriptor} with its principal legal address at ` +
    `${AXAL_LEGAL_ADDRESS}, and ${counterparty} (the "Counterparty").`
  );
}

// D716 — a notice's addressee lines (see the worker file).
export function buildAddresseeBlock(opts) {
  const to = (opts.to || '').trim() || '[Addressee]';
  const lp = opts.lpNumber == null ? '' : String(opts.lpNumber).trim();
  if (lp) return [`To: ${to}`, `Limited partner no. L${lp}`];
  if (opts.from && AXAL_ENTITIES[opts.from]) return [`From: ${AXAL_ENTITIES[opts.from].name}, ${AXAL_LEGAL_ADDRESS}`, `To: ${to}`];
  return [`To: ${to}`];
}

const BLANK_SIG = 'By: ___________________________';

export function buildExecutionBlock(opts) {
  const kind = opts.kind || 'agreement';
  const ent = AXAL_ENTITIES[opts.axalEntityKey || 'management'] || AXAL_ENTITIES.management;
  const axalName = (opts.axalEntityName || '').trim() || ent.name;
  const cpName = (opts.counterpartyName || '').trim();
  const cpDate = (opts.signedDate || '').trim();

  const axalParty = {
    role: 'axal',
    heading: axalName,
    ...(ent.through ? { through: ent.through } : {}),
    by: BLANK_SIG,
    name: `Name: ${AXAL_SIGNATORY_NAME}`,
    title: `Title: ${ent.signatoryTitle}`,
    date: cpDate ? `Date: ${cpDate}` : 'Date: ___________________________',
    isSigner: kind === 'resolution',
  };
  const counterparty = {
    role: 'counterparty',
    heading: cpName || '[Counterparty Legal Name]',
    by: BLANK_SIG,
    name: cpName ? `Name: ${cpName}` : 'Name: ___________________________',
    title: (opts.counterpartyTitle || '').trim() ? `Title: ${String(opts.counterpartyTitle).trim()}` : 'Title: ___________________________',
    date: cpDate ? `Date: ${cpDate}` : 'Date: ___________________________',
    isSigner: true,
  };

  if (kind === 'resolution') {
    return { recital: 'The undersigned, being duly authorized, executes this instrument as of the date written below.', parties: [axalParty] };
  }
  // D716 — a notice is issued, not signed; the booklet's blocks are per part.
  if (kind === 'notice') return { recital: '', parties: [{ ...axalParty, by: '', isSigner: false }] };
  if (kind === 'booklet') return { recital: '', parties: [] };
  if (kind === 'unilateral') {
    return { recital: 'IN WITNESS WHEREOF, the undersigned has executed this instrument as of the date written below.', parties: [counterparty] };
  }
  if (kind === 'corporate') {
    const company = {
      role: 'counterparty',
      heading: cpName || '[Company Legal Name]',
      by: BLANK_SIG,
      name: cpName ? `Name: ${cpName}` : 'Name: ___________________________',
      title: (opts.counterpartyTitle || '').trim() ? `Title: ${String(opts.counterpartyTitle).trim()}` : 'Title: ___________________________',
      date: cpDate ? `Date: ${cpDate}` : 'Date: ___________________________',
      isSigner: true,
    };
    return { recital: 'IN WITNESS WHEREOF, the Company has caused this instrument to be executed by its duly authorized officer as of the date written below.', parties: [company] };
  }
  return {
    recital:
      'IN WITNESS WHEREOF, the parties have executed this Agreement as of the Effective Date. ' +
      'By signing electronically below, each party agrees that an electronic signature has the same ' +
      'legal effect as a handwritten signature under the U.S. ESIGN Act (15 U.S.C. § 7001 et seq.) and UETA.',
    parties: [axalParty, counterparty],
  };
}

// D716 — the booklet's nine parts, in order (see the worker file).
export const SUBSCRIPTION_BOOKLET_PARTS = [
  { part: 1, title: 'Cover', slug: 'securities_legend', block: null },
  { part: 2, title: 'Instructions and Checklist', slug: null, block: null },
  { part: 3, title: 'Subscription Agreement', slug: 'subscription', block: { kind: 'agreement', axalEntityKey: 'fund' } },
  { part: 4, title: 'Investor Questionnaire', slug: 'lp_investor_questionnaire', block: { kind: 'unilateral' } },
  { part: 5, title: 'AML/KYC and Beneficial Ownership Certification', slug: 'lp_aml_kyc_certification', block: { kind: 'unilateral' } },
  { part: 6, title: 'Tax Status Certification', slug: 'lp_tax_status_certification', block: { kind: 'unilateral' } },
  { part: 7, title: 'Electronic Delivery Consent', slug: 'lp_electronic_delivery_consent', block: { kind: 'unilateral' } },
  { part: 8, title: 'Signature Pages', slug: 'lpa_amended_restated', block: { kind: 'unilateral' } },
  { part: 9, title: 'Acceptance by the General Partner', slug: 'gp_closing_certificate', block: { kind: 'resolution', axalEntityKey: 'fund' } },
];
