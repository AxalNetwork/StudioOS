# Claude review — advisory pull-request review on the Anthropic API

The `claude-review.yml` workflow reviews each pull request's diff through the
Anthropic Messages API and writes its findings to the job summary. It exists
to replace the **AI part** of GitHub Code Quality with a review whose cost is
measured per run and capped. It does **not** replace any deterministic check.

It ships **off**. Nothing runs and nothing is spent until an administrator
turns it on (§4).

**Decision record.** This was an owner request with no issue, and decision
numbers come only from an issue (AGENTS.md). So this runbook is the record
until Session 1 assigns a number.

## 1. Audit: what costs what today (2026-10-16)

| Component | What it is | What it bills |
|---|---|---|
| **GitHub Code Quality** (the dynamic `CodeQL - Code Quality / Analyze (…)` checks on every PR) | GitHub's managed quality analysis, enabled in repository settings. Not a file in this repository. | Licence: $10 per active committer per month since GA on 2026-07-20. Its CodeQL scans use **Actions minutes**. |
| **Code Quality AI**: the per-PR autofix suggestions, the "AI findings" on recently merged code, and the "Potential fix for 1 code quality finding" pull requests (about 40 opened here so far, e.g. #941, #942) | Copilot-generated fixes and detections | **GitHub AI Credits**, usage-based. Clicking *Commit suggestion* does not consume them. Generating the fixes does. |
| `codeql.yml` | This repository's own CodeQL workflow, with the `security-extended,security-and-quality` suites, summarised in the job summary (D672) | Actions minutes only |
| `semgrep.yml`, `gitleaks.yml`, `ci.yml` (build, typecheck, drift, audits, OG, LFS), `migration-immutability.yml`, the contract workflows | Deterministic checks | Actions minutes only |
| `claude-code.yml` | The `@claude` mention action | Anthropic **API** credits through `ANTHROPIC_API_KEY`, only when mentioned |
| Code Security AI (agentic autofix for code scanning, AI Scan for PRs) | Code Security products | Not in use: Code Security is off on this private repository (D672) |

What this means:

- **Turning off "AI findings" alone does not stop Code Quality's AI spend.** The fixes it generates on pull requests also consume AI Credits. GitHub offers no switch for that part on its own; the only way to stop it is to disable Code Quality on the repository. That also ends the $10-per-committer licence and Code Quality's Actions minutes.
- **The deterministic quality coverage survives that.** `codeql.yml` already runs the `security-and-quality` suite on every pull request, independently of Code Quality.
- **Only a GitHub administrator can change these settings.** A workflow cannot change billing or Code Quality settings.

**Claude Max subscriptions.** The two Max 20x subscriptions cover interactive Claude Code. They are **not** API credits, and nothing here may use a subscription login: the organization has subscription access to Claude Code disabled (`claude-code.yml`'s header says so). This review bills only to the API key's Console organization. To check what credit that organization has, see §6.

## 2. Architecture

```
pull_request (opened / reopened / synchronize / ready_for_review)
 ├─ selftest  (no secrets): the reviewer's own tests, against the PR's version of it
 └─ review    (only if vars.CLAUDE_REVIEW_ENABLED == 'true', same-repo PR, not Dependabot)
      1. check out the reviewer from the BASE commit (sparse), and the PR head as data
      2. merge base from GitHub's compare API; `git diff merge-base..head` (depth-1 fetches only)
      3. drop lockfiles, docs/, design/, binaries and generated files; order the rest
         high-risk first, then Worker, SPA, other, tests, prose; cut at the byte and file limits
      4. read this month's review records from the artifact list: skip a repeat, check the budget
      5. count input tokens, bound the worst-case cost, refuse if over a cap
      6. one Messages API call with a JSON-schema output; validate the answer against the diff
      7. job summary (always), annotations (opt-in), one usage-record artifact
```

| File | Role |
|---|---|
| `.github/workflows/claude-review.yml` | The workflow. Least privilege: `contents`, `pull-requests` and `actions`, all read-only. |
| `scripts/claude-review/review.mjs` | The effects: git, the GitHub REST API and the official SDK (`@anthropic-ai/sdk`, pinned exactly in its own `package.json` and lockfile). |
| `scripts/claude-review/rates.json` | Dollars per million tokens, dated. Used to estimate and to bound the cost. |
| `scripts/lib/claudeReview.mjs` | Every rule: config, event gate, diff parse, selection, prompt, schema, validation, cost, budget, ledger, reporting. |
| `scripts/lib/claudeReviewRun.mjs` | The run, start to finish, with every effect injected. |
| `scripts/lib/claudeReview.test.mjs`, `scripts/claude-review/review.test.mjs` | Tests, all with fakes or local classes. No key, no cost. |

**Security.**
- The workflow runs on `pull_request`, never `pull_request_target`. A fork's pull request gets no secrets, and both the job condition and the code skip forks and Dependabot.
- The key holder runs the **base commit's** reviewer, so a pull request cannot change the code that holds the key. The head checkout is data; nothing in it runs.
- Diff text, file text, the PR title and the PR body are fenced in tags carrying a per-run nonce. The system prompt treats them as untrusted and never as instructions.
- The model's answer is schema-validated. Every path and line it gives is checked against the diff. Its text is escaped before it reaches the summary or an annotation, so it can neither inject Markdown or HTML nor issue a workflow command.
- The diff and source are never logged, and the key is never printed.

## 3. Settings

Set these under *Settings → Secrets and variables → Actions*.

| Name | Kind | Default | Meaning |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | secret | — | Console API key. Already exists for `claude-code.yml`; a dedicated key in its own workspace is better (§6). |
| `CLAUDE_REVIEW_ENABLED` | variable | off | `true` runs the review. |
| `ANTHROPIC_MODEL` | variable | — (required) | Routine model ID. Suggested: `claude-sonnet-5-5`. |
| `ANTHROPIC_MODEL_HIGH_RISK` | variable | unset | Model for diffs touching migrations, SQL, workflows, `wrangler*.toml`, Worker auth, billing or middleware, or adding secret-like lines. Suggested: `claude-opus-5-5`. |
| `CLAUDE_REVIEW_EFFORT` | variable | `medium` | `low`, `medium`, `high`, `xhigh`, `max`, or `none` to omit it. |
| `CLAUDE_REVIEW_MAX_OUTPUT_TOKENS` | variable | 16000 | 1024–64000, thinking included. |
| `CLAUDE_REVIEW_MAX_DIFF_BYTES` / `_MAX_CONTEXT_BYTES` / `_MAX_FILES` / `_CONTEXT_LINES` | variable | 200000 / 80000 / 150 / 20 | Bounds on what is sent. |
| `CLAUDE_REVIEW_MAX_RETRIES` / `_TIMEOUT_SECONDS` | variable | 2 / 300 | SDK retries (at most 3) and per-request timeout. |
| `CLAUDE_REVIEW_MAX_COST_USD` | variable | 1.00 | Per-review cap on the **worst case** (counted input plus maximum output). Refused before calling if over. |
| `CLAUDE_REVIEW_MONTHLY_BUDGET_USD` | variable | 25 | Recorded spend this month plus this worst case may not pass it. `0` turns the check off. |
| `CLAUDE_REVIEW_MIN_CONFIDENCE` | variable | `medium` | Findings below it are counted but not shown. |
| `CLAUDE_REVIEW_ANNOTATIONS` | variable | off | `true` adds up to 10 annotations, only on lines inside the diff. |
| `CLAUDE_REVIEW_DRAFTS` | variable | on | `false` skips draft PRs. Agents open drafts, so this is on by default. |
| `CLAUDE_REVIEW_REFUSAL_FALLBACK` | variable | `default` | Server-side refusal fallback (`fallbacks: "default"`). If the model rejects it, the call is retried once without it. `off` disables it. |
| `CLAUDE_REVIEW_RATES` | variable | unset | JSON with the same shape as `rates.json`, merged per model. Needed for a model not listed there. |
| `CLAUDE_REVIEW_FAIL_ON_ERROR` | variable | off | `true` fails the step on a configuration or API error. Findings never fail it. |

## 4. Enable, disable, roll back

1. Merge the PR that adds the workflow. The key holder runs the base commit's code, so a review can only run once the reviewer is on `main`.
2. Create a dedicated Console workspace and an API key in it. Set a **workspace spend limit** in the Console; that is the hard, server-side cap (§6). Store the key as `ANTHROPIC_API_KEY`, or as a new secret and change the workflow's one reference.
3. Set `ANTHROPIC_MODEL` and, if wanted, `ANTHROPIC_MODEL_HIGH_RISK`, then set `CLAUDE_REVIEW_ENABLED=true`.
4. **Shadow period, about two weeks.** Leave Code Quality on. For each PR, compare the two:
   - Claude's summary against Code Quality's findings: actionable, false positive, missed;
   - the recorded cost against GitHub's AI-credit usage (*Settings → Billing → AI credits* / *Usage*).
5. Record the comparison, then ask the owner whether to turn Code Quality's AI off. That change is manual and is not made by this repository:
   - **AI findings only:** repository *Settings → Code security → Code quality → AI findings*, or the REST field `ai_findings_option: disabled`;
   - **all of Code Quality's AI and its licence:** disable Code Quality for the repository. `codeql.yml` keeps the deterministic quality queries.
6. **Disable** at any time with `CLAUDE_REVIEW_ENABLED=false`. The job then shows as skipped.
7. **Roll back** by re-enabling Code Quality (or AI findings) in settings, and by reverting the PR that added the workflow. Nothing else depends on it.

It is **not** a required check. Making it one is a separate, explicit decision, taken after the shadow comparison.

## 5. Cost

| Cost | Source | Where to see it |
|---|---|---|
| Anthropic API (this review) | tokens in and out, per run | Job summary *Usage* table; the usage-record artifact; Console *Usage* and *Cost* |
| GitHub Actions minutes (this review) | about 1 minute per run on `ubuntu-latest` | *Settings → Billing → Usage* |
| GitHub Code Quality licence | $10 per active committer per month | GitHub billing |
| GitHub AI credits (Code Quality AI) | per fix and per detection | GitHub billing, *AI credits* |

**Estimated per-review API cost** (`rates.json`, 2026-10-06; estimates only, the invoice is the authority):
- **Routine, Sonnet 5.5:** a typical PR (20K input tokens, 4K output including thinking) is about $0.08. A large one at the default limits (70K input, 8K output) is about $0.22.
- **High-risk, Opus 5.5:** about double those figures.

Volume drives the total. Every push to an open PR starts a review of the new head; identical inputs are not reviewed twice. **No saving is claimed until the shadow period has measured both sides.** The default $25 monthly budget is a pilot cap, not an estimate: if it is reached, reviews are refused, with the reason in the summary, until the next month or until an administrator raises it. Nothing switches keys, buys credit or turns on auto-reload.

## 6. Anthropic credits and spend

- **Credit balance:** Console → *Settings → Billing*. This shows prepaid API credits and any auto-reload setting; leave auto-reload off unless the owner decides otherwise. Max subscriptions do not appear here as API credit.
- **Usage and cost:** Console → *Usage* and *Cost*, filterable by workspace and API key. The Admin API's usage and cost reports give the same figures programmatically, with an Admin key.
- **Hard cap:** a workspace spend limit in the Console on the workspace holding this key. The Console stops requests past it, whatever this repository does.
- **Per run:** each review's summary shows its input, output and cache tokens, the model, the duration, the request id and the estimated cost. The `claude-review_v1_<month>_pr<N>_<key>_<status>_<micro-USD>` artifact keeps the same figures for 90 days.

## 7. Limitations

- The monthly ledger is the list of this repository's review-record artifacts. Reviews from another repository on the same key are not in it, nor is any record a person deletes. The Console spend limit is the authoritative cap.
- A cancelled run (a newer push arrived) may have spent tokens without writing a record.
- Excluded and over-limit files are not reviewed; each summary lists them.
- The review sees only the diff and bounded excerpts around it. It may miss an issue that needs a file the diff does not touch.
- The first PR that adds or changes the reviewer is reviewed by the base commit's version. The selftest job tests the new version, but no live call is made with it until it merges.
- The cost figures are estimates from a dated rate table. Keep `rates.json`, or the `CLAUDE_REVIEW_RATES` variable, current.
