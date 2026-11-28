# GitHub admin baseline (D8082)

**What the admin slot (`slot:chatgptpro`) has set in the consoles, written down
so a machine can check it every week.** No pull request can change a ruleset,
an environment, an App or a runner group; the admin slot does that in a browser
and records each change in a STATUS on its issue (#8060 to #8066, tracker
#8059). This file is the mirror of those records, and
`scripts/ops/check-github-admin.mjs` compares it with the live values every
Monday (`.github/workflows/admin-drift.yml`).

## How to read and change this file

- Each table row is one setting. The first cell is the setting's key, the
  second the **expected** value the check compares. The third cell is what the
  admin issue planned; it is context and is never compared.
- **`to be recorded`** means the admin slot has not reported the value yet.
  The check skips that row (it prints the live value beside it, so the admin
  slot can copy it here), and never files an issue for it.
- When a STATUS lands on #8060 to #8066, a coding slot copies each value into
  the Expected cell, in backticks, in a pull request. A list is written
  comma-separated in any order (the check sorts it); `none` is an empty list,
  `n/a` a setting that does not apply, `absent` a named thing that must not
  exist.
- A drift files, or updates, one issue per key, labelled `slot:chatgptpro` and
  `state:ready`. Either the console goes back to this file, or this file
  changes to the console's value in a reviewed pull request.
- Names and values only. No secret, token, account id, subscription or tenant
  id, internal host or personal account belongs in this file. Reviewers are
  written as a count and a type, never a person.

The check reads with a fine-grained, read-only token whose secret name is
`ADMIN_DRIFT_READ_TOKEN` in the `production-monitoring` environment (D8754). #8063 has not
yet reported a credential name, so this name is the one D8082 proposes; the
admin slot provisions it (repository **Administration: read**, **Environments:
read**, **Secrets: read** and **Variables: read** for names only, organisation
**Administration: read** and **Self-hosted runners: read**). If the token is
missing or cannot read a setting this file expects, the run fails and says
which; it never reports "no drift" for a value it could not read.

## Rulesets (#8060)

D5605 rows 1 to 4. The `main` ruleset carries the merge queue; the platform
paths ruleset requires the owner's review for the privileged path list (#8067
keeps that list in one place).

