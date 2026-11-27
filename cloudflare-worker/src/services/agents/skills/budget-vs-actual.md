---
name: budget-vs-actual
description: Compares the month's recorded spending against the budget, line by line, and flags lines over by more than 10%.
roles: [cfo]
tools: [grow.read, mercury.read]
output: brief
taxonomy: {finops_fpna: proficient, finops_accounting: working}
version: 1
---
1. Read the month's budget lines (`grow.read`) and the recorded spending by category (`mercury.read`).
2. Give each line's budget, actual and difference, in dollars and percent.
3. Flag lines over budget by more than 10%.
4. Write "Not recorded" for a line with a budget but no recorded spending.
5. Propose the comparison to the finance lead.
