# scripts/lib — the pure half of the scripts

Every file here is a module with no side effects: no `spawnSync`, no network,
and filesystem reads only where the thing being described *is* a file tree.
The CLI that owns each one does the effects and the arguing with the operator;
this is the part that can be unit-tested and, more importantly, the part that
can be read to find out what a rule actually is.

| File | What it decides |
| --- | --- |
| `migrationPlan.mjs` | The migration ledger's shape, the baseline cutoff, and what to do with each file — apply, mark, or skip. Owned by `../migrate-d1.mjs`. |
| `migrationTargets.mjs` | Which database a migration run touches, and which database may never be bootstrapped. One `--branch <code>` target per subsidiary, each naming the config that declares it. |
| `branchConfig.mjs` | A branch Worker's whole `wrangler.toml`, derived from HQ's `[env.production]` table, plus what a registry entry must contain and what a rendered config must never say. Owned by `../gen-branch-wrangler.mjs` and `../check-branch-config.mjs`. |
| `rpcSurface.mjs` | The RPC surface between HQ and a branch, read off the source (D207, D209): which methods each entrypoint class declares and takes, and which of them anything in the Worker calls across the tier boundary. Read as text, because `cloudflare-worker/src/rpc/index.ts` imports a module only the Workers runtime has. Two readers: `rpcEntrypoints.test.mjs` and `cloudflare-worker/test/topology_d209.test.ts`, which holds HQ's Topology page and a branch's S14 to the same facts. |
| `assetGeneration.mjs` | The assets ONE build's shells reach — what the no-ledger seed keeps, so `docs/assets` stops growing (D183). |
| `assetRetention.mjs` | Which hashed assets in `docs/` a build keeps and which it may prune. |
| `sourceTreeHash.mjs` | The content hash of `frontend/src` that `docs/.build-source` records, so "is this bundle built from this source" is answerable (D103). |
| `buildStamp.mjs` | Whether `docs/.build-source` is absent, readable or corrupt — three states, not two. Absent is a strict failure (D218); present-but-unreadable (a `merge=union` result, say) must never pass under --strict either (D113). |

## Tests

`npm run test:retention` runs every `*.test.mjs` in this folder. Seven of the
eight modules are covered here; `migrationPlan.mjs` is the exception, and
deliberately so — its behaviour is pinned against a real SQLite database by
`cloudflare-worker/test/migrate_d1_plan.test.ts` and
`cloudflare-worker/test/migrations_fresh_build.test.ts`, which run the actual
migrations rather than a model of them.

`rpcEntrypoints.test.mjs` is where `rpcSurface.mjs` is exercised. It holds
`branchConfig.mjs`'s two entrypoint names against the RPC classes in
`cloudflare-worker/src/rpc/index.ts` and against every call that crosses the
tier boundary, derived from the source rather than pinned (D207), with a
floor of known call sites so a harvest that stops matching fails rather than
passing over nothing.

## The rule for adding to it

A module belongs here when a CLI's *decision* is worth testing separately from
its *effects* — which is most of them, and all the dangerous ones. If it needs
to spawn something or talk to Cloudflare, that part stays in the script above.
