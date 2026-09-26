// Phase B · Prompt 5 — Single source of truth for the role-scoped sidebar.
//
// Each role lists collapsible groups; groups list items. Items keep the
// same { to, icon, label } shape the old App.jsx nav array used so the
// accordion render path is a thin layer on top of the existing routing.
//
// `requiredTier` is forward-looking — Phase C / Prompt 4 will swap the
// `hasTier()` stub for a real subscription-tier check. The call sites in
// App.jsx already gate on it, so the wiring won't change in Phase C.
//
// Conventions:
//   - First group of every role is the "Home" group (always default-open).
//   - Second content group is also default-open on first load.
//   - The trailing "Account" group always carries Activity / Settings /
//     Documentation so users can find them in a predictable place.
//   - Items must not appear in more than one group within a role.

import {
  LayoutDashboard, Target, FileText, Users, Handshake, Rocket,
  UserCircle, Shield, ShieldCheck, Network, Sparkles, Briefcase,
  TrendingUp, MessageSquare, Package, Calendar,
  Inbox, Radar, Wallet, Landmark, Mail,
  Map, UserCog, Coins, FileStack, SlidersHorizontal,
} from 'lucide-react';

// `workspaces/shellConfig.js` is a pure leaf module — it imports nothing — so
// reading it here cannot close a cycle. The `.js` is explicit because the
// guard tests import this file through Node's ESM loader, which does not
// resolve extensionless relative specifiers the way Vite does.
import { allZoneRoutes, bucketsFor } from './workspaces/shellConfig.js';

// Task #6 — Real subscription-tier check. Bypass roles
// (admin/partner/investor/advisor) always pass; founders are gated by their
// `subscription_tier` column. Mirrors the worker's `userMeetsTier` helper.
const TIER_RANK = { free: 0, growth: 1, studio: 2 };
const BYPASS_ROLES = new Set(['admin', 'partner', 'investor', 'advisor']);
export function hasTier(user, requiredTier) {
  if (!requiredTier || requiredTier === 'free') return true;
  if (!user) return false;
  if (BYPASS_ROLES.has(String(user.role))) return true;
  // Active Spin-Out Lab members get the Growth-tier tooling their program
  // requires (the Pitch Deck Builder is a REQUIRED week-2 lab deliverable) —
  // capped at 'growth' so the lab does NOT unlock Studio-tier features.
  if (Number(user.spinout_lab_active) === 1 && (TIER_RANK[requiredTier] ?? 0) <= TIER_RANK.growth) return true;
  const have = TIER_RANK[String(user.subscription_tier || 'free').toLowerCase()] ?? 0;
  return have >= (TIER_RANK[requiredTier] ?? 0);
}

// Task #7 (W-2) — Investor tier ladder mirrors the worker's
// `userMeetsInvestorTier`. Bypass roles (admin/partner/advisor) always pass.
// Trialing/active are honoured via the `investor_subscription_status` column;
// past_due/unpaid/cancelled drop the user to free.
const INVESTOR_RANK = { free: 0, professional: 1, institutional: 2 };
const INVESTOR_BYPASS_ROLES = new Set(['admin', 'partner', 'advisor']);
export function hasInvestorTier(user, required) {
  if (!required || required === 'free') return true;
  if (!user) return false;
  if (INVESTOR_BYPASS_ROLES.has(String(user.role))) return true;
  if (String(user.role) !== 'investor') return true; // gate is investor-specific
  const status = String(user.investor_subscription_status || 'free').toLowerCase();
  if (status === 'past_due' || status === 'unpaid' || status === 'cancelled') return false;
  const have = INVESTOR_RANK[String(user.investor_tier || 'free').toLowerCase()] ?? 0;
  return have >= (INVESTOR_RANK[required] ?? 0);
}

