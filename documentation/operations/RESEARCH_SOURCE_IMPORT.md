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
