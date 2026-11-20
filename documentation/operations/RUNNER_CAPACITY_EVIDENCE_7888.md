# Runner capacity evidence inventory (#7888)

Observed through GET-only GitHub API reads on 2026-11-20 (UTC). This is a sanitized
inventory of existing evidence, **not** the controlled proof requested by #7888.
This S18 task used GET-only reads and made no workflow dispatch, registration
change or provider-resource creation.

| Existing run | Workflow head SHA from GitHub | Overall result | Observation |
| --- | --- | --- | --- |
| [44729411217](https://github.com/AxalNetwork/StudioOS/actions/runs/44729411217/attempts/1) | `d4f183a622d94800be4496c4079d870be5bc51c1` | success | One self-hosted-labelled job, [136265026026](https://github.com/AxalNetwork/StudioOS/actions/runs/44729411217/job/136265026026), started 2026-11-20T11:39:46Z and completed 2026-11-20T11:57:10Z. This is workflow-head metadata, not independently verified tested-source/plan binding. |
| [44720587048](https://github.com/AxalNetwork/StudioOS/actions/runs/44720587048/attempts/1) | `c6d0d48a984847a2b14325c82e9616da4c3dfdcf` | cancelled | All 24 attempt jobs were enumerated. This cancelled run is not reported as a passed capacity trial. |
| [44746099004](https://github.com/AxalNetwork/StudioOS/actions/runs/44746099004/attempts/1) | `fe1c1ce6b48260e90a0c1049f0c0216701125758` | cancelled | Existing Linux smoke pilot, [job 136321717987](https://github.com/AxalNetwork/StudioOS/actions/runs/44746099004/job/136321717987), ran 2026-11-20T13:44:37Z–14:25:00Z (40m23s). Test step 11 is cancelled; step 12 is skipped. Other successful step metadata does not turn it into a completed test pass. |

The different workflow-head SHAs do not establish which identical candidate and
plan executed. D7881's benchmark narrative provides context, but this task does
not convert it into a comparable three-pool canary. The old hosted controller
waiting design also does not prove added hosted-slot capacity.

The Linux pilot was observed after it completed; S18 did not rerun or cancel it.
Its recorded execution window does not overlap the earlier Mac smoke job. Its
different workflow head and cancelled test also do not establish common-source,
common-plan compatibility. No source receipt, resource sample or billing result
was inferred from successful setup, upload or cleanup step metadata.

| Required new proof | State and reason |
| --- | --- |
| Approved temporary Linux executor with completed compatibility canary | Not recorded: the existing Linux pilot was cancelled; #7885/#7886 have not landed. |
| Verified shared organization group/profile and second-node onboarding | Not recorded: bootstrap/profile contract is pending. |
| Exact immutable executor revision and trusted source/plan receipt | Not recorded: #7886/#7887 are pending. |
| Real three-pool compatible-work overlap and no hosted wait occupancy | Not recorded: no approved three-pool canary is available. |
| Failure, fallback, cancellation, missed-event/restart and drain exercises | Not recorded live: deterministic reader/model fixtures are preparation only. |
| CPU/memory headroom, controller availability and actual provider cost | Not recorded: no approved resource samples or private provider meter were supplied. |
| Temporary budget, stop authority and verified teardown receipt | Not recorded publicly: these require private operator records and the approved lifecycle exercise. |

The report tests use synthetic fixtures and verify pagination, request limits,
identity mismatches, interval arithmetic, anonymous public output, offline/unknown
assignment, failure/cancel/skip handling and restart/duplicate behavior. They are
not live runner, lifecycle or throughput measurements. The read-only report
explicitly leaves aggregate authority unverified until its owning stages publish
their receipt interface.
