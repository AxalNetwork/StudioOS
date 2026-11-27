/**
 * Shared legal-document formatting + architecture layer.
 *
 * Two jobs, both used by every surface that renders a legal template (the
 * worker PDF generator, the e-sign pipeline, and — via the JS mirror in
 * `frontend/src/lib/legalDocFormat.js` — the admin live preview):
 *
 *  1. `normalizeLegalBody` — turn an authored template body into clean legal
 *     plain text. Template bodies are a mix of Markdown (`#`, `##`, `**`, `>`,
 *     `---`, `- [ ]`) and plain text; the renderers draw text verbatim, so the
 *     raw Markdown punctuation leaked into previews and exported PDFs. This
 *     strips that punctuation **without** touching `{{merge_tokens}}`,
 *     `____` fill-in blanks, or `[BRACKET LABELS]`.
 *
 *  2. The static "chrome" the substantive clauses are wrapped in — a
 *     standardized preamble, the Axal entity registry + principal legal
 *     address, and the dual execution (signature) block. Each template body is
 *     therefore just the dynamic clause text (the injection zone); the title,
 *     preamble, footer and signatures are assembled here so the whole suite
 *     shares one professional structure.
 *
 * Keep this in lock-step with `frontend/src/lib/legalDocFormat.js`.
 *
 * NOTE: authored to load under `node --experimental-strip-types` (the worker
 * test gate) — no `enum`s, no TS parameter properties.
 */

// --- Axal VC corporate facts (single source of truth for documents) --------

export const AXAL_LEGAL_ADDRESS = '16192 Coastal Highway, Lewes, Delaware 19958';
export const AXAL_LEGAL_EMAIL = 'legal@axal.vc';
export const AXAL_SIGNATORY_NAME = 'Joseph Gabriel Guillaume Lauzier';
/**
 * Management's signatory title. Kept exported with this value because the
 * graduation certificate signs as Management (`lib/graduationCertificate.js`).
 * D705: every other Axal party carries its own `signatoryTitle` below.
 */
export const AXAL_SIGNATORY_TITLE = 'Managing Partner';

export type AxalEntityKey = 'management' | 'holdings' | 'gp' | 'fund';

interface AxalEntity {
  key: AxalEntityKey;
  name: string;
  /** Phrase that follows the name in the preamble (legal form + form state). */
  descriptor: string;
  /** D705 — the title the owner signs under for this party. */
  signatoryTitle: string;
  /** D705 — the capacity line for a party that signs through another (the Fund, through its GP). */
  through?: string;
}

export const AXAL_ENTITIES: Record<AxalEntityKey, AxalEntity> = {
  management: {
    key: 'management',
    name: 'Axal VC Management LLC',
    descriptor: 'a Delaware limited liability company',
    signatoryTitle: 'Managing Partner',
  },
  holdings: {
    key: 'holdings',
    name: 'Axal VC Holdings LLC',
    descriptor: 'a Delaware limited liability company',
    // Until the owner gives Holdings another title (D705 decision 2).
    signatoryTitle: 'Managing Partner',
  },
  gp: {
    key: 'gp',
    name: 'Axal VC GP LLC',
    descriptor: 'a Delaware limited liability company',
    signatoryTitle: 'General Partner',
  },
  fund: {
    key: 'fund',
    // D705 — the legal name, as the owner gave it on 2026-10-17. If the
    // Certificate of Limited Partnership reads differently, the certificate wins.
    name: 'Axal VC Spin-Out Lab Fund I LP',
    descriptor: 'a Delaware limited partnership, acting by its general partner Axal VC GP LLC',
    signatoryTitle: 'General Partner',
    through: 'By: Axal VC GP LLC, its general partner',
  },
};

/**
 * Pick the Axal entity that signs a given document, per the routing rules in
 * documentation/architecture/LEGAL_ENTITIES.md:
 *   - The LP's subscription, its side letter, and the instruments the Fund
 *     invests through -> the Fund, signing through its GP (D705)
 *   - Other fund formation / LP capital docs -> GP LLC (as GP of the Fund)
 *   - Brand / platform IP ownership     -> Holdings LLC
 *   - Everything operational (default)  -> Management LLC
 * `slugOrType` is the template slug or doc_type; `category` is the store
 * category (gp/fund/portfolio/compliance) when known.
 */