// Phase D · sidebar slim-down — fewer, broader groups per role plus a
// collapsed "More" bucket for advanced/occasional destinations. No routes
// were removed: every item that used to live here still does, so the
// learning curve drops without losing reachability. Advisor is already lean
// and is left unchanged.
export const SIDEBAR_GROUPS = {
  // ── Super Admin ──────────────────────────────────────────────────────────
  //
  // The franchisor's shell. Same product as `admin` — a super admin IS an
  // admin (migration 199 makes it an elevation, not a separate role), so every
  // admin destination stays reachable; this group is the eight-row HQ canvas
  // laid over the top, and `shellRoleFor` (lib/shellRole.js) picks it when the
  // flag is set and the holder has not switched to the plain Admin view.
  //
  // ROWS ARE ADDED AS THEIR PAGES LAND. The approved canvas has ELEVEN rows —
  // Home, Licences, Funds, Contracts, Team, Revenue, Content, Platform,
  // Support, Security, Settings — and its own changelog says so: "Sidebar is
  // the eleven-row HQ group … The seven-row nav is not drawn anywhere." A row
  // pointing at a route that does not exist is worse than a missing row: it
  // looks shipped and 404s. All eleven resolve today, and
  // `super_admin_shell.test.mjs` fails if a row is added whose route is not
  // registered in App.jsx.
  //
  // This sentence said EIGHT until D146, and omitted Revenue, Content and
  // Platform — the three rows whose own comments sit a few lines below it. The
  // array was never wrong; the prose describing it was, and the test three
  // files away is literally named "all eleven rows are present, in canvas
  // order". A comment a guard already contradicts is the cheapest kind of
  // false claim to leave lying around, and the most misleading to read.
  //
  // Two rows deliberately do not point where their labels first suggest:
  //   Team  → /admin/accounts, the cross-tenant accounts table with the holder
  //           console above it (canvas H4). /admin/team is the PUBLIC team-page
  //           editor — a different thing wearing the same word.
  //   Home  → /hq, the HQ Home page (canvas H1). The Admin Console stays one
  //           row away under Team, and in the admin group the holder keeps.
  super_admin: [
    { key: 'hq', label: 'HQ', items: [
      // D210 — H15 lights this row (its artboard's own nav). The row's own `to`
      // still matches exactly (SidebarNav), so `match` adds only the page it
      // reaches by the Accounts tile's link.
      { to: '/hq', icon: Shield, label: 'Home', match: ['/admin/analytics'] },
      // The one row this tier exists for. Every route behind it is
      // super-admin-only server-side (routes/admin_licences.ts).
      { to: '/admin/licences', icon: Map, label: 'Licences' },
      { to: '/admin/funds', icon: Landmark, label: 'Funds' },
      // The master template library. The doc-type REGISTRY the Contracts ·
      // Super canvas draws above it has no store; the page says so.
      { to: '/admin/contracts', icon: FileText, label: 'Contracts' },
      { to: '/admin/accounts', icon: Users, label: 'Team' },
      // Canvas H5. The artboard's own nav puts Revenue straight after
      // Accounts (= Team), which is where it goes here.
      { to: '/admin/revenue', icon: Coins, label: 'Revenue' },
      // Canvas H6, in the artboard's own nav order: Revenue, Content,
      // then Platform. NOT to be confused with `/admin/articles`, the
      // plain-admin Content Queue that reviews one piece at a time.
      { to: '/admin/content', icon: FileStack, label: 'Content' },
      { to: '/admin/platform', icon: SlidersHorizontal, label: 'Platform' },
      // Y1 — three queues, not the shared Help Center. /help stays for every role.
      { to: '/admin/hq-support', icon: Inbox, label: 'Support' },
      // "Security", not "Governance" (ASSUMPTIONS_LOG A4): the audit log is
      // what someone finds inside, not what they come for.
      { to: '/admin/security', icon: ShieldCheck, label: 'Security' },
      { to: '/account', icon: UserCog, label: 'Settings' },
    ]},
  ],

  // The subsidiary tier (D107). Eight rows, one group — the canvas draws no
  // second group and the territory badge sits above them all, in App.jsx.
  //
  // THE FIRST ROW IS STUDIO, NOT THE CANVAS'S HOME. The product owner replaced
  // the S1 digest as the front door: `/studio` is Eadwyn plus one card per
  // other Admin page. `/branch` stays registered — it is still the digest —
  // and it is no longer a sidebar row, because a row labelled Home that opens
  // the digest is the front door this shell just retired.
  //
  // WHY EVERY ROW SHIPS AT ONCE, WHICH READS AS A REVERSAL OF THE COMMENT ON
  // THE GROUP ABOVE AND IS NOT ONE. That comment forbids a row pointing at a
  // route that does not exist, because such a row "looks shipped and 404s".
  // Every row here HAS a route, registered in App.jsx. The seven `/branch/*`
  // rows are `guard(['admin'])`. Studio is the shared `/studio` route, whose
  // guard includes admin — and as of D155 every branch artboard is a real
  // page. The interim arrangement this comment used to describe (rows whose artboards
  // were not built rendering `BranchZonePending`, a notice naming the artboard
  // and the PR that would build it) is over, and the component is deleted
  // rather than left unused. What it bought was a sidebar matching the canvas
  // while the pages landed one at a time; a one-row sidebar — which is what the
  // rule applied literally would have shipped, since only Settings had a page —
  // is not the subsidiary canvas and does not answer the question the frame
  // exists to answer.
  branch_admin: [
    { key: 'branch', label: 'Branch', items: [
      { to: '/studio', icon: LayoutDashboard, label: 'Studio' },
      { to: '/branch/accounts', icon: Users, label: 'Accounts' },
      { to: '/branch/approvals', icon: Inbox, label: 'Approvals' },
      { to: '/branch/programs', icon: Calendar, label: 'Programs' },
      { to: '/branch/community', icon: Network, label: 'Community' },
      { to: '/branch/contracts', icon: FileText, label: 'Contracts' },
      // D210 — S15 (/branch/insights/analytics) lights this row, per its
      // artboard; `match` covers the row's subtree, which `end` alone does not.
      { to: '/branch/insights', icon: TrendingUp, label: 'Insights', match: ['/branch/insights'] },
      { to: '/branch/settings', icon: UserCog, label: 'Settings' },
    ]},
  ],

  // D286 — THE ADMIN SHELL ON ACCOUNTS HQ HOLDS DIRECTLY (canvas S20). No
  // branch is deployed yet (`infra/branches` holds only `_example.json`, and
  // `tenancyScope.ts` leaves `admin` unscoped), so every plain admin today
  // administers accounts on HQ's own database, on axal.vc. S20 draws that as
  // the branch shell's eight rows, in the same order, with every row pointing
  // at the `/admin` console that already does that work on HQ — never at
  // `/branch/*`, which refuses on HQ.
  //
  // WHAT THIS REPLACED, AND WHERE IT WENT. Until D286 this shell was the old
  // admin sidebar: Studio, then an Admin group of nineteen live console rows
  // (twenty with the parked X), after D284 had already moved the 29 working
  // pages to the Workspaces launcher and Messages to the top bar. The H35
  // placement map (`lib/adminPlacement.js`, D283) is the record of where each
  // of those rows lives now, and `admin_placement_h35.test.mjs` pins the
  // legacy list by value so the map keeps answering for it. Five rows are
  // landings of their own (`pages/admin/Held*.jsx`), each carrying its
  // consoles as literal links so `admin_route_reachability.test.mjs` can walk
  // to them; three point straight at the console that IS the row.
  //
  // `match` lists the consoles a landing leads to, so the row stays lit
  // inside them. A path can light one row only, so a console placed on two
  // rows (Exploring: Accounts, and an Approvals lane) matches its FIRST
  // placement in the map. The `/admin` tabs light rows by QUERY, not path —
  // `adminRowFor` in `lib/hqStrips.js`, read from the same map — which is why
  // the Contracts row can point at `/admin?tab=legal` without lighting on
  // every other tab.
  admin: [
    { key: 'admin', label: 'Admin', items: [
      { to: '/studio', icon: LayoutDashboard, label: 'Studio' },
      { to: '/admin/held/accounts', icon: Users, label: 'Accounts', match: ['/admin/exploring', '/admin/trash'] },
      { to: '/admin/held/approvals', icon: Inbox, label: 'Approvals',
        match: ['/admin/lp-applications', '/admin/refer-earn', '/admin/best-fit', '/admin/due-diligence', '/admin/partners'] },
      { to: '/admin/held/programs', icon: Calendar, label: 'Programs',
        match: ['/admin/spinout-lab', '/admin/advisor-cohorts', '/admin/assessment'] },
      { to: '/admin/held/community', icon: Network, label: 'Community', match: ['/admin/events', '/admin/jobs', '/admin/circles'] },
      // The template library, on the Admin Console's Legal tab. Not "read-only":
      // `requireHqAuthoring` refuses only on a branch, so a plain HQ admin
      // authors templates today. Whether they should is D286's filed question.
      { to: '/admin?tab=legal', icon: FileText, label: 'Contracts' },
      { to: '/admin/held/insights', icon: TrendingUp, label: 'Insights' },
      // Licensing appears only here, as the administrator's own read of their
      // licence (S20's wall rule 4). HQ's ledger of every licence
      // (/admin/licences) is super-admin-only server-side and lives in the HQ
      // group above; a row for it here was a door that opened onto 403s.
      { to: '/admin/my-licence', icon: UserCog, label: 'Settings' },
      // X (Twitter) broadcaster temporarily hidden — OAuth not provisioned yet.
      // Re-enable once X_CLIENT_ID/SECRET are bound on the prod worker.
      // { to: '/admin/x', icon: Megaphone, label: 'X (Twitter)' },
    ]},
    // No 'account' group here on purpose. It once held Articles / Activity Log
    // / Support / Documentation; those moved to the user menu (7c93b83e and
    // 7481ca51) and Company Settings lives in the pinned footer for every role
    // (task #216). The empty declaration outlived its items and rendered an
    // ACCOUNT header over nothing — frontend/test/sidebar_empty_group.test.mjs
    // fails if any role grows a group with no destinations again.
  ],

  // Task #19 — regroup the founder sidebar around the venture lifecycle:
  // Home → Build → Validate → Raise → Launch → More → Account. This replaces the
  // former 8-group layout (which crammed execution + validation + fundraising
  // into one "Build" bucket and duplicated Home via a parallel portal)
  // so every feature has exactly one home and founders face far fewer top-level
  // choices. Sidebar-level only: every surviving route/icon/tier-gate is
  // preserved; no pages are merged. Mirrors the Task #17 investor reorg.
  //
  // Intentional removals (documented so a nav-integrity guard treats them as
  // deliberate, not silent drops):
  //   • The legacy founder landing page and standalone Spin-Outs page were
  //     retired. Execution remains a first-class row.
  //   • "Portfolio Health" (/portfolio/health) — folded into Metrics
  //     (/build/metrics) as the founder's own company-health view; the
  //     /portfolio/health route stays registered and reachable for other roles.
  //   • "Network Effects" (/network-effects) is demoted to More while a single
  //     "Network" entry (/network) leads Validate; both routes stay live.
  //   • Task #1 — "Contacts" (/contacts) is merged into the Network page as its
  //     default "Contacts" tab; /contacts redirects to /network?tab=contacts and
  //     /relationships redirects to /network?tab=relationships.
  //   • "My Profile" (/profile) — the full Profile editor lives inside Settings
  //     (/settings) as the first tab, so a separate sidebar item is redundant.
  //   • standalone "Identity / KYC" (/kyc) — folded into "Trust Center" (/trust)
  //     as a single nav entry; the Identity Verification form now renders on the
  //     Trust Center "Identity" tab (Task #25). The /kyc route stays registered
  //     and reachable (the onboarding KYC gate still redirects there).
  //
  // Newly surfaced (routes already existed and are founder-accessible, they just
  // weren't in the founder nav): Co-Marketing (/comarketing, Launch).
  // Founder shell — the canvas declares nine rows (Home · Validate · Build ·
  // Raise · Grow · Network · Research · Trust · Company Settings). Eight land
  // here; Trust is deliberately absent, pinned out of every sidebar by
  // trust_center_navigation.test.mjs — it is reached from the user dropdown.
  // Spin-Out Lab keeps a row of its own on top of that, so nine. Messages is
  // not a row here: since D284 it is a top-bar button on every shell the
  // /messages route admits, and only the exploring group still carries a row.
  //
  // The twenty-one items this replaces all keep a door. Five rows own their
  // sections through FounderWorkspaceTabs, which wraps each route in App.jsx:
  //
  //   Validate → Discovery · Marketplace · Advisory
  //   Build    → Execution · Roadmap · Metrics      (canvas: This week ·
  //              Board · Roadmap · Cadence · KPI entry)
  //   Raise    → Pitch · Capital · Legal · Data room · Liquidity
  //   Grow     → Talent · Brand · Launch · Perks · Network effects
  //   Research → Market · Signals
  //
  // Seven destinations had ZERO inbound links anywhere outside this file —
  // /messages, /execution, /signals, /build/team, /build/metrics,
  // /network-effects and /raise/capital. Six of them are now reachable only
  // because those bars exist; /messages is reached from the top-bar Messages
  // button (D284), which replaced the row it kept here.
  //
  // /liquidity's `requiredTier: 'studio'` moved onto its tab rather than being
  // dropped: the route itself has no tier gate, so the nav was the whole gate.
  //
  // As in the investor shell, the Spin-Out Lab row ships verbatim — it is not
  // a modification target, and the canvas folds it into Home without saying
  // what Home would then be.
  // Rebuilt from the Founder canvas. Every row now lands on its bucket's FIRST
  // ZONE rather than on whichever legacy page happened to be that section's
  // door — so the zone row under the heading is populated on arrival and the
  // URL says which section you are in. The IA itself lives in
  // src/workspaces/shellConfig.js; this array is the render of it, and
  // test/workspace_shell_routes.test.mjs asserts the two agree.
  //
  // `match` keeps every legacy path highlighting the right row, because those
  // URLs are still live and still linked from inside pages. A migration that
  // leaves old links pointing at a row that no longer lights up has moved the
  // problem rather than fixed it.
  founder: [
    { key: 'home', label: 'Home', items: [
      { to: '/studio', icon: LayoutDashboard, label: 'Studio' },
      // Spin-Out Lab keeps its own tree, untouched by the shell migration.
      { to: '/spinout-lab', icon: Rocket, label: 'Spin-Out Lab' },
      // Each row points at the workspace ROOT, which renders that workspace's
      // overview. Pointing a row at a section page is how the overviews were
      // lost: a rebuild took the desk's slot, the desk was re-mounted on
      // whatever path was free, and the row was never pointed back. `match`
      // keeps every legacy and section URL highlighting the right row.
      { to: '/validate', icon: MessageSquare, label: 'Validate',
        match: ['/validate', '/build/discovery', '/build/marketplace', '/needs', '/services', '/advisory'] },
      { to: '/build', icon: Briefcase, label: 'Build',
        match: ['/build/this-week', '/build/board', '/build/roadmap', '/build/cadence', '/build/kpi', '/build/metrics', '/execution'] },
      { to: '/raise', icon: Sparkles, label: 'Raise', match: ['/raise', '/liquidity'] },
      { to: '/grow', icon: TrendingUp, label: 'Grow',
        match: ['/grow', '/build/team', '/advisors', '/cofounder', '/my/jobs', '/jobs', '/my/applications', '/spinout-lab/brand', '/build/brand', '/comarketing', '/perks', '/network-effects'] },
      // Points at /network, not at the first zone: /network is the one route
      // that role-branches its element, so it is the landing every license can
      // open, and it forwards to the zone. The three /network/* zone routes are
      // still founder-guarded — widening them is the Network half of this
      // migration and has not landed yet.
      { to: '/network', icon: Handshake, label: 'Network',
        match: ['/network', '/relationships', '/contacts'] },
      { to: '/research', icon: Radar, label: 'Research',
        match: ['/research', '/signals', '/market-intel'] },
    ]},
  ],

  // Service-partner sidebar audit — regroup around the partner lifecycle but
  // collapse it into FIVE fuller groups so no section is a header over a single
  // item and the nav stays short: Home → Sourcing → Engage → Earn → Account.
  // The lifecycle stages still map cleanly — Offer + Match + (demand) signal
  // live in "Sourcing"; Deliver + relationships live in "Engage" — they're
  // just no longer separate one-line sections. "Sourcing" is the partner
  // lane's own verb ("Source thesis-aligned companies; monetise services",
  // brand/gvpn.ts) — this is a venture partner network, not a job board, so
  // the label is deliberately venture-native rather than gig-marketplace. This
  // replaces the former
  // investor-shaped layout (Sourcing / Insights / Capital & Legal / Network)
  // that carried founder-, investor-, and studio-internal surfaces a service
  // partner never acts on. Sidebar-level only: every surviving route/icon is
  // preserved and no pages are merged. Mirrors the investor (Task #17) and
  // founder (Task #19) reorgs.
  //
  // Merges (each feature has exactly one home):
  //   • Partners → Network (Engage); match keeps the item active on the legacy
  //     /partners and /relationships routes, which stay registered.
  //   • "My Service Catalogue" → "My Services" (Sourcing).
  //   • Demand Insights folds into Sourcing (the one partner-native signal)
  //     so the standalone Insights section is gone.
  //
  // Intentional removals from the partner nav (documented so a nav-integrity
  // guard treats them as deliberate, not silent drops — every route below
  // stays registered and reachable for other roles or via deep link):
  //   • /partner-portal "Partner Portal" — the page is retired. The route
  //     redirects to Studio, which is the home.
  //   • /projects "Projects" and /pipeline "Pipeline Board" — studio/investor
  //     execution + deal-pipeline surfaces, not partner-facing.
  //   • /deals "Deal Flow" — only relevant to investor-type partners
  //     (GP / angel / scout / corporate-VC personas); conditional, to be
  //     re-surfaced when the sidebar supports persona gating.
  //   • /scoring "Scoring Engine", /portfolio/risk-matrix "Risk Matrix",
  //     /admin/due-diligence "Due Diligence" — investor/studio diligence tools.
  //   • /market-intel "Market Intelligence" — investor-flavoured intel dropped
  //     to keep the partner UX lean; Demand Insights is the kept signal.
  //   • /portfolio/health "Portfolio Health", /portfolio/coverage
  //     "Portfolio Coverage", /watchlist "Watchlist & Journal",
  //     /liquidity "Liquidity & Exits", /legal-capital "Legal & Capital" —
  //     investor/founder capital surfaces; conditional for equity-holding
  //     partners only.
  //   • /advisors "Find a Advisor" — founder-oriented (a service partner is the
  //     expert, not the mentee); conditional.
  //   • /network-effects "Network Effects" — too abstract to earn a nav slot.
  //   • /articles/draft "Articles" — low-frequency authoring; conditional for
  //     content/press partners.
  // ── Partner / Operator — the canonical shell from the Partner canvas ────────
  // The canvas declares it outright: `const ROWS = ['Home','Pipeline','Delivery',
  // 'Offers','Network','Research','Trust','Firm Settings']`, commented "CANONICAL
  // Partner shell — 8 rows, no tier gating in v1". That is a FLAT list, not a set
  // of groups, so this role is one group of rows rather than seven groups of
  // seventeen items. Each row is a workspace; the sections the canvas draws
  // inside it (Pipeline → Leads · Negotiations · Proposals · Retainers ·
  // Analytics) belong in the page, not the sidebar.
  //
  // NOTHING BECAME UNREACHABLE. All seventeen previous destinations still
  // resolve; each is listed in the `match` of the row that now owns it, so a
  // deep link or a bookmark still highlights the right row. `match` is
  // exact-or-subtree (`SidebarNav.jsx`: `pathname === p || startsWith(p + '/')`),
  // which is why `/partner/operations/engagements` can sit under Pipeline while
  // its siblings sit under Delivery without the two colliding.
  //
  // TWO DEPARTURES FROM THE CANVAS, both deliberate:
  //   Home → /studio, not a new /home. Per the product owner, and it keeps
  //     /partner from becoming a root.
  //   Messages is not a row. The canvas's eight rows have nowhere to put it,
  //     and until D284 it sat here as a ninth row so the live surface was not
  //     reachable only by typing the URL — the Wave 4 mistake in reverse.
  //     D284 put a Messages button in the top bar for every shell /messages
  //     admits, which is where a cross-cutting inbox lives; the row went.
  // ── Partner / Operator — the canonical shell, now complete ─────────────────
  // Canvas ROWS: Home · Pipeline · Delivery · Offers · Network · Research ·
  // Trust · Firm Settings. "CANONICAL Partner shell — 8 rows, no tier gating
  // in v1." Flat, and now actually eight.
  //
  // THE SIX PENDING ROWS ARE GONE because their workspaces absorbed them.
  // `PartnerWorkspaceTabs` wraps the Pipeline and Offers pages at the route,
  // so every section is one click from its row:
  //   Pipeline → Leads · Matches · Demand · Retainers
  //   Delivery → the /partner/operations subtree, tabbed by
  //              PartnerOperationsWorkspace since Wave 1a
  //   Offers   → Catalog · Perk deals · Visibility · Proof · Office hours
  // The tabs are role-filtered against the same guards App.jsx applies, because
  // those routes do not share one: an investor on /services must not be shown
  // an Office Hours tab that bounces them.
  //
  // Trust is ABSENT, deliberately: trust_center_navigation.test.mjs pins Trust
  // Center to the user dropdown and asserts it appears in no sidebar.
  // Firm Settings is the COMPANY's settings; Account is a different page.
  partner: [
    { key: 'shell', label: '', items: [
      { to: '/studio', icon: LayoutDashboard, label: 'Studio' },
      { to: '/spinout-lab', icon: Rocket, label: 'Spin-Out Lab' },
      // EVERY WORKSPACE ROW POINTS AT ITS BUCKET ROOT. Pipeline, Delivery,
      // Offers and Research used to point at legacy destinations — /needs,
      // /partner/operations/overview, /services, /signals — so the canvas
      // overview pages were unreachable from the sidebar and the rows lit up
      // on pages outside their own buckets. The roots render the overviews
      // (PartnerBucketRoutes); the legacy destinations stay in `match` so a
      // deep link still lights the right row.
      { to: '/pipeline', icon: Target, label: 'Pipeline',
        match: ['/pipeline', '/needs', '/matches', '/partner/insights', '/partner/operations/engagements'] },
      { to: '/delivery', icon: Briefcase, label: 'Delivery',
        match: ['/delivery', '/partner/operations/overview', '/partner/operations/portfolio',
                '/partner/operations/performance'] },
      { to: '/offers', icon: Package, label: 'Offers',
        match: ['/offers', '/services', '/perks', '/comarketing', '/partner/office-hours',
                '/partner/operations/capabilities'] },
      { to: '/network', icon: Users, label: 'Network',
        match: ['/network', '/relationships', '/contacts'] },
      { to: '/research', icon: Radar, label: 'Research', match: ['/research', '/signals', '/market-intel'] },
    ]},
  ],

  // Investor/LP shell — a single headerless group, matching the approved
  // Investor LP Canvas. Each row is a complete investor workspace; legacy
  // deep links remain matched to their owning row.
  investor: [
    { key: 'home', label: 'Home', items: [
      { to: '/studio', icon: LayoutDashboard, label: 'Studio' },
      { to: '/spinout-lab', icon: Rocket, label: 'Spin-Out Lab' },
      // EVERY ROW POINTS AT ITS WORKSPACE ROOT, not at the first zone. Deals,
      // Portfolio and Research each pointed one level down — at
      // /deals/pipeline, /portfolio/health and /research/ask — and that is the
      // whole of "Deals land on Pipeline and not on the Deals overview". The
      // root renders the workspace's overview; the zone row underneath it
      // renders the sections. A row aimed at a zone skips the overview, which
      // is precisely how the founder overviews were lost the first time.
      { to: '/deals', icon: Handshake, label: 'Deals',
        match: ['/deals', '/pipeline', '/raise/data-room'] },
      // Positions is the canvas's word for the holdings view. /portfolio is the
      // overview; /portfolio/positions is the book; /portfolio/health is the
      // legacy alias that still renders the overview, and the generic tab bar
      // labels the book "Cap Table" — three names across two pages, and
      // settling that vocabulary is a content decision. What the row owes is
      // the root.
      { to: '/portfolio', icon: Briefcase, label: 'Portfolio', match: ['/portfolio'] },
      { to: '/spinout-lab/investor-workspace', icon: Landmark, label: 'Axal VC Fund' },
      { to: '/funds', icon: Wallet, label: 'Fund', match: ['/funds', '/lp-reports'], requiredInvestorTier: 'institutional' },
      { to: '/network', icon: Handshake, label: 'Network', match: ['/network', '/relationships', '/contacts'] },
      { to: '/research', icon: Radar, label: 'Research', match: ['/research', '/market-intel'] },
      { to: '/trust', icon: ShieldCheck, label: 'Trust' },
      // NO Company Settings row. The canvas asks for one; the shipped decision
      // is that /company-settings is the sidebar's PINNED FOOTER for every
      // role, because it used to be a row as well and rendered twice. The
      // footer carries no role gate, so dropping the row strands nobody. The
      // canvas and that decision disagree, and the decision holds until
      // somebody overturns it deliberately.
    ]},
  ],

  // Advisor Canvas contract: six workspace rows only. Existing concrete
  // routes remain reachable through deep links and are grouped under the
  // owning workspace rather than promoted to separate sidebar destinations.
  advisor: [
    { key: 'home', label: 'Home', items: [
      { to: '/studio', icon: LayoutDashboard, label: 'Studio' },
      { to: '/spinout-lab', icon: Rocket, label: 'Spin-Out Lab' },
      // EVERY WORKSPACE ROW POINTS AT ITS BUCKET. These five used to point
      // outside their own buckets — Practice at /advisor/advisory/opportunities,
      // Expertise at /office-hours, Research at /signals — because two shipped
      // decisions had claimed those destinations first and retargeting a row
      // against a decision was left as an open call. The call is made: the
      // rows land in the buckets the canvases specify, and the legacy routes
      // stay live, stay linked from inside the buckets, and stay in `match`.
      //
      // The two that pointed at /advisor/advisory and /office-hours were worse
      // than merely off-canvas. Both destinations are wrapped in
      // `advisorPrivateWorkspace`, which sends an admin previewing the Advisor
      // role to /studio — so for that viewer the Practice and Expertise rows
      // did not open a workspace at all. That is the whole of "Practice and
      // Expertise lands on Studio page".
      { to: '/practice', icon: Briefcase, label: 'Practice',
        match: ['/practice', '/advisor/advisory'] },
      // Cohorts reads Spin-Out Lab data read-only and owns none of it.
      { to: '/cohorts', icon: Users, label: 'Cohorts', match: ['/cohorts'] },
      { to: '/expertise', icon: UserCircle, label: 'Expertise',
        match: ['/expertise', '/advisors'] },
      { to: '/network', icon: Users, label: 'Network',
        match: ['/network', '/relationships', '/contacts', '/advisor/network'] },
      { to: '/research', icon: Radar, label: 'Research',
        match: ['/research', '/signals', '/market-intel'] },
      // NO Trust row (it belongs to the user dropdown) and NO Practice Settings
      // row (the pinned footer is the single entry point). The canvas asks for
      // both; both are decisions already made against it.
    ]},
  ],

  exploring: [
    { key: 'home', label: 'Home', items: [
      { to: '/exploring', icon: LayoutDashboard, label: 'Studio', highlight: true },
      // Task #13 — surface the Spin-Out Lab program to explorers so they can
      // see the full 28-day pipeline before committing.
      { to: '/spinout-lab', icon: Rocket, label: 'Spin-Out Lab' },
      { to: '/messages', icon: Mail, label: 'Messages' },
    ]},
    { key: 'account', label: 'Account', items: [
      { to: '/profile', icon: UserCircle, label: 'My Profile' },
    ]},
  ],
};

