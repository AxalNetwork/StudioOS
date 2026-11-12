# General compute — local verification and owner-gated preview

D4557 part 2 implements the host and broker, with admission off. This document
is a handoff, not authorization to create an application or deploy. Follow
[D4554 §5](../architecture/decisions/D4554.md) and
[D4557 part 2](../architecture/decisions/D4557-p2.md).

## Reproduce local evidence

Use Node 22, Docker Linux x86-64, Python 3 and Trivy 0.76.2. Install repository
and Worker dependencies using their lockfiles. Generate source and bindings:

```sh
node scripts/build-generated.mjs
node scripts/build-agent-compute-types.mjs
cloudflare-worker/node_modules/.bin/tsc -p agent-compute/tsconfig.json --noEmit
cloudflare-worker/node_modules/.bin/wrangler deploy --config wrangler.agent-compute.toml --env preview --dry-run --containers-rollout none --outdir /tmp/compute-host
python3 scripts/check-agent-compute-image.py --trivy /path/to/trivy --output /tmp/compute-image-evidence
```

The dry-run packages the Worker and explicitly skips container rollout. The
image script separately builds the real image, tests nonroot/read-only/no-network
execution, approved formats, hostile archives, syscall fencing, hard CPU/wall/
memory termination and one-use private HTTP handling. It scans HIGH/CRITICAL
without suppression, refuses an unrecognized OS, emits a CycloneDX SBOM including
upstream CPython/zlib, and records three synthetic samples at each of two local
CPU/memory profiles. Its local image configuration ID is **not** an OCI registry
manifest digest. An optional `--ca-file` is a build-only trust mount; it is not
copied into runtime. The PR workflow runs the same local checks with read-only
repository permission, without registry or Cloudflare credentials.

Run `python3 scripts/check-agent-compute-mutations.py --image studioos-agent-compute:local`
to check guard mutations in an isolated source copy and mounted image fixtures.
The script requires assertion failures, then verifies restored controls.

## Owner configuration receipt — before any remote action

Record nonsecret references in a private operator receipt, never credentials or
user payloads in GitHub:

1. Exact merged candidate SHA and independent vendor security review. Choose
   default scheduling with a deprecation/migration plan or approve durable_object
   before creating either immutable application. For the newer policy, update
   both configuration and `COMPUTE_SCHEDULING_POLICY` consistently with current
   Cloudflare configuration; named pinned images/instance startup replace
   default-policy image, instance_type and max_instances fields.
2. Approved isolated account, jurisdiction/regions, instance profiles, concurrency,
   test data classification, budget and D4566 isolation receipt. Confirm
   entitlements and native network/metadata/process/filesystem isolation on the
   actual provider; local Docker tests do not establish hosted capability.
3. Publish the reviewed image through an approved protected-main pipeline.
   Attach signed provenance, SBOM, fresh scan and immutable **OCI manifest digest**.
   Pin that exact digest for both applications and broker evidence. Verify
   `container.inspect().image` identifies it under the chosen policy; empty
   metadata fails closed. No floating tag is acceptable.
4. Provision the preview host's `BROKER` to the isolated API Worker, private
   `AGENT_COMPUTE_HOST` service binding back to the host, and matching secret-store
   references for host `COMPUTE_CONTROL_SECRET` and broker `AGENT_COMPUTE_SECRET`.
   The VM receives neither. Provision the broker's `AGENT_COMPUTE_POLICY_JSON`
   from `ComputePolicy` in computeBridge: exact image/provenance/scan receipts,
   provider capability/isolation evidence, template repo/base SHA, CPU, allowed
   regions, cost budget, per-workload worst-case cost ceiling and retention TTL.
   Do not copy the synthetic fixture's evidence or prices.
5. Apply the new migration only to isolated D1 through the existing migration
   ledger; provision isolated private FILES R2. Keep broker `AGENT_COMPUTE=off`
   and host `COMPUTE_ENABLED=off` while verifying bindings and rollback.
   Production gets no host binding or policy in this PR.

