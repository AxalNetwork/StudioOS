# Major-Version Dependency Upgrade Plan

**Owner**: @AxalNetwork repo maintainers — primary: whoever picks up follow-up Tasks #6 (lucide) and #7 (vite). Escalation: repo admin team.
**Created**: 2026-05-06 (project Task #5)
**Target window**: **week of 2026-07-13** (start of 2026-Q3, first full week after US Independence Day). Both deferred PRs to be merged or explicitly re-deferred (with new written rationale) by **2026-07-17**. This is a hard date, not an estimate; if the window slips, file a new dated entry below explaining why and pick a new specific week.

## Scope reconciliation (read this first)

Project Task #5 originally listed **five** major-version PRs to defer: #6 (react), #11 (jose), #13 (typescript), #16 (recharts), #15 (lucide-react), and #12 (build/vite). Between Task #4 wrapping and Task #5 starting, **four of those PRs (#6, #11, #13, #16) were auto-merged into `main` by Dependabot** with all CI checks green. Reverting four already-merged, currently-passing major upgrades was rejected as actively harmful: the worker `tsc --noEmit` and frontend `vite build` both pass, both `npm audit --omit=dev --audit-level=critical` runs report 0 vulnerabilities, and the deployed prod worker is unaffected (worker bumps are typecheck-only until next `wrangler deploy`).

**Effective Task #5 scope is therefore the two PRs that are still open: #15 and #12.** This doc records that reconciliation explicitly so the next session does not re-litigate it.

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
