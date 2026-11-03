---
name: release-notes-draft
description: Drafts customer-facing release notes from the changes merged and deployed since the last release.
roles: [cpo, cto, cmo]
tools: [github.read, vercel.read]
output: draft
taxonomy: {product_ops: working, mkt_copywriting: aware}
version: 1
---
1. Read the pull requests merged since the last release (`github.read`) and the deployments that shipped them (`vercel.read`).
2. Group the changes a customer would notice into New, Improved and Fixed; leave internal changes out.
3. Write each line in plain language, from the change's own title and description.
4. Mark a change with no deployment found as "Not recorded" for its release date.
5. Propose the draft to the product lead. It is published by a person, not by the agent.
