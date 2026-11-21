# Evidence gates for S09/S18 and coordinator (#8008)

**Qualification pending.** All commands below are a prepared procedure unless
listed as executed in `evidence.json`. Do not execute build/download/publication
or node operations during #5719's hold. No alternative route around a managed
denial is allowed. The owner chooses approved builder/tools and immutable inputs;
no tool tag, package version or signing identity is guessed here.

## 1. Source and input review

Recheck `contract.md` against the exact executor revision the owner will deploy.
Record differences from all four manifest source revisions. Reuse S18's recipe
if it has become available; retire this template rather than creating a second
builder. Resolve each `missing_inputs` entry through explicit reviewed evidence.
Record the official distro archive/snapshot, every system package's version,
source and byte digest, compiler/configuration for anything built from source,
license, archive extraction permissions and a complete transitive library ledger.
Include the utilities used by the recipe as well as runtime commands.

Authenticate Node's official SHASUMS and release signature with the release-key
policy; authenticate Python standalone release checksums/attestations with its
official release policy. Compare them to the source-recorded SHA256s. Any mismatch
blocks and returns to S09; do not silently alter the profile. The manifest's
official URLs were extracted from source, not treated as proof of authenticity.
Review rootfs contents for setuid/setgid bits, unexpected executable files,
secrets, package caches and host-specific files. UID 10000/10001 must have no
writable runtime files. Rootfs passwd/group entries must not embed private data.

Acquire approved inputs only through permitted routes, outside this package.
Run `verify-inputs.py --context <offline-context>` before invoking a builder;
it currently refuses. Build context must contain only the three named archives
and the reviewed recipe. Never include a checkout's `.git`, `.env` or tokens.

Lockfile hashes and Linux x64 native archive SRI values are in `components.json`.
Validate npm's SRI during clean `npm ci`, without updating locks. Node 22.23.3
must satisfy the engine constraints of selected Linux/glibc packages. Static
review checked 364 selected engine requirements with semver 7.8.5: zero
mismatches for 22.23.3; 192 other-platform entries were excluded. This static
result is recorded in `evidence.json` and does not replace clean native installs.
The lock also lists unselected platforms: `@img/sharp-win32-ia32` requires ^20.9.0 but
is Windows-only, so is not a Linux Node-version conflict. Musl-only native
packages are likewise not part of this glibc image. The installed dependency
inventory must explain selection rather than report all optional variants as
present. Workerd, esbuild, sharp/libvips, lightningcss, rolldown/oxc and other
selected native modules must actually execute; a compatible engine range alone
does not prove ABI or syscall support. npm version and install lifecycle behavior
are captured from the verified bundled npm, not from the workstation.

## 2. Native reproducible build (not performed)

S18 uses its approved builder on native Linux amd64 (emulation is not native
qualification). Record builder image/binary digest, kernel/runtime version,
build frontend version, complete command/exit and build logs. Set a reviewed
SOURCE_DATE_EPOCH from the source commit; normalize file ownership, ordering,
mode and timestamps in rootfs/runtime archives and OCI metadata according to the
approved builder. Do not rewrite authenticated archive bytes before verifying
their original hashes; normalization must be a recorded deterministic stage.

Build twice from identical verified inputs in independent clean contexts with
no mutable package repositories or network fetches. Compare OCI layer digests,
config digest and manifest digest. Differences must be explained and removed
before calling the build reproducible. This template alone does not normalize
all image or layer metadata; builder settings are a missing input.

Save the exact OCI archive hash, linux/amd64 manifest digest and config digest.
Inspect config Env (empty), User 10001:10001, no Volumes, and read/execute modes.
The runtime supervisor overrides entrypoint and supplies exactly six environment
entries. Loading the archive for later tests must map its manifest/config to the
local `docker image inspect` ID used by the root-owned policy. Do not substitute
a registry index digest or tag into that field. No registry push is part of this
child. Do not add Docker/listener software to satisfy host dependencies.

## 3. SBOM, immutable scan and signatures (not performed)

