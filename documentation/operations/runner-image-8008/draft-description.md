## Objective

Part of #8008. Reconcile the actual current S39 integration source after merged preparation #8233; keep actual runtime qualification explicitly pending.

## Implementation

Freeze S39-designated source `8c11fb864c3466fec684ec6bb92409d33973b2ec`, tree `45e1f3acb44fe6bb0a346df867430d34b70128d2`. Verify actual Git bytes/ancestry and preserve receipts/deltas for historical c36, supplied 7214 and intermediate 241d. Merged executor #8231 `af71f2261b5f7a1fee65464b147f8625dd86eb1d` and incorporated d323 are ancestors; reviewed native executor files match the merged executor. Verify the actual planner definition/caller pin `19927c8960ec01377ff25d6d5a081ae8db080df5`; #8148 is merged.

Refresh source/lock inventory, separate current from historical receipts, and reconcile the one-second keeper correction, 150-second finish reserve, interruptible calls, durable create intent, bounded export and acknowledgement durability interface. Reuse the existing recipe, unchanged input checker, native probe, evidence schema and qualification procedure. The evidence checkout is anchored to main `4ea24068f07974b05c5cc53df5150aecbe12e32b`; the frozen integrated execution source is separately verified, not conflated with this documentation checkout.

## Files changed

- D8008-p2: follow-up decision, scope and limits; original merged D8008 unchanged.
- components.json, qualification-progress.json, evidence.json: exact source hashes, current lock inventory, separate gates and retained local failures.
- Package README, draft description, contract and qualification procedure: current source and runtime interface, precise pending environment/authority record.

## Testing

Source preflight exit 0; intentionally corrupted frozen-source hash refused with exit 2, restored preflight exit 0. Missing immutable build context refuses with expected exit 2. Acquired archive hash/ELF inspection and probe syntax exit 0. Static current-lock engine check: 365 eligible ranges, zero mismatches for target Node22.23.3; 192 other-platform entries excluded.

Folder documentation, decision IDs/appends, JSON/Python parsing, LFS and whitespace checks pass. Generated modules pass. The root frontend build exits 1 on this Darwin case-insensitive filesystem: differently cased JSX imports resolve to existing JS modules. Full application build success is not claimed. The complete guard run exits 1: 55/58 pass; docs-assets closure and bundle budget lack the built SPA, and frontend-builds repeats the same case-insensitive build failure. No guard was skipped. The final unmodified source regression selection has 136 cases: 103 pass, 32 fail and one existing root/ACL prerequisite skip. Failures are Linux runtime/platform prerequisites, BSD tar fixture-format incompatibility and the associated parent failure; all raw commands/exits/log hashes are retained privately. No assertion, test, fixture or guard was disabled or modified. Full native execution is NOT RUN.

## Risks

Documentation/evidence only; no application, executor, workflow, shared runtime/config or fleet-builder changes. No native resource created. Image/rootfs identities, exact engine/security/node baseline and current bounded operating authority have not been supplied to S31. Every build, provenance/SBOM, scan/signature, native compatibility/isolation/credential-denial, lifecycle/resource and actual-node cleanup gate stays NOT RUN; actual-node residual state is UNKNOWN. Image digest remains null. Source availability/receipt and static interface reconciliation are separate from independent source acceptance and native qualification.

## Dependencies

#8233 and #8231 merged; S39 #8234 source independently reconciled at the exact SHA above. S38/admin must supply the one current private operator record for the actual existing proposed host/artifact/actions; a precise request was delivered. Historical operating approval is not renewed. Owner explicitly authorizes this necessary batched reconciliation draft while #8232 remains open. No manual CI rerun/dispatch or repeated branch update is requested.

## Agent

S31 · Codex · session s31-8008. Same claim identity renewed. S09 executor, S39 integration, S38 bootstrap, S18 fleet-builder and operator/admin ownership retained.

## Help impact

None: runtime qualification evidence, no member-facing route, permission or product behavior change.

## Review requested

S09/S39 for the exact source/interface receipt, S18/S38/operator for qualification disposition and current inputs, and repository documentation/automatic independent review. Keep draft. Do not close #8008, deploy, provision, publish an image, change permissions, activate admission/pilot/Macs, or enter the merge queue from this PR.