// Decide which group keys should start expanded on a fresh visit:
// Home + the first non-Home group with items. Returns a Set<string>.
export function defaultOpenGroups(role) {
  const groups = SIDEBAR_GROUPS[role] || [];
  const open = new Set();
  if (groups[0]) open.add(groups[0].key);
  const firstContent = groups.find((g, i) => i > 0 && (g.items || []).length > 0);
  if (firstContent) open.add(firstContent.key);
  return open;
}

// Task #6 — Items with a `requiredTier` the user lacks STAY in the list (so
// they remain discoverable) but render with a lock icon and route through
// PaywallModal on click. App.jsx reads `requiredTier` directly to render the
// lock + intercept; this helper is kept for legacy callers but no longer
// hides items.
export function filterItemsByTier(items /* , user */) {
  return items || [];
}


/**
 * Every workspace route a role has, derived rather than typed.
 *
 * `workspaces/shellConfig.js` already declares each shell's buckets and each
 * bucket's zones, and `App.jsx` already registers a route per entry — so the
 * full-bleed list is a restatement of that config, and every time it was typed
 * out by hand something went missing from it. `/grow/focus` was absent from
 * both founder arrays and was the whole of "Grow doesn't fit full width and
 * height"; the four `/funds/*` zone pages were absent from both investor ones.
 * Derived, a zone cannot be added to a shell without being covered here.
 *
 * Safe to import: `shellConfig.js` has no imports of its own, so this cannot
 * close a cycle. The two guards that used to regex-parse the literals out of
 * this file's source now import these lists and check them against
 * `allZoneRoutes`, which is a stronger check than counting quoted strings.
 *
 * WHY `/research/*` IS NO LONGER CARVED OUT. It used to be excluded from both
 * lists, on the reasoning that those zones "render `WorkspaceShell` around a
 * plain card" and "a page that does not draw its own canvas does not want the
 * canvas layout". That was a true observation about a shell with no padding of
 * its own — and `/validate/*` has the identical shape and was never carved
 * out, so one role held both treatments at once. `WorkspaceShell` now carries
 * the canvases' own `.main` padding, so a plain-card zone is padded by the
 * component that draws it rather than by the page container, and the carve-out
 * has nothing left to compensate for.
 */