// D706 — the Fund I catalog entries (migration 468), routed by name: none of
// these slugs matches the regex fallback below, because `_` is a word
// character. Its unilateral filings and policies print no Axal party, so they
// are not routed here.
const FUND_PARTY_SLUGS_D706 = new Set([
  'lp_side_letter', 'lp_interest_transfer', 'investment_management_agreement',
  'clawback_guarantee', 'management_rights_letter', 'pro_rata_information_rights_side_letter',
]);
const GP_PARTY_SLUGS_D706 = new Set([
  'lpa_amended_restated', 'lpa_initial', 'gp_closing_certificate', 'lpac_charter', 'gp_llc_agreement',
  'gp_fund_formation_consent', 'carried_interest_award_letter',
]);

// D716 — the notices and the Subscription Booklet, routed by the entity the
// money goes to: the Fund sends what is paid into the Fund, through its GP.
// The payment instructions letter takes its sender from its purpose, so it is
// in no set here.
const FUND_PARTY_SLUGS_D716 = new Set([
  'capital_call_notice', 'distribution_notice', 'default_notice', 'management_fee_statement', 'subscription_booklet',
]);
const GP_PARTY_SLUGS_D716 = new Set(['management_fee_invoice']);
// D802 (#2238): HQ's annual fee invoice to a territory licensee, sent by Holdings.
const HOLDINGS_PARTY_SLUGS_D716 = new Set(['platform_licence_fee_invoice', 'territory_licence_fee_invoice']);

// D705 — the LP's subscription, its side letter, and the instruments the Fund
// invests through. Counsel confirms this before any of them goes to an LP.
const FUND_SIGNS_D705 = new Set([
  'subscription', 'investor_subscription_pro', 'investor_subscription_inst', 'subscription booklet & lpa',
  'co-investment side letter',
  'safe', 'term_sheet', 'spa', 'voting_rights',
]);

// D707 — the two platform IP licences (migration 471), Holdings as licensor,
// and the operating-partner agreements, Management's, routed by name.
// `partner_capital` stays out: a capital partnership is an investor relationship.
const HOLDINGS_PARTY_SLUGS_D707 = new Set(['platform_ip_licence_management_admin', 'platform_ip_licence_fund_admin']);
const MANAGEMENT_PARTY_SLUGS_D707 = new Set(['partner_msa_v1', 'partner_services', 'partner_equity', 'partner_revshare', 'partner_custom', 'partner_nda_nonsolicit']);

export function axalEntityKeyForDoc(slugOrType: string, category?: string | null): AxalEntityKey {
  const s = String(slugOrType || '').toLowerCase();
  if (FUND_PARTY_SLUGS_D706.has(s)) return 'fund';
  if (GP_PARTY_SLUGS_D706.has(s)) return 'gp';
  if (FUND_PARTY_SLUGS_D716.has(s)) return 'fund';
  if (GP_PARTY_SLUGS_D716.has(s)) return 'gp';
  if (HOLDINGS_PARTY_SLUGS_D716.has(s)) return 'holdings';
  // D705 — the Fund is the party, signing through its general partner.
  if (FUND_SIGNS_D705.has(s)) return 'fund';
  // D707 — by name, so a name always wins over the regex fallback below.
  if (HOLDINGS_PARTY_SLUGS_D707.has(s)) return 'holdings';
  if (MANAGEMENT_PARTY_SLUGS_D707.has(s)) return 'management';
  // Other fund-level docs: the GP, as general partner of the Fund.
  const gpEntityDocs = new Set([
    'spv joinder agreement', 'strategic side letter / focused spv', 'lpa', 'ppm',
    'mgmt_company', 'accreditation_v1', 'investor_nda_axal', 'carried_interest',
    'secondary purchase agreement',
  ]);
  if (gpEntityDocs.has(s) || /\b(lpa|ppm|subscription|side letter|spv|fund)\b/.test(s)) {
    return 'gp';
  }
  const holdingsDocs = new Set(['ip_license', 'ip_background_schedule']);
  if (holdingsDocs.has(s) || /\b(trademark|brand[\s_-]?ip|domain)\b/.test(s)) {
    return 'holdings';
  }
  return 'management';
}

