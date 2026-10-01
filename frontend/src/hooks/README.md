# frontend/src/hooks — shared React state

Cross-page state and browser-integration hooks. Anything used by exactly one
page belongs in that page instead.

| Hook | What it does |
| --- | --- |
| `useAuthSync.jsx` | The session: current user, role, tier. Most guards read this. |
| `useBranchDeployment.js` | S21's strip model for the signed-in licence administrator (D287): one memoised read of `/api/licence/mine` per user, shared by the strip above the top bar and the badge inside it, put through `../lib/branchNotDeployed.js`. A 404 is "administers none" and no strip; any other failure is reported and no strip. Stores nothing. |
| `useSpinoutLabState.js` | Enrolment and progress for the Spin-Out Lab. |
| `useSpinoutDeckFields.js` | Deck field values shared across lab tools. |
| `useIncorporationStatus.js` | Where an entity is in formation. |
| `useAiSpend.js` | Assistant spend, for the AI rail. |
| `useWebSocket.js` | The realtime connection. |
| `useInactivityTimeout.js` | Session idle handling. |
| `useEscapeClose.js` | Escape-to-close for drawers and modals. |
| `useForcedLightTheme.js` | Opts a surface out of dark mode (print and PDF views). |