The checked-in preview service name is a placeholder, not proof of isolation.
An approved preview overlay must use verified resources. The manual `agent-compute-preview.yml` workflow is inert until the owner sets
`COMPUTE_PREVIEW_GATE_ENABLED=true` and configures the independently protected
`agent-compute-preview` environment (required reviewer, prevent self-review).
It accepts only an owner dispatch on the exact main SHA and an approval receipt.
Provision the environment's `COMPUTE_PREVIEW_IMAGE_REF`,
`COMPUTE_PREVIEW_IMAGE_SIGNER_WORKFLOW`, `COMPUTE_PREVIEW_HOST_NAME`,
`COMPUTE_PREVIEW_BROKER_NAME`, `COMPUTE_PREVIEW_DEFAULT_POLICY_REAFFIRMED`,
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` through approved stores.
It authenticates to GHCR with a read-only workflow token, verifies GitHub OCI
provenance from the approved signer and exact source commit, clears registry
credentials on completion, and deploys
only the disabled host. The referenced protected-main publish/signing pipeline
and signature review remain operator prerequisites; this PR never publishes an
image. The manual workflow intentionally supports only a reaffirmed default
policy; choosing durable_object requires a reviewed configuration/workflow
change first. Broker deployment, migration, secrets and enablement retain their
separate approvals.

## One end-to-end preview receipt

After owner approval of the concrete configuration, enable only that preview.
Use a synthetic sponsor, private company/project, agent and manual task with an
allowed role-book proposal option. Stage a request via
`POST /api/agent-compute/tasks/:id/requests`, upload exact bounded bytes with
`PUT /api/agent-compute/requests/:uid/inputs/:name`, mark it ready with
`POST /api/agent-compute/requests/:uid/ready`, then use existing task admission.

Record candidate, OCI image and deployment IDs, chosen scheduling policy,
observed region, grant generation, job UID and timing/usage metadata only.
Verify one native VM, no Internet/metadata access, no Worker/provider/R2 keys,
CPU/RSS/wall/output bounds and a private result downloadable only by its owner.
The existing Workflow must produce exactly one unapproved human proposal.
Exercise grant tamper/replay/wrong-scope, permission revocation, concurrent
quota refusal, cancel before/during parsing, lost callback/event, late callback,
DO reconstruction, stop failure, expiry and account/scope erasure. Confirm no
surviving VM or retained expired data. Independently compare provider-reported
usage/cost with the approved envelope; unknown readings remain Not recorded.

## Rollback and acceptance

Set broker `AGENT_COMPUTE=off` first, then host `COMPUTE_ENABLED=off` to stop new
admission. Existing cancellation/status/forget stay available while disabled.
Cancel outstanding compute runs with the existing Worker lifecycle; poll
cleanup until native termination is confirmed. Do not remove bindings/secrets
while cleanup is unknown. Check expired-object sweep and erasure. Revert the
preview host/broker deployment only after outstanding VM cleanup; do not roll
back or delete the additive metadata migration as a shortcut.

Attach the private receipt's nonsecret reference to #4557. Close only after
independent review and owner acceptance of hosted proof. Local build/scan and
a merged implementation do not authorize production enablement.

This host currently accepts only an explicitly approved worldwide region policy
(`allowed_regions: ["global"]`). The native adapter has no verified regional
placement control; restricted-region requests fail closed even if a policy
claims them. Do not substitute a DO location hint or jurisdiction for Container
residency. A future regional mode requires a separate reviewed enforcement path.

The manual workflow requires a current GitHub CLI with attestation support.
The [official verification reference](https://cli.github.com/manual/gh_attestation_verify)
defines its signer/source-digest constraints and requires registry authentication
for OCI verification. These flags were checked against that reference; the
owner-gated remote deployment has not been run.
