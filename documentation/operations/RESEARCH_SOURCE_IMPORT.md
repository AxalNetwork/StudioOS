# Research source import — operator runbook (D7745)

How a Super Admin puts a private Research package into the staging store (D7742) through
`/api/research-source-imports`, reads it back, settles a run that did not finish, and removes records. Every example
here is invented. The real production apply is held until the queue alert #5719 closes (#7739 Q4 A) and is run under
#7760 with the owner at the browser.

## Before you start

- **Who:** a Super Admin on HQ, signed in with a TOTP session. Every write asks for a fresh step-up. A support session
  is refused on every route (`support_session_refused`), reads included.
- **What leaves your device:** only the permitted columns. Contact columns, personal-profile links and whole records
  about people are left out by the client before upload (#7739 Q3 B). The Worker refuses a chunk that carries a
  contact cell (`contact_column_refused`). The validated file on your device is not changed and is never sent whole.
- **Where it must never appear:** git, an issue, a PR, a comment, a workflow input or log, an artifact, a URL, a chat
  or a model prompt. Ids and hashes travel in request bodies, never in a path or a query.

## The flow

1. **Preview** (`POST /preview`, writes nothing). Send the manifest and the record list as pages of at most 500
   `[source key, record id, row hash]` entries. Each source answers sent, new, unchanged, changed, removed and
   `private_fields_removed`, and whether the whole list matches the manifest's list digest. Stop if a digest does not
   match: the manifest and the list disagree.
2. **Open a run** (`POST /runs`). A new idempotency key (8–200 characters, for example `funds-2026-11-23-a`), the
   manifest, every column's class (`fact`, `prose` or `contact`; contact is always `withheld`) and the file's SHA-256.
   The answer is the run and the chunk bound (50 records, 600,000 bytes). Sending the same key again answers the same
   run. If another run is open or not reconciled you get `run_open` naming it: seal or reconcile that one first.
3. **Send chunks** (`POST /runs/:uid/chunks`), `chunk_index` from 0, at most 50 records each, each with its
   `body_sha256` (SHA-256 of the JSON of its permitted cells). A chunk may mix sources; 2,191 records are 44 chunks.
   An answer of `written` is final. `replayed` means the Worker already holds that chunk and wrote nothing.
   `uncertain` means the write's outcome is unknown: send the same chunk again.
4. **Seal** (`POST /runs/:uid/seal`) with the full expected list. Complete means every record is present once under
   its expected hash, the list digest recomputed from the store equals the declared one, every stored body hash
   recomputes, nothing was refused, and the cell counts (stored + withheld + blank) add up. Otherwise the answer is
   `partial` or `uncertain` and names the ids (up to 100 per kind; the counts are whole).
5. **Read back** (`GET /runs/:uid`, pages of 1,000 members with `?offset=`): counts, the chunks the Worker holds, the
   recomputed list digests, and every member's id, stated hash and outcome. No record body is ever returned.

## Pacing and a 429

The default rate limit is 60 requests a minute per user, with no exemption for this path. Send one request a second.
Preview, apply and read-back of the audited package take about 50 requests. A **429** means the request never
reached the import: the run stays open; wait for the minute to pass and send the same chunk again. It writes once.

## Partial, uncertain and an expired step-up

- **Expired step-up:** the next chunk is refused with 403 `step_up_required` and nothing is written. Step up again and
  carry on from the chunk that was refused; `GET /runs/:uid` lists the chunks already held.
- **Uncertain:** send each chunk listed in `uncertain_chunks` again, then seal.
- **Partial:** read the named ids. If chunks were missed, `POST /runs/:uid/reconcile` with `{"action":"resume"}`,
  send them, and seal again. If the run cannot be completed (a record refused as removed, a list that changed), close
  it with `{"action":"close"}`: it becomes `failed`, its stored records stay, and a new run may open.

## Removal

`POST /removals` with `scope` `private_fields`, `record` (every version of one record, for a person who asks) or
`source` (every record of one source). It is refused while a run is open. Each removal is recorded with its actor,
time, scope and counts, and one audit row. Afterwards preview reports the record as removed (or its private fields as
removed) and a replay never restores it. A removal clears the live tables only: D1 Time Travel (30 days) and the
locked nightly export (365 days) keep earlier copies (D7742).

## Mapping: what each record is and what happens to it (D7746)

After a run seals Complete, say record by record what each staged record is and what is to happen to it, under
`/api/research-source-imports/mappings`. Same gate as the import: a Super Admin, the write bar for a decision, never a
support session. Nothing here writes the catalogue; promotion is #7751's.

1. **Look** (`GET /mappings`, filters `source`, `kind`, `decision`, `outcome`, `flag`, `offset`): ids, kind,
   decision, outcome, flag codes, candidate count and the name-column label, 100 a page. There is no search
   parameter: filter by codes. A record with no decision reads `unresolved` / `no_decision`.
2. **Read one** (`POST /mappings/record` with `{source_key, provider_record_id}`) only when you need its cells: the
   only route that returns them, and each read writes one audit row naming the stored record id. It shows the
   candidates, each with its ground (`name_key`, `manager_fund_number`, `website_host`, `retired_uid`), and the history.
3. **Decide one** (`POST /mappings/decide`): `kind` (manager, vehicle, accelerator, resource, company, funding_round,
   individual) and `decision`:
   - `create` — a new catalogue entity once #7751 promotes it. Until then it counts as unresolved, awaiting promotion.
   - `link` with `target` `{type: "catalogue_fund", id: <served uid>}` or `{type: "staged_record", source_key, id}`
     (a record of the same kind that carries `create`) and a `ground`. A ground other than `operator_verified` must be
     one the candidates show; `operator_verified` needs a `reason`. A retired uid is refused naming where it moved:
     link to that uid instead.
   - `retain_private` or `reject`, with a `reason`. A company, a funding round or an individual may only take these.
   - `note` (optional, at most 280 characters) is private: it is read back only by step 2.
4. **Decide many** (`POST /mappings/bulk/preview`, then `POST /mappings/bulk/apply` with the same `entries` and the
   preview's `preview_digest`): at most 500 entries keyed by (source key, provider record id). The whole list is
   refused on an unknown or repeated key, a kind or decision not allowed, or a record with a shared website. If a
   named record changed after the preview, the apply answers `preview_stale`: preview again. Applying the same list
   twice writes nothing. `state_changed` means another decision landed during the write: read again and retry.
5. **Reconcile** (`GET /mappings/report`): per source and kind, created, linked, retained privately, rejected and
   unresolved (no decision / awaiting promotion), summing to the staged records; and the staged records, columns and
   cells against the newest manifest. Only the `summary` (counts) may be quoted outside HQ; the per-record `lines` stay
   with you. The totals are records, not funds.

**Shared websites.** A host used by more than one staged record or catalogue row, or a hosting or social platform
(LinkedIn, a site builder, a link page), never proves two records are one. Such a record is flagged
`shared_website`, its host match is offered but marked, a link on that ground alone is refused, and it can only be
decided one at a time, on another ground.

**Not to be sent anywhere:** a note, a field value or a mapping list in a path, a query, an issue, a PR, a log or a
chat. Ids, codes and counts may appear in a log or an audit row.

## What may appear in a log or an audit row

Codes, source keys, column names, record ids, counts, digests and an error's name. Never a field value. The audit log
holds one row per run opened, sealed and reconciled and per removal. A chunk's own record is the run's receipt.

## Which digest proves what

| Value | Checked? |
|---|---|
| `body_sha256` per record | **Yes.** Recomputed by the Worker at the chunk and from the stored bytes at seal. |
| List digest per source (sorted `id:row_hash` lines) | **Yes.** Recomputed from the store at seal; the one Complete depends on. |
| Row hash per record (whole record) | **No: declared.** No package hash recipe is registered (D7742). |
| File digest | **No: declared.** The Worker never receives the file. |
