/**
 * Task #103 — the Help Center, and the addresses that reach it.
 *
 * The report behind this task was "/help does not match the Help Center
 * design". It did not, and could not: `/help` was a GitHub-Issues ticket
 * tracker that rendered `<h1>Help Center</h1>` because D39 renamed a menu
 * label, while the corpus the design describes lived at `/docs` under a
 * different name. The design and the address had never met.
 *
 * So most of this file guards ADDRESSES. A surface can be rebuilt and still be
 * unreachable; five separate live defects in this area were all of one shape —
 * something built a URL that no route declared, or a route that no page read:
 *
 *   1. `/support?topic=…` — built by ErrorState from four pages' failure
 *      paths, declared by nothing. Every "contact support" button 404'd.
 *   2. `/docs/<section>/<sub>` — built by the advisor's exploreDocs tool. The
 *      anchor is a hash, not a path segment, so every "Read <topic>" CTA 404'd.
 *   3. `/help/<id>` — declared by D39 and emitted by `tickets.ts` into Slack,
 *      but `TicketsPage` never read a param, so it silently showed the list.
 *   4. `link: '/help'` on three ticket_update notifications — the list again,
 *      for a notification that names one ticket.
 *   5. `DocsLayout`'s "Open a ticket from the Tickets page in the sidebar" —
 *      naming a sidebar item that D39 had already renamed to "Help Center".
 *
 * None of those is visible from a screenshot, and each survived because
 * nothing asserted that the two ends agreed. That is what the address tests
 * below do, and why several of them read BOTH files rather than one.
 *
 * The rest guards the composition: the canvas elements that are here, and the
 * four that are deliberately not — each blocked on a store that does not exist
 * (view counts, article feedback, per-article surface routes, persona arrays).
 * Modelled on `trust_center_contract.test.mjs`, which parses source rather
 * than importing components, for the same reason: these are claims about what
 * the file says, and a claim about rendered output would need a DOM.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { SECTIONS, filterSectionsForRole, adminOnlyAnchors } from '../src/pages/docs/sections/index.js';
import { createDocsFuse } from '../src/lib/docs/search.js';
import {
  canUseCustomerChat,
  CHAT_FOUNDER_TIERS,
  CHAT_INVESTOR_TIERS,
  CHAT_BYPASS_ROLES,
} from '../src/lib/customerChat.js';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

/**
 * `codeOnly` strips the two comment shapes a string literal cannot produce; it
 * deliberately leaves JSX comments alone. Three assertions in this file failed
 * against correct code because the comment EXPLAINING an absence contained the
 * absent phrase — the same trap `_codeOnly.mjs` documents. `{/* … *\/}` is a
 * closed, unambiguous form that renders nothing, so removing it as well is
 * safe here, and it is what lets the bans below stay strict enough to be worth
 * having. Non-greedy, so a stray marker cannot swallow the rest of the file.
 */
const stripJsxComments = (s) => String(s).replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
const rendered = (p) => stripJsxComments(codeOnly(read(p)));

/**
 * The body of one top-level function, and nothing after it.
 *
 * A fixed-width window is the trap: these redirect components are four lines
 * each and sit next to each other, so `slice(i, i + 400)` from one reaches
 * well into the next. That is not hypothetical — the mutation that made
 * `TicketsRedirect` drop the ticket id passed, because the window had already
 * run on into `HelpTicketIdRedirect`, which still carried the pattern the
 * assertion was looking for. A test that reads its neighbour's code proves
 * nothing about its subject.
 *
 * Ends at the first `}` in column 0, which is where a top-level function
 * closes in this file. Throws rather than returning an empty string, so a
 * renamed function fails loudly instead of vacuously passing.
 */
