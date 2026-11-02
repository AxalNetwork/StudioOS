# Agent runtime: stop it, and switch it

D1528 (#3847, E3 of #3742), from the fallback plan (#3742 comment 6542894365,
§5 and §6). The agent engine's runtime sits behind one seam,
`cloudflare-worker/src/agents/runtime.ts`. This page says how to stop agents
quickly, how to switch the runtime behind the seam, and what still works while
the engine is down. The decision is
`documentation/architecture/decisions/D1528.md`.

## What the switches are

| Switch | Where | Effect |
| --- | --- | --- |
| `AGENT_ENGINE` | `[vars]` and `[env.production.vars]` (and `[env.preview.vars]`) | `off`: every engine route answers 404 `agent_engine_off`; a run in flight ends at its next step (`engine_off`). `paused`: admissions stop (403 `engine_paused`); runs already admitted carry on and decisions still land. `canary`: only a platform admin's own start is admitted. `on`: everything. Needs `TEAM_AGENTS_ENABLED = "true"` too. |
| `agents:halt` | KV `RATE_LIMITS` | Set: every run ends at its next step (`halted`) and nothing is admitted. The fastest stop; no deploy. |
| `agents:paused` | KV `RATE_LIMITS` | The platform circuit breaker. A gateway limit sets it (`gateway_limit`); while it is set the engine reads `paused`. A person clears it. |
| A scope's pause | `PUT /api/teams/:scope/:id/engine` `{ paused: true }` | That scope admits nothing more; a resume rebuilds its object from D1. |
| `AGENT_RUNTIME` | `[vars]` and `[env.production.vars]` | `do` (the only one built). `sdk` is not built: asking for it falls back to `do` and logs a warning. |
| `AGENT_AUTONOMY` | `[vars]` and `[env.production.vars]` | `manual` (default): only a person starts a task. `self_start` only after E3 and E5 merge (owner Q1 B). |

## Stop every agent now

1. Set the halt key on the deployment (HQ shown; a branch uses its own namespace id):
   `npx wrangler kv key put --binding RATE_LIMITS --env production agents:halt "incident"`
   Every run ends at its next step and nothing is admitted. Proposals already
   in the approvals queue stay there and can still be decided.
2. To resume, delete the key:
   `npx wrangler kv key delete --binding RATE_LIMITS --env production agents:halt`

The circuit breaker is cleared the same way (`agents:paused`), once the
gateway's limit is understood.

## Switch the runtime

Switching from `sdk` to `do`, or back, is the same runbook. Today only `do`
exists, so this is the rehearsal path for E0.

1. Set `AGENT_ENGINE = "paused"` and deploy (`npm run deploy`). Admissions
   stop; running and waiting Workflows continue; decisions still land, because
   the approval path never goes through the runtime (decide → D1 →
   `AGENT_TASK.get(run uid).sendEvent()`).
2. Set `AGENT_RUNTIME` to the target and deploy.
   - Both classes stay declared, each with its own migration tag, in all three
     migration tables, mirrored under `[env.production]`.
   - No class is deleted in the same deploy.
3. Run `rebuild(scope)` for every scope with an active agent. It recreates
   the admission view, the duty timers and the scope's pause from D1 alone.
   E7 (#3851) owns the admin route that calls it; until then, a scope's
   `PUT …/engine { paused: false }` rebuilds that one scope.
4. Set `AGENT_ENGINE = "on"`, deploy, and watch the evaluation board and the
   alerts for 24 hours.
5. Remove the unused class only in a later PR, with a `deleted_classes`
   migration tag, once the owner agrees.

A run waiting for approval when the switch is pulled completes after it, with
one charge and one proposal: its Workflow instance does not belong to either
runtime, and its proposal's run key makes a replayed step answer the same
proposal (E2).

## When the switch is pulled

- At E0, or at any SDK upgrade: the contract suite
  (`cloudflare-worker/test/agent_runtime_contract.test.ts`) or the guard tests
  fail, and the fix is not trivial.
- In operation: a Cloudflare advisory or deprecation affecting the SDK; a
  security issue in the package; unexplained duplicate runs or charges; Durable
  Object cost beyond the Q3 estimate by 2× for a month.
- S1 decides a switch for the E0, upgrade and duplicate-run triggers. A cost
  trigger goes to the owner.

## Degraded mode: the engine is down

#3727's sponsor-run path (`POST /api/teams/agents/:uid/run`) does not depend on
the engine. With `AGENT_ENGINE` `off` or `paused`, people can still run agents
by hand, see costs, and accept or discard proposals; only started tasks,
self-started tasks, duties and handoffs stop. The page reads
`GET /api/teams/:scope/:id/engine` and shows "Agents are paused on the
platform. You can still run them yourself."

## Before the engine goes live

The owner's account steps, none of which this repository can do:
- confirm Workers Paid and accept Workflow step billing;
- create the queues `studioos-agent-queue` and `studioos-agent-queue-dlq`, and
  their preview twins `studioos-agent-queue-preview` and
  `studioos-agent-queue-preview-dlq` (a branch's are
  `studioos-<code>-agent-queue` and `studioos-<code>-agent-queue-dlq`);
- create the `agents` AI Gateway with its spend limits, then set
  `AGENT_AI_GATEWAY` to its id. No secret is added.

Until then `AGENT_ENGINE` stays `off`. A deploy that declares a queue the
account does not have fails at deploy time, so the queues must exist before
the first deploy that carries these bindings.
