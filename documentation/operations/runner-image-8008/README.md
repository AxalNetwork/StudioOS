# Linux runtime image preparation (#8008)

**Image status: qualification pending.** This is an offline review package for
S09 (#7905/#7885) and S18 (#7889), not a fleet builder or a qualified image.
No build, scan, signature verification, registry publication or real-node test
has run. `AGENT_ENGINE=off`; the #5719 publication hold remains in force.

| File | Purpose |
| --- | --- |
| `contract.md` | Exact executable, identity, environment and isolation contract, with source revisions and recipe inventory. |
| `components.json` | Source hashes, runtime artifact pins, lockfile integrity inventory and explicitly missing immutable inputs. |
| `Dockerfile.template` | Review-only offline image recipe; requires a separately approved rootfs and verified context. |
| `verify-inputs.py` | Offline source-drift and input-integrity preflight; never downloads, builds or publishes. |
| `native-probe.sh` | Prepared native Linux probe, to be run as candidate UID only inside the owner-verified boundary. |
| `qualification.md` | Separate source, reproducible build, SBOM, scan, approval and actual-node evidence gates. |
| `evidence.json` | Actual local commands, exit codes and unavailable tools; no fixture represents live evidence. |
| `draft-description.md` | Local review description and shared-file integration handoff. |

From repository root, source-only review is
`python3 documentation/operations/runner-image-8008/verify-inputs.py`.
`--context /absolute/offline/context` additionally requires immutable build
inputs and verifies their bytes. It currently refuses with exit 2 because the
rootfs and system package pins have not been supplied. A passing source check
does not waive this refusal. No installer or image acquisition is included.

The component manifest records repository pins, not independently authenticated
upstream artifacts. The operator must authenticate them against the recorded
official release sources before building. Node/Python archives are not fetched
by this package. The denied #5566 coding-workspace image is excluded, including
its recipe, layers, scan exceptions and alternative download routes.

Local patch and bundle checksums are delivered separately on #8008 to avoid a
self-referential artifact hash. The coordinator owns integration and any later
publication. A prepared child does not close #7905 or authorize runner activation.
