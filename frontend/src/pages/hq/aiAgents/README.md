# pages/hq/aiAgents — HQ › AI agents (D4137, #4137)

The super admin control panel for the agent roster and the skills library, from
the owner's canvas (`design/incoming/HQ AI Agents Page.dc.html`, boards SA0–SA9).

| File | What it is |
| --- | --- |
| `aiAgentsModel.js` | The panel's words and rules, pure: the tabs and sub-tabs and `viewFor` (address → board), `BUILD` (the five build tasks, #4158 and #4160–#4163; all five are live since #4739), "Not recorded" never 0, a library card as an SA3 row, the area tiles, the guardrails and the kill switch's PAUSE rule. The roster's rows, filters and SA2b rules (D4158): a reason on every write, the trademark check on a rename. Tested by `frontend/test/hq_ai_agents_d4137.test.mjs` and `hq_ai_roster_d4158.test.mjs`. |
| `refusals.js` | #4739: the sentence for every refusal code the panel's writes can get (skills, policy, engine halt), and the rule behind them: the Worker's body is on `e.data`, an unknown code shows the Worker's own sentence, and `e.message` is never shown. A test reads the Worker's sources and fails when a code has no sentence. |
| `skillLifecycleModel.js` | #4739: the From Axal lifecycle as pure rules: the actions a status offers, a golden case as a form and as the Worker's body (a changed case is a new one, an email is refused), the diff as rows, the evaluation as a line. |
| `policyModel.js` | #4739: the Policies controls as pure rules: dollars to micro-dollars (blank clears, never 0), the four caps, the models per area, the read-tool list and the engine halt's line. |
| `HqAiAgentsPage.jsx` | SA0–SA8 at `/hq/ai-agents` and its sub-paths (Super Admin, `hqOnly`). Live: Overview, the Roster (SA1, SA2, SA2b) through `adminAiAgentsApi.roster*` (D4158), the From Axal library (`GET /api/admin/ai-agents/skills`) with its editor page (SA4), Company skills with Flag, Suspend and Clear (D4161), and Operations. |
| `SkillLifecycle.jsx` | #4739 (D4160): SA3's bulk bar (**Publish…**, **Re-run evals**, **Retire…** for the ticked skills, each done or refused on its own) and SA4's review (ask, approve, request changes), golden-case editor, evals, diff and **Retire…**. Every write takes a reason. |
| `PolicyControls.jsx` | #4739 (D4162): SA6's controls: models by area, locks, caps and read tools, and the agent engine's halt beside the pause. Every write takes a reason. |
| `Operations.jsx` | D4522: live Super Admin Overview, Runs, Spend, Audit and the policy (it draws `PolicyControls.jsx`), with reason-gated pause/resume and retryable reads. Independent of team-agent rollout. |
| `CohortCard.jsx` | D4423: Super Admin cohort membership, add by founder email and remove; no feature switch changes. |

## Rules

- **Every request needs a Worker route.** The panel reads and writes under `/api/admin/ai-agents` (H1–H5) and the engine halt at `/api/admin/agents/halt`. A new control adds its client method and its route in the same PR.
- **Every write takes a reason** (10 to 500 characters; the engine halt's is at most 64) and is audited with it. Values, risk and natural fit are shown, never sent (D4158).
- **A refusal shows its own sentence.** Add the code to `refusals.js`; never show `e.message`.
- **No control the Worker would refuse.** Publish needs a second Super Admin's approval and golden cases at or above the bar; the page says so before and after, and the Worker decides.
- **"Not recorded" is never 0, and people are never shown by email.** A reviewer is chosen by name from `reviewers` on the skill's read.
- **Words live in the model.** Wiring a task changes no copy.
