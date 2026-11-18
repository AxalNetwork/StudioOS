# Fund-manager research

This is original research for D7325 (#7325). Each record carries a manager's
official website, the page used for its identity, the verification date, and
short factual evidence with URLs. A research region describes the collection
work; it is not an assertion of the manager's headquarters or investment mandate.

Headquarters is populated only when a retrieved source supports it. Several
offices, a registered fund domicile, or an investment territory alone do not
establish a headquarters. Unknown facts stay `null`.

| File | Purpose |
| --- | --- |
| `global-managers-2026-11-18.json` | Reviewed manager facts, primary-source citations, and historical names used for duplicate detection. |

`scripts/import-global-funds.py` validates this manifest, compares it with the
pinned catalogue imports, and generates an additive SQL migration. It does not
access a remote database. Its `--check` mode verifies the committed migration
without writing. A later expansion uses a new dated manifest and a new migration;
an applied migration is never regenerated in place.

The CLI report lists its pinned baseline migrations and labels its comparison
scope explicitly. Its count is reproducible against that baseline; intervening
catalogue additions can reduce actual inserts through the runtime guards.

Stage and cheque-range notes remain research evidence here because the public
directory does not yet support those fields. They are not converted to fund
size, fund vintage or LP backing. A website being accessible does not establish
permission to reproduce it: the source is `cite only`, and no page body is copied.
