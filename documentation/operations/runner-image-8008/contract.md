# Source contract and recipe inventory (#8008)

Reviewed source is immutable, not the workstation's installed runtime:

| Source | Revision | Result |
| --- | --- | --- |
| Planning main | `c2fb23a5cc4e440268dce3c65c579a0ee21bf469` | Starting reference from #8008. |
| Chosen newer main | `d990215df2ed696f6b7572b904afe2c96a653f7b` | Local package base; component manifest records file SHA256s. |
| #7981 | `db11f2f3da613f3542d2bf8f736acaa35735457d` | Profiles, job-container and runner-execution match chosen main. |
| #7972 | `513da8c5bf32eda4a4e8818f6fbbcd9bed63275c` | Also reviewed its executor-isolation adapter; host admission requires Docker and `/usr/bin/setfacl`. |
| Qualification follow-up main | `270cdf4a2ad4d7d1fb57cf6315cca7e6e416e3b0` | Profile and verifiedContainer predicate unchanged; ACL/adapter now published. Exact unpublished S09 artifact still requested. |

Inventory `git ls-tree -r --name-only <revision>` at all four references, including
Dockerfile/Containerfile, runner/image and rootfs paths: no candidate Linux job
image recipe was found. `agent-compute/Dockerfile` and `meeting-bot/Dockerfile`
serve different products and are not reused. No `infra/runners/` builder was
present in those published trees. This does not assert that S18 has no unpublished
builder; return this template/input ledger to S18 for reuse, not a competing fleet
implementation. The inaccessible historical workspace is not a prerequisite.
The later follow-up main contains S18's `infra/runners/linux-x64.image.template.json`,
but it is explicitly unapproved and every image/runtime digest/version is null.
It is disabled metadata, not a rootfs/build recipe or qualified image.

## Native runtimes and executables

`scripts/ci/runners/profiles.json` pins Linux x86_64 / Node `x64`, Node **22.23.3**,
Python **3.11.18** (python-build-standalone release **20261110**). Official URLs,
archive directories and SHA256s are in `components.json`. Node's bundled npm
must come from that same verified archive, never replaced with `npm@latest`.
The acquired archive contains npm 10.9.9; it has been inspected without execution.
Native invocation remains a qualification gate.
Node's native `node:sqlite` must implement FTS5 and JSON functions. Python must
load its SSL, SQLite, compression and native-extension libraries.

Required paths are `/bin/sh`, `/usr/local/bin/node`, `/usr/local/bin/python3`,
and PATH-resolved `npm`, `sleep`, `mkdir`, `cp`, `chmod` and `git`. `printf` can
be the POSIX shell builtin. The bootstrap checks Git >=2.39.0 and <3.0.0;
an exact package/source checksum is still missing. The rootfs must provide
glibc/ELF loader, compatible libstdc++/libgcc and all shared libraries actually
linked by these binaries and lockfile native modules, CA trust, UTF-8 locale,
DNS/NSS and timezone data. Exact versions, archive hashes, distro snapshot and
transitive dependency ledger for these are missing; discover the complete set
with ELF inspection and the SBOM, not this illustrative list alone.
Static inspection of the acquired archives identifies the ELF interpreter
`/lib64/ld-linux-x86-64.so.2` and dependencies including `libcrypt.so.1`,
libstdc++ and Tcl/Tk. These findings are recorded in qualification-progress.json;
they do not establish that any rootfs supplies the required ABIs.

The host-only runner 2.338.2, root-owned policy, Docker at
`/usr/local/bin/docker`, `setfacl` and Docker's init are not candidate-image
components. They belong to S09/S18's host qualification. Do not install or mount
the listener, credentials, engine socket or enrollment material in this image.

## Runtime identity and metadata

The keeper is `10001:10001`; image Config.User must agree. Entrypoint is
overridden to `/bin/sh`, command `-c 'sleep "$STUDIOOS_JOB_MAX_SECONDS"'`.
The candidate and native-version probes execute with `--user 10000:10000`.
Both must read/execute runtime files; neither may modify them. Candidate owns
only the writable tmpfs paths. User/group names are convenience, numeric IDs
are the contract. No image-declared volumes or additional mounts are allowed.

Container Env must have exactly six entries: `PATH=/usr/local/bin:/usr/bin:/bin`,
`HOME=/work/home`, `LANG=C.UTF-8`, `CI=true`, `TZ=UTC`, and
`STUDIOOS_JOB_MAX_SECONDS=<positive remaining deadline, <=1590>`.
Inherited base-image environment entries would fail `verifiedContainer`.
The scratch-rootfs template deliberately declares no ENV or VOLUME.

## Engine restrictions and mounts

`job-container.mjs` uses `--pull=never` with a local image **config ID**
`sha256:<64 lowercase hex>`. This is not the registry manifest digest. Record
both and verify their mapping after loading the approved artifact. The policy
requires version 1 and exact nodeVersion/pythonVersion above; policy file and
every parent must be root-owned, not group/other-writable or symlinked. The
opened file is regular, single-link and <=4096 bytes. Never supply policy via
workflow input or candidate environment.

Required: read-only root filesystem, init, cap-drop ALL, no cap-add,
no-new-privileges, nonprivileged, separate PID/mount namespaces, private IPC and
cgroup namespace, default separate PID mode, bridge network, no ports/devices,
DeviceRequests, volumes-from, extra-hosts or links. Limits are 256 processes,
4294967296 bytes RAM, 2 CPUs. Exactly these tmpfs entries:

```text
/work rw,nosuid,nodev,size=4294967296,uid=10000,gid=10000,mode=0700
/tmp  rw,nosuid,nodev,noexec,size=268435456,uid=10000,gid=10000,mode=0700
```

`/work` permits execution for native npm dependencies. Only two bind mounts:
trusted source -> `/input`, plan file -> `/input-plan.json`, both read-only,
`rprivate`. No host HOME, caches, listener or socket binds. Trusted staging ACLs
must allow candidate read access. Cleanup inspects and removes only the exact
owned container ID with matching receipt and ownership label.

## Candidate command and integration limit

The runner creates `/work/source`, `/work/home`, `/work/traces`; copies `/input/.`
into `/work/source`; applies `chmod -R u+rwX`; synthesizes `/work/event.json` from
the admitted parent; unsets ORIGINAL_EVENT; exports GITHUB_EVENT_PATH,
TEST_TRACE_DIR, TEST_TRACE_ROOT and TMPDIR. It runs, in order:

```sh
npm ci --prefix cloudflare-worker
npm ci
node scripts/test-drift-parts.mjs "$PART" --plan-file /input-plan.json
```

Each `worker-1-of-6` through `worker-6-of-6` must qualify independently from
clean tmpfs. Candidate execution timeout is at most 25 minutes and remaining
receipt deadline. No auth tokens are in this synthetic candidate environment.
Network bridge/TLS/npm registry availability are prerequisites, not isolation
evidence. Native Linux x64 lockfile entries and engine requirements are recorded
without substituting packages from the Darwin workstation.

Source review is not proof of wiring. The original package base lacked the
#7972 executor-isolation adapter; it is present on the later follow-up main.
The final unpublished S09 lifecycle/integration artifact is still requested
through the operator and must be checked before a real run. This child edits neither
executor nor workflow and claims no end-to-end isolation. Mac and hosted lanes
remain separately unqualified.
