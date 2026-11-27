---
name: tech-debt-register
description: Builds a register of the technical debt the team has recorded, with where it lives and what it is slowing down.
roles: [cto]
tools: [build.read, github.read]
output: brief
taxonomy: {eng_architecture: advanced, eng_backend: working}
version: 1
---
1. Read the debt items recorded in Build (`build.read`) and the issues labelled debt on the repositories (`github.read`).
2. List each item with its area of the code, its recorded impact and how long it has been open.
3. Group the items by area, the oldest first.
4. Write "Not recorded" for an item with no recorded impact.
5. Propose the register to the engineering lead. It schedules nothing.
