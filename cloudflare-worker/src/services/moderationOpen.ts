/**
 * One predicate for a moderation case that is awaiting a decision (D448).
 *
 * The approvals lane and the moderation console both read this string.
 * A sanction in force — suspended or ejected, and not yet closed — is a
 * different fact and is not part of this predicate, so the two screens
 * cannot disagree about a flag.
 *
 * The text is concatenated onto a statement. It is not interpolated from
 * a request, and it is not a template hole inside `DB.prepare`.
 */
export const MODERATION_AWAITING_SQL =
  "status = 'under_review' AND resolved_at IS NULL";

/** A sanction still in force: suspended or ejected, and not yet closed. */
export const MODERATION_SANCTION_SQL =
  "status IN ('suspended', 'ejected') AND resolved_at IS NULL";
