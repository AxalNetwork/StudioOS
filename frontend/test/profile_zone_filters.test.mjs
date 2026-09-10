/**
 * The other half of the zone header row: every canvas filter is accounted for,
 * and each one either narrows real rows or says what is missing.
 *
 * `profile_zone_actions.test.mjs` guards the `ops:` array on the right of that
 * row. This guards the `filters:` array on the left, and it exists because the
 * failure mode is quieter. An action nothing performs at least does nothing
 * visible. A filter nothing backs returns an EMPTY SET, and an empty set reads
 * as an answer: `/grow/customers` shipped a live "Stalled" chip whose predicate
 * was `return []`, so clicking it said "you have no stalled accounts" when the
 * truth was that no store records activity at all. That is the product's
 * central rule — absent is not empty — failing where the failure looks like
 * data, which is the only place it really costs anything.
 *
 * WHY IT READS THE MODULE AND NOT THE SOURCE TEXT. Its sibling regexes the
 * table out of the file because `founderZoneActions.js` cannot be imported by
 * Node. This table can, so it is, and the assertions run against the real
 * structure rather than a parser that agrees with it on a good day.
 *
 * Run with:
 *   node --test frontend/test/profile_zone_filters.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './_codeOnly.mjs';
import { escapeRe } from './_escapeRe.mjs';
import { FOUNDER_ZONE_FILTERS, founderZoneFilters } from '../src/workspaces/founderZoneFilters.js';
import { INVESTOR_ZONE_FILTERS, investorZoneFilters } from '../src/workspaces/investorZoneFilters.js';
import { ADVISOR_ZONE_FILTERS, advisorZoneFilters } from '../src/workspaces/advisorZoneFilters.js';
import { PARTNER_ZONE_FILTERS, partnerZoneFilters } from '../src/workspaces/partnerZoneFilters.js';
import { canvasFilterLabels } from '../src/workspaces/zoneFilterBuilder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');


/**
 * Zone key → the file that renders that zone's toolbar, for the surfaces four
 * licences share.
 *
 * `mountingFile()` finds a page by searching for the profile's OWN builder name
 * with a literal zone key. That works for a page importing its licence's table
 * directly and cannot work here: `ResearchWorkspace` calls
 * `zoneFiltersFor(role, 'research/library', …)` and hands the body a bound
 * function, so the body never names the zone and the workspace never names the
 * licence. Written down, one map for all four profiles, because it IS the same
 * file for all four — which is the fact the whole per-licence table design
 * exists to handle.
 */
// The Network bodies, and they are NOT one shared file the way Research's are:
// each licence has its own. `roleMountVerdict` still treats a declared body as
// shared and requires `role={role}` — which is right here for a different
// reason. The workspace resolved the role and hands it down; a literal in
// `FounderNetworkRelationships` would be true, but the variable is what the
// mount actually passes and what the accent reads.
const NETWORK_BODIES = {
  founder: {
    'network/relationships': 'frontend/src/pages/founder/FounderNetworkRelationships.jsx',
    'network/introductions': 'frontend/src/pages/founder/FounderNetworkIntroductions.jsx',
    'network/organizations': 'frontend/src/pages/founder/FounderNetworkOrganizations.jsx',
  },
  // One file, three zones: `InvestorNetworkWorkspace` renders all three sections
  // and the shell narrows it to one with `zone={slug}`.
  investor: {
    'network/relationships': 'frontend/src/pages/investor/InvestorNetworkWorkspace.jsx',
    'network/introductions': 'frontend/src/pages/investor/InvestorNetworkWorkspace.jsx',
    'network/organizations': 'frontend/src/pages/investor/InvestorNetworkWorkspace.jsx',
  },
  advisor: {
    'network/relationships': 'frontend/src/pages/advisor/network/RelationshipsZone.jsx',
    'network/introductions': 'frontend/src/pages/advisor/network/IntroductionsZone.jsx',
  },
  // The partner arm's bodies are the PANELS, not `NetworkPage`: the page
  // forwards the two-argument builder and the panels render the rows.
  partner: {
    'network/relationships': 'frontend/src/pages/RelationshipsPage.jsx',
    'network/introductions': 'frontend/src/pages/IntroductionsPanel.jsx',
    // The one Network zone this licence does NOT reach through `NetworkPage`:
    // the workspace dispatches it directly, because the page has no tab for it.
    'network/organizations': 'frontend/src/pages/partner/OrganizationsZone.jsx',
  },
};

const RESEARCH_BODIES = {
  'research/ask': 'frontend/src/pages/research/AskZone.jsx',
  'research/library': 'frontend/src/pages/research/LibraryZone.jsx',
  // WAS `pages/SignalsPage.jsx`, AND THE ZONE'S OBJECT IS WHY IT MOVED. That
  // page is the `market_intel_rows` sector feed and keeps its own route at
  // `/signals`; the `pr3` artboard is about comparable RANGES for the firm's
  // own service lines, which is what `MarketZone` reads.
  'research/markets': 'frontend/src/pages/research/MarketZone.jsx',
  'research/companies': 'frontend/src/components/CompetitorAnalysis.jsx',
  'research/funds': 'frontend/src/pages/research/FundsZone.jsx',
  'research/benchmarking': 'frontend/src/pages/research/BenchmarkingZone.jsx',
  'research/diligence': 'frontend/src/pages/research/DiligenceZone.jsx',
  'research/client-prep': 'frontend/src/pages/research/ClientPrepZone.jsx',
};

