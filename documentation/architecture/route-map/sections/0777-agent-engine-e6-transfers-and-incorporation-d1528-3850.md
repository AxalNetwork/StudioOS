### Agent engine E6: transfers and incorporation (D1528 §4.4, #3850)

The same router (`routes/agent_engine.ts`), flag and gates. A project's move (`POST /api/projects/:id/move`, and the incorporation filing that moves a venture into its new company) changes the agent engine in the move's own batch (`services/agents/transfer.ts`, `transferStatements` inside `projectMoveStatements`): the project's goals stop rolling up to the old company's goals, and the old company's open tasks about it are `blocked` with `project_left`. After the batch commits, the runs in flight end `scope_moved` and the boards and teams are told. An owner-seat transfer (`POST /api/projects/:id/transfer`) pauses the project's agents the old owner sponsored, `sponsor_left`, when they can no longer manage the team. The client is `agentEngineApi.moves`. `Move` is `{ direction: 'in' | 'out', project: { id, name }, from: { uid, name } | null, to: { uid, name } | null, by: { uid, name } | null, at, blocked_tasks }`.

| Route | Gate | What it does |
| --- | --- | --- |
| `GET /api/teams/:scope/:id/moves?limit=5` | read | `{ moves: [Move] }`, newest first: a company's projects coming in and going out, or one project's own moves. `limit` 1 to 20, default 5. `blocked_tasks` counts the old company's tasks the move blocked. 403 `not_member`; 404 for an unknown scope. |
