# Founder workspaces

This folder contains the founder-specific workspace shell and the dedicated canvas landing pages that replace generic route wrappers for active Founder View.

- `FounderWorkspacePage.jsx` provides the shared founder workspace frame used by routes that have not graduated to a dedicated canvas landing.
- `FounderWorkspaceTabs.jsx` preserves access to the detailed tools grouped under each founder workspace.
- `FounderValidatePage.jsx` owns the Validate evidence desk at `/validate` and hands off to the four `/validate/*` stages. It no longer embeds the Discovery editor: a founder's bare `/build/discovery` redirects to `/validate`, and `?mode=workspace` or a Discovery `?tab=` mounts DiscoveryPage at the route (D422).
- `FounderBuildDesk.jsx` owns the Build weekly operating desk at `/build` and hands off to the `/build/*` zones. It no longer embeds ExecutionPage: a founder's bare `/execution` redirects to `/build`, and `/execution?mode=workspace`, `/execution/board` and `/execution/roadmap` mount the editor at the route (D422).
- `FounderRaiseDesk.jsx` owns the A4 Raise landing: a selected-project, read-only capital and legal overview that hands off to the detailed Pitch, Capital, Legal, Data Room, and Liquidity tools.
- `FounderGrowDesk.jsx` owns the A5 Grow desk at `/grow`, and a founder's bare `/build/team` renders it too; `/build/team?mode=workspace` renders the Team workspace.
- `FounderTeamPage.jsx` owns the Team workspace at `/build/team?mode=workspace` (D435): the company's roster, advisors, hiring and coverage from migration 326's stores, with the advisor directory, Co-founder Match and the jobs list opening inside the tab that owns each. It replaced the retired Team Building page (D435); the founder redirects `?tab=advisor|cofounder|jobs` land here.
- `FounderNetworkDesk.jsx` owns the A6 Network overview at `/network` for founders. It reads records only and hands off to the three zones — `/network/relationships`, `/network/introductions`, `/network/organizations` — flagging going-cold contacts with `frontend/src/lib/networkBook.js`, the definition those zones share. Workspace mode and `tab`/`intro` deep links still reach `NetworkPage` until the legacy mounts retire.
- `FounderResearchDesk.jsx` owns the A7 Research overview for founders. It reads market, signal, company, fund-research and library sources and hands off to the `/research/*` zones; its question box asks `/research/ask` only when the founder presses Ask, answering from their own library.
- `FounderStudioHome.jsx` is the founder's `/studio` home (canvas 69dc42f3, S1). Its cards live in `founderStudioCards.jsx`, apart from the home so a Node test can render them (the home mounts PersonalAdvisor, whose imports reach Worker modules). A card whose read failed draws `Unreadable` with a retry and nothing else, and the Lab card counts the milestones `/spinout-lab/state` sends (D321).
- The CSS files beside those components are intentionally route-scoped so the dense canvas layouts do not leak into legacy tools.

**Chrome rule:** the app `SidebarNav` owns licence navigation. Canvas pages here
render **main column + `WorkerRail` only** — never the design's `.side` column.
Horizontal zone pills on each desk replace in-page `#anchors`. See
[`documentation/architecture/SHELL_MIGRATION.md`](../../../documentation/architecture/SHELL_MIGRATION.md).

**Rail rule (D424):** a desk with proposal bands (Validate, Build, Raise, Grow)
passes `fills` to its `WorkerRail` and its own sentence from
`ASSIST_SURFACES.workspace.desks` as `note`; a desk with none (Network,
Research) passes that map's `none` sentence and no switch. Every band on a
desk takes the desk's `useAiSpend()` result as `ai`, so it quotes the cost
before a run. `validate_fills_the_blanks.test.mjs` holds each sentence to the
bands its desk mounts.