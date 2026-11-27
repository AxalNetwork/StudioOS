---
name: open-source-license-check
description: Lists the open-source licences in the repositories' dependencies and flags the ones counsel should look at.
roles: [general_counsel, cto]
tools: [github.read]
output: brief
taxonomy: {legal_open_source: working, legal_licensing: aware}
version: 1
---
1. Read the dependency manifests and their licences from the repositories (`github.read`).
2. Group the dependencies by licence.
3. Flag copyleft licences (GPL, AGPL) and dependencies with no licence for counsel to look at.
4. Write "Not recorded" for a dependency whose licence the manifest does not give.
5. Propose the check to the general counsel. It explains the licences and decides nothing.
