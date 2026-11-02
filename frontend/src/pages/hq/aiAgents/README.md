# pages/hq/aiAgents — HQ › AI agents (D4137, #4137)

The super admin control panel for the agent roster and the skills library, from
the owner's canvas (`design/incoming/HQ AI Agents Page.dc.html`, boards SA0–SA9).

| File | What it is |
| --- | --- |
| `aiAgentsModel.js` | The panel's words and rules, pure: the tabs and sub-tabs and `viewFor` (address → board), `BUILD` (the five build tasks, #4158 and #4160–#4163, each `live: false` until its routes land), "Not recorded" never 0, a D1612 library card as an SA3 row, the area tiles, the guardrails and the kill switch's PAUSE rule. Tested by `frontend/test/hq_ai_agents_d4137.test.mjs`. |
| `HqAiAgentsPage.jsx` | SA0–SA8 at `/hq/ai-agents` and its sub-paths (Super Admin, `hqOnly`). One live read, `GET /api/teams/skills` (the From Axal skills); every other board names the task that switches it on. |

## Rules

- **Every request needs a Worker route.** The only read is D1612's library. Each
  H task adds its client methods and flips its `BUILD` entry in the same PR.
- **No control the Worker would refuse.** Publish, Retire, Flag, Suspend, Save and
  Pause are drawn disabled with the reason until their routes exist.
- **"Not recorded" is never 0, and people are never shown by email.**
- **Words live in the model.** Wiring a task changes no copy.
