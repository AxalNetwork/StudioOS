### Agent engine E3: the runtime (D1528, #3847)

The same router (`routes/agent_engine.ts`), flag and gates. A start goes through the runtime's seam (`cloudflare-worker/src/agents/runtime.ts`): the scope's `AgentScope` object admits the run (`agents/engine.ts`, migration 728's `agent_task_runs` and `agent_scope_settings`), the agent queue starts its `AgentTaskWorkflow` instance, and the run's proposal waits in #3727's approvals queue above. The client is `agentEngineApi` (`taskQuote`, `startTask`, `agentRuns`, `run`, `cancelRun`, `engine`, `setEngine`). With the engine `off` or `paused`, #3727's `POST /api/teams/agents/:uid/run` still runs an agent by hand. `Run` is `{ uid, agent: { uid, role_key, first_name, last_name }, task: { uid, title }, attempt, status, step, refusal, proposal_uid, started_at, ended_at, cost: { available, value_microusd } }`; a step summary never holds a prompt.

| Route | Gate | What it does |
| --- | --- | --- |
| `GET /api/teams/tasks/:uid/quote` | manage, or the assigned agent's sponsor | `{ quote: { available, value_microusd } }` (`agentQuote`), `available: false` when the price cannot be read. 403 `not_manager`; 409 `not_ready` (no agent, module or option); every quote refusal in its own words. |
| `POST /api/teams/tasks/:uid/start` | manage, or the assigned agent's sponsor | 202 `{ run }`. 403 `engine_paused` (engine paused, halted, circuit breaker set, or canary without an admin starting) / `scope_paused`; 409 `agent_busy` (single flight) / `scope_busy` (`max_parallel_runs`) / `queue_full` (5 proposals waiting) / `not_ready` / `agent_not_live`; 503 `engine_unavailable` (no object binding). |
| `GET /api/teams/agents/:uid/runs` | read | `{ runs: [Run] }`, newest first, at most 50. |
| `GET /api/teams/runs/:uid` | read | `{ run, steps: [{ name, status, at, summary }], cost }`. |
| `POST /api/teams/runs/:uid/cancel` | manage | `{ run }`: the instance is terminated, the run `cancelled`, the task open again. 409 `not_running`. |
| `GET /api/teams/:scope/:id/engine` | read | `{ engine: 'off' \| 'paused' \| 'canary' \| 'on', halted, scope_paused, max_parallel_runs, autonomy: 'manual' \| 'self_start' }`, for the degraded-mode line. |
| `PUT /api/teams/:scope/:id/engine` | manage | Takes `{ paused?, max_parallel_runs? }` (1 to 5); the same answer. A pause stops admissions in the scope's object; a resume rebuilds it from D1. 400 `invalid_engine`. |
