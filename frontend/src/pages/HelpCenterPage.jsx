// Task #2 (2026-05-08) — End-user docs rewrite. The legacy single-file
// DocsPage was replaced by a structured, tabbed docs surface organized
// by user journey (Getting Started → Spin-Out Lab → Build → Validate &
// Grow → Capital & Finance → Legal & Compliance → Network → Portal
// Experiences → Account → Troubleshooting). Implementation lives in
// `./docs/DocsLayout.jsx` + `./docs/sections/*`. Audience is end-users,
// not developers; no API/SDK references.
//
// Task #103 (2026-09-07) — this surface IS the Help Center, and now says so.
// It was mounted at `/docs` and called DocsPage while `/help` held the ticket
// tracker; the Help Center design describes this corpus, not that tracker.
// `/help` mounts this page, `/docs` redirects into it, and the ticket flow
// moved down to `/help/tickets`. The corpus, the search index, the anchors
// and the role filtering are unchanged — only the address and the framing.
//
// D599 (#1280) — built to the canvas. `/help` is the home (H1) and every guide
// has its own page at `/help/<area>/<guide>` (H2); this one component serves
// both, reading which from the path. `#<area>/<guide>` still opens the guide.
import DocsLayout from './docs/DocsLayout';

export default function HelpCenterPage() {
  return <DocsLayout />;
}
