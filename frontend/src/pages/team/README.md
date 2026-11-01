# `frontend/src/pages/team/` — Team: people and AI agents (D1497, #3727)

The Team page drawn to the owner's canvas (`design/incoming/Team Page.dc.html`
and `design/incoming/Team · Boards.dc.html`, boards TM1a–TM9f), and Project
settings › General. The routes are in `frontend/src/routes/team.jsx`; the
board → file map and what waits for which issue are in
`documentation/architecture/decisions/D1497.md`.

## The rule for adding here

- **People and invitations call routes that exist,** through `teamsApi` in
  `../../lib/api/teams.js` (#3841), imported from that module. Add no client
  method from here: a new people route lands its client in teams.js with it.
- **Everything about agents goes through `agentsAdapter.js`.** It is the one
  seam. The registry, profile and rule books are wired to #3840's
  `teamAgentsApi` (`../../lib/api/teamAgents.js`): each body is
  `through(() => teamAgentsApi.<method>(…))`, and `through` turns the
  Worker's refusals into what the screens draw (switched off, plan lock,
  refusal in words, unreadable). Runs (#3842), the approvals queue (#3843) and
  tools (#3844) still answer `{ available: false, reason }`; the builder who
  lands one adds its method to teamAgents.js with the route and replaces only
  the matching one-line body. No screen changes. Never add a client method
  for a route that does not exist.
- **Skills (D1612) are behind the same seam.** Their methods in `agentsAdapter.js` (`skillLibrary` … `coverage`) answer unavailable until A1 (#3951) and A2 (#3956) land; the builder replaces each one-line body with `throughSkill(() => teamAgentsApi.<method>(…))`. A pasted SKILL.md is untrusted text: draw it as text, never as HTML, and let the Worker's import be the parse that saves.
- **An agent is never drawn as a person.** People are circles
  (`PersonAvatar`); agents are rounded squares with the spark (`AgentTile`)
  and, wherever an agent is named, the "AI agent" pill (`AgentIdentity`). All
  three are in `AgentMark.jsx`.
- **"Not recorded" is never a zero.** An unread count, spend or time is the
  muted words (`Unrecorded`); an unread count draws no badge (`countBadge`).
  "Unavailable" is never "none": no screen says "No agent works here yet"
  unless the read answered `{ available: true }` with an empty list.
- **Another member's email is never drawn.** The model keeps it on your own
  row only. Invitation addresses are masked (owner question T3).
- **Ask, never Fill.** `AskButton.jsx` is "Ask", accessible name "Ask Eadwyn",
  and draws nothing until #3706's Ask panel exists. The AIRail is not changed.
- **A page names no scope it has not read.** The Team page, Project settings and
  `../ProjectDetail.jsx` tell the sidebar their scope through
  `usePublishScope` (`../../lib/settingsScope.js`) only once their read is ready.
- Sample names and figures from the canvas live only in test fixtures.

## Files

| File | What it is |
| --- | --- |
| `TeamAgentsPage.jsx` | The page, in three forms (company, project in a company, standalone project): header, tabs, Add to team, the People and agents tab, and the sheets. Publishes its scope to the sidebar. TM1a–TM1g, TM1d, TM9a3, TM9c1, TM9c4, TM9c6. |
| `ProjectSettingsPage.jsx` | Project settings › General at `/projects/:id/settings`, with Move under a company (TM1g2) and Move out (TM1h), both on `POST /api/projects/:id/move`. |
| `teamModel.js` | The words and every pure derivation: tabs, people from each read, invitation states, masking, refusals in words, money and time, agent rows and groups, the move copy. |
| `agentsAdapter.js` | THE SEAM for agents, rule books, approvals, runs and tools. #3840's registry and rule books are wired to `teamAgentsApi`; runs, approvals and tools stay unavailable until #3842–#3844. `through()` maps the Worker's refusals. |
| `AgentMark.jsx` | `AgentTile`, `AgentPill`, `AgentIdentity`, `PersonAvatar`: who someone is, drawn one way everywhere. |
| `AskButton.jsx` | The "Ask" button (TMA): `AskButtonView`, which renders nowhere until #3706's Ask panel. |
| `teamUi.jsx` | The card frame, header row, honest block, "pending owner" pill, button classes and `useMenu` (the two pop-up menus' keyboard model) the Team screens share. |
| `PeopleCard.jsx` | People (TM1a, TM1b), the read-only line (TM9a3), the Lab gate, and Company editors with access (TM1f) when a read supplies it. |
| `InvitationsBlock.jsx` | Invitations with their states and actions (TM2c): company and project Resend and Revoke. |
| `InviteSheet.jsx` | Invite people, company (TM2a, TM9a2) and project (TM2b): by email, by linking an existing account found by name (never by email), or by co-founder match. |
| `AgentsCard.jsx` | The AI agents card in every state (TM1c, TM1e, TM9b1, TM9c1, TM9c4). |
| `AddAgentSheet.jsx` | Add an AI agent, three steps (TM3a–TM3c). Reached only when the agents read is available. |
| `AgentProfileSheet.jsx` | An agent's profile, Pause, Remove, Edit cap and Save name (TM5a, TM5b). |
| `RulebooksTab.jsx` | Roles and rule books: the library, one rule book, and Edit with the floor (TM4a–TM4c). |
| `ApprovalsTab.jsx` | Approvals with its four filters, and one proposal (TM7a, TM7b, TM7b2). |
| `TeamSettingsTab.jsx` | Settings: who pays, who may add agents, caps (Edit cap opens the profile's editor), models and tools, data sharing (Open rule book opens the role's book) (TM8a; TM9a5's lock line). |
| `SkillsTab.jsx` | Skills (D1612, #3945): the roles (SK0), a role's directory with categories, search and sort (SK1), the skill page with its SKILL.md drawn as text, Copy and Download (SK2), and the states (SK9). |
| `SkillSheets.jsx` | Assign to agents (SK3), Add skills to this agent (SK5), the Add-an-agent Skills step (SK6) and New skill: Write, or Paste a SKILL.md with a preview (SK7). |
| `AgentSkillsCard.jsx` | The agent profile's Skills and Values (SK4, SK9b): the radar computed by the Worker, pinned versions, Update to vN, Remove, and values "Set by [Company]". |
| `TeamCoverageCard.jsx` | Team coverage (SK8): people and agents on the 8 /studio axes; a category covered only by agents reads as a people gap. Not drawn while its read is off. |
| `SkillParts.jsx` | The taxonomy and tool chips, the directory card, a skill row and the agent radar the skill screens share. |
| `skillsModel.js` | The skill words and pure derivations: levels and categories, filter and sort, the radar and coverage, assignment groups, refusals, and the client-side SKILL.md preview. |
| `WorkingHere.jsx` | Working here (TM6c) and Assign this task to… (TM6b). Built, not mounted: module headers mount them with the Ask panel (#3706) and the task store (#3845). |