function workspaceRoutes(role) {
  return [...bucketsFor(role).map((b) => b.prefix), ...allZoneRoutes(role)];
}

/**
 * Founder surfaces that own the full dashboard: no `max-w-7xl mx-auto`, no
 * `p-4 md:p-6`. Every page here draws its own full-bleed canvas and sets its
 * own `min-height: 100dvh`, so the shell's centred column and padding would
 * put a card inside a card and push the page past the viewport.
 *
 * THIS WAS TWO ARRAYS. `App.jsx` held `fullWidthSurface` and `flushSurface` as
 * separate hand-typed lists of the same 16 paths, matched with an exact
 * `.includes(location.pathname)` — no prefix matching, so every new route had
 * to be added to both by hand. `/grow/focus` was the one `/grow/*` route
 * missing from both, and it was the whole of "Grow doesn't fit full width and
 * height". One list makes that omission impossible rather than fixed once;
 * `frontend/test/founder_shell.test.mjs` asserts every founder desk and
 * section route is in it.
 */
export const FOUNDER_FULL_BLEED = [
  ...workspaceRoutes('founder'),
  // The legacy paths the overviews were rescued onto. Still live, still linked
  // from inside pages, so they keep rendering the same desk at the same width.
  // These are the only hand-typed entries left, because they are exactly the
  // routes the shell config does NOT claim.
  '/build/discovery', '/execution', '/build/team', '/signals',
];

