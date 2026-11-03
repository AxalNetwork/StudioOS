---
name: architecture-decision-draft
description: Drafts an architecture decision record from a design discussion recorded in Build and the code it touches.
roles: [cto]
tools: [build.read, github.read]
output: draft
taxonomy: {eng_architecture: expert, eng_distributed_systems: advanced}
version: 1
---
1. Read the design discussion and the options recorded (`build.read`) and the code areas it names (`github.read`).
2. Write the record: the context, the options considered, their trade-offs, and the decision only if the discussion recorded one.
3. Where no decision was recorded, write "Not recorded" and list the open questions instead.
4. Note what the decision would change in the code, by repository.
5. Propose the draft to the engineering lead, who decides.
