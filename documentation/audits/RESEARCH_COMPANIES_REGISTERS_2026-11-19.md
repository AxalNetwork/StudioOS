# Research company registers — 2026-11-19 application audit

This is the 2026-11-19 application record at checkout base
`9080dbb67e39c89f953b57260fffe280ab8255d5`, with the compiler and test
bytes pinned below. **Production status: APPLIED AND VERIFIED** at
`2026-11-19T01:13:09.982Z`, on the bounded database checks described below.
The durable contract is [D7316 part 2](../architecture/decisions/D7316-p2.md).

## Applied cohort and count boundaries

| Primary register | Country | New admitted identities |
| --- | --- | ---: |
| RIK | Estonia | 8,000 |
| PRH | Finland | 8,750 |
| BRREG | Norway | 8,750 |
| **Total** | **Three European countries** | **25,500** |

The complete baseline contained 17,396 directory rows at
`2026-11-19T00:42:04.721Z`. Production readback confirmed 42,896 physical rows
after application. No baseline row is counted toward this
batch's 25,500 usable admissions. In particular, the older **11,000 held bulk
rows remain unchanged and excluded from the usable target**. No removal or
quality clearance for that earlier cohort is part of this work.

The largest new-country share is 34.31%. The batch passes the count and 35%
concentration limits but **fails the original D7316 worldwide gate**: three
countries are fewer than 50, and North America, Asia, Latin America, Africa,
the Middle East and Oceania receive no new rows. It must not be reported as
completion of that worldwide requirement.

Selection followed native primary evidence, the mandatory 314-entry recovered
quality-hold ledger, complete baseline deduplication and deterministic rotation
across source-native industry codes within each country. The cohort comprises
accepted corporate legal forms with registry-reported homepages. Reachability,
current website ownership, trading activity and investment suitability were
not independently verified. Unsupported metrics remain unknown.

### Selected Finnish legal forms

