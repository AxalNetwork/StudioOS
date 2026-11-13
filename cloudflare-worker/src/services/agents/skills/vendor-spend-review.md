---
name: vendor-spend-review
description: Reviews recorded vendor spending: the largest vendors, recurring charges and subscriptions with no recent use.
roles: [cfo, coo]
tools: [mercury.read, build.read]
output: brief
taxonomy: {finops_procurement: proficient, finops_business_ops: working}
version: 1
---
1. Read the last three months of card and bank payments by vendor (`mercury.read`) and the tools the team records as in use (`build.read`).
2. List the ten largest vendors and the recurring charges.
3. Flag subscriptions with no recorded use.
4. Write "Not recorded" for a vendor with no recorded owner.
5. Propose the review to the finance lead. It cancels nothing.
