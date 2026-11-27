---
name: mobile-release-checklist
description: Prepares a release checklist for the mobile app from its merged changes and recorded store requirements.
roles: [cto, cpo]
tools: [github.read, build.read]
output: brief
taxonomy: {eng_mobile: working, eng_qa_automation: working}
version: 1
---
1. Read the mobile repository's merged changes since the last release (`github.read`) and the store requirements recorded in Build (`build.read`).
2. List what to test, by screen, from the changes.
3. List each store requirement as met, not met or "Not recorded".
4. Note permissions the release adds.
5. Propose the checklist to the engineering lead. It submits nothing to a store.
