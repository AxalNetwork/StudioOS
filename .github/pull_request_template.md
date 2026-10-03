<!--
Fill in every section; write "None" where one does not apply. The task
protocol is in AGENTS.md. This repository is public: no secrets, tokens,
personal data or security-sensitive operational detail.
-->

## Objective

<!-- What changes and why, in a sentence or two. -->

Closes #<issue>

## Implementation

<!-- How it works, and the choices a reviewer should check. -->

## Files changed

<!-- The main files, one line each, with what changed in them. -->

## Testing

<!-- What ran, and its exit code: `npm run test:drift > drift.log 2>&1; echo EXIT=$?`.
New assertions mutation-checked both ways. `docs/` rebuilt if `frontend/src` changed. -->

## Risks

<!-- What could break, for whom, and how to roll it back. Say whether it ships
to production: the Worker, the frontend build, a D1 migration, wrangler.toml
(a new binding is re-declared under [env.production.*]; a new secret is
documented in documentation/architecture/PRODUCTION.md § 4). Security: no
secret in the diff, no new dangerouslySetInnerHTML without a sanitiser, auth
gates kept, a rate-limit bucket for any new public endpoint. -->

## Dependencies

<!-- Issues and PRs this depends on or blocks, as #numbers. -->

## Agent

<!-- Slot and agent, for example `S05 · Codex`. Name the model only if your
environment allows it. -->

## Review requested

<!-- Who should review. A significant PR gets an agent from another vendor. -->