function fnBody(src, name) {
  const start = src.indexOf(`function ${name}`);
  assert.ok(start > 0, `${name} must exist`);
  const end = src.indexOf('\n}', start);
  assert.ok(end > start, `${name} must close`);
  const body = src.slice(start, end);
  assert.ok(
    !/\nfunction /.test(body),
    `the slice for ${name} ran into the next function — it would read its code`,
  );
  return body;
}

const APP = read('frontend/src/App.jsx');
const APP_CODE = codeOnly(APP);
const LAYOUT = read('frontend/src/pages/docs/DocsLayout.jsx');
const LAYOUT_CODE = rendered('frontend/src/pages/docs/DocsLayout.jsx');
const TICKETS = rendered('frontend/src/pages/TicketsPage.jsx');
const CHAT_WORKER = read('cloudflare-worker/src/routes/customer_chat.ts');

// ---------------------------------------------------------------------------
// The addresses
// ---------------------------------------------------------------------------

test('/help is the Help Center and the ticket flow sits under it', () => {
  assert.match(
    APP_CODE,
    /path="\/help" element=\{guard\([^)]*<HelpCenterPage \/>\)\}/,
    '/help must mount the Help Center, not the ticket tracker',
  );
  assert.match(
    APP_CODE,
    /path="\/help\/tickets" element=\{guard\([^)]*<TicketsPage \/>\)\}/,
    'the ticket list must be reachable at /help/tickets',
  );
  assert.match(
    APP_CODE,
    /path="\/help\/tickets\/:id" element=\{guard\([^)]*<TicketsPage \/>\)\}/,
    'a single ticket must be addressable',
  );
  // The old pairing must be gone, or the Help Center never renders.
  assert.ok(
    !/path="\/help" element=\{guard\([^)]*<TicketsPage \/>\)\}/.test(APP_CODE),
    '/help still mounts TicketsPage',
  );
});

test('every legacy address still resolves, and none of them to a 404', () => {
  // `/tickets` and `/tickets/<id>` are in notification rows already sent;
  // `/help/<id>` is in Slack messages already posted; `/docs` and
  // `/docs#anchor` are bookmarked and linked from the worker. All permanent.
  for (const path of ['/tickets', '/tickets/:id', '/help/:id', '/docs', '/docs/admin/*', '/support']) {
    assert.ok(
      APP_CODE.includes(`path="${path}"`),
      `${path} has no route — it falls through to the catch-all 404`,
    );
  }
});

test('the /docs redirect carries the hash, because the hash IS the article', () => {
  // Eight deep links across six components address an article as
  // `#<section>/<subsection>`. A redirect that drops the hash turns every one
  // of them into "somewhere on the help page".
  const body = fnBody(APP_CODE, 'DocsRedirect');
  assert.match(body, /hash: loc\.hash/, 'the hash must survive the redirect');
  assert.match(body, /search: loc\.search/, 'the query must survive the redirect');
});

test('the two ticket redirects land on the ticket, not the list', () => {
  for (const fn of ['TicketsRedirect', 'HelpTicketIdRedirect']) {
    assert.match(
      fnBody(APP_CODE, fn),
      /pathname: `\/help\/tickets\/\$\{id\}`/,
      `${fn} must carry the id through`,
    );
  }
});

test('the ticket page reads the id in the URL', () => {
  // It did not, for the whole life of the /help/:id route: `selectedTicketId`
  // started at null and only a click could set it, so every notification CTA
  // opened the list and asked the reader to find their own ticket.
  assert.match(TICKETS, /useParams\(\)/, 'the page must read the route param');
  assert.match(
    TICKETS,
    /useState\(routeTicketId \|\| null\)/,
    'the initial selection must come from the URL',
  );
  assert.match(
    TICKETS,
    /setSelectedTicketId\(routeTicketId \|\| null\)/,
    'arriving at a ticket while already mounted must open it too',
  );
});

