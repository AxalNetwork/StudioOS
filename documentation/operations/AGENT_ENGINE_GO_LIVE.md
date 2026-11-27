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

## Precondition: CFO and General Counsel fixture cases (#8518, D8518)

Before step 2 (`AGENT_ENGINE="canary"`) is proposed, `cloudflare-worker/test/agent_go_live_cases_8518.test.ts` passes
on the commit that proposes it. It runs the CFO (`cfo`, Orrin) and the General Counsel (`general_counsel`, Vesta)
through the real `agentRun`, skill pin, evidence preflight, readers, tool grants and connection checks, on two
invented companies (a ledger, a cap table and two contracts each; `example.test` and `example.invalid` only). Only
inference is stubbed, so there is no model call and no network. Assertions are on the tool calls made, the records
read, the refusal code and the disclaimer, never on model wording. The suite runs in the Worker test shards.

| # | Case | What must hold |
| --- | --- | --- |
| CFO 1 | Budget versus actual | Only the company's own ledger server is called, once per declared tool (`grow.read`, `mercury.read`); its figures are in the turn and none of the other company's |
| CFO 2 | A figure not recorded | A budget line with no spend reaches the model with no actual for it, under the skill's "Not recorded" step and the platform's no-invented-figure rule |
| CFO 2b | A runway with no recorded burn | Refused `skill_not_ready` before any model call, hold or usage row |
| CFO 3 | Another company's records | Another company's ledger connection is refused (`tool_not_granted`; a forged grant still finds no connection), and its cap table, balances and burn are `withheld`; no call, no model call |
| GC 4 | A contract question | The exact disclaimer (`disclaimers.ts`) is an instruction of the run, only for this role; the selected contract's passages are the evidence |
| GC 5 | Another company's contract | Refused `skill_not_ready` by the reader (file not found in this room, room withheld) with no model call; the prompt is never the guard |

