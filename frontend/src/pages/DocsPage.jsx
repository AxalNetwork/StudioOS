// Task #2 (2026-05-08) — End-user docs rewrite. The legacy single-file
// DocsPage was replaced by a structured, tabbed docs surface organized
// by user journey (Getting Started → Spin-Out Lab → Build → Validate &
// Grow → Capital & Finance → Legal & Compliance → Network → Portal
// Experiences → Account → Troubleshooting). Implementation lives in
// `./docs/DocsLayout.jsx` + `./docs/sections/*`. Audience is end-users,
// not developers; no API/SDK references.
import DocsLayout from './docs/DocsLayout';

export default function DocsPage() {
  return <DocsLayout />;
}
