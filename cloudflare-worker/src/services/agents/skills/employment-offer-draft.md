---
name: employment-offer-draft
description: Drafts an offer letter from the recorded role, salary band and start date, for counsel and the hiring lead to review.
roles: [people, general_counsel]
tools: [team.read, company.read]
output: draft
taxonomy: {legal_employment: proficient, finops_people_ops: working}
version: 1
---
1. Read the open role, its recorded salary band and start date (`team.read`) and the company's legal name and jurisdiction (`company.read`).
2. Draft the offer: the role, the reporting line, the salary, the start date, the at-will or notice terms for the jurisdiction, and the documents to follow.
3. Use only the recorded salary band; write "Not recorded" for an equity grant no record gives.
4. Add a note at the top that counsel must review the draft before it is sent.
5. Propose the draft to the hiring lead. A person sends the offer.
