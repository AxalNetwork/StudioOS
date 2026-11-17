# scripts/scan-remediation — code scanning alerts to trackers and fixes

D6935 and D6935-p2. Two workflows run this code, both from `main`:

- `scan-remediation.yml` reconciles each open default-branch alert with one tracker issue. It does this after a
  scanner upload on main, every two hours, or for one alert on request. For a CodeQL alert it prepares a classic
  Autofix. For an alert no Autofix can fix it offers the alert to the model fallback, when that is switched on.
- `scan-remediation-model.yml` is that fallback for one alert. It plans a task, runs the landing bot's model runner
  (primary Claude, Claude 2, Claude 3, then Codex), re-checks the patch and opens a draft PR into main.

<!-- files:begin -->
<!-- files:end -->

## Rules for adding here

- Never write an alert's text into an issue, PR, commit or log: alerts are private, trackers are public. A tracker
  carries the alert number and link only. A model task carries the finding as data, never as instructions.
- A tracker closes only when a scan of `main` reports the alert fixed, never on a PR merge.
- Never overwrite a branch: `alert-fix-<n>` and `alert-autofix-<n>` with work on them belong to whoever made it.
- A model-made change is a draft PR labelled `model-edited`, and the owner submits it to the merge queue.
- Tests sit next to the code (`*.test.mjs`). `frontend/test/scan_remediation_6935.test.mjs` imports them, so the
  frontend suite runs them.
