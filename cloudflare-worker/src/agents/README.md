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
| `doRuntime.ts` | The `do` runtime: `ScopeCore` (admission one at a time, duty timers on alarms, rebuild, erase) over a storage interface, the `AgentScope` Durable Object that wraps it with a hibernatable status socket, and the runtime over the binding. |
| `engine.ts` | The D1 side: a scope's settings, `admitInScope` (every admission check, then the run row), a run's timeline, a task's status and board column, pauses and who is told. |
| `loop.ts` | The loop's steps as plain functions (`load`, `context`, `run`, `propose`, `after`), `runTaskLoop` over a step interface, and `deliverDecision`. |
| `taskWorkflow.ts` | `AgentTaskWorkflow`: the Workflow class, a binding around `loop.ts` and nothing else. |
| `agentQueue.ts` | The agent queue's producer and consumers, and `dispatchQueue`, the `queue()` handler's routing (the agent branch before the `dlq` test). |
| `sweep.ts` | The every-minute dispatcher's agent sweep (`% 5 === 1`): resend lost messages; with `self_start`, offer each idle agent its next ready task. At most 60 a minute. |
| `erasure.ts` | The product amendment: an agent removed, a scope deleted or an account erased ends its runs and empties its object. |

**The rule for adding here.** Only the sdk runtime's own file, sdkRuntime.ts
(not built; E0 evaluates it), may import the `agents` package; `agent_runtime_contract.test.ts` fails on
any other import. A new runtime implements `AgentRuntime` and joins the
contract suite's `RUNTIMES` before `AGENT_RUNTIME` may name it. Step logic
goes in `loop.ts` as a plain function, never inside a class that only the
Workers runtime can load. Bound SQL only; codes in logs, never a prompt, an
output or a name; a cost that cannot be read is `{ available: false }`.
`agent_engine_d1528.test.ts` covers the loop, the queue, the routes and
erasure; `agent_runtime_contract.test.ts` the runtime contract;
`agent_engine_bindings_d1528.test.ts` the bindings in wrangler.toml's three
tables and a branch's config.
