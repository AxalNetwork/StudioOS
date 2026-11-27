---
name: pull-request-summary
description: Summarises the open pull requests on the venture's repositories: what each changes, its age and its review state.
roles: [cto]
tools: [github.read]
output: brief
taxonomy: {eng_fullstack: working, eng_qa_automation: aware}
version: 1
---
1. Read the open pull requests, their authors by name, ages and review states (`github.read`).
2. Summarise each in one line: what it changes and what is blocking it.
3. Flag pull requests open more than 7 days or with a failing check.
4. Write "Not recorded" for a pull request whose checks were not read.
5. Propose the summary to the engineering lead.
