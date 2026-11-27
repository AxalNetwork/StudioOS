---
name: nda-first-draft
description: Drafts a mutual NDA from the company profile and the counterparty's recorded details, for counsel to review.
roles: [general_counsel]
tools: [company.read, network.read]
output: draft
taxonomy: {legal_contracts: working, legal_corporate: aware}
version: 1
---
1. Read the company's legal name and jurisdiction (`company.read`) and the counterparty's recorded name and purpose (`network.read`).
2. Draft a mutual NDA: the parties, the purpose, what counts as confidential, the exclusions, the term and the return of materials.
3. Mark every bracketed blank the records do not fill as "Not recorded".
4. Add a note at the top that counsel must review the draft before anyone signs.
5. Propose the draft to the general counsel.
