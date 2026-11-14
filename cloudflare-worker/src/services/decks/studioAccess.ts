/**
 * D4359 (#4359, #2434 Q8 = A) — who may use the Pitch deck studio, in one place.
 *
 * The owner answered #2434 question 8 with A on 2026-11-03: the studio is a
 * Raise + Grow plan feature (`studio`). The Worker's own gates (New deck and
 * the old /generate, Share, the one link writer) read `DECK_STUDIO_TIER`, and
 * `GET /api/decks/access` answers `deckStudioAccess` to the studio's pages, so
 * the UI opens the studio exactly when the Worker would let the member use it.
 * There is no second plan list in the frontend to drift from this one.
 */
import type { User } from '../../types';
import { PLAN_KEY, PLAN_NAME, TIER_COPY, userMeetsTier } from '../../middleware/requireTier';

/** The plan the studio needs: Raise + Grow. */
export const DECK_STUDIO_TIER = 'studio' as const;

export interface DeckStudioAccess {
  open: boolean;
  required: typeof DECK_STUDIO_TIER;
  plan: { tier: typeof DECK_STUDIO_TIER; name: string; plan_key: string };
  /** The plan's own upsell line, the same words the 402 carries; null when open. */
  message: string | null;
}

/** The studio's answer for this member: open exactly when `ensureTier(user, DECK_STUDIO_TIER)` passes. */
export function deckStudioAccess(user: User | null | undefined): DeckStudioAccess {
  const open = userMeetsTier(user, DECK_STUDIO_TIER);
  return {
    open,
    required: DECK_STUDIO_TIER,
    plan: { tier: DECK_STUDIO_TIER, name: PLAN_NAME[DECK_STUDIO_TIER], plan_key: PLAN_KEY[DECK_STUDIO_TIER] },
    message: open ? null : TIER_COPY[DECK_STUDIO_TIER],
  };
}
