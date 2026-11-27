# `frontend/tests/qualification/`

D8688 part 2 (#8688). The role qualification's 390 px browser pass: each of
the five client roles (Admin, Founder, Investor, Advisor and Operating
Partner) and the pending-review control signs in as itself on the built SPA
and the real Worker, at 390 × 844, and walks its scenario on its own screens.
The API run in `scripts/qualification/` covers the same scenarios without a
browser; this pass fills that matrix's **390 px** column.

| File | What it is |
| --- | --- |
| `playwright.config.mjs` | One worker, no retries, a 390 × 844 viewport, UTC, reduced motion; starts `server.ts` fresh every run and clears the result file once |
| `server.ts` | The built `docs/` and the real Worker twice: HQ (the qualification's HQ world, `hqWorld()`) and branch `qa8688a` (its own database, HQ's pushed copy of the draft `XQ` licence, the principal and one local applicant). Same fixtures, guard and synthetic domain as the API run; every outside request refused and counted |
| `role_qualification_8688.spec.mjs` | One test per row. Start, draft, reload and next action on the role's own screens; nothing scrolls sideways; each next-action control is visible, enabled and fits 390 px. Writes `{ "<row id>": { result, evidence } }`, the `--phone` format |

## Run it

```
npm run build                                   # repo root: the pass serves docs/
cd frontend && npx playwright test -c tests/qualification/playwright.config.mjs
cd .. && node scripts/qualification/role-matrix.mjs --phone frontend/tests/qualification/test-results/role-phone-390.json
```

`PW_CHROMIUM_PATH` points Playwright at a Chromium it did not download.
`ROLE_QUALIFICATION_PHONE` moves the result file. It is not part of CI's
`visual` job (its server and database are separate on purpose, see the
config's header), so it runs where someone runs it.

## Rules

- **Synthetic only.** Every identity is under `qualification.invalid`; the
  server's guard refuses a database holding any other account. Nothing leaves
  127.0.0.1, and a row whose screens made the Worker attempt an outside
  request fails.
- **Evidence is publishable.** A failing row names the step and the check that
  failed, never a selector message, address, link or token.
- **Drafts are saved where the screen offers it.** The Operating Partner's
  proposal draft is written and saved in the browser. The other drafts are
  saved through the role's own session with the API run's request, and the
  browser checks what the role then sees.
- `test-results/` is output and is not committed.