test('the worker links to the ticket its notification names', () => {
  // Three notifications and one Slack CTA. Each one names a single ticket in
  // its title, so each one has to open that ticket.
  const tickets = read('cloudflare-worker/src/routes/tickets.ts');
  const github = read('cloudflare-worker/src/routes/github.ts');
  assert.match(tickets, /path: `\/help\/tickets\/\$\{ticket\.id\}`/);
  assert.match(tickets, /link: `\/help\/tickets\/\$\{fresh\.id\}`/);
  const ghLinks = github.match(/link: `\/help\/tickets\/\$\{ticket\.id\}`/g) || [];
  assert.equal(ghLinks.length, 2, 'both github.ts ticket notifications must deep-link');
  for (const src of [tickets, github]) {
    assert.ok(
      !/link: '\/help'/.test(src),
      'a ticket notification must not land on the Help Center home',
    );
  }
});

test("the advisor's docs CTA builds an anchor, not a path segment", () => {
  // `/docs/<section>/<sub>` matched no route: only `/docs` and
  // `/docs/admin/*` were ever declared, so this CTA has been a 404.
  const tools = read('cloudflare-worker/src/services/advisor/tools.ts');
  assert.match(tools, /const route = anchor \? `\/help#\$\{anchor\}` : '\/help'/);
  assert.ok(
    !/`\/docs\/\$\{anchor\}`/.test(tools),
    'the anchor must not be pasted on as a path segment',
  );
  // The allowlist gates the route before it is offered; without /help the CTA
  // is built and then refused.
  assert.match(tools, /'\/help': 'Help Center'/);
});

test('the support deep link carries its topic into the search box', () => {
  const body = fnBody(APP_CODE, 'SupportRedirect');
  assert.match(body, /get\('topic'\)/, 'the topic must be read');
  assert.match(body, /\?q=\$\{encodeURIComponent\(topic\)\}/, 'and passed on as the query');
  // The other end: the page has to actually read it, or the topic is dropped
  // one hop later and the test above proves nothing.
  assert.match(
    LAYOUT_CODE,
    /new URLSearchParams\(location\.search\)\.get\('q'\)/,
    'the Help Center must seed its search from ?q=',
  );
  // And the builder still builds it.
  assert.match(read('frontend/src/components/ErrorState.jsx'), /\/support\?topic=/);
});

test('nothing deep-links through the redirect any more', () => {
  // `/docs#anchor` still works — that is what the redirect is for — but a
  // live link should address the page directly rather than take a hop.
  const files = [
    'frontend/src/components/EmptyState.jsx',
    'frontend/src/components/CommandPalette.jsx',
    'frontend/src/components/PageExplainer.jsx',
    'frontend/src/components/advisor/PersonalAdvisor.jsx',
    'frontend/src/components/advisor/AdvisorProgressWidget.jsx',
    'frontend/src/pages/ProjectsPage.jsx',
  ];
  for (const f of files) {
    assert.ok(!read(f).includes('/docs#'), `${f} still deep-links at the old address`);
  }
});

test('the ticket flow stays open to an investor waiting on KYC', () => {
  // The exact-match allow list let `/help` (then the ticket list) through but
  // not `/help/<id>` (then a ticket) — so the one channel that could unblock
  // someone bounced them to /kyc. Both live under /help now.
  assert.match(
    APP_CODE,
    /location\.pathname === '\/help' \|\| location\.pathname\.startsWith\('\/help\/'\)/,
    'the KYC gate must allow the whole /help subtree',
  );
  assert.match(APP_CODE, /!onHelpPath &&/, 'and the gate must actually consult it');
});

test('two pages do not both claim to be the Help Center', () => {
  assert.ok(
    !/<h1[^>]*>Help Center<\/h1>/.test(TICKETS),
    'the ticket page must not render the Help Center heading',
  );
  assert.match(LAYOUT_CODE, /<h1[^>]*>How can we help\?<\/h1>/);
});

// ---------------------------------------------------------------------------
// The composition
// ---------------------------------------------------------------------------

