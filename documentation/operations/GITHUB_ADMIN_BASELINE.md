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
`ADMIN_DRIFT_READ_TOKEN` in the `production-ops` environment. #8063 has not
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

| Setting | Expected | Planned by the admin issue | Recorded by |
| --- | --- | --- | --- |
| `rulesets.names` | to be recorded | `main`, `platform paths` | #8060 |
| `ruleset[main].enforcement` | to be recorded | `active` | #8060 |
| `ruleset[main].target` | to be recorded | `branch` | #8060 |
| `ruleset[main].include` | to be recorded | the default branch | #8060 |
| `ruleset[main].bypass_actors` | to be recorded | `none` (after the owner's go on #8060) | #8060 |
| `ruleset[main].rules` | to be recorded | pull request, merge queue, required status checks, non fast-forward, deletion | #8060 |
| `ruleset[main].required_status_checks` | to be recorded | the six checks the deploy admission job waits for | #8060 |
| `ruleset[main].strict_required_status_checks` | to be recorded | as D5605 | #8060 |
| `ruleset[main].merge_queue.merge_method` | to be recorded | `SQUASH` | #8060 |
| `ruleset[main].merge_queue.max_entries_to_merge` | to be recorded | `5` (D5605 row 4) | #8060 |
| `ruleset[main].merge_queue.grouping_strategy` | to be recorded | as D5605 | #8060 |
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

| Setting | Expected | Planned by the admin issue | Recorded by |
| --- | --- | --- | --- |
| `repo.allow_auto_merge` | to be recorded | `true` (D5605 row 3) | #8060 |
| `repo.allow_update_branch` | to be recorded | `true` (always suggest updating branches) | #8060 |
| `repo.delete_branch_on_merge` | to be recorded | `true` | #8062 |
| `repo.has_wiki` | to be recorded | `false` | #8062 |
| `repo.has_discussions` | to be recorded | as it is | #8062 |
| `repo.secret_scanning` | to be recorded | `enabled` | #8062 |
| `repo.secret_scanning_push_protection` | to be recorded | `enabled` | #8062 |
| `repo.dependabot_security_updates` | to be recorded | `enabled` | #8062 |
| `repo.private_vulnerability_reporting` | to be recorded | `true` | #8062 |

## Actions (#8062)

| Setting | Expected | Planned by the admin issue | Recorded by |
| --- | --- | --- | --- |
| `actions.enabled` | to be recorded | `true` | #8062 |
| `actions.allowed_actions` | to be recorded | `selected` | #8062 |
| `actions.selected.github_owned_allowed` | to be recorded | as entered | #8062 |
| `actions.selected.verified_allowed` | to be recorded | as entered | #8062 |
| `actions.selected.patterns_allowed` | to be recorded | every `uses:` of `.github/workflows/*.yml`, pinned at its SHA | #8062 |
| `actions.workflow.default_permissions` | to be recorded | `read` | #8062 |
| `actions.workflow.can_approve_pull_request_reviews` | to be recorded | `false` | #8062 |
| `actions.fork_pr_approval` | to be recorded | `all_external_contributors` | #8062 |

## Organisation (#8062)

| Setting | Expected | Planned by the admin issue | Recorded by |
| --- | --- | --- | --- |
| `org.two_factor_requirement_enabled` | to be recorded | `true` | #8062 |
| `org.default_repository_permission` | to be recorded | `read` | #8062 |
| `org.members_can_create_public_repositories` | to be recorded | `false` | #8062 |
| `org.members_can_create_private_repositories` | to be recorded | as the owner decides | #8062 |

## Environments (#8063)

The audit's `development` is `preview`; its `security` is `production-ops`.
Reviewers are a count and a type (`User`, `Team`), never a person. Secret and
variable names only; a value is never read.

| Setting | Expected | Planned by the admin issue | Recorded by |
| --- | --- | --- | --- |
| `environments.names` | to be recorded | `preview`, `staging`, `production`, `production-ops`, `landing-bot` (plus `agent-compute-preview`, `scan-remediation` where they exist) | #8063 |
| `environment[preview].required_reviewers` | to be recorded | `0` | #8063 |
| `environment[preview].secret_names` | to be recorded | `CLOUDFLARE_API_TOKEN` (#8064) | #8063 |
| `environment[staging].required_reviewers` | to be recorded | `0` | #8063 |
| `environment[staging].branch_policy` | to be recorded | `main` only | #8063 |
| `environment[staging].branch_policies` | to be recorded | `main (branch)` if custom | #8063 |
| `environment[production].name_exact` | to be recorded | `true` (the stored name had a trailing thin space on 2026-11-17) | #8063 |
| `environment[production].required_reviewers` | to be recorded | `1` | #8063 |
| `environment[production].reviewer_types` | to be recorded | `User` (the owner) | #8063 |
| `environment[production].prevent_self_review` | to be recorded | as the owner decides | #8063 |
| `environment[production].wait_timer` | to be recorded | `0` | #8063 |
| `environment[production].branch_policy` | to be recorded | `protected` | #8063 |
| `environment[production].branch_policies` | to be recorded | `n/a` when protected | #8063 |
| `environment[production].secret_names` | to be recorded | the `production` rows of `production-credential-inventory.json` | #8063 |
| `environment[production].variable_names` | to be recorded | as recorded | #8063 |
| `environment[production-ops].name_exact` | to be recorded | `true` | #8063 |
| `environment[production-ops].required_reviewers` | to be recorded | `1` | #8063 |
| `environment[production-ops].reviewer_types` | to be recorded | `User` (the owner) | #8063 |
| `environment[production-ops].wait_timer` | to be recorded | `0` | #8063 |
| `environment[production-ops].branch_policy` | to be recorded | `protected` | #8063 |
| `environment[production-ops].secret_names` | to be recorded | the `production-ops` rows of `production-credential-inventory.json`, plus `ADMIN_DRIFT_READ_TOKEN` | #8063 |
| `environment[production-ops].variable_names` | to be recorded | as recorded | #8063 |
| `environment[landing-bot].secret_names` | to be recorded | the App key names from #8061 | #8061 |
| `environment[landing-bot].branch_policy` | to be recorded | as recorded | #8063 |

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
