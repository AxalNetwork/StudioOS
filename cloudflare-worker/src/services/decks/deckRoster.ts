/**
 * What the Demo Day deck does with the Advisors & Partners roster — the rule,
 * in one place, for the two readers that need it (D214).
 *
 * The deck (`axalSpinoutDemoDay.ts`, `spinoutDeckData.ts`) reads the active
 * `network_profiles` rows in display order and treats them in three ways. HQ's
 * Content page marks each roster row with which of those it gets. Two readers
 * of one rule is where they drift, and a page that said "on the deck" about a
 * row the deck drops is the failure — so both call these, and a test holds
 * `deckRosterReach` equal to what `deckProfiles` and `deckMentorNames` pick.
 *
 * This module is deliberately small and imports nothing: the Content route
 * reads it, and importing the deck assembler for two numbers would pull its
 * eleven service imports into a summary endpoint.
 */

/**
 * The first N active rows become the deck's `profiles`, which the Team &
 * Network slide's advisor block draws with name, role and photo.
 * `spinoutDeckData.ts`'s own `profiles.slice(0, 8)` is inert because its input
 * is already capped here; it is the renderer's ceiling, left as it is.
 */
export const DECK_ROSTER_PROFILES = 6;

/**
 * The first N active rows WITH A NAME become the deck's `mentors` — names only.
 * The Team & Network slide reads that list only when there are no profiles at
 * all, so while any profile exists a seventh or eighth name reaches the deck's
 * data and its editor fields, not a slide.
 */
export const DECK_ROSTER_NAMES = 8;

const DASH = '—';

export function deckProfiles<T>(roster: T[]): T[] {
  return roster.slice(0, DECK_ROSTER_PROFILES);
}

export function deckMentorNames(roster: Array<{ name: string }>): string[] {
  return roster.map((p) => p.name).filter(Boolean).slice(0, DECK_ROSTER_NAMES);
}

/**
 * What the Team & Network slide prints as an advisor's role: their own, or
 * "Advisor" when they have none. The test is `spinoutDeckData.ts`'s `has` — a
 * blank or a dash is no role.
 */
export function deckAdvisorRole(role: unknown): string {
  return !!role && String(role).trim() !== '' && String(role).trim() !== DASH
    ? String(role)
    : 'Advisor';
}

export type DeckReach = 'profile' | 'named' | 'counted';

/**
 * Given the ACTIVE rows' names in the deck's own order, what the deck does
 * with each: `profile` (drawn on Team & Network), `named` (in the mentors list
 * only), or `counted` (in the network total and the skill coverage, never
 * named). An archived row is not the deck's at all, so it is not an input.
 *
 * A row with no name is never `named` — `deckMentorNames` filters it out — so
 * it is `counted` unless it falls inside the profile cap, where the deck draws
 * it with a dash for a name.
 */
export function deckRosterReach(names: string[]): DeckReach[] {
  let named = 0;
  return names.map((name, i) => {
    const hasName = Boolean(name);
    if (i < DECK_ROSTER_PROFILES) {
      if (hasName) named += 1;
      return 'profile';
    }
    if (hasName && named < DECK_ROSTER_NAMES) {
      named += 1;
      return 'named';
    }
    return 'counted';
  });
}
