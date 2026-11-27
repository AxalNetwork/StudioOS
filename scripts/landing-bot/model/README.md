# scripts/landing-bot/model — the landing bot's model runner

The one place the landing bot calls a model (#6473, plan key C2). The conflict resolver, main repair and red-PR
repair each describe a task. The runner returns a patch, or nothing. It pushes, comments and labels nothing.

**The key and the repository's code never meet.** Each round is two jobs in
`.github/workflows/landing-bot-model-round.yml`:

- **`edit`** is in the `repair` environment, which accepts deployments from `main` only.
  - It has the model credentials, `contents: read` and `id-token: write` (for Claude's federation), and no App token.
  - It runs only this folder, checked out at the attempt's controller commit (below), and installs this folder's pinned SDKs with
    `--ignore-scripts`.
  - The commit being fixed is checked out as data.
  - The model gets six tools: `read_file`, `list_dir`, `search`, `read_data`, `replace_in_file` and `write_file`.
    It has no shell, no npm and no tests.
- **`verify`** has no environment, no secret and `contents: read`.
  - It re-checks the patch with main's code, applies it and runs the task's verify commands.
  - Each command gets an allowlisted process environment, with no token and no key.
  - If verify fails, its output goes to the next round as the data file `verify-failure.txt`. There are at most
    2 more rounds.

`.github/workflows/landing-bot-model.yml` validates the task, runs up to three rounds and publishes the first
patch that passed as the artifact `landing-bot-model-patch` (a patch file and a manifest, both JSON). Callers treat the
manifest as untrusted and re-check it with `patch.mjs`'s `checkPatch` before they use it.

## One controller revision per attempt (#8506)

`prepare` resolves the controller, this folder and the rest of `scripts/landing-bot`, to **one commit** (the
caller's own `github.sha`, since every caller runs on `main`; `main`'s head, read once, on a dispatch from
elsewhere). Every round's `edit` and `verify` check out that commit, never a branch name, and the runner's
`controller` output hands it to the caller's publish step, which checks out `github.sha` and refuses unless the
two are one commit.

The edit job writes a record file beside the patch (`record.mjs`): repository, task digest, pull request, target
head, controller commit, run id and attempt, round, and the digest of the patch file's exact bytes. `verify` and the
publish step each rebuild those fields from their own inputs and refuse any difference: another controller, another
head, changed bytes, or a patch from an earlier attempt of the same run. The edit job calls no model when it
cannot write a full record. The resolver then compares the PR's current head with the verified one: a moved head
is a definitive hand-back, as an exhausted keeper is (D8077), not a quiet skip. Main repair compares the record
with the runner's `head` output; main itself moves, and the manifest's before hashes keep a moved file safe.

## Providers

The review loop's accounts in its order (`documentation/operations/CLAUDE_REVIEW.md` §6a): primary Claude, Claude 2,
Claude 3, then Codex, then Gemini; or the order in `LANDING_BOT_PROVIDERS` (names `claude`, `claude-2`, `claude-3`,
`codex`, `gemini`). The manifest's `provider` names the account that made the patch.

**When the runner moves to the next provider.** Only when the provider could not work:
- authentication, permission, billing or quota (an Anthropic "credit balance" refusal or spend limit included);
- rate limit, overload or 5xx;
- federation failure;
- no credential configured.

Edits made before the failure are thrown away. A provider that ran and made a wrong fix, or none, ends the round:
the next provider is never asked to try again.

| Provider | Credential (in the `repair` environment) | Model variable | Default model |
| --- | --- | --- | --- |
| Claude | The four `ANTHROPIC_*_ID` variables (federation, preferred), else `ANTHROPIC_API_KEY` | `LANDING_BOT_CLAUDE_MODEL` | `claude-opus-5-5` |
| Claude 2 | `ANTHROPIC_API_KEY_2` | `LANDING_BOT_CLAUDE_MODEL` | `claude-opus-5-5` |
| Claude 3 | `ANTHROPIC_API_KEY_3` | `LANDING_BOT_CLAUDE_MODEL` | `claude-opus-5-5` |
| Codex | `OPENAI_API_KEY` | `LANDING_BOT_OPENAI_MODEL` | `gpt-5.3-codex` |
| Gemini | `GEMINI_API_KEY` | `LANDING_BOT_GEMINI_MODEL`, else `GEMINI_MODEL` | none: unset means skipped |

**Federation for Claude.** It needs its own rule. A job in the `repair` environment carries the subject
`repo:AxalNetwork/StudioOS:environment:repair`, which the review's pull-request rule refuses. Set the four IDs as
variables of the `repair` environment: those override the repository variables of the same names, for that
environment only.

## Caps

`HARD` in `task.mjs` holds the caps. A caller may ask for less, never more. Raising a cap means editing that file,
and the owner lands it.

| Cap | Limit |
| --- | --- |
| Model calls per round | 30 |
| Minutes per edit round | 20 |
| Rounds | 3 |
| Allowed files | 40 |
| Verify commands | 6 (`node`, `npm` or `npx` only, run without a shell) |
| Data | 200 KB |

Every allowed file must also clear `pathGuard` in `../rules.mjs`, so no task can let the model edit:
- a protected path;
- a file that `merge-policy.mjs` rates T2;
- an existing test.

**Daily spend** (`LANDING_BOT_DAILY_MODEL_RUNS`) is the caller's check, through `budget()`, before it calls the
runner.

## Merge mode (#6475)

A task with `merge_sha` (and `head_sha`) asks the runner to edit a merge that has not happened yet:

- the round checks out the branch with its history (`filter: blob:none`);
- a step before `edit` and before `verify` runs `stage.mjs` in its own process: it merges `merge_sha` with the
  branch keeper's git settings and main's merge rules only, leaves the conflict markers in the tree, and writes a
  report;
- `edit.mjs` and `verify.mjs` refuse unless the report is that merge and its conflicted files are exactly the
  task's allowed files (`stageProblems` in `task.mjs`);
- a patch must resolve every allowed file and may leave no conflict marker (`checkChanges(..., { resolving: true })`).

The staging step holds no model credential: the keys are set only on the `Edit` step. The modules the keyed step
loads still start no process; staging never runs inside them.

## The rule for adding to it

- A module the `edit` job loads never imports `child_process`; the test reads every one.
- A new tool goes in `workspace.mjs`'s `TOOL_SPECS` and is read-only, unless it only writes an allowed file into
  the overlay.
- Tests: `frontend/test/landing_bot_model_6473.test.mjs`, with stub providers.
