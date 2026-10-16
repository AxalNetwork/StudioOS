# scripts/claude-review — the advisory pull-request review

The effects half of `.github/workflows/claude-review.yml`, which reviews a pull
request's diff through the Anthropic Messages API and writes the findings, the
tokens and the estimated cost to the job summary. Its rules live in
`../lib/claudeReview.mjs`, and the run in `../lib/claudeReviewRun.mjs`. The
runbook, covering settings, enabling, rollback and cost, is
`documentation/operations/CLAUDE_REVIEW.md`.

| File | What it holds |
| --- | --- |
| `review.mjs` | git (a depth-1 fetch of the merge base and the diff), the GitHub REST API (the merge base, this month's review records) and the official Anthropic SDK, authenticated by workload identity federation (GitHub's OIDC token, fetched fresh for each exchange) or by the API key. It maps each SDK error class to a kind the summary can explain. Nothing the model writes reaches stdout except through escaped annotations. |
| `review.test.mjs` | The CLI's own tests, against the real SDK error classes and with no network. Run by the workflow's `selftest` job, after `npm ci` here. |
| `record.json`, `review.json` | Not files here: what `review.mjs` writes for upload. `record.json` holds the tokens, cost and outcome; `review.json`, after a successful review only, holds the validated findings for whoever fixes them. |
| `rates.json` | Dollars per million tokens per model, dated, used to estimate a review's cost and to bound it before the call. The `CLAUDE_REVIEW_RATES` repository variable overrides it per model. |
| `package.json`, `package-lock.json` | The one dependency, `@anthropic-ai/sdk`, pinned exactly. This is its own package so the review job installs one SDK rather than the root workspace, with `--ignore-scripts`. |

## The rule for adding to it

- **Decisions go in `../lib/claudeReview.mjs`,** where `npm run test:drift` tests them without a key. Only effects belong here.
- **No new dependency without a reason.** Bump the SDK to a release at least two weeks old, exactly, and update the lockfile in the same commit.
- **A review never writes.** It does not approve, merge, push, comment or fix. A change that needs a write permission is a separate workflow and a separate decision.
