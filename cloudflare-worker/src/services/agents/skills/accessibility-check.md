---
name: accessibility-check
description: Checks a screen's recorded design and code for common accessibility gaps: contrast, labels, focus and alt text.
roles: [cpo, cto]
tools: [build.read, github.read]
output: brief
taxonomy: {design_accessibility: proficient, eng_frontend: working}
version: 1
---
1. Read the screen's recorded design notes (`build.read`) and its component code (`github.read`).
2. Check contrast against 4.5:1 for text, form fields for labels, focus order, and images for alt text.
3. List each gap with the component and file it is in.
4. Write "Not recorded" for a colour pair whose values were not read.
5. Propose the check to the product lead. It certifies no compliance.
