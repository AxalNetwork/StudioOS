# `frontend/tests/visual/`

This folder holds two D1511 suites: the harness suite just below, and the Worker-backed suite after it.

## The harness suite

D1511 (#3762, deck v2 A18). Visual regression and axe on the Pitch deck
editor, run by `frontend/playwright.visual.config.js` in the pinned container
of `.github/workflows/deck-visual.yml`.

| File | What it is |
|---|---|
| `harness.html`, `harness.jsx` | The real `PitchEditor` (GridStage, CardsStrip, AreaLightbox, InstructionBox, DeckToolbar, DeckMoreMenu, DeckAsk), mounted with its reads stubbed and the fonts from the pinned `@fontsource` packages. No network. |
| `fixture.json` | What the harness reads: the model, every theme the Worker serves, the 17 structures, each aspect's Grid reply and the accepted one-click deck. Built from the Worker's modules by `cloudflare-worker/test/deck_visual_fixture_d1511.test.ts`, which fails when they change. |
| `harnessData.js` | The harness's data for one run, read from `fixture.json`. |
| `deck_editor.visual.spec.js` | The screenshots (17 structures × themes × 2 aspects, and the one-click deck) and the axe checks (light, dark, the keyboard path, the Ask dialog, phone and tablet). |
| `__screenshots__/` | The baselines. CI writes them in the pinned container and commits them; never add one made on a laptop. |
| `grow_overview_4862.spec.mjs` | #4862: sparse/active overview, Share lightbox, failed-read retry and read-only states at desktop and phone widths. |

| `template_previews_5218.spec.mjs` | #5218: New Deck and Gallery previews, saved versions, plan locks, template structure and visible-only loading at desktop and phone widths. |
| `revenue_completion_5039.spec.mjs` | #5039: Stream filtering, native invoice figures, governed dispute/due-date receipts, lazy history and checkout read-back at desktop, 834, 390 and dark; unknown replay and stale-period responses. |

### Rules

- **A baseline comes from CI.** To redraw one on purpose, delete its PNG and
  push; the next run writes it and commits it for review.
- **The fixture follows the Worker.** When a structure, a theme or the build
  changes, regenerate it with `UPDATE_VISUAL_FIXTURE=1` (see the test's header).
- **Nothing reaches a network.** Every read the editor makes is stubbed in
  `harness.jsx`, and the spec refuses any other `/api/` call.
## The Worker-backed suite (#4048) — the Pitch deck editor, drawn and scanned

D1511 (#3762, deck v2 A18): visual regression and axe-core on the integrated
editor at HEAD (`/raise/pitch/edit`, `PitchEditor.jsx` with GridStage,
CardsStrip, AreaLightbox, InstructionBox, DeckToolbar/DeckMoreMenu, DeckAsk,
and StudioHome at `/raise/pitch`).

| Path | What it is |
| --- | --- |
| `playwright.config.mjs` | One worker, no retries, fixed viewport, UTC, reduced motion; starts `server.ts` |
| `server.ts` | The built `docs/` plus the real Worker (`cloudflare-worker/src/index.ts`) on the migrated schema in SQLite and the fake AI binding; seeds the matrix and runs the one-click build |
| `_editor.mjs` | Sign-in, the pinned clock, local fonts for Google Fonts, every other outside request aborted |
| `editor.visual.spec.mjs` | 17 structures × `BASE_THEMES` × both slide sizes, the one-click deck, and the editor's states |
| `editor.a11y.spec.mjs` | Zero serious or critical axe violations in every state; the keyboard path and the dialog's focus |
| `fonts/` | Inter, Roboto Mono and Space Grotesk (variable, latin; OFL, licences beside them) |
| `__screenshots__/` | The baselines, committed. One PNG per screenshot name |
| `pricing_journey_4651.spec.mjs` | #4651: a plan chosen on Pricing through Back, another plan, the email link and the Google return to its checkout sheet, at desktop and phone width; no screenshots |
| `calendar_degraded_5202.spec.mjs` | #5202: one external calendar's read failing with a good credential — the agenda stands, the rail says Connected and "Events temporarily unavailable", and Retry re-reads that provider alone; desktop and phone, no screenshots |
| `approvals.a11y.spec.mjs` | D4814 (#4814, part 7): Approvals (Inbox, an item, Lanes, Decided, the three boards) at 1440 and 390 — zero serious or critical axe violations, no page wider than a phone, the keyboard path through ⋯, Assign and the sheets, 44px phone targets, the lane chart inside its box; part 8: the boards' selection bar and ⋯, and a last row's ⋯ clickable; no screenshots |
| `_approvals.mjs` | The reads Approvals makes, answered for that spec: the glance, inbox, item, weekly, Decided and the boards, as the Worker answers them; made-up names |
| `pitch_draft_recovery_5349.spec.mjs` | D5349: draft autosave, reload, offline recovery, stale revisions and storage refusal in Chromium at 1440 and 390 px, using a synthetic Worker-backed deck |
| `security.a11y.spec.mjs` | D4803 (#4803, #4800 §7): HQ › Security's seven workspaces at 1440, 768 and 390, light and dark — zero serious or critical axe violations, no page wider than its viewport; the workspace keys, the phone select and findings at 44 px, the revoke sheet's focus on a phone, and Eadwyn's security prompts; no screenshots |
| `_security_seed.ts` | What `server.ts` seeds for that spec, read through the real routes as a Super Admin: a failed restore drill, administrators without MFA, sessions, a deletion request near its date, ledger rows, a Trust Center draft, the backup heartbeats; made-up names |
| `hq_support_5035.spec.mjs` | D5035: keyboard decisions and focus restoration, history after reload, and the ticket queue and subsidiary matrix at 390 and 1280 pixels. |
| `public_nav_accessibility_5512.spec.mjs` | #5512: computed module-label contrast, Network Escape focus and Tab order, pointer/native-link behavior and mobile navigation. |

### Run it

```
npm run build                      # repo root: the suite serves docs/
cd frontend/tests/visual && npx playwright test -c playwright.config.mjs
```

CI runs it in the `visual` job of `.github/workflows/ci.yml`, in the pinned
Playwright image whose Chromium drew the baselines. Locally, set
`PW_CHROMIUM_PATH` to that Chromium (build 1194) if your Playwright's own
browser is a different build.

### Rules

- **The axes are read, never counted.** Themes are `BASE_THEMES`' keys, sizes
  `ASPECTS`, structures `STRUCTURES`. A new theme adds baselines; it changes no
  spec.
- **Redraw a baseline only on purpose:** run with `--update-snapshots` in the
  pinned image and review every changed PNG in the PR. A bare host draws text
  a shade differently and fails CI's exact comparison. From the repo root,
  after `npm run build`:
  `docker run --rm -e CI=1 -e PW_CHROMIUM_PATH=/ms-playwright/chromium-1194/chrome-linux/chrome -v "$PWD":/repo -w /repo/frontend mcr.microsoft.com/playwright:v1.56.1-noble npx --no-install playwright test -c tests/visual/playwright.config.mjs --update-snapshots`.
- **Nothing leaves 127.0.0.1.** A screen that needs the network shows what it
  shows when the read fails, and that is what is drawn.
- `test-results/` and `playwright-report/` are output and are not committed.
- `report_print_6094.spec.mjs`: #6094 native print document, audience boundary, light paper in both themes, cleanup/focus and print failure recovery.
