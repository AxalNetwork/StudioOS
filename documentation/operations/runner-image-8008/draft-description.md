# Prepare Linux runtime image qualification evidence (#8008)

Part of #7905. Local review only during #5719; no PR has been published.

The published executor needs a pinned native Linux image before real-node
isolation can be proved. This package records its runtime, paths, two UIDs,
environment/mount restrictions and source revisions; inventories existing
recipes; supplies an offline scratch/rootfs recipe template and input checker;
and separates build reproducibility, SBOM/scan, signature/provenance, approval
and actual-node tests. `D8008` records the child decision.

**Image status: qualification pending.** No image was acquired, built, scanned,
signed, published or enabled. Exact rootfs/system and tool pins, upstream
authentication, immutable build evidence and actual-node proof are missing.
The denied #5566 image is excluded. AGENT_ENGINE remains off.

Validation and actual command exits are recorded in `evidence.json`. The source
check is not native qualification. Child files and the owner-authorized shared
operations README registration are edited: executor,
bootstrap, profiles, workflows, `infra/runners/` and S18 lifecycle are untouched.
Source hashes/pins, 364 selected Node engine ranges, Python/shell syntax and
decision checks pass. Build-input preflight refuses with exit 2 as expected.
The shared operations README entry is now included; the documentation guard's
latest result is recorded in `evidence.json`.
Docker, BuildKit, syft, trivy, cosign and shellcheck are unavailable locally.

Actual qualification follow-up corroborated the runtime pins against official
HTTPS release metadata, acquired and verified both archives, identified bundled
npm 10.9.9 and inventoried 11 x86_64 ELF files without executing them. Current
published main `270cdf4a2ad4d7d1fb57cf6315cca7e6e416e3b0` preserves the runtime
pins/container predicate and passes all 364 selected Node engine checks. S18's
current published image metadata remains unapproved with null digests. Delivered S09
source c36bf920 is now independently ingested and its image/engine requirements
reconciled. Approved native builder/rootfs, intended-node baseline and actual
build/scan/native evidence are still required from the operator.
`qualification-progress.json` contains actual evidence and remaining gates.

Coordinator handoff: integrate the local patch/bundle after review and when the
publication hold permits. S18 owns builder integration; S09 owns adapter and
real-node proof. The owner explicitly authorized completing the append-only
`documentation/operations/README.md` entry in this local handoff.

Prepared deliverables do not establish #7905 readiness or close that parent.
