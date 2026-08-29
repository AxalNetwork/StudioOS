# frontend/src/hooks — shared React state

Cross-page state and browser-integration hooks. Anything used by exactly one
page belongs in that page instead.

| Hook | What it does |
| --- | --- |
| `useAuthSync.jsx` | The session: current user, role, tier. Most guards read this. |
| `useSpinoutLabState.js` | Enrolment and progress for the Spin-Out Lab. |
| `useSpinoutDeckFields.js` | Deck field values shared across lab tools. |
| `useIncorporationStatus.js` | Where an entity is in formation. |
| `useAiSpend.js` | Assistant spend, for the AI rail. |
| `useWebSocket.js` | The realtime connection. |
| `useInactivityTimeout.js` | Session idle handling. |
| `useEscapeClose.js` | Escape-to-close for drawers and modals. |
| `useForcedLightTheme.js` | Opts a surface out of dark mode (print and PDF views). |