Before use, pin syft, trivy and cosign (or the owner's equivalent tools) by exact
version and official release checksum/signature. Record each tool's digest and
`--version` output. Do not use `latest` or install scanners in the candidate.
For the exact built OCI archive, prepare commands using those reviewed versions:

```sh
syft oci-archive:runtime.oci.tar -o cyclonedx-json=runtime.sbom.json
trivy image --input runtime.oci.tar --format json --output runtime.scan.json
```

These are command shapes, not evidence or fixed tool-version claims. Record
actual invocation, scanner exit/status, full report hashes, scan time, database
metadata and immutable database snapshot digest. A default scanner exit 0 can
still contain vulnerabilities; compare report findings against the owner's
existing acceptance policy with no new waiver. Scanner errors, missing database,
unsupported components or missing packages block approval. Keep finding details
in the restricted handoff; issue STATUS contains only outcome and artifact hashes.

The image SBOM must cover rootfs, Node and bundled npm, Python/stdlib and linked
libraries. App dependencies are installed into tmpfs at run time; produce a
separate installed dependency SBOM from both clean lock installs and reconcile
selected versions/SRI with the locks. Scan that dependency SBOM too. Do not claim
the static image SBOM covers transient app dependencies or that a lock inventory
is an image SBOM. Record unsupported/undetected components explicitly.

Prepare SLSA provenance binding the manifest digest to source SHA, recipe hash,
all input hashes, builder identity, toolchain/settings and build log hashes.
The operator signs the immutable image digest and provenance under its existing
policy. Verify signature and attestation against the expected issuer/subject or
approved key, not merely the presence of a signature. Typical later commands
are `cosign verify --certificate-identity <approved-subject>
--certificate-oidc-issuer <approved-issuer> <image>@sha256:<manifest>` and
`cosign verify-attestation ... --type slsaprovenance <image>@sha256:<manifest>`.
Identity values and actual commands are unresolved owner inputs. For offline
handoff use the approved bundle verification procedure. This child performs no
signing, registry access, OIDC use or publication.

## 4. Native runtime and actual-node boundary (not performed)

S09 first reconciles the workflow/adapter integration discrepancy in `contract.md`.
On an explicitly authorized isolated canary, use the reviewed JobContainer and
its ownership/receipt cleanup, not a hand-written relaxed `docker run`. The
operator must demonstrate host inspection of all restrictions, mount ACLs,
namespace separation, exact image ID, runtime versions, both UIDs and deadlines.
The root-owned policy remains outside candidate-writable paths. No operator flag
or JSON receipt alone constitutes isolation evidence.

Run `native-probe.sh` as 10000:10000 inside that verified container. Preserve
stdout, stderr, exit and image/source identities. It exercises native SQLite
FTS5/JSON, Python extension loads/trust/locale/timezone, paths and representative
write/exec restrictions. Its negative write tests alone do not prove read-only
mounts; host inspection remains mandatory. It does not prove absence of all
credentials. S09 owns an actual canary against synthetic listener markers and
synthetic OIDC material proving candidate cannot read them, use the socket,
see listener processes or escape through mounts. Never probe real secrets or
publish marker contents. Confirm that root/keeper and listener isolation are
different roles; a second username alone is insufficient.

For every eligible worker shard use a fresh owned container, the exact trusted
source/plan, original admitted synthetic event and production candidate command.
Preserve both `npm ci` logs, lock hashes before/after, selected native dependency
versions, shard exit/duration and trace hashes. Demonstrate cancellation/deadline
and ownership-safe exact cleanup, including failures; never broad-remove a pool.
All six shards and negative boundary tests must pass before parent readiness.
No fixture run or Darwin success substitutes for this native evidence.

## 5. Approval record and handoff

For each gate record status PASS / FAIL / UNKNOWN / NOT RUN, exact source and
image identities, command exit, tool versions, evidence URI/hash, reviewer and
UTC time. Source review, reproducibility, SBOM completeness, scan acceptance,
signature/provenance verification, image approval and actual-node proof are
separate records. The final image status stays **qualification pending** until
real immutable build and accepted scan evidence exist; an approved image still
does not authorize node enablement while other parent gates or #5719 remain.

Return S18 the recipe/input blockers and S09 the contract/integration findings.
The coordinator owns any append-only shared README registration, PR publication,
admin actions and rollout. No parent claim, branch, workflow or lifecycle file
changes in this child.
