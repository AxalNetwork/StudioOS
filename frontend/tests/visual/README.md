# `frontend/tests/visual/`

<!-- index: none -->

This folder holds two D1511 suites: the harness suite just below, and the Worker-backed suite after it.

## Adding a spec

This README lists no files (D6472, #6472). A spec, seed or helper explains
itself in its own header comment: the decision or issue, the widths and themes
it runs at, what it seeds and whether it takes screenshots. Adding one adds its
file and nothing else; a table row or a paragraph here naming one file fails
`scripts/check-folder-docs.mjs`. A file whose name starts with `_` is a seed or
a helper that `server.ts` or a spec imports; seeds use made-up names.

## The harness suite

Built for D1511 (#3762, deck v2 A18). Visual regression and axe on the Pitch deck
editor, run by `frontend/playwright.visual.config.js` in the pinned container
of `.github/workflows/deck-visual.yml`. The harness mounts the real
`PitchEditor` with its reads stubbed. What it reads is `fixture.json`: the
model, every theme the Worker serves, the 17 structures, each aspect's Grid
reply and the accepted one-click deck. It is built from the Worker's modules by
`cloudflare-worker/test/deck_visual_fixture_d1511.test.ts`, which fails when
they change. The baselines are in `__screenshots__/`.

### Rules

- **A baseline comes from CI.** To redraw one on purpose, delete its PNG and
  push; the next run writes it and commits it for review. Never add one made
  on a laptop.
- **The fixture follows the Worker.** When a structure, a theme or the build
  changes, regenerate it with `UPDATE_VISUAL_FIXTURE=1` (see the test's header).
- **Nothing reaches a network.** Every read the editor makes is stubbed in
  `harness.jsx`, and the spec refuses any other `/api/` call.

## The Worker-backed suite (#4048) — the Pitch deck editor, drawn and scanned

Built for D1511 (#3762, deck v2 A18): visual regression and axe-core on the integrated
editor at HEAD (`/raise/pitch/edit`, `PitchEditor.jsx` with GridStage,
CardsStrip, AreaLightbox, InstructionBox, DeckToolbar/DeckMoreMenu, DeckAsk,
and StudioHome at `/raise/pitch`). `playwright.config.mjs` starts `server.ts`:
the built `docs/` plus the real Worker on the migrated schema in SQLite and the
fake AI binding. The baselines are committed in `__screenshots__/`, one PNG per
screenshot name. `fonts/` holds Inter, Roboto Mono and Space Grotesk (variable,
latin; OFL, licences beside them), so no page reaches Google Fonts.

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
