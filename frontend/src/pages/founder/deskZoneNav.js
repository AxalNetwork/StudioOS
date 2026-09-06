/**
 * The one rule for a founder desk's zone pill strip: a pill reads active only
 * when the browser is actually on that pill's route.
 *
 * WHY THIS EXISTS. Four of the six desks used to paint pill #1 from CSS alone —
 * `.validate-anchors a:first-child`, `.raise-anchors a:first-child`,
 * `.a5-grow-hero nav a:first-child` and `.a6-hero a:first-child` — with no route
 * logic anywhere. So landing on `/validate` lit "Interviews" and landing on
 * `/grow` lit "Focus" while the reader was on the overview, which is above the
 * zones and is not one of them. Measured in Chromium before the fix: one accent
 * pill on each of `/validate`, `/raise`, `/grow` and `/network`.
 *
 * The other two desks had the mirror defect and lit nothing, ever:
 * `founderResearchDesk.css` styled `.a7-anchors a.active`, a class
 * `FounderResearchDesk` never set, and `.build-anchors` had no active rule at
 * all.
 *
 * AND THE POSITIONAL RULE LEAKED PAST ITS OWN PAGE. All seven `/grow/*` zone
 * pages import `founderGrowDesk.css` beside their own stylesheet and reuse its
 * `.a5-grow-hero` header, so `/grow/talent` rendered TWO accent pills — "Focus"
 * from the desk's `:first-child` and "Talent" from its own `is-active`.
 *
 * `is-active` rather than react-router's default `active` class: six zone-page
 * stylesheets already carry `.<zone>-zone-nav a.is-active`, so this is the
 * vocabulary the repo settled on. Returning `undefined` rather than `''` keeps
 * the attribute off idle pills entirely.
 *
 * NavLink matches on pathname, so the `?project_id=` these links carry rides
 * along without affecting the match — and it sets `aria-current="page"`, which
 * these strips had no way to convey except by colour.
 */
export const zonePillClass = ({ isActive }) => (isActive ? 'is-active' : undefined);
