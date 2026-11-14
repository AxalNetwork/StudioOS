---
name: terms-of-service-review-notes
description: Notes where the product's recorded terms of service and privacy policy no longer match what the product does.
roles: [general_counsel, cpo]
tools: [data_room.read, build.read]
output: brief
taxonomy: {legal_terms_policy: proficient, legal_privacy: working}
version: 1
---
1. Read the current terms and privacy policy from the data room (`data_room.read`) and the features shipped since they were dated (`build.read`).
2. List each shipped feature that the terms or policy do not describe, such as a new kind of data or a new message sent.
3. Quote the clause each gap relates to.
4. Write "Not recorded" for a policy with no effective date.
5. Propose the notes to the general counsel, who decides what changes.
