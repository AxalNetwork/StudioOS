---
name: corporate-records-checklist
description: Lists the corporate records a diligence review expects and marks which are in the data room and which are missing.
roles: [general_counsel, cfo]
tools: [data_room.read, cap_table.read]
output: brief
taxonomy: {legal_corporate: proficient, cap_cap_table: working}
version: 1
---
1. Read the data room index (`data_room.read`) and the cap table's issuances (`cap_table.read`).
2. Check for the charter, bylaws, board consents for each issuance, stock purchase agreements and the 83(b) elections recorded.
3. Mark each as in the data room, missing, or "Not recorded" when the cap table does not say whether it applies.
4. Group the missing items by the issuance they belong to.
5. Propose the checklist to the general counsel.
