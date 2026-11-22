# scripts/ops — read-only checks of settings no pull request can make

The admin slot (`slot:chatgptpro`) changes consoles — GitHub rulesets,
environments, Apps, runner groups, cloud accounts — and records each change in a
STATUS. The scripts here compare those live settings with what the repository
says they should be. **They read; they never change a setting.**

| File | What it does |
| --- | --- |
| `check-github-admin.mjs` | D8082 (#8082): parses `documentation/operations/GITHUB_ADMIN_BASELINE.md`, reads the live rulesets, repository settings, Actions permissions, organisation baseline, environments, App installations and runner groups through REST GETs only, prints the diff, and with `--file-issues` files or updates one `slot:chatgptpro` issue per drifted setting. Run weekly by `.github/workflows/admin-drift.yml`. Fails closed when its token is missing or cannot read an expected setting. |
| `check-github-admin.test.mjs` | Its fixtures for each section (match, drift, to be recorded, missing permission), one issue per drift, update on repeat and no secret-shaped value in an issue. CI runs it through `frontend/test/admin_drift_8082.test.mjs`; locally `node --test scripts/ops/check-github-admin.test.mjs`. |

## Adding a check

One file per console, its test beside it, and a `frontend/test/` file that
imports the test so CI runs it. A check that needs a credential reads it in a
job that names a protected environment and has no write token, and gets a row
in `documentation/operations/production-credential-inventory.json`.
