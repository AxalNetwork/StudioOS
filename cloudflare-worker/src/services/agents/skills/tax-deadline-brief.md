---
name: tax-deadline-brief
description: Lists the tax filings and payments due in the next 90 days from the recorded compliance calendar.
roles: [cfo, general_counsel]
tools: [compliance.read, company.read]
output: brief
taxonomy: {finops_tax: working, legal_tax_law: aware}
version: 1
---
1. Read the compliance calendar's tax items (`compliance.read`) and the company's jurisdictions (`company.read`).
2. List each filing or payment due in the next 90 days, with its jurisdiction and due date.
3. Mark items whose preparation is not recorded as started.
4. Write "Not recorded" for an amount no record gives; it never estimates one.
5. Propose the brief to the finance lead. It files nothing.
