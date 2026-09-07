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
import { FOUNDER_ZONE_FILTERS, founderZoneFilters } from '../src/workspaces/founderZoneFilters.js';
import { INVESTOR_ZONE_FILTERS, investorZoneFilters } from '../src/workspaces/investorZoneFilters.js';
import { ADVISOR_ZONE_FILTERS, advisorZoneFilters } from '../src/workspaces/advisorZoneFilters.js';
import { PARTNER_ZONE_FILTERS, partnerZoneFilters } from '../src/workspaces/partnerZoneFilters.js';
import { canvasFilterLabels, groupFilterNotes } from '../src/workspaces/zoneFilterBuilder.js';

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
  },
};

const RESEARCH_BODIES = {
  'research/ask': 'frontend/src/pages/research/AskZone.jsx',
  'research/library': 'frontend/src/pages/research/LibraryZone.jsx',
  'research/markets': 'frontend/src/pages/SignalsPage.jsx',
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
    pages: ['frontend/src/pages/founder', 'frontend/src/workspaces'],
    actions: 'frontend/src/workspaces/founderZoneActions.js',
    zones: 26,
    mounted: 26,
    bodies: { ...RESEARCH_BODIES, ...NETWORK_BODIES.founder },
    // EMPTY, AND THAT IS THE POINT OF THE LIST. Every canvas route on all five
    // founder artboards now has a filter table. `research/{ask,library}` left
    // when all four licences gained them in one commit; `network/organizations`
    // left when the two licences that HAVE a body for it gained it — advisor
    // and partner keep it excluded for a reason that is theirs and is stated in
    // their own profiles, not because founder is waiting on them.
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
    canvasDirs: ['design/incoming'],
    canvas: /^Pages · Partner (Network|Research)\.dc\.html$/,
    pages: ['frontend/src/pages/partner', 'frontend/src/pages/research', 'frontend/src/workspaces'],
    actions: 'frontend/src/workspaces/partnerZoneActions.js',
    zones: 6,
    mounted: 6,
    bodies: { ...RESEARCH_BODIES, ...NETWORK_BODIES.partner },
    // Same as advisor's, one step further: there is not even a card. This
    // licence has no organizations panel at all — `NetworkPage`'s
    // `unservedAlone` suppresses it — so a row here would attach to nothing.
    excluded: [
      'network/organizations',
    ],
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
      for (const chunk of src.split(/route:\s*'/).slice(1)) {
        const route = chunk.slice(0, chunk.indexOf("'"));
        const filters = chunk.match(/filters:\s*fil\(\[([^\]]*)\]/);
        if (!filters) continue;
        out[profile.live(route)] = filters[1]
          .split(',')
          .map((one) => one.trim().replace(/^'|'$/g, ''))
          .filter(Boolean);
      }
    }
  }
  return out;
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

  test(`${name}: an entry is a live key, a stated reason, or a dynamic group — never two`, () => {
    for (const [zone, rows] of Object.entries(profile.table)) {
      for (const row of rows) {
        const kinds = [row.key ? 'key' : null, row.dynamic ? 'dynamic' : null,
          !row.key && !row.dynamic && row.note ? 'note' : null].filter(Boolean);
        assert.equal(kinds.length, 1, `${zone} · ${row.canvas} is ${kinds.length} things at once`);
        if (row.key) assert.ok(!row.note, `${zone} · ${row.canvas} is live and would never show its note`);
        if (!row.key) assert.ok(row.note, `${zone} · ${row.canvas} states no reason`);
      }
    }
  });

  test(`${name}: a stated reason says what is missing, not that something is`, () => {
    // "Unavailable", "not supported", "coming soon" name no absent record, so a
    // reader learns nothing they could act on. Every note here has to point at
    // the thing that does not exist.
    const EMPTY = /\b(unavailable|not supported|unsupported|coming soon|n\/a|tbd)\b/i;
    for (const [zone, rows] of Object.entries(profile.table)) {
      for (const row of rows) {
        if (!row.note) continue;
        assert.ok(!EMPTY.test(row.note), `${zone} · ${row.canvas} says nothing: "${row.note}"`);
        assert.ok(row.note.length > 25, `${zone} · ${row.canvas} is too short to be a reason`);
        // It renders after an em dash, so it is a clause and not a sentence.
        assert.ok(/^[a-z]/.test(row.note), `${zone} · ${row.canvas} reads as a sentence, not a clause`);
        assert.ok(!/\.$/.test(row.note), `${zone} · ${row.canvas} ends in a full stop`);
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

  test(`${name}: a dynamic group becomes its stored names, or its reason`, () => {
    // Also generic: whatever the group is called and whatever the page stores,
    // a supplied name renders as a live chip and an empty group states its
    // reason instead of drawing nothing. The founder examples below carry the
    // two subtleties this cannot express — a fallback note versus a standing
    // clarification — because both live in the wording of specific zones.
    for (const [zone, rows] of Object.entries(profile.table)) {
      for (const row of rows.filter((r) => r.dynamic)) {
        const supplied = profile.build(zone, {
          value: '__stored__', dynamic: { [row.dynamic]: [{ key: '__stored__', label: 'A stored name' }] },
        });
        const chip = supplied.find((i) => i.label === 'A stored name');
        assert.ok(chip && !chip.note && chip.active,
          `${zone} · ${row.canvas} does not render a supplied name as a live chip`);
        const empty = profile.build(zone, { value: 'all' });
        assert.ok(!empty.some((i) => i.label === 'A stored name'),
          `${zone} · ${row.canvas} shows a name nothing supplied`);
        assert.ok(empty.some((i) => i.note === row.note),
          `${zone} · ${row.canvas} draws nothing and explains nothing when the group is empty`);
      }
    }
  });

  test(`${name}: a filter with no source is never selectable`, () => {
    for (const zone of Object.keys(profile.table)) {
      for (const item of profile.build(zone, { value: '__none__' })) {
        if (!item.note) continue;
        assert.equal(item.onSelect, undefined, `${zone} · ${item.label} is prose with a click handler`);
        assert.equal(item.active, undefined, `${zone} · ${item.label} is prose that can look selected`);
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
        const used = new RegExp(`(['"\`]${row.key}['"\`]|\\b${row.key}\\s*:)`);
        assert.ok(
          used.test(code),
          `${zone} declares the live filter '${row.key}' but ${page.path} never uses it`,
        );
      }
    }
    assert.equal(mounted, profile.mounted,
      `${mounted} ${name} zones mount their filters; the profile says ${profile.mounted}`);
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
  // miss them anyway: it does not recurse, and advisor's Network zones live in
  // `pages/advisor/network/`; and partner's is the loose file
  // `pages/NetworkPage.jsx`, in none of its `pages` entries.
  //
  // So a shared zone declares its body outright. Written down rather than
  // fuzzy-matched, for the same reason `live()` is — a body that moves fails
  // here loudly instead of silently dropping out of `mounted`.
  const declared = profile.bodies?.[zone];
  if (declared) return { path: declared, src: read(declared) };
  const needle = `${profile.call}('${zone}'`;
  for (const entry of profile.pages) {
    const full = resolve(root, entry);
    const files = statSync(full).isDirectory()
      ? readdirSync(full).filter((f) => /\.jsx?$/.test(f)).map((f) => `${entry}/${f}`)
      : [entry];
    for (const rel of files) {
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

test('a dynamic note is a fallback in one zone and a standing clarification in the other', () => {
  // `/grow/customers` is where the difference bites. The canvas names three
  // market SEGMENTS; a customer record stores the SOURCE it was captured from.
  // The chips are the stored sources, and the sentence saying those are not the
  // same thing is needed most precisely when the chips ARE there to be misread.
  const bySource = founderZoneFilters('grow/customers', {
    value: 'referral',
    dynamic: { sources: [{ key: 'waitlist', label: 'Waitlist' }, { key: 'referral', label: 'Referral' }] },
  });
  assert.deepEqual(bySource.filter((i) => !i.note).map((i) => i.label), ['All', 'Waitlist', 'Referral']);
  assert.ok(bySource.find((i) => i.label === 'Referral').active, 'the supplied source cannot be selected');
  assert.ok(bySource.some((i) => i.note && /no market segment is stored/.test(i.note)),
    'the segment/source difference stopped being stated');
  // And it renders as a bare sentence, not "One chip per segment — …", since
  // with chips present there is no dead filter left to name.
  const standing = groupFilterNotes(bySource).find((g) => /no market segment/.test(g.note));
  assert.deepEqual(standing.labels, [], 'the standing note still names a filter that is not missing');
  // A fallback note keeps its label, because there the label IS the missing thing.
  const fallback = groupFilterNotes(founderZoneFilters('grow/talent', { value: 'all' }))
    .find((g) => /no job post is linked/.test(g.note));
  assert.deepEqual(fallback.labels, ['One chip per role']);
});

test('filters sharing one reason collapse into one sentence that names them all', () => {
  // /build/cadence has four filters and one reason. Saying it four times is
  // noise; saying it once and naming three of the four is a lie by omission.
  const items = founderZoneFilters('build/cadence', { value: 'x' });
  const grouped = groupFilterNotes(items);
  assert.equal(grouped.length, 1, 'one reason produced more than one sentence');
  assert.deepEqual(grouped[0].labels, ['All rituals', 'Plans', 'Retros', 'Skipped']);
  // /build/this-week has two distinct reasons across three dead filters.
  const week = groupFilterNotes(founderZoneFilters('build/this-week', { value: 'now' }));
  assert.equal(week.length, 2, 'two distinct reasons were merged into one');
  assert.deepEqual(week[0].labels, ['Last 4', 'All weeks']);
  assert.deepEqual(week[1].labels, ['Carried only']);
});


