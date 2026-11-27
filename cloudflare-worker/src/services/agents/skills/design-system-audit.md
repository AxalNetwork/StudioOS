---
name: design-system-audit
description: Lists where the product's screens drift from the recorded design system: colours, type and components.
roles: [cpo, cto]
tools: [build.read, github.read]
output: brief
taxonomy: {design_design_systems: proficient, design_ui: working}
version: 1
---
1. Read the design system tokens and components recorded in Build (`build.read`) and the front-end repository (`github.read`).
2. List hard-coded colours, font sizes and one-off components that duplicate a system component.
3. Group them by screen, with the file each lives in.
4. Write "Not recorded" for a token the system does not define.
5. Propose the audit to the product lead.
