# Linux runtime image preparation (#8008)

**Image status: qualification pending.** This is an offline review package for
S09 (#7905/#7885) and S18 (#7889), not a fleet builder or a qualified image.
No build, scan, signature verification, registry publication or real-node test
has run. `AGENT_ENGINE=off`. The owner authorized source publication as a draft on
22 November 2026; #5719 is closed. Actual qualification remains blocked on the
remaining environment/authority inputs in the `operator_input_record` in `qualification-progress.json`.

| File | Purpose |
| --- | --- |
| `contract.md` | Exact executable, identity, environment and isolation contract, with source revisions and recipe inventory. |
| `components.json` | Source hashes, runtime artifact pins, lockfile integrity inventory and explicitly missing immutable inputs. |
| `Dockerfile.template` | Review-only offline image recipe; requires a separately approved rootfs and verified context. |
| `verify-inputs.py` | Offline source/input verification and optional acquired runtime ELF inspection; never downloads, executes inputs, builds or publishes. |
| `native-probe.sh` | Prepared native Linux probe, to be run as candidate UID only inside the owner-verified boundary. |
| `qualification.md` | Separate source, reproducible build, SBOM, scan, approval and actual-node evidence gates. |
| `evidence.json` | Actual local commands, exit codes and unavailable tools; no fixture represents live evidence. |
| `qualification-progress.json` | Acquired runtime byte/ELF evidence, current source audit and outstanding native build/scan/node gates. |
| `draft-description.md` | Draft publication description and qualification limitations. |

From repository root, source-only review is
`python3 documentation/operations/runner-image-8008/verify-inputs.py`.
The preflight requires every referenced source commit object. The older c36
object was verified through the approved private intake; a public clone without
it fails closed. Keep that packet in its approved channel. Use the final
published S09/S39 candidate or approved source handoff and reconcile it before
qualification; no repeat c36 delivery to S31 is requested.

`--context /absolute/offline/context` additionally requires immutable build
inputs and verifies their bytes. It currently refuses with exit 2 because the
rootfs and system package pins have not been supplied. A passing source check
does not waive this refusal. No installer or image acquisition is included.

To inspect pre-acquired runtimes without executing them, run
`python3 documentation/operations/runner-image-8008/verify-inputs.py --inspect-runtime-archives <input-directory>`.

The acquired Node/Python archives match repository SHA256 pins and official HTTPS
checksum/release metadata. Static ELF inspection and bundled npm 10.9.9 are
recorded in `qualification-progress.json`; release-signature policy verification
remains pending. The inspection tool reads pre-acquired files without downloading
or executing them. The denied #5566 coding-workspace image is excluded, including
its recipe, layers, scan exceptions and alternative download routes.

Local patch and bundle checksums are delivered separately on #8008 to avoid a
self-referential artifact hash. The owner-authorized shared operations README
entry is included. S31 is authorized to publish this preparation draft; S39 owns combined integration.
A prepared child does not close #7905 or authorize runner activation.

The current independently received and statically reconciled S39 candidate is
`8c11fb864c3466fec684ec6bb92409d33973b2ec`, tree
`45e1f3acb44fe6bb0a346df867430d34b70128d2`. It supersedes the received
`7214b4c3` checkpoint by two corrections across eight files. Merged executor #8231 and
the actual planner/caller pin are verified. The historical c36 receipt remains
verified and is not requested again. See `qualification-progress.json` under
`source_reconciliation` for separate source, interface and native gate results.
The completed current operator record has not been received by S31; no immutable
image identity or native acceptance is inferred from source availability.
