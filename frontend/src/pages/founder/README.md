# Founder workspaces

This folder contains the founder-specific workspace shell and the dedicated canvas landing pages that replace generic route wrappers for active Founder View.

- `FounderWorkspacePage.jsx` provides the shared founder workspace frame used by routes that have not graduated to a dedicated canvas landing.
- `FounderWorkspaceTabs.jsx` preserves access to the detailed tools grouped under each founder workspace.
- `FounderValidatePage.jsx` owns the Validate evidence desk at `/validate` and hands off to the four `/validate/*` stages. It no longer embeds the Discovery editor: a founder's bare `/build/discovery` redirects to `/validate`, and `?mode=workspace` or a Discovery `?tab=` mounts DiscoveryPage at the route (D422).
- `FounderBuildDesk.jsx` owns the Build weekly operating desk at `/build` and hands off to the `/build/*` zones. It no longer embeds ExecutionPage: a founder's bare `/execution` redirects to `/build`, and `/execution?mode=workspace`, `/execution/board` and `/execution/roadmap` mount the editor at the route (D422).
- `FounderRaiseDesk.jsx` owns the A4 Raise landing: a selected-project, read-only capital and legal overview that hands off to the detailed Pitch, Capital, Legal, Data Room, and Liquidity tools.
- `FounderGrowDesk.jsx` owns the A5 Grow desk at `/grow`, and a founder's bare `/build/team` renders it too; `/build/team?mode=workspace` renders the Team workspace.
- `ShareUpdateSheet.jsx` is Grow's "Share an update" side sheet (D654), opened from the Grow desk's header: Period, Metrics, Highlights, Asks, Audience and Preview, plus the `nometrics` and `nothing` states of `Cycle Action.dc.html` (`action=update`). It writes the founder's `portfolio_updates` row through `../../lib/api/shareUpdate.js`.
- `SentUpdatePage.jsx` is `/updates/:uid` (D654): the author sees replies to each ask and the module each became an item in, who opened it, and "Ask again" after 14 days with no reply; a recipient sees what their audience may read and replies in place.
- `FounderTeamPage.jsx` owns the Team workspace at `/build/team?mode=workspace` (D435): the company's roster, advisors, hiring and coverage from migration 326's stores, with the advisor directory, Co-founder Match and the jobs list opening inside the tab that owns each. It replaced the retired Team Building page (D435); the founder redirects `?tab=advisor|cofounder|jobs` land here.
- `FounderNetworkDesk.jsx` owns the A6 Network overview at `/network` for founders. It reads records only and hands off to the three zones — `/network/relationships`, `/network/introductions`, `/network/organizations` — flagging going-cold contacts with `frontend/src/lib/networkBook.js`, the definition those zones share. Workspace mode and `tab`/`intro` deep links still reach `NetworkPage` until the legacy mounts retire.
- `FounderResearchDesk.jsx` owns the A7 Research overview for founders. It reads market, signal, company, fund-research and library sources and hands off to the `/research/*` zones; its question box asks `/research/ask` only when the founder presses Ask, answering from their own library.
- `FounderStudioHome.jsx` is the founder's `/studio`, built to `Founder Studio.dc.html` (D564): there is no separate home. It makes the page's reads, each settled on its own, and mounts Eadwyn (`StudioInterview`) and the archetype card (`ProfileFitSection compact`). The zones live in `FounderStudioBody.jsx`, apart from the home so a Node test can render them (the home mounts PersonalAdvisor, whose imports reach Worker modules), and `founderStudioModel.js` turns each read into a zone that is loading, unreadable, not recorded, empty or ready. A zone with no store says so; nothing missing is drawn as zero.
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
D548 wires the stored Review status into Build's counts/filter/card rows. Grow's
monthly headline uses only a target explicitly marked as the focus; the existing
Focus card sets/clears it through the scoped targets route. Unknown focus remains
unselected, and an unreadable target source is reported as Unreadable.
- `RecordSessionSheet.jsx` is Validate's "Record a session" side sheet (D660), opened from each row of the interview log at `/validate/interviews`: How, With, Talking points, Consent and the two model lists of `Cycle Action.dc.html` (`action=record`). On an audio channel Start stays disabled until consent is recorded. It creates the session through `../../lib/api/interviewSessions.js`.
- `InterviewSessionPage.jsx` is `/validate/session/:id` (D660): the start step (consent, and the Worker's 409 in its own words), the Recording View while recording, and the review step with one-tap speaker assignment, beside a rail with the models, the cost receipt and the meter.
- `RecordingView.jsx` is the Recording View's eleven states (D660), full-screen on a phone, light by default and dark with the theme. Its ring is `../../components/discovery/RingViz.jsx` on `../../lib/ringViz.js`, and capture (live 16 kHz PCM, chunk upload, the IndexedDB queue) is `../../lib/interviewCapture.js`.
