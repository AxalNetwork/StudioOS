# Agent engine go-live

D4423 (#4423), part of #3742. This is preparation, not permission to enable
agents. The committed switches remain `TEAM_AGENTS_ENABLED="false"`,
`AGENT_ENGINE="off"`, `AGENT_AUTONOMY="manual"` and `AGENT_RUNTIME="do"`.
Every later flip is its own PR, approved and merged by the owner.

Testing agent execution before any flip happens outside production, in an
isolated preview, behind a fail-closed preflight:
`AGENT_EXECUTION_VALIDATION.md` (D4566, #4566).

## Owner prerequisites

- Confirm Workers Paid and acceptance of Workflow step billing. Production's
  `studioos-agent-queue`, `studioos-agent-queue-dlq` and `studioos-agent-task`
  Workflow are already deployed; verify their health rather than recreate them.
- Create the `agents` AI Gateway. Turn **payload logs off** and **caching off**,
  and set its monthly hard spend limit to **$100**. Code also forces
  `collectLog:false` and `skipCache:true` on every agent gateway call.
- Post the gateway id on #3742. Add `AGENT_AI_GATEWAY` in a later reviewed PR;
  it remains an unset comment in this preparation PR. Never silently retry an
  agent call outside its gateway after a gateway failure.
- Verify `AGENT_GATEWAY_MONTHLY_LIMIT_MICROUSD="100000000"` in `[vars]`,
  `[env.production.vars]` and `[env.preview.vars]`. This is the Worker's
  alert threshold, not a dashboard API: it does not set the gateway's limit.
- Set the agreed caps in HQ › AI agents › Operations › Policies using
  `PUT /api/admin/ai-agents/policy/caps`: `platform_budget_microusd`,
  `default_team_cap_microusd`, `max_team_cap_microusd`,
  `per_run_ceiling_microusd`, and the required `reason`. Read the policy back.
  Use the owner's approved values; do not infer them from the $100 gateway limit.
- Obtain counsel's privacy and Terms of Service review. Record the approval on
  #3742 without personal data, prompts, outputs or credentials.
- Full CI passes, including `agent_engine_bindings_d1528`, runtime contracts
  for both `do` and `sdk`, Wrangler parity, branch config, cron and migration guards.

## Staged rollout: separate PRs

1. **Team surface:** propose `TEAM_AGENTS_ENABLED="true"` alone. Keep the engine
   off and autonomy manual. This exposes the existing manually run agents;
   it does not admit engine tasks.
2. **Admins only:** propose `AGENT_ENGINE="canary"`. Verify the #3742 spec §9
   checklist below on an HQ test company and one of its projects. Autonomy stays
   manual: no unattended runs are authorised by this preparation.
3. **Opt-in cohort:** after owner approval, HQ adds consenting founders in the
   **Cohort** card on HQ › AI agents. Email is input only and resolves an active
   founder. HQ can list/add/remove through Super Admin routes
   `GET/POST /api/admin/ai-agents/cohort` and
   `DELETE /api/admin/ai-agents/cohort/:uid`. The POST accepts `{email}` or
   `{scope:{kind:"company"|"project",id}}` for an explicit scope entry.
   An automated start with no person requires a scope entry. Each write is
   audited. Removing membership affects new admission; use Halt to stop runs
   already admitted. Prepare the list first, then propose `AGENT_ENGINE="cohort"`.
4. **Everyone:** review cohort outcomes and spend, then propose
   `AGENT_ENGINE="on"`. Keep the same gates and hard limits.
5. **Autonomy:** only after at least two weeks of evaluation data following the
   cohort step, propose `AGENT_AUTONOMY="self_start"` in its own approved PR.
   Check acceptance, edited/discarded proposals, failures, spend and halt behavior.

Keep environment differences explicit in each PR and rerun binding/parity tests.
Use `npm run deploy` for an approved deployment; it applies migrations before
shipping the Worker. No hand-written production D1 mutations are part of rollout.

## Canary checklist: #3742 §9

- E1–E7 and E8 are merged, D1528–D1531 are recorded, and D1532 is released.
- A manager creates a goal and asks for a plan with cost shown first. Accept
  the plan and check its tasks and assignments.
- A person starts an assigned ready task after seeing cost. Its proposal waits
  in the approvals queue; Accept completes it and writes its memory note.
- A Monday duty is claimed once and creates one task. While autonomy is manual,
  it must not run unattended. Its automatic-run check waits for the separately
  approved self_start step.
- A handoff becomes a task only after Accept.
- Halt stops every run within one step. Moving the project to another company
  ends its in-flight run as scope_moved, retains its project agents and cuts the
  old company agent's access in the move transaction.
- Retries use one hold; each run is charged to its sponsor with agent_id.
  Unreadable cost says Not recorded, never zero. Evaluation shows acceptance.
- Scope/member permission checks, the gateway breaker, and declined cohort
  admission remain effective. Verify an unlisted founder cannot start a task.

Use synthetic test data. Report states and counts on #3742, never customer content.
The live `do → sdk → do` rehearsal is deferred until an `sdk` switch is proposed;
CI's contract suite covers both runtimes in the meantime.

## Halt and breaker recovery

The fastest authenticated halt is `POST /api/admin/agents/halt` with
`{"halted":true,"reason":"incident"}`. `GET /api/admin/agents/halt` confirms it.
A platform admin may use HQ's halt control. Every run stops at its next step;
pending human decisions remain available.

From the repository root, with the correct production account selected:

```sh
npx wrangler kv key put --binding RATE_LIMITS --env production --remote agents:halt "incident"
npx wrangler kv key get --binding RATE_LIMITS --env production --remote agents:halt
```

Investigate before resuming. An authorised admin can send
`{"halted":false}` to the halt route, or remove the halt key:

```sh
npx wrangler kv key delete --binding RATE_LIMITS --env production --remote agents:halt
```

A gateway limit sets `agents:paused` (the circuit breaker). Confirm the gateway
budget, provider state and HQ policy before clearing it. Clearing is an operator
action, never an automatic retry loop:

```sh
npx wrangler kv key get --binding RATE_LIMITS --env production --remote agents:paused
npx wrangler kv key delete --binding RATE_LIMITS --env production --remote agents:paused
```

For a controlled deployment stop, propose `AGENT_ENGINE="paused"` to stop new
admissions while existing runs settle, or `off` to stop engine processing. Manual
sponsor runs have their existing separate policy gates. See
[AGENT_RUNTIME_SWITCH.md](AGENT_RUNTIME_SWITCH.md) for rebuilding scopes and
switching runtimes; no runtime switch is included here.
