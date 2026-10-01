/**
 * doc_type → legal template key. Routing data, deliberately holding no assets.
 *
 * WHY THIS IS ITS OWN MODULE. It used to live in `legalTemplates.ts`, next to
 * the template bodies, which are imported with Wrangler's `?raw` suffix. That
 * suffix is a bundler feature: Node cannot load a `.md` import at all
 * (`ERR_UNKNOWN_FILE_EXTENSION`), so anything that reached this mapping dragged
 * nine markdown files with it and became untestable and un-importable outside
 * the worker build. `satisfyObligationFromEnvelope` needs exactly this table and
 * none of those bodies.
 *
 * The split is also the honest one: which document a `doc_type` names is a
 * routing decision, and the prose is an asset. `legalTemplates.ts` re-exports
 * both names so existing callers are unaffected.
 *
 * THE MAPPING IS NOT THE IDENTITY FUNCTION, and that is the whole reason it
 * exists. Three keys ship under a different `doc_type` than their own name —
 * `investor_nda_v1` as `investor_nda_axal`, `mentor_nda_v1` as
 * `mentor_nda_axal`, `mentor_disclaimer_v1` as `mentor_engagement_disclaimer`.
 * Every key is reachable under both spellings, because an admin-created envelope
 * may carry either, and which spelling was used must never decide whether an
 * obligation closes.
 */

export type LegalTemplateKey =
  | 'tos_v1' | 'privacy_v1'
  | 'founder_nda_v1' | 'investor_nda_v1'
  | 'mentor_nda_v1' | 'mentor_disclaimer_v1'
  | 'partner_msa_v1' | 'accreditation_v1'
  | 'nda_3way_founder_investor_axal_v1';

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

/**
 * Returns null when no Y-1 template matches; callers should fall back to the
 * legacy `buildTemplateBody` path in that case (e.g. legacy
 * `Subscription Booklet & LPA` style document_type values used by the older
 * profile flows).
 */
export function templateKeyForDocType(docType: string | null | undefined): LegalTemplateKey | null {
  if (!docType) return null;
  return DOC_TYPE_TO_TEMPLATE_KEY[docType] ?? null;
}
