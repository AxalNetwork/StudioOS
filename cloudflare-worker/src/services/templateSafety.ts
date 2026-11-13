/**
 * D4811 (#4811) — the template safety overlays, computed on the server.
 *
 * A legal template can carry two overlays beside its lifecycle state
 * (boards CT09, CT10 and CT92 "Restricted / incomplete"):
 *
 * - **Restricted — Legal review required.** Its slug is in
 *   `COUNSEL_REVIEW_SLUGS` (`templateFormat.ts`, D803): it has a body counsel
 *   has not reviewed. The slug leaves the set when counsel signs it off.
 * - **Template incomplete.** The library row is a stub (`is_stub = 1`) or its
 *   body is blank after trimming — the rule the publication SQL, the esign
 *   send and the licence instantiation already apply (D717, D758).
 *
 * While either applies, Generate, Use template and Publish are not offered and
 * the API refuses them with 409. Every route that generates from, uses or
 * publishes a template asks this one predicate; restricted is checked first.
 * The incomplete code stays `template_has_no_body`, the code those routes
 * already answered, so no existing client has to learn a second one.
 *
 * Reading, previewing, editing and withdrawing are never refused here: a
 * template has to be read and edited to be completed or reviewed.
 */
import { COUNSEL_DRAFT_SLUGS, COUNSEL_REVIEW_SLUGS } from './templateFormat';

export const RESTRICTED_TITLE = 'Restricted — Legal review required';
export const RESTRICTED_REASON = 'Counsel has not reviewed this template’s text. It cannot be used, published or used to generate an agreement until counsel signs it off.';
export const INCOMPLETE_TITLE = 'Template incomplete';
export const INCOMPLETE_LINE = 'This document has not yet been completed and cannot be used to generate an agreement.';

export type TemplateRefusalCode = 'template_restricted' | 'template_has_no_body';

export interface TemplateSafety {
  restricted: boolean;
  restricted_reason: string | null;
  incomplete: boolean;
  incomplete_reason: string | null;
}

export interface TemplateSafetyInput {
  slug: string;
  is_stub?: number | boolean | null;
  body_md?: string | null;
}

/** Whether a slug is restricted (case-insensitive, as `COUNSEL_DRAFT_SLUGS` is read). */
export function isRestrictedSlug(slug: unknown): boolean {
  return typeof slug === 'string' && COUNSEL_REVIEW_SLUGS.has(slug.trim().toLowerCase());
}

/** The restricted slugs as a JSON array, for `json_each(?)` in a bound statement. */
export function restrictedSlugsJson(): string {
  return JSON.stringify([...COUNSEL_REVIEW_SLUGS].map((s) => s.toLowerCase()).sort());
}

/** Both overlays for one library row, with the sentence that explains each. */
export function templateSafety(row: TemplateSafetyInput): TemplateSafety {
  const restricted = isRestrictedSlug(row.slug);
  const stub = row.is_stub === true || Number(row.is_stub) === 1;
  const blank = !String(row.body_md ?? '').trim();
  const incomplete = stub || blank;
  const incompleteReason = !incomplete ? null
    : COUNSEL_DRAFT_SLUGS.has(String(row.slug || '').toLowerCase())
      ? 'Counsel has not supplied this document’s text yet.'
      : 'The template has no body in the library yet.';
  return {
    restricted,
    restricted_reason: restricted ? RESTRICTED_REASON : null,
    incomplete,
    incomplete_reason: incompleteReason,
  };
}

/**
 * The refusal for generating from, using or publishing this row, or null when
 * it may be used. Restricted wins when both apply.
 */
export function templateUseRefusal(row: TemplateSafetyInput):
  { status: 409; code: TemplateRefusalCode; message: string } | null {
  const s = templateSafety(row);
  if (s.restricted) return { status: 409, code: 'template_restricted', message: `${RESTRICTED_TITLE}. ${s.restricted_reason} Nothing was generated, sent or published.` };
  if (s.incomplete) return { status: 409, code: 'template_has_no_body', message: `${INCOMPLETE_TITLE}. ${INCOMPLETE_LINE}` };
  return null;
}
