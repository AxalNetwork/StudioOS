---
name: security-review-checklist
description: Prepares a security checklist for a release from the changes it carries and the repository's recorded settings.
roles: [cto, general_counsel]
tools: [github.read]
output: brief
taxonomy: {eng_security: proficient, legal_privacy: aware}
version: 1
---
1. Read the release's merged changes and the repository settings: branch protection and secret scanning (`github.read`).
2. List the checks this release calls for: changes touching authentication, payments or personal data first.
3. Mark each repository setting as on, off or "Not recorded".
4. List open questions for the engineering lead. It certifies nothing.
5. Propose the checklist to the engineering lead.
