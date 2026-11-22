# Runner image preparation (#7889)

This namespace contains disabled image definitions, **not a resource inventory**.
The issue explicitly asks for image/profile preparation here. Unlike the branch
registry, no file in this directory claims a deployed machine, an approved image,
API access or spend. Nothing imports it into a deployment or provider client.

| File | Purpose |
| --- | --- |
| `linux-x64.image.template.json` | Unapproved format-1 Linux image template; unknown digests/versions are null and cannot advertise eligibility. |

Complete the pinned image only after #7885's bootstrap/profile contract and
#7888's measured small-pool proof. Validate immutable image digest, runner archive
digest, full runner/Node/Python versions, native architecture, boot readiness and
dependency compatibility. Provider image identifiers and account details belong
in private operator configuration. No broad credential is baked into an image.
