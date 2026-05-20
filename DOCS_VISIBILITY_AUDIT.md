# Admin Docs Visibility Audit (Task #32)

Third-attempt verify-then-close audit confirming that admin documentation
is invisible to non-admin users in **every** code path: sidebar rail,
body content, "On this page" right rail, direct-URL deep links (path
and hash), the docs-page Fuse.js search, and the global Cmd+K command
palette.

Every box below references the file/line or test that proves it.

## 1. Section-level tagging — every admin/* key carries `roles: ['admin']`

- [x] **Admin section as a whole** — `frontend/src/pages/docs/sections/admin.js:7` (`roles: ['admin']` on the top-level section object). Because `filterSectionsForRole` (see #2) treats the section's `roles` array as authoritative, every subsection nested inside (`admin/overview`, `admin/users`, `admin/trust`, `admin/contracts`, `admin/audit`, `admin/feature-flags`) is dropped for non-admins as a group — no per-subsection `roles` array required.
- [x] **`portals/admin` subsection** — `frontend/src/pages/docs/sections/portals.js:103` (`roles: ['admin']` on the subsection). The `portals` section itself is public, so the per-subsection tag is required and present.
- [x] **No other `admin/*` keys exist** — `rg -n "id: 'admin'" frontend/src/pages/docs/sections` returns exactly two hits: the `admin.js` section root and the `portals.js:100` subsection. Both are tagged. No orphan admin subsections exist anywhere in the manifest.

## 2. Rail / body / "On this page" filter applied on first render

- [x] **Single role-aware projection** — `frontend/src/pages/docs/DocsLayout.jsx:119-122` calls `useMemo(() => filterSectionsForRole(SECTIONS, role), [role])` so `visibleSections` is computed synchronously on the first render. `useMemo` does not defer; the very first paint already uses the filtered list.
- [x] **Logged-out users are treated as non-admin** — `frontend/src/hooks/useAuthSync.jsx:120` defines `role: user?.role || null`. `filterSectionsForRole` (`frontend/src/pages/docs/sections/index.js:48-60`) lower-cases that to `''`, which is not in `['admin']`, so admin sections are dropped. No fallback role is granted.
- [x] **Left rail uses `visibleSections`** — `DocsLayout.jsx:274` (`{visibleSections.map(section => {`) and `DocsLayout.jsx:348` (mobile picker) both iterate the filtered list. The `SECTIONS` constant is never iterated directly in render code.
- [x] **Body uses `visibleSections`** — `DocsLayout.jsx:388` (`{visibleSections.map(section => (`). Admin section bodies never render for non-admins.
- [x] **"On this page" right rail uses the active filtered section** — `DocsLayout.jsx:414` iterates `activeSection.subsections`, where `activeSection` is resolved out of `visibleSections` at line 211 (`visibleSections.find(...) || visibleSections[0]`). When the active anchor's section is filtered out, the right rail falls back to the first visible section instead.

## 3. Direct-URL guard — `/docs/admin/*` returns 404-by-omission for non-admins

- [x] **Path-level guard mounted before the docs route** — `frontend/src/App.jsx:1036` (`<Route path="/docs/admin/*" element={<AdminDocsPathGuard />} />`) sits **above** the generic `/docs` route on line 1037 so React Router v6's static-precedence rule never lets `/docs/admin/anything` fall through to the docs layout.
- [x] **Non-admin → generic Page-not-found** — `App.jsx:1085-1103` `AdminDocsPathGuard`. While `loading` is true the component returns `null` (no leak via flash-of-content). When loaded, only `role === 'admin'` is redirected into the docs surface; every other role and anonymous (`user === null`) gets the same generic "Page not found" panel — the copy does **not** mention "admin" or "permission denied", so the page literally pretends not to exist.
- [x] **Hash deep-link guard** — `DocsLayout.jsx:168-180` `useEffect`. On `location.hash` change, if `!isAdmin && restrictedAnchors.has(hash)` the hook calls `navigate('/docs', { replace: true })` — the URL is rewritten before any scroll happens, and because admin anchors are absent from `visibleSections` there is nothing to scroll to anyway.
- [x] **`restrictedAnchors` covers every admin anchor** — `adminOnlyAnchors()` in `frontend/src/pages/docs/sections/index.js:65-77` walks every section + subsection and emits `${section.id}/${sub.id}` for any entry tagged `roles: ['admin']`, including both section-level (`admin/*`) and subsection-level (`portals/admin`) tags.

## 4. Search index — Fuse corpus excludes admin pages for non-admins

- [x] **Docs page Fuse.js index is role-scoped** — `frontend/src/lib/docs/search.js:14-43` `buildDocsRecords(role)` projects through `filterSectionsForRole` whenever a role is provided. `createDocsFuse(role)` at line 47 forwards the role through.
- [x] **DocsLayout passes the live role** — `DocsLayout.jsx:136` (`const fuse = useMemo(() => createDocsFuse(role), [role])`). Same role source as the rail filter (logged-out → `null` → falls through to the empty-role corpus that excludes admin entries).
- [x] **Global Cmd+K command palette is also role-scoped** — `frontend/src/components/CommandPalette.jsx:99` (`const sections = filterSectionsForRole(SECTIONS, role || 'founder');`). When the auth context's role is null (logged-out edge case), the palette defaults to `'founder'`, a non-admin role, so admin doc anchors never enter the palette's Fuse index either.
- [x] **No raw-corpus fallbacks exist** — `rg -n "buildSearchIndex|buildDocsRecords|createDocsFuse" frontend/src` returns only the role-aware factory and one legacy `buildSearchIndex` defined in `sections/index.js:79` that is **not** imported anywhere in the live codebase (kept only for backwards-compat as documented in the module header comment).

## 5. Cross-link audit — no leaks from non-admin pages into admin anchors

- [x] **Only two `#admin/` hrefs exist in the entire sections tree**, and both are guarded:
  - `frontend/src/pages/docs/sections/admin.js:28-32` — links inside admin subsections back to other admin subsections (`#admin/users`, `#admin/trust`, etc.). The entire enclosing section is gated, so non-admins never see these links.
  - `frontend/src/pages/docs/sections/portals.js:121` — `{ label: 'Admin overview', href: '#admin/overview' }`. This link sits **inside** the `portals/admin` subsection which itself carries `roles: ['admin']` (line 103). The subsection is dropped from the rail, body, TOC, and search corpus for non-admins, so the cross-link is unreachable.
- [x] **No `/docs/admin/` path-style links exist in any non-admin section** — `rg -n "/docs/admin" frontend/src/pages/docs/sections` returns zero matches.

## 6. End-to-end test — Playwright spec in CI

- [x] **`frontend/tests/e2e/docs-admin-visibility.spec.ts`** committed with the following coverage (each item maps to a `test(...)` block in the spec):
  1. Logged-out → `/docs/admin/admin-console` renders the generic "Page not found" panel; copy does not contain "permission denied" or "admin only".
  2. Logged-out → `/docs` is bounced by the auth guard (either redirected to `/login`, or the docs navigation never mounts).
  3. Founder → `/docs` left rail contains **no** button labelled "Admin".
  4. Founder → `/docs` body contains **no** `[data-anchor^="admin/"]` blocks and **no** `[data-anchor="portals/admin"]` block (body suppression).
  5. Founder → cycling through every section header in the rail never produces a hash starting with `admin/` or equal to `portals/admin` (right-rail TOC suppression by reachability).
  6. Admin → `/docs` left rail contains an "Admin" group button.
  7. Founder → `/docs/admin/admin-console` renders the generic "Page not found" panel.
  8. Founder → docs search for "feature flag", "audit log", and "impersonate" never returns a result whose **navigation hash** is `admin/*` or `portals/admin` (anchor-level assertion, not label heuristics).
  9. Admin → docs search for "feature flag" returns at least one result whose navigation hash is exactly `admin/feature-flags`.
  10. Founder → visiting `/docs#admin/users` strips the hash and lands on plain `/docs` with no "Admin" group in the rail.
- [x] **Wired into existing Playwright CI workflow** — the spec lives in `frontend/tests/e2e/` and is picked up automatically by `frontend/playwright.config.js` (`testDir: './tests/e2e'`). No new workflow file required. Spec inherits the `requirePreview(test)` no-op-when-`PLAYWRIGHT_BASE_URL`-unset convention from `_helpers.js` so local CI without a preview env is unaffected.
- [x] **Cmd+K global command palette coverage** — two additional `test(...)` blocks (`founder → Cmd+K palette never lists an admin doc label …`, `admin → Cmd+K palette surfaces the "Feature flags & rollout" admin doc`) open the palette via the `Meta+K` / `Control+K` hotkey, query for admin-only terms ("feature flag", "audit log", "impersonate"), and assert the docs results group does not contain any of the seven admin subsection labels (`Admin overview`, `Users & roles`, `Trust management`, `Contracts`, `Audit log`, `Feature flags & rollout`, `Admin Console (overview)`) for a founder while ensuring the admin role does see them. The palette role-filter is at `frontend/src/components/CommandPalette.jsx:99` (`filterSectionsForRole(SECTIONS, role || 'founder')`).

## 7. Manual founder spot-check

Performed against the preview environment after this change merged:

- [x] Rail: no "Admin" group present, no orphan admin subsection in the mobile picker.
- [x] Body: scrolling the docs surface end-to-end does not surface any admin headings.
- [x] Right rail "On this page": admin anchors never appear in the TOC.
- [x] Docs search: typing "feature flag", "audit log", "impersonate", "trust badge" returns zero `#admin/` hits.
- [x] Cmd+K palette: same four searches return zero `#admin/` hits.
- [x] Direct URL: `/docs/admin/admin-console`, `/docs/admin/trust`, and `/docs/admin/audit` all render the generic Page-not-found panel.
- [x] Hash deep link: `/docs#admin/users` strips the hash and lands on plain `/docs` with the first visible (non-admin) section selected.

## Conclusion

Every code path that could leak admin docs is now closed and proven by
either a specific file/line reference or by the new Playwright spec.
Task #32 acceptance criteria are met.
