# Company business facts

<!-- index: none -->

Reviewed manifests of sourced business facts about companies in the Research
directory, for D7828 (#7828). `scripts/import-company-facts.mjs` compiles each
manifest into a migration that fills `research_company_facts`; the first one is
#9029. Nothing here is read at runtime.

## What a manifest holds

One JSON file per reviewed batch, named `<name>-<YYYY-MM-DD>.json`, with
`name`, `reviewed_by`, `reviewed_on` and a `facts` list. Each fact names a
company uid from a committed `research_company_directory` migration, a key
that stays stable for that company, one of the twelve attributes in
`COMPANY_FACT_ATTRIBUTES` (`cloudflare-worker/src/services/researchCompanyFacts.ts`),
a state and a statement type from `researchEvidenceVocabulary.ts`, the source
page's link and its publisher as the page names it, and the retrieval date.

- A found fact carries a value and either a passage quoted from the source,
  no longer than `FACT_PASSAGE_MAX` characters, or the structured field it was
  read from. A value is at most `FACT_VALUE_MAX` characters. Both caps are read
  from `researchCompanyFacts.ts` by the compiler, so this README states no number.
- An absence (`not_found`, `not_offered`, `source_unavailable`) carries no
  value and no passage: it records that the cited page was checked.
- Every fact comes from a public page someone can open. Nothing is inferred
  from a sector label or a classification code, and nothing is written from
  memory.
- The manifest is public: no email address, phone number or person's name
  anywhere. The compiler refuses them, and refuses the whole manifest on the
  first fact it refuses.
- `reviewed_by` names the owner or a reviewer the owner approves on the PR.

## Rules for adding to it

1. Write a new dated manifest; never edit one a migration was compiled from.
   A correction is a new fact with `replaces`, in a later manifest.
2. Compile it once, into
   `cloudflare-worker/sql/migrations/YYYYMMDDHHMM_<issue>_<slug>.sql`:
   `node scripts/import-company-facts.mjs --manifest <file> --out <sql>`.
   Never edit the compiled file by hand.
3. `cloudflare-worker/test/research_company_manifests_9029.test.ts` runs the
   compiler's `--check` on every manifest here against the one migration that
   names it, shows each uid is inserted by a committed directory migration, and
   fails on a compiled migration whose manifest is not here.
4. After deploy, the skipped count is the compiled header's fact count less
   `SELECT COUNT(*) FROM research_company_facts WHERE manifest_name = '<name>'`.
