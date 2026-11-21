# Source contract and recipe inventory (#8008)

Reviewed source is immutable, not the workstation's installed runtime:

| Source | Revision | Result |
| --- | --- | --- |
| Planning main | `c2fb23a5cc4e440268dce3c65c579a0ee21bf469` | Starting reference from #8008. |
| Chosen newer main | `d990215df2ed696f6b7572b904afe2c96a653f7b` | Local package base; component manifest records file SHA256s. |
| #7981 | `db11f2f3da613f3542d2bf8f736acaa35735457d` | Profiles, job-container and runner-execution match chosen main. |
| #7972 | `513da8c5bf32eda4a4e8818f6fbbcd9bed63275c` | Also reviewed its executor-isolation adapter; host admission requires Docker and `/usr/bin/setfacl`. |
| Qualification follow-up main | `270cdf4a2ad4d7d1fb57cf6315cca7e6e416e3b0` | Profile and verifiedContainer predicate unchanged; ACL/adapter now published. Exact unpublished S09 artifact still requested. |
| Delivered S09 qualification source | `c36bf920613ff28bb7c3571d78994cf1a5d7f18c` | Verified cumulative bundle; parent cc3c3367, base 4d604798, tree 1b87eae7. This snapshot supersedes the earlier keeper/export contract below. Profiles remain byte-identical. |

The c36 source is now received and independently checked, not an outstanding
input. Exact file hashes and intake commands are in `qualification-progress.json`.
A later S39 composition needs reconciliation at its own exact revision.

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
and PATH-resolved `npm`, `sleep`, `date`, `mkdir`, `cp`, `chmod` and `git`. `printf` can
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
overridden to `/bin/sh`, with the exact c36 command:

```sh
exec sleep "$(( STUDIOOS_JOB_DEADLINE - $(date +%s) ))"
```

POSIX shell arithmetic, `date +%s` and `exec sleep` are required. Integer clock
rounding and scheduling remain native measurement gates, not a proven bound.
The candidate and native-version probes execute with `--user 10000:10000`.
Both must read/execute runtime files; neither may modify them. Candidate owns
only the writable tmpfs paths. User/group names are convenience, numeric IDs
are the contract. No image-declared volumes or additional mounts are allowed.

Container Env must have exactly six entries: `PATH=/usr/local/bin:/usr/bin:/bin`,
`HOME=/work/home`, `LANG=C.UTF-8`, `CI=true`, `TZ=UTC`, and
`STUDIOOS_JOB_DEADLINE=<positive absolute epoch seconds>`.
Creation checks remaining time >90000ms and <=1590000ms, then rechecks the finish
reserve after staging. The environment contract no longer uses MAX_SECONDS.
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

The install phase creates `/work/source`, `/work/home`, `/work/traces`; copies `/input/.`
into `/work/source`; applies `chmod -R u+rwX`; synthesizes `/work/event.json` from
the admitted parent; unsets ORIGINAL_EVENT; exports GITHUB_EVENT_PATH,
TEST_TRACE_DIR, TEST_TRACE_ROOT and TMPDIR. It runs, in order:

```sh
npm ci --prefix cloudflare-worker
npm ci
node scripts/test-drift-parts.mjs "$PART" --plan-file /input-plan.json
```

Each `worker-1-of-6` through `worker-6-of-6` must qualify independently from
clean tmpfs. Install and test run as separate exec phases in the same verified
container, rechecked before testing. Each phase uses the remaining absolute
deadline minus the 90000ms finish reserve, not a fresh 25 minutes per phase.
The supervisor retains the container through capture/export and preserves raw
test exits separately from engine failure. No auth tokens are in this synthetic candidate environment.
Network bridge/TLS/npm registry availability are prerequisites, not isolation
evidence. Native Linux x64 lockfile entries and engine requirements are recorded
without substituting packages from the Darwin workstation.

Source review is not proof of wiring. The original package base lacked the
#7972 executor-isolation adapter; it is present on the later follow-up main.
The delivered c36 workflow removes host candidate install steps and supplies
the lifecycle/export path. Its future S39 composition still needs exact-revision
review and real-node acceptance. This child edits neither
executor nor workflow and claims no end-to-end isolation. Mac and hosted lanes
remain separately unqualified.

## Delivered engine and host requirements

c36 pins `/usr/local/bin/docker`, but no exact engine/client/server version or
binary digest. It also supplies no approved candidate image config ID or OCI
manifest digest; those must come from the reviewed operator policy/build evidence.
Record and qualify those operator inputs rather than inventing
a minimum Docker version. Besides all inspections/flags above, the engine must
pause/freezer the exact container, preserve its tmpfs, and stream
`docker cp <exact-id>:/work/traces -` from the paused container. Removal is
inspect -> exact rm -> independent absence verification; unreadable state is
not absence. Record real engine exit/error behavior, not mocked English errors.

The actual copied bytes must pass c36's `ustarReader`: uncompressed USTAR
`ustar\0` / `00`, no prefix field, GNU/PAX extensions, links, nested files or
unexpected members; direct trace files are UID/GID 10000 and mode 0600 or 0644.
Limits are 4096 files, 1MiB/file, 64MiB expanded, 80MiB archive and 2MiB seal.
Preserve the raw engine archive hash and parse it with the exact delivered
reader. Unsupported format is a qualification failure, not permission to relax
the parser. The completion envelope remains `native-unqualified` in this source.

The trusted host also needs `/usr/bin/setfacl`, readable `/proc` namespace
metadata, and private recovery/export storage supporting exclusive no-follow
opens, fsync of files/directories and atomic rename. Recovery state is outside
disposable job staging and never candidate-mounted. ACL calls have a source
20s limit; the supervisor's 60s removal and 90s finish reserves are source
constants, not established native latency bounds. S32's prior budget/cancellation
findings need disposition against the final composition. No host operating
window or engine/security baseline is supplied by this source packet.
