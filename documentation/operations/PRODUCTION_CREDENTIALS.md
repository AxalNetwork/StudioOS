# Production credential cutover (#7145)

The machine-readable inventory is the guard's source of truth. It records one row per credentialed job, its triggers, secret names, purpose, required permissions and target environment. The values of `CLOUDFLARE_API_TOKEN` differ between environments. [Credential inventory](production-credential-inventory.json)

## Live environment names observed

The read-only GitHub environment listing on 2026-11-17 returned `landing-bot`, `production\u2009` and `staging\u2009`. The escaped suffix denotes a trailing U+2009 THIN SPACE in each stored name. The existing production environment had `deployment_branch_policy: null` and an empty `protection_rules` list. The list had no `production-ops` or `agent-compute-preview` entry.

A direct read of the fixed `/repos/AxalNetwork/StudioOS/environments/production` endpoint resolved to that existing environment, ID `21311264734`, with its stored trailing-space name. Configure this resolved environment's policies and secrets, preserving its deployment history. [Production environment endpoint](https://api.github.com/repos/AxalNetwork/StudioOS/environments/production)

Create `production-ops` with the name declared in the workflows and configure its policy and secrets before merging. GitHub creates an environment automatically when a workflow names one that is absent, so the source change alone cannot establish its branch restriction or secrets. [GitHub environment settings](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

The compute preview remains subject to its existing owner-gated setup. Before enabling it, the owner must create its exact environment, independent-review protection, main-only branch restriction and preview-only credential.

## Decisions needed before cutover

The existing callers expose a scope conflict in the requested two-token plan. Resolve the affected paths before merging the credential cutover or dispatching them.

| Caller | Required capability | Effect of the requested narrow token | Follow-up design |
| --- | --- | --- | --- |
| `agent-stage-a.yml / stage-a` | Create, deploy and delete a throwaway Worker and its stores | The operations token denies Worker publication | A dedicated lifecycle credential in an isolated account, used by this job |
| `gateway-live-check.yml / live-check` | Create, deploy and delete a throwaway Worker | The operations token denies Worker publication | A dedicated gateway-probe credential in an isolated account |
| `branch-provision.yml / provision` | Create subsidiary stores, install secrets and publish its Worker | The operations token denies Worker publication | A dedicated provisioning credential, with explicit subsidiary and HQ database access |
| `cloudflare-worker-deploy.yml / branches` | Migrate and publish registered subsidiaries | The release token is scoped to `studioos` | A separate subsidiary rollout credential |
| `d1-migrate.yml / migrate`, when `branch` is supplied | Migrate a subsidiary database | The intended release credential covers HQ's database | Select a subsidiary-scoped migration credential for this path |

At the audited base `9bc1a5f2ac2320d3e0b509a397160cd7962d10db`, `infra/branches/` contains its README and `_example.json` only. The branch rollout currently has no real targets. Its credential design becomes necessary before the first real branch is registered. The three manual provisioning/probe paths already contain publishing operations.

The follow-up design requires an explicit change to secret selection or environment assignment beyond #7145's existing-names constraint. Preserve the narrow release and operations tokens while that design is settled. Record the chosen routing and verify the affected paths before using them.

The existing compute-preview workflow requires a separate `agent-compute-preview` environment with independent review. Its job also reads the generic token name. Supply a preview-only token there before removing the repository fallback. Configure that environment and approval gate before enabling its deploy.

## Inventory coverage

The inventory includes the application-only `WORKGRAPH_INGEST_TOKEN`, because the overlap report writes a snapshot to production. It grants access to that ingest operation. Cloudflare management tokens, branch secrets and independent-backup credentials are recorded separately in `credentialPolicies`.

| Workflow | Job | Triggers | Environment |
| --- | --- | --- | --- |
| `agent-compute-preview.yml` | `deploy_disabled_host` | manual | `agent-compute-preview` |
| `agent-gateway-keys.yml` | `keys` | manual | `production-ops` |
| `agent-stage-a.yml` | `stage-a` | manual | `production-ops` |
| `archive-observer-deploy.yml` | `deploy` | main push, manual | `production` |
| `backup-d1.yml` | `backup` | schedule, manual | `production-ops` |
| `branch-provision.yml` | `provision` | manual | `production-ops` |
| `cloudflare-worker-deploy.yml` | `deploy` | main push, manual | `production` |
| `cloudflare-worker-deploy.yml` | `schema-drift` | main push, manual | `production` |
| `cloudflare-worker-deploy.yml` | `branches` | main push, manual | `production` |
| `d1-migrate.yml` | `migrate` | manual | `production` |
| `dr-drill.yml` | `drill` | schedule, manual | `production-ops` |
| `gateway-live-check.yml` | `live-check` | manual | `production-ops` |
| `magic-link-insert-probe.yml` | `probe` | schedule, manual | `production-ops` |
| `meeting-bot-deploy.yml` | `deploy` | main push, manual | `production` |
| `merge-control-deploy.yml` | `deploy` | main push, manual | `production` |
| `pr-overlap.yml` | `report` | schedule, manual | `production-ops` |
| `schema-rehearsal.yml` | `rehearse` | manual | `production-ops` |

Run `npm run test:guards` when editing the inventory or any workflow. The guard checks all workflow files, catches unlisted consuming jobs and missing listed jobs, matches each job's credential set and environment, and forbids listed secrets in PR-triggered workflows. The exception is restricted to the existing deploy/delete jobs and generic token in `pr-preview.yml`. The #7146 migration has removed both consumers from `pr-preview.yml`; neither remains in the inventory. The historical exception has no current caller.

## Token permissions

Cloudflare account-owned tokens support granular Worker roles. Use individual-Worker `Editor` for an existing deployment target. A job that creates a new Worker needs Workers-product `Admin`, which is the reason the throwaway and provisioning paths need their own identities. [Cloudflare Worker authorization](https://developers.cloudflare.com/workers/authorization/)

| Credential location | Permission names and resource boundary |
| --- | --- |
| `production / CLOUDFLARE_API_TOKEN` | `Editor` on the existing `studioos` Worker, `Workers Routes Write` for its zone, `D1 Write` for migrations and schema access, and `Queues Read` for the queue preflight |
| `production-ops / AGENT_GATEWAY_ADMIN_TOKEN` | Dedicated identity for the approved `agents` gateway provider configuration and Secrets Store secret create/update and metadata checks; provision and verify before applying. Do not widen the D1/R2 operations token. |
| `production-ops / CLOUDFLARE_API_TOKEN` | `D1 Write` for export, rehearsal/restore creation, import and cleanup, plus `Workers R2 Storage Write` for Wrangler's REST object operations |
| `production / MEETING_BOT_CLOUDFLARE_API_TOKEN` | `Editor` on the existing `studioos-meeting-bot-preview` and `studioos-meeting-bot`, plus `Containers Write` for their container |
| `production / ARCHIVE_OBSERVER_CLOUDFLARE_API_TOKEN` | `Editor` on the existing target declared in `cloudflare-archive-observer/wrangler.jsonc` |
| `production / MERGE_CONTROL_CLOUDFLARE_API_TOKEN` | `Editor` on the existing `studioos-merge-control`, with successful attachment of its configured consumer verified |
| `agent-compute-preview / CLOUDFLARE_API_TOKEN` | `Editor` on the approved existing preview host, plus `Containers Write` for its container |

The operations token has no Worker publishing permission. Its D1 rights include writes because Cloudflare requires `D1 Write` to export a database. The backup and drill also use R2 REST operations through Wrangler. Bucket-scoped S3 object credentials apply to the S3 API. [D1 export permissions](https://developers.cloudflare.com/d1/observability/debug-d1/) · [R2 authentication](https://developers.cloudflare.com/r2/api/tokens/)

Select the narrowest resource selections supported for each product in the account. Record the actual resource boundaries in the owner's private cutover record, particularly the D1 create/delete rights required by rehearsal and restore. Worker scoping alone does not establish database scoping. Verify the existing release's queue consumer and Workflow updates with the new identity. The API lists `Workers Scripts Write` for Workflow updates and `Queues Write` or `Workers Scripts Write` for consumer creation. A permission failure must be resolved against the specific target and operation before cutover. [Cloudflare permission names](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) · [Workflow update](https://developers.cloudflare.com/api/resources/workflows/methods/update/) · [Queue consumer creation](https://developers.cloudflare.com/api/resources/queues/subresources/consumers/methods/create/)

Keep the dedicated publish workflows' current enablement gates. Pre-provision their targets with the owner's bootstrap process before using an individual-Worker Editor token for routine releases. An existing binding does not require granting the deploy credential direct access to all of its backing data. [Cloudflare Worker authorization](https://developers.cloudflare.com/workers/authorization/)

## Owner cutover

### 1. Configure the environments

In repository Settings → Environments, configure the existing production environment resolved by `/repos/AxalNetwork/StudioOS/environments/production` and create `production-ops` as declared in the workflows. Apply these settings to both environments before adding their credentials.

| Setting | Value |
| --- | --- |
| Deployment branches and tags | Selected branches and tags |
| Allowed policy | One branch policy with the literal name `main` |
| Tag policies | Empty |
| Required reviewers | Empty |
| Wait timer | 0 |

The production preflight reads the fixed `/repos/AxalNetwork/StudioOS/environments/production` endpoint and its `/deployment-branch-policies` child using the job's `GITHUB_TOKEN` with `actions: read`. That fixed endpoint identifies the production environment, including the stored name observed above. The preflight requires exactly one literal `main` branch policy and fails for a missing/unreadable environment, the wrong policy mode, extra policies, a wildcard, or a tag named `main`. It runs before the first Cloudflare credentialed step. Retain the independent-review gate for `agent-compute-preview` and restrict its deployment branch to `main` as well. [GitHub environment settings](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

### 2. Install the environment credentials

Create separate account-owned tokens for release and operations according to the permission table. Enter their values directly into each environment's `CLOUDFLARE_API_TOKEN` secret. Place the three dedicated deployment tokens in `production`.

Move `BRANCH_SECRET_BUNDLE`, `HQ_RPC_SECRET`, `DR_COPY_ACCESS_KEY_ID`, `DR_COPY_SECRET_ACCESS_KEY` and `WORKGRAPH_INGEST_TOKEN` to `production-ops` under their existing names. Preserve the independent-copy destination's D4558 access and retention requirements. Provision its credential only when that feature is configured. See [D1 recovery §7](D1_RECOVERY.md#7-the-independent-encrypted-copy-d4558).

Use the inventory to verify every environment secret's name and purpose. Preserve the matching account ID for each token. Confirm the preview-only token exists in `agent-compute-preview`. Resolve the publishing-path decisions at the beginning of this runbook before cutting over their callers.

### 3. Merge and collect execution evidence

Merge the reviewed PR after the environment configuration is present. Confirm one production release, one nightly D1 backup and one magic-link insert probe succeed from `main`. Confirm the operations runs appear in `production-ops` and the release in `production`.

Record the commit SHA, run URL, selected environment, successful phase and the environment secret's setup time. Verify each environment secret was installed before the job started. Check the new Cloudflare token's usage privately. A success while a same-name repository fallback exists needs this configuration evidence before it establishes the source of the credential. Environment secrets take precedence over repository secrets with the same name. [GitHub secrets precedence](https://docs.github.com/en/actions/reference/security/secrets#naming-your-secrets)

For the dedicated deploys and enabled operations, collect the same evidence when their jobs next run. Keep secret values, backup data and authentication material out of issues, logs and artifacts.

### 4. Remove the repository fallback and revoke the old token

After #7146 lands, verify its preview deploy and cleanup use an isolated preview credential. Re-scan every workflow and run the guard. Confirm all inventory rows are served by their intended environment secret, including compute-preview.

Delete the repository-level `CLOUDFLARE_API_TOKEN`, then revoke its old Cloudflare token. Verify the organization's secret settings also provide no inherited production-token fallback under that name. Remove repository and organization copies of the dedicated deployment tokens, branch secrets, independent-copy keys and WorkGraph ingest credential once their environment-backed consumers are verified. Use the issuer's rotation procedure for old dedicated cloud tokens while preserving live application secret relationships.

Confirm subsequent release, backup and probe runs remain green after removal. The issue's credential-isolation outcome is complete once the protected environment is the only available source for each production-writing credential and the legacy generic Cloudflare token is revoked.

## Recovery during the cutover

If an environment policy is missing, restore the single `main` branch policy and rerun the affected candidate after its normal admission checks. If the token cannot perform a required operation, inspect the failed target and the applicable permission in the inventory, then correct that environment's scoped identity or finish the dedicated-caller design.

Keep the previously deployed application revision while repairing credential setup. A source revert can undo workflow wiring, but it cannot restore a revoked token. Recovery after revocation uses a replacement scoped environment token and the normal release path. Record any pending caller migration and its owner on #7145.
