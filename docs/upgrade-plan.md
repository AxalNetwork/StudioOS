# Major-Version Dependency Upgrade Plan

**Owner**: Repo maintainers (AxalNetwork/StudioOS)
**Created**: 2026-05-06 (project Task #5)
**Target window**: next dedicated maintenance sprint after current product backlog clears (estimate: 2026-Q3 — pick a calendar week, not a fire-drill)

This document tracks the major-version Dependabot PRs that were intentionally held out of the routine weekly sweep, plus a retrospective record of the four majors that auto-merged cleanly during the Task #5 window.

---

## Status

### Already merged & verified clean (retrospective)

These four major-version PRs landed on `main` between Task #4 wrapping and Task #5 starting. Verified post-merge with worker `tsc --noEmit`, frontend `npm run build`, and `npm audit --omit=dev --audit-level=critical` (0 vulns on both packages):

| PR  | Package(s)                                                  | Bump            | Notes                                   |
|-----|-------------------------------------------------------------|-----------------|-----------------------------------------|
| #6  | `react`, `react-dom`, `react-router-dom` (frontend group)   | 19.0 → 19.2.6 / 7.1 → 7.15 | Build clean. No code changes.        |
| #11 | `jose` (worker)                                             | 5.10 → 6.2.3    | TS clean. JWT verify path unchanged.    |
| #13 | `typescript` (worker)                                       | 5.9 → 6.0.3     | `tsc --noEmit` clean under new defaults.|
| #16 | `recharts` (frontend)                                       | 2.15 → 3.8.1    | Build clean. Did NOT drop the lodash transitive that was supposedly pinning alerts — verify via `npm ls lodash` next time alerts are reviewed. |

### Intentionally deferred (still open)

Both PRs are tagged with the GitHub label `deferred-upgrade` and carry a tracking comment pointing back to project Task #5. Dependabot will continue to rebase them weekly.

#### PR #15 — `lucide-react` 0.469.0 → 1.14.0 (frontend)

- **Risk surface**: Icon library 0.x → 1.0. The 1.0 release renames or removes some icons; any import of a renamed/removed icon in `frontend/src/**/*.{jsx,tsx}` will break the build (or worse, render blank).
- **Migration plan**: 1) Grep every `from 'lucide-react'` import. 2) Cross-check each name against the [v1 changelog](https://github.com/lucide-icons/lucide/blob/main/CHANGELOG.md). 3) Rebuild + visually click-through every page that uses icons (≈ all of them).
- **Leverage**: Low — purely visual, no security alert tied to it. Defer is cheap.
- **Owner on resume**: see follow-up Task #6.

#### PR #12 — build group (`vite` 6 → 7, `@vitejs/plugin-react` major) (frontend)

- **Risk surface**: Build-tool majors are the highest blast radius we have. Vite 7 drops Node 18 support, refines ESM-only behaviour, and has plugin API tweaks. Cloudflare Pages uses the `docs/` output of `vite build` so a regression silently breaks production deploys.
- **Migration plan**: Read [Vite 7 migration](https://vite.dev/guide/migration.html); confirm CI Node baseline ≥ 20; run `npm run build` + `npm run dev` smoke; preview-deploy the resulting `docs/` to Cloudflare Pages before merging.
- **Leverage**: Medium — picking this up closes Dependabot alerts #4 (high) and #5 (medium) which currently cap vite at <6.4.2.
- **Owner on resume**: see follow-up Task #7.

---

## Operating rules

1. Do **not** auto-merge or close PR #15 or PR #12. The `deferred-upgrade` label is the signal to leave them alone.
2. Do **not** strip the `deferred-upgrade` label without first ticking off the migration plan above.
3. When the upgrade window opens, bump this doc with the dated outcome and remove the corresponding row.

## Index

- Project Task #5 — Defer major-version upgrades (this doc's source of truth)
- Follow-up Task #6 — Refresh icons (lucide-react)
- Follow-up Task #7 — Upgrade build tool (vite 7)
- `replit.md` Gotchas — 2026-05-06 Task #5 entry
