## Objective

Publish the existing Linux runtime qualification preparation for review while its actual qualification remains pending.

Part of #8008. Supports #7905, #7885 and #7909; this PR does not close them.

**Image status: qualification pending.** This package does not establish a usable, built, scanned or natively tested runtime.

## Implementation

Preserve the runtime/UID/path/mount contract, offline recipe and fail-closed input checker, component/provenance inventory, prepared native probe, evidence records and qualification procedure. Add one six-part operator input record and record the owner's explicit draft-publication authorization. The historical #5719 publication hold is closed.

S31 previously verified actual receipt of S09 c36 (`c36bf920613ff28bb7c3571d78994cf1a5d7f18c`, tree `1b87eae7f4e4de9f6ed1b23f7770930450f47fa3`). This preparation retains that identity. Coordinator acknowledgment of f13 and the earlier S39 checkpoints does not constitute S31 receipt or qualification of a final designated combined candidate. Any newer candidate needs separate exact-revision reconciliation. Source preflight requires the referenced Git objects; a public clone without the private c36 object refuses. The previously received private packet is not published by this PR.

The operator must supply one completed input record through the established private handoff:

1. Existing approved Linux amd64 builder/rootfs, or immutable OCI artifacts with build, SBOM, accepted scan and provenance evidence.
2. Reviewed immutable candidate image digest and archive/config/engine-ID mapping.
3. Exact engine/version and effective security baseline.
4. Intended-node architecture, OS/kernel, engine/security configuration, resource limits and required tooling.
5. Current bounded qualification reference/runbook, operating window, stop conditions and shutdown responsibility.
6. Final S39-designated executor/integration revision, prerequisites and verified source receipt.

All six remain NOT SUPPLIED. Actual build, provenance/SBOM, scan, signature verification, image approval and native/actual-node gates remain NOT RUN.

## Files changed

- `documentation/operations/runner-image-8008/`: contract, component inventory, offline recipe/input checker, native probe, evidence, qualification procedure, blank operator input record and review description.
- `documentation/architecture/decisions/D8008.md`: source identities, separated evidence gates and publication authorization.
- `documentation/operations/README.md`: previously owner-authorized append-only package registration.

## Testing

Current reruns:
- Offline source/profile/lock preflight: EXIT=0. This verifies the recorded older source, not a qualified image or a final combined revision.
- Build-input preflight: expected refusal EXIT=2 for the still-missing inputs; no build attempted.
- Python AST, all package JSON and native-probe shell syntax: EXIT=0. The probe was not executed.
- Folder documentation, decision IDs and decision-appends through their exported APIs, and whitespace: EXIT=0.
- Published-file scope and public-reference review completed; detailed private packets remain outside this PR.

Historical archive/ELF/engine-range and c36 intake checks are retained with their original identities and timestamps. They were not promoted to current native evidence. Full application build/drift and all actual image/native gates were not run for this preparation-only publication update.

Historical checks and current reruns are distinguished in the evidence. Source/preparation checks do not establish image or node qualification. No new runtime logic or assertion-only tests were added in this publication update.

## Risks

Preparation artifacts only. Any eventual use requires complete immutable input review and current operating authorization. The offline build-input preflight remains fail-closed. The denied #5566 image remains excluded.

S09 executor, S39 composition, S18 lifecycle/fleet-builder files, workflows, bootstrap, profiles and `infra/runners/` are unchanged. Admission and pilot controls remain disabled, `AGENT_ENGINE=off`, Mac execution disabled, hosted CI/required-check consumers and resource limits unchanged. No registry publication, live dispatch, installation, provisioning, permissions change, ready/queue/merge, deployment or activation is included.

## Dependencies

Verified current facts: #5719 closed; #7972, #7981 and #8055 merged. #8148 remains open and ready for review at `29eb838db6a703b9413f06089b40f1130f94c4b9`; S39 owns reconciliation of the actual selected or landed immutable planner/caller revision. This preparation creates no competing planner or combined integration implementation.

## Agent

S31 · Codex. Owned branch `agent/s31/8008-linux-image-qualification`; existing claim identity `s31-8008` verified. Keep this PR draft.

## Help impact

None. This is an operator/source-review preparation package without a member-facing product change.

## Review requested

S09/S39 for exact final source reconciliation; S18/operator for the six-part input record; independent review of the preparation. Acceptance of this package is separate from runtime, integration and pilot acceptance.