test('the category grid is built from the manifest, not a hand-kept list', () => {
  // A literal list of categories is a second copy of the manifest that drifts
  // the first time a section file is added — and would show admin sections to
  // everyone, since the filtering happens on `visibleSections`.
  assert.match(LAYOUT_CODE, /<BrowseByTask sections=\{visibleSections\}/);
  const body = fnBody(LAYOUT_CODE, 'BrowseByTask');
  assert.match(body, /sections\.map\(\(section\)/, 'the cards must come from the manifest');
  assert.match(
    body,
    /section\.subsections\.length/,
    "the card's count must be the manifest's count",
  );
  // Every real section title must be reachable through it — the sanity check
  // that `visibleSections` is the same manifest this test imported.
  const visible = filterSectionsForRole(SECTIONS, 'founder');
  assert.ok(visible.length >= 10, `expected the full corpus, got ${visible.length} sections`);
});

test('every suggested search actually finds something', () => {
  // A chip that returns nothing is a dead end dressed as a suggestion, and a
  // copy edit three files away is all it takes to make one. Run each through
  // the real index rather than trusting the label.
  const m = LAYOUT.match(/const SUGGESTED_SEARCHES = \[([^\]]+)\]/);
  assert.ok(m, 'SUGGESTED_SEARCHES must exist and be a literal array');
  const chips = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.ok(chips.length >= 3, `expected several suggestions, got ${chips.length}`);
  const fuse = createDocsFuse('founder');
  for (const chip of chips) {
    const hits = fuse.search(chip, { limit: 5 });
    assert.ok(hits.length > 0, `the suggested search “${chip}” returns no article`);
  }
});

test('the corpus stays mounted while a search is open', () => {
  // Deep links arrive with the hash AND, from /support, a `?q=`. Unmounting
  // the sections on search would make `scrollContentTo` fail on exactly those
  // arrivals — the anchors would not be in the DOM to scroll to.
  assert.match(
    LAYOUT_CODE,
    /<div className=\{trimmedQuery \? 'hidden' : ''\}>/,
    'the sections must be hidden, not unmounted, during a search',
  );
});

test('the contact block points at the flow, not at a menu item', () => {
  const body = fnBody(LAYOUT_CODE, 'StillStuck');
  assert.match(body, /to="\/help\/tickets"/, 'the ticket link must be a link');
  assert.ok(
    !/in the sidebar/.test(body),
    'naming a sidebar item is how this went stale the first time',
  );
  assert.match(body, /mailto:support@axal\.vc/);
  assert.match(body, /to="\/status"/);
});

// ---------------------------------------------------------------------------
// The four canvas elements that are deliberately absent
// ---------------------------------------------------------------------------

test('no canvas element ships on top of a store that does not exist', () => {
  // Each of these is refused for a stated reason, recorded in ROUTE_MAP and in
  // the block comment above the hero. Reinstating one is a decision someone
  // takes on purpose — which means editing this test, on purpose.
  const banned = [
    // Ranks articles by view count. Nothing counts views, so any ranking here
    // is a claim about other readers invented on the spot.
    [/Popular this week/i, '"Popular this week" needs a view-count store'],
    // Needs somewhere to put the answer. There is no feedback table.
    [/Did this answer it/i, '"Did this answer it?" needs a feedback store'],
    // Needs a `surface` route on ~98 subsections. A wrong deep link is worse
    // than no deep link.
    [/Where this lives/i, '"Where this lives" needs a per-article surface route'],
    [/Open the surface/i, '"Open the surface" needs a per-article surface route'],
    // Reads a `roles` array. Not one section in the manifest has one.
    [/Applies to/i, '"Applies to" needs per-article persona arrays'],
  ];
  for (const [re, why] of banned) {
    assert.ok(!re.test(LAYOUT_CODE), `${why} — it must not render`);
  }
});

