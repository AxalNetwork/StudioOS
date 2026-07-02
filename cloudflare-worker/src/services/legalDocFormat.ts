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
export const AXAL_SIGNATORY_TITLE = 'Managing Partner';

export type AxalEntityKey = 'management' | 'holdings' | 'gp' | 'fund';

interface AxalEntity {
  key: AxalEntityKey;
  name: string;
  /** Phrase that follows the name in the preamble (legal form + form state). */
  descriptor: string;
}

export const AXAL_ENTITIES: Record<AxalEntityKey, AxalEntity> = {
  management: {
    key: 'management',
    name: 'Axal VC Management LLC',
    descriptor: 'a Delaware limited liability company',
  },
  holdings: {
    key: 'holdings',
    name: 'Axal VC Holdings LLC',
    descriptor: 'a Delaware limited liability company',
  },
  gp: {
    key: 'gp',
    name: 'Axal VC GP LLC',
    descriptor: 'a Delaware limited liability company',
  },
  fund: {
    key: 'fund',
    name: 'Axal VC Fund I, LP',
    descriptor: 'a Delaware limited partnership, acting by its general partner Axal VC GP LLC',
  },
};

/**
 * Pick the Axal entity that signs a given document, per the routing rules in
 * LEGAL_ENTITIES.md:
 *   - Fund formation / LP capital docs  -> GP LLC (as GP of the Fund)
 *   - Brand / platform IP ownership     -> Holdings LLC
 *   - Everything operational (default)  -> Management LLC
 * `slugOrType` is the template slug or doc_type; `category` is the store
 * category (gp/fund/portfolio/compliance) when known.
 */
export function axalEntityKeyForDoc(slugOrType: string, category?: string | null): AxalEntityKey {
  const s = String(slugOrType || '').toLowerCase();
  // Fund-level docs + portfolio investment instruments: the Axal party is the
  // Fund, signing through its general partner Axal VC GP LLC.
  const fundEntityDocs = new Set([
    'subscription booklet & lpa', 'spv joinder agreement', 'co-investment side letter',
    'strategic side letter / focused spv', 'lpa', 'ppm', 'subscription',
    'mgmt_company', 'investor_subscription_pro', 'investor_subscription_inst',
    'accreditation_v1', 'investor_nda_axal', 'carried_interest',
    'safe', 'term_sheet', 'spa', 'voting_rights', 'secondary purchase agreement',
  ]);
  if (fundEntityDocs.has(s) || /\b(lpa|ppm|subscription|side letter|spv|fund)\b/.test(s)) {
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
export type DocumentKind = 'agreement' | 'corporate' | 'resolution' | 'unilateral' | 'policy';

const POLICY_SLUGS = new Set(['tos_v1', 'privacy_v1', 'aml_kyc', 'form_adv']);
const UNILATERAL_SLUGS = new Set([
  'section_83b', 'accreditation_v1', 'ein_application_kit', 'sg_acra_form_45_kit',
  'uk_form_in01_kit', 'ee_e_residency_application_kit', 'data_access_acknowledgment_admin',
  'mentor_engagement_disclaimer',
]);
// Axal-internal governance acts that Joseph Lauzier signs for the firm.
const RESOLUTION_SLUGS = new Set(['ic_charter']);
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

export type SignatureRole = 'axal' | 'counterparty';

export interface SignatureParty {
  role: SignatureRole;
  /** Legal name of the contracting party (the heading of the block). */
  heading: string;
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
 *   - policy     -> (no block; caller skips)
 */
export function buildExecutionBlock(opts: ExecutionOptions): ExecutionBlock {
  const kind = opts.kind || 'agreement';
  const axalName = (opts.axalEntityName || '').trim() || AXAL_ENTITIES.management.name;
  const cpName = (opts.counterpartyName || '').trim();
  const cpDate = (opts.signedDate || '').trim();

  const axalParty: SignatureParty = {
    role: 'axal',
    heading: axalName,
    by: BLANK_SIG,
    name: `Name: ${AXAL_SIGNATORY_NAME}`,
    title: `Title: ${AXAL_SIGNATORY_TITLE}`,
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
