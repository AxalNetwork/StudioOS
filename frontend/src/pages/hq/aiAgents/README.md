# pages/hq/aiAgents — HQ › AI agents (D4137, #4137)

The super admin control panel for the agent roster and the skills library, from
the owner's canvas (`design/incoming/HQ AI Agents Page.dc.html`, boards SA0–SA9).

| File | What it is |
| --- | --- |
| `aiAgentsModel.js` | The panel's words and rules, pure: the tabs and sub-tabs and `viewFor` (address → board), `BUILD` (the five build tasks, #4158 and #4160–#4163, each `live: false` until its routes land; H1 is live), "Not recorded" never 0, a D1612 library card as an SA3 row, the area tiles, the guardrails and the kill switch's PAUSE rule. The roster's rows, filters and SA2b rules (D4158): a reason on every write, the trademark check on a rename. Tested by `frontend/test/hq_ai_agents_d4137.test.mjs` and `hq_ai_roster_d4158.test.mjs`. |
| `HqAiAgentsPage.jsx` | SA0–SA8 at `/hq/ai-agents` and its sub-paths (Super Admin, `hqOnly`). Live: `GET /api/teams/skills` (the From Axal skills) and the Roster (SA1, SA2, SA2b) through `adminAiAgentsApi.roster*` (D4158). Every other board names the task that switches it on. |

| `CohortCard.jsx` | D4423: Super Admin cohort membership, add by founder email and remove; no feature switch changes. |

| `Operations.jsx` | D4522: live Super Admin Overview, Runs, Spend, Audit and policy reads, with reason-gated pause/resume and retryable reads. Independent of team-agent rollout. |

## Rules

- **Every request needs a Worker route.** D1612's library and H1's roster are
  read. Each H task adds its client methods and flips its `BUILD` entry in the
  same PR.
- **Values are shown, never sent.** The roster's writes carry identity, status
  or defaults, and a reason; values, risk and natural fit are fixed (D4158).
- **No control the Worker would refuse.** Publish, Retire, Flag, Suspend, Save and
  Pause are drawn disabled with the reason until their routes exist.
- **"Not recorded" is never 0, and people are never shown by email.**
- **Words live in the model.** Wiring a task changes no copy.
