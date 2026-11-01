# frontend/tests/visual — the Pitch deck editor, drawn and scanned

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

## Run it

```
npm run build                      # repo root: the suite serves docs/
cd frontend/tests/visual && npx playwright test -c playwright.config.mjs
```

CI runs it in the `visual` job of `.github/workflows/ci.yml`, in the pinned
Playwright image whose Chromium drew the baselines. Locally, set
`PW_CHROMIUM_PATH` to that Chromium (build 1194) if your Playwright's own
browser is a different build.

## Rules

- **The axes are read, never counted.** Themes are `BASE_THEMES`' keys, sizes
  `ASPECTS`, structures `STRUCTURES`. A new theme adds baselines; it changes no
  spec.
- **Redraw a baseline only on purpose:** run with `--update-snapshots` in the
  pinned image and review every changed PNG in the PR.
- **Nothing leaves 127.0.0.1.** A screen that needs the network shows what it
  shows when the read fails, and that is what is drawn.
- `test-results/` and `playwright-report/` are output and are not committed.
