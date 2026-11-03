---
name: intro-request-draft
description: Drafts a forwardable intro request to a named connector for one investor, from the recorded relationship and round.
roles: [investor_relations, ceo]
tools: [network.read, raise.read, project.read]
output: draft
taxonomy: {cap_fundraising: proficient, cap_investor_relations: working}
version: 1
---
1. Read the connector and the investor from the network (`network.read`), the round (`raise.read`) and the venture summary (`project.read`).
2. Draft a short note to the connector and a forwardable blurb: what the venture does, the round and why this investor.
3. Use only figures the records give; write "Not recorded" in place of a missing one.
4. Keep the blurb under 120 words.
5. Propose the draft to the CEO. A person sends it.
