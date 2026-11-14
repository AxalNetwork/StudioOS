### Company compliance tasks (D1614 §11, #3976, migration 202611021812)

- **Worker:** `routes/company_compliance.ts`, mounted at `/api/company` ahead of `company.ts` by its own `mount` (#4105); every gate is in `services/compliance/companyTasks.ts`.
  - `GET /company/:uid/compliance?status=due|done|snoozed&jurisdiction=&owner=<uid>|none&type=` → `{ company, viewer: { can_manage, can_comment, read_only }, tasks, truncated, projects }` (at most 1,000 tasks; `projects` is the company's own, for "Create work").
  - `POST /company/:uid/compliance` `{ title, due, type?, jurisdiction?, recurrence?, description?, project_id? }` → 201 `{ task }`.
  - `GET /company/:uid/compliance/assignable` → `{ team, platform, agents }`: seats in two groups and the company's active agents, each with open tasks and `capacity: null`. Never an email.
  - `GET /company/:uid/compliance/:task` → `{ company, viewer, task, timeline }`.
  - `PATCH /company/:uid/compliance/:task`, `PUT …/assignee` `{ assignee: { kind, uid } | null }`, `POST …/comments` `{ body }`, `POST …/ready`, `POST …/done` `{ note? }`, `POST …/reopen`.
  - `POST …/work` `{ project_id, title? }` → 201 `{ item }`: a Backlog item of type `compliance` on that project's W1 board, linked by `scope_tasks.compliance_ref`. 404 `agent_engine_off` while the engine is off.
- **Gates:** a seat reads, and HQ reads read-only; a company admin changes; a seat holder or the company's own agent comments and sets ready for review.
- **Refusals** (D278's `{ error, message, detail }`): 403 `not_member`, `read_only_admin`, `not_company_admin`, `agent_cannot_close`; 422 `assignee_not_member`, `company_mismatch`, `standalone_project`; 400 `invalid_task`; 404 `not_found`; 409 `already_done`, `not_done`, `duplicate_task`.
- **Seat end:** `DELETE /company/:uid/members/:userId` and `POST /company/:uid/leave` flag the member's open tasks `needs_reassignment`, with an event, in the same batch as the removal.
- **Calendar:** the Compliance layer (`compliance_due`) shows a company-level task to the company's seats, and every entry carries `compliance.company` (its badge) and `compliance.company_task`.
- **Client:** `lib/api/companyCompliance.js` (`companyComplianceApi`); `pages/work/workAdapter.js`'s compliance methods go through it. Pages: `/account/companies/:uid/settings/compliance` (`CompliancePage.jsx`), and the Compliance card in Company settings › Legal (`ComplianceCard.jsx`).

