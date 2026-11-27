---
name: cap-table-change-summary
description: Summarises the cap table changes recorded since the last board meeting and shows ownership before and after.
roles: [cfo, general_counsel, ceo]
tools: [cap_table.read]
output: brief
taxonomy: {cap_cap_table: proficient, legal_securities: aware}
version: 1
---
1. Read the cap table's issuances, transfers and exercises since the last board meeting (`cap_table.read`).
2. List each change: who, what security, how many shares and the date.
3. Show fully diluted ownership before and after, by holder.
4. Write "Not recorded" for a change with no board consent date.
5. Propose the summary to the finance lead. It issues nothing.
