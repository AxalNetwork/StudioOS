/**
 * The Spin-Out Lab arsenal — nineteen tools, and the three ways in.
 *
 * WHY NINETEEN IS SAFE TO SAY. It is the count of real, routed tools under
 * `/spinout-lab/*` in `App.jsx`: twenty-three routes, less `apply` (the
 * application form), `brief` (a printable PDF), `certificate` (issued on
 * graduation) and `investor-workspace` (an LP surface, not a founder tool).
 * Every entry below names the route it actually opens, and
 * `frontend/test/spinout_lab_intro.test.mjs` fails if one of them stops
 * resolving. The claim on the page is therefore checkable, which is the only
 * kind of headline number this product is allowed to print.
 *
 * WHAT A TRACK IS, AND WHAT IT IS NOT. A track is an ANSWER TO "where is the
 * company today", and it changes exactly one thing on screen: which tools are
 * drawn as leading. It does NOT change the gates. `MILESTONES` in
 * `cloudflare-worker/src/services/spinoutLabCatalog.ts` is one list, enforced
 * identically for everyone in the cohort, and the intro says so in words
 * beside the selector. Nothing records a track either — `spinout_applications`
 * has `incorporated` and a free-text `stage`, and no track column — so the
 * selector is presentational and the apply link carries no `track` param.
 * Adding one would look like a choice being remembered when it is being
 * dropped: `pages/RegisterPage.jsx` reads only `lane` and `product`.
 *
 * WHY THE TRACKS EXIST AT ALL. The page used to read "from idea to
 * incorporated in 28 days", which told every already-incorporated founder that
 * the Lab was not for them. It is: `users.is_incorporated` is only ever set by
 * graduating or quitting the Lab (`routes/spinout_lab.ts:207` and `:218`),
 * never by arriving with a company, so a founder who incorporated elsewhere
 * has always been able to apply, be admitted and start. The tracks say that out
 * loud instead of leaving it to be inferred.
 */

/** The five groups, in the order the arsenal draws them. */
export const TOOL_GROUPS = ['Company', 'Evidence', 'Build', 'Formation', 'Capital'];

/**
 * Every tool, in index order.
 *
 * `route` IS PROVENANCE, NOT A LINK. The intro's test asserts each one against
 * `App.jsx`, so the "nineteen working tools" claim is checkable and a renamed
 * route breaks the build. But the cards do not link anywhere, because nobody
 * reading this page could follow them: every `/spinout-lab/<tool>` route is
 * `guard(labRoles(['admin']))`, and `labRoles` (App.jsx) widens the allowed
 * list only when `user.spinout_lab_active === 1`. The signed-in intro is by
 * construction the NOT-active branch — it is what a member sees before they
 * have applied — so every card would bounce off RoleGuard, and a logged-out
 * visitor has no session at all. A link that always fails is worse than a card
 * that never claimed to be one, so the arsenal renders inert and says why.
 */
