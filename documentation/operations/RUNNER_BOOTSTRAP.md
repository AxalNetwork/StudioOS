# Prepare and enroll one CI runner (D7885, #7885)

This runbook prepares one approved temporary Linux executor or a coordinated
native Mac migration. It does not create a VM or enable routing. Keep the free
standard-hosted pool active. A local preflight is not a live canary.

## 1. Begin on the repository Runners page

Open <https://github.com/AxalNetwork/StudioOS/settings/actions/runners> as an
organization operator. Inspect current registrations before installing another
listener. Standard ubuntu-latest machines are on-demand hosted resources, not
persistent entries in this list; their absence is not missing capacity.

The supported enrollment is **organization-scoped**, in the approved group
shared only with StudioOS. A repository-only registration is not proof of group
membership. The central group is `StudioOS Worker Pool`, organization group **5**,
as [verified by the operator on 21 November 2026](https://github.com/AxalNetwork/StudioOS/issues/7906#issuecomment-7061605125).
The catalog records `self_hosted_group_id: 5` for both native self-hosted profiles.
This configuration does not authorize registration or execution by itself: use a
reviewed main profile commit and independently verify the current restrictions,
executor and isolation evidence before activation. Group **6**, `StudioOS Included
Compute`, remains separate. The Mac registration is in group 5, but
`MACBOOK_WORKER_ENABLED=false` keeps its legacy execution path disabled.

From the organization runner settings, verify selected repository access is only
AxalNetwork/StudioOS, public-repository use is enabled only for that selected
repository, and workflow access is restricted to the workflow that **directly
defines the runner job**. The initial selected entry is:

```
AxalNetwork/StudioOS/.github/workflows/runner-executor.yml@refs/heads/main
```

That workflow is published through #7886 and the merged #8231 executor repair.
Record its approved full main SHA and raw file
SHA256, plus the observed group ID/settings, in a private operator receipt. The
bootstrap independently checks main ancestry and exact file content. A dispatch
wrapper or caller is not the group-authorized runner-job definition. Do not add a
branch-only workflow or remove the group restriction to bypass a refusal.

Historical pilot evidence (20 November 2026): organization/repository runner and
permissions reads returned 403 for the development integration. The owner supplied
an approved Linux pilot: runner 44451 in group 5 (then StudioOS Linux Workers), with the
linux-runner-smoke.yml definition at fe1c1ce6b48260e90a0c1049f0c0216701125758 on
ci/linux-runner-test. Public run [44746099004](https://github.com/AxalNetwork/StudioOS/actions/runs/44746099004)
independently confirms that assignment and passing setup/runtime steps; final
Worker/cleanup outcome is recorded separately. That smoke-only branch revision
is not on inspected main and is not #7886's trusted reusable executor. Do not
reuse that branch authorization or start a duplicate run. The pilot's approved
one-node stop deadline was 20 November 2026 at 18:00 Europe/Zurich (17:00 UTC),
with a 40-minute job timeout. This historical pilot does not authorize further
provider runtime or spending.

The 21 November operator verification renamed the existing group 5 to the common
pool and replaced the branch-only workflow permission with the exact main
executor entry above. Both existing registrations were observed idle in that
group. This verifies group configuration only; live execution remains gated on
the main executor, fresh private operator authorization and isolation evidence.
It does not renew the expired pilot deadline or its provider authorization.

## 2. Prepare an approved machine

Obtain the current private approved node/runbook, spending boundary and teardown
deadline before any provider operation. The first #7888 milestone requires two
independently supported Linux machine identities; this runbook does not authorize
a second machine, a new operating window or further spending. Prepare only a
machine covered by current operator authorization. Schedule
provider shutdown/deletion privately before enrollment; a stopped runner still
leaves a billable VM. No provider API or extra GitHub App permissions are required
merely to install/verify the node.

Use a compatible Linux x64 system (Ubuntu 24.04 LTS is the initial recommended
base), or the existing native ARM64 Mac after a coordinated drain. The controller
requires root-owned `/bin/bash`, `/usr/bin/python3` 3.9+, tar/gzip, CA certificates
and Git 2.39–2.x. Install base OS packages through the approved signed OS package
source. Job runtimes are downloaded independently with pinned checksums: Node
22.23.3 and Python 3.11.18. The runner includes its own internal Node runtime;
that is separate from the job's Node 22.

Use the reviewed bootstrap/profile files from an approved immutable main commit.
Copy them into a root-owned directory with no job-writable parents:

```sh
sudo install -d -m 0755 -o root /opt/studioos-bootstrap
sudo install -m 0755 -o root scripts/ci/runners/bootstrap.sh /opt/studioos-bootstrap/bootstrap.sh
sudo install -m 0644 -o root scripts/ci/runners/profiles.json /opt/studioos-bootstrap/profiles.json
sudo /bin/bash /opt/studioos-bootstrap/bootstrap.sh install --profile linux-x64 --install-os-deps
sudo /bin/bash /opt/studioos-bootstrap/bootstrap.sh verify --profile linux-x64
```

`--install-os-deps` runs the dependency installer from a freshly verified official
runner archive, before listener ownership is assigned. It is Linux-only. Install
may repeat existing artifact verification but creates no registration/service.
The default dedicated root is `/opt/studioos-runner-v1`; an unmanaged/nonempty or
job-writable root is refused. Do not use a home, filesystem root or shared cache.

Linux creates two system users/groups if absent: `studioos-runner` (listener) and
`studioos-job` (candidate code). Neither may be root or have admin/docker/disk/
other privileged groups. They need distinct UIDs/GIDs. The listener home and
credentials are private; work, job and cache roots are distinct. #7886 must supply
and verify the actual privilege/isolation boundary and run-owned temporary paths
before candidate code can execute. Merely creating these accounts does not change
GitHub's default same-UID host-job behavior.

For Mac, an administrator prepares those two hidden, non-login accounts/groups
with unused UIDs/GIDs and homes under the dedicated root before install. Keep
both out of admin, wheel and developer/privileged groups. This bootstrap does not
change personal accounts, Homebrew or the existing workflow. Prepare new tools in
parallel, drain and stop the old listener before registration/start, retain its
old private configuration for recovery, and prove that the new trusted executor
uses the separate job identity. Use `--profile macos-arm64` without the Linux OS
dependency flag. Rosetta or mismatched native runtime architecture is refused.

`verify` reports actual OS/architecture, effective CPU/memory limits, exact tool
versions and working Node SQLite JSON/FTS. It does not assign labels, register a
machine or claim every Worker shard is compatible. Confirm the pinned runner
release is offered on the organization's download page (GitHub uses progressive
rollouts); a mismatch requires a reviewed profile update, not an unverified
fallback. Disabled runner auto-update also requires reviewed routine pin refresh.

## 3. Private enrollment, after #7886 is published

The operator creates a fresh root-owned mode-0600 JSON receipt outside job paths.
Never commit it or paste registration/provider/App material into chat/issues.
The receipt fields are:

| Field | Required observation |
| --- | --- |
| schema_version | 1 |
| observed_at | UTC Z timestamp, no older than 15 minutes |
| runner_identity | Stable random identity printed by install; not a hostname |
| repository / organization | AxalNetwork/StudioOS / AxalNetwork |
| group_name / group_id | Exact centrally approved name and observed numeric ID |
| visibility / selected_repositories | selected / [AxalNetwork/StudioOS] |
| allows_public_repositories / restricted_to_workflows | true / true, observed in settings |
| selected_workflows | Exactly the directly defining main workflow above |
| executor_revision / executor_file_sha256 | Full published main SHA / raw workflow SHA256 |
| job_isolation_verified | True only after candidate execution as the separate job identity and scoped cleanup are proved |
| host_inventory_checked / drained | True only after all old registrations/listeners and active jobs are accounted for |
| pilot_expires_at / budget_reference | Approved future UTC deadline (at most 24h away) / nonsecret private budget reference |
| provider_teardown_scheduled | True for Linux only after the approved provider teardown is scheduled |

Admin-only REST reads can support the private receipt: organization
`actions/runner-groups/{id}`, its selected `repositories`, and the group's
`runners`. Save private results locally; publish only sanitized evidence. Existing
registration metadata is checked against organization scope and this group. For a
new enrollment, obtain a short-lived **organization registration token** through
the approved private operator flow. The only token input is an already-open FD
number >=3 in a privileged operator shell, for example:

```sh
# Run in the approved private root/operator session. The command supplies only
# a short-lived registration token; its output is never printed or persisted.
/opt/studioos-bootstrap/bootstrap.sh register --profile linux-x64 \
  --approval-file /root/private-runner-receipt.json --token-fd 3 \
  3< <(approved-private-registration-token-command)
/opt/studioos-bootstrap/bootstrap.sh start --profile linux-x64 \
  --approval-file /root/private-runner-receipt.json
/opt/studioos-bootstrap/bootstrap.sh status --profile linux-x64
```

The placeholder private command is the organization's established operator/secret
flow, not a command provided by this repository. Do not put a token in argv or a
persistent shell variable/environment. Configuration receives it only through a
short-lived private child environment; captured output is suppressed. GitHub's
runtime OAuth files necessarily remain in the listener's private home, never in
the candidate user's workspace/cache. Raw runner diagnostics are private too.
The service receives a minimal environment without registration/provider/App
credentials. A second valid register/start observes existing state rather than
creating another registration or daemon. Another listener anywhere on the machine
blocks migration/start. Do not run two listener processes as a capacity shortcut.

The service supervisor stops at the pilot deadline; it does not delete the VM.
The provider teardown receipt and operator stop/delete verification remain
necessary. This is a local OS timer, not a hosted Actions job waiting for work.
No CI caller/router is enabled by these commands.

## 4. Verify online/idle eligibility and run the canary

From the same repository Runners page, confirm the **organization** resource is
assigned to StudioOS, is in the restricted group, has its real self-hosted/OS/
architecture labels plus studioos-worker-v1, and is online/idle. Local service
status does not establish those facts; the CLI explicitly reports remote
eligibility as unverified. Unsupported/unfinished machines are not safe capacity.

After #7886 is published and group restrictions/isolation are proved, use its
approved standalone trusted canary. Record its exact source/executor SHAs, owned
run/job links, native OS/architecture, measured CPU/memory, Node/Python/SQLite and
truthful outcome. Verify unselected/untrusted workflow definitions are refused.
Do not widen workflow access to make a failed canary start. Do not manually
trigger broad load/CI while the backlog hold remains in effect; coordinate any
standalone pilot exception with the owner. Automatic production spillover remains
with #7887; one passing registration is not completion of #7884.

A second approved compatible machine repeats this same profile/bootstrap with a
new random persisted inventory name. There is no hostname in YAML and no new
workflow. The bootstrap fixture tests exercise two identities with identical
capability/group selection; actual second-node enrollment needs separate approval.

## 5. Drain, restart, recover or remove

Before stop/restart/removal, privately confirm no owned job is running and refresh
the drained inventory receipt. Stop through `bootstrap.sh stop --profile …
--approval-file …`; start with a new valid receipt/deadline. There is one service
unit/launchd job per persisted identity, and repeated calls reuse it. Mac restart
reloads the updated launchd specification rather than retaining an old deadline.

For normal uninstall: drain, stop, obtain a short-lived organization **removal**
token through the private flow, then run `remove` with `--approval-file` and
`--token-fd`. Verify remote unregister succeeded before deleting local credential
files. If enrollment was already revoked/deleted, independently verify that fact
in the private inventory receipt (`enrollment_revoked: true`), then use
`remove --revoked` after stop/drain. A revoked receipt can stop/remove, never start.
Job data/caches and system accounts are retained for deliberate scoped handling.

If a registration is repository-scoped or in the wrong group, the bootstrap
refuses it. Drain and stop it, use the original scope's approved private removal
flow under its original account, verify removal in the relevant inventory, then
enroll at organization scope. Never drop the group restriction or broaden to all
self-hosted runners. Keep the old Mac workflow/group recoverable until the new
one passes and the migration owner records the handover; do not rename them here.

On expired token/configuration failure, get fresh short-lived material; never
retry in a loop or echo captured output. A complete existing `.runner` is acknowledged without a token, new registration
or service change, even while new enrollment/start remain blocked by the isolation
canary gate. This reports local registration only, never admission or current
online/idle eligibility. A partial `.runner`/credential set requires operator recovery of that registration
before another is created. A failed archive fetch leaves earlier verified
artifacts reusable. An unmarked partial destination is refused: while drained,
the operator archives/removes only that incomplete destination under the dedicated
root and retries install. Never remove an active registration to fix a download.
Pin changes require a reviewed, drained removal/reinstall rather than overwriting
a running listener. After successful unregister/removal, privately archive the old
dedicated root and reuse its original path before installing the new pins. A
new root also requires a reviewed account-home migration after drain/unregister;
existing dedicated accounts bound to another root are refused.
The old root must not remain registered or running; do not copy its OAuth files
into the new installation. Retain private failure evidence without publishing credentials.

## Current acceptance limits

Offline fixtures cover platform/label mismatch, pinned tools, SHA integrity,
unsafe archives, fresh/expired/revoked approval, wrong-scope/partial registration,
private token handling, native service specification, duplicate prevention and
partial-download recovery. A disposable local Linux artifact rehearsal is separate
from the already owner-started Linux pilot, whose actual result must be recorded.
No new VM, group change, registration, Mac migration, production spillover or
additional spend was initiated by this implementation.

### Recorded pilot result, 20 November 2026

Run [44746099004](https://github.com/AxalNetwork/StudioOS/actions/runs/44746099004)
ended cancelled. Its job ran 13:44:37Z–14:25:00Z; the check annotation says it
exceeded the 40-minute maximum. Setup/runtime/SQLite, source/plan and dependency
steps passed; Worker execution was cancelled, trace summary skipped, and artifact
upload plus owned-file cleanup succeeded. This is not a Worker-suite pass,
process-drain proof, provider teardown or additive-capacity proof. Raw log download
is unavailable here. The existing node was not reconfigured to use this new
bootstrap/supervisor. The operator's 17:00 UTC stop/teardown obligation still
applies; job completion alone does not stop VM billing. No duplicate run was
started to replace this result.

## 6. One current Linux readiness record

S38 supplies the same immutable record to S31 (#8008 qualification) and S18
(#7888 pilot/fleet ownership), and records each recipient's actual acknowledgment
of its revision/hash. Receipt of source, interface reconciliation, native
qualification and pilot success are separate facts. Keep private machine details,
addresses, approval amounts and credential values in the private operator packet;
publish only sanitized status and nonsecret references.

The record identifies:

- Current main, merged executor, S39's designated combined head/tree, planner pin
  and exact bootstrap/profile file hashes. An earlier checked head is a checkpoint;
  obtain S39's final designation after corrections before qualification/execution.
- Approved existing Linux amd64 builder/rootfs or immutable OCI packet, its source,
  archive hash, manifest digest to local config-ID mapping, engine image identity,
  SBOM/scan/signature/provenance evidence and S31 qualification disposition.
- Actual engine/version, effective security settings, root-owned local policy and
  node architecture/OS/kernel, resource limits and available tools. The selected
  executor uses `/usr/local/bin/docker`, `/usr/bin/setfacl`, a root-owned
  `/etc/studioos/job-container-policy.json`, the pinned Node/Python contract, a
  2-CPU/4-GiB job limit and candidate/keeper UIDs 10000/10001. These are source
  requirements, not observed host facts or authorization to install/change them.
- Timestamped current runner IDs, actual OS/architecture/capability labels, group
  ID/name and repository/workflow restrictions, with the exact readback source.
  Record a 403 as unreadable. Never translate unreadable or absent evidence into
  zero runners, a disabled control or verified access.
- Independently supported machine identities and one runner process per machine.
  Runner names/IDs alone do not prove distinct hardware; two registrations on one
  host do not add the second machine. The second approved machine uses the same
  group/AND labels and distinct stable registration identity, without YAML edits.
- Current operating authorization reference, bounded window and spending/resource
  limits, stop condition, shutdown owner, teardown method and residual-resource
  verification. The November 20 one-node window is historical. An 8-GiB scaling
  ceiling does not prove 4 GiB plus OS/listener overhead is presently available.
- Observed deployed service/caller/executor controls and exact source pins,
  including the Mac exclusion. Repository defaults are declared values, not
  readback of deployed controls. Macs and included compute do not satisfy the
  first two-Linux/four-standard-hosted milestone.

If one machine alone is currently approved, finish its bounded assessment and
name the precise remaining second-machine requirements: independent approved
machine identity; matching native architecture and measured resources; the same
reviewed image/engine/security baseline; fresh operating and teardown authority;
unique organization registration in the verified restricted group; one listener;
and qualification/credential-denial/cleanup evidence. S38 neither provisions that
node nor grants a budget, broader access or admission.

The existing #8055 verifier is the acceptance consumer. No new verifier, caller
routing or fleet-builder implementation is part of bootstrap readiness. Local
fixtures exercise real filesystem/state/archive transactions with synthetic
account/service ports; they are not native privileged-install or node-isolation
evidence. The activation canary gate remains closed until its owners establish
that evidence and approve any change to the gate.