Counts were reconciled by registration identifier to the complete native PRH
proof ledger. Labels below use the preserved official
[YRMU codebook](https://avoindata.prh.fi/opendata-ytj-api/v3/description?code=YRMU&lang=en),
retained with the run as `prh/codes-YRMU.txt`.

| YRMU code | Short form | Official codebook label | Selected rows |
| --- | --- | --- | ---: |
| 16 | OY | Limited company | 8,732 |
| 17 | OYJ | Public limited company | 17 |
| 24 | VOY | Limited insurance company | 1 |
| **Total** | | | **8,750** |

The native record's English label for code 24 is `Insurance company`; its
codebook label is more specific. There are no selected code 23 or 80 rows.
Partnership codes 5 and 13 are excluded by the compiler; this is not a
partnership import. Only the batch report's descriptive source-scope string was
corrected after this check; admission, selected candidates and SQL were unchanged.

## Frozen inputs and proposal

Artifact names refer to retained run records, not necessarily public repository
files. The delivered bundle omits the full pre-existing directory snapshot;
only its pinned hash and bounded aggregate proof are included. Exact historical
recompilation/replay requires a separately authorized matching baseline. The
source projections omit unrelated personal/contact information. Native
card-note risk evidence is retained as exact routine text or a rejecting marker
with its original source-note hash.

| Artifact | SHA-256 |
| --- | --- |
| `scripts/import-register-companies.mjs` | `65223e4be23f1955914973b09e14847b405f03743655cc79104096e2c0527437` |
| `cloudflare-worker/test/research_companies_registers_d7316.test.mjs` | `b0a5a322e7e096078929a984009bee30f387d87456de199fc3b89c3d1b3a7e06` |
| `consolidated-company-quality-holds.json` — 314 entries | `4b2c845f9c4528e62bb68b6650574a2e38acb2b79ca487250ff15eee7befb988` |
| `brreg/all-primary-records.jsonl` | `e482330ae4c4a148b82e618c97b9355986d0a3179cf5936af4332ca2131e448e` |
| `prh/all-eligible-primary-records.jsonl` | `f366568e6c8c0b23cd3cbcf32e7bd251dc3edf032330f764bfb428ceaf5547a8` |
| `estonia/eligible-primary-records.jsonl` | `abb44051b932c66f1e7f8f6428d8457dde65354922df638a78ad75691fb30b36` |
| Historical baseline `batch/existing-snapshot.json` — hash only; file omitted | `c476d0adede07a75089d8d47e6e5652e696e2870763d25937bd6008b5c37e3b0` |
| `batch/selected-candidates.json` | `2418a1f1358e2c3ecbe7eaca4dfcdfad83dfacfbe0c8aefdc836c457cd79602a` |
| `batch/proposed-import.sql` | `99a5fff7fa886f6decd0b186cab464edf6f3ef2211569fb4469206a69cf5385f` |
| `batch/production-receipt.json` | `cf56a7c8ea3897a16807316dbab5179a9c3ff3cc1794b257dae552df19741ea0` |
| `batch/production-postflight.json` | `b0661ffe4721672fe5541454abd64aed2f3097fa076e79d16a9fc6005e7627e4` |
| `batch/postflight-assertion-result.json` | `cb70caa722bd85f1fcc3047e7e1ff6eaebaae94ac8145077cb2bf6c53aa9236d` |

The applied SQL contains **683 bounded statements** and **27,000,648 UTF-8
bytes** in total. It performs additive company/evidence inserts only. Each
company's evidence belongs to the exact admitted identity and source values;
unchanged baseline records cannot receive conflicting evidence. Source licence
attribution and retrieval dates remain attached to the rows and source audit.

## Verification completed locally

The combined focused run passed **16/16 tests**: seven registry tests and nine
unchanged Wikidata tests. The latter include a synthetic 25,000-row SQLite
import/replay and directory-service pagination/facet exercise. Synthetic rows
never count toward the source cohort.

`batch/local-verification.json` records the rehearsal of the actual frozen SQL:

| Check | Observed local result |
| --- | ---: |
| Source-backed new rows | 25,500 |
| Resulting physical directory rows | 42,896 |
| New company evidence rows | 110,750 |
| Baseline rows preserved | 17,396 |
| Rows/evidence added by replay | 0 / 0 |
| Unsupported metrics populated | 0 |
| Import / replay elapsed time | 240,478 ms / 1,012 ms |

The production directory service code returned local country-filter totals of
8,061 for Estonia, 9,153 for Finland and 9,008 for Norway, each with 25-row pages;
these totals include matching baseline rows. Detail and evidence checks passed.
This was local execution, not a live production API observation or production
latency measurement.

The root build and full drift suite could not run because the sparse frontend
checkout lacked `apiModules.generated.js`. Full build, drift and remote CI
gates are **not verified**. No CI dispatch or Worker/frontend deployment is
evidenced here; the completed action was a data import.

## Production receipt and bounded readback

**Status: APPLIED AND VERIFIED.** Completion was verified at
`2026-11-19T01:13:09.982Z`. The exact reviewed plan was applied in **22 sequential
query batches**, with the effects checked per statement. The initial bulk
endpoint reported active and then no active import; an aggregate read confirmed
zero newly committed register companies before the query-batch application.
The successful receipt belongs to the query batches, not that bulk attempt.

All ten assertions in `batch/postflight-assertion-result.json` passed against
the bounded production result:

| Production check | Verified result |
| --- | --- |
| Directory identities | 25,500 distinct new UIDs; 42,896 total rows; 17,396 original rows |
| Registry/country provenance | Estonia 8,000; Finland 8,750; Norway 8,750; zero provenance/date errors |
| Required fields and unsupported metrics | Zero incomplete rows, unsupported metric values or unsupported founding years |
| Original-row aggregates | All recorded aggregates for 17,396 rows matched the baseline |
| Prior quality-held cohort | 11,000 rows still present; none counted toward the usable target |
| Evidence counts | 110,750 new; 148,276 total; 37,526 pre-existing/other evidence rows |
| Evidence provenance | Zero invalid evidence records |
| Per-company evidence | All 25,500 new companies had the expected field evidence |
| Normalized domain keys | 25,500 distinct new hosts; zero internal or old-row collisions |
| Normalized name/country keys | Zero internal or old-row collisions on the tested keys |

The production preservation result is an aggregate comparison, not a fresh
row-by-row export. Automatic approval review rejected an optional repeat export
of the full pre-existing directory for an additional identity comparison. It
was not retried; the materially smaller server-side aggregate comparison and
insert-only runtime guards supplied the final verification. The baseline's
content is omitted from the deliverable.

No schema change, migration-ledger edit or Worker/frontend deployment was part
of this application. Live browser and public site-API behavior were not checked
in production; the filter/detail service results above are local. The original
worldwide/regional coverage gate remains unmet, and registry-reported websites
remain unverified for current reachability and ownership.

## 22 November evidence follow-up

[D7316 part 3](../architecture/decisions/D7316-p3.md) records the owner's
instruction to retain the 11,000 held rows. S1 subsequently reported 10,122
additional inserts after this audit's original cohort. Their reported counts
and outstanding retained-package evidence are recorded separately in the
[22 November reconciliation](RESEARCH_COMPANIES_EVIDENCE_2026-11-22.md).
This audit's original receipts do not verify those later inserts.