/**
 * The same list for the Investor & LP shell, and it exists for the same reason.
 *
 * `App.jsx` carried the investor half of `fullWidthSurface` and `flushSurface`
 * as one hand-typed expression written out TWICE, identically — the exact shape
 * the founder half was collapsed out of. It matched the prefix `/portfolio/`
 * plus eight literal paths, which meant the four `/funds/*` zone pages were in
 * neither list even though each of their shells declares `min-height:100vh`
 * (`investorFundLPs.css` `.ip1-fund-shell` and its three siblings). That is the
 * `/grow/focus` omission again, four times over, and it is why the LP registry,
 * capital calls, accounting and reporting pages sat in a centred column inside
 * a page that had already drawn its own frame.
 *
 * `/research/*` USED TO BE CARVED OUT of this list and is not any more — see
 * `workspaceRoutes` above for why the reason it existed no longer holds.
 */
export const INVESTOR_FULL_BLEED = [
  ...workspaceRoutes('investor'),
  // Legacy mounts the shell config does not claim, each still live and still
  // rendering the same canvas at the same width.
  '/pipeline', '/pipeline/screening', '/pipeline/commit', '/pipeline/transactions',
  '/portfolio/health', '/portfolio/growth', '/portfolio/performance',
  '/portfolio/risk-matrix', '/portfolio/reserves', '/portfolio/waterfall',
  '/market-intel',
];

