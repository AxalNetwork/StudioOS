# Research companies — evidence reconciliation, 22 November 2026

Status: **reported aggregate counts recorded; execution evidence outstanding**.
This is a follow-up to the [19 November application audit](RESEARCH_COMPANIES_REGISTERS_2026-11-19.md),
whose verified scope remains the original 25,500-row register cohort. It does
not extend that cohort's receipts to later inserts.

## Later batches reported by S1

The source is S1's [21 November aggregate-audit comment](https://github.com/AxalNetwork/StudioOS/issues/7316#issuecomment-7068517729).
It reports these additional rows inserted on 19 November between 01:14 and
12:48 UTC. S35 did not execute that import and has not independently verified
these counts against source files, UID manifests or per-statement receipts.

| Reported publisher | Additional rows |
| --- | ---: |
| PRH | 2,605 |
| BRREG | 2,604 |
| RIK | 474 |
| U.S. SEC, Form ADV | 2,907 |
| Taiwan Stock Exchange and Taipei Exchange, MOPS | 1,410 |
| Official company website | 40 |
| European Innovation Council | 45 |
| Individually named official website publishers, combined | 37 |
| **Reported total** | **10,122** |

The 37 is a combined row count, not 37 verified batches or 37 rows per publisher.
No later batch is credited toward the worldwide coverage gate by this record.

## Retained evidence still needed

The original execution package has not been located in the shared workspace
checks performed during this continuation. Its location was requested on
[#7316](https://github.com/AxalNetwork/StudioOS/issues/7316#issuecomment-7073639441).
No package location or missing artifact checksum is asserted here.

For each later batch, obtain the retained source projection and retrieval
metadata; compiler/run version and exact input/output hashes; the intended UID
manifest; the applied SQL/statement manifest and statement receipts; and bounded
postflight identity/evidence reconciliation. Obtain the retained
`consolidated-company-quality-holds.json` and establish which version each run
used. The initial cohort's documented 314-entry ledger hash is
`4b2c845f9c4528e62bb68b6650574a2e38acb2b79ca487250ff15eee7befb988`;
it does not establish which ledger was used by later runs.

An aggregate observation cannot reconstruct the exact selected source records,
statement effects, identity deduplication or held-company exclusions. The
matching retained bytes must supply those proofs before this audit can call
the later imports reconciled. Do not rerun an import to manufacture historical
receipts.

## Held cohort and remaining scope

The [owner answer on #7861 Q23](https://github.com/AxalNetwork/StudioOS/issues/7316#issuecomment-7068524787)
is to keep the 11,000 held Wikidata rows. They stay held and excluded from usable
admission totals. The prepared bulk rollback is not to be run.

The original worldwide gate remains unmet: the documented register cohort
covers three countries rather than 50, with regional gaps described in the
19 November audit. No importer, production data or existing quality decision
changes in this documentation follow-up. This record does not close #7316.