// --- Document kind ----------------------------------------------------------
// Controls which static chrome is assembled. Not every template in the suite
// is a bilateral agreement: tax elections and attestations are unilateral
// filings, resolutions are single-body acts, and policies are published
// instruments with no signature block.

//  - agreement  : Axal is a party -> bilateral preamble + dual exec block
//                 (Axal, signed by Joseph Lauzier, + Counterparty).
//  - corporate  : portfolio-company / founder instrument where Axal is NOT a
//                 party -> single Company signatory, no Axal preamble.
//  - resolution : Axal-internal governance act -> single Axal signatory.
//  - unilateral : a filing/attestation -> single filer (Counterparty) signatory.
//  - policy     : published instrument -> no signature block.
//  - notice     : D716 — the sender asks or tells one addressee; issued, not
//                 signed -> the sender's block alone, with no By line or recital.
//  - booklet    : D716 — the Subscription Booklet; each part carries its own
//                 block (SUBSCRIPTION_BOOKLET_PARTS), so the packet has none.
export type DocumentKind = 'agreement' | 'corporate' | 'resolution' | 'unilateral' | 'policy' | 'notice' | 'booklet';

// D716 — the seven notice types (services/fundNotices.ts builds them) and the packet.
const NOTICE_SLUGS = new Set([
  'capital_call_notice', 'distribution_notice', 'default_notice', 'management_fee_statement',
  'management_fee_invoice', 'platform_licence_fee_invoice', 'payment_instructions_letter',
  // D802 (#2238)
  'territory_licence_fee_invoice',
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
// Axal-internal governance acts that Joseph Lauzier signs for the firm.
const RESOLUTION_SLUGS = new Set([
  'ic_charter',
  // D706 (Fund I catalog)
  'gp_closing_certificate', 'lpac_charter', 'gp_fund_formation_consent',
]);
// Portfolio-company / founder constitutional + intra-company instruments where
// Axal is not a contracting party (the company's officer signs, not Axal).
const CORPORATE_SLUGS = new Set([
  'certificate_of_incorporation_de', 'bylaws', 'uk_articles_of_association',
  'uk_memorandum_of_association', 'sg_constitution', 'ee_articles_of_association',
  'operating_agreement', 'member_consent', 'ee_founding_resolution',
  'sg_first_directors_resolution', 'equity_split', 'stock_purchase_agreement',
  'ip_license', 'ip_background_schedule',
]);

export function classifyDocument(slugOrType: string): DocumentKind {
  const s = String(slugOrType || '').toLowerCase();
  if (NOTICE_SLUGS.has(s)) return 'notice';
  if (BOOKLET_SLUGS.has(s)) return 'booklet';
  if (POLICY_SLUGS.has(s)) return 'policy';
  if (UNILATERAL_SLUGS.has(s)) return 'unilateral';
  if (RESOLUTION_SLUGS.has(s)) return 'resolution';
  if (CORPORATE_SLUGS.has(s)) return 'corporate';
  return 'agreement';
}

// --- Markdown -> clean legal plain text ------------------------------------

/**
 * Strip inline Markdown emphasis/links/code from a single line. Deliberately
 * conservative: only `**bold**` and `*italic*` (asterisk) emphasis is removed,
 * NOT underscore emphasis, so `{{snake_case}}` tokens and `____` fill-in
 * blanks are never corrupted.
 */
function stripInline(s: string): string {
  return s
    // images: ![alt](url) -> alt
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // links: [text](url) -> text (url)  (bracket labels like [COMPANY NAME]
    // have no trailing "(...)" so they pass through untouched)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    // bold: **text**
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    // italic: *text* (bounded so it doesn't eat stray asterisks)
    .replace(/(^|[^\w*])\*([^\s*\n](?:[^*\n]*?[^\s*\n])?)\*(?![\w*])/g, '$1$2')
    // strikethrough: ~~text~~
    .replace(/~~([^~\n]+?)~~/g, '$1')
    // inline code: `code`
    .replace(/`([^`\n]+?)`/g, '$1')
    // escaped Markdown punctuation: \*  \_  \#  ...
    .replace(/\\([\\`*_{}\[\]()#+\-.!>~])/g, '$1');
}

/**
 * Convert an authored template body (Markdown or plain text) into clean legal
 * plain text. Block-level structure (one line per paragraph/clause) is
 * preserved because the renderers paginate on it.
 */
export function normalizeLegalBody(input: string): string {
  if (!input) return '';
  const text = String(input).replace(/\r\n?/g, '\n');
  const out: string[] = [];

  for (const rawLine of text.split('\n')) {
    let line = rawLine.replace(/[ \t]+$/g, ''); // rstrip

    // Horizontal rule (---, ***, ___ ) -> blank separator line.
    if (/^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)) {
      out.push('');
      continue;
    }
    // Leading blockquote markers (possibly nested: "> > ").
    line = line.replace(/^(\s{0,3})(?:>[ \t]?)+/, '$1');
    // ATX heading markers: "## Article I" -> "Article I"; trailing "##".
    line = line.replace(/^(\s{0,3})#{1,6}[ \t]+/, '$1');
    line = line.replace(/[ \t]+#+[ \t]*$/, '');

    // Task-list item: "- [ ] foo" -> "[ ] foo"; "- [x] foo" -> "[X] foo".
    const task = line.match(/^(\s*)[-*+][ \t]+\[([ xX])\][ \t]+(.*)$/);
    if (task) {
      const mark = task[2].trim() ? '[X]' : '[  ]';
      line = `${task[1]}${mark} ${task[3]}`;
    } else {
      // Bullet item (not a rule, not a task): "- foo" -> "• foo".
      const bullet = line.match(/^(\s*)[-*+][ \t]+(.*)$/);
      if (bullet) line = `${bullet[1]}• ${bullet[2]}`;
    }

    out.push(stripInline(line));
  }

  // Collapse runs of blank lines to a single blank, then trim ends.
  const collapsed: string[] = [];
  for (const l of out) {
    if (l.trim() === '' && collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === '') continue;
    collapsed.push(l);
  }
  while (collapsed.length && collapsed[0].trim() === '') collapsed.shift();
  while (collapsed.length && collapsed[collapsed.length - 1].trim() === '') collapsed.pop();
  return collapsed.join('\n');
}

/**
 * Remove a trailing signature/closer stanza from a body so the assembled
 * execution block is not duplicated. Conservative and colon-anchored: only
 * strips trailing lines that are clearly signature scaffolding (By:/Name:/
 * Title:/Date:/Signed.../runs of underscores/the E-SIGN closer). Used as
 * defence-in-depth for un-migrated stored bodies; cleaned `.md` sources no
 * longer carry these.
 */
// A whole trailing paragraph is signature scaffolding when its first line opens
// with one of these phrases (handles wrapped sentences like "Signed
// electronically by X on the date / appearing below.").
const SIG_STARTER =
  /^(signed electronically\b|by signing electronically\b|in witness whereof\b|signed\s*:|signature\s*:)/i;
// A single line is signature scaffolding (By:/Name:/Title:/Date:/underscores).
const SIG_LINE = /^(by\s*:|name\s*:|title\s*:|date\s*:|_{3,}|•?\s*_{3,})/i;
const HR_LINE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;

export function stripTrailingSignatureBlock(body: string): string {
  let lines = body.split('\n');
  let removedAny = false;
  for (;;) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    if (!lines.length) break;
    if (HR_LINE.test(lines[lines.length - 1].trim())) { lines.pop(); removedAny = true; continue; }
    // Gather the trailing paragraph (consecutive non-blank lines).
    let start = lines.length;
    while (start > 0 && lines[start - 1].trim() !== '') start--;
    const para = lines.slice(start);
    const firstStarts = SIG_STARTER.test(para[0].trim());
    const allSigLines = para.every((l) => { const t = l.trim(); return SIG_LINE.test(t) || /^[_\s]{3,}$/.test(t); });
    if (firstStarts || allSigLines) {
      lines = lines.slice(0, start);
      removedAny = true;
      continue;
    }
    break;
  }
  return removedAny ? lines.join('\n').replace(/\n+$/, '') : body;
}

// --- Static chrome builders -------------------------------------------------

const BLANK_LINE = '_________________________';

export interface PreambleOptions {
  documentTitle: string;
  effectiveDate?: string | null;
  axalEntityKey?: AxalEntityKey;
  axalEntityName?: string | null;
  axalEntityDescriptor?: string | null;
  counterpartyName?: string | null;
}

/**
 * The standardized opening paragraph for a bilateral agreement:
 * "This <Title> is made and entered into as of <Date> (the "Effective Date"),
 *  by and between <Axal Entity>, <descriptor> with its principal legal address
 *  at <address>, and <Counterparty> (the "Counterparty")."
 */
export function buildPreamble(opts: PreambleOptions): string {
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

export interface AddresseeOptions {
  /** The addressee's name: the LP, or the Axal entity a notice is sent to. */
  to: string | null;
  /** The LP's `limited_partners.id`, for a notice to one LP. */
  lpNumber?: number | string | null;
  /** The sending Axal entity, for a notice between Axal entities. */
  from?: AxalEntityKey | null;
}

/**
 * D716 — a notice's addressee lines. To one LP: its name and LP number (the
 * platform holds no LP notice address, so none prints). Between Axal
 * entities: the sender with its legal address, then the addressee.
 */
export function buildAddresseeBlock(opts: AddresseeOptions): string[] {
  const to = (opts.to || '').trim() || '[Addressee]';
  const lp = opts.lpNumber == null ? '' : String(opts.lpNumber).trim();
  if (lp) return [`To: ${to}`, `Limited partner no. L${lp}`];
  if (opts.from && AXAL_ENTITIES[opts.from]) return [`From: ${AXAL_ENTITIES[opts.from].name}, ${AXAL_LEGAL_ADDRESS}`, `To: ${to}`];
  return [`To: ${to}`];
}

export type SignatureRole = 'axal' | 'counterparty';

export interface SignatureParty {
  role: SignatureRole;
  /** Legal name of the contracting party (the heading of the block). */
  heading: string;
  /** D705 — the capacity line under the heading, for a party that signs through another. */
  through?: string;
  by: string;
  name: string;
  title: string;
  date: string;
  /** The party whose hand-/e-signature is captured (gets the image when signed). */
  isSigner: boolean;
}

export interface ExecutionBlock {
  recital: string;
  parties: SignatureParty[];
}

export interface ExecutionOptions {
  kind?: DocumentKind;
  /** D705 — the Axal party, which sets its title and any `through` line. Management when absent. */
  axalEntityKey?: AxalEntityKey;
  axalEntityName?: string | null;
  /** Filled signer name for a completed counterparty signature (else blank). */
  counterpartyName?: string | null;
  counterpartyTitle?: string | null;
  signedDate?: string | null;
}

const BLANK_SIG = 'By: ___________________________';

/**
 * Build the execution (signature) block as an ordered list of parties:
 *   - agreement  -> [Axal, Counterparty]   (Counterparty is the signer)
 *   - resolution -> [Axal]                  (Axal/authorized signatory signs)
 *   - unilateral -> [Counterparty]          (the investor/taxpayer/applicant signs)
 *   - notice     -> [Axal sender]           (issued, not signed: no By line, no recital)
 *   - booklet    -> []                      (each part carries its own block)
 *   - policy     -> (no block; caller skips)
 */
export function buildExecutionBlock(opts: ExecutionOptions): ExecutionBlock {
  const kind = opts.kind || 'agreement';
  const ent = AXAL_ENTITIES[opts.axalEntityKey || 'management'] || AXAL_ENTITIES.management;
  const axalName = (opts.axalEntityName || '').trim() || ent.name;
  const cpName = (opts.counterpartyName || '').trim();
  const cpDate = (opts.signedDate || '').trim();

  const axalParty: SignatureParty = {
    role: 'axal',
    heading: axalName,
    ...(ent.through ? { through: ent.through } : {}),
    by: BLANK_SIG,
    name: `Name: ${AXAL_SIGNATORY_NAME}`,
    title: `Title: ${ent.signatoryTitle}`,
    date: cpDate ? `Date: ${cpDate}` : 'Date: ___________________________',
    isSigner: kind === 'resolution',
  };
  const counterparty: SignatureParty = {
    role: 'counterparty',
    heading: cpName || '[Counterparty Legal Name]',
    by: BLANK_SIG,
    name: cpName ? `Name: ${cpName}` : 'Name: ___________________________',
    title: (opts.counterpartyTitle || '').trim()
      ? `Title: ${String(opts.counterpartyTitle).trim()}`
      : 'Title: ___________________________',
    date: cpDate ? `Date: ${cpDate}` : 'Date: ___________________________',
    isSigner: true,
  };

  if (kind === 'resolution') {
    return {
      recital: 'The undersigned, being duly authorized, executes this instrument as of the date written below.',
      parties: [axalParty],
    };
  }
  if (kind === 'notice') {
    // D716 — a notice is issued, not signed, and its record names who issued
    // it. The two invoices print no block at all; their builder skips this.
    return { recital: '', parties: [{ ...axalParty, by: '', isSigner: false }] };
  }
  if (kind === 'booklet') return { recital: '', parties: [] };
  if (kind === 'unilateral') {
    return {
      recital: 'IN WITNESS WHEREOF, the undersigned has executed this instrument as of the date written below.',
      parties: [counterparty],
    };
  }
  if (kind === 'corporate') {
    // Portfolio-company / founder instrument — the Company's authorized officer
    // signs; Axal is not a party.
    const company: SignatureParty = {
      role: 'counterparty',
      heading: cpName || '[Company Legal Name]',
      by: BLANK_SIG,
      name: cpName ? `Name: ${cpName}` : 'Name: ___________________________',
      title: (opts.counterpartyTitle || '').trim()
        ? `Title: ${String(opts.counterpartyTitle).trim()}`
        : 'Title: ___________________________',
      date: cpDate ? `Date: ${cpDate}` : 'Date: ___________________________',
      isSigner: true,
    };
    return {
      recital: 'IN WITNESS WHEREOF, the Company has caused this instrument to be executed by its duly authorized officer as of the date written below.',
      parties: [company],
    };
  }
  return {
    recital:
      'IN WITNESS WHEREOF, the parties have executed this Agreement as of the Effective Date. ' +
      'By signing electronically below, each party agrees that an electronic signature has the same ' +
      'legal effect as a handwritten signature under the U.S. ESIGN Act (15 U.S.C. § 7001 et seq.) and UETA.',
    parties: [axalParty, counterparty],
  };
}

// --- WinAnsi safety (pdf-lib StandardFonts encode WinAnsi/cp1252) -----------
// Characters above U+00FF that DO map to a cp1252 byte (smart quotes, em/en
// dash, bullet, ellipsis, trademark, …) are kept; anything else is downgraded
// to an ASCII equivalent so `drawText` never throws on an unmappable glyph.

const CP1252_EXTRA = new Set<number>([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

export function winAnsiSafe(s: string): string {
  let out = '';
  for (const ch of String(s || '')) {
    const cp = ch.codePointAt(0) || 0;
    if (cp <= 0xff || CP1252_EXTRA.has(cp)) { out += ch; continue; }
    switch (cp) {
      case 0x2192: case 0x21a6: out += '->'; break;   //  →  ↦
      case 0x2190: out += '<-'; break;                //  ←
      case 0x2194: out += '<->'; break;               //  ↔  (e.g. 3-Way NDA title)
      case 0x2264: out += '<='; break;                //  ≤
      case 0x2265: out += '>='; break;                //  ≥
      case 0x2260: out += '!='; break;                //  ≠
      case 0x2611: case 0x2713: case 0x2714: out += '[X]'; break;
      case 0x2610: out += '[  ]'; break;
      default: out += '?'; break;
    }
  }
  return out;
}

// --- D716: the Subscription Booklet ----------------------------------------

export interface BookletPart {
  part: number;
  title: string;
  /** The catalog slug the part prints, or null for a part generated here. */
  slug: string | null;
  /** The part's own signature page, or null for none. */
  block: { kind: DocumentKind; axalEntityKey?: AxalEntityKey } | null;
}

/**
 * The booklet's nine parts, in order. Each part's block is built for its own
 * kind with the applicant as the counterparty, except Part 8 (the applicant's
 * counterpart page to the LPA, so unilateral) and Part 9 (the GP's acceptance,
 * signed by the Fund through its general partner, last). The booklet prints no
 * LPA body: Part 8 is its signature page only.
 */
export const SUBSCRIPTION_BOOKLET_PARTS: readonly BookletPart[] = [
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
