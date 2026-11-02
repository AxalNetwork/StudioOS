# src/agents — the agent engine runtime (D1528)

E3 of #3742 (#3847). The agent engine's runtime: what admits an agent's run,
runs its steps, waits for a person's decision and stops when told to. It
never decides anything itself: a run's output is always a proposal in
#3727's approvals queue (`cloudflare-worker/src/services/agents/queue.ts`), and a person decides
it. Everything here is off unless `AGENT_ENGINE` is not `off` and
`TEAM_AGENTS_ENABLED` is `true`. Migration 728 holds its tables; decision
`documentation/architecture/decisions/D1528.md` explains it; the runbook
`documentation/operations/AGENT_RUNTIME_SWITCH.md` says how to stop it and how
to switch runtimes.

| File | What it does |
| --- | --- |
| `runtime.ts` | The seam: the `AgentRuntime` interface (`admit`, `schedule`, `cancelSchedule`, `startRun`, `status`, `halt`, `rebuild`, `erase`), `agentRuntime(env)`, and the kill switch as every caller reads it (`AGENT_ENGINE`, the `agents:halt` key, the `agents:paused` circuit breaker, `AGENT_AUTONOMY`, `AGENT_RUNTIME`). |
| `sdkScope.ts` | The `sdk` runtime's behaviour without the `agents` package (#3852, E0): `SdkScopeCore` over the slice of the SDK's `Agent` it uses (`state`, `schedule`, `runWorkflow`), the path protocol, and the runtime over a caller. |
| `sdkRuntime.ts` | The `sdk` runtime: `ScopeAgent extends Agent` (the only import of the `agents` package), reached over RPC through `AGENT_SCOPE_SDK`. An evaluation; `AGENT_RUNTIME` stays `do`. |
| `doRuntime.ts` | The `do` runtime: `ScopeCore` (admission one at a time, duty timers on alarms, rebuild, erase) over a storage interface, the `AgentScope` Durable Object that wraps it with a hibernatable status socket, and the runtime over the binding. |
| `engine.ts` | The D1 side: a scope's settings, `admitInScope` (every admission check, then the run row), a run's timeline, a task's status and board column, pauses and who is told. |
| `loop.ts` | The loop's steps as plain functions (`load`, `context`, `run`, `propose`, `after`), `runTaskLoop` over a step interface, and `deliverDecision`. |
| `taskWorkflow.ts` | `AgentTaskWorkflow`: the Workflow class, a binding around `loop.ts` and nothing else. |
| `agentQueue.ts` | The agent queue's producer and consumers, and `dispatchQueue`, the `queue()` handler's routing (the agent branch before the `dlq` test). |
| `sweep.ts` | The every-minute dispatcher's agent sweep (`% 5 === 1`): resend lost messages; with `self_start`, offer each idle agent its next ready task. At most 60 a minute. D1530 (#3849, E5): `sweepAgentDuties` claims the due duties (claim before act) and applies the memory retention. |
| `erasure.ts` | The product amendment: an agent removed, a scope deleted or an account erased ends its runs and empties its object. D1530 (E5): `eraseAccountAgents` adds the D1 half (notes, run summaries, queued tasks) for the manual account erasure. |

**The rule for adding here.** Only the sdk runtime's own file, sdkRuntime.ts,
may import the `agents` package; `agent_runtime_contract.test.ts` fails on
any other import, and `agents_sdk_rules_3852.test.ts` holds the sdk runtime to
the three rules (no model call but through `run()`, no SDK tool, no approval
but the approvals queue). A new runtime implements `AgentRuntime` and joins the
contract suite's `RUNTIMES` before `AGENT_RUNTIME` may name it. Step logic
goes in `loop.ts` as a plain function, never inside a class that only the
Workers runtime can load. Bound SQL only; codes in logs, never a prompt, an
output or a name; a cost that cannot be read is `{ available: false }`.
`agent_engine_d1528.test.ts` covers the loop, the queue, the routes and
erasure; `agent_runtime_contract.test.ts` the runtime contract;
`agent_engine_bindings_d1528.test.ts` the bindings in wrangler.toml's three
tables and a branch's config.
