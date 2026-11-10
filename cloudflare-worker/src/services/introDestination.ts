/**
 * #4609 — ONE PLACE THAT BUILDS AN INTRODUCTION'S DESTINATION, AND IT SAYS
 * WHICH OF THE TWO INTRODUCTION SYSTEMS THE RECORD BELONGS TO.
 *
 * There are two, they are unrelated, and before this module each built its own
 * URL at each notification site:
 *
 *   PROPOSITIONS — `intro_propositions`, the double opt-in matches the platform
 *     proposes. Five notification sites (`routes/introductions.ts` and
 *     `services/introductions.ts`) wrote `/network?tab=introductions&intro=<uid>`.
 *   TEAMMATE REQUESTS — `relationship_interactions`, where one member asks a
 *     teammate to make an introduction (D4329). Four sites in
 *     `services/relationships.ts` wrote `/network/introductions?intro=<uid>`.
 *
 * TWO SHAPES FOR ONE DESTINATION IS NOT A STYLE DIFFERENCE. `?tab=` is read by
 * `NetworkPage` (operators, founders) and by `InvestorNetworkWorkspace`, and by
 * nothing else: `NetworkWorkspace` resolves its zone from the PATHNAME and
 * never looks at the query, so on `/network` it rendered the overview board.
 * A partner or advisor following a proposition notification therefore landed on
 * an overview with the uid silently discarded — the record they were told to
 * open was not on the screen and nothing said so. The path form, meanwhile,
 * reaches every licence, because `/network/introductions` is a real route
 * guarded for all five.
 *
 * SO THE CANONICAL FORM IS THE PATH, AND IT CARRIES `kind`:
 *
 *     /network/introductions?intro=<uid>&kind=proposition
 *     /network/introductions?intro=<uid>&kind=request
 *
 * `kind` is not decoration. Both surfaces live on that one zone — the teammate
 * desk and the licence's proposition body — and each matched the uid against
 * its own rows to decide whether to highlight it. A uid belonging to the other
 * system looked, to each of them, exactly like a record that had gone: the
 * desk's `introMissing` fired "that request is no longer here" for every
 * proposition link. `kind` lets each surface know whether the uid is addressed
 * to it, so only the right one claims it and only the right one can report it
 * missing.
 *
 * WHAT IS NOT HERE, DELIBERATELY: A LICENCE. S1's 2026-11-07 note on #4609
 * asks that a destination follow the licences an account HOLDS rather than one
 * "current role", because under #3704 an account can hold Founder, Investor,
 * Advisor and Operating Partner at once and there is no switcher. A URL naming
 * a licence would be exactly the single-role assumption that note rejects:
 * Network appears once in the union sidebar, so there is one Network entry and
 * one destination, and which BODY renders under it is the shell's decision from
 * the licences the account holds. The record's own access boundary is unchanged
 * and is enforced where it always was — every read of either table names the
 * caller in its WHERE clause, so a record whose licence the account does not
 * hold is 404 at the API, not hidden by a URL.
 *
 * BACKWARD COMPATIBILITY IS A PROPERTY OF THE RESOLVER, NOT OF THIS BUILDER.
 * Links already sent by email cannot be rewritten, so the frontend's
 * `resolveIntroTarget` accepts the legacy `?tab=introductions&intro=` shape
 * too and treats a missing `kind` as "unknown" — which is precisely today's
 * behaviour, each surface matching by uid. `frontend/src/lib/introDestination.js`
 * is the other half of this contract and the pair is pinned by
 * `cloudflare-worker/test/intro_destination_4609.test.ts`.
 */

/** Which introduction system a uid belongs to. */
export type IntroKind = 'proposition' | 'request';

/** The zone every licence can open. A real route, guarded for all five. */
export const INTRO_ZONE = '/network/introductions';

/** The query key the destination carries its record under. Unchanged, so old links still parse. */
export const INTRO_PARAM = 'intro';

/** The query key that says which of the two systems the uid is from. */
export const INTRO_KIND_PARAM = 'kind';

/**
 * The canonical destination for one introduction record, or for the zone itself
 * when there is no single record to open (a credit purchase, say).
 *
 * A uid is included only when it looks like one, so a malformed id degrades to
 * the zone rather than to a URL carrying junk in a query the browser will echo.
 */
export function introDestination(kind: IntroKind, uid?: string | null): string {
  const id = typeof uid === 'string' ? uid.trim() : '';
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return INTRO_ZONE;
  return `${INTRO_ZONE}?${INTRO_PARAM}=${encodeURIComponent(id)}&${INTRO_KIND_PARAM}=${kind}`;
}

/** The destination for a proposition (`intro_propositions`). */
export const propositionDestination = (uid?: string | null) => introDestination('proposition', uid);

/** The destination for a teammate introduction request (`relationship_interactions`, D4329). */
export const requestDestination = (uid?: string | null) => introDestination('request', uid);

/**
 * The shape five notification sites used to write by hand, kept ONLY so the
 * test that pins backward compatibility can name it. Nothing emits it any more.
 */
export const LEGACY_PROPOSITION_PREFIX = '/network?tab=introductions';