test('the persona line is refused for a reason that is still true', () => {
  // "Applies to <persona>" would read `roles` off each subsection. This
  // assertion used to require that NO section carried one, and it fired the
  // moment `sections/admin.js` was re-registered (DECISIONS D61) — which is
  // exactly what it was written to do: "if a section ever grows one, this fails
  // and the refusal gets revisited rather than quietly outliving its reason".
  //
  // REVISITED, AND THE REFUSAL STANDS, for a reason that survived the change.
  // The only `roles` array in the corpus is `['admin']`, and admin content is
  // already invisible to every viewer it would exclude — so the line would read
  // "Everyone" on all 98 articles a non-admin can see, and "Everyone" on 98 of
  // the 99 an admin can. A persona label that is a constant everywhere it is
  // read labels nothing.
  //
  // What the guard now watches for is a roles array that would actually
  // DISCRIMINATE between viewers who share the corpus — `['founder']`,
  // `['investor', 'partner']`. That is the day the line starts carrying
  // information, and the day this fails again.
  const tags = [];
  for (const s of SECTIONS) {
    if (Array.isArray(s.roles)) tags.push([s.id, s.roles]);
    for (const sub of s.subsections) {
      if (Array.isArray(sub.roles)) tags.push([`${s.id}/${sub.id}`, sub.roles]);
    }
  }
  const discriminating = tags.filter(([, roles]) =>
    !(roles.length === 1 && roles[0] === 'admin'));
  assert.deepEqual(
    discriminating.map(([id, roles]) => `${id}: [${roles.join(', ')}]`), [],
    'a roles array now distinguishes between viewers who share the corpus — revisit the persona line',
  );
  // And the admin tagging is still there to be excluded by: if it vanished, the
  // refusal above would be resting on a fact nobody had checked.
  assert.ok(tags.length > 0, 'the admin roles tagging is what the reasoning above rests on');
});

// ---------------------------------------------------------------------------
// The customer-chat gate — two copies, pinned together
// ---------------------------------------------------------------------------

