# Compliance services

A company's compliance duties. Companies carry the legal and compliance duties;
projects carry the work (the owner, 2026-11-01; D1614).

- `companyTasks.ts`: D1614 CO2–CO5 (#3976). A company's compliance tasks on
  D1384's one store, `compliance_events`, which migration 202611021812 rebuilt so a row
  can name its company without a project. It holds:
  - the gates: a seat on the company (`user_company_links`) or HQ reads; a
    company admin (Owner, Admin or Founder, or the primary admin; or HQ with a
    seat) changes; HQ without a seat is `read_only_admin`; an agent of the
    company comments and sets "ready for review" and never marks done
    (`agent_cannot_close`);
  - the assignee picker (seats in two groups, and the company's active
    agents; never an email);
  - each task's timeline, `compliance_task_events`, with an agent entry's cost;
  - "Create work in a project…": a Backlog item on one of the company's own
    project boards, through W1's `createWorkTask`, linked back by
    `scope_tasks.compliance_ref`;
  - `seatEndedStatements`, which `routes/company.ts` batches with a seat's
    removal to flag that member's open tasks. Nothing is reassigned
    automatically.

The legacy project-scoped routes (`routes/compliance.ts`, `/api/compliance`)
and the Calendar's Compliance layer read the same rows.

**Adding here.** A new rule about who may change a company's duties belongs in
`companyTasks.ts`'s gate, never in a route. Bound SQL only. No reply or log
line carries an email, a title from another company or a provider's text. A
proof document is deferred (the owner, 2026-11-02): it needs an upload and its
storage accounting (D1168, D1170) together.
