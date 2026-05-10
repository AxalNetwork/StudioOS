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
  merge: Record<string, string | number | null | undefined>,
): Promise<string> {
  const body = getLegalTemplateBody(key);
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => {
    const v = merge[k];
    return v == null ? `{{${k}}}` : String(v);
  });
}

export const ALL_TEMPLATE_KEYS: LegalTemplateKey[] = Object.keys(TEMPLATES) as LegalTemplateKey[];