/**
 * Advisor and Partner, which had no list at all — the omission behind two of
 * the four axes the layout audit measured.
 *
 * Advisor routes were full WIDTH but padded, through a blanket
 * `activeRole === 'advisor'` clause in `App.jsx` that no test referenced in
 * either direction. Partner routes were padded AND centred at `max-w-7xl`,
 * making it the only one of the four licences constrained to 1280px and the
 * one that looked least like its canvas. Both now go through the same derived
 * rule as the other two, so all four shells are one layout.
 */
export const ADVISOR_FULL_BLEED = [...workspaceRoutes('advisor')];

export const PARTNER_FULL_BLEED = [
  ...workspaceRoutes('partner'),
  // Legacy mounts of the same bodies, kept at the same width so this change
  // moves nothing that a partner already had.
  '/partner/operations', '/partner/operations/overview', '/partner/operations/capabilities',
  '/partner/operations/portfolio', '/partner/operations/engagements', '/partner/operations/performance',
  '/needs', '/services', '/perks', '/partner/insights',
];

/**
 * Full-bleed surfaces that belong to no single licence.
 *
 * The two lists above are role-scoped because their pages are: a founder desk
 * is not reachable as an investor. `/referrals` is not like that — admin,
 * founder, partner and investor all open the same page at the same path, so
 * appending it to one role's list would be wrong for the other three and
 * appending it to both would be the duplication those lists exist to remove.
 *
 * It is a list rather than a bare constant so the next role-agnostic canvas
 * has an obvious home. The alternative — and what this replaced — was
 * `location.pathname === '/referrals'` hand-typed onto BOTH `fullWidthSurface`
 * and `flushSurface` in App.jsx, which is exactly the shape that let
 * `/grow/focus` go missing from one array and not the other.
 */
