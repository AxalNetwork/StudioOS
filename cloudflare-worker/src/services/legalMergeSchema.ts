/**
 * Canonical legal merge-field schema — Task #29.
 *
 * Single source of truth for every `{{dotted.path}}` token the seeded
 * v1 legal-template bodies are written against. Each entry carries a
 * human description, a realistic legal-document example value, and a
 * source category (the system that will eventually supply the live
 * value). The nested `PLACEHOLDER_MERGE_CONTEXT` is derived from the
 * example values so previews and dry-runs render plausible documents
 * before the live resolver (`buildUserMergeContext`, follow-up) exists.
 *
 * Pure data + helpers only — no Wrangler `?raw` imports — so it can be
 * imported by `mergeFields.ts` (and exercised under `node --test`) and
 * by the seed generator without dragging in the markdown bundle.
 *
 * Token roots:
 *   company.*      — the portfolio/spin-out company being formed
 *   founder.*      — primary founder
 *   cofounder.*    — second founder
 *   partner.*      — external venture / service partner
 *   cap_table.*    — capitalization figures
 *   counterparty.* — generic counterparty (finder, advisor, client)
 *   envelope.*     — e-sign envelope metadata
 *   (flat)         — effective_date, governing_law
 */

export type MergeSourceCategory =
  | 'company'
  | 'founder'
  | 'cofounder'
  | 'partner'
  | 'cap_table'
  | 'counterparty'
  | 'envelope'
  | 'scalar';

export interface MergeFieldDef {
  /** Plain-English description of what the token represents. */
  description: string;
  /** Realistic legal-document example value (drives the placeholder context). */
  example: string;
  /** Origin system/category that will supply the live value. */
  source: MergeSourceCategory;
}

/**
 * Every canonical token, keyed by its dotted path. The v1 bodies under
 * `templates/legal/*_v1.md` must only use tokens defined here — keeping
 * the two in lockstep is what lets `resolveWithBrackets` bracket-label a
 * body without leaking raw `{{tokens}}`.
 */
