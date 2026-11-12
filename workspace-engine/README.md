# Coding workspace candidate (D5566)

A separate, disabled preview host for the WorkspaceSpec/ExecutorAdapter contract in D5565. This is not the meeting bot or the v1 deterministic runner. The existing AgentTaskWorkflow remains the task dispatcher, retry authority and usage ledger; this candidate is not mounted into it yet.

- `container/` holds the pinned, non-root coding image and one-job materializer.
- `worker/` holds the private Durable Object controller and Cloudflare adapter.
- `test/` holds actual local Docker fixtures and the pinned SBOM/vulnerability scanner.

The candidate configuration is `wrangler.toml`. Both the default and preview flag are off. No main Worker binding or production environment is added. The missing authorized broker service deliberately refuses all operations; do not replace it with an allow-all bridge. See `documentation/architecture/decisions/D5566.md` for the evidence boundary, integration prerequisites and teardown procedure.

Add another provider through the shared adapter contract, not a second task engine. Never grant the guest a D1, broad object-store, signing, GitHub or provider credential. Hostile coding workloads remain ineligible for this pilot until containment and hosted network/region enforcement have been verified.

The actual candidate SBOM/vulnerability scan currently denies image admission. The image workflow retains that refusal; it must not be waived to activate the pilot.
