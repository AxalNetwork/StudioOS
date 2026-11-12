# Coding image

The digest-pinned Node image installs Git and util-linux, runs as node, and starts an idle process with no listener. `run-job.mjs` reads one bounded approved Git bundle/job from stdin, checks out the full SHA, runs approved commands with a reduced environment, and emits unsigned scoped file changes. The trusted Worker verifies paths and content hashes before the broker signs any manifest.

This prototype admits reviewed synthetic jobs only. Guest-side checks are helpful diagnostics, not the security boundary. Provider isolation must protect the host and other executions; the broker must enforce accepted artifact scope, current authorization and generation. No filesystem sandbox is claimed for hostile code. A fresh container is destroyed before artifact acceptance.

Build with Docker from this directory. In a managed environment, supply the system CA through the optional system_ca build secret; never copy session credentials, a Docker socket or proxy CA into the image. TLS verification stays enabled. Every image change must rerun the real fixture and vulnerability/SBOM pipeline. Candidate evidence does not constitute a published image signature or permission to admit it.
