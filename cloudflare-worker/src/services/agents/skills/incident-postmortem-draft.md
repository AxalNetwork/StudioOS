---
name: incident-postmortem-draft
description: Drafts a blameless postmortem from the deployments and the incident notes recorded around an outage.
roles: [cto, coo]
tools: [vercel.read, build.read]
output: draft
taxonomy: {eng_site_reliability: proficient, eng_devops: working}
version: 1
---
1. Read the deployments around the incident window (`vercel.read`) and the incident notes recorded in Build (`build.read`).
2. Write the timeline: detection, response, mitigation and resolution, each with its recorded time.
3. Describe contributing factors from the notes, without naming anyone as the cause.
4. Write "Not recorded" for a time or impact figure no record gives.
5. Propose the draft, with follow-up actions as suggestions, to the engineering lead.