const PROFILES = {
  founder: {
    table: FOUNDER_ZONE_FILTERS,
    build: founderZoneFilters,
    call: 'founderZoneFilters',
    // ALL FIVE founder canvases. This used to read `(Build|Raise|Grow)`, which
    // hid Founder Network and Founder Research from the check entirely — a
    // carve-out by REGEX, where the rest of this file records a deferral by
    // NAME. The difference matters: a regex narrows the question so the
    // uncovered zones never come up, while `excluded` forces each one to be
    // listed with a reason and re-checked on every run. The eight shared-surface
    // routes moved from the first mechanism to the second here.
    canvas: /^Pages · Founder /,
    // `workspaces/founder` holds `FounderValidateWorkspace`, which mounts all
    // four `/validate/*` rows. The walk does not recurse, so the subdirectory
    // is named outright rather than inherited from its parent.
    pages: ['frontend/src/pages/founder', 'frontend/src/workspaces', 'frontend/src/workspaces/founder'],
    actions: 'frontend/src/workspaces/founderZoneActions.js',
    zones: 30,
    mounted: 30,
    bodies: { ...RESEARCH_BODIES, ...NETWORK_BODIES.founder },
    // EMPTY, AND THIS TIME THE COUNT PROVES IT RATHER THAN AGREEING WITH IT.
    // The four `validate/*` zones sat here for one release, and the note that
    // held them recorded two separate errors worth keeping, because each was
    // reasoning from a reader's blind spot rather than from the canvas.
    //
    // FIRST: "`Pages · Founder Validate` … a single artboard looped over a
    // `boards` array, so a reader that only understood `route:'…'` found nothing
    // in it". True of the reader, never of the canvas. That artboard has carried
    // sixteen chips the whole time — `views(['All','Deck-eligible','Strong fit',
    // 'Not ICP'])` and three more like it — in a helper named `views` rather than
    // `fil`, differing in name only. `artboardFilters` reads both dialects now,
    // and the per-file emptiness assert above is what stopped the sixth canvas
    // from contributing nothing and saying nothing about it.
    //
    // SECOND, AND THE ONE THAT ACTUALLY BLOCKED THE WORK: the test below requires
    // every zone with a filter table to have an ACTION table for the same zone,
    // and `founderZoneActions.js` had no `validate/*` key — that workspace built
    // its row in a local `ACTIONS` map, because `zoneActionBuilder.js` could
    // express `kind: 'export'` over loaded rows, `to:` a route and `unbuilt:`,
    // and none of the three fits an op that opens a dialog the page owns or runs
    // a server-side download with a busy spinner. The note called that "a
    // defensible change and probably the right one". It was: `kind: 'handler'`
    // is that fourth kind, D67 records it, and the six Validate ops are its first
    // and only use.
    //
    // The count moved 26 → 30 in the same commit. It counts the DIRECTORY, so it
    // is what refuses the reading the old note's own first line fell into — a
    // covered set agreeing with itself.
    excluded: [],
    // Counts welded onto a real filter — `All 14`, `All 14 mo`, `Aug 2026`.
    samples: /\b(14|2026)\b/,
    // Founder canvas routes are the live routes.
    live: (route) => route.replace(/^\//, ''),
  },

  investor: {
    table: INVESTOR_ZONE_FILTERS,
    build: investorZoneFilters,
    call: 'investorZoneFilters',
    // All five investor page canvases, because this table grows one bucket at a
    // time and `excluded` below is what records how far it has got. Founder can
    // narrow by canvas name — its carve-out is two whole components shared with
    // another licence — but a bucket-by-bucket build needs the full canvas set
    // visible so each zone left out is named rather than filtered away.
    canvas: /^Pages · Investor (Deals|Fund|Network|Portfolio|Research)\.dc\.html$/,
    pages: ['frontend/src/pages/investor', 'frontend/src/workspaces/investor', 'frontend/src/workspaces'],
    actions: 'frontend/src/workspaces/investorZoneActions.js',
    zones: 16,
    mounted: 16,
    bodies: { ...RESEARCH_BODIES, ...NETWORK_BODIES.investor },
    // Fund, Portfolio and Deals' pipeline. Every other canvas route, with why
    // it is not here yet:
    excluded: [
      // Deals' three DECISION zones. Their canvas filters all describe LIST
      // surfaces — `All decisions`, `Pass reasons`, `Documents` — and each of
      // these three renders a single-record panel (`screeningRows[0]`,
      // `grouped.commit[0]`, `grouped.closing[0]`). Filtering a one-record
      // panel narrows nothing, so honouring these means building the lists the
      // canvas draws, which is body work.
      //
      // AND THE EASY VERSION WOULD SHIP FOUR FALSE SENTENCES. Every "nothing
      // is stored" note these zones would need was checked against the schema
      // and is wrong: `ic_decisions` and `ic_votes` exist and `api.icList` is
      // investor-callable (though it returns every decision in the system
      // unscoped, which is its own problem); `dd_findings` carries a severity
      // enum through `critical`; `api.dealDocuments(id)` is a method; and
      // `pass_reason` is a stored, CHECKed taxonomy the pipeline zone now
      // reads. A deferral that says so is worth more than a row that lies.
      'deals/screening', 'deals/commit', 'deals/closing',
    ],
    // `Call 3` names one specific stored record rather than welding a count
    // onto a filter, so `{n}` is not its repair and founder's `/\b(14|2026)\b/`
    // would not even see it. `Aug 2026` recurs on the Portfolio canvas.
    samples: /\bCall \d+\b|\b(14|2026)\b/,
    // The Fund canvas says `/fund/*`; the router mounts `/funds/*`, and
    // `accounting` at the slug `ledger`. `profile_zone_actions.test.mjs:73-79`
    // carries the same map for the ops half of the same rows.
    live: (route) => ({
      '/fund/lps': 'funds/lps',
      '/fund/calls': 'funds/calls',
      '/fund/accounting': 'funds/ledger',
      '/fund/reporting': 'funds/reporting',
    }[route] ?? route.replace(/^\//, '')),
  },

  // ADVISOR AND PARTNER WERE REGISTERED AT ZERO AND ARE NO LONGER. Both were
  // added with empty tables and every canvas route in `excluded`, one commit
  // before either had an entry, so that `canvasDirs` was a hook four profiles
  // exercised rather than a parameter one profile passed — and so the day a
  // canvas gained a zone, the exact-set check failed for the licence that
  // gained it rather than for nobody. Their first two zones are the shared
  // Research surfaces below, where this licence gets four live chips out of
  // `/research/library` and founder gets one out of five.
  advisor: {
    table: ADVISOR_ZONE_FILTERS,
    build: advisorZoneFilters,
    call: 'advisorZoneFilters',
    // Advisor and partner canvases ship from `design/incoming/`, not
    // `design/canvases/integrated/`. `profile_zone_actions.test.mjs` has read
    // both through a `canvasDirs` key since the Expertise bucket landed there;
    // this file hardcoded the integrated directory until now, which is why I
    // reported these two licences as having no canvas at all. They have four.
    canvasDirs: ['design/incoming'],
    canvas: /^Pages · Advisor (Network|Research)\.dc\.html$/,
    pages: ['frontend/src/pages/advisor', 'frontend/src/pages/research', 'frontend/src/workspaces'],
    actions: 'frontend/src/workspaces/advisorZoneActions.js',
    zones: 7,
    mounted: 7,
    bodies: { ...RESEARCH_BODIES, ...NETWORK_BODIES.advisor },
    // THE ONE EXCLUSION THAT IS NOT A DEFERRAL. Founder and investor left this
    // list; advisor and partner do not follow, and the reason is not that their
    // half is unwritten. `OrganizationsZone` is a dashed card whose entire body
    // is the gap statement — it imports no `api`, renders no rows and has no
    // state to narrow — so four controls above it would be a filter row over a
    // sentence explaining why there is nothing to filter. The shared-component
    // argument that binds the other two Network zones does not reach here:
    // founder and advisor mount DIFFERENT files for organizations.
    excluded: [
      'network/organizations',
    ],
    // No `samples`: not one advisor label carries a figure, and the assertion
    // below proves that rather than taking it on trust — a canvas that gains an
    // `All 14` forces this profile to declare a pattern.
    live: (route) => route.replace(/^\//, ''),
  },

  partner: {
    table: PARTNER_ZONE_FILTERS,
    build: partnerZoneFilters,
    call: 'partnerZoneFilters',
    // BOTH DIRECTORIES, BECAUSE THE PARTNER SET IS SPLIT ACROSS THEM. Network,
    // Offers and Research were re-exported into `design/incoming/`; Delivery and
    // Pipeline were not, and their newest export is the one already in
    // `design/canvases/integrated/` — verified byte-for-byte against the
    // artifact the Delivery bucket was specified from. Naming only one
    // directory made `delivery/board`'s chip row look like labels from nowhere.
    canvasDirs: ['design/incoming', 'design/canvases/integrated'],
    // `Offers` JOINS THE REGEX, and `canvasDirs` needs no change for it:
    // `design/incoming/Pages · Partner Offers.dc.html` is already in the
    // directory this profile opens, and it is byte-identical on the nineteen
    // labels to the copy in `design/canvases/integrated/` — checked rather than
    // assumed, both name the same five routes in the same order.
    // `Pipeline` JOINS THE REGEX, and it is the reader's third canvas shape —
    // `<section class="ab" id="p1">` markup with the route in `class="ab-sub"`
    // and the chips behind a `sc-for list="{{ l_views }}"` binding. See
    // `artboardFilters`. Until it entered scope the whole Pipeline bucket was
    // absent from `partnerZoneFilters.js`: five zones, five `views([…])` rows on
    // the artboard, and no chip row anywhere in the product.
    canvas: /^Pages · Partner (Delivery|Network|Offers|Pipeline|Research)\.dc\.html$/,
    // `pages/partner/offers` IS ITS OWN ENTRY BECAUSE `mountingFile` DOES NOT
    // RECURSE. Three of the five Offers zones have their own file in there and
    // are found by the ordinary search once the directory is listed — which
    // matters beyond convenience: a zone located by search is NOT `shared`, so
    // it is held to naming its own licence (`role="partner"`), where a zone
    // declared in `bodies` is allowed the `role={role}` variable. Putting these
    // three in the map to save a line would have handed them that exemption
    // and stopped this file checking the thing it exists to check.
    pages: ['frontend/src/pages/partner', 'frontend/src/pages/partner/offers',
      'frontend/src/pages/partner/delivery', 'frontend/src/pages/partner/pipeline',
      'frontend/src/pages/research', 'frontend/src/workspaces'],
    actions: 'frontend/src/workspaces/partnerZoneActions.js',
    // Thirteen. The twelfth was `network/organizations` — the zone this
    // profile's `excluded` list carried until migrations 224 and 226 gave the
    // book a company name and a relationship to group it by. The thirteenth is
    // `delivery/board`, which had no row in the filter table at all: it
    // rendered `EngagementsPage`, which draws `ZoneActions` directly and no
    // toolbar, so there was nowhere for a chip row to go. It has its own zone
    // now, reading the five stores migration 208 built for this bucket.
    // Was 11, then 12, then 13 — and 13 lasted one run: widening the canvas
    // regex to read `Pages · Partner Delivery` surfaced FOUR MORE artboards
    // whose chip rows this table did not cover at all. All five Delivery zones
    // specify one; none had an entry, and the guard could not say so because
    // the file its labels come from was outside the pattern it read.
    // Twenty-two. Widening the regex to read `Pages · Partner Pipeline`
    // surfaced FIVE MORE artboards whose chip rows this table did not cover at
    // all — the entire bucket. Every one of the five specifies a `views([…])`
    // row; none had an entry, and the guard could not say so because the canvas
    // was outside the pattern it read and in a shape it could not parse. Was
    // 11, then 12, then 13, then 17.
    zones: 22,
    // And all thirteen mount their filters: `BoardZone` and `OrganizationsZone`
    // take the same bound builder their siblings do, and the four other
    // Delivery zones hoist a `ZoneToolbar` above their `ZoneBody` the way every
    // newer zone does. Was 11, then 12, then 13.
    // ALL TWENTY-TWO MOUNT THEIRS, which is the count landing when the last
    // Pipeline zone was composed. The three that used to be named as exceptions
    // — `pipeline/negotiations`, `pipeline/retainers`, `pipeline/analytics` —
    // had their own files and no header row in them; each got one. Two others
    // joined by ceasing to render a shared page: `pipeline/leads` was the
    // marketplace board four licences see, `pipeline/proposals` the
    // proposals-and-invoices view it shared with `delivery/board`.
    //
    // Was 11, then 12, then 13, then 17, then 18, then 21. A zone added to this
    // profile without a chip row now moves this number DOWN, which is the shape
    // this census is for.
    mounted: 22,
    // THE PARTNER SET CARRIES SAMPLES NOW, AND ONLY IN ONE PLACE. Its canvases
    // were digit-free until `Pages · Partner Pipeline` entered scope, which is
    // exactly what the "prove the absence" branch of the sample test exists to
    // catch — and it did, naming all four labels with a figure in them.
    //
    // Two of the four are NOT samples and the pattern must not treat them as
    // such: `Stalled 7d+` and `Renewing 30d` are thresholds this product
    // implements — seven days without a move, thirty days to a renewal — so the
    // number IS the filter's meaning rather than a figure from the mock data.
    // The other two are the quarter the artboard happened to be drawn in, and a
    // chip reading `Q3 2026` would be wrong for every reader after it, so both
    // are relabelled positionally: `This quarter`, `Last quarter`.
    samples: /\b(?:Q[1-4] )?20\d\d\b/,
    // The two that ARE genuinely shared. `ServiceCatalogPage` is mounted for
    // admin, founder, partner and investor and `PerksPage` for those four plus
    // advisor and exploring, both from `frontend/src/pages/` — a directory this
    // profile does not list and could not list, since it holds a hundred
    // unrelated files. Neither page names a zone: the bucket router hands each
    // a bound builder as a render prop, exactly as it already hands them their
    // actions, so the search has no needle to find and the map is the only way.
    bodies: {
      ...RESEARCH_BODIES,
      ...NETWORK_BODIES.partner,
      'offers/catalog': 'frontend/src/pages/ServiceCatalogPage.jsx',
      'offers/perk-deals': 'frontend/src/pages/PerksPage.jsx',
    },
    // NOTHING IS EXCLUDED ON THIS LICENCE ANY MORE, and the entry that was
    // here is the one this list existed to keep honest. It read: "Same as
    // advisor's, one step further: there is not even a card. This licence has
    // no organizations panel at all — `NetworkPage`'s `unservedAlone`
    // suppresses it — so a row here would attach to nothing." Migrations 224
    // and 226 gave the book a company name and a relationship, so the zone has
    // its own body (`pages/partner/OrganizationsZone.jsx`) and its four chips
    // narrow over it. An exclusion cannot grow by accident and a stale one
    // cannot linger — this is the second half of that rule doing its work.
    excluded: [],
    // `Pages · Partner Research` names /research/market; the router and
    // `shellConfig.js` both say `markets`. Same mapping the ops half carries.
    live: (route) => (route === '/research/market' ? 'research/markets' : route.replace(/^\//, '')),
  },
};

/**
 * Every matching artboard's route and its `filters:` labels, from the canvas.
 *
 * `profile.live` maps a canvas route onto the route the router actually mounts.
 * The founder canvases need no mapping; the investor Fund canvas says `/fund/*`
 * where the router says `/funds/*` and mounts `accounting` at the slug
 * `ledger`. `profile_zone_actions.test.mjs` has carried the same hook since it
 * was written — the mapping is spelled out per profile rather than guessed,
 * so a canvas route that stops resolving fails here instead of matching
 * nothing and quietly shrinking the covered set.
 */
function canvasFilters(profile) {
  const out = {};
  // `canvasDirs` defaults to the integrated set. Advisor and partner ship theirs
  // from `design/incoming/`, and a directory a profile does not name is not
  // read for it — so a canvas moving between the two fails loudly here rather
  // than dropping out of the covered set.
  for (const dir of profile.canvasDirs || ['design/canvases/integrated']) {
    for (const file of readdirSync(resolve(root, dir)).filter((f) => profile.canvas.test(f))) {
      const src = read(`${dir}/${file}`);
      const found = artboardFilters(src);
      // PER FILE, THE WAY `profile_zone_actions.test.mjs` DOES IT, and for the
      // reason found there: a canvas whose NAME matched and whose contents this
      // reader could not parse contributed nothing and said nothing. Founder's
      // regex is `/^Pages · Founder /`, which matches SIX files; the note beside
      // its empty `excluded` list said "all five founder artboards", and the
      // sixth — `Pages · Founder Validate` — was the one this reader could not
      // open. A comment counted what the parser could see rather than what the
      // directory holds, which is exactly the failure the count now forbids.
      assert.ok(Object.keys(found).length,
        `${dir}/${file} matched ${profile.canvas} and yielded no artboard — ` +
        'it is in neither known shape, or one of them has changed');
      for (const [route, labels] of Object.entries(found)) out[profile.live(route)] = labels;
    }
  }
  return out;
}

/**
 * The two canvas shapes that declare filter chips.
 *
 * SHAPE A — a `PAGES` array: `route:'/research/library'` … `filters: fil([…])`.
 * Every canvas this reader has ever opened uses it.
 *
 * SHAPE C — one templated artboard looped over a `boards` array in the canvas's
 * own data block, where the route hides inside `sub:'violet · /validate/pain-map'`
 * and the chips are `views(['All','Deck-eligible',…])`. `Pages · Founder
 * Validate` is the only one, and until the assertion above it was invisible
 * here: no `route:'…'` anywhere in the file, so the loop simply never ran.
 *
 * The pair is read PER BOARD rather than by zipping two whole-file matches, so
 * a board that gains a `sub` and no `views` drops out instead of shifting every
 * later board's chips onto the wrong route.
 *
 * SHAPE D — `<section class="ab" id="p1">` markup, where the route sits in the
 * section's own `class="ab-sub"` (`amber · /pipeline/leads`) and the chips come
 * from the FIRST `sc-for list="{{ l_views }}"` binding inside it, resolved
 * against a `l_views: views([…])` in the canvas's data block. `Pages · Partner
 * Pipeline` is the only one, and until this branch existed it was invisible
 * here for the same reason `Pages · Founder Validate` was: nothing in the file
 * matches `route:'…'`, so the loop never ran.
 *
 * THE DOCBLOCK HERE USED TO SAY THIS SHAPE WOULD NEVER BE READ, and it is worth
 * recording why that was right and what changed rather than deleting it. It
 * read: "`profile_zone_actions.test.mjs` knows a third shape … It is
 * deliberately not here: no canvas in any filter profile's scope uses it, and a
 * branch nothing exercises is a branch nobody notices breaking. A canvas in
 * that shape entering scope trips the assertion above, which is the intended
 * way to find out." That is exactly what happened — the Pipeline bucket's five
 * zones had no chip row in `partnerZoneFilters.js` at all, and bringing the
 * canvas into scope is what proves the five rows added for them are the
 * artboard's own labels rather than a guess.
 *
 * The binding is read PER SECTION rather than by zipping whole-file matches, so
 * a section that gains a route and no `views` drops out instead of shifting
 * every later section's chips onto the wrong zone.
 */
function artboardFilters(src) {
  const out = {};
  if (/route:\s*'/.test(src)) {
    for (const chunk of src.split(/route:\s*'/).slice(1)) {
      const route = chunk.slice(0, chunk.indexOf("'"));
      const filters = chunk.match(/filters:\s*fil\(\[([^\]]*)\]/);
      if (!filters) continue;
      out[route] = chips(filters[1]);
    }
    return out;
  }
  const boardsAt = src.search(/\bboards:\s*\[/);
  if (boardsAt >= 0) {
    for (const board of src.slice(boardsAt).split(/\{ id:\s*'/).slice(1)) {
      const route = board.match(/sub:\s*'[^']*?(\/[a-z0-9/-]+)'/);
      const views = board.match(/views\(\[([^\]]*)\]\)/);
      if (!route || !views) continue;
      out[route[1]] = chips(views[1]);
    }
    return out;
  }
  for (const section of src.split(/<section class="ab" id="/).slice(1)) {
    const route = section.match(/class="ab-sub">[^<]*?(\/[a-z0-9/-]+)</);
    const binding = section.match(/sc-for list="\{\{\s*(\w+_views)\s*\}\}"/);
    if (!route || !binding) continue;
    // The binding names a `<name>: views([…])` in the canvas's data block. The
    // list is looked up rather than assumed from the section's id, because the
    // prefixes (`l_`, `pr_`, `n_`, `r_`, `a_`) are the canvas author's shorthand
    // and nothing makes them track the section ids.
    // BUILT WITH `escapeRe`, NOT INTERPOLATED RAW. `binding[1]` comes out of a
    // canvas file, and a canvas is an input this repo takes from outside — so a
    // binding name carrying regex metacharacters would either build a pattern
    // that means something else or, with the right nesting, one that
    // backtracks. `\w+` in the match above already constrains it, which is why
    // this is belt-and-braces rather than a live hole; escaping is still the
    // right shape, and Semgrep's `detect-non-literal-regexp` is correct to
    // insist on it (finding 6048).
    const declared = src.match(new RegExp(`\\b${escapeRe(binding[1])}:\\s*views\\(\\[([^\\]]*)\\]\\)`));
    if (!declared) continue;
    out[route[1]] = chips(declared[1]);
  }
  return out;
}

/**
 * `'All','Deck-eligible','Strong fit'` → the three labels.
 *
 * READ AS QUOTED STRINGS, NOT SPLIT ON COMMAS. A comma inside a label is not a
 * separator, and one exists: `Pages · Partner Pipeline` draws `'All','Opened,
 * unanswered','Never opened',…` on its proposals artboard. Splitting turned that
 * one chip into two — `Opened` and `unanswered` — and then reported the table as
 * having drifted from a canvas it matched exactly.
 */
function chips(list) {
  return [...list.matchAll(/'((?:[^'\\]|\\.)*)'/g)]
    .map((m) => m[1].replace(/\\(.)/g, '$1'))
    .filter(Boolean);
}

/**
 * What a `<ZoneToolbar>` mount must say about its licence — null when correct,
 * the complaint when not.
 *
 * A SHARED BODY PASSES THE VARIABLE; A LICENCE'S OWN PAGE NAMES ITSELF.
 * `LibraryZone` serves four licences from one file, so `role="advisor"` there
 * would be false three times out of four — the only correct mount is
 * `role={role}`, threaded down from the workspace that resolved it. A page
 * under `pages/investor/` has no such excuse: it serves one licence, and a
 * literal is the thing that can be checked. `ZoneToolbar` defaults `role` to
 * `'founder'`, so an omitted prop on any other licence paints violet chips on
 * an indigo page and nothing else catches it.
 *
 * Whether a zone is shared comes from `bodies`, the same map that located the
 * file — so a zone cannot quietly claim the variable exemption without also
 * being declared shared.
 *
 * Extracted from the loop so the rule can be exercised directly. Its three
 * cases arrived before the tables that will use two of them, and a hook nothing
 * runs is a hook nobody notices breaking.
 */
function roleMountVerdict({ mount, licence, shared }) {
  const claimed = mount.match(/role=["'](\w+)["']/)?.[1];
  if (shared) {
    return /role=\{role\}/.test(mount)
      ? null
      : `serves every licence, so it must pass role={role}, not role="${claimed}"`;
  }
  if (licence === 'founder') {
    return claimed === undefined || claimed === 'founder'
      ? null
      : `mounts a founder ZoneToolbar claiming role="${claimed}"`;
  }
  return claimed === licence
    ? null
    : `mounts a ZoneToolbar with role="${claimed}", so it wears founder violet`;
}

for (const [name, profile] of Object.entries(PROFILES)) {
  test(`${name}: every artboard's filters are accounted for, in canvas order`, () => {
    const canvas = canvasFilters(profile);
    const zones = Object.keys(profile.table);
    assert.equal(zones.length, profile.zones, 'the table gained or lost a zone');
    for (const zone of zones) {
      assert.ok(canvas[zone], `${zone} has no artboard — where did its labels come from?`);
      assert.deepEqual(
        canvasFilterLabels(profile.table, zone),
        canvas[zone],
        `${zone} does not match its artboard's filters`,
      );
    }
    // A zone the canvas specifies and this table deliberately does not carry
    // yet. Checked as an exact SET, the way `profile_zone_actions` does it, so
    // a deferral is recorded rather than silent: an exclusion cannot grow by
    // accident, and a route that stops existing on a canvas fails here instead
    // of sitting in the list forever.
    const excluded = profile.excluded || [];
    const specified = Object.keys(canvas).filter((route) => !excluded.includes(route));
    assert.deepEqual(specified.sort(), Object.keys(profile.table).sort(),
      'an artboard specifies filters for a zone this table does not cover');
    for (const skip of excluded) {
      assert.ok(canvas[skip], `${skip} is excluded but no artboard specifies it`);
      assert.ok(!profile.table[skip], `${skip} is both excluded and declared`);
    }
  });

  test(`${name}: an entry is a live key, an unbuilt reason, or a dynamic group — never two`, () => {
    for (const [zone, rows] of Object.entries(profile.table)) {
      for (const row of rows) {
        const kinds = [row.key ? 'key' : null, row.dynamic ? 'dynamic' : null,
          !row.key && !row.dynamic && row.unbuilt ? 'unbuilt' : null].filter(Boolean);
        assert.equal(kinds.length, 1, `${zone} · ${row.canvas} is ${kinds.length} things at once`);
        if (row.key) assert.ok(!row.unbuilt, `${zone} · ${row.canvas} is live and unbuilt at once`);
        if (!row.key) assert.ok(row.unbuilt, `${zone} · ${row.canvas} states no reason`);
      }
    }
  });

  test(`${name}: an unbuilt reason says what is missing, not that something is`, () => {
    // "Unavailable", "not supported", "coming soon" name no absent record, so a
    // reader learns nothing they could act on. Every reason here has to point at
    // the thing that does not exist. These strings no longer render anywhere —
    // they are for whoever builds the filter — which makes the bar HIGHER, not
    // lower: the only reader left is the one who has to act on it.
    const EMPTY = /\b(unavailable|not supported|unsupported|coming soon|n\/a|tbd)\b/i;
    for (const [zone, rows] of Object.entries(profile.table)) {
      for (const row of rows) {
        if (!row.unbuilt) continue;
        assert.ok(!EMPTY.test(row.unbuilt), `${zone} · ${row.canvas} says nothing: "${row.unbuilt}"`);
        assert.ok(row.unbuilt.length > 25, `${zone} · ${row.canvas} is too short to be a reason`);
        // Still a clause rather than a sentence, so the table reads as one voice.
        assert.ok(/^[a-z]/.test(row.unbuilt), `${zone} · ${row.canvas} reads as a sentence, not a clause`);
        assert.ok(!/\.$/.test(row.unbuilt), `${zone} · ${row.canvas} ends in a full stop`);
      }
    }
  });

  test(`${name}: a sample datum from the artboard is never printed as fact`, () => {
    // The pattern is per profile because the samples are. Founder's are counts
    // welded onto a real filter — `All 14`, `All 14 mo`, `Aug 2026` — which
    // `{n}` fixes. The investor Fund canvas has `Call 3`, which names one
    // specific stored record rather than carrying a count, so `{n}` is not the
    // repair and a shared `/\b(14|2026)\b/` would not even see it.
    //
    // The rule either way: a label naming a specific record becomes a `dynamic`
    // group or a relabelled positional filter ("Latest month"), never a chip
    // carrying the sample's identity.
    // The pattern must be AIMED AT SOMETHING. Mutation-checking defanged it to
    // `/__never__/` and every assertion still passed, because no label in the
    // table trips it today — every one is already correct. A pattern that
    // cannot be shown to match anything is not a guard, it is a decoration. So
    // first prove it catches the canvas's own labels, then prove none of those
    // reach the screen.
    const raw = Object.values(canvasFilters(profile)).flat();
    // A PROFILE MAY HAVE NO SAMPLES, and that is checked too rather than
    // waved through. Advisor and partner canvases carry no figure in any
    // label, so there is no pattern for them to declare — but "no pattern"
    // must not become the way a profile opts out of this test. So a profile
    // without `samples` has to prove the absence: not one of its canvas labels
    // may contain a digit. A canvas that later gains an `All 14` fails here
    // and forces that licence to declare a pattern.
    if (!profile.samples) {
      const digits = raw.filter((label) => /\d/.test(label));
      assert.deepEqual(digits, [],
        `${name} declares no sample pattern, but its canvases carry figures: ${digits.join(', ')}`);
      return;
    }
    const caught = raw.filter((label) => profile.samples.test(label));
    assert.ok(caught.length > 0,
      `${name}'s sample pattern matches none of its ${raw.length} canvas labels — it guards nothing`);

    for (const [zone, rows] of Object.entries(profile.table)) {
      for (const row of rows) {
        const shown = row.label || (Array.isArray(row.canvas) ? row.canvas[0] : row.canvas);
        assert.ok(!profile.samples.test(shown) || shown.includes('{n}'),
          `${zone} · ${row.canvas} prints the canvas's own sample datum: "${shown}"`);
      }
    }
  });

  test(`${name}: {n} is filled from the page's count, or the clause is dropped`, () => {
    // Generic over whatever this profile's table declares. `Last 6 mo` and
    // `Stale > 7d` keep their digits on purpose — a window is part of a
    // filter's definition, not a count of this account's records — so only a
    // label carrying `{n}` is checked, and what must never survive is a `{n}`
    // with nothing to fill it. A profile with no such label runs this over an
    // empty set, which is honest: the builder's own substitution is proved once
    // below, outside this loop, against the one founder zone that has one.
    for (const [zone, rows] of Object.entries(profile.table)) {
      for (const row of rows.filter((r) => String(r.label || '').includes('{n}'))) {
        const shown = (opts) => profile.build(zone, { value: row.key, ...opts }).find((i) => i.active)?.label || '';
        assert.ok(!/\d/.test(shown()), `${zone} · ${row.canvas} printed a figure with no count supplied`);
        assert.ok(!/\{n\}/.test(shown()), `${zone} · ${row.canvas} let an unfilled placeholder reach the chip`);
        assert.ok(/\b3\b/.test(shown({ counts: { [row.key]: 3 } })),
          `${zone} · ${row.canvas} ignores the count the page supplies`);
        // Rendering found this one: an empty ledger produced "All 0 months",
        // which is a broken string rather than a filter name.
        assert.ok(!/\d/.test(shown({ counts: { [row.key]: 0 } })),
          `${zone} · ${row.canvas} prints a zero count into the label`);
      }
    }
  });

  test(`${name}: a dynamic group becomes its stored names, or nothing`, () => {
    // Also generic: whatever the group is called and whatever the page stores,
    // a supplied name renders as a live chip. AN EMPTY GROUP NOW RENDERS
    // NOTHING — it used to render its reason as prose in the chip row, which is
    // the defect this pass removed. The reason stays on the table entry, where
    // the founder examples below still assert its wording.
    for (const [zone, rows] of Object.entries(profile.table)) {
      for (const row of rows.filter((r) => r.dynamic)) {
        const supplied = profile.build(zone, {
          value: '__stored__', dynamic: { [row.dynamic]: [{ key: '__stored__', label: 'A stored name' }] },
        });
        const chip = supplied.find((i) => i.label === 'A stored name');
        assert.ok(chip && chip.active,
          `${zone} · ${row.canvas} does not render a supplied name as a live chip`);
        const empty = profile.build(zone, { value: 'all' });
        assert.ok(!empty.some((i) => i.label === 'A stored name'),
          `${zone} · ${row.canvas} shows a name nothing supplied`);
        assert.ok(!empty.some((i) => i.label === (row.label || row.canvas)),
          `${zone} · ${row.canvas} draws a placeholder chip when the group is empty`);
      }
    }
  });

  test(`${name}: a filter with no source is never rendered at all`, () => {
    // STRONGER THAN THE ASSERTION IT REPLACES, which allowed the item through
    // as long as it carried no click handler — it then rendered as prose in the
    // chip row. Nothing unbuilt reaches the renderer now, so every item the
    // builder returns is a chip that runs.
    for (const [zone, rows] of Object.entries(profile.table)) {
      const built = profile.build(zone, { value: '__none__' });
      for (const item of built) {
        assert.ok(item.onSelect, `${zone} · ${item.label} is rendered but cannot be selected`);
        assert.equal(item.note, undefined, `${zone} · ${item.label} still carries prose`);
      }
      const dead = rows.filter((r) => r.unbuilt && !r.dynamic).map((r) => r.label || r.canvas);
      for (const label of dead) {
        assert.ok(!built.some((i) => i.label === label),
          `${zone} · ${label} has no source and is still drawn`);
      }
    }
  });
  /**
   * The assertion that closes the hole the rest of this file cannot see.
   *
   * Everything above takes `key: 'stalled'` at its word. Mutation-checking
   * found that turning `/grow/customers`'s dead "Stalled" filter back into a
   * live chip passed all of it — which is the precise defect this whole change
   * exists to remove. A table cannot prove its own keys do anything; only the
   * page that has to write the predicate can. So: every live key must appear in
   * the file that mounts that zone's filters, with comments stripped so a key
   * mentioned in a docblock cannot stand in for one that is used.
   *
   * A zone nobody mounts is not silently exempt — `profile.mounted` counts
   * them, and the count only ever goes up.
   */
  test(`${name}: a live filter key exists in the page that would have to implement it`, () => {
    let mounted = 0;
    for (const [zone, rows] of Object.entries(profile.table)) {
      const page = mountingFile(profile, zone);
      if (!page) continue;
      mounted += 1;
      // Two things are stripped before the search, and both were found by
      // mutation-checking rather than reasoned out.
      //
      // THE MOUNT. Without stripping it, writing
      // `founderZoneFilters('grow/customers', { value: 'stalled' })` would
      // satisfy the search for 'stalled' using nothing but the declaration
      // under test.
      //
      // THE ARGUMENTS OF `api.*` CALLS. `/deals/pipeline` loads
      // `api.listDeals(undefined, 'mine')` — a constant the page passes on
      // every load — and that alone let a DEAD `Mine` chip pass this
      // assertion, which is the exact defect it exists to catch. A literal
      // that appears only inside a request is the page asking the SERVER to
      // narrow, unconditionally; it is not a view the reader can select. A
      // genuinely server-filtered chip still passes, because the page has to
      // hold the value in state to send it — and `useState('mine')` is not
      // inside the call. `[^)]*` stops at the first `)`, so a nested call
      // leaves its tail behind: stripping too little risks a false pass, and
      // stripping too much would fail honest code.
      const code = codeOnly(page.src)
        .replace(new RegExp(`${profile.call}\\([^;]*?\\)\\s*\\}`, 'gs'), '')
        .replace(/\bapi\.\w+\([^)]*\)/g, '');
      for (const row of rows) {
        if (!row.key) continue;
      // Either form counts: a page may compare (`period === 'six'`) or look up
      // (`PERIODS[period]`, keyed `six:`). Both implement the filter; insisting
      // on one would push pages toward a shape to satisfy a test.
      //
      // This is a proxy and it is worth saying what it cannot do: it proves the
      // page KNOWS the key, not that the predicate behind it is right. What it
        // does close is the hole mutation-checking found — declaring a filter
        // live without touching the page that would have to serve it.
        const used = new RegExp(`(['"\`]${escapeRe(row.key)}['"\`]|\\b${escapeRe(row.key)}\\s*:)`);
        assert.ok(
          used.test(code),
          `${zone} declares the live filter '${row.key}' but ${page.path} never uses it`,
        );
      }
    }
    assert.equal(mounted, profile.mounted,
      `${mounted} ${name} zones mount their filters; the profile says ${profile.mounted}`);
  });

  /**
   * A narrowing a page computes must be a narrowing the page DRAWS.
   *
   * `pipeline/negotiations` shipped with `const visible = useMemo(…)` deriving
   * the chip row's four views — and then rendered its lanes from the unfiltered
   * list. All four chips were inert: pressing `Stalled 7d+` moved the pill and
   * left the board exactly as it was. The assertion above passed it, because
   * naming a key is not using one; CodeQL found it as an unused variable, which
   * is what an undrawn narrowing looks like from outside the React model.
   *
   * So the rule is written the way the defect presents: a binding assigned from
   * a memo whose body reads the page's filter state, and then referenced
   * nowhere else, is a chip row wired to nothing. One occurrence is the
   * declaration; a real narrowing has at least two.
   *
   * WHAT THIS CANNOT DO, said plainly: it proves the narrowed list reaches
   * something, not that the thing it reaches is the list the chips are about.
   * A page could still draw `visible` in one card and the unfiltered rows in
   * another. That is a narrower hole than the one this closes, and closing it
   * would need to know which element each chip governs.
   */
  test(`${name}: a page that narrows on a chip renders what it narrowed`, () => {
    for (const zone of Object.keys(profile.table)) {
      const page = mountingFile(profile, zone);
      if (!page) continue;
      const code = codeOnly(page.src);
      for (const m of code.matchAll(/const (\w+) = useMemo\(\(\) => \{([\s\S]*?)\n  \}, \[([^\]]*)\]\);/g)) {
        const [, binding, body, deps] = m;
        // A memo is a narrowing only if it reads the state a chip row sets —
        // which every zone here holds as `view`.
        if (!/\bview\b/.test(deps) && !/\bview ===/.test(body)) continue;
        const uses = (code.match(new RegExp(`\\b${escapeRe(binding)}\\b`, 'g')) || []).length;
        assert.ok(uses > 1,
          `${page.path} narrows into '${binding}' on the chip row and never renders it — `
          + `the chips on ${zone} select nothing`);
      }
    }
  });

  test(`${name}: every ZoneToolbar in this profile's pages names this licence`, () => {
    // `ZoneToolbar` defaults `role = 'founder'`, because founder was the first
    // and only caller. A mount that forgets `role="investor"` therefore paints
    // VIOLET chips on an indigo licence and nothing else catches it — the chip
    // still renders, still selects, still looks deliberate. It is the quiet
    // half of the same cross-licence leak the dispatcher assertion in
    // `profile_zone_actions` exists to prevent.
    //
    // Founder may omit the prop, since it IS the default — but it may not claim
    // a different licence, which is the same leak in the other direction and
    // keeps this assertion live rather than skipped until a second profile
    // arrives. Every other profile must say its own name outright.
    let checked = 0;
    for (const [zone] of Object.entries(profile.table)) {
      const page = mountingFile(profile, zone);
      if (!page) continue;
      // Split rather than match a bounded window: these mounts run to 528
      // characters and a capped regex silently found only twelve of eighteen,
      // which the count below caught. Each segment ends at the element's own
      // `/>` — the props are expressions, never nested JSX, so the first one
      // closes it.
      for (const segment of codeOnly(page.src).split('<ZoneToolbar').slice(1)) {
        const mount = segment.slice(0, segment.indexOf('/>'));
        checked += 1;
        const wrong = roleMountVerdict({ mount, licence: name, shared: Boolean(profile.bodies?.[zone]) });
        assert.equal(wrong, null, `${page.path}: ${wrong}`);
      }
    }
    assert.ok(checked >= profile.mounted,
      `only ${checked} ZoneToolbar mounts found across ${profile.mounted} mounting pages`);
  });

  test(`${name}: a body with a live chip passes its own state to the builder`, () => {
    /**
     * THE HOLE MUTATION-CHECKING FOUND, and it is one this file could not see.
     *
     * Everything above proves a live key is DECLARED honestly and that the page
     * knows the string. None of it proves the page ever tells the row which
     * view is showing. A body can declare four live keys and still call
     * `zoneFilters({})` — the four chips render, none is ever `active`, and
     * clicking one calls `onChange?.()` on an undefined handler. Four controls
     * that look selectable and narrow nothing, which is D51's failure reached
     * from a new direction: not a filter with no store, but a filter with no
     * wire.
     *
     * Caught by turning `zoneFilters({ value: filter, onChange: setFilter })`
     * back into `zoneFilters({})` in a founder body and watching all 47
     * assertions pass.
     *
     * What this cannot do: a body rendering SEVERAL sections calls the builder
     * once per section, and this only proves one of them is wired.
     * `InvestorNetworkWorkspace` is the only such body today, and its other two
     * sections are zones with no table at all.
     */
    for (const [zone, rows] of Object.entries(profile.table)) {
      if (!rows.some((row) => row.key)) continue;
      const page = mountingFile(profile, zone);
      if (!page) continue;
      // TWO CALL SHAPES, AND THE FIRST DRAFT OF THIS REGEX SAW ONLY ONE.
      // A prop-drilled body calls `zoneFilters({ value: … })`; a page that
      // imports its licence's table calls `founderZoneFilters('build/kpi',
      // { value: … })` with the zone key first. Written for the first shape
      // alone, this failed against two pages that were perfectly correct —
      // loudly, because it went in beside real tables rather than ahead of
      // them, which is the only reason it was not a decoration.
      assert.match(
        codeOnly(page.src),
        /[zZ]oneFilters\([^)]*value:/,
        `${zone} declares a live chip but ${page.path} never passes a value to the builder`,
      );
    }
  });

  test(`${name}: every zone that has a filter table also has an action table for the same zone`, () => {
    // The two halves of one row. A zone in one and not the other means the row
    // was half-wired, which is exactly how `/raise/status` lost "Timeline".
    const actions = read(profile.actions);
    for (const zone of Object.keys(profile.table)) {
      assert.ok(actions.includes(`'${zone}':`), `${zone} has filters but no actions`);
    }
  });
}

test('an excluded zone must be specified by a canvas and must not be declared', () => {
  // Founder excludes nothing, so the loop that enforces this never runs against
  // a real profile yet. Asserted directly for the same reason `live()` is: a
  // hook nothing exercises is a hook nobody notices breaking, and this one is
  // what keeps a deferral honest — it makes the excluded set exact, so an
  // exclusion cannot grow by accident and a stale one cannot linger.
  const canvas = { 'a/one': ['X'], 'a/two': ['Y'] };
  const check = (table, excluded) => {
    const specified = Object.keys(canvas).filter((r) => !excluded.includes(r));
    assert.deepEqual(specified.sort(), Object.keys(table).sort());
    for (const skip of excluded) {
      assert.ok(canvas[skip], `${skip} is excluded but no artboard specifies it`);
      assert.ok(!table[skip], `${skip} is both excluded and declared`);
    }
  };
  check({ 'a/one': [] }, ['a/two']);
  assert.throws(() => check({ 'a/one': [] }, []), /Expected values to be/,
    'an undeclared, unexcluded zone slipped through');
  assert.throws(() => check({ 'a/one': [], 'a/two': [] }, ['a/two']), /Expected values to be/,
    'a zone that is both excluded and declared slipped through');
  assert.throws(() => check({ 'a/one': [], 'a/two': [] }, ['a/three']), /no artboard specifies it/,
    'an exclusion naming no artboard slipped through');
});

test('a shared zone declares its body, because searching for it cannot work', () => {
  // `mountingFile` finds a page by searching for the profile's OWN builder name
  // with a literal zone key. On `/network/*` and `/research/*` the workspace
  // calls `zoneFiltersFor(role, …)` and hands the body a bound builder, so the
  // body never names the zone and the workspace never names the licence —
  // nothing to search for. The search would miss them twice over anyway: it
  // does not recurse into `pages/advisor/network/`, and partner's Network body
  // is a loose file in none of its `pages` entries.
  //
  // Asserted directly because the first table to use it has not landed yet, and
  // a hook nothing runs is a hook nobody notices breaking — the same reason
  // `live()` and `excluded` carry their own tests below and above.
  const shared = 'frontend/src/pages/research/LibraryZone.jsx';
  const found = mountingFile(
    { call: 'founderZoneFilters', pages: [], bodies: { 'research/library': shared } },
    'research/library',
  );
  assert.equal(found?.path, shared, 'a declared body is not returned');
  assert.match(found.src, /export default function LibraryZone/, 'the declared body was not read');

  // The search still works for a page that imports its own licence's table.
  const own = mountingFile(
    { call: 'founderZoneFilters', pages: ['frontend/src/pages/founder'] },
    'build/kpi',
  );
  assert.match(own?.path || '', /FounderBuildKpi\.jsx$/, 'the direct-import search stopped working');

  // And a zone that is neither declared nor findable is null, not a throw —
  // `mounted` counts what it finds, so an undeclared body must fail the count
  // rather than crash the run.
  assert.equal(mountingFile({ call: 'founderZoneFilters', pages: [] }, 'network/relationships'), null);
});

test('a shared body passes role={role}; a licence’s own page names its licence', () => {
  const V = (mount, licence, shared) => roleMountVerdict({ mount, licence, shared });

  // Shared: the variable is the only correct answer, because one file serves
  // four licences and any literal is false three times out of four.
  assert.equal(V('role={role} filters={x}', 'advisor', true), null);
  assert.match(V('role="advisor" filters={x}', 'advisor', true), /must pass role=\{role\}/);
  assert.match(V('filters={x}', 'advisor', true), /must pass role=\{role\}/,
    'an omitted prop on a shared body silently defaults to founder');

  // A licence's own page: the literal is checkable, so it is required —
  // except for founder, which IS the default and may omit it.
  assert.equal(V('role="investor" filters={x}', 'investor', false), null);
  assert.equal(V('filters={x}', 'founder', false), null);
  assert.equal(V('role="founder" filters={x}', 'founder', false), null);
  assert.match(V('filters={x}', 'investor', false), /role="undefined"/,
    'an investor page that omits the prop wears founder violet');
  assert.match(V('role="founder" filters={x}', 'investor', false), /wears founder violet/);
  assert.match(V('role="investor" filters={x}', 'founder', false), /claiming role="investor"/,
    'the leak runs both ways and both are caught');
  // The variable is NOT a way out for a single-licence page: it cannot be
  // checked there, and `role` may not even be in scope.
  assert.match(V('role={role} filters={x}', 'investor', false), /role="undefined"/);
});

test('canvasFilters maps a canvas route onto the route the router mounts', () => {
  // The hook exists for the investor Fund canvas, which says `/fund/*` where
  // the router says `/funds/*` and mounts `accounting` at the slug `ledger`.
  // Asserted directly rather than left to be exercised by the first profile
  // that needs it: a mapping nothing runs is a mapping nobody notices breaking.
  const mapped = canvasFilters({
    canvas: /^Pages · Founder Build\.dc\.html$/,
    live: (route) => `x/${route.replace(/^\//, '').replace('/', '-')}`,
  });
  assert.ok(mapped['x/build-this-week'], 'the route was not remapped');
  assert.ok(!mapped['build/this-week'], 'the unmapped route survived');
  assert.deepEqual(mapped['x/build-this-week'], ['This week', 'Last 4', 'All 14', 'Carried only'],
    'remapping changed the labels it carries');
});

test('a zone whose row can narrow hands the export the narrowed rows', () => {
  /**
   * THE HALF OF "· THIS VIEW" NOTHING WAS CHECKING.
   *
   * `zoneActionBuilder.js` labels every export `<canvas label> · this view`,
   * and `profile_zone_actions.test.mjs` asserts that label is still there. The
   * label is a claim about the FILE, and nothing proved the page kept it: a
   * body can narrow what it renders and still hand `zoneActions` the whole
   * loaded list, and the button then writes rows the reader cannot see under a
   * label promising it wrote the ones they can. Worse in the other direction
   * than the first: a reader who filters to `Blocked` and exports gets every
   * item, and nothing on screen says so.
   *
   * ONLY ZONES THAT CAN ACTUALLY NARROW ARE HELD TO THIS. `offers/catalog` and
   * `offers/visibility` each have ONE live label, so there is no second view
   * for the export to disagree with — `visibility` sorts rather than subsets,
   * and its export takes the sorted list for the tidier reason that a file
   * should come out in the order on screen.
   *
   * Written as named cases rather than derived, because the two shapes genuinely
   * differ: a zone with its own file makes the call itself, and a shared page
   * receives `zoneActions` as a render prop and calls it with its own narrowed
   * list. A regex general enough to cover both would be loose enough to pass
   * the thing this is here to catch.
   */
  const cases = [
    {
      zone: 'offers/proof',
      file: 'frontend/src/pages/partner/offers/ProofZone.jsx',
      call: /partnerZoneActions\('offers\/proof'[\s\S]*?rows: (\w+)/,
    },
    {
      zone: 'offers/audience-fit',
      file: 'frontend/src/pages/partner/offers/AudienceFitZone.jsx',
      call: /partnerZoneActions\('offers\/audience-fit'[\s\S]*?rows: (\w+)/,
    },
    {
      // The render-prop shape: `PartnerBucketRoutes` supplies the columns and
      // this page supplies the rows, so the call site here is the FIRST
      // argument — the second is the handler bag the page supplies for `New
      // perk` and `Extend`, which is why the terminator is `[,)]` rather than
      // `)`. Pinned to argument one deliberately: it is the rows that must be
      // the narrowed list, and a regex that accepted any argument would pass a
      // call that handed over `items` and narrowed something else.
      zone: 'offers/perk-deals',
      file: 'frontend/src/pages/PerksPage.jsx',
      call: /zoneActions\((\w+)[,)]/,
    },
  ];

  for (const one of cases) {
    const rows = (PARTNER_ZONE_FILTERS[one.zone] || []).filter((r) => r.key);
    assert.ok(rows.length >= 2,
      `${one.zone} no longer has two live views, so this case guards nothing — drop it or fix the table`);

    const src = codeOnly(read(one.file));
    const named = src.match(one.call);
    assert.ok(named, `${one.file} no longer hands ${one.zone} any rows`);

    // The identifier must be DERIVED from the loaded list, not be it. A
    // `const visible = items.filter(…)` passes; handing over `items` does not.
    const derived = new RegExp(`const ${named[1]} = [^;]*\\.(filter|sort)\\(`);
    assert.match(src, derived,
      `${one.file} exports "${named[1]}", which is not narrowed — the file would not match the chips on screen`);

    // And the same identifier is what the body draws, so the two cannot drift.
    assert.match(src, new RegExp(`\\b${named[1]}\\.map\\(`),
      `${one.file} narrows "${named[1]}" for the export but renders something else`);
  }
});

test('a matched canvas that yields no artboard fails the run', () => {
  // The reader's own failure mode, exercised directly because nothing else can
  // reach it: with both shapes understood, every canvas in every profile's
  // scope parses, so the assertion inside `canvasFilters` has nothing left to
  // catch and a mutation that deletes it passes the whole file. It had
  // something to catch until this commit — `Pages · Founder Validate` matched
  // founder's regex and contributed nothing — and it is what will catch the
  // next canvas in a shape this reader does not know.
  //
  // The stand-in is a file in this very directory rather than a canvas,
  // chosen because it can never drift into looking like one.
  assert.throws(() => canvasFilters({
    canvasDirs: ['frontend/test'],
    canvas: /^_codeOnly\.mjs$/,
    live: (route) => route,
  }), /yielded no artboard/);
});

test('a looped canvas pairs each board with its own chips', () => {
  // `Pages · Founder Validate` is one artboard drawn four times over a `boards`
  // array, so its routes hide in `sub:` and its chips in `views([…])`. All four
  // zones are in founder's `excluded` list, which means no table compares their
  // labels to anything — the reader could hand every route the FIRST board's
  // chips and every other assertion in this file would still pass. So the
  // pairing is asserted here, on two boards, or it is not asserted at all.
  const found = artboardFilters(read('design/canvases/integrated/Pages · Founder Validate.dc.html'));
  assert.deepEqual(Object.keys(found).sort(),
    ['/validate/hypotheses', '/validate/interviews', '/validate/pain-map', '/validate/verdict']);
  assert.deepEqual(found['/validate/interviews'], ['All', 'Deck-eligible', 'Strong fit', 'Not ICP']);
  assert.deepEqual(found['/validate/verdict'],
    ['Current', 'As of last week', 'Changed this month', 'Retired claims']);
});

/**
 * The file that mounts a zone's filters, searched across this profile's own
 * bodies. `pages` entries may be a directory or a single file: most licences
 * keep their zone bodies in one folder, but a few live loose in
 * `frontend/src/pages` beside a hundred unrelated ones, and naming those
 * outright beats scanning the folder.
 */
function mountingFile(profile, zone) {
  // A SHARED SURFACE IS FOUND BY MAP, NOT BY SEARCH, and it has to be.
  //
  // The needle below is the profile's OWN builder name with a literal zone key
  // — `founderZoneFilters('build/kpi'`. That works for a page that imports its
  // licence's table directly, which is every zone in Build, Raise, Grow, Fund,
  // Portfolio and Deals. It cannot work for `/network/*` and `/research/*`:
  // there the workspace calls `zoneFiltersFor(role, 'research/markets', …)` and
  // hands the BODY a bound builder, so the body never names the zone and the
  // workspace never names the licence. Two further reasons the search would
  // miss them anyway: advisor's Network zones live in `pages/advisor/network/`,
  // and partner's is the loose file `pages/NetworkPage.jsx`, in none of its
  // `pages` entries.
  //
  // IT USED TO SEARCH ONE LEVEL DEEP, AND THAT WAS A SILENT EXEMPTION. Canvas
  // ID1's body landed at `pages/investor/deals/PipelineZone.jsx` — one folder
  // below the profile's `pages` entry — and the zone dropped straight out of
  // `mounted`: the count fell to 15 against a profile that says 16, and every
  // assertion about that zone's chips stopped running rather than failing.
  // `bodies` was the wrong place to fix it, because an entry there means
  // SHARED ACROSS LICENCES and is what `roleMountVerdict` keys off to demand
  // `role={role}`; a single-licence body one folder down is not that. The walk
  // recurses now, which is what it should always have done.
  //
  // So a shared zone declares its body outright. Written down rather than
  // fuzzy-matched, for the same reason `live()` is — a body that moves fails
  // here loudly instead of silently dropping out of `mounted`.
  const declared = profile.bodies?.[zone];
  if (declared) return { path: declared, src: read(declared) };
  const needle = `${profile.call}('${zone}'`;
  const walk = (entry) => {
    const full = resolve(root, entry);
    if (!statSync(full).isDirectory()) return /\.jsx?$/.test(entry) ? [entry] : [];
    return readdirSync(full).flatMap((f) => walk(`${entry}/${f}`));
  };
  for (const entry of profile.pages) {
    for (const rel of walk(entry)) {
      const src = read(rel);
      if (src.includes(needle)) return { path: rel, src };
    }
  }
  return null;
}

/**
 * The builder's own behaviour, against the founder zones that exercise it.
 *
 * These used to run inside the per-profile loop, which meant every profile was
 * asked to answer for `build/kpi` and `grow/talent`. The investor table has
 * neither, so the loop failed on the second licence for the entirely wrong
 * reason: not that its filters were wrong, but that they were not founder's.
 * The generic halves stayed in the loop — a `{n}` label substitutes or drops,
 * a dynamic group chips or explains, whatever the profile calls them. What is
 * left here is what only these specific zones can say.
 */
test('{n} substitutes the page count, drops when there is none, and drops a zero', () => {
  const items = founderZoneFilters('build/kpi', { value: 'all', counts: { all: 3 } });
  assert.ok(items.some((i) => i.label === 'All 3 months'), 'the page count is not substituted');
  const blind = founderZoneFilters('build/kpi', { value: 'all' });
  assert.ok(blind.some((i) => i.label === 'All months'), 'a missing count invents a figure');
  const empty = founderZoneFilters('build/kpi', { value: 'all', counts: { all: 0 } });
  assert.ok(empty.some((i) => i.label === 'All months'), 'a zero count is printed into the label');
});

test('a dynamic group renders its stored names and nothing else', () => {
  // `/grow/customers` is where the difference used to bite. The canvas names
  // three market SEGMENTS; a customer record stores the SOURCE it was captured
  // from. The old build appended a standing sentence beside the source chips
  // saying so — `noteAlways` — which is exactly the prose this pass removed
  // from the chip row, and it did it on a row whose chips all worked.
  //
  // WHAT REPLACES IT, AND WHY THIS IS NOT A WEAKENING. The clarification was
  // never load-bearing for correctness: the chips are labelled with the stored
  // source names themselves — `Waitlist`, `Referral` — so nothing on screen
  // claims to be a segment. The entry keeps its reason in the table, asserted
  // below, so the distinction is still recorded for whoever wires segments up.
  const bySource = founderZoneFilters('grow/customers', {
    value: 'referral',
    dynamic: { sources: [{ key: 'waitlist', label: 'Waitlist' }, { key: 'referral', label: 'Referral' }] },
  });
  assert.deepEqual(bySource.map((i) => i.label), ['All', 'Waitlist', 'Referral']);
  assert.ok(bySource.find((i) => i.label === 'Referral').active, 'the supplied source cannot be selected');
  assert.ok(bySource.every((i) => !i.note), 'a sentence is back in the chip row');

  // The reason survives on the table entry, and still says the same thing.
  const row = FOUNDER_ZONE_FILTERS['grow/customers'].find((r) => r.dynamic === 'sources');
  assert.match(row.unbuilt, /no market segment is stored/,
    'the segment/source difference stopped being recorded');

  // An unsupplied dynamic group renders nothing at all rather than a stand-in.
  const talent = founderZoneFilters('grow/talent', { value: 'all' });
  assert.ok(!talent.some((i) => i.label === 'One chip per role'),
    'an empty dynamic group still draws a placeholder');
  const talentRow = FOUNDER_ZONE_FILTERS['grow/talent'].find((r) => r.dynamic);
  assert.match(talentRow.unbuilt, /no job post is linked/, 'the fallback reason stopped being recorded');
});

test('filters sharing one reason are recorded once and rendered never', () => {
  // /build/cadence has four filters and one reason. That reason used to be
  // collected into a sentence naming all four and printed under the chips;
  // /build/this-week's two distinct reasons became two sentences. Both are now
  // absent from the row entirely — a zone whose filters cannot run shows the
  // ones that can, and nothing else.
  const cadence = founderZoneFilters('build/cadence', { value: 'x' });
  assert.deepEqual(cadence, [], 'a zone with no runnable filter still renders something');

  const week = founderZoneFilters('build/this-week', { value: 'now' });
  assert.ok(week.every((i) => i.onSelect && !i.note), 'this-week renders prose in the chip row');
  for (const label of ['Last 4', 'All weeks', 'Carried only']) {
    assert.ok(!week.some((i) => i.label === label), `${label} has no source and is still drawn`);
  }

  // The reasons themselves stay in the table, distinct where they were distinct.
  const reasons = new Set(FOUNDER_ZONE_FILTERS['build/this-week']
    .filter((r) => r.unbuilt).map((r) => r.unbuilt));
  assert.equal(reasons.size, 2, 'this-week\'s two distinct reasons were merged into one');
  assert.equal(new Set(FOUNDER_ZONE_FILTERS['build/cadence']
    .filter((r) => r.unbuilt).map((r) => r.unbuilt)).size, 1,
    'cadence\'s one reason was split into several');
});