test('the client gate and the worker gate name the same tiers', () => {
  // `CustomerChatWidget` shipped fully built and mounted nowhere because its
  // docblock delegated the tier check to a panel that was never written. The
  // panel exists now, and this is what keeps its copy of the rule honest.
  const founder = CHAT_WORKER.match(/ALLOWED_FOUNDER_TIERS = new Set\(\[([^\]]*)\]\)/);
  const investor = CHAT_WORKER.match(/ALLOWED_INVESTOR_TIERS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(founder && investor, 'the worker must still declare both tier sets');
  const parse = (m) => m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.deepEqual(CHAT_FOUNDER_TIERS, parse(founder));
  assert.deepEqual(CHAT_INVESTOR_TIERS, parse(investor));

  // The bypass roles are not a set in the worker — they are early returns
  // above the tier checks, one of them combining two roles in a single `if`.
  // So read the region rather than a fixed line shape: everything in
  // `isEligible` before the investor branch is the part that answers `true`
  // without consulting a tier. Both directions matter — a role added there
  // and not here would open the panel to someone the client hides it from,
  // and a role removed there would offer a channel that then 402s.
  const start = CHAT_WORKER.indexOf('function isEligible');
  assert.ok(start > 0, 'the worker must still declare isEligible');
  const investorBranch = CHAT_WORKER.indexOf("if (role === 'investor')", start);
  assert.ok(investorBranch > start, 'the investor branch must still follow the bypasses');
  const bypassRegion = CHAT_WORKER.slice(start, investorBranch);
  assert.match(bypassRegion, /return true/, 'the slice must contain the bypasses it brackets');
  const bypassed = [...bypassRegion.matchAll(/role === '([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    [...bypassed].sort(), [...CHAT_BYPASS_ROLES].sort(),
    'the worker and the client disagree about which roles skip the tier check',
  );
});

test('the gate answers the same way on both sides of the paywall', () => {
  assert.equal(canUseCustomerChat(null), false);
  assert.equal(canUseCustomerChat({ role: 'founder', subscription_tier: 'free' }), false);
  assert.equal(canUseCustomerChat({ role: 'founder', subscription_tier: 'growth' }), false);
  assert.equal(canUseCustomerChat({ role: 'founder', subscription_tier: 'studio' }), true);
  // The investor case is the one that needed a worker change to be answerable
  // at all: `investor_tier` was not in the /auth/me payload, so every investor
  // read as free — including the one tier that qualifies.
  assert.equal(canUseCustomerChat({ role: 'investor' }), false);
  assert.equal(canUseCustomerChat({ role: 'investor', investor_tier: 'institutional' }), true);
  for (const role of CHAT_BYPASS_ROLES) {
    assert.equal(canUseCustomerChat({ role }), true, `${role} must bypass the tier check`);
  }
});

test('the client can see the tier field its gate reads', () => {
  const auth = read('cloudflare-worker/src/routes/auth.ts');
  assert.match(
    auth,
    /investor_tier: \(user as any\)\.investor_tier \|\| 'free',/,
    '/auth/me must return investor_tier, or the gate cannot see an institutional investor',
  );
});

test('the chat panel is offered only to viewers the worker would serve', () => {
  assert.match(LAYOUT_CODE, /import CustomerChatWidget from/);
  assert.match(LAYOUT_CODE, /const chatAvailable = canUseCustomerChat\(user\)/);
  assert.match(LAYOUT_CODE, /\{chatAvailable && \(/, 'the button must be behind the gate');
  // And the worker still refuses regardless — the client gate is courtesy,
  // not enforcement.
  assert.match(CHAT_WORKER, /if \(!isEligible\(user\)\) return c\.json\(tierPaywall\(\), 402\)/);
});

// ---------------------------------------------------------------------------
// The admin section is in the manifest again, and every viewer sees what they
// saw before (DECISIONS D61)
// ---------------------------------------------------------------------------

/**
 * `sections/admin.js` was written on 2026-05-13 with `roles: ['admin']` and the
 * whole filtering apparatus around it, then dropped from the manifest nine days
 * later by a commit whose stated aim — keep admin content out of USER
 * documentation — the apparatus already achieved. For four months
 * `AdminDocsPathGuard` redirected admins to `/help#admin/<sub>`, an anchor with
 * nothing behind it.
 *
 * Re-registering it is only safe if the filtering it relies on actually holds,
 * on every path and for every viewer. That is what the next four assertions
 * are; without them this is a 179-line document put back on trust.
 */
const ADMIN_ANCHORS = SECTIONS.find((s) => s.id === 'admin');

test('the admin section is registered and still tagged admin-only', () => {
  assert.ok(ADMIN_ANCHORS, 'sections/admin.js must be in SECTIONS — the path guard points at it');
  assert.deepEqual(ADMIN_ANCHORS.roles, ['admin'],
    'the tag is the only thing keeping it away from other viewers');
  assert.ok(ADMIN_ANCHORS.subsections.length > 0, 'and it must have content to point at');
});

test('no non-admin viewer sees it — rail, and search, and neither by omission', () => {
  // `undefined` is in this list deliberately: `DocsLayout` passes `role`
  // straight from `useAuth()`, which is undefined for an anonymous visitor, and
  // `buildDocsRecords` used to return the FULL corpus for exactly that value.
  // The rail dropped the section and the search box would have offered it.
  for (const role of ['founder', 'investor', 'partner', 'advisor', 'mentor', '', undefined]) {
    const visible = filterSectionsForRole(SECTIONS, role);
    assert.equal(visible.some((s) => s.id === 'admin'), false,
      `the rail must not show admin docs to ${String(role)}`);

    const hits = createDocsFuse(role).search('admin console');
    assert.equal(
      hits.some((h) => h.item.sectionId === 'admin'), false,
      `search must not return admin docs to ${String(role)}`,
    );
  }
});

test('an admin sees it, or the restoration achieved nothing', () => {
  const visible = filterSectionsForRole(SECTIONS, 'admin');
  assert.ok(visible.some((s) => s.id === 'admin'), 'an admin must reach the admin docs');
  const hits = createDocsFuse('admin').search('admin console');
  assert.ok(hits.some((h) => h.item.sectionId === 'admin'), 'and find them by search');
});

test('the path guard redirects to an anchor that now exists', () => {
  // `AdminDocsPathGuard` sends `/docs/admin/<sub>` and `/help/admin/<sub>` to
  // `/help#admin/<sub>`, defaulting to `overview`. Both halves of that have to
  // be real, and for four months the right-hand side was not.
  const app = codeOnly(read('frontend/src/App.jsx'));
  assert.match(app, /\/help#admin\/\$\{encodeURIComponent\(sub\)\}/,
    'the guard must still redirect into the hash surface');
  const ids = new Set(ADMIN_ANCHORS.subsections.map((s) => s.id));
  assert.ok(ids.has('overview'), "the guard's default subsection must resolve");
});

test('the role filter drops a tagged SUBSECTION, not just a tagged section', () => {
  // NOTHING IN THE CORPUS EXERCISES THIS TODAY, which is why it is tested with
  // a fixture rather than with real data. Commit `88e6d1f97` tagged an "Admin
  // Console (overview)" subsection inside the public Portals section — the case
  // this branch exists for — and `2cf22e3ea` deleted that subsection nine days
  // later. So the branch has been live, unexercised code ever since: a mutation
  // that removed it entirely passed the whole suite.
  //
  // Deleting the branch instead would be the wrong repair. An admin-only
  // subsection inside a public section is a shape this manifest is designed to
  // carry, and the next one added would leak in silence. So the contract is
  // asserted directly, on a section built here.
  const fixture = [{
    id: 'fixture',
    title: 'Fixture',
    subsections: [
      { id: 'public', title: 'Public one', overview: 'x' },
      { id: 'secret', title: 'Admin one', overview: 'y', roles: ['admin'] },
    ],
  }];

  for (const role of ['founder', 'investor', '', undefined]) {
    const [out] = filterSectionsForRole(fixture, role);
    assert.deepEqual(out.subsections.map((s) => s.id), ['public'],
      `a tagged subsection must not reach ${String(role)}`);
  }
  const [asAdmin] = filterSectionsForRole(fixture, 'admin');
  assert.deepEqual(asAdmin.subsections.map((s) => s.id), ['public', 'secret']);

  // And a section left with nothing visible disappears rather than rendering an
  // empty group in the rail.
  const allSecret = [{
    id: 'all-secret', title: 'All secret',
    subsections: [{ id: 'a', title: 'A', roles: ['admin'] }],
  }];
  assert.deepEqual(filterSectionsForRole(allSecret, 'founder'), []);
});

test('adminOnlyAnchors covers both shapes, since the hash guard reads it', () => {
  // `DocsLayout` guards direct hash navigation with this set. It has the same
  // section/subsection duality as the filter above and the same blind spot: the
  // corpus only exercises the section shape.
  const fixture = [{
    id: 'fixture', title: 'Fixture',
    subsections: [
      { id: 'public', title: 'P' },
      { id: 'secret', title: 'S', roles: ['admin'] },
    ],
  }];
  assert.deepEqual([...adminOnlyAnchors(fixture)], ['fixture/secret'],
    'a tagged subsection inside a public section must still be guarded');

  // The real corpus, through the real export: every admin anchor is present.
  const live = adminOnlyAnchors();
  for (const sub of ADMIN_ANCHORS.subsections) {
    assert.ok(live.has(`admin/${sub.id}`), `admin/${sub.id} must be guarded against direct hash entry`);
  }
});
