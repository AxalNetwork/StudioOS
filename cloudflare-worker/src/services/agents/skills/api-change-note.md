---
name: api-change-note
description: Drafts a note for API consumers about a breaking or deprecating change found in the merged pull requests.
roles: [cto, cpo]
tools: [github.read]
output: draft
taxonomy: {eng_api_design: proficient, product_platform: working}
version: 1
---
1. Read the merged pull requests labelled api or breaking (`github.read`).
2. For each change, say what changes, who it affects and what a consumer must do.
3. Give the removal date only when the pull request records one; otherwise write "Not recorded".
4. Keep the note in plain language, with one example request per change.
5. Propose the draft to the engineering lead. A person sends it.
