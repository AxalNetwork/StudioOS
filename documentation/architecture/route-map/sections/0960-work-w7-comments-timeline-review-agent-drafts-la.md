### Work W7: comments, timeline, review, agent drafts, labels and milestones (D1614 §7, #3993)

- **Worker:** `routes/work_items.ts`, mounted by `agent_engine.ts` beside W1's board under `/api/teams`, with the engine's gates. The service is `services/agents/workItems.ts`, with `workLabels.ts` keeping W1's `labels_json` mirror in step.
- **Scope:** project only. Every W7 path under `/company/:id/…` answers 404, and so does a project the caller cannot read.

| Route | Gate | What it does |
| --- | --- | --- |
| `GET /api/teams/project/:id/tasks/:number/timeline` | read | `{ task, entries, participants, truncated }`. Entries merge comments, events (created, assigned, moved, closed, reopened, edited, labelled, milestone, reviewed, dependencies, unblocked) and linked proposals, in time order. Each names its person or agent; an agent's entry carries `cost` (`{ available: false }` when its run recorded none). Participants are derived. |
| `POST /api/teams/project/:id/tasks/:number/comments` | read | Takes `{ body, mentions?: [{ kind: 'person' \| 'agent', uid }] }` (at most 20); 201 `{ comment }`. The Markdown is stored cleaned. A mention notifies the person, or the agent's sponsor, through `notify()`. 400 `invalid_comment` / `invalid_mentions`; 422 `mention_not_member` (nothing is stored). |
| `PATCH` / `DELETE /api/teams/project/:id/comments/:uid` | its author | `{ comment }`. A deleted comment keeps no body. 403 `not_author`; 409 `comment_deleted`. |
| `POST /api/teams/project/:id/tasks/:number/review` | manage | Takes `{ decision: 'approve' \| 'request_changes', comment? }`; `{ task }`. Approve closes it as completed; Request changes needs a comment (400 `comment_required`) and moves it back to In progress. 409 `not_in_review`. |
| `PUT /api/teams/project/:id/tasks/:number/labels` | manage | Takes `{ labels: [uid] }` (at most 20); `{ task }`, with a `labelled` event. 409 `task_changed`. |
| `PUT /api/teams/project/:id/tasks/:number/milestone` | manage | Takes `{ milestone: uid \| null }`; `{ task }`, with a `milestone` event. |
| `GET /api/teams/project/:id/work/drafts` | read | `{ drafts: [{ uid, column: 'triage', review_state: 'needs_review', drafted_by, title, body, type, module, cost }] }`: the agents' open `propose:create-task` proposals. No task exists yet. |
| `POST /api/teams/project/:id/work/drafts/:uid/accept` | manage | 201 `{ task }` in Backlog with `drafted_by`. 409 `draft_decided` (a racing accept). |
| `POST /api/teams/project/:id/work/drafts/:uid/discard` | manage | Takes `{ reason }` (1–500 characters, 400 `reason_required`); nothing is created. |
| `GET` / `POST /api/teams/project/:id/work/labels`, `PATCH` / `DELETE …/labels/:uid` | read / manage | A project's labels (`name`, `color`, `description`, open and closed counts). 409 `label_exists` (names are unique ignoring case). A rename or delete rewrites every carrying task's labels. |
| `GET` / `POST /api/teams/project/:id/work/milestones`, `PATCH` / `DELETE …/milestones/:uid` | read / manage | A project's milestones (`title`, `description`, `due_on`, `state` open or closed, counts). 409 `milestone_exists`. A delete clears it from its tasks. |

- **On W1's board:** a card gains `milestone`, `author` (the drafting agent for an accepted draft), `drafted_by` and `review_state`. The filter takes `author:`, `milestone:` (uid, title or `none`), `drafted_by:agent` and `review:needed` (or `approved`, `changes_requested`), and `?sort=` (`number`, `created`, `updated`, `due`, `priority`, each with `-desc`) orders the list.
- **Agents, no HTTP route:** the run path calls `agentComment` (the task's assigned active agent, naming its run) and `proposeTaskDraft`. An agent moves its work through W1's `updateWorkTask` and never closes it (403 `agent_cannot_close`).
- **Schema:** migration 763 (`task_comments`, `task_labels`, `task_label_links`, `task_milestones`; `milestone_id`, `drafted_by_agent_id` and `review_state` on `scope_tasks`; the event kinds `labelled`, `milestone` and `reviewed`).
- **Frontend:** none here. The client methods and the issue view are for the Work screens (#3973 and its follow-ups).

