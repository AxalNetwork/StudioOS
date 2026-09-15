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
`enam`, `wnam`, `apac`, `oc`, or `null`. There is no Swiss or UAE option, so a
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
