---
name: cash-runway-snapshot
description: Reports cash on hand and runway from recorded balances and burn, computing runway only when both are recorded.
roles: [cfo, ceo]
tools: [mercury.read, grow.read]
output: brief
taxonomy: {finops_treasury: proficient, finops_fpna: working}
version: 1
---
1. Read the account balances (`mercury.read`) and the monthly burn recorded for the last three months (`grow.read`).
2. Give cash on hand, by account and in total, as of the balance date.
3. Compute runway as cash divided by average monthly burn, only when both are recorded; otherwise write "Not recorded".
4. Note any month whose burn is more than 20% above the average.
5. Propose the snapshot to the finance lead.
