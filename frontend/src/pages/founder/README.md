# Founder workspaces

This folder contains the founder-specific workspace shell and the dedicated canvas landing pages that replace generic route wrappers for active Founder View.

- `FounderWorkspacePage.jsx` provides the shared founder workspace frame used by routes that have not graduated to a dedicated canvas landing.
- `FounderWorkspaceTabs.jsx` preserves access to the detailed tools grouped under each founder workspace.
- `FounderValidatePage.jsx` owns the Validate evidence desk and hands off to the detailed Discovery editor.
- `FounderBuildDesk.jsx` owns the Build weekly operating desk and hands off to the detailed Execution, Roadmap, and Metrics editors.
- `FounderRaiseDesk.jsx` owns the A4 Raise landing: a selected-project, read-only capital and legal overview that hands off to the detailed Pitch, Capital, Legal, Data Room, and Liquidity tools.
- `FounderGrowDesk.jsx` owns the A5 Grow landing at `/build/team` for founders; `?mode=workspace` retains the detailed Talent workspace.
- `FounderNetworkDesk.jsx` owns the A6 Network overview at `/network` for founders. Workspace mode and all `tab`/`intro` deep links retain `NetworkPage`; the desk reads records only and hands off to those detailed tabs.
- `FounderResearchDesk.jsx` owns the A7 Research overview at bare `/signals` for founders. It reads approved market, signal, company, project, and legal-document sources without running AI or mutations; `/signals?mode=workspace` and signal deep links retain the detailed Signals workspace.
- The CSS files beside those components are intentionally route-scoped so the dense canvas layouts do not leak into legacy tools.

New founder canvas pages should use stored records only, preserve their complete hierarchy in empty and unavailable states, and keep detailed editing behavior in the existing backed tools.