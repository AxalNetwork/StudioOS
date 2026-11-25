# Merge Control policy check

What the `merge-control/policy` check is and what each tier means. It also covers what a person does with `action_required`, what is not built yet, and how to stop the service. Part of #5620 (scope item 8), written for #5991.

## Status: code on main, not live

- **Built:** the classifier (D5620, #6368) and the code that posts the check with one audit row per decision (D5990, #8352).
- **Not done:**
  - The Merge Control App's deployment, its `checks: write` grant and its `pull_request` subscription are owner steps on #5618.
  - Until they are done, no `merge-control/policy` check appears on any pull request or merge group.
- **Not a required check yet:**
  - It is not one of the `main` ruleset's required contexts.
  - Adding it, pinned to the App's integration id, is #5500's change.
  - #5500 makes it only after #5501 agrees the context list.
  - Until then the check is information. It blocks nothing.
- **The advisory `landing policy` workflow** (`landing-policy.yml`) is separate. It runs the same classifier inside Actions. This check exists so that one decision is computed outside the tree under test (#5620 "Why").

## What the check is

[Merge Control](../../merge-control/README.md) is a separate Worker behind its own GitHub App, with no StudioOS code, D1 or deploy token. For each head it is asked about, it does three things:

1. It reads GitHub's compare of the head against its base, and the head commit's tree (for file modes).
2. It classifies the changed files with the classifier `scripts/merge-policy.mjs` also uses. It is bundled from [`merge-control/src/lib/classify.mjs`](../../merge-control/src/lib/classify.mjs). No model is called.
3. It posts one completed check run named `merge-control/policy` on that head SHA. The run gives:
   - the tier;
   - the conclusion;
   - every reason;
   - the `policy_version` (the deployed commit, D5620).

[`merge-control/src/policyCheck.ts`](../../merge-control/src/policyCheck.ts) and [`repoControl.ts`](../../merge-control/src/repoControl.ts) hold this behaviour. [D5990](../architecture/decisions/D5990.md) records it.

## Which events post it

| GitHub event | Head | Base |
|---|---|---|
| `pull_request` `opened`, `synchronize`, `reopened` | the pull request's head SHA | the pull request's base SHA |
| `merge_group` `checks_requested` | the merge group's `head_sha` | the merge group's `base_sha` |

- **One decision per head:** each head SHA gets one decision per `policy_version`. A redelivery or a restart re-posts the stored decision and never classifies again, so one SHA never gets two conclusions under one policy.
- **A new decision:** a new head (a push) or a new deploy gives one.

### What is ignored

Labels, comments and reviews never change the check. These deliveries carry no SHAs and decide nothing:
- every other `pull_request` action (`labeled`, `edited` and the rest);
- `issue_comment`;
- `pull_request_review`, an approval included;
- `merge_group` `destroyed`.

A `destroyed` delivery keeps its own job, cancelling the destroyed group's runs (D5618).

## The tiers

The tier is the highest any changed file reaches. The examples below are real outputs of `classify` in `scripts/merge-policy.mjs`.

| Tier | Meaning | Example |
|---|---|---|
| **T0** | Documentation, leaf UI (`frontend/src/components`, `icons`, `styles`) or an added test file. Lands under the policy without a person (D5605 row 6). | Editing `documentation/operations/DEPLOY.md` gives `T0: documentation or leaf UI: documentation/operations/DEPLOY.md`. |
| **T1** | Source in a named folder, or an edit to an existing test whose diff is readable and whose test and assertion counts do not drop (D6679). Also lands without a person. | Editing `cloudflare-worker/src/routes/research_markets.ts` gives `T1: named source folder: …`. |
| **T2** | Everything the owner lands (D5605 row 6). | A new `cloudflare-worker/sql/migrations/…` file gives `T2: protected path: …`. Deleting `frontend/test/x.test.mjs` gives `Test deleted or renamed: …`. |

A file is T2 when it is any of these:
- a privileged path, the one list in `classify.mjs` (D8067);
- a path whose name looks sensitive (auth, billing, money and the like);
- a path in no named folder.

The change is also T2 when it does any of these:
- changes a test baseline or ledger, or a suite shard declaration;
- deletes or renames a test, or drops a test's or assertion's count;
- adds `skip`, `todo` or `only` to a test;
- changes a timeout;
- touches binary content, a symlink or a submodule.

### The conclusion

- **`success`:** only for a completed classification of T0 or T1.
- **`action_required`:** everything else, with tier T2 and the reasons. A T2 merge-group head is always `action_required` and carries the reason "owner sign-off is not built yet (#5620 items 4 and 5)".

## What `action_required` asks a person to do

- **Read the check's reasons first.** Each one names the file and the rule it hit.
- **A real T2 change** (a migration, a privileged path, a test that loses coverage): the owner lands it, as D5605 row 6 says. Nothing in the check can be satisfied by a label, a comment or an approving review.
- **A reason the change did not mean to cause** (a dropped assertion, a changed timeout, an edited baseline): fix the branch and push. The new head gets a new decision.
- **A failure reason** ("GitHub compare unavailable", "evaluation exceeded 15000 ms", a truncated list): this is not about the change. See "Fail closed" below.

## Sign-off: not built yet

Owner sign-off is **not built yet**. There is no `signoff.ts` and no sign-off route on main, so nothing turns a T2 head into `success` today.

What #5620 specifies for it (scope items 4 and 5):
- **`signoff.ts`:** an owner-only route behind Merge Control's owner authentication (#5618).
- **What it stores:** `{pr, head_sha, actor, policy_version, at}`.
- **What it posts:** `success` for that SHA only. A new push needs a new sign-off.
- **What it ignores:** labels, comments and reviews.
- **The merge queue:** a T2 `merge_group` head passes only when its pull request has a sign-off for the enqueued head SHA.

This section is replaced by the real route once that part of #5620 merges.

## Break-glass

The emergency path is [D5605 row 1](../architecture/decisions/D5605.md): "Remove bypass actors. In an emergency, the owner edits the ruleset." The evidence of applying and exercising it is on [#5500](https://github.com/AxalNetwork/StudioOS/issues/5500). Merge Control has no override of its own.

## Fail closed

An error never posts `success`:
- **Evaluation errors** are T2 `action_required` with the cause as the reason. These include:
  - a compare or tree read that fails or times out (15 seconds);
  - a compare list at GitHub's 300-file cap;
  - a file with no patch;
  - a truncated tree;
  - a malformed response;
  - any exception.
- **Errors before the decision:** an error creating the GitHub client, or a timeout before it, posts nothing.
- **A posting error** marks nothing as posted. The queue retries the delivery, and the retry posts the same stored conclusion.
- **A stopped service:** a Worker that is not running posts nothing.
- **Once the check is required:** a missing check blocks a merge. It never passes one.

Every decision writes one `policy` row to Merge Control's audit table. SQLite triggers abort any `UPDATE` or `DELETE` on that table, so the audit is append-only (D5990).

## Stopping the service: the kill switch

The kill switch is **on by default**. While it is on, the policy path makes no GitHub call and posts no check. The routes are in the [Merge Control README](../../merge-control/README.md) and use the owner's Bearer token:

| Action | Route |
|---|---|
| Stop posting | `POST /switch` with body `{"on": true}` |
| Resume posting | `POST /switch` with body `{"on": false}` |
| Read the state | `GET /status` (`killSwitch`, the last delivery, the audit counts and `policy_version`) |

Each switch writes an audit row. Turning the switch off for the first time is a #5618 owner step, after the preview shows that no check is posted while it is on.

## Related

- [#5600](https://github.com/AxalNetwork/StudioOS/issues/5600) for the landing tiers and [D5605](../architecture/decisions/D5605.md) for the owner's landing decisions.
- [D5618](../architecture/decisions/D5618.md) for the App and Worker, and [D5620](../architecture/decisions/D5620.md) for the classifier and `evaluate`.
- [D5990](../architecture/decisions/D5990.md) for the check run and its audit.
- #5500 for the ruleset, #5501 for the context list, and #5620 for sign-off.