export const LAB_TOOLS = [
  { id: 'record', group: 'Company', name: 'Company record', blurb: 'One record every tool writes into.', route: '/spinout-lab/startup' },
  { id: 'profile', group: 'Company', name: 'Founder profiling', blurb: 'Skills, values, archetype.', route: '/spinout-lab/profiling' },
  { id: 'score', group: 'Company', name: 'Venture scoring', blurb: 'Nine dimensions, each with its confidence.', route: '/spinout-lab/scoring' },
  { id: 'advisors', group: 'Company', name: 'Advisor matching', blurb: 'Advisors matched against measured gaps.', route: '/spinout-lab/advisors' },
  { id: 'cofind', group: 'Company', name: 'Co-founder matching', blurb: 'Complementarity, not similarity.', route: '/spinout-lab/cofounder-match' },

  { id: 'disc', group: 'Evidence', name: 'Customer discovery', blurb: 'Interviews logged with severity.', route: '/spinout-lab/discovery' },
  { id: 'market', group: 'Evidence', name: 'Market sizing', blurb: 'TAM and SAM, with their citations.', route: '/spinout-lab/market' },
  { id: 'revenue', group: 'Evidence', name: 'Revenue proof', blurb: 'Recorded by source, not asserted.', route: '/spinout-lab/revenue' },

  { id: 'roadmap', group: 'Build', name: 'Roadmap and OKRs', blurb: 'MVP scope, value-rated.', route: '/spinout-lab/roadmap' },
  { id: 'brand', group: 'Build', name: 'Brand and landing pages', blurb: 'Sixteen templates, with lead routing.', route: '/spinout-lab/brand' },
  { id: 'deck', group: 'Build', name: 'Pitch deck', blurb: 'Twelve slides from your own data.', route: '/spinout-lab/pitch-deck' },

  { id: 'inc', group: 'Formation', name: 'Incorporation', blurb: 'The entity, by jurisdiction.', route: '/spinout-lab/incorporate' },
  { id: 'cap', group: 'Formation', name: 'Cap table', blurb: 'Vesting, dilution, waterfall.', route: '/spinout-lab/captable' },
  { id: 'e83b', group: 'Formation', name: '83(b) tracking', blurb: 'The 30-day window, counted for you.', route: '/spinout-lab/83b' },
  { id: 'coagree', group: 'Formation', name: 'Co-founder agreement', blurb: 'Clause by clause, then e-signed.', route: '/spinout-lab/cofounder-agreement' },
  { id: 'comply', group: 'Formation', name: 'Compliance', blurb: 'Formation, equity, filings, records.', route: '/spinout-lab/compliance' },

  { id: 'raise', group: 'Capital', name: 'Raise workspace', blurb: 'Target, committed, wired.', route: '/spinout-lab/capital' },
  { id: 'uof', group: 'Capital', name: 'Use of funds', blurb: 'Allocation, runway, scenarios.', route: '/spinout-lab/use-of-funds' },
  { id: 'office', group: 'Capital', name: 'Office hours', blurb: 'Partner organisations, booked.', route: '/spinout-lab/office-hours' },
];

/** The claim the page is allowed to make, computed rather than typed. */
export const TOOL_COUNT = LAB_TOOLS.length;

/**
 * The three starting points. `leads` names tool ids, never routes, so a route
 * rename is a one-line change in LAB_TOOLS above and nothing here moves.
 */
export const LAB_TRACKS = [
  {
    id: 'form',
    name: 'Form',
    who: 'No entity yet — an idea, a prototype, or research you want out of the lab.',
    leads: ['inc', 'e83b', 'cap', 'coagree', 'cofind', 'comply'],
  },
  {
    id: 'fit',
    name: 'Find fit',
    who: 'Incorporated already, but the market has not answered yet.',
    leads: ['disc', 'market', 'profile', 'score', 'revenue'],
  },
  {
    id: 'line',
    name: 'Launch a line',
    who: 'Incorporated and running — testing a second product on the same entity.',
    leads: ['disc', 'market', 'brand', 'roadmap', 'revenue'],
  },
];

export const DEFAULT_TRACK = 'form';

/** A track by id, falling back to the first rather than returning undefined. */
export function labTrack(id) {
  return LAB_TRACKS.find((t) => t.id === id) || LAB_TRACKS[0];
}

/**
 * The sentence under a track card: which tools lead on it, in prose.
 * Built from `leads` so it can never drift from the cards drawn above it.
 */
export function leadsWithFor(trackId) {
  const track = labTrack(trackId);
  const names = track.leads
    .map((id) => LAB_TOOLS.find((t) => t.id === id)?.name)
    .filter(Boolean)
    .map((n) => n.toLowerCase());
  if (!names.length) return null;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The arsenal, grouped, with each tool marked for the selected track.
 *
 * `lead` is the only per-track signal. There is deliberately NO second state
 * saying a tool is already available to this member outside the Lab: that
 * would need a per-account read of which tools the account can reach, and the
 * only thing at hand is `state.unlocked_features`, which describes the WEEK a
 * founder has reached inside the Lab — a different question. Drawing it as if
 * it answered "do you already have this" would be a plausible-looking guess,
 * so it is not drawn at all.
 */
export function arsenalFor(trackId) {
  const track = labTrack(trackId);
  const lead = new Set(track.leads);
  return TOOL_GROUPS.map((group) => {
    const tools = LAB_TOOLS
      .map((t, i) => ({ ...t, n: String(i + 1).padStart(2, '0'), lead: lead.has(t.id) }))
      .filter((t) => t.group === group);
    return { group, tools };
  });
}
