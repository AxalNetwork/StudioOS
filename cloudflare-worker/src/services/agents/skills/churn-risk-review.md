---
name: churn-risk-review
description: Lists accounts showing churn signals in the recorded usage and support data, with the signal for each.
roles: [sales, coo]
tools: [grow.read]
output: brief
taxonomy: {gtm_customer_success: proficient, product_analytics: working}
version: 1
---
1. Read each account's usage trend, support tickets and renewal date (`grow.read`).
2. Flag accounts whose usage fell more than 30% over the last 60 days, or with a renewal in 60 days and open tickets.
3. Give the signal and its figures for each flagged account.
4. Write "Not recorded" for an account with no renewal date.
5. Propose the review to the customer success lead. It contacts no one.
