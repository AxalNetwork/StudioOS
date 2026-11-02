### Work W1: a project's board on the task store (D1614 §6, #3969)

- **Worker:** `routes/work_board.ts`, mounted by `agent_engine.ts` under `/api/teams`, with the engine's gates:
  - `GET /:scope/:id/work/board?filter=` returns the columns with their counts and estimate sums, and the cards with their assignee (person or agent), last run and cost.
  - Project `POST /:scope/:id/tasks`, `GET`/`PATCH /tasks/:uid`, `PATCH /tasks/:uid/move` (column and position) and `PUT /tasks/:uid/deps`.
- **Scope:** project only. A company board is 404, and company tasks keep E1's routes.
- **Schema and rules:** migration 762. 409 `task_blocked` names the blockers; an `unblocked` event notifies the assignees.
- **Frontend:** none here. #3973 (W5) wires `pages/work/workAdapter.js`.