Mirrored from the #8060 STATUS of 2026-11-21 (phase 1, D8060). The live name of
the `main` ruleset is `main: required checks`, so its keys use that name: the
check keys a ruleset by its live name, and the STATUS asks that the live rule
is not renamed to fit a placeholder. The one row still keyed
`ruleset[main]`, `required_status_checks`, belongs to #8641 (the seventh
check, `Dependency Review`, was added on 2026-11-23; the six the STATUS
recorded are out of date); #8641 fills it under the live name. The disabled
`Code Quality Copilot review for default branch` ruleset is listed because it
exists. No `platform paths` ruleset exists yet (phase 2 waits on #8061), so its
rows stay to be recorded and `rulesets.names` drifts, as it should, the day it
is created. The queue's build concurrency (`5`), minimum group (`1`), wait to
meet the minimum (`5` minutes) and status-check timeout (`90` minutes) were
applied too, but the check does not read them yet, so they are recorded in
D8060 rather than as rows here (a row the check cannot read fails the run).

| Setting | Expected | Planned by the admin issue | Recorded by |
| --- | --- | --- | --- |
| `rulesets.names` | `Code Quality Copilot review for default branch, main: required checks` | `main`, `platform paths` | #8060 |
| `ruleset[Code Quality Copilot review for default branch].enforcement` | `disabled` | left disabled | #8060 |
| `ruleset[main: required checks].enforcement` | `active` | `active` | #8060 |
| `ruleset[main: required checks].target` | `branch` | `branch` | #8060 |
| `ruleset[main: required checks].include` | `~DEFAULT_BRANCH` | the default branch | #8060 |
| `ruleset[main: required checks].exclude` | `none` | none | #8060 |
| `ruleset[main: required checks].bypass_actors` | `none` | `none` (after the owner's go on #8060) | #8060 |
| `ruleset[main: required checks].rules` | `deletion, merge_queue, non_fast_forward, pull_request, required_status_checks` | pull request, merge queue, required status checks, non fast-forward, deletion | #8060 |
| `ruleset[main].required_status_checks` | to be recorded | the six checks the deploy admission job waits for | #8060 |
| `ruleset[main: required checks].strict_required_status_checks` | `false` | as D5605 | #8060 |
| `ruleset[main: required checks].pull_request.required_approving_review_count` | `0` | `0` (owner review is the platform paths ruleset's) | #8060 |
| `ruleset[main: required checks].pull_request.require_code_owner_review` | `false` | `false` | #8060 |
| `ruleset[main: required checks].pull_request.dismiss_stale_reviews_on_push` | `false` | `false` | #8060 |
| `ruleset[main: required checks].pull_request.require_last_push_approval` | `false` | `false` | #8060 |
| `ruleset[main: required checks].merge_queue.merge_method` | `SQUASH` | `SQUASH` | #8060 |
| `ruleset[main: required checks].merge_queue.max_entries_to_merge` | `5` | `5` (D5605 row 4) | #8060 |
| `ruleset[main: required checks].merge_queue.grouping_strategy` | `ALLGREEN` | as D5605 | #8060 |
| `ruleset[platform paths].enforcement` | to be recorded | `active` | #8060 |
| `ruleset[platform paths].target` | to be recorded | `branch` | #8060 |
| `ruleset[platform paths].include` | to be recorded | the default branch | #8060 |
| `ruleset[platform paths].bypass_actors` | to be recorded | `none` | #8060 |
| `ruleset[platform paths].rules` | to be recorded | pull request with code owner review | #8060 |
| `ruleset[platform paths].pull_request.required_approving_review_count` | to be recorded | `1` | #8060 |
| `ruleset[platform paths].pull_request.require_code_owner_review` | to be recorded | `true` | #8060 |
| `ruleset[platform paths].pull_request.dismiss_stale_reviews_on_push` | to be recorded | `true` | #8060 |
| `ruleset[platform paths].file_paths` | to be recorded | `.github/**`, `wrangler.toml`, `cloudflare-worker/sql/migrations/**`, `scripts/merge-policy.mjs`, `scripts/landing-bot/**`, `scripts/ci/**`, `merge-control/**`, `AGENTS.md`, `CLAUDE.md`, `.github/CODEOWNERS`, lockfiles | #8060 |

## Repository settings (#8060, #8062)

Mirrored from the #8060 and #8062 STATUS records of 2026-11-21 (D8060, D8062).
`repo.secret_scanning` stays to be recorded: the #8062 record lists push
protection as on but does not report secret scanning itself.

| Setting | Expected | Planned by the admin issue | Recorded by |
| --- | --- | --- | --- |
| `repo.allow_auto_merge` | `true` | `true` (D5605 row 3) | #8060 |
| `repo.allow_update_branch` | `true` | `true` (always suggest updating branches) | #8060 |
| `repo.delete_branch_on_merge` | `true` | `true` | #8062 |
| `repo.has_wiki` | `false` | `false` | #8062 |
| `repo.has_discussions` | `false` | as it is | #8062 |
| `repo.secret_scanning` | to be recorded | `enabled` | #8062 |
| `repo.secret_scanning_push_protection` | `enabled` | `enabled` | #8062 |
| `repo.dependabot_security_updates` | `enabled` | `enabled` | #8062 |
| `repo.private_vulnerability_reporting` | `true` | `true` | #8062 |

## Actions (#8062)

Mirrored from the #8062 STATUS of 2026-11-21 (D8062). The allowlist is the
corrected one (17 full references, saved by 19:17 UTC), not the 14-entry list
first saved: GitHub matches a pattern against the whole `uses:` string, so a
sub-action such as `actions/cache/restore` needs its own entry. Re-checked on
2026-11-27 against every `uses:` of `.github/workflows/*.yml` on main: each of
the 16 directly used references is listed, and `oven-sh/setup-bun` is the one
the pinned `anthropics/claude-code-action` calls from its own `action.yml`.
The only references not in the list are this repository's own reusable
workflows (`./.github/workflows/…` and
`AxalNetwork/StudioOS/.github/workflows/capacity-planner.yml@…`), which the
`selected` policy allows as the owner's own. A workflow that bumps a pin, or
adds an action, needs the admin slot to add the new reference first, and this
row to change with it.

| Setting | Expected | Planned by the admin issue | Recorded by |
| --- | --- | --- | --- |
| `actions.enabled` | `true` | `true` | #8062 |
| `actions.allowed_actions` | `selected` | `selected` | #8062 |
| `actions.selected.github_owned_allowed` | `false` | as entered (both broad allowances off, D8062) | #8062 |
| `actions.selected.verified_allowed` | `false` | as entered | #8062 |
| `actions.selected.patterns_allowed` | `actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9, actions/cache/save@55cc8345863c7cc4c66a329aec7e433d2d1c52a9, actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1, actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510, actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294, actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333, actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3, actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1, actions/setup-python@6d4fd22b20465ccc0f7354476588e8df7c9ca0e0, actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9, anthropics/claude-code-action@ec7c223ff45a0763d3d5e530c74403d14f8ddd10, astral-sh/setup-uv@68559e99cc807c1eb7e9238fd43a15bba460eec2, github/codeql-action/analyze@33d7b85da1a04171e211befe2c739303b9a4c066, github/codeql-action/init@33d7b85da1a04171e211befe2c739303b9a4c066, github/codeql-action/upload-sarif@33d7b85da1a04171e211befe2c739303b9a4c066, ossf/scorecard-action@23f22cd43608bae7a1f1fa2603d7314dee9538a5, oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6` | every `uses:` of `.github/workflows/*.yml`, pinned at its SHA | #8062 |
| `actions.sha_pinning_required` | `true` | `true` (require full-length SHA) | #8062 |
| `actions.workflow.default_permissions` | `read` | `read` | #8062 |
| `actions.workflow.can_approve_pull_request_reviews` | `false` | `false` | #8062 |
| `actions.fork_pr_approval` | `all_external_contributors` | `all_external_contributors` | #8062 |

## Organisation (#8062)

Mirrored from the #8062 STATUS of 2026-11-21 (D8062). Public repository
creation was not changed (the console locks it; GitHub documents the
restriction under Enterprise Cloud), and the organisation-wide allowed-actions
policy was not applied (other organisation repositories use unpinned tags).
Both wait on the owner's answer on #8062, so their rows stay to be recorded.

| Setting | Expected | Planned by the admin issue | Recorded by |
| --- | --- | --- | --- |
| `org.two_factor_requirement_enabled` | `true` | `true` | #8062 |
| `org.default_repository_permission` | `read` | `read` | #8062 |
| `org.members_can_create_public_repositories` | to be recorded | `false` | #8062 |
| `org.members_can_create_private_repositories` | to be recorded | as the owner decides | #8062 |

## Environments (#8063)

The audit's `development` is `preview`; its `security` is `production-ops`.
Reviewers are a count and a type (`User`, `Team`), never a person. Secret and
variable names only; a value is never read.

Mirrored from the #8063 STATUS of 2026-11-21 (D8063). `preview`, `staging`,
`production` and `production-ops` each deploy from one branch rule named `main`
and no tag (`custom`, the contract `scripts/verify-production-environment.mjs`
checks), not from protected branches. `production` and `staging` keep the
stored names that end in a thin space (U+2009), so their `name_exact` is
`false`; the STATUS kept those identities on purpose, for their deployment
history. Still to be recorded:

- `environments.names`: the STATUS lists the environments it changed, not the
  whole list (it names `scan-remediation` as left unchanged, and the
  `pr-preview` name the current preview jobs still use, without an
  inventory).
- every `secret_names` and `variable_names` row except `landing-bot`'s: the
  STATUS read them as empty on 2026-11-21, before the credential cutover it
  lists as outstanding (#8064, #8069), and later requests on #8063 (the preview
  token on 2026-11-26, the D8754 moves) change them. The 2026-11-21 inventory
  is in D8063.
- the `production-backup` and `production-monitoring` rows (#8754). The owner
  confirmed on 2026-11-26 that both exist with their own secrets and deploy
  from `main` only, but no record gives the branch-policy mode, the reviewer
  count or the names.

Administrator bypass (off on all four, still on for `landing-bot`) is applied
but not read by the check, so it is recorded in D8063 only.

| Setting | Expected | Planned by the admin issue | Recorded by |
| --- | --- | --- | --- |
| `environments.names` | to be recorded | `preview`, `staging`, `production`, `production-ops`, `production-backup`, `production-monitoring` (D8754), `landing-bot` (plus `agent-compute-preview`, `scan-remediation` where they exist) | #8063 |
| `environment[preview].required_reviewers` | `0` | `0` | #8063 |
| `environment[preview].wait_timer` | `0` | `0` | #8063 |
| `environment[preview].branch_policy` | `custom` | `main` only | #8063 |
| `environment[preview].branch_policies` | `main (branch)` | `main (branch)` | #8063 |
| `environment[preview].secret_names` | to be recorded | `CLOUDFLARE_API_TOKEN` (#8064) | #8063 |
| `environment[staging].name_exact` | `false` | keep the stored name (D8063) | #8063 |
| `environment[staging].required_reviewers` | `0` | `0` | #8063 |
| `environment[staging].wait_timer` | `0` | `0` | #8063 |
| `environment[staging].branch_policy` | `custom` | `main` only | #8063 |
| `environment[staging].branch_policies` | `main (branch)` | `main (branch)` if custom | #8063 |
| `environment[production].name_exact` | `false` | `true` (the stored name had a trailing thin space on 2026-11-17; D8063 kept it) | #8063 |
| `environment[production].required_reviewers` | `1` | `1` | #8063 |
| `environment[production].reviewer_types` | `User` | `User` (the owner) | #8063 |
| `environment[production].prevent_self_review` | `false` | as the owner decides | #8063 |
| `environment[production].wait_timer` | `0` | `0` | #8063 |
| `environment[production].branch_policy` | `custom` | `protected` (applied as one `main` branch rule, D8063) | #8063 |
| `environment[production].branch_policies` | `main (branch)` | `n/a` when protected | #8063 |
| `environment[production].secret_names` | to be recorded | the `production` rows of `production-credential-inventory.json` | #8063 |
| `environment[production].variable_names` | to be recorded | as recorded | #8063 |
| `environment[production-ops].name_exact` | `true` | `true` | #8063 |
| `environment[production-ops].required_reviewers` | `1` | `1` | #8063 |
| `environment[production-ops].reviewer_types` | `User` | `User` (the owner) | #8063 |
| `environment[production-ops].prevent_self_review` | `false` | as the owner decides | #8063 |
| `environment[production-ops].wait_timer` | `0` | `0` | #8063 |
| `environment[production-ops].branch_policy` | `custom` | `protected` (applied as one `main` branch rule, D8063) | #8063 |
| `environment[production-ops].branch_policies` | `main (branch)` | `n/a` when protected | #8063 |
| `environment[production-ops].secret_names` | to be recorded | the `production-ops` rows of `production-credential-inventory.json` | #8063 |
| `environment[production-ops].variable_names` | to be recorded | as recorded | #8063 |
| `environment[production-backup].name_exact` | to be recorded | `true` | #8063 |
| `environment[production-backup].required_reviewers` | to be recorded | `0` (D8754: scheduled jobs must not wait) | #8063 |
| `environment[production-backup].branch_policy` | to be recorded | `main` only | #8063 |
| `environment[production-backup].secret_names` | to be recorded | the `production-backup` rows of `production-credential-inventory.json` | #8063 |
| `environment[production-backup].variable_names` | to be recorded | as recorded | #8063 |
| `environment[production-monitoring].name_exact` | to be recorded | `true` | #8063 |
| `environment[production-monitoring].required_reviewers` | to be recorded | `0` (D8754: scheduled jobs must not wait) | #8063 |
| `environment[production-monitoring].branch_policy` | to be recorded | `main` only | #8063 |
| `environment[production-monitoring].secret_names` | to be recorded | the `production-monitoring` rows of `production-credential-inventory.json` | #8063 |
| `environment[production-monitoring].variable_names` | to be recorded | as recorded | #8063 |
| `environment[landing-bot].secret_names` | `LANDING_BOT_APP_ID, LANDING_BOT_APP_PRIVATE_KEY` | the App key names from #8061 | #8063 |
| `environment[landing-bot].required_reviewers` | `0` | as recorded | #8063 |
| `environment[landing-bot].branch_policy` | `custom` | as recorded | #8063 |
| `environment[landing-bot].branch_policies` | `main (branch)` | as recorded | #8063 |

## GitHub Apps (#8061)

One App per agent role, installed on this repository only. The permission
table is the App's, verbatim (`permission:access`).

| Setting | Expected | Planned by the admin issue | Recorded by |
| --- | --- | --- | --- |
| `apps.installed` | to be recorded | `studioos-landing-bot`, `studioos-agent-publisher`, `studioos-coordinator`, plus the Apps already installed | #8061 |
| `app[studioos-landing-bot].repository_selection` | to be recorded | `selected` | #8061 |
| `app[studioos-landing-bot].permissions` | to be recorded | `contents:write`, `pull_requests:write`, `checks:write`, `issues:write`, `actions:read`, `metadata:read` | #8061 |
| `app[studioos-landing-bot].events` | to be recorded | `pull_request`, `check_suite`, `merge_group` | #8061 |
| `app[studioos-agent-publisher].repository_selection` | to be recorded | `selected` | #8061 |
| `app[studioos-agent-publisher].permissions` | to be recorded | `contents:write`, `pull_requests:write`, `metadata:read` | #8061 |
| `app[studioos-coordinator].repository_selection` | to be recorded | `selected` | #8061 |
| `app[studioos-coordinator].permissions` | to be recorded | `contents:read`, `pull_requests:read`, `issues:read`, `checks:read`, `actions:read`, `metadata:read` | #8061 |

## Runner groups (#8065)

| Setting | Expected | Planned by the admin issue | Recorded by |
| --- | --- | --- | --- |
| `runner_groups.names` | to be recorded | `Default`, `trusted`, `untrusted` (and the hosted larger-runner group if the plan allows) | #8065 |
| `runner_group[trusted].visibility` | to be recorded | `selected` | #8065 |
| `runner_group[trusted].includes_this_repository` | to be recorded | `true` | #8065 |
| `runner_group[trusted].repository_count` | to be recorded | `1` | #8065 |
| `runner_group[trusted].allows_public_repositories` | to be recorded | as the public repository needs | #8065 |
| `runner_group[trusted].restricted_to_workflows` | to be recorded | `true` | #8065 |
| `runner_group[trusted].selected_workflows` | to be recorded | the deploy and publish workflow files | #8065 |
| `runner_group[untrusted].visibility` | to be recorded | `selected` | #8065 |
| `runner_group[untrusted].includes_this_repository` | to be recorded | `true` | #8065 |
| `runner_group[untrusted].repository_count` | to be recorded | `1` | #8065 |
| `runner_group[untrusted].restricted_to_workflows` | to be recorded | as recorded | #8065 |

## Cloud (#8064, #8066)

Names and quotas only: no account, subscription or tenant id, no ARN, no
host. **Not checked**: no read-only cloud credential exists in `production-ops`,
so the check prints these rows as "not checked" and never files an issue for
them. A later task may add a reader once such a credential is recorded.

| Setting | Expected | Planned by the admin issue | Recorded by |
| --- | --- | --- | --- |
| `cloud.aws.oidc_provider` | to be recorded | the GitHub Actions OIDC issuer | #8064 |
| `cloud.aws.roles` | to be recorded | `studioos-gha-preview`, `studioos-gha-production` | #8064 |
| `cloud.aws.role_subjects` | to be recorded | `repo:AxalNetwork/StudioOS:environment:<name>`; production also on `main` | #8064 |
| `cloud.aws.long_lived_keys_in_github` | to be recorded | `none` | #8064 |
| `cloud.azure.app_registration` | to be recorded | one, federated, no client secret | #8064 |
| `cloud.azure.federated_subjects` | to be recorded | the same subjects as AWS | #8064 |
| `cloud.cloudflare.token_names` | to be recorded | one `CLOUDFLARE_API_TOKEN` per environment | #8064 |
| `cloud.cloudflare.token_expiry` | to be recorded | a date per token | #8064 |
| `cloud.cloudflare.containers.max_instances` | to be recorded | as `AGENT_COMPUTE_4557.md` asks | #8066 |
| `cloud.cloudflare.containers.memory` | to be recorded | as `AGENT_COMPUTE_4557.md` asks | #8066 |
| `cloud.cloudflare.spend_alert` | to be recorded | on the account | #8066 |
| `cloud.aws.ecs_cluster` | to be recorded | one Fargate cluster | #8066 |
| `cloud.aws.ecr_repository` | to be recorded | scan on push, lifecycle policy | #8066 |
| `cloud.aws.service_quotas` | to be recorded | the pilot's numbers | #8066 |
| `cloud.aws.budget_alerts` | to be recorded | `50%`, `80%`, `100%` of the owner's monthly figure | #8066 |
| `cloud.azure.resource_group` | to be recorded | one | #8066 |
| `cloud.azure.container_apps_environment` | to be recorded | one, managed identity | #8066 |
| `cloud.azure.budget_alerts` | to be recorded | `50%`, `80%`, `100%` of the owner's monthly figure | #8066 |
| `cloud.executors.enabled_by_default` | to be recorded | `false` (adapters behind their flags, #5571) | #8066 |

## Rollback

Delete `.github/workflows/admin-drift.yml` (or disable it in the Actions tab)
to stop the weekly check; the issues it filed stay and can be closed by hand.
The check writes no setting, so nothing else needs undoing.
