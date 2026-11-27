---
name: ip-assignment-check
description: Checks that each person on the roster has an IP assignment or contractor agreement filed in the data room.
roles: [general_counsel, people]
tools: [team.read, data_room.read]
output: brief
taxonomy: {legal_ip: working, legal_employment: working}
version: 1
---
1. Read the team roster, by name and role (`team.read`), and the agreements filed in the data room (`data_room.read`).
2. Match each person to a signed IP assignment or contractor agreement.
3. List the people with none on file.
4. Write "Not recorded" for an agreement with no signing date.
5. Propose the check to the general counsel. It explains the gap and decides nothing.
