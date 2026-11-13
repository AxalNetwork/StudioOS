---
name: job-post-draft
description: Drafts a job post from a recorded role, its level and the team it joins.
roles: [people, ceo]
tools: [team.read, company.read]
output: draft
taxonomy: {finops_people_ops: working}
version: 1
---
1. Read the role record: title, level, team, location and whether a salary band is recorded (`team.read`).
2. Read the company's public profile for the "About us" paragraph (`company.read`).
3. Draft the post: about us, the role, what you will do, what you bring, how to apply.
4. State the salary band only when it is recorded. Otherwise write "Salary: Not recorded" so a person fills it in.
5. Use inclusive wording and list only requirements the role record names.
6. Propose the draft. It publishes nothing.
