# Founder workspaces

This folder contains the founder-specific workspace shell and the dedicated canvas landing pages that replace generic route wrappers for active Founder View.

- `FounderWorkspacePage.jsx` provides the shared founder workspace frame used by routes that have not graduated to a dedicated canvas landing.
- `FounderWorkspaceTabs.jsx` preserves access to the detailed tools grouped under each founder workspace.
- `FounderValidatePage.jsx` owns the Validate evidence desk and hands off to the detailed Discovery editor.
- `FounderBuildDesk.jsx` owns the Build weekly operating desk and hands off to the detailed Execution, Roadmap, and Metrics editors.
- `FounderRaiseDesk.jsx` owns the A4 Raise landing: a selected-project, read-only capital and legal overview that hands off to the detailed Pitch, Capital, Legal, Data Room, and Liquidity tools.
- `FounderGrowDesk.jsx` owns the A5 Grow landing at `/build/team` for founders; `?mode=workspace` retains the detailed Talent workspace.
- `FounderNetworkDesk.jsx` owns the A6 Network overview at `/network` for founders. It reads records only and hands off to the three zones — `/network/relationships`, `/network/introductions`, `/network/organizations` — flagging going-cold contacts with `frontend/src/lib/networkBook.js`, the definition those zones share. Workspace mode and `tab`/`intro` deep links still reach `NetworkPage` until the legacy mounts retire.
- `FounderResearchDesk.jsx` owns the A7 Research overview for founders. It reads market, signal, company, fund-research and library sources and hands off to the `/research/*` zones; its question box asks `/research/ask` only when the founder presses Ask, answering from their own library.
- The CSS files beside those components are intentionally route-scoped so the dense canvas layouts do not leak into legacy tools.

**Chrome rule:** the app `SidebarNav` owns licence navigation. Canvas pages here
render **main column + `WorkerRail` only** — never the design's `.side` column.
Horizontal zone pills on each desk replace in-page `#anchors`. See
[`documentation/architecture/SHELL_MIGRATION.md`](../../../documentation/architecture/SHELL_MIGRATION.md).