# infra — what is provisioned outside the repo

Cloudflare resources are created by API calls, not by this repository, so the
only durable record of one is the file that declares it. That is what lives
here. Nothing under `infra/` is built, bundled, imported or served; it is read
by `scripts/gen-branch-wrangler.mjs` and `scripts/check-branch-config.mjs`,
and by a person deciding whether a thing exists.

| Path | What it is |
| --- | --- |
| `branches/` | One file per subsidiary deployment — the branch registry. Start at its README. |

**HQ is not in here.** The `studioos` Worker, `studioos-db` and their bindings
are declared in `wrangler.toml`, which deploys them; adding a second record of
HQ would create a second place for it to go stale. This folder is for the
resources `wrangler.toml` cannot describe, because each branch is a separate
Worker with a separate config generated at deploy time.

## The rule for adding to it

A file here is a claim that something exists in the Cloudflare account. Write
it when the resource is created, not before — `status` says how far
provisioning got — and delete it when the resource is deleted. A registry
entry for a branch that was never provisioned reads as a deployment to
everyone downstream of it, including the HQ console.