/**
 * Role wizards that paint inside the app shell. Exact paths, not the
 * `/onboarding/` prefix: `/onboarding` itself is the licence picker and
 * renders outside this shell (it keeps its own logo), and `/onboarding/chat`
 * is the same kind of full-screen step. These three are the body under the
 * sidebar and the header, so the shell flushes its padding and drops the
 * footer and the page's background runs to every edge of that column.
 */
export const ONBOARDING_CANVAS_PATHS = [
  '/onboarding/founder',
  '/onboarding/investor',
  '/onboarding/partner',
];

export const SHARED_FULL_BLEED = [
  '/referrals',
  // `/spinout-lab` — the Lab introduction opens with a full-bleed hero that has
  // to run from the sidebar's right border to the viewport edge, which the
  // shell's own `p-4 md:p-6` prevents. Role-agnostic for the same reason
  // `/referrals` is: founder, investor and admin all open this path, at four
  // different states (the intro, the "you're in" screen, the live workspace and
  // the investor read), and every one of them supplies its own padding —
  // SpinoutLabInvestorPage.jsx had to be given some in the same commit, because
  // it had none and was relying on the shell's.
  '/spinout-lab',
  ...ONBOARDING_CANVAS_PATHS,
];

/**
 * Full-bleed by PREFIX, for a family of routes rather than a path.
 *
 * WHY A SECOND EXPORT AND NOT TWENTY-THREE MORE ENTRIES ABOVE. The Lab's tool
 * routes are one surface with many doors, and listing each would mean a new
 * tool is full width only if somebody remembers to add it here — the exact
 * failure `FOUNDER_FULL_BLEED` was derived from the shell config to prevent.
 * The Lab has no shell config to derive from, so the prefix is the derivation.
 *
 * AND WHY IT LIVES HERE RATHER THAN IN `App.jsx`. It was written there first,
 * as a `startsWith` on the padding flag — but `App.jsx` already tested the same
 * prefix on the WIDTH flag, so the two could be changed apart, and a route
 * could end up full width with the shell's padding or flush inside a centred
 * column. One list, read once, and both flags follow it.
 *
 * Every `/spinout-lab/<tool>` page owns its own gutters through `LabPageShell`
 * (`LAB_PAGE_PAD`), which is what makes flushing the shell correct rather than
 * merely tidier. `/spinout-lab/brief` is outside the shell entirely (public
 * marketing collateral that prints with no nav), and
 * `/spinout-lab/investor-workspace` is a workspace route, which `WorkspaceShell`
 * pads from the canvases' own `.main` — both are flush for reasons that predate
 * this list.
 */
export const SHARED_FULL_BLEED_PREFIXES = [
  '/spinout-lab/',
  // A researched fund's own page. The list `/research/funds` is already full
  // bleed because it is a shell zone; the child is not in that derived list,
  // and without this prefix the dossier would sit inside App's padding on top
  // of WorkspaceShell's own. The trailing slash keeps the list itself on the
  // zone rule.
  '/research/funds/',
  // One competitor inside an analysis. The list `/research/companies` is
  // already a shell zone; the child is not, and without this prefix the page
  // would sit inside App's padding on top of WorkspaceShell's own.
  '/research/companies/',
];
