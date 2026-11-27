---
name: privacy-data-map
description: Maps the personal data the product records: what is collected, where it is stored and who can see it, from the build records.
roles: [general_counsel, cto]
tools: [build.read, github.read]
output: brief
taxonomy: {legal_privacy: proficient, legal_data_governance: working}
version: 1
---
1. Read the data inventory recorded in Build (`build.read`) and the schema files on the repositories (`github.read`).
2. List each kind of personal data, the table or service holding it, and the roles that can read it.
3. Flag personal data with no recorded retention period.
4. Write "Not recorded" for a field whose purpose is not stated.
5. Propose the map to the general counsel. It explains what is recorded and decides nothing about compliance.
