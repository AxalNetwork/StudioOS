# General agent compute — D4557 part 2

A separate, private Worker and native Durable Object Container host for approved
calculations and document extraction. Admission is off. No production binding
or deployment is introduced. The existing AgentTaskWorkflow owns the run,
retries, cancellation, proposal and human decision.

| File | Role |
| --- | --- |
| `worker.ts` | Privileged host wrapper, canonical Workspace grant store, alarm and native VM control. |
| `host.ts` | Recoverable one-job lifecycle, persisted replay fence, verified termination before publication. |
| `vm.ts` | Bounded readiness, running-image verification, deny-network start and confirmed destroy. |
| `runner.py` | Approved deterministic operations, archive validation, child resource and syscall fences. |
| `server.py` | Private single-use execution port; cryptography remains in the Worker. |
| `failureCodes.ts` | Closed failure-code vocabulary shared with the broker and Python manager. |
| `Dockerfile` | Pinned builder and minimal nonroot runtime; build tools stay outside it. |
| `requirements.txt` | All runtime Python dependencies pinned with hashes. |
| `source-lock.json` | Immutable Python builder and hash-verified zlib source. |
| `build_image.py` | Hash-checked build and runtime assembly. |
| `build_runtime.py` | Actual ELF closure with accurate package provenance for scanning. |
| `test_runner.py` | Mounted synthetic image tests; never shipped in the runtime. |
| `tsconfig.json` | Separate host typecheck with generated binding types. |

Use `scripts/build-agent-compute-types.mjs` before typechecking. Its generated
binding declaration is ignored. Use `scripts/check-agent-compute-image.py` to
build, test, scan, emit an SBOM and record local profile measurements; see
[the preview runbook](../documentation/operations/AGENT_COMPUTE_4557.md).
Add a workload only after reviewing its parser, syscall, resource, privacy and
approval boundaries. Raw scripts, shell, package installation, network and
coding workspaces are outside this host; #5566 owns coding.
