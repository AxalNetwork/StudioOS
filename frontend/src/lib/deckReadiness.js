// Task #42 — pure decision for the Spin-Out deck pre-flight readiness panel.
//
// Kept as a standalone, side-effect-free function so the draft/ready logic is
// unit-testable WITHOUT a React harness (the repo has no component test runner)
// and so the UI cannot drift back to deriving "ready" from gaps alone.
//
// The export marks a file as DRAFT when `programDay < 28` OR there are gaps
// (see cloudflare-worker/src/services/decks/spinoutDeckData.ts). The panel MUST
// honor the same `draft` flag — a deck with zero gaps can still be a draft while
// the founder is mid-program. Returns one of:
//   'loading' — preview in flight, nothing to show yet
//   'gaps'    — draft, sections still empty (show the checklist)
//   'draft'   — draft, every section filled but program not complete
//   'ready'   — not a draft and no gaps (safe to export final)
//   'hidden'  — nothing to render
export function deckReadinessState({ previewLoading, deckPreview } = {}) {
  if (deckPreview) {
    if (Array.isArray(deckPreview.gaps) && deckPreview.gaps.length > 0) return 'gaps';
    if (deckPreview.draft) return 'draft';
    return 'ready';
  }
  if (previewLoading) return 'loading';
  return 'hidden';
}
