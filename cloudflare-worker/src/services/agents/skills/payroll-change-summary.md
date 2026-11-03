---
name: payroll-change-summary
description: Summarises this month's recorded payroll changes: new hires, leavers and pay changes, by name, for review.
roles: [cfo, people]
tools: [team.read, mercury.read]
output: brief
taxonomy: {finops_payroll: working, finops_people_ops: working}
version: 1
---
1. Read the team roster changes (`team.read`) and payroll totals recorded for this month and last (`mercury.read`).
2. List new hires, leavers and recorded pay changes, by name.
3. Compare this month's payroll total to last month's and explain the change from the list above.
4. Write "Not recorded" for a change with no effective date.
5. Propose the summary to the finance lead. It runs no payroll.