- [ ] **Fixture cases:** all six pass on the commit proposed, and the counsel wording in `disclaimers.ts` is still the
  one the cases follow (the case holds the constant, so counsel's change (#3727) needs no test edit).

Mutation record (2026-11-25, D8518): a reader or connection that reads across companies, and a prompt without the
disclaimer, each fail these cases. The list is in D8518.

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

## Readiness scorecard and evidence gates (#4575, D4575)

This scorecard is evidence for the owner's go/no-go decision at each step above. It never enables anything, and no metric passing a threshold flips a switch. Two weeks of cohort data is a minimum, not an approval.

Every result records:
- the commit and the environment;
- the observation window;
- the method;
- the sample count;
- the owner-approved threshold;
- **pass**, **fail** or **not run**;
- the unresolved risks.

Each figure is labelled:
- **observed**: read from the tables or logs;
- **estimated**: modelled, with the model named;
- **unavailable**: not recorded. Unavailable is never 0 and never a pass.

### Where each figure comes from

| Metric | Source (existing; no new store) | Notes |
| --- | --- | --- |
| Acceptance, edit, discard, open past 3 days, expired | HQ › AI agents › Evaluation (`services/agents/evaluation.ts`, TM14) | Under 10 decisions a role is not rated |
| Cost per accepted proposal, and per successful task | The same board, and `runCostReader` | An unrecorded charge makes the sum unavailable |
| A run's lineage (task, scope, agent, sponsor, model configured and invoked, skill version, run and hold keys, proposal and decision, charge) | `runProvenance` (`services/agents/provenance.ts`). Open it at HQ › AI agents › Runs: pick a run, then **Provenance** in its details (`GET /api/admin/ai-agents/runs/:uid/provenance`, Super Admin, #5346) | The grants at admission and the data class are not recorded per run, so they read "Not recorded" with the reason |
| Duplicate holds or proposals per run | `runProvenance` reconciliation, and the unique `run_key` | Must be 0 |
| Unresolved holds: `held_unsettled`, `held_expired`, `mismatch`, `unrecorded` | `runProvenance` over the window's runs | Each needs a named cause before go |
| Refusal correctness | The board's `refused` by reason, sampled by a person | Synthetic tasks only |
| p95 and p99 latency | `ai_usage_logs.latency_ms` for agent runs | Comparable baselines are #4573's |
| Halt acknowledgement and enforcement | D4572's contract: the stop boundary is the next step | A propagation bound needs hosted evidence (#4594) |
| Oldest eligible work and fairness | #4592 | |
| Unresolved repair age (DLQ) | #4593 | |
| Provider throttling and retry amplification | #4556 | |
| Last successful hosted lifecycle and restore | #4594 (after #4566); #4558 and #4591 | A Worker deploy is not restore evidence |
| Security findings open | #4571, #4572 | |

### Gates (all must hold before each step's PR is proposed)

- [ ] **Recovery:** in the period, no run with two proposals or two holds, no `mismatch`, and no `held_expired` older than the sweep interval. Each `unrecorded` is explained.
- [ ] **Fixture cases:** the CFO and General Counsel cases above pass on the commit proposed.
- [ ] **Isolation:** no cross-tenant read in the period's sampled runs, and #4572's suite is green.
- [ ] **Approval:** no write landed without a person's Accept. Every agent effect is a proposal.
- [ ] **Halt:** a drill on a synthetic scope stopped every run at its next step. The result is recorded with its timestamp and step.
- [ ] **Hosted evidence:** for the cohort step and later, #4594's lifecycle run passed in #4566's isolated preview, with the owner's approved spend.
- [ ] **Privacy:** no prompt, payload, token-bearing URL or customer identifier in the period's telemetry or in this scorecard.

**Rollback** for any step is the previous switch value, in its own PR. Halt first if runs are live (see Halt and breaker recovery). Pending human decisions remain available after a halt.

## Hosted Stage A: receipt, sweep and environment (#8507, D8507)

`.github/workflows/agent-stage-a.yml` is #4594's hosted lifecycle run. Since
D8507 it has two jobs:

1. **`stage-a`** creates, exercises and deletes the throwaway Worker and its
   resources, as before. It also writes a **receipt**
   (`agent-stage-a-receipt` artifact, kept 90 days even when the job fails):
   one JSON line per resource, written the moment it exists. The Worker's
   line is written before its first deploy.
2. **`sweep`** runs `if: always()`, after a pass, a failure, a cancellation
   or a timeout. It lists the account's Workers, D1 databases, KV
   namespaces, queues, R2 buckets and Workflows. It deletes only that run's
   own Stage A names (`scripts/lib/stageASweep.mjs`: `studioos-s4594-<run>`,
   `studioos-<kind>-s4594-<run>[-dlq]`, `studioos-rehearsal-<run>-src`),
   then lists again. The summary ends with **Resources left: N**, and any N
   but zero fails the workflow. A list it could not read counts as one left.
   The receipt can never widen the selection: a receipt line that is not
   the run's own name is refused and reported.

**Sweeping an earlier run.** Dispatch the workflow with `sweep_run_id` set
to that run's GitHub run id (digits). Only the sweep job runs; it fetches
that run's receipt and sweeps `a<run id>`.

**Harness revision.** Both jobs check out `github.sha`, and each summary
starts with `Harness: <sha>`. The Stage A JSON summary carries it as
`harness`.

**Environment (open).** Both jobs still run in `production-ops`. The
preview environment (proposed: `agent-preview`) and a token scoped to what
Stage A creates are console work for the admin slot under #8063 and #8064.
Once they exist, the switch is the two `environment:` lines in the workflow
and the two `production-credential-inventory.json` rows. Until then, a
dispatch is the owner's decision, as before.

**Still to record (owner-dispatched):** three runs, one success, one
cancelled and one timed out, each ending with `Resources left: 0`.
