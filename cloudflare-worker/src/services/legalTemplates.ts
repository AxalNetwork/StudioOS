/**
 * Legal templates registry — Task #3 (Y-1).
 *
 * Templates are committed as Markdown under
 * `cloudflare-worker/src/templates/legal/*.md` and bundled into the
 * worker via Wrangler's `?raw` import suffix. Each template begins
 * with a "Subject to legal review" banner and uses
 * `{{merge_field}}` placeholders that this module resolves at render
 * time from the personal/corporate profile (AE-1 schema).
 *
 * Adding a new template:
 *   1. Drop the .md file under templates/legal/.
 *   2. Add an entry to `TEMPLATES` below.
 *   3. Reference it by key from a route (e.g. trust.ts -> 3-way NDA).
 */

// Wrangler bundles ?raw imports as TS string literals. The
// `as any` cast keeps tsc happy without needing a custom .d.ts.
import tos                            from '../templates/legal/tos_v1.md?raw';
import privacy                        from '../templates/legal/privacy_v1.md?raw';
import founderNda                     from '../templates/legal/founder_nda_v1.md?raw';
import investorNda                    from '../templates/legal/investor_nda_v1.md?raw';
import mentorNda                      from '../templates/legal/mentor_nda_v1.md?raw';
import mentorDisclaimer               from '../templates/legal/mentor_disclaimer_v1.md?raw';
import partnerMsa                     from '../templates/legal/partner_msa_v1.md?raw';
import accreditation                  from '../templates/legal/accreditation_v1.md?raw';
import nda3Way                        from '../templates/legal/nda_3way_founder_investor_axal_v1.md?raw';

export type LegalTemplateKey =
  | 'tos_v1' | 'privacy_v1'
  | 'founder_nda_v1' | 'investor_nda_v1'
  | 'mentor_nda_v1' | 'mentor_disclaimer_v1'
  | 'partner_msa_v1' | 'accreditation_v1'
  | 'nda_3way_founder_investor_axal_v1';

const TEMPLATES: Record<LegalTemplateKey, string> = {
  tos_v1: tos as unknown as string,
  privacy_v1: privacy as unknown as string,
  founder_nda_v1: founderNda as unknown as string,
  investor_nda_v1: investorNda as unknown as string,
  mentor_nda_v1: mentorNda as unknown as string,
  mentor_disclaimer_v1: mentorDisclaimer as unknown as string,
  partner_msa_v1: partnerMsa as unknown as string,
  accreditation_v1: accreditation as unknown as string,
  nda_3way_founder_investor_axal_v1: nda3Way as unknown as string,
};

export function getLegalTemplateBody(key: LegalTemplateKey): string {
  const body = TEMPLATES[key];
  if (!body) throw new Error(`unknown_legal_template:${key}`);
  return body;
}

/**
 * Replace `{{key}}` placeholders with values from `merge`. Missing
 * keys are left as-is so reviewers spot the omission immediately
 * (and the audit trail keeps the literal placeholder for evidence).
 */
export async function renderLegalTemplate(
  key: LegalTemplateKey,
  merge: Record<string, unknown>,
): Promise<string> {
  const body = getLegalTemplateBody(key);
  // Task #1 (DB) — accept dotted-path tokens like
  // `{{counterparty.founder_id}}`. The lookup walks nested objects;
  // a flat key like `{{recipient_name}}` continues to work because
  // the path of length 1 falls through to the top-level `merge[k]`.
  return body.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path: string) => {
    const v = resolveDotted(merge, path);
    return v == null ? `{{${path}}}` : String(v);
  });
}

function resolveDotted(scope: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = scope;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export const ALL_TEMPLATE_KEYS: LegalTemplateKey[] = Object.keys(TEMPLATES) as LegalTemplateKey[];

/**
 * Task #5 (Z) v3 — Map the public `doc_type` string surfaced by the
 * admin "Create envelope" wizard (and stored on
 * `esign_envelopes.document_type`) to the canonical Y-1 template key.
 * Keep this in sync with `LEGAL_TEMPLATE_CATALOG` in
 * cloudflare-worker/src/routes/admin_contracts.ts and the W/X/Y doc
 * type labels emitted by the wizard.
 *
 * Returns null when no Y-1 template matches; callers should fall back
 * to the legacy `buildTemplateBody` path in that case (e.g. legacy
 * `Subscription Booklet & LPA` style document_type values used by the
 * older profile flows).
 */
const DOC_TYPE_TO_TEMPLATE_KEY: Record<string, LegalTemplateKey> = {
  tos_v1:                                 'tos_v1',
  privacy_v1:                             'privacy_v1',
  founder_nda_v1:                         'founder_nda_v1',
  founder_nda_axal:                       'founder_nda_v1',
  investor_nda_axal:                      'investor_nda_v1',
  investor_nda_v1:                        'investor_nda_v1',
  mentor_nda_axal:                        'mentor_nda_v1',
  mentor_nda_v1:                          'mentor_nda_v1',
  mentor_engagement_disclaimer:           'mentor_disclaimer_v1',
  mentor_disclaimer_v1:                   'mentor_disclaimer_v1',
  accreditation_v1:                       'accreditation_v1',
  partner_services:                       'partner_msa_v1',
  partner_msa_v1:                         'partner_msa_v1',
  nda_3way_founder_investor_axal:         'nda_3way_founder_investor_axal_v1',
  nda_3way_founder_investor_axal_v1:      'nda_3way_founder_investor_axal_v1',
};

export function templateKeyForDocType(docType: string | null | undefined): LegalTemplateKey | null {
  if (!docType) return null;
  return DOC_TYPE_TO_TEMPLATE_KEY[docType] ?? null;
}
