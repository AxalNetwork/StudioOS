# agents/ — the agent manifests

<!-- index: none -->

Every agent the platform runs is declared here in one reviewed file,
`<name>.agent.yml` (D8079, #8079). The file says what the agent may do, how much
it may spend, where it may write, where it runs and who it escalates to. Nothing
about an agent exists only in a console, a repository variable or a database row
without its manifest saying so. The registry in D1 (#8080) and the runtime checks
(#8070 capabilities, #8071 budgets) read the same names.

`node scripts/check-agent-manifests.mjs` validates every file here. It is called
by `frontend/test/agent_manifests_8079.test.mjs`, so it runs in CI with the
frontend suite. The folder holds this README and `*.agent.yml` files only. A
file with any other name fails the check rather than being skipped.

## The schema

Every key is required. An unknown key fails.

| Key | Value |
| --- | --- |
| `name` | Lower-case letters, digits and hyphens, the same as the file name before `.agent.yml`. |
| `kind` | `platform` (runs the platform itself) or `venture` (works for a company or project). |
| `owner` | The slot that maintains it (`S01` … `S39`, `chatgptpro`), `owner`, or `role:<name>`. A venture agent is not owned by a platform slot. |
| `identity` | Who GitHub sees: one of #8061's Apps (`studioos-landing-bot`, `studioos-agent-publisher`, `studioos-coordinator`), `session` (a slot session's own token) or `github-actions` (the workflow's token). |
| `capabilities` | A list of `<domain>.<action>` names, or `<domain>.*`. The catalogue is #8070's names plus D8079's six repository actions (`issue.read`, `issue.write`, `ci.read`, `ci.dispatch`, `code.enqueue`, `security.read`). An unknown name fails. |
| `models.route` | `gateway` (the agent gateway, #7073), `direct` (a provider SDK, outside the gateway) or `none` (the agent makes no model call). |
| `models.allowed` | The model keys it may call. Gateway keys for `gateway`, the runner's provider accounts for `direct`, empty for `none`. |
| `resources.cpu`, `resources.memory` | A container run's size (#4557, #5571), such as `cpu: 1` and `memory: 4GiB`. Both are `none` when it runs no container. |
| `limits` | #8071's five fields: `runtime` (minutes per run), `tokens` (per run), `parallel_tasks` (at once), `child_agents` (started per run), `prs` (opened per day). Each is a whole number, or `none` when nothing caps it today. |
| `network.internet` | `true` when the runner does not restrict egress, `false` when only `egress` is reachable. |
| `network.egress` | The hosts the agent's own code calls. |
| `allowed_paths` | Repository-relative globs it may write: `*` (within one folder), `**` (any folders, none included) and `?`. Nothing else is special. Quote a glob that starts with `*`, or YAML reads it as an alias. Empty when it writes no file. |
| `runner_pool` | `trusted` (main's code, may hold a credential), `untrusted` (a PR's code, holds none; #8072) or `none` (not an Actions runner). |
| `approval.external_actions` | `required` or `not-required`. |
| `escalation` | The slot, or `owner`, that a stuck or refused run goes to. |
| `status` | `live`, `paused` or `retired`. |
| `sources` | The workflows and scripts that run the agent. Each must exist, so a manifest cannot outlive its code unnoticed. |

## What the check refuses

Each refusal prints its code, and each code has a fixture in the test.

| Code | When |
| --- | --- |
| `prod_deploy` | A capability that deploys to production: `prod:deploy`, `deploy.production`, or a wildcard (`deploy.*`, `*`) that covers it. No agent deploys to production. |
| `capability_ungrantable` | `code.merge`, `cloud.write`, `finance.execute` or `email.send`, by name or by wildcard. A person does these (#8070). Asking the merge queue to take a PR is `code.enqueue`: the queue merges it, under the gates GitHub enforces. |
| `capability_unknown` | A name outside the catalogue, or a wildcard that matches none. |
| `privileged_path` | A **venture** agent's `allowed_paths` entry that can match any path on #8067's privileged list (`PRIVILEGED_PATHS` in the script): `.github/`, `scripts/`, `merge-control/`, `attached_assets/` at any depth, `cloudflare-worker/sql/`, `cloudflare-worker/src/middleware/`, and `AGENTS.md`, `CLAUDE.md`, `CODEOWNERS`, `.gitattributes`, `package*.json`, lockfiles and `wrangler*.toml` anywhere. A `**` reaches a folder named `scripts` at any depth and a bare `*.md` reaches `AGENTS.md`, so a venture agent names its folders and files narrowly, such as `ventures/acme/src/*.ts`. |
| `approval_required` | An `email.*`, `relationships.request-introduction` or `finance.*` capability without `approval.external_actions: required`. Email, introductions and payments always need a person's approval. |
| `schema` | Anything else above: a missing or unknown key, a wrong value, a YAML error, a duplicate name, a missing source. |

A platform agent may name `**`. The landing bot's own path guard
(`scripts/landing-bot/rules.mjs` `pathGuard()`) and the merge policy still refuse
a privileged write at the moment it happens. Each such manifest says so in a
comment.

## The rule for adding one

1. **One file per agent**, named after it: `agents/<name>.agent.yml`. Agents that
   share one rule file and one identity, such as the slot sessions, share one
   manifest.
2. **Read every value from the repository.** Take each value from the workflow,
   script or rule file that runs the agent, and list those files in `sources`.
   Cite the line in a comment where a value is not obvious. A value the repository
   does not record is `none`, never a guess.
3. **Run `node scripts/check-agent-manifests.mjs`** before pushing.
4. **A new capability name goes into the script's catalogue in the same PR**,
   with a comment naming the workflow permission or call it stands for. #8070's
   `capability_catalog` carries the same names.
5. **Changing what an agent may do changes its manifest in the same PR.** That
   covers a new workflow permission, a new write path, a raised cap or a status
   change.

No file here is generated. Adding a manifest edits no other file.
