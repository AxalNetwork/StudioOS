# frontend/src/hooks — shared React state

Cross-page state and browser-integration hooks. Anything used by exactly one
page belongs in that page instead.

| Hook | What it does |
| --- | --- |
| `useAuthSync.jsx` | The session: current user, role, tier. Most guards read this. |
| `useBranchDeployment.js` | S21's strip model for the signed-in licence administrator (D287): one memoised read of `/api/licence/mine` per user, shared by the strip above the top bar and the badge inside it, put through `../lib/branchNotDeployed.js`. A 404 is "administers none" and no strip; any other failure is reported and no strip. Stores nothing. |
| `useLicenceNeeds.js` | What waits on the licence's Administrator (D798's `/api/licence/mine/needs`), read once and shared by the Licences row's count pill and the Licences page's "Needs you" card (D800). `refreshLicenceNeeds()` reads again. |
| `useSpinoutLabState.js` | Enrolment and progress for the Spin-Out Lab. |
| `useSpinoutDeckFields.js` | Deck field values shared across lab tools. |
| `useIncorporationStatus.js` | Where an entity is in formation. |
| `useAiSpend.js` | Assistant spend, for the AI rail. |
| `useWebSocket.js` | The realtime connection. `onOpen({ reconnect })` runs on every open; `reconnect` is true from the second, the cue to re-read what a dropped socket missed (#4701). |
| `useKeyedRead.js` | #4701 — one read keyed to what it was asked about (period, company, deal). An answer for an earlier key or generation is dropped, another key shows loading rather than the previous key's data, a first failure is `unreadable`, and a failed background refresh keeps the data and sets `refreshError`. |
| `useInactivityTimeout.js` | Session idle handling. |
| `useEscapeClose.js` | Escape-to-close for drawers and modals. |
| `useScrollToHash.js` | Scrolls to the section a URL hash names once it has rendered (D571: the Practice zones' redirected sections). |
| `useForcedLightTheme.js` | Opts a surface out of dark mode (print and PDF views). |
