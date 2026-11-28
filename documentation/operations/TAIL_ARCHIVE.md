# `studioos-tail`: deploying and rolling back the tail archive consumer

`studioos-tail` is the production Worker that receives the `studioos` Worker's
tail events and writes them to the R2 bucket `studioos-logs` as the long-term
log archive. Its source is `cloudflare-worker-tail/`. This runbook says how it
reaches production, how to see which version is live, and how to roll it
back. Everything here is read from the repository on 2026-11-27 (#9061).

## 1. What deploys it today: nothing automated

**No workflow deploys `studioos-tail`.** A pull request that changes
`cloudflare-worker-tail/` and merges to `main` does **not** reach production.
The live consumer keeps running whatever was last deployed by hand, until
someone deploys it as §3 says.

- `.github/workflows/cloudflare-worker-deploy.yml` deploys only the `studioos`
  Worker (root `wrangler.toml`).
- `.github/workflows/archive-observer-deploy.yml` lists
  `cloudflare-worker-tail/**` among its push paths, but its only deploy step is
  `wrangler deploy --config cloudflare-archive-observer/wrangler.jsonc`, the
  separate observer. A change to the tail source starts that workflow (when its
  `ARCHIVE_OBSERVER_DEPLOY_ENABLED` gate is on) and still leaves
  `studioos-tail` as it was.
- No workflow names `cloudflare-worker-tail/wrangler.toml`.

What CI does cover: `cloudflare-worker/tsconfig.json` includes
`cloudflare-worker-tail/src`, so `npm run test:types` type-checks it;
`cloudflare-worker/test/cloudflare_archive_5676.test.ts` (in `test:worker`)
tests the archive writer and protocol; and the `check-tail-consumer` guard (§5)
holds the wiring. None of them deploys anything.

Whether a gated deploy job should be added is an owner decision, recorded on
#9061. Until it is made and built, a merge that touches
`cloudflare-worker-tail/` needs the manual deploy below to take effect.

## 2. What is deployed

| | |
| --- | --- |
| Worker name | `studioos-tail` (`name` in `cloudflare-worker-tail/wrangler.toml`) |
| Config | `cloudflare-worker-tail/wrangler.toml`; entry `src/index.ts`, which exports only `tail()` |
| Bindings | R2 `LOGS` → bucket `studioos-logs`; vars `RETENTION_DAYS = "2555"`, `ENVIRONMENT = "production"`; `workers_dev = false`, no routes |
| Not in the config | The optional observer telemetry the code reads (`ARCHIVE_TELEMETRY`, the `ARCHIVE_OBSERVER` service binding, the `ARCHIVE_OBSERVER_SECRET` secret, D5676). None is declared, so telemetry is off and archive writes go on without it. |
| Producer side | The root `wrangler.toml` names it under both `[[tail_consumers]]` and `[[env.production.tail_consumers]]`. The `studioos` release wires it; deploying `studioos-tail` changes no wiring. |

## 3. Deploy by hand

**Credentials.** No repository or GitHub environment credential is assigned to
`studioos-tail` (`documentation/operations/production-credential-inventory.json`
names none). Wrangler reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
from the environment: the token must be able to edit Workers scripts on the
account that holds `studioos-tail`. Use your own, never a value pasted into a
file, chat or issue.

From the repository root, on a clean checkout of the `main` commit you mean to
ship:

```bash
git status --short                                   # must print nothing
npm ci --prefix cloudflare-worker                    # the wrangler the CI jobs use
node scripts/check-tail-consumer.mjs                 # §5; must pass before any deploy

# Package without uploading, and read the bindings it prints:
# LOGS (studioos-logs), RETENTION_DAYS, ENVIRONMENT, and nothing else.
cloudflare-worker/node_modules/.bin/wrangler deploy --dry-run \
  --config cloudflare-worker-tail/wrangler.toml --outdir "$(mktemp -d)"

# Record what is live now (§4), so you can roll back to it.
cloudflare-worker/node_modules/.bin/wrangler deployments list --config cloudflare-worker-tail/wrangler.toml

# Deploy, naming the commit in the version's message.
cloudflare-worker/node_modules/.bin/wrangler deploy \
  --config cloudflare-worker-tail/wrangler.toml \
  --message "main $(git rev-parse --short=12 HEAD)"
```

`cloudflare-worker-tail/package.json` has the same steps as `npm run dry-run`
and `npm run deploy`, after `npm ci --prefix cloudflare-worker-tail`; its
header comment in `wrangler.toml` gives `cd cloudflare-worker-tail && npx
wrangler deploy`. Either way it is this one Worker: nothing here deploys
`studioos`, which ships only through the release workflow
([DEPLOY.md](DEPLOY.md)).

Never bind a tail consumer by hand in the Cloudflare dashboard. A reverse
binding (`studioos-tail` → `studioos`) makes Cloudflare call `studioos.tail()`,
which does not exist, and floods observability with "Handler does not export a
tail() function." errors.

## 4. Which version is live

```bash
cloudflare-worker/node_modules/.bin/wrangler deployments list --config cloudflare-worker-tail/wrangler.toml
cloudflare-worker/node_modules/.bin/wrangler versions list    --config cloudflare-worker-tail/wrangler.toml
```

`--config` names the Worker from its own config, so the command cannot fall
back to the root `wrangler.toml` (`studioos`). From a directory with no
`wrangler.toml`, `wrangler deployments list --name studioos-tail` is the same
read. The newest deployment is live. Its version's message says which commit it is
when the deploy followed §3; an older version without one can be matched only
by its upload time against `git log -- cloudflare-worker-tail/`. Nothing in
the repository records the live version, and `studioos-tail` has no route to
ask.

## 5. The wiring invariant: `scripts/check-tail-consumer.mjs`

The guard (in `npm run test:guards`, id `check-tail-consumer`) fails when:

1. `cloudflare-worker-tail/wrangler.toml` declares any `tail_consumers` table
   (the consumer must never act as a producer), or
2. the root `wrangler.toml` does not declare `service = "studioos-tail"` under
   both `[[tail_consumers]]` and `[[env.production.tail_consumers]]`.

Run it before every hand deploy (§3). A change that breaks it does not merge.

## 6. Roll back

**There is no automated rollback.** The release workflow's `rollback` job
(D7152) acts only on the `studioos` Worker. To return `studioos-tail` to an
earlier version:

```bash
W=cloudflare-worker/node_modules/.bin/wrangler; C=cloudflare-worker-tail/wrangler.toml
$W versions list --config $C                       # pick the version id to return to
$W rollback <VERSION_ID> --config $C --message "rollback: <reason>"
$W deployments list --config $C                    # confirm it is the live one
```

A rollback changes only the code and config of `studioos-tail`. It does not
touch objects already written to `studioos-logs`, and it does not change the
producer wiring. Then fix forward: revert or correct the source on `main`, and
deploy that commit by §3, so the repository and the live Worker agree again.

## 7. Checking the archive is being written

- **Cloudflare dashboard:** the `studioos-tail` Worker's invocations and its
  `[studioos-tail]` error logs, and new objects in `studioos-logs`.
- **`scripts/check-tail-archive.mjs`** (D5676) asks the independent archive
  observer for its view of the archive and exits non-zero on `firing` or
  `unknown`. It needs `ARCHIVE_OBSERVER_ORIGIN` (a `studioos-archive-observer`
  workers.dev origin) and `ARCHIVE_READER_SECRET`, and reports `unknown`
  without them. The consumer's telemetry to that observer is not configured
  (§2). No workflow runs it.

Related: `documentation/operations/PLATFORM_OBSERVABILITY.md` lists
`studioos-tail` among production's bindings, and
`documentation/operations/CLOUDFLARE_DELIVERY_5671.md` treats it as a
production script. Archive write-failure detection is #5676; deployment
receipts are #5673.
