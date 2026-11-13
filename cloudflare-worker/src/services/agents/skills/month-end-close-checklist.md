---
name: month-end-close-checklist
description: Prepares the month-end close checklist from the recorded accounts, open items and filings due.
roles: [cfo, coo]
tools: [mercury.read, stripe.read, compliance.read]
output: brief
taxonomy: {finops_accounting: proficient, finops_audit_controls: working}
version: 1
---
1. Read the bank accounts and their last reconciled date (`mercury.read`), payouts and refunds (`stripe.read`) and filings due this month (`compliance.read`).
2. List each close step: reconcile each account, match payouts, accrue known bills, review refunds and prepare filings.
3. Mark each account as reconciled or not, by its recorded date.
4. Write "Not recorded" for an account with no reconciliation date.
5. Propose the checklist to the finance lead. It books no entry.
