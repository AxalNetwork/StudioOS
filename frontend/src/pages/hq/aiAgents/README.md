# pages/hq/aiAgents — HQ › AI agents (D4137, #4137)

The super admin control panel for the agent roster and the skills library, from
the owner's canvas (`design/incoming/HQ AI Agents Page.dc.html`, boards SA0–SA9).

| File | What it is |
| --- | --- |
| `aiAgentsModel.js` | The panel's words and rules, pure: the tabs and sub-tabs and `viewFor` (address → board), `BUILD` (the five build tasks, #4158 and #4160–#4163; all five are live since #4739), "Not recorded" never 0, a library card as an SA3 row, the area tiles, the guardrails and the kill switch's PAUSE rule. The roster's rows, filters and SA2b rules (D4158): a reason on every write, the trademark check on a rename. Tested by `frontend/test/hq_ai_agents_d4137.test.mjs` and `hq_ai_roster_d4158.test.mjs`. |
| `refusals.js` | #4739: the sentence for every refusal code the panel's writes can get (skills, policy, engine halt), and the rule behind them: the Worker's body is on `e.data`, an unknown code shows the Worker's own sentence, and `e.message` is never shown. A test reads the Worker's sources and fails when a code has no sentence. |
| `definitionModel.js` | D4537: the definition editor as pure rules: a skill as the form, the form as the PATCH body in the Worker's words, each `checkDraft` code with its field and sentence, and what saving does to the review and evaluation. |
| `DefinitionEditor.jsx` | D4537: the working draft's definition editor on a skill's detail, saved through `PATCH /api/teams/skills/:uid`; a refusal marks its field. |
| `skillLifecycleModel.js` | #4739: the From Axal lifecycle as pure rules: the actions a status offers, a golden case as a form and as the Worker's body (a changed case is a new one, an email is refused), the diff as rows, the evaluation as a line; D4533: a release note as the publish body and as text, and what `freshness` says about publishing now. |
| `releaseModel.js` | D4537: the release evidence as pure rules: GET /:uid's `freshness` as ready, blocked (each `Blocking` code in words) or not recorded; the evaluation against the bar; what changed since the last approval; each version's manifest. |
| `ReleaseEvidence.jsx` | D4537: a skill's release evidence card, read only: the server's release decision, changes since the last approval, the current evidence and every published version's manifest. |
| `policyModel.js` | #4739: the Policies controls as pure rules: dollars to micro-dollars (blank clears, never 0), the four caps, the models per area, the read-tool list and the engine halt's line. |
| `HqAiAgentsPage.jsx` | SA0–SA8 at `/hq/ai-agents` and its sub-paths (Super Admin, `hqOnly`). Live: Overview, the Roster (SA1, SA2, SA2b) through `adminAiAgentsApi.roster*` (D4158), the From Axal library (`GET /api/admin/ai-agents/skills`), filtered by status, area, role, evaluation state and source, with the source library files not yet in the store listed apart (`GET /library`, D4537), and its editor page (SA4), Company skills with Flag, Suspend and Clear (D4161), and Operations. |
| `SkillLifecycle.jsx` | #4739 (D4160): SA3's bulk bar (**Publish…**, **Re-run evals**, **Retire…** for the ticked skills, each done or refused on its own) and SA4's review (ask, approve, request changes), golden-case editor, evals, diff and **Retire…**. Every write takes a reason. D4533: **Publish** with an optional release note (the single publish, gated by the server's `freshness`) and each version's release note, "Not recorded" when none was written. |
| `PolicyControls.jsx` | #4739 (D4162): SA6's controls: models by area, locks, caps and read tools, and the agent engine's halt beside the pause. Every write takes a reason. |
| `Operations.jsx` | D4522: live Super Admin Overview, Runs, Spend, Audit and the policy (it draws `PolicyControls.jsx`), with reason-gated pause/resume and retryable reads. Independent of team-agent rollout. |
| `CohortCard.jsx` | D4423: Super Admin cohort membership, add by founder email and remove; no feature switch changes. |
| `provenanceModel.js` | #5346 (D4575): one run's provenance (`GET /runs/:uid/provenance`) as labelled rows for the run detail's Provenance panel in `Operations.jsx`; an unavailable field is "Not recorded" with its reason, never 0. |

## Rules

- **Every request needs a Worker route.** The panel reads and writes under `/api/admin/ai-agents` (H1–H5) and the engine halt at `/api/admin/agents/halt`. A new control adds its client method and its route in the same PR.
- **Every write takes a reason** (10 to 500 characters; the engine halt's is at most 64) and is audited with it. Values, risk and natural fit are shown, never sent (D4158).
- **A refusal shows its own sentence.** Add the code to `refusals.js`; never show `e.message`.
- **No control the Worker would refuse.** Publish needs a second Super Admin's approval and golden cases at or above the bar; the page says so before and after, and the Worker decides.
- **"Not recorded" is never 0, and people are never shown by email.** A reviewer is chosen by name from `reviewers` on the skill's read.
- **Words live in the model.** Wiring a task changes no copy.
