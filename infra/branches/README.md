# infra/branches — one file per deployed branch

A **branch** is a subsidiary of Axal VC running one territory under a licence:
its own Cloudflare Worker (`studioos-<code>` at `<code>.axal.vc`) over its own
D1 database, KV pair, R2 buckets, queue and Vectorize index. This folder is the
only place a deployment is declared. See `documentation/architecture/DECISIONS.md`
D105 for why it is one file per branch rather than a table in D1: a deployment
must be readable before the database it describes exists.

| File | What it is |
| --- | --- |
| `_example.json` | The fixture `check-branch-config.mjs` renders on every build, so the guard has something to check before any branch is provisioned. Its ids are fake and its `status` is `example`; `gen-branch-wrangler.mjs` refuses it by name. |
| `<code>.json` | A real branch. The filename is the code, and the code is the hostname's first label. |

## The shape

```json
{
  "code": "fr",
  "licence_uid": "lic_…",
  "name": "Axal VC France",
  "hostname": "fr.axal.vc",
  "territory": ["FR", "BE", "LU"],
  "residency": {
    "d1_jurisdiction": "eu",
    "location_hint": "weur",
    "do_jurisdiction": "eu",
    "r2_jurisdiction": "eu"
  },
  "ids": { "d1": "…", "kv_tokens": "…", "kv_rate_limits": "…" },
  "status": "live",
  "created_at": "2026-09-15T00:00:00Z"
}
```

**Names are derived, never stored.** The Worker, database, queues, buckets and
index all follow from `code` (`derivedNames` in
`scripts/lib/branchConfig.mjs`). Only the things Cloudflare assigns — the D1
and KV ids — are recorded, because nothing can derive those.

**`residency` states what was actually granted, including when that is
nothing.** `d1_jurisdiction` and `r2_jurisdiction` are `eu`, `fedramp` or
`null`; `do_jurisdiction` adds `us`; `location_hint` is one of `weur`, `eeur`,
`enam`, `wnam`, `apac`, `oc`, or `null`. `do_jurisdiction` is APPLIED, not
only recorded (D264): `gen-branch-wrangler.mjs` renders it as the var
`BRANCH_DO_JURISDICTION`, and the Worker scopes every Durable Object through it
(`cloudflare-worker/src/util/doNamespace.ts`). It is write-once: an object's
jurisdiction is fixed when it is first created, so the value a branch is first
deployed with is the one it keeps. There is no Swiss or UAE option, so a
Geneva or Dubai branch records `null` and a hint — a null here is the honest
answer, not a missing value, and the licence record repeats it to the reader.

## The rule for adding one

`branch-provision.yml` writes the file as it creates each resource; a person
writing one by hand is recording a provisioning run that already happened. In
either case the entry must pass `node scripts/check-branch-config.mjs`, which
renders the branch's whole Worker config and refuses anything undeployable —
a route that is HQ's own host, a database id that is HQ's, a missing Durable
Object migration tag. That check runs in `npm run test:guards`, so a bad entry
fails the build rather than a deploy.

## Read-only verification

From the repository root, run `node scripts/check-branch-live.mjs --plan` to
validate declarations and list public smoke destinations without network calls.
It exits 2 if this registry has no real live/provisioning branch, rather than
reporting an empty check as passed. It also refuses shared D1/KV resources.

Once the listed hostnames are permitted by the environment's network settings,
run `node scripts/check-branch-live.mjs <code>` for one declared branch, or omit
the code to check all live/provisioning branches. It runs the configuration guard
and the existing `scripts/check-spa-live.mjs` against each declared hostname,
preserving the runner's failure status. It does not create resources, migrate,
deploy, change registry status, or mark a branch verified in production.

Passing public shell, asset and API-routing checks is only one part of U1.
Authenticated isolation also needs accounts belonging to two actual branches:
sign into each independently and confirm that each sees only its own records,
that the other branch's session is rejected, and that HQ's authorised branch
reporting works. Keep tokens and personal data out of evidence logs. Record the
declaration revision, deployed version, checks performed and outcomes; do not
infer isolation from a public health response or the example fixture.
