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
export const AXAL_SIGNATORY_TITLE = 'Managing Partner';

export const AXAL_ENTITIES = {
  management: { key: 'management', name: 'Axal VC Management LLC', descriptor: 'a Delaware limited liability company' },
  holdings: { key: 'holdings', name: 'Axal VC Holdings LLC', descriptor: 'a Delaware limited liability company' },
  gp: { key: 'gp', name: 'Axal VC GP LLC', descriptor: 'a Delaware limited liability company' },
  fund: { key: 'fund', name: 'Axal VC Fund I, LP', descriptor: 'a Delaware limited partnership, acting by its general partner Axal VC GP LLC' },
};

export function axalEntityKeyForDoc(slugOrType, category) {
  const s = String(slugOrType || '').toLowerCase();
  const fundEntityDocs = new Set([
    'subscription booklet & lpa', 'spv joinder agreement', 'co-investment side letter',
    'strategic side letter / focused spv', 'lpa', 'ppm', 'subscription',
    'mgmt_company', 'investor_subscription_pro', 'investor_subscription_inst',
    'accreditation_v1', 'investor_nda_axal', 'carried_interest',
    'safe', 'term_sheet', 'spa', 'voting_rights', 'secondary purchase agreement',
  ]);
  if (fundEntityDocs.has(s) || /\b(lpa|ppm|subscription|side letter|spv|fund)\b/.test(s)) return 'gp';
  const holdingsDocs = new Set(['ip_license', 'ip_background_schedule']);
  if (holdingsDocs.has(s) || /\b(trademark|brand[\s_-]?ip|domain)\b/.test(s)) return 'holdings';
  return 'management';
}

const POLICY_SLUGS = new Set(['tos_v1', 'privacy_v1', 'aml_kyc', 'form_adv']);
const UNILATERAL_SLUGS = new Set([
  'section_83b', 'accreditation_v1', 'ein_application_kit', 'sg_acra_form_45_kit',
  'uk_form_in01_kit', 'ee_e_residency_application_kit', 'data_access_acknowledgment_admin',
  'mentor_engagement_disclaimer',
]);
const RESOLUTION_SLUGS = new Set(['ic_charter']);
const CORPORATE_SLUGS = new Set([
  'certificate_of_incorporation_de', 'bylaws', 'uk_articles_of_association',
  'uk_memorandum_of_association', 'sg_constitution', 'ee_articles_of_association',
  'operating_agreement', 'member_consent', 'ee_founding_resolution',
  'sg_first_directors_resolution', 'equity_split', 'stock_purchase_agreement',
  'ip_license', 'ip_background_schedule',
]);

export function classifyDocument(slugOrType) {
  const s = String(slugOrType || '').toLowerCase();
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
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, '$1$2')
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

const BLANK_SIG = 'By: ___________________________';

export function buildExecutionBlock(opts) {
  const kind = opts.kind || 'agreement';
  const axalName = (opts.axalEntityName || '').trim() || AXAL_ENTITIES.management.name;
  const cpName = (opts.counterpartyName || '').trim();
  const cpDate = (opts.signedDate || '').trim();

  const axalParty = {
    role: 'axal',
    heading: axalName,
    by: BLANK_SIG,
    name: `Name: ${AXAL_SIGNATORY_NAME}`,
    title: `Title: ${AXAL_SIGNATORY_TITLE}`,
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
