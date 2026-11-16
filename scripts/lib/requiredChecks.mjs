// #4107, #5973: main's required checks — the owner's ruleset "main: required
// checks" (2026-11-02, on #4107) — each named with the workflow whose job
// reports it. One list, read by `frontend/test/merge_queue_ci_4107.test.mjs`
// (which holds the workflows to it) and by `ciScorecard.mjs` (which finds the
// last required check of each merge-group candidate). When the ruleset
// changes, change it here.
export const REQUIRED = Object.freeze({
  'test:drift (full suite)': 'ci.yml',
  'worker (typecheck)': 'ci.yml',
  'frontend (build)': 'ci.yml',
  'api ↔ worker drift': 'ci.yml',
  'applied migrations unchanged': 'migration-immutability.yml',
  scan: 'gitleaks.yml',
});