export const LEGAL_MERGE_SCHEMA: Record<string, MergeFieldDef> = {
  // --- company.* -----------------------------------------------------
  'company.legal_name': {
    description: 'Full registered legal name of the company being formed or contracted.',
    example: 'Northwind Robotics, Inc.',
    source: 'company',
  },
  'company.short_name': {
    description: 'Common short name used for the company after first reference.',
    example: 'Northwind',
    source: 'company',
  },
  'company.entity_type': {
    description: 'Legal entity form and governing jurisdiction descriptor.',
    example: 'Delaware corporation',
    source: 'company',
  },
  'company.jurisdiction': {
    description: 'State or country of incorporation/registration.',
    example: 'State of Delaware',
    source: 'company',
  },
  'company.registered_address': {
    description: "Company's registered office address.",
    example: '251 Little Falls Drive, Wilmington, Delaware 19808',
    source: 'company',
  },
  'company.registration_number': {
    description: 'Company registration / file number with the formation authority.',
    example: 'DE-7421188',
    source: 'company',
  },
  'company.business_purpose': {
    description: 'Stated principal business purpose of the company.',
    example: 'the research, development, and commercialization of autonomous robotics software',
    source: 'company',
  },

  // --- founder.* -----------------------------------------------------
  'founder.legal_name': {
    description: 'Full legal name of the primary founder.',
    example: 'Dr. Amara Okafor',
    source: 'founder',
  },
  'founder.email': {
    description: 'Primary email address of the founder.',
    example: 'amara.okafor@northwindrobotics.com',
    source: 'founder',
  },
  'founder.title': {
    description: 'Founder role/title at the company.',
    example: 'Chief Executive Officer',
    source: 'founder',
  },
  'founder.address': {
    description: 'Residential or notice address of the founder.',
    example: '1450 Folsom Street, Suite 5C, San Francisco, California 94103',
    source: 'founder',
  },

  // --- cofounder.* ---------------------------------------------------
  'cofounder.legal_name': {
    description: 'Full legal name of the co-founder.',
    example: 'Liam Petrov',
    source: 'cofounder',
  },
  'cofounder.email': {
    description: 'Primary email address of the co-founder.',
    example: 'liam.petrov@northwindrobotics.com',
    source: 'cofounder',
  },
  'cofounder.title': {
    description: 'Co-founder role/title at the company.',
    example: 'Chief Technology Officer',
    source: 'cofounder',
  },
  'cofounder.address': {
    description: 'Residential or notice address of the co-founder.',
    example: '78 Highland Avenue, Cambridge, Massachusetts 02139',
    source: 'cofounder',
  },
  'cofounder.equity_pct': {
    description: "Co-founder's percentage equity interest on a fully diluted basis.",
    example: '40%',
    source: 'cofounder',
  },

  // --- partner.* -----------------------------------------------------
  'partner.legal_name': {
    description: 'Full registered legal name of the external partner entity.',
    example: 'Brightlane Advisory LLC',
    source: 'partner',
  },
  'partner.entity_type': {
    description: 'Legal entity form of the partner.',
    example: 'California limited liability company',
    source: 'partner',
  },
  'partner.contact_name': {
    description: 'Authorized signatory / primary contact at the partner.',
    example: 'Sofia Marchetti',
    source: 'partner',
  },
  'partner.email': {
    description: 'Primary email address of the partner contact.',
    example: 'sofia.marchetti@brightlane.co',
    source: 'partner',
  },
  'partner.address': {
    description: 'Registered or notice address of the partner.',
    example: '555 Mission Street, Suite 2100, San Francisco, California 94105',
    source: 'partner',
  },
  'partner.role': {
    description: 'Engagement role the partner performs for Axal.',
    example: 'Venture Partner',
    source: 'partner',
  },
  'partner.carry_pct': {
    description: 'Carried-interest percentage allocated to the partner.',
    example: '10%',
    source: 'partner',
  },
  'partner.revenue_share_pct': {
    description: 'Revenue-share percentage payable to the partner.',
    example: '20%',
    source: 'partner',
  },
  'partner.capital_commitment': {
    description: 'Capital amount the partner commits.',
    example: 'USD $250,000',
    source: 'partner',
  },
  'partner.equity_pct': {
    description: "Partner's equity grant, percentage on a fully diluted basis.",
    example: '2.5%',
    source: 'partner',
  },

  // --- cap_table.* ---------------------------------------------------
  'cap_table.authorized_shares': {
    description: 'Total authorized shares of the company.',
    example: '10,000,000 shares of Common Stock',
    source: 'cap_table',
  },
  'cap_table.founder_shares': {
    description: 'Shares issued to the primary founder.',
    example: '4,500,000 shares of Common Stock',
    source: 'cap_table',
  },
  'cap_table.founder_pct': {
    description: "Primary founder's percentage on a fully diluted basis.",
    example: '45%',
    source: 'cap_table',
  },
  'cap_table.cofounder_shares': {
    description: 'Shares issued to the co-founder.',
    example: '4,000,000 shares of Common Stock',
    source: 'cap_table',
  },
  'cap_table.cofounder_pct': {
    description: "Co-founder's percentage on a fully diluted basis.",
    example: '40%',
    source: 'cap_table',
  },
  'cap_table.option_pool_pct': {
    description: 'Reserved employee option pool percentage on a fully diluted basis.',
    example: '15%',
    source: 'cap_table',
  },
  'cap_table.par_value': {
    description: 'Par value per share of Common Stock.',
    example: '$0.00001 per share',
    source: 'cap_table',
  },
  'cap_table.vesting_schedule': {
    description: 'Standard founder/employee vesting schedule.',
    example: 'four (4) years with a one (1) year cliff',
    source: 'cap_table',
  },

  // --- counterparty.* ------------------------------------------------
  'counterparty.legal_name': {
    description: 'Full registered legal name of the counterparty.',
    example: 'Meridian Growth Partners LLC',
    source: 'counterparty',
  },
  'counterparty.entity_type': {
    description: 'Legal entity form of the counterparty.',
    example: 'Delaware limited liability company',
    source: 'counterparty',
  },
  'counterparty.signatory_name': {
    description: 'Name of the individual signing for the counterparty.',
    example: 'Jonathan Reyes',
    source: 'counterparty',
  },
  'counterparty.signatory_title': {
    description: 'Title of the counterparty signatory.',
    example: 'Managing Director',
    source: 'counterparty',
  },
  'counterparty.email': {
    description: 'Primary email address of the counterparty.',
    example: 'jonathan.reyes@meridiangp.com',
    source: 'counterparty',
  },
  'counterparty.address': {
    description: 'Registered or notice address of the counterparty.',
    example: 'One Bryant Park, 39th Floor, New York, New York 10036',
    source: 'counterparty',
  },
  'counterparty.fee_pct': {
    description: 'Fee percentage payable to the counterparty.',
    example: '5%',
    source: 'counterparty',
  },

  // --- envelope.* ----------------------------------------------------
  'envelope.id': {
    description: 'Public e-sign envelope identifier.',
    example: 'AXL-ENV-2026-00142',
    source: 'envelope',
  },
  'envelope.document_title': {
    description: 'Human-readable title of the document in the envelope.',
    example: 'Co-Founder Agreement',
    source: 'envelope',
  },
  'envelope.sent_date': {
    description: 'Date the envelope was sent for signature.',
    example: 'June 14, 2026',
    source: 'envelope',
  },

  // --- flat scalars --------------------------------------------------
  effective_date: {
    description: 'Effective date of the agreement.',
    example: 'June 14, 2026',
    source: 'scalar',
  },
  governing_law: {
    description: 'Governing-law clause text.',
    example: 'the laws of the State of Delaware, without regard to its conflict-of-laws principles',
    source: 'scalar',
  },
};

export type LegalMergeToken = keyof typeof LEGAL_MERGE_SCHEMA;

/**
 * Returns true when `path` is a known canonical token.
 */
export function isKnownMergeToken(path: string): boolean {
  return Object.prototype.hasOwnProperty.call(LEGAL_MERGE_SCHEMA, path);
}

/**
 * Turn a dotted path into a bracketed upper-case label, e.g.
 * `company.legal_name` -> `[COMPANY LEGAL NAME]`. Pure string
 * derivation so it works for any path; callers decide whether to
 * bracket unknown tokens.
 */
export function bracketLabel(path: string): string {
  return '[' + path.replace(/[._]+/g, ' ').trim().toUpperCase() + ']';
}

/**
 * Nested placeholder context derived from the schema example values.
 * Dotted paths become nested objects; flat scalars stay top-level.
 * Suitable as the `merge` argument to `applyMergeFields` for previews.
 */
export const PLACEHOLDER_MERGE_CONTEXT: Record<string, unknown> = buildPlaceholderContext();

function buildPlaceholderContext(): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [path, def] of Object.entries(LEGAL_MERGE_SCHEMA)) {
    const parts = path.split('.');
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (typeof cur[key] !== 'object' || cur[key] == null) cur[key] = {};
      cur = cur[key] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = def.example;
  }
  return root;
}
