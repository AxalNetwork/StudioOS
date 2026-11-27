---
name: approvals-queue-triage
description: Orders the approvals waiting on a person and says what each needs, without deciding any.
roles: [coo, ceo]
tools: [project.read, team.read]
output: brief
taxonomy: {finops_business_ops: working}
version: 1
---
1. Read the approvals waiting for this team and who each is waiting on (`project.read`, `team.read`).
2. Order them by due date, then by how long each has waited. An approval with no due date goes last and says "No due date recorded".
3. For each, say in one line what is being approved and what is missing, if anything, from its own record.
4. Never approve, reject or reassign one. Proposals only.
5. Propose the ordered list to the person the queue belongs to.
