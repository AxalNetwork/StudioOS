---
name: due-diligence-request-list
description: Prepares the due-diligence request list for a round from what the data room already holds.
roles: [cfo, general_counsel, investor_relations]
tools: [data_room.read, cap_table.read, compliance.read]
output: draft
taxonomy: {cap_fundraising: proficient, legal_corporate: working}
version: 1
---
1. Read the data room index (`data_room.read`), the cap table summary (`cap_table.read`) and the compliance calendar (`compliance.read`).
2. Start from the standard list: corporate documents, cap table, financials, material contracts, IP, employees, compliance.
3. Mark each item as "In the data room" (naming the file) or "Not recorded: missing".
4. Never draft or alter a legal document. Point to the record that would answer each missing item.
5. Propose the list for the founder to work through. Nothing is shared with an investor.
